// server.js - ПОЛНЫЙ ИСПРАВЛЕННЫЙ ФАЙЛ С ВСЕМИ API
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const fs = require('fs').promises;

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
const app = express();

// CORS настройки
const corsOptions = {
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://yourdomain.com'] 
        : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:8080', 'http://localhost:5000', 'http://localhost:5500'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

// Применяем CORS middleware
app.use(cors(corsOptions));

// Обработка preflight запросов
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// Парсинг JSON с увеличенным лимитом
app.use(express.json({ 
    limit: '50mb',
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));

app.use(express.urlencoded({ 
    extended: true, 
    limit: '50mb',
    parameterLimit: 100000
}));

// Статические файлы с правильными заголовками
app.use(express.static('public', {
    setHeaders: (res, path) => {
        // Кеширование статических файлов
        res.set('Cache-Control', 'public, max-age=31536000');
        // Безопасные заголовки для iOS
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('X-Frame-Options', 'DENY');
    }
}));

// Добавьте этот middleware для обработки ошибок CORS
app.use((req, res, next) => {
    // Устанавливаем заголовки безопасности для iOS
    res.header('Access-Control-Allow-Credentials', 'true');
    
    // Предотвращаем кеширование API запросов на iOS
    if (req.path.startsWith('/api')) {
        res.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.header('Pragma', 'no-cache');
        res.header('Expires', '0');
    }
    
    next();
});

// ==================== КОНФИГУРАЦИЯ ====================
const DEMO_MODE = true;

// ==================== НАСТРОЙКА ЗАГРУЗКИ ФАЙЛОВ ====================
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'public/uploads';
    // Создаем директорию если ее нет
    if (!fs.existsSync) {
      const fsSync = require('fs');
      if (!fsSync.existsSync(uploadDir)) {
        fsSync.mkdirSync(uploadDir, { recursive: true });
      }
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|svg|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Только изображения разрешены'));
    }
  }
});
// ==================== БАЗА ДАННЫХ ====================
let db;

const initDatabase = async () => {
    try {
        console.log('🔄 Инициализация базы данных...');
        
        const dbPath = process.env.NODE_ENV === 'production' ? '/tmp/concierge_prod.db' : './concierge.db';
        console.log(`📁 Путь к базе данных: ${dbPath}`);
        
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        console.log('✅ База данных SQLite подключена');
        await db.run('PRAGMA foreign_keys = ON');

        // Создание таблиц
        await db.exec('BEGIN TRANSACTION');

        // Пользователи
        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT,
                password TEXT NOT NULL,
                first_name TEXT NOT NULL,
                last_name TEXT,
                phone TEXT NOT NULL UNIQUE,
                phone_verified INTEGER DEFAULT 0,
                phone_verification_code TEXT,
                phone_verification_expires TIMESTAMP,
                phone_verification_attempts INTEGER DEFAULT 0,
                role TEXT DEFAULT 'client' CHECK(role IN ('client', 'performer', 'admin', 'manager', 'superadmin')),
                subscription_plan TEXT DEFAULT 'essential',
                subscription_status TEXT DEFAULT 'pending',
                subscription_expires DATE,
                avatar_url TEXT,
                balance REAL DEFAULT 0,
                initial_fee_paid INTEGER DEFAULT 0,
                initial_fee_amount REAL DEFAULT 0,
                tasks_limit INTEGER DEFAULT 5,
                tasks_used INTEGER DEFAULT 0,
                user_rating REAL DEFAULT 0,
                completed_tasks INTEGER DEFAULT 0,
                total_spent REAL DEFAULT 0,
                last_login TIMESTAMP,
                is_active INTEGER DEFAULT 1,
                email_verified INTEGER DEFAULT 0,
                verification_token TEXT,
                reset_token TEXT,
                reset_token_expires TIMESTAMP,
                bio TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Коды подтверждения телефона
        await db.exec(`
            CREATE TABLE IF NOT EXISTS phone_verification_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT NOT NULL,
                code TEXT NOT NULL,
                attempts INTEGER DEFAULT 0,
                verified INTEGER DEFAULT 0,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Подписки
        await db.exec(`
            CREATE TABLE IF NOT EXISTS subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                display_name TEXT NOT NULL,
                description TEXT NOT NULL,
                price_monthly REAL NOT NULL,
                price_yearly REAL NOT NULL,
                initial_fee REAL NOT NULL DEFAULT 0,
                tasks_limit INTEGER NOT NULL,
                features TEXT NOT NULL,
                color_theme TEXT DEFAULT '#FF6B8B',
                sort_order INTEGER DEFAULT 0,
                is_popular INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

       // Категории
await db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT NOT NULL,
        icon TEXT NOT NULL,
        image_url TEXT,
        color TEXT DEFAULT '#FF6B8B',
        sort_order INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`);
        
        // Услуги
        await db.exec(`
            CREATE TABLE IF NOT EXISTS services (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                base_price REAL DEFAULT 0,
                estimated_time TEXT,
                is_active INTEGER DEFAULT 1,
                sort_order INTEGER DEFAULT 0,
                is_featured INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
            )
        `);

        // Задачи
        await db.exec(`
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_number TEXT UNIQUE NOT NULL,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                client_id INTEGER NOT NULL,
                performer_id INTEGER,
                category_id INTEGER NOT NULL,
                service_id INTEGER,
                status TEXT DEFAULT 'new',
                priority TEXT DEFAULT 'medium',
                price REAL DEFAULT 0,
                address TEXT NOT NULL,
                deadline DATETIME NOT NULL,
                contact_info TEXT NOT NULL,
                additional_requirements TEXT,
                task_rating INTEGER,
                feedback TEXT,
                cancellation_reason TEXT,
                cancellation_by INTEGER,
                admin_notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP,
                FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (performer_id) REFERENCES users(id) ON DELETE SET NULL,
                FOREIGN KEY (category_id) REFERENCES categories(id),
                FOREIGN KEY (service_id) REFERENCES services(id),
                FOREIGN KEY (cancellation_by) REFERENCES users(id)
            )
        `);

        // История статусов
        await db.exec(`
            CREATE TABLE IF NOT EXISTS task_status_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                status TEXT NOT NULL,
                changed_by INTEGER NOT NULL,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (changed_by) REFERENCES users(id)
            )
        `);

        // Сообщения в чате
        await db.exec(`
            CREATE TABLE IF NOT EXISTS task_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                message TEXT NOT NULL,
                is_read INTEGER DEFAULT 0,
                read_at TIMESTAMP,
                attachment_url TEXT,
                attachment_type TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Отзывы
        await db.exec(`
            CREATE TABLE IF NOT EXISTS reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                client_id INTEGER NOT NULL,
                performer_id INTEGER NOT NULL,
                rating INTEGER NOT NULL,
                comment TEXT,
                is_anonymous INTEGER DEFAULT 0,
                is_featured INTEGER DEFAULT 0,
                admin_approved INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (performer_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Назначения исполнителей по категориям
        await db.exec(`
            CREATE TABLE IF NOT EXISTS performer_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                performer_id INTEGER NOT NULL,
                category_id INTEGER NOT NULL,
                is_active INTEGER DEFAULT 1,
                experience_years INTEGER DEFAULT 0,
                hourly_rate REAL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (performer_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
                UNIQUE(performer_id, category_id)
            )
        `);

        // Транзакции
        await db.exec(`
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                amount REAL NOT NULL,
                description TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                payment_method TEXT,
                payment_id TEXT,
                metadata TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Уведомления
        await db.exec(`
            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                is_read INTEGER DEFAULT 0,
                read_at TIMESTAMP,
                related_id INTEGER,
                related_type TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Настройки системы
        await db.exec(`
            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT UNIQUE NOT NULL,
                value TEXT,
                description TEXT,
                category TEXT DEFAULT 'general',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // FAQ
        await db.exec(`
            CREATE TABLE IF NOT EXISTS faq (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                question TEXT NOT NULL,
                answer TEXT NOT NULL,
                category TEXT DEFAULT 'general',
                sort_order INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await db.exec('COMMIT');
        console.log('✅ Все таблицы созданы');

        // Создаем тестовые данные
        await createInitialData();
        
        return db;
    } catch (error) {
        try {
            await db.exec('ROLLBACK');
        } catch (rollbackError) {
            console.error('Ошибка при ROLLBACK:', rollbackError.message);
        }
        console.error('❌ Ошибка инициализации базы данных:', error.message);
        throw error;
    }
};


// ==================== ТЕСТОВЫЕ ДАННЫЕ ====================
const createInitialData = async () => {
    try {
        console.log('📝 Создание начальных данных...');

        // 1. Настройки системы
        const settingsExist = await db.get("SELECT 1 FROM settings WHERE key = 'site_name'");
        if (!settingsExist) {
            const settings = [
                ['site_name', 'Женский Консьерж', 'Название сайта', 'general'],
                ['site_description', 'Помощь в бытовых вопросах от женщин для женщин', 'Описание сайта', 'general'],
                ['support_email', 'support@concierge.ru', 'Email поддержки', 'general'],
                ['support_phone', '+79991234567', 'Телефон поддержки', 'general'],
                ['system_fee', '10', 'Комиссия системы (%)', 'financial'],
                ['site_maintenance', '0', 'Режим технического обслуживания', 'system'],
                ['min_task_price', '0', 'Минимальная цена задачи', 'financial'],
                ['max_task_price', '100000', 'Максимальная цена задачи', 'financial'],
                ['sms_demo_mode', DEMO_MODE ? '1' : '0', 'Демо-режим SMS (коды в консоли)', 'sms'],
                ['sms_code_expiry_minutes', '10', 'Время жизни SMS кода (минут)', 'sms'],
                ['max_sms_attempts', '3', 'Максимальное количество попыток', 'sms'],
                ['sms_cooldown_seconds', '60', 'Задержка между отправкой SMS (секунд)', 'sms']
            ];

            for (const setting of settings) {
                try {
                    await db.run(
                        `INSERT OR IGNORE INTO settings (key, value, description, category) VALUES (?, ?, ?, ?)`,
                        setting
                    );
                } catch (error) {
                    console.warn(`Ошибка вставки настройки ${setting[0]}:`, error.message);
                }
            }
            console.log('✅ Настройки системы созданы');
        }

        // 2. FAQ
        const faqExist = await db.get("SELECT 1 FROM faq LIMIT 1");
        if (!faqExist) {
            const faqs = [
                ['Как работает система подписок?', 'Вы оплачиваете вступительный взнос один раз при регистрации, затем ежемесячную плату. Все услуги в рамках вашего тарифа бесплатны для вас.', 'subscriptions', 1, 1],
                ['Можно ли изменить тариф?', 'Да, вы можете изменить тариф в любой момент. Разница в стоимости будет учтена при следующем платеже.', 'subscriptions', 2, 1],
                ['Что входит в вступительный взнос?', 'Вступительный взнос покрывает расходы на проверку и обучение помощниц, а также страховку качества услуг.', 'payments', 3, 1],
                ['Как отменить подписку?', 'Вы можете отменить подписку в любое время в разделе "Мой профиль". Подписка останется активной до конца оплаченного периода.', 'subscriptions', 4, 1],
                ['Как выбираются помощницы?', 'Все наши помощницы проходят строгий отбор, проверку документов и обучение. Вы можете видеть их рейтинг и отзывы перед выбором.', 'performers', 5, 1],
                ['Что делать, если не устроило качество услуги?', 'Мы гарантируем возврат средств или повторное оказание услуги, если качество не устроило. Свяжитесь с нашей поддержкой.', 'quality', 6, 1],
                ['Как подтвердить телефон?', 'После регистрации мы отправим SMS с кодом подтверждения. Введите его в приложении для верификации телефона.', 'verification', 7, 1],
                ['Нет доступа к телефону, как войти?', 'Вы можете использовать любой телефон для регистрации. Для входа используйте номер телефона и пароль.', 'login', 8, 1]
            ];

            for (const faq of faqs) {
                try {
                    await db.run(
                        `INSERT OR IGNORE INTO faq (question, answer, category, sort_order, is_active) VALUES (?, ?, ?, ?, ?)`,
                        faq
                    );
                } catch (error) {
                    console.warn('Ошибка вставки FAQ:', error.message);
                }
            }
            console.log('✅ FAQ созданы');
        }

        // 3. Подписки
        const subscriptionsExist = await db.get("SELECT 1 FROM subscriptions LIMIT 1");
        if (!subscriptionsExist) {
            const subscriptions = [
                [
                    'essential', 'Эссеншл', 'Базовый набор услуг для эпизодических задач',
                    0, 0, 500, 5,
                    '["До 5 задач в месяц", "Все базовые услуги", "Поддержка по email", "Стандартное время ответа"]',
                    '#FF6B8B', 1, 0, 1
                ],
                [
                    'premium', 'Премиум', 'Полный доступ ко всем услугам и приоритетная поддержка',
                    1990, 19900, 1000, 999,
                    '["Неограниченные задачи", "Все услуги премиум-класса", "Приоритетная поддержка 24/7", "Личный помощник", "Срочные заказы"]',
                    '#9B59B6', 2, 1, 1
                ]
            ];

            for (const sub of subscriptions) {
                try {
                    await db.run(
                        `INSERT OR IGNORE INTO subscriptions 
                        (name, display_name, description, price_monthly, price_yearly, 
                         initial_fee, tasks_limit, features, color_theme, sort_order, is_popular, is_active) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        sub
                    );
                } catch (error) {
                    console.warn('Ошибка вставки подписки:', error.message);
                }
            }
            console.log('✅ Тарифы подписок созданы');
        }

        // 4. Категории услуг
        const categoriesExist = await db.get("SELECT 1 FROM categories LIMIT 1");
        if (!categoriesExist) {
const categories = [
    ['home_and_household', 'Дом и быт', 'Уборка, готовка, уход за домом', '🏠', 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=400&h=200&fit=crop', '#FF6B8B', 1, 1],
    ['family_and_children', 'Семья и дети', 'Няни, репетиторы, помощь с детьми', '👨‍👩‍👧‍👦', 'https://images.unsplash.com/photo-1511895426328-dc8714191300?w=400&h=200&fit=crop', '#3498DB', 2, 1],
    ['beauty_and_health', 'Красота и здоровье', 'Маникюр, массаж, парикмахерские услуги', '💅', 'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=400&h=200&fit=crop', '#9B59B6', 3, 1],
    ['courses_and_education', 'Образование', 'Репетиторство, обучение, курсы', '🎓', 'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=400&h=200&fit=crop', '#2ECC71', 4, 1],
    ['shopping_and_delivery', 'Покупки и доставка', 'Покупка и доставка товаров', '🛒', 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=400&h=200&fit=crop', '#E74C3C', 5, 1],
    ['events_and_organization', 'События и организация', 'Организация мероприятий и праздников', '🎉', 'https://images.unsplash.com/photo-1511795409834-ef04bbd61622?w=400&h=200&fit=crop', '#F39C12', 6, 1]
];

for (const cat of categories) {
    try {
        await db.run(
            `INSERT OR IGNORE INTO categories 
            (name, display_name, description, icon, image_url, color, sort_order, is_active) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            cat
        );
    } catch (error) {
        console.warn('Ошибка вставки категории:', error.message);
    }
}
            console.log('✅ Категории услуг созданы');
        }

        // 5. Услуги
        const servicesExist = await db.get("SELECT 1 FROM services LIMIT 1");
        if (!servicesExist) {
            const categories = await db.all("SELECT id, name FROM categories");
            const categoryMap = {};
            categories.forEach(cat => categoryMap[cat.name] = cat.id);

            const services = [
                // Дом и быт (4 услуги)
                [categoryMap.home_and_household, 'Уборка квартиры', 'Генеральная или поддерживающая уборка квартиры', 0, '2-4 часа', 1, 1, 1],
                [categoryMap.home_and_household, 'Химчистка мебели', 'Профессиональная химчистка диванов, кресел, матрасов', 0, '3-5 часов', 1, 2, 0],
                [categoryMap.home_and_household, 'Стирка и глажка', 'Стирка, сушка и глажка белья', 0, '2-3 часа', 1, 3, 0],
                [categoryMap.home_and_household, 'Приготовление еды', 'Приготовление блюд на день или неделю', 0, '3-4 часа', 1, 4, 1],
                
                // Дети и семья (2 услуги)
                [categoryMap.family_and_children, 'Няня на час', 'Присмотр за детьми на несколько часов', 0, '1 час', 1, 5, 1],
                [categoryMap.family_and_children, 'Репетитор для ребенка', 'Помощь с уроками по школьным предметам', 0, '1 час', 1, 6, 0],
                
                // Красота и здоровье (3 услуги)
                [categoryMap.beauty_and_health, 'Маникюр на дому', 'Профессиональный маникюр с выездом', 0, '1.5 часа', 1, 7, 1],
                [categoryMap.beauty_and_health, 'Стрижка и укладка', 'Парикмахерские услуги на дому', 0, '2 часа', 1, 8, 0],
                [categoryMap.beauty_and_health, 'Массаж', 'Расслабляющий или лечебный массаж', 0, '1 час', 1, 9, 1],
                
                // Курсы и образование (1 услуга)
                [categoryMap.courses_and_education, 'Репетиторство', 'Индивидуальные занятия по предметы', 0, '1 час', 1, 10, 1],
                
                // Покупки и доставка (2 услуги)
                [categoryMap.shopping_and_delivery, 'Покупка продуктов', 'Покупка и доставка продуктов', 0, '1-2 часа', 1, 11, 1],
                [categoryMap.shopping_and_delivery, 'Доставка документов', 'Срочная доставка документов', 0, '1 час', 1, 12, 0]
            ];

            for (const service of services) {
                try {
                    await db.run(
                        `INSERT OR IGNORE INTO services 
                        (category_id, name, description, base_price, estimated_time, is_active, sort_order, is_featured) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        service
                    );
                } catch (error) {
                    console.warn('Ошибка вставки услуги:', error.message);
                }
            }
            console.log('✅ Услуги созданы (12 услуг)');
        }

        // 6. Тестовые пользователи
        const usersExist = await db.get("SELECT 1 FROM users LIMIT 1");
        if (!usersExist) {
            const passwordHash = await bcrypt.hash('admin123', 12);
            const clientPasswordHash = await bcrypt.hash('client123', 12);
            const performerPasswordHash = await bcrypt.hash('performer123', 12);
            
            const expiryDate = new Date();
            expiryDate.setFullYear(expiryDate.getFullYear() + 1);
            const expiryDateStr = expiryDate.toISOString().split('T')[0];

            const users = [
                // Главный админ
                ['superadmin@concierge.test', passwordHash, 'Александр', 'Иванов', '+79991112233', 1, 'superadmin', 'premium', 'active', expiryDateStr, 'https://ui-avatars.com/api/?name=Александр+Иванов&background=9B59B6&color=fff&bold=true', 0, 1000, 1, 1000, 999, 3, 5, 0, 4.9, 100, 1, 1, null, null, null],
                
                // Администраторы
                ['admin@concierge.test', passwordHash, 'Мария', 'Петрова', '+79992223344', 1, 'admin', 'premium', 'active', expiryDateStr, 'https://ui-avatars.com/api/?name=Мария+Петрова&background=2ECC71&color=fff&bold=true', 0, 1000, 1, 1000, 999, 2, 5, 0, 4.8, 50, 1, 1, null, null, null],
                
                // Помощники
                ['performer1@concierge.test', performerPasswordHash, 'Анна', 'Кузнецова', '+79994445566', 1, 'performer', 'essential', 'active', expiryDateStr, 'https://ui-avatars.com/api/?name=Анна+Кузнецова&background=3498DB&color=fff&bold=true', 0, 500, 1, 500, 20, 5, 5, 0, 4.5, 30, 1, 1, null, null, null],
                ['performer2@concierge.test', performerPasswordHash, 'Мария', 'Смирнова', '+79995556677', 1, 'performer', 'essential', 'active', expiryDateStr, 'https://ui-avatars.com/api/?name=Мария+Смирнова&background=3498DB&color=fff&bold=true', 0, 500, 1, 500, 20, 8, 5, 0, 4.6, 45, 1, 1, null, null, null],
                ['performer3@concierge.test', performerPasswordHash, 'Ирина', 'Васильева', '+79996667788', 1, 'performer', 'premium', 'active', expiryDateStr, 'https://ui-avatars.com/api/?name=Ирина+Васильева&background=3498DB&color=fff&bold=true', 0, 1000, 1, 1000, 50, 15, 5, 0, 4.8, 60, 1, 1, null, null, null],
                
                // Клиенты
                ['client1@concierge.test', clientPasswordHash, 'Елена', 'Васильева', '+79997778899', 1, 'client', 'premium', 'active', expiryDateStr, 'https://ui-avatars.com/api/?name=Елена+Васильева&background=FF6B8B&color=fff&bold=true', 0, 1000, 1, 1000, 999, 2, 5, 0, 4.0, 10, 1, 1, null, null, null],
                ['client2@concierge.test', clientPasswordHash, 'Наталья', 'Федорова', '+79998889900', 1, 'client', 'essential', 'active', expiryDateStr, 'https://ui-avatars.com/api/?name=Наталья+Федорова&background=FF6B8B&color=fff&bold=true', 0, 500, 1, 500, 5, 1, 5, 0, 4.5, 3, 1, 1, null, null, null],
                ['client3@concierge.test', clientPasswordHash, 'Оксана', 'Николаева', '+79999990011', 0, 'client', 'essential', 'pending', null, 'https://ui-avatars.com/api/?name=Оксана+Николаева&background=FF6B8B&color=fff&bold=true', 0, 500, 0, 500, 5, 0, 5, 0, 0, 0, 1, 1, null, null, null]
            ];

            for (const user of users) {
                const [email, password, first_name, last_name, phone, phone_verified, role, subscription_plan, subscription_status, subscription_expires, avatar_url, balance, initial_fee_amount, initial_fee_paid, initial_fee_amount2, tasks_limit, tasks_used, tasks_limit2, total_spent, user_rating, completed_tasks, is_active, email_verified, verification_token, reset_token, reset_token_expires] = user;
                
                try {
                    await db.run(
                        `INSERT OR IGNORE INTO users 
                        (email, password, first_name, last_name, phone, phone_verified, role, 
                         subscription_plan, subscription_status, subscription_expires,
                         avatar_url, balance, initial_fee_paid, initial_fee_amount, 
                         tasks_limit, tasks_used, total_spent, user_rating, completed_tasks, 
                         is_active, email_verified, verification_token, reset_token, reset_token_expires) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [email, password, first_name, last_name, phone, phone_verified, role,
                         subscription_plan, subscription_status, subscription_expires,
                         avatar_url, balance, initial_fee_paid, initial_fee_amount, 
                         tasks_limit, tasks_used, total_spent || 0, user_rating, completed_tasks,
                         is_active, email_verified, verification_token, reset_token, reset_token_expires]
                    );
                } catch (error) {
                    console.warn(`Ошибка вставки пользователя ${phone}:`, error.message);
                }
            }
            console.log('✅ Тестовые пользователи созданы');
            
            // Назначаем помощников к категориям
            const categories = await db.all("SELECT id FROM categories");
            const performers = await db.all("SELECT id FROM users WHERE role = 'performer'");
            
            for (const performer of performers) {
                const categoryIds = categories
                    .sort(() => Math.random() - 0.5)
                    .slice(0, 2 + Math.floor(Math.random() * 2))
                    .map(c => c.id);
                
                for (const categoryId of categoryIds) {
                    try {
                        await db.run(
                            `INSERT OR IGNORE INTO performer_categories (performer_id, category_id, experience_years, hourly_rate) 
                             VALUES (?, ?, ?, ?)`,
                            [performer.id, categoryId, Math.floor(Math.random() * 5) + 1, Math.floor(Math.random() * 500) + 500]
                        );
                    } catch (error) {
                        console.warn('Ошибка вставки специализации:', error.message);
                    }
                }
            }
            console.log('✅ Назначения помощников по категориям созданы');
            
            // Создаем тестовые задачи
            const clients = await db.all("SELECT id FROM users WHERE role = 'client' AND subscription_status = 'active' LIMIT 2");
            const categoriesList = await db.all("SELECT id FROM categories");
            const servicesList = await db.all("SELECT id FROM services WHERE is_active = 1");
            
            if (clients.length > 0 && categoriesList.length > 0 && servicesList.length > 0) {
                const taskTitles = [
                    'Уборка двухкомнатной квартиры',
                    'Приготовление ужина на 4 персоны',
                    'Маникюр с выездом на дом',
                    'Покупка продуктов на неделю',
                    'Няня на 4 часа'
                ];
                
                const taskDescriptions = [
                    'Необходимо сделать генеральную уборку в двухкомнатной квартире 55 кв.м. Особое внимание кухне и санузлу.',
                    'Нужно приготовить ужин из 3-х блюд на 4 человека. Предпочтение русской кухне.',
                    'Требуется сделать классический маникюр с покрытием гель-лаком. Цвет предпочитаю нейтральный.',
                    'Собрать продуктовую корзину по списку из Ашана. Доставить до 18:00.',
                    'Присмотреть за ребенком 5 лет на 4 часа. Поиграть, покормить обедом, погулять на площадке.'
                ];
                
                const performers = await db.all("SELECT id FROM users WHERE role = 'performer'");
                
                for (let i = 0; i < 5; i++) {
                    const client = clients[Math.floor(Math.random() * clients.length)];
                    const category = categoriesList[Math.floor(Math.random() * categoriesList.length)];
                    const service = servicesList[Math.floor(Math.random() * servicesList.length)];
                    const performer = performers[Math.floor(Math.random() * performers.length)];
                    
                    const taskNumber = `TASK-${new Date().getFullYear()}${(new Date().getMonth() + 1).toString().padStart(2, '0')}${(i + 1).toString().padStart(3, '0')}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
                    
                    const statuses = ['new', 'searching', 'assigned', 'in_progress', 'completed'];
                    const status = statuses[Math.floor(Math.random() * statuses.length)];
                    
                    const deadline = new Date();
                    deadline.setDate(deadline.getDate() + Math.floor(Math.random() * 7) + 1);
                    
                    try {
                        await db.run(
                            `INSERT INTO tasks 
                            (task_number, title, description, client_id, performer_id, category_id, service_id, 
                             status, priority, price, address, deadline, contact_info) 
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [
                                taskNumber,
                                taskTitles[i],
                                taskDescriptions[i],
                                client.id,
                                status === 'completed' || status === 'in_progress' || status === 'assigned' ? performer.id : null,
                                category.id,
                                service.id,
                                status,
                                ['low', 'medium', 'high'][Math.floor(Math.random() * 3)],
                                0,
                                'г. Москва, ул. Примерная, д. ' + (Math.floor(Math.random() * 100) + 1),
                                deadline.toISOString(),
                                '+79991234567'
                            ]
                        );
                        
                        const taskId = (await db.get('SELECT last_insert_rowid() as id')).id;
                        
                        // Добавляем историю статусов
                        await db.run(
                            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
                             VALUES (?, ?, ?, ?)`,
                            [taskId, 'new', client.id, 'Задача создана']
                        );
                        
                        if (status === 'completed') {
                            // Для завершенных задач добавляем отзывы
                            await db.run(
                                `INSERT INTO reviews (task_id, client_id, performer_id, rating, comment, is_anonymous) 
                                 VALUES (?, ?, ?, ?, ?, ?)`,
                                [taskId, client.id, performer.id, Math.floor(Math.random() * 2) + 4, 'Отличная работа! Быстро и качественно.', 0]
                            );
                        }
                    } catch (error) {
                        console.warn('Ошибка создания тестовой задачи:', error.message);
                    }
                }
                console.log('✅ Тестовые задачи созданы (5 задач)');
            }
        }

        console.log('🎉 Все начальные данные созданы!');
        
        console.log('\n🔑 ТЕСТОВЫЕ АККАУНТЫ:');
        console.log('='.repeat(70));
        console.log('👑 Главный админ: +79991112233 / admin123');
        console.log('👨‍💼 Админ: +79992223344 / admin123');
        console.log('👩‍🏫 Помощник 1: +79994445566 / performer123');
        console.log('👩‍🏫 Помощник 2: +79995556677 / performer123');
        console.log('👩‍🏫 Помощник 3: +79996667788 / performer123');
        console.log('👩 Клиент Премиум: +79997778899 / client123');
        console.log('👩 Клиент Эссеншл: +79998889900 / client123');
        console.log('👩 Клиент без верификации: +79999990011 / client123');
        console.log('='.repeat(70));
        
    } catch (error) {
        console.error('⚠️ Ошибка создания начальных данных:', error.message);
    }
};

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
const generateTaskNumber = () => {
    const now = new Date();
    const datePart = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}`;
    const randomPart = Math.random().toString(36).substr(2, 6).toUpperCase();
    return `TASK-${datePart}-${randomPart}`;
};

const validateEmail = (email) => {
    if (!email) return false;
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
};

const validatePhone = (phone) => {
    if (!phone) return false;
    
    // Форматируем телефон для проверки
    const formattedPhone = formatPhone(phone);
    
    console.log(`🔍 Проверка номера: ${phone} -> ${formattedPhone}`);
    
    // Проверяем российские форматы:
    // +79XXXXXXXXX (11 цифр после +)
    // +7XXXXXXXXX (10 цифр после +)
    const russianRegex = /^\+7\d{10}$/;
    
    // Также принимаем международный формат:
    // + любая цифра (1-9) и 10-15 цифр после
    const internationalRegex = /^\+\d{10,15}$/;
    
    const isValid = russianRegex.test(formattedPhone) || internationalRegex.test(formattedPhone);
    
    console.log(`📱 Валидация номера ${formattedPhone}: ${isValid ? '✅ ВЕРНО' : '❌ НЕВЕРНО'}`);
    
    return isValid;
};

// ЗАМЕНИТЬ СТАРУЮ ФУНКЦИЮ formatPhone НА ЭТУ:
const formatPhone = (phone) => {
    if (!phone) return '';
    
    console.log(`📞 Исходный номер для форматирования: "${phone}"`);
    
    // Убираем все нецифровые символы, кроме плюса в начале
    let cleaned = phone.toString().trim();
    
    // Сохраняем начальный плюс если есть
    const hasPlus = cleaned.startsWith('+');
    
    // Удаляем все нецифровые символы
    cleaned = cleaned.replace(/[^\d]/g, '');
    
    if (cleaned.length === 0) {
        console.log('❌ Номер не содержит цифр');
        return '';
    }
    
    // Определяем код страны и оператора
    let result = '';
    
    // Если номер начинается с 7 или 8 (российские форматы)
    if (cleaned.startsWith('7')) {
        // Формат: 7XXXXXXXXXX (11 цифр) -> +7XXXXXXXXXX
        if (cleaned.length === 11) {
            result = '+7' + cleaned.substring(1);
        }
        // Формат: 7XXXXXXXXX (10 цифр) -> +7XXXXXXXXX
        else if (cleaned.length === 10) {
            result = '+7' + cleaned;
        }
        // Формат: 7XXXXXXXX (9 цифр) -> +7XXXXXXXX
        else if (cleaned.length === 9) {
            result = '+79' + cleaned.substring(1); // Предполагаем, что это 9XXXXXXXX
        }
        else {
            result = '+' + cleaned;
        }
    }
    else if (cleaned.startsWith('8')) {
        // Формат: 89XXXXXXXXX (11 цифр) -> +7XXXXXXXXXX
        if (cleaned.length === 11) {
            result = '+7' + cleaned.substring(1);
        }
        // Формат: 8XXXXXXXXX (10 цифр) -> +7XXXXXXXXX
        else if (cleaned.length === 10) {
            result = '+7' + cleaned.substring(1);
        }
        // Формат: 8XXXXXXXX (9 цифр) -> +7XXXXXXXX
        else if (cleaned.length === 9) {
            result = '+7' + cleaned;
        }
        else {
            result = '+7' + cleaned.substring(1);
        }
    }
    // Если номер начинается с 9 и нет кода страны
    else if (cleaned.length === 10 && cleaned.startsWith('9')) {
        // Формат: 9XXXXXXXXX -> +79XXXXXXXXX
        result = '+7' + cleaned;
    }
    // Если номер начинается с 9 и меньше цифр
    else if (cleaned.length < 10 && cleaned.startsWith('9')) {
        // Формат: 9XXXXXXXX -> +79XXXXXXXX
        result = '+7' + cleaned;
    }
    // Если номер уже с плюсом и 11 цифр после
    else if (hasPlus && cleaned.length === 11) {
        result = '+' + cleaned;
    }
    // Если номер уже с плюсом и 10 цифр после
    else if (hasPlus && cleaned.length === 10) {
        result = '+' + cleaned;
    }
    // Любой другой случай - просто добавляем +7
    else {
        if (cleaned.length >= 10) {
            // Берем последние 10 цифр
            const last10 = cleaned.substring(cleaned.length - 10);
            result = '+7' + last10;
        } else {
            result = '+7' + cleaned;
        }
    }
    
    // Убедимся, что результат начинается с +7 и имеет правильную длину
    if (!result.startsWith('+7')) {
        result = '+7' + result.replace(/^\+/, '');
    }
    
    // Удаляем лишние цифры (оставляем максимум 11 цифр после +)
    if (result.length > 12) { // +7 + 10 цифр
        result = result.substring(0, 12);
    }
    
    console.log(`✅ Отформатированный номер: "${result}"`);
    return result;
};

const generateAvatarUrl = (firstName, lastName, role) => {
    let avatarBgColor = 'FF6B8B';
    if (role === 'performer') {
        avatarBgColor = '3498DB';
    } else if (role === 'admin' || role === 'manager') {
        avatarBgColor = '2ECC71';
    } else if (role === 'superadmin') {
        avatarBgColor = '9B59B6';
    }
    
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(firstName)}+${encodeURIComponent(lastName)}&background=${avatarBgColor}&color=fff&bold=true`;
};

// ==================== SMS ВЕРИФИКАЦИЯ ====================
const generateVerificationCode = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

const sendSmsCode = async (phone, code) => {
    try {
        const formattedPhone = formatPhone(phone);
        
        if (DEMO_MODE) {
            console.log(`📱 [DEMO SMS] Отправка SMS на ${formattedPhone}:`);
            console.log(`🔑 Код подтверждения: ${code}`);
            console.log(`⏰ Код действителен 10 минут`);
            console.log('-'.repeat(50));
            return { success: true, demo: true };
        }
        
        console.log(`📱 [REAL SMS] Отправка SMS на ${formattedPhone}: Код ${code}`);
        return { success: true, demo: false };
        
    } catch (error) {
        console.error('Ошибка отправки SMS:', error.message);
        return { success: false, error: error.message };
    }
};

const isCodeExpired = (expiresAt) => {
    return new Date(expiresAt) < new Date();
};

// ==================== JWT МИДЛВАР ====================
const authMiddleware = (roles = []) => {
    return async (req, res, next) => {
        try {
            const authHeader = req.headers.authorization;
            
            const publicRoutes = [
                'GET /',
                'GET /health',
                'POST /api/admin/login',
                'GET /api/subscriptions',
                'GET /api/categories',
                'GET /api/categories/*',
                'GET /api/services',
                'GET /api/services/top',  // ДОБАВИТЬ ЭТО
                'GET /api/faq',
                'GET /api/reviews',
                'POST /api/auth/register',
                'POST /api/auth/register-performer',
                'POST /api/auth/login',
                'POST /api/auth/verify-phone',
                'POST /api/auth/send-verification',
                'POST /api/auth/send-verification-code',  // ДОБАВИТЬ ЭТО
                'POST /api/auth/forgot-password',
                'POST /api/auth/reset-password',
                'OPTIONS /*'
            ];
            
            const currentRoute = `${req.method} ${req.path}`;
            const isPublicRoute = publicRoutes.some(route => {
                if (route.includes('*')) {
                    const pattern = route.replace('*', '.*');
                    return new RegExp(`^${pattern}$`).test(currentRoute);
                }
                return currentRoute === route;
            });
            
            if (isPublicRoute) {
                return next();
            }
            
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).json({ 
                    success: false, 
                    error: 'Требуется авторизация' 
                });
            }
            
            const token = authHeader.replace('Bearer ', '').trim();
            
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'concierge-secret-key-2024-prod');
                
                const user = await db.get(
                    `SELECT id, email, first_name, last_name, phone, phone_verified, role, 
                            subscription_plan, subscription_status, subscription_expires,
                            initial_fee_paid, initial_fee_amount, is_active, avatar_url,
                            balance, user_rating, completed_tasks, tasks_limit, tasks_used,
                            total_spent, last_login, email_verified
                     FROM users WHERE id = ? AND is_active = 1`,
                    [decoded.id]
                );
                
                if (!user) {
                    return res.status(401).json({ 
                        success: false, 
                        error: 'Пользователь не найден' 
                    });
                }
                
                req.user = {
                    id: user.id,
                    email: user.email,
                    role: user.role,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    phone: user.phone,
                    phone_verified: user.phone_verified,
                    subscription_plan: user.subscription_plan,
                    subscription_status: user.subscription_status,
                    subscription_expires: user.subscription_expires,
                    initial_fee_paid: user.initial_fee_paid,
                    initial_fee_amount: user.initial_fee_amount,
                    avatar_url: user.avatar_url,
                    balance: user.balance,
                    rating: user.user_rating,
                    completed_tasks: user.completed_tasks,
                    tasks_limit: user.tasks_limit,
                    tasks_used: user.tasks_used,
                    total_spent: user.total_spent,
                    last_login: user.last_login,
                    email_verified: user.email_verified
                };
                
                if (roles.length > 0 && !roles.includes(user.role)) {
                    return res.status(403).json({ 
                        success: false, 
                        error: 'Недостаточно прав' 
                    });
                }
                
                next();
                
            } catch (jwtError) {
                return res.status(401).json({ 
                    success: false, 
                    error: 'Неверный токен' 
                });
            }
            
        } catch (error) {
            console.error('Ошибка authMiddleware:', error);
            return res.status(500).json({ 
                success: false, 
                error: 'Внутренняя ошибка сервера' 
            });
        }
    };
};

// ==================== API МАРШРУТЫ ====================

// Главная
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: '🌸 Добро пожаловать в Женский Консьерж API',
        version: '6.0.0',
        status: '🟢 Работает',
        features: ['Регистрация по телефону', 'SMS верификация', 'Подписки', 'Задачи', 'Чат'],
        demo_mode: DEMO_MODE,
        timestamp: new Date().toISOString()
    });
});

// Health check
app.get('/health', async (req, res) => {
    try {
        await db.get('SELECT 1 as status');
        
        const tables = ['users', 'categories', 'services', 'tasks', 'subscriptions'];
        const tableStatus = {};
        
        for (const table of tables) {
            try {
                await db.get(`SELECT 1 FROM ${table} LIMIT 1`);
                tableStatus[table] = 'OK';
            } catch (error) {
                tableStatus[table] = 'ERROR';
            }
        }
        
        res.json({
            success: true,
            status: 'OK',
            database: 'connected',
            tables: tableStatus,
            demo_mode: DEMO_MODE,
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            status: 'ERROR',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ==================== АУТЕНТИФИКАЦИЯ ====================

// Регистрация клиента - ОБНОВЛЕННАЯ ВЕРСИЯ
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, first_name, last_name = '', phone, subscription_plan = 'essential' } = req.body;
        
        console.log('📝 Регистрация клиента:', { 
            phone: phone, 
            email: email, 
            first_name: first_name,
            raw_input: req.body 
        });
        
        if (!phone || !password || !first_name) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля: телефон, пароль и имя'
            });
        }
        
        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'Пароль должен содержать не менее 6 символов'
            });
        }
        
        // Форматируем телефон
        const formattedPhone = formatPhone(phone);
        console.log(`📞 Форматированный телефон: ${phone} -> ${formattedPhone}`);
        
        if (!validatePhone(formattedPhone)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный номер телефона. Используйте форматы: +7XXXXXXXXXX, 8XXXXXXXXXX, 9XXXXXXXXX'
            });
        }
        
        if (email && email.trim() && !validateEmail(email)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный email адрес'
            });
        }
        
        const existingUser = await db.get('SELECT id, phone, email FROM users WHERE phone = ?', [formattedPhone]);
        if (existingUser) {
            return res.status(409).json({
                success: false,
                error: 'Пользователь с таким телефоном уже существует'
            });
        }
        
        if (email && email.trim()) {
            const existingEmail = await db.get('SELECT id FROM users WHERE email = ?', [email]);
            if (existingEmail) {
                return res.status(409).json({
                    success: false,
                    error: 'Пользователь с таким email уже существует'
                });
            }
        }
        
        const subscription = await db.get(
            'SELECT * FROM subscriptions WHERE name = ? AND is_active = 1',
            [subscription_plan]
        );
        
        if (!subscription) {
            return res.status(400).json({
                success: false,
                error: `Подписка "${subscription_plan}" не найдена`
            });
        }
        
        const hashedPassword = await bcrypt.hash(password, 12);
        const verificationToken = crypto.randomBytes(32).toString('hex');
        
        const initialFeePaid = DEMO_MODE ? 1 : (subscription.initial_fee === 0 ? 1 : 0);
        const subscriptionStatus = initialFeePaid ? 'active' : 'pending';
        const phoneVerified = 0;
        
        let expiryDateStr = null;
        if (initialFeePaid) {
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + 30);
            expiryDateStr = expiryDate.toISOString().split('T')[0];
        }
        
        const avatarUrl = generateAvatarUrl(first_name, last_name, 'client');
        
       const result = await db.run(
            `INSERT INTO users 
            (email, password, first_name, last_name, phone, phone_verified, role, 
             subscription_plan, subscription_status, subscription_expires,
             initial_fee_paid, initial_fee_amount, tasks_limit, avatar_url,
             verification_token) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                email || null,
                hashedPassword,
                first_name,
                last_name,
                formattedPhone,
                phoneVerified,
                'client',
                subscription_plan,
                subscriptionStatus,
                expiryDateStr,
                initialFeePaid,
                subscription.initial_fee,
                subscription.tasks_limit,
                avatarUrl,
                verificationToken
            ]
        );
        
        const userId = result.lastID;
        
// Отправляем SMS код ДАЖЕ В ДЕМО-РЕЖИМЕ
const smsCode = generateVerificationCode();
const expiresAt = new Date();
expiresAt.setMinutes(expiresAt.getMinutes() + 10);

await db.run(
    `INSERT INTO phone_verification_codes (phone, code, expires_at) 
     VALUES (?, ?, ?)`,
    [formattedPhone, smsCode, expiresAt.toISOString()]
);

const smsResult = await sendSmsCode(formattedPhone, smsCode);

// Создаем уведомление
try {
    await db.run(
        `INSERT INTO notifications 
        (user_id, type, title, message) 
        VALUES (?, ?, ?, ?)`,
        [
            userId,
            'welcome',
            'Добро пожаловать!',
            'Спасибо за регистрацию в Женском Консьерже. Подтвердите телефон для начала работы.'
        ]
    );
} catch (error) {
    console.warn('Ошибка создания уведомления:', error.message);
}

const user = await db.get(
    `SELECT id, email, first_name, last_name, phone, phone_verified, role, 
            subscription_plan, subscription_status, subscription_expires,
            initial_fee_paid, initial_fee_amount, avatar_url, tasks_limit, tasks_used,
            user_rating
     FROM users WHERE id = ?`,
    [userId]
);

const userForResponse = {
    ...user,
    rating: user.user_rating
};

// ВСЕГДА требуем подтверждение телефона, даже в демо-режиме
// Но в демо-режиме сообщаем, что после подтверждения можно сразу перейти к подписке
res.status(201).json({
    success: true,
    message: 'Регистрация почти завершена! Подтвердите телефон для активации аккаунта.',
    data: { 
        user: userForResponse,
        token: null, // Не даем токен до подтверждения телефона
        requires_phone_verification: true,
        phone_verification_sent: smsResult.success,
        demo_mode: smsResult.demo || false,
        expires_in_minutes: 10,
        requires_initial_fee: !initialFeePaid && !DEMO_MODE,
        initial_fee_amount: subscription.initial_fee,
        phone: formattedPhone,
        can_verify_immediately: true,
        // Для демо-режима указываем, что после подтверждения можно сразу перейти к подписке
        demo_mode_after_verification: DEMO_MODE
    }
});
        
    } catch (error) {
        console.error('Ошибка регистрации:', error.message);
        
        if (error.message.includes('UNIQUE constraint failed') || error.message.includes('SQLITE_CONSTRAINT')) {
            return res.status(409).json({
                success: false,
                error: 'Пользователь с таким телефоном уже существует'
            });
        }
        
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера при регистрации'
        });
    }
});

// Регистрация исполнителя
app.post('/api/auth/register-performer', async (req, res) => {
    try {
        const { email, password, first_name, last_name = '', phone, bio = '' } = req.body;
        
        console.log('Регистрация исполнителя:', { phone, first_name });
        
        if (!phone || !password || !first_name) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля: телефон, пароль и имя'
            });
        }
        
        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'Пароль должен содержать не менее 6 символов'
            });
        }
        
        const formattedPhone = formatPhone(phone);
        if (!validatePhone(formattedPhone)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный номер телефона'
            });
        }
        
        if (email && email.trim() && !validateEmail(email)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный email адрес'
            });
        }
        
        const existingUser = await db.get('SELECT id, phone, email FROM users WHERE phone = ?', [formattedPhone]);
        if (existingUser) {
            return res.status(409).json({
                success: false,
                error: 'Пользователь с таким телефоном уже существует'
            });
        }
        
        if (email && email.trim()) {
            const existingEmail = await db.get('SELECT id FROM users WHERE email = ?', [email]);
            if (existingEmail) {
                return res.status(409).json({
                    success: false,
                    error: 'Пользователь с таким email уже существует'
                });
            }
        }
        
        const hashedPassword = await bcrypt.hash(password, 12);
        const verificationToken = crypto.randomBytes(32).toString('hex');
        
        const phoneVerified = 0;
        const subscriptionStatus = 'active';
        const initialFeePaid = 1;
        const subscription_plan = 'essential';
        
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 30);
        const expiryDateStr = expiryDate.toISOString().split('T')[0];
        
        const avatarUrl = generateAvatarUrl(first_name, last_name, 'performer');
        
        const result = await db.run(
            `INSERT INTO users 
            (email, password, first_name, last_name, phone, phone_verified, role, 
             subscription_plan, subscription_status, subscription_expires,
             initial_fee_paid, initial_fee_amount, tasks_limit, avatar_url,
             verification_token, bio) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                email || null,
                hashedPassword,
                first_name,
                last_name,
                formattedPhone,
                phoneVerified,
                'performer',
                subscription_plan,
                subscriptionStatus,
                expiryDateStr,
                initialFeePaid,
                0,
                999,
                avatarUrl,
                verificationToken,
                bio || null
            ]
        );
        
        const userId = result.lastID;
        
        // Добавляем все специализации по умолчанию
        try {
            const categories = await db.all('SELECT id FROM categories WHERE is_active = 1');
            for (const category of categories) {
                await db.run(
                    `INSERT OR IGNORE INTO performer_categories (performer_id, category_id, is_active) 
                     VALUES (?, ?, 1)`,
                    [userId, category.id]
                );
            }
        } catch (error) {
            console.warn('Ошибка добавления специализаций:', error.message);
        }
        
        const user = await db.get(
            `SELECT id, email, first_name, last_name, phone, phone_verified, role, 
                    subscription_plan, subscription_status, subscription_expires,
                    initial_fee_paid, initial_fee_amount, avatar_url, tasks_limit, tasks_used,
                    user_rating, bio
             FROM users WHERE id = ?`,
            [userId]
        );
        
        const userForResponse = {
            ...user,
            rating: user.user_rating
        };
        
        const smsCode = generateVerificationCode();
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 10);
        
        await db.run(
            `INSERT INTO phone_verification_codes (phone, code, expires_at) 
             VALUES (?, ?, ?)`,
            [formattedPhone, smsCode, expiresAt.toISOString()]
        );
        
        const smsResult = await sendSmsCode(formattedPhone, smsCode);
        
        try {
            await db.run(
                `INSERT INTO notifications 
                (user_id, type, title, message) 
                VALUES (?, ?, ?, ?)`,
                [
                    userId,
                    'welcome',
                    'Добро пожаловать!',
                    'Спасибо за регистрацию в качестве помощницы. Для начала работы подтвердите телефон.'
                ]
            );
        } catch (error) {
            console.warn('Ошибка создания уведомления:', error.message);
        }
        
        res.status(201).json({
            success: true,
            message: 'Регистрация исполнителя почти завершена! Подтвердите телефон.',
            data: { 
                user: userForResponse,
                requires_phone_verification: true,
                phone_verification_sent: smsResult.success,
                demo_mode: smsResult.demo || false,
                expires_in_minutes: 10,
                phone: formattedPhone,
                can_verify_immediately: true
            }
        });
        
    } catch (error) {
        console.error('Ошибка регистрации исполнителя:', error.message);
        
        if (error.message.includes('UNIQUE constraint failed') || error.message.includes('SQLITE_CONSTRAINT')) {
            return res.status(409).json({
                success: false,
                error: 'Пользователь с таким телефоном уже существует'
            });
        }
        
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера при регистрации'
        });
    }
});

// Отправка кода подтверждения
app.post('/api/auth/send-verification', async (req, res) => {
    try {
        const { phone } = req.body;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Не указан номер телефона'
            });
        }
        
        const formattedPhone = formatPhone(phone);
        if (!validatePhone(formattedPhone)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный номер телефона'
            });
        }
        
        const user = await db.get('SELECT id, phone_verified FROM users WHERE phone = ?', [formattedPhone]);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        if (user.phone_verified) {
            return res.status(400).json({
                success: false,
                error: 'Телефон уже подтвержден'
            });
        }
        
        const lastCode = await db.get(
            `SELECT created_at FROM phone_verification_codes 
             WHERE phone = ? AND verified = 0 
             ORDER BY created_at DESC LIMIT 1`,
            [formattedPhone]
        );
        
        if (lastCode) {
            const lastSent = new Date(lastCode.created_at);
            const now = new Date();
            const diffSeconds = (now - lastSent) / 1000;
            
            if (diffSeconds < 60) {
                return res.status(429).json({
                    success: false,
                    error: `Подождите ${Math.ceil(60 - diffSeconds)} секунд перед повторной отправкой`
                });
            }
        }
        
        const smsCode = generateVerificationCode();
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 10);
        
        await db.run(
            `INSERT INTO phone_verification_codes (phone, code, expires_at) 
             VALUES (?, ?, ?)`,
            [formattedPhone, smsCode, expiresAt.toISOString()]
        );
        
        const smsResult = await sendSmsCode(formattedPhone, smsCode);
        
        if (!smsResult.success) {
            return res.status(500).json({
                success: false,
                error: 'Ошибка отправки SMS',
                demo_mode: DEMO_MODE
            });
        }
        
        res.json({
            success: true,
            message: 'Код подтверждения отправлен',
            data: {
                phone: formattedPhone,
                demo_mode: smsResult.demo || false,
                expires_in_minutes: 10,
                can_resend_after_seconds: 60
            }
        });
        
    } catch (error) {
        console.error('Ошибка отправки кода подтверждения:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка отправки кода подтверждения'
        });
    }
});

// Подтверждение телефона
app.post('/api/auth/verify-phone', async (req, res) => {
    try {
        const { phone, code } = req.body;
        
        if (!phone || !code) {
            return res.status(400).json({
                success: false,
                error: 'Не указан телефон или код подтверждения'
            });
        }
        
        const formattedPhone = formatPhone(phone);
        
        const user = await db.get('SELECT id, phone_verified FROM users WHERE phone = ?', [formattedPhone]);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        if (user.phone_verified) {
            return res.status(400).json({
                success: false,
                error: 'Телефон уже подтвержден'
            });
        }
        
        const verificationCode = await db.get(
            `SELECT * FROM phone_verification_codes 
             WHERE phone = ? AND code = ? AND verified = 0 
             ORDER BY created_at DESC LIMIT 1`,
            [formattedPhone, code]
        );
        
        if (!verificationCode) {
            await db.run(
                `UPDATE phone_verification_codes 
                 SET attempts = attempts + 1 
                 WHERE phone = ? AND code = ?`,
                [formattedPhone, code]
            );
            
            return res.status(400).json({
                success: false,
                error: 'Неверный код подтверждения'
            });
        }
        
        if (isCodeExpired(verificationCode.expires_at)) {
            return res.status(400).json({
                success: false,
                error: 'Срок действия кода истек'
            });
        }
        
        if (verificationCode.attempts >= 3) {
            return res.status(400).json({
                success: false,
                error: 'Превышено количество попыток. Запросите новый код.'
            });
        }
        
        await db.run(
            'UPDATE users SET phone_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [user.id]
        );
        
        await db.run(
            'UPDATE phone_verification_codes SET verified = 1 WHERE id = ?',
            [verificationCode.id]
        );
        
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message) 
            VALUES (?, ?, ?, ?)`,
            [
                user.id,
                'phone_verified',
                'Телефон подтвержден',
                'Ваш номер телефона успешно подтвержден. Теперь вы можете пользоваться всеми функциями сервиса.'
            ]
        );
        
        const updatedUser = await db.get(
            `SELECT id, email, first_name, last_name, phone, phone_verified, role, 
                    subscription_plan, subscription_status, subscription_expires,
                    initial_fee_paid, initial_fee_amount, avatar_url, tasks_limit, tasks_used,
                    user_rating
             FROM users WHERE id = ?`,
            [user.id]
        );
        
        const userForResponse = {
            ...updatedUser,
            rating: updatedUser.user_rating
        };
        
        const token = jwt.sign(
            { 
                id: updatedUser.id, 
                phone: updatedUser.phone, 
                phone_verified: updatedUser.phone_verified,
                role: updatedUser.role,
                first_name: updatedUser.first_name,
                last_name: updatedUser.last_name,
                subscription_plan: updatedUser.subscription_plan,
                initial_fee_paid: updatedUser.initial_fee_paid
            },
            process.env.JWT_SECRET || 'concierge-secret-key-2024-prod',
            { expiresIn: '30d' }
        );
        
        const isNewRegistration = !user.last_login && user.subscription_status === 'pending';
        
        res.json({
            success: true,
            message: isNewRegistration ? 'Регистрация завершена! Теперь вы можете войти в систему.' : 'Телефон успешно подтвержден!',
            data: { 
                user: userForResponse,
                token,
                is_new_registration: isNewRegistration
            }
        });
        
    } catch (error) {
        console.error('Ошибка подтверждения телефона:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка подтверждения телефона'
        });
    }
});

// Вход - ОБНОВЛЕННАЯ ВЕРСИЯ
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, phone, password } = req.body;
        
        console.log('🔐 Попытка входа:', { email, phone });
        
        if ((!email && !phone) || !password) {
            return res.status(400).json({
                success: false,
                error: 'Укажите email или телефон и пароль'
            });
        }
        
        let user;
        let loginType = '';
        
        if (email && email.trim()) {
            // Поиск по email
            user = await db.get(
                `SELECT * FROM users WHERE email = ? AND is_active = 1`,
                [email.trim().toLowerCase()]
            );
            loginType = 'email';
        } else if (phone) {
            // Форматируем телефон для поиска
            const formattedPhone = formatPhone(phone);
            console.log(`📞 Поиск по телефону: ${phone} -> ${formattedPhone}`);
            
            if (!formattedPhone) {
                return res.status(400).json({
                    success: false,
                    error: 'Некорректный номер телефона'
                });
            }
            
            user = await db.get(
                `SELECT * FROM users WHERE phone = ? AND is_active = 1`,
                [formattedPhone]
            );
            loginType = 'phone';
        }
        
        if (!user) {
            console.log(`❌ Пользователь не найден (тип входа: ${loginType})`);
            return res.status(401).json({
                success: false,
                error: 'Пользователь не найден или учетная запись неактивна'
            });
        }
        
        console.log(`✅ Пользователь найден: ${user.email || user.phone}`);
        
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                error: 'Неверный пароль'
            });
        }
        
        if ((user.role === 'client' || user.role === 'performer') && !user.phone_verified) {
            const smsCode = generateVerificationCode();
            const expiresAt = new Date();
            expiresAt.setMinutes(expiresAt.getMinutes() + 10);
            
            await db.run(
                `INSERT INTO phone_verification_codes (phone, code, expires_at) 
                 VALUES (?, ?, ?)`,
                [user.phone, smsCode, expiresAt.toISOString()]
            );
            
            const smsResult = await sendSmsCode(user.phone, smsCode);
            
            return res.status(403).json({
                success: false,
                error: 'Требуется подтверждение телефона',
                requires_phone_verification: true,
                phone: user.phone,
                phone_verification_sent: smsResult.success,
                demo_mode: smsResult.demo || false,
                expires_in_minutes: 10
            });
        }
        
        if (user.role === 'client' && user.subscription_status === 'pending' && user.initial_fee_paid === 0 && !DEMO_MODE) {
            return res.status(403).json({
                success: false,
                error: 'Для входа необходимо оплатить вступительный взнос',
                requires_initial_fee: true,
                initial_fee_amount: user.initial_fee_amount,
                user: {
                    id: user.id,
                    phone: user.phone,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    subscription_plan: user.subscription_plan,
                    subscription_status: user.subscription_status
                }
            });
        }
        
        await db.run(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
            [user.id]
        );
        
        const userForResponse = {
            id: user.id,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            phone: user.phone,
            phone_verified: user.phone_verified,
            role: user.role,
            subscription_plan: user.subscription_plan,
            subscription_status: user.subscription_status,
            subscription_expires: user.subscription_expires,
            avatar_url: user.avatar_url,
            balance: user.balance,
            initial_fee_paid: user.initial_fee_paid,
            initial_fee_amount: user.initial_fee_amount,
            rating: user.user_rating,
            completed_tasks: user.completed_tasks,
            tasks_limit: user.tasks_limit,
            tasks_used: user.tasks_used,
            total_spent: user.total_spent,
            last_login: user.last_login,
            email_verified: user.email_verified
        };
        
        const token = jwt.sign(
            { 
                id: user.id, 
                phone: user.phone, 
                phone_verified: user.phone_verified,
                role: user.role,
                first_name: user.first_name,
                last_name: user.last_name,
                subscription_plan: user.subscription_plan,
                initial_fee_paid: user.initial_fee_paid
            },
            process.env.JWT_SECRET || 'concierge-secret-key-2024-prod',
            { expiresIn: '30d' }
        );
        
        console.log('Успешный вход пользователя:', user.phone);
        
        if (user.role === 'client' && user.subscription_status === 'active' && user.subscription_expires) {
            const expiryDate = new Date(user.subscription_expires);
            const daysRemaining = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
            
            if (daysRemaining <= 7) {
                console.log(`Подписка пользователя ${user.phone} истекает через ${daysRemaining} дней`);
            }
        }
        
        res.json({
            success: true,
            message: 'Вход выполнен успешно!',
            data: { 
                user: userForResponse,
                token 
            }
        });
        
    } catch (error) {
        console.error('Ошибка входа:', error.message);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера при входе'
        });
    }
});

// Проверка токена
app.get('/api/auth/check', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'Требуется авторизация'
            });
        }
        
        const token = authHeader.replace('Bearer ', '').trim();
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'concierge-secret-key-2024-prod');
        
        const user = await db.get(
            `SELECT id, email, first_name, last_name, phone, phone_verified, role, 
                    subscription_plan, subscription_status, subscription_expires,
                    initial_fee_paid, initial_fee_amount, is_active, avatar_url,
                    balance, user_rating, completed_tasks, tasks_limit, tasks_used,
                    total_spent, last_login, email_verified
             FROM users WHERE id = ? AND is_active = 1`,
            [decoded.id]
        );
        
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        const userForResponse = {
            ...user,
            rating: user.user_rating
        };
        
        res.json({
            success: true,
            data: { user: userForResponse }
        });
        
    } catch (error) {
        console.error('Ошибка проверки токена:', error.message);
        res.status(401).json({
            success: false,
            error: 'Неверный токен'
        });
    }
});

// Информация о подписке
app.get('/api/auth/subscription-info', authMiddleware(), async (req, res) => {
    try {
        const user = req.user;
        
        if (!user.subscription_expires) {
            return res.json({
                success: true,
                data: {
                    subscription_status: user.subscription_status,
                    subscription_expires: null,
                    days_remaining: 0,
                    next_charge_date: null
                }
            });
        }
        
        const expiryDate = new Date(user.subscription_expires);
        const now = new Date();
        const daysRemaining = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
        
        const nextChargeDate = new Date(expiryDate);
        nextChargeDate.setDate(nextChargeDate.getDate() + 30);
        
        res.json({
            success: true,
            data: {
                subscription_status: user.subscription_status,
                subscription_expires: user.subscription_expires,
                days_remaining: daysRemaining > 0 ? daysRemaining : 0,
                next_charge_date: nextChargeDate.toISOString().split('T')[0]
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения информации о подписке:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения информации о подписке'
        });
    }
});

// Профиль пользователя
app.get('/api/auth/profile', authMiddleware(), async (req, res) => {
    try {
        const user = await db.get(
            `SELECT id, email, first_name, last_name, phone, phone_verified, role, 
                    subscription_plan, subscription_status, subscription_expires,
                    avatar_url, balance, 
                    initial_fee_paid, initial_fee_amount, user_rating, completed_tasks,
                    tasks_limit, tasks_used, total_spent, is_active, 
                    last_login, email_verified, created_at, updated_at 
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        const subscription = await db.get(
            'SELECT * FROM subscriptions WHERE name = ?',
            [user.subscription_plan || 'essential']
        );
        
        const stats = await db.get(`
            SELECT 
                COUNT(*) as total_tasks,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
                SUM(CASE WHEN status IN ('new', 'searching', 'assigned', 'in_progress') THEN 1 ELSE 0 END) as active_tasks
            FROM tasks 
            WHERE client_id = ?
        `, [req.user.id]);
        
        let performerStats = null;
        if (req.user.role === 'performer') {
            performerStats = await db.get(`
                SELECT 
                    COUNT(*) as tasks_taken,
                    AVG(r.rating) as avg_rating,
                    SUM(t.price) as total_earned
                FROM tasks t
                LEFT JOIN reviews r ON t.id = r.task_id
                WHERE t.performer_id = ? AND t.status = 'completed'
            `, [req.user.id]);
        }
        
        const unreadNotifications = await db.get(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
            [req.user.id]
        );
        
        const userForResponse = {
            ...user,
            rating: user.user_rating
        };
        
        res.json({
            success: true,
            data: { 
                user: userForResponse,
                subscription: subscription || null,
                stats: {
                    total_tasks: stats?.total_tasks || 0,
                    completed_tasks: stats?.completed_tasks || 0,
                    active_tasks: stats?.active_tasks || 0,
                    tasks_remaining: user.tasks_limit - user.tasks_used,
                    tasks_limit: user.tasks_limit,
                    tasks_used: user.tasks_used,
                    performer_stats: performerStats,
                    unread_notifications: unreadNotifications?.count || 0
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения профиля:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения профиля'
        });
    }
});

// Обновление профиля
app.put('/api/auth/profile', authMiddleware(), async (req, res) => {
    try {
        const { first_name, last_name, email, avatar_url } = req.body;
        
        if (email && email.trim() && !validateEmail(email)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный email адрес'
            });
        }
        
        const updateFields = [];
        const updateValues = [];
        
        if (first_name !== undefined) {
            updateFields.push('first_name = ?');
            updateValues.push(first_name);
        }
        
        if (last_name !== undefined) {
            updateFields.push('last_name = ?');
            updateValues.push(last_name);
        }
        
        if (email !== undefined) {
            if (email && email.trim()) {
                const existingUser = await db.get(
                    'SELECT id FROM users WHERE email = ? AND id != ?',
                    [email, req.user.id]
                );
                if (existingUser) {
                    return res.status(409).json({
                        success: false,
                        error: 'Этот email уже используется другим пользователем'
                    });
                }
            }
            updateFields.push('email = ?');
            updateValues.push(email || null);
        }
        
        if (avatar_url !== undefined) {
            updateFields.push('avatar_url = ?');
            updateValues.push(avatar_url);
        }
        
        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Нет данных для обновления'
            });
        }
        
        updateFields.push('updated_at = CURRENT_TIMESTAMP');
        updateValues.push(req.user.id);
        
        const query = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`;
        
        await db.run(query, updateValues);
        
        const user = await db.get(
            `SELECT id, email, first_name, last_name, phone, phone_verified, role, 
                    subscription_plan, subscription_status, avatar_url,
                    user_rating
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        
        const userForResponse = {
            ...user,
            rating: user.user_rating
        };
        
        res.json({
            success: true,
            message: 'Профиль успешно обновлен',
            data: { user: userForResponse }
        });
        
    } catch (error) {
        console.error('Ошибка обновления профиля:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления профиля'
        });
    }
});

// Смена пароля
app.put('/api/auth/change-password', authMiddleware(), async (req, res) => {
    try {
        const { current_password, new_password } = req.body;
        
        if (!current_password || !new_password) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все поля'
            });
        }
        
        if (new_password.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'Новый пароль должен содержать не менее 6 символов'
            });
        }
        
        const user = await db.get('SELECT password FROM users WHERE id = ?', [req.user.id]);
        
        const isPasswordValid = await bcrypt.compare(current_password, user.password);
        if (!isPasswordValid) {
            return res.status(400).json({
                success: false,
                error: 'Текущий пароль неверен'
            });
        }
        
        const hashedPassword = await bcrypt.hash(new_password, 12);
        
        await db.run(
            'UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [hashedPassword, req.user.id]
        );
        
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message) 
            VALUES (?, ?, ?, ?)`,
            [
                req.user.id,
                'password_changed',
                'Пароль изменен',
                'Ваш пароль был успешно изменен. Если это были не вы, свяжитесь со службой поддержки.'
            ]
        );
        
        res.json({
            success: true,
            message: 'Пароль успешно изменен'
        });
        
    } catch (error) {
        console.error('Ошибка смены пароля:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка смены пароля'
        });
    }
});

// Восстановление пароля
app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { phone } = req.body;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Не указан номер телефона'
            });
        }
        
        const formattedPhone = formatPhone(phone);
        
        const user = await db.get('SELECT id, first_name FROM users WHERE phone = ? AND is_active = 1', [formattedPhone]);
        if (!user) {
            return res.json({
                success: true,
                message: 'Если пользователь с таким телефоном существует, ему будет отправлен код восстановления'
            });
        }
        
        const resetCode = generateVerificationCode();
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 1);
        
        await db.run(
            `INSERT INTO phone_verification_codes (phone, code, expires_at) 
             VALUES (?, ?, ?)`,
            [formattedPhone, resetCode, expiresAt.toISOString()]
        );
        
        const smsResult = await sendSmsCode(formattedPhone, `Код восстановления пароля: ${resetCode}`);
        
        if (!smsResult.success) {
            return res.status(500).json({
                success: false,
                error: 'Ошибка отправки SMS',
                demo_mode: DEMO_MODE
            });
        }
        
        res.json({
            success: true,
            message: 'Код восстановления отправлен',
            data: {
                phone: formattedPhone,
                demo_mode: smsResult.demo || false,
                expires_in_minutes: 60
            }
        });
        
    } catch (error) {
        console.error('Ошибка восстановления пароля:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка восстановления пароля'
        });
    }
});

// Сброс пароля с кодом подтверждения
app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { phone, code, new_password } = req.body;
        
        if (!phone || !code || !new_password) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все поля'
            });
        }
        
        if (new_password.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'Пароль должен содержать не менее 6 символов'
            });
        }
        
        const formattedPhone = formatPhone(phone);
        
        const user = await db.get('SELECT id FROM users WHERE phone = ? AND is_active = 1', [formattedPhone]);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        const resetCode = await db.get(
            `SELECT * FROM phone_verification_codes 
             WHERE phone = ? AND code = ? AND verified = 0 
             ORDER BY created_at DESC LIMIT 1`,
            [formattedPhone, code]
        );
        
        if (!resetCode) {
            return res.status(400).json({
                success: false,
                error: 'Неверный код восстановления'
            });
        }
        
        if (isCodeExpired(resetCode.expires_at)) {
            return res.status(400).json({
                success: false,
                error: 'Срок действия кода истек'
            });
        }
        
        const hashedPassword = await bcrypt.hash(new_password, 12);
        
        await db.run(
            'UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [hashedPassword, user.id]
        );
        
        await db.run(
            'UPDATE phone_verification_codes SET verified = 1 WHERE id = ?',
            [resetCode.id]
        );
        
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message) 
            VALUES (?, ?, ?, ?)`,
            [
                user.id,
                'password_reset',
                'Пароль изменен',
                'Ваш пароль был успешно изменен через восстановление.'
            ]
        );
        
        res.json({
            success: true,
            message: 'Пароль успешно изменен'
        });
        
    } catch (error) {
        console.error('Ошибка сброса пароля:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка сброса пароля'
        });
    }
});

// Удаление аккаунта
app.delete('/api/auth/account', authMiddleware(), async (req, res) => {
    try {
        const { password } = req.body;
        
        if (!password) {
            return res.status(400).json({
                success: false,
                error: 'Введите пароль для подтверждения'
            });
        }
        
        const user = await db.get('SELECT password FROM users WHERE id = ?', [req.user.id]);
        
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(400).json({
                success: false,
                error: 'Неверный пароль'
            });
        }
        
        await db.run(
            'UPDATE users SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [req.user.id]
        );
        
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message) 
            VALUES (?, ?, ?, ?)`,
            [
                req.user.id,
                'account_deactivated',
                'Аккаунт деактивирован',
                'Ваш аккаунт был деактивирован. Вы можете восстановить его в течение 30 дней, обратившись в поддержку.'
            ]
        );
        
        res.json({
            success: true,
            message: 'Аккаунт успешно деактивирован'
        });
        
    } catch (error) {
        console.error('Ошибка деактивации аккаунта:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка деактивации аккаунта'
        });
    }
});

// ==================== КАТЕГОРИИ И УСЛУГИ ====================

app.get('/api/categories', async (req, res) => {
    try {
        const categories = await db.all(
            `SELECT c.*, 
                    COUNT(s.id) as services_count
             FROM categories c
             LEFT JOIN services s ON c.id = s.category_id AND s.is_active = 1
             WHERE c.is_active = 1
             GROUP BY c.id
             ORDER BY c.sort_order ASC`
        );
        
        // Добавляем URL для изображений по умолчанию, если их нет
        const processedCategories = categories.map(cat => {
            if (!cat.image_url && cat.name === 'home_and_household') {
                cat.image_url = 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=400&h=200&fit=crop';
            } else if (!cat.image_url && cat.name === 'family_and_children') {
                cat.image_url = 'https://images.unsplash.com/photo-1511895426328-dc8714191300?w=400&h=200&fit=crop';
            }
            // Добавьте остальные категории по аналогии...
            
            return cat;
        });
        
        res.json({
            success: true,
            data: {
                categories: processedCategories,
                count: categories.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения категорий:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения категорий'
        });
    }
});

// Получение услуг категории
app.get('/api/categories/:id/services', async (req, res) => {
    const categoryId = req.params.id;
    
    try {
        if (!categoryId) {
            return res.status(400).json({
                success: false,
                error: 'Не указан ID категории'
            });
        }
        
        const category = await db.get(
            'SELECT * FROM categories WHERE id = ? AND is_active = 1',
            [categoryId]
        );
        
        if (!category) {
            return res.status(404).json({
                success: false,
                error: 'Категория не найдена'
            });
        }
        
        const services = await db.all(
            `SELECT s.* 
             FROM services s
             WHERE s.category_id = ? AND s.is_active = 1
             ORDER BY s.sort_order ASC, s.name ASC`,
            [categoryId]
        );
        
        res.json({
            success: true,
            data: {
                category,
                services,
                count: services.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения услуг категории:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения услуг категории'
        });
    }
});

// ==================== FAQ ====================
app.get('/api/faq', async (req, res) => {
    try {
        const faq = await db.all(
            'SELECT * FROM faq WHERE is_active = 1 ORDER BY sort_order ASC, category ASC'
        );
        
        res.json({
            success: true,
            data: { faq }
        });
    } catch (error) {
        console.error('Ошибка получения FAQ:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения FAQ'
        });
    }
});

// ==================== ОТЗЫВЫ ====================
app.get('/api/reviews', async (req, res) => {
    try {
        const { featured, limit = 10 } = req.query;
        
        let query = `
            SELECT r.*, 
                   u1.first_name as client_first_name,
                   u1.last_name as client_last_name,
                   u2.first_name as performer_first_name,
                   u2.last_name as performer_last_name,
                   t.title as task_title
            FROM reviews r
            LEFT JOIN users u1 ON r.client_id = u1.id
            LEFT JOIN users u2 ON r.performer_id = u2.id
            LEFT JOIN tasks t ON r.task_id = t.id
            WHERE r.admin_approved = 1
        `;
        
        const params = [];
        
        if (featured === 'true') {
            query += ' AND r.is_featured = 1';
        }
        
        query += ' ORDER BY r.created_at DESC LIMIT ?';
        params.push(parseInt(limit));
        
        const reviews = await db.all(query, params);
        
        const processedReviews = reviews.map(review => {
            if (review.is_anonymous) {
                review.client_first_name = 'Аноним';
                review.client_last_name = '';
            }
            return review;
        });
        
        res.json({
            success: true,
            data: {
                reviews: processedReviews,
                count: reviews.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения отзывов:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения отзывов'
        });
    }
});

// ==================== ПОДПИСКИ ====================

// Получение всех подписок
app.get('/api/subscriptions', async (req, res) => {
    try {
        const subscriptions = await db.all(
            'SELECT * FROM subscriptions WHERE is_active = 1 ORDER BY sort_order ASC, price_monthly ASC'
        );
        
        const subscriptionsWithParsedFeatures = subscriptions.map(sub => ({
            ...sub,
            features: typeof sub.features === 'string' ? JSON.parse(sub.features) : sub.features
        }));
        
        res.json({
            success: true,
            data: {
                subscriptions: subscriptionsWithParsedFeatures,
                count: subscriptions.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения подписок:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения подписок'
        });
    }
});

// Оплата вступительного взноса и активация подписки
app.post('/api/subscriptions/subscribe', authMiddleware(['client']), async (req, res) => {
    try {
        const { plan } = req.body;
        
        if (!plan) {
            return res.status(400).json({
                success: false,
                error: 'Не указан тарифный план'
            });
        }
        
        if (!req.user.phone_verified) {
            return res.status(403).json({
                success: false,
                error: 'Для активации подписки необходимо подтвердить телефон',
                requires_phone_verification: true,
                user_phone: req.user.phone,
                user_id: req.user.id
            });
        }
        
        const subscription = await db.get(
            'SELECT * FROM subscriptions WHERE name = ? AND is_active = 1',
            [plan]
        );
        
        if (!subscription) {
            return res.status(404).json({
                success: false,
                error: 'Тарифный план не найден'
            });
        }
        
        if (DEMO_MODE && subscription.initial_fee > 0 && !req.user.initial_fee_paid) {
            console.log(`📱 [DEMO MODE] Автоматическая активация подписки для пользователя: ${req.user.phone}`);
            
            await db.run(
                `UPDATE users SET 
                    subscription_plan = ?,
                    subscription_status = 'active',
                    initial_fee_paid = 1,
                    initial_fee_amount = ?,
                    tasks_limit = ?,
                    subscription_expires = DATE('now', '+30 days')
                 WHERE id = ?`,
                [plan, subscription.initial_fee, subscription.tasks_limit, req.user.id]
            );
            
            await db.run(
                `INSERT INTO notifications 
                (user_id, type, title, message) 
                VALUES (?, ?, ?, ?)`,
                [
                    req.user.id,
                    'subscription_activated',
                    'Подписка активирована!',
                    `Поздравляем! Вы успешно активировали подписку "${subscription.display_name}". Теперь вы можете создавать задачи.`
                ]
            );
            
            const updatedUser = await db.get(
                `SELECT id, email, first_name, last_name, phone, phone_verified, role, 
                        subscription_plan, subscription_status, subscription_expires,
                        initial_fee_paid, initial_fee_amount, balance, tasks_limit, tasks_used,
                        user_rating
                 FROM users WHERE id = ?`,
                [req.user.id]
            );
            
            const userForResponse = {
                ...updatedUser,
                rating: updatedUser.user_rating
            };
            
            return res.json({
                success: true,
                message: 'Подписка успешно активирована! (Демо-режим)',
                data: {
                    user: userForResponse,
                    subscription,
                    demo_mode: true
                }
            });
        }
        
        if (subscription.initial_fee > 0 && !req.user.initial_fee_paid) {
            if (req.user.balance < subscription.initial_fee) {
                return res.status(400).json({
                    success: false,
                    error: 'Недостаточно средств для оплаты вступительного взноса',
                    requires_initial_fee: true,
                    initial_fee_amount: subscription.initial_fee,
                    current_balance: req.user.balance
                });
            }
            
            await db.run(
                'UPDATE users SET balance = balance - ? WHERE id = ?',
                [subscription.initial_fee, req.user.id]
            );
            
            await db.run(
                `INSERT INTO transactions 
                (user_id, type, amount, description, status) 
                VALUES (?, ?, ?, ?, ?)`,
                [
                    req.user.id,
                    'initial_fee',
                    -subscription.initial_fee,
                    `Вступительный взнос: ${subscription.display_name}`,
                    'completed'
                ]
            );
            
            await db.run(
                'UPDATE users SET total_spent = total_spent + ? WHERE id = ?',
                [subscription.initial_fee, req.user.id]
            );
            
            await db.run(
                `UPDATE users SET 
                    subscription_plan = ?,
                    subscription_status = 'active',
                    initial_fee_paid = 1,
                    initial_fee_amount = ?,
                    tasks_limit = ?,
                    subscription_expires = DATE('now', '+30 days')
                 WHERE id = ?`,
                [plan, subscription.initial_fee, subscription.tasks_limit, req.user.id]
            );
        } else {
            await db.run(
                `UPDATE users SET 
                    subscription_plan = ?,
                    subscription_status = 'active',
                    tasks_limit = ?,
                    subscription_expires = DATE('now', '+30 days')
                 WHERE id = ?`,
                [plan, subscription.tasks_limit, req.user.id]
            );
        }
        
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message) 
            VALUES (?, ?, ?, ?)`,
            [
                req.user.id,
                'subscription_activated',
                'Подписка активирована!',
                `Поздравляем! Вы успешно активировали подписку "${subscription.display_name}". Теперь вы можете создавать задачи.`
            ]
        );
        
        const updatedUser = await db.get(
            `SELECT id, email, first_name, last_name, phone, phone_verified, role, 
                    subscription_plan, subscription_status, subscription_expires,
                    initial_fee_paid, initial_fee_amount, balance, tasks_limit, tasks_used,
                    user_rating
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        
        const userForResponse = {
            ...updatedUser,
            rating: updatedUser.user_rating
        };
        
        res.json({
            success: true,
            message: 'Подписка успешно активирована!',
            data: {
                user: userForResponse,
                subscription,
                demo_mode: DEMO_MODE
            }
        });
        
    } catch (error) {
        console.error('Ошибка активации подписки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка активации подписки'
        });
    }
});

// ==================== ЗАДАЧИ ====================

// Создание задачи - ОБНОВЛЕННАЯ ВЕРСИЯ
app.post('/api/tasks', authMiddleware(['client', 'admin', 'superadmin']), async (req, res) => {
    try {
        const { 
            title, 
            description, 
            category_id, 
            service_id,
            priority = 'medium', 
            deadline, 
            address, 
            contact_info,
            additional_requirements
        } = req.body;
        
        console.log('Создание новой задачи:', { 
            title, 
            category_id, 
            client_id: req.user.id,
            status: 'searching' 
        });
        
        if (!title || !description || !category_id || !deadline || !address || !contact_info) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля'
            });
        }
        
        const category = await db.get(
            'SELECT * FROM categories WHERE id = ? AND is_active = 1',
            [category_id]
        );
        
        if (!category) {
            return res.status(404).json({
                success: false,
                error: 'Категория не найдена'
            });
        }
        
        if (req.user.role === 'client') {
            const user = await db.get(
                'SELECT subscription_status, initial_fee_paid, tasks_limit, tasks_used, phone_verified FROM users WHERE id = ?',
                [req.user.id]
            );
            
            if (!user) {
                return res.status(403).json({
                    success: false,
                    error: 'Пользователь не найден'
                });
            }
            
            if (!user.phone_verified) {
                return res.status(403).json({
                    success: false,
                    error: 'Для создания задач необходимо подтвердить телефон'
                });
            }
            
            if (user.subscription_status !== 'active' && !DEMO_MODE) {
                return res.status(403).json({
                    success: false,
                    error: 'Ваша подписка не активна'
                });
            }
            
            if (!user.initial_fee_paid && !DEMO_MODE) {
                return res.status(403).json({
                    success: false,
                    error: 'Для создания задач необходимо оплатить вступительный взнос'
                });
            }
            
            if (user.tasks_used >= user.tasks_limit) {
                return res.status(403).json({
                    success: false,
                    error: 'Превышен лимит задач по вашей подписке',
                    tasks_limit: user.tasks_limit,
                    tasks_used: user.tasks_used
                });
            }
        }
        
        const deadlineDate = new Date(deadline);
        if (deadlineDate < new Date()) {
            return res.status(400).json({
                success: false,
                error: 'Дата дедлайна не может быть в прошлом'
            });
        }
        
        const finalPrice = 0; // Включено в подписку
        const taskNumber = generateTaskNumber();
        
        // Статус должен быть 'searching' (в поиске исполнителя)
        const taskStatus = 'searching';
        
        const result = await db.run(
            `INSERT INTO tasks 
            (task_number, title, description, client_id, category_id, service_id, 
             priority, price, address, deadline, contact_info, additional_requirements, status) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                taskNumber,
                title,
                description,
                req.user.id,
                category_id,
                service_id || null,
                priority,
                finalPrice,
                address,
                deadline,
                contact_info,
                additional_requirements || null,
                taskStatus  // Явно указываем статус
            ]
        );
        
        const taskId = result.lastID;
        
        if (req.user.role === 'client') {
            await db.run(
                'UPDATE users SET tasks_used = tasks_used + 1 WHERE id = ?',
                [req.user.id]
            );
        }
        
        // Записываем историю статусов
        await db.run(
            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
             VALUES (?, ?, ?, ?)`,
            [taskId, taskStatus, req.user.id, 'Задача создана и опубликована для исполнителей']
        );
        
        // Отправляем уведомление клиенту
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message, related_id, related_type) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                req.user.id,
                'task_created',
                'Задача создана',
                `Задача "${title}" успешно создана. Ожидайте назначения исполнителя.`,
                taskId,
                'task'
            ]
        );
        
        // Ищем исполнителей по категории и отправляем им уведомления
        console.log(`🔍 Поиск исполнителей для категории ${category_id}...`);
        
        const performers = await db.all(
            `SELECT DISTINCT u.id, u.first_name, u.last_name, u.phone, u.avatar_url, u.user_rating
             FROM users u
             JOIN performer_categories pc ON u.id = pc.performer_id
             WHERE u.role = 'performer' 
               AND u.is_active = 1
               AND u.phone_verified = 1
               AND pc.category_id = ?
               AND pc.is_active = 1
             ORDER BY u.user_rating DESC`,
            [category_id]
        );
        
        console.log(`✅ Найдено исполнителей: ${performers.length}`);
        
        for (const performer of performers) {
            try {
                await db.run(
                    `INSERT INTO notifications 
                    (user_id, type, title, message, related_id, related_type) 
                    VALUES (?, ?, ?, ?, ?, ?)`,
                    [
                        performer.id,
                        'new_task_available',
                        'Новая задача доступна',
                        `Доступна новая задача в категории "${category.display_name}". 
                         Название: "${title}"`,
                        taskId,
                        'task'
                    ]
                );
                console.log(`📧 Уведомление отправлено исполнителю: ${performer.first_name} (ID: ${performer.id})`);
            } catch (error) {
                console.warn(`Ошибка отправки уведомления исполнителю ${performer.id}:`, error.message);
            }
        }
        
        // Получаем созданную задачу с информацией о категории
        const task = await db.get(
            `SELECT t.*, c.display_name as category_name
             FROM tasks t 
             LEFT JOIN categories c ON t.category_id = c.id 
             WHERE t.id = ?`,
            [taskId]
        );
        
        // Получаем обновленные данные пользователя
        const updatedUser = await db.get(
            `SELECT tasks_limit, tasks_used FROM users WHERE id = ?`,
            [req.user.id]
        );
        
        res.status(201).json({
            success: true,
            message: 'Задача успешно создана и опубликована для исполнителей!',
            data: { 
                task,
                user: updatedUser,
                tasks_used: updatedUser?.tasks_used || 0,
                tasks_remaining: (updatedUser?.tasks_limit || 0) - (updatedUser?.tasks_used || 0),
                available_performers: performers.length,
                demo_mode: DEMO_MODE
            }
        });
        
    } catch (error) {
        console.error('🔥 Ошибка создания задачи:', error.message);
        console.error('Stack:', error.stack);
        
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера при создании задачи',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Получение задач пользователя
app.get('/api/tasks', authMiddleware(), async (req, res) => {
    try {
        const { status, category_id, limit = 50, offset = 0, date_filter } = req.query;
        
        let query = `
            SELECT t.*, 
                   c.display_name as category_name,
                   c.icon as category_icon,
                   s.name as service_name,
                   u1.first_name as client_first_name, 
                   u1.last_name as client_last_name,
                   u2.first_name as performer_first_name,
                   u2.last_name as performer_last_name,
                   u2.user_rating as performer_rating
            FROM tasks t
            LEFT JOIN categories c ON t.category_id = c.id
            LEFT JOIN services s ON t.service_id = s.id
            LEFT JOIN users u1 ON t.client_id = u1.id
            LEFT JOIN users u2 ON t.performer_id = u2.id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (req.user.role === 'client') {
            query += ' AND t.client_id = ?';
            params.push(req.user.id);
        } else if (req.user.role === 'performer') {
            query += ' AND (t.performer_id = ? OR t.status = "searching")';
            params.push(req.user.id);
        }
        
        if (status && status !== 'all') {
            query += ' AND t.status = ?';
            params.push(status);
        }
        
        if (category_id && category_id !== 'all') {
            query += ' AND t.category_id = ?';
            params.push(category_id);
        }
        
        if (date_filter) {
            const now = new Date();
            let startDate;
            
            switch(date_filter) {
                case 'today':
                    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    query += ' AND t.created_at >= ?';
                    params.push(startDate.toISOString());
                    break;
                case 'week':
                    startDate = new Date(now);
                    startDate.setDate(now.getDate() - 7);
                    query += ' AND t.created_at >= ?';
                    params.push(startDate.toISOString());
                    break;
                case 'month':
                    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                    query += ' AND t.created_at >= ?';
                    params.push(startDate.toISOString());
                    break;
            }
        }
        
        query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const tasks = await db.all(query, params);
        
        if (req.user.role === 'performer') {
            for (const task of tasks) {
                if (task.status === 'searching') {
                    const canTake = await db.get(
                        `SELECT 1 FROM performer_categories 
                         WHERE performer_id = ? AND category_id = ? AND is_active = 1`,
                        [req.user.id, task.category_id]
                    );
                    task.can_take = canTake ? true : false;
                }
            }
        }
        
        let countQuery = `SELECT COUNT(*) as total FROM tasks WHERE 1=1`;
        let countParams = [];
        
        if (req.user.role === 'client') {
            countQuery += ' AND client_id = ?';
            countParams.push(req.user.id);
        } else if (req.user.role === 'performer') {
            countQuery += ' AND (performer_id = ? OR status = "searching")';
            countParams.push(req.user.id);
        }
        
        if (status && status !== 'all') {
            countQuery += ' AND status = ?';
            countParams.push(status);
        }
        
        const countResult = await db.get(countQuery, countParams);
        
        res.json({
            success: true,
            data: {
                tasks,
                pagination: {
                    total: countResult?.total || 0,
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    pages: Math.ceil((countResult?.total || 0) / parseInt(limit))
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения задач:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения задач'
        });
    }
});

// Получение деталей задачи
app.get('/api/tasks/:id', authMiddleware(), async (req, res) => {
    const taskId = req.params.id;
    
    try {
        const task = await db.get(
            `SELECT t.*, 
                    c.display_name as category_name,
                    c.icon as category_icon,
                    s.name as service_name,
                    s.description as service_description,
                    u1.first_name as client_first_name, 
                    u1.last_name as client_last_name, 
                    u1.phone as client_phone,
                    u1.avatar_url as client_avatar,
                    u1.user_rating as client_rating,
                    u2.first_name as performer_first_name,
                    u2.last_name as performer_last_name,
                    u2.phone as performer_phone,
                    u2.avatar_url as performer_avatar,
                    u2.user_rating as performer_rating
             FROM tasks t
             LEFT JOIN categories c ON t.category_id = c.id
             LEFT JOIN services s ON t.service_id = s.id
             LEFT JOIN users u1 ON t.client_id = u1.id
             LEFT JOIN users u2 ON t.performer_id = u2.id
             WHERE t.id = ?`,
            [taskId]
        );
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        if (req.user.id !== task.client_id && 
            req.user.id !== task.performer_id && 
            !['admin', 'manager', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'Нет доступа к этой задаче'
            });
        }
        
        if (req.user.role === 'performer' && task.status === 'searching') {
            const canTake = await db.get(
                `SELECT 1 FROM performer_categories 
                 WHERE performer_id = ? AND category_id = ? AND is_active = 1`,
                [req.user.id, task.category_id]
            );
            task.can_take = canTake ? true : false;
        }
        
        const statusHistory = await db.all(
            `SELECT tsh.*, u.first_name, u.last_name
             FROM task_status_history tsh
             LEFT JOIN users u ON tsh.changed_by = u.id
             WHERE tsh.task_id = ?
             ORDER BY tsh.created_at ASC`,
            [taskId]
        );
        
        const messagesCount = await db.get(
            'SELECT COUNT(*) as count FROM task_messages WHERE task_id = ?',
            [taskId]
        );
        
        res.json({
            success: true,
            data: {
                task: {
                    ...task,
                    status_history: statusHistory,
                    messages_count: messagesCount?.count || 0
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения задачи:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения задачи'
        });
    }
});

// Изменение статуса задачи
app.put('/api/tasks/:id/status', authMiddleware(), async (req, res) => {
    const taskId = req.params.id;
    
    try {
        const { status, notes, performer_id } = req.body;
        
        if (!status) {
            return res.status(400).json({
                success: false,
                error: 'Не указан новый статус'
            });
        }
        
        const task = await db.get(
            'SELECT * FROM tasks WHERE id = ?',
            [taskId]
        );
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        let canChangeStatus = false;
        const isAdmin = ['admin', 'manager', 'superadmin'].includes(req.user.role);
        
        if (isAdmin) {
            canChangeStatus = true;
        } else if (req.user.id === task.client_id) {
            canChangeStatus = ['cancelled', 'completed'].includes(status);
        } else if (req.user.id === task.performer_id) {
            canChangeStatus = ['in_progress', 'completed'].includes(status);
        }
        
        if (!canChangeStatus) {
            return res.status(403).json({
                success: false,
                error: 'Нет прав для изменения статуса'
            });
        }
        
        const updateData = { status };
        if (status === 'assigned' && performer_id) {
            updateData.performer_id = performer_id;
        }
        if (status === 'completed') {
            updateData.completed_at = new Date().toISOString();
            
            if (task.performer_id) {
                await db.run(
                    `UPDATE users SET 
                        completed_tasks = completed_tasks + 1,
                        updated_at = CURRENT_TIMESTAMP 
                     WHERE id = ?`,
                    [task.performer_id]
                );
            }
        }
        
        const updateFields = Object.keys(updateData).map(key => `${key} = ?`).join(', ');
        const updateValues = [...Object.values(updateData), taskId];
        
        await db.run(
            `UPDATE tasks SET ${updateFields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            updateValues
        );
        
        await db.run(
            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
             VALUES (?, ?, ?, ?)`,
            [taskId, status, req.user.id, notes || `Статус изменен`]
        );
        
        if (status === 'assigned' && performer_id) {
            await db.run(
                `INSERT INTO notifications 
                (user_id, type, title, message, related_id, related_type) 
                VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    performer_id,
                    'task_assigned',
                    'Задача назначена вам',
                    `Вам назначена задача "${task.title}"`,
                    taskId,
                    'task'
                ]
            );
            
            await db.run(
                `INSERT INTO notifications 
                (user_id, type, title, message, related_id, related_type) 
                VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    task.client_id,
                    'task_performer_assigned',
                    'Исполнитель назначен',
                    `Исполнитель назначен на задачу "${task.title}"`,
                    taskId,
                    'task'
                ]
            );
        } else if (status === 'in_progress') {
            await db.run(
                `INSERT INTO notifications 
                (user_id, type, title, message, related_id, related_type) 
                VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    task.client_id,
                    'task_in_progress',
                    'Задача в работе',
                    `Исполнитель начал выполнение задачи "${task.title}"`,
                    taskId,
                    'task'
                ]
            );
        } else if (status === 'completed') {
            await db.run(
                `INSERT INTO notifications 
                (user_id, type, title, message, related_id, related_type) 
                VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    task.client_id,
                    'task_completed',
                    'Задача завершена',
                    `Задача "${task.title}" завершена. Пожалуйста, оцените работу.`,
                    taskId,
                    'task'
                ]
            );
        } else if (status === 'cancelled') {
            const participants = [task.client_id];
            if (task.performer_id) {
                participants.push(task.performer_id);
            }
            
            for (const participantId of participants) {
                await db.run(
                    `INSERT INTO notifications 
                    (user_id, type, title, message, related_id, related_type) 
                    VALUES (?, ?, ?, ?, ?, ?)`,
                    [
                        participantId,
                        'task_cancelled',
                        'Задача отменена',
                        `Задача "${task.title}" была отменена.`,
                        taskId,
                        'task'
                    ]
                );
            }
        }
        
        res.json({
            success: true,
            message: 'Статус задачи изменен',
            data: { 
                task_id: taskId,
                new_status: status
            }
        });
        
    } catch (error) {
        console.error('Ошибка изменения статуса:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка изменения статуса задачи'
        });
    }
});

// Отмена задачи
app.post('/api/tasks/:id/cancel', authMiddleware(), async (req, res) => {
    const taskId = req.params.id;
    
    try {
        const { reason } = req.body;
        
        const task = await db.get(
            'SELECT * FROM tasks WHERE id = ?',
            [taskId]
        );
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        const canCancel = 
            ['admin', 'manager', 'superadmin'].includes(req.user.role) ||
            (req.user.id === task.client_id && ['new', 'searching', 'assigned'].includes(task.status));
        
        if (!canCancel) {
            return res.status(403).json({
                success: false,
                error: 'Нет прав для отмены задачи'
            });
        }
        
        if (req.user.id === task.client_id && task.status !== 'completed') {
            await db.run(
                'UPDATE users SET tasks_used = tasks_used - 1 WHERE id = ?',
                [task.client_id]
            );
        }
        
        await db.run(
            `UPDATE tasks SET 
                status = 'cancelled', 
                cancellation_reason = ?, 
                cancellation_by = ?,
                updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [reason || 'Отменена пользователем', req.user.id, taskId]
        );
        
        await db.run(
            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
             VALUES (?, ?, ?, ?)`,
            [taskId, 'cancelled', req.user.id, reason || 'Задача отменена']
        );
        
        const participants = [task.client_id];
        if (task.performer_id) {
            participants.push(task.performer_id);
        }
        
        for (const participantId of participants) {
            await db.run(
                `INSERT INTO notifications 
                (user_id, type, title, message, related_id, related_type) 
                VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    participantId,
                    'task_cancelled',
                    'Задача отменена',
                    `Задача "${task.title}" была отменена. Причина: ${reason || 'не указана'}`,
                    taskId,
                    'task'
                ]
            );
        }
        
        res.json({
            success: true,
            message: 'Задача отменена',
            data: {
                task_id: taskId,
                reason: reason || 'Не указана'
            }
        });
        
    } catch (error) {
        console.error('Ошибка отмены задачи:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка отмены задачи'
        });
    }
});

// Получение доступных задач для исполнителей
app.get('/api/tasks/available', authMiddleware(['performer']), async (req, res) => {
    try {
        const { limit = 10 } = req.query;
        
        if (!req.user.phone_verified) {
            return res.status(403).json({
                success: false,
                error: 'Для просмотра задач необходимо подтвердить телефон'
            });
        }
        
        const specializations = await db.all(
            'SELECT category_id FROM performer_categories WHERE performer_id = ? AND is_active = 1',
            [req.user.id]
        );
        
        if (specializations.length === 0) {
            return res.json({
                success: true,
                data: {
                    tasks: [],
                    count: 0,
                    message: 'У вас нет активных специализаций. Выберите специализации в профиле.'
                }
            });
        }
        
        const categoryIds = specializations.map(s => s.category_id);
        const placeholders = categoryIds.map(() => '?').join(',');
        
        const tasks = await db.all(`
            SELECT t.*, 
                   c.display_name as category_name,
                   c.icon as category_icon,
                   u.first_name as client_first_name,
                   u.last_name as client_last_name,
                   u.avatar_url as client_avatar,
                   u.user_rating as client_rating
            FROM tasks t
            LEFT JOIN categories c ON t.category_id = c.id
            LEFT JOIN users u ON t.client_id = u.id
            WHERE t.status = 'searching' 
              AND t.category_id IN (${placeholders})
            ORDER BY t.priority DESC, t.created_at DESC
            LIMIT ?
        `, [...categoryIds, parseInt(limit)]);
        
        const tasksWithFlag = tasks.map(task => ({
            ...task,
            can_take: true
        }));
        
        res.json({
            success: true,
            data: {
                tasks: tasksWithFlag,
                count: tasksWithFlag.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения доступных задач:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения доступных задач'
        });
    }
});

// Принятие задачи исполнителем
app.post('/api/tasks/:id/take', authMiddleware(['performer']), async (req, res) => {
    const taskId = req.params.id;
    
    try {
        if (!req.user.phone_verified) {
            return res.status(403).json({
                success: false,
                error: 'Для принятия задач необходимо подтвердить телефон'
            });
        }
        
        const task = await db.get(
            'SELECT * FROM tasks WHERE id = ?',
            [taskId]
        );
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        if (task.status !== 'searching') {
            return res.status(400).json({
                success: false,
                error: 'Задача не доступна для принятия'
            });
        }
        
        const canTake = await db.get(
            `SELECT 1 FROM performer_categories 
             WHERE performer_id = ? AND category_id = ? AND is_active = 1`,
            [req.user.id, task.category_id]
        );
        
        if (!canTake) {
            return res.status(403).json({
                success: false,
                error: 'Вы не специализируетесь на этой категории услуг'
            });
        }
        
        await db.run(
            `UPDATE tasks SET 
                performer_id = ?,
                status = 'assigned',
                updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [req.user.id, taskId]
        );
        
        await db.run(
            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
             VALUES (?, ?, ?, ?)`,
            [taskId, 'assigned', req.user.id, 'Задача принята исполнителем']
        );
        
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message, related_id, related_type) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                req.user.id,
                'task_assigned',
                'Задача назначена вам',
                `Вы приняли задачу "${task.title}"`,
                taskId,
                'task'
            ]
        );
        
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message, related_id, related_type) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                task.client_id,
                'task_performer_assigned',
                'Исполнитель назначен',
                `Исполнитель назначен на задачу "${task.title}"`,
                taskId,
                'task'
            ]
        );
        
        res.json({
            success: true,
            message: 'Задача принята',
            data: {
                task_id: taskId
            }
        });
        
    } catch (error) {
        console.error('Ошибка принятия задачи:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка принятия задачи'
        });
    }
});

// ==================== ЧАТ ЗАДАЧИ ====================

// Получение сообщений чата
app.get('/api/tasks/:id/messages', authMiddleware(), async (req, res) => {
    const taskId = req.params.id;
    
    try {
        const task = await db.get(
            'SELECT client_id, performer_id, status FROM tasks WHERE id = ?',
            [taskId]
        );
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        const hasAccess = 
            ['admin', 'manager', 'superadmin'].includes(req.user.role) ||
            req.user.id === task.client_id ||
            req.user.id === task.performer_id;
        
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                error: 'Нет доступа к чату'
            });
        }
        
        const messages = await db.all(
            `SELECT tm.*, u.first_name, u.last_name, u.avatar_url, u.role
             FROM task_messages tm
             LEFT JOIN users u ON tm.user_id = u.id
             WHERE tm.task_id = ?
             ORDER BY tm.created_at ASC`,
            [taskId]
        );
        
        if (req.user.id !== task.client_id && req.user.id !== task.performer_id) {
        } else {
            await db.run(
                `UPDATE task_messages 
                 SET is_read = 1, read_at = CURRENT_TIMESTAMP 
                 WHERE task_id = ? AND user_id != ? AND is_read = 0`,
                [taskId, req.user.id]
            );
        }
        
        const participants = await db.all(
            `SELECT u.id, u.first_name, u.last_name, u.avatar_url, u.role
             FROM users u
             WHERE u.id IN (?, ?) AND u.is_active = 1`,
            [task.client_id, task.performer_id].filter(Boolean)
        );
        
        res.json({
            success: true,
            data: { 
                messages,
                participants,
                can_send: task.status !== 'completed' && task.status !== 'cancelled'
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения сообщений:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения сообщений'
        });
    }
});

// Отправка сообщения в чат
app.post('/api/tasks/:id/messages', authMiddleware(), async (req, res) => {
    const taskId = req.params.id;
    
    try {
        const { message } = req.body;
        
        if (!message || message.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Сообщение не может быть пустым'
            });
        }
        
        const task = await db.get(
            'SELECT id, client_id, performer_id, status, title FROM tasks WHERE id = ?',
            [taskId]
        );
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        const hasAccess = 
            ['admin', 'manager', 'superadmin'].includes(req.user.role) ||
            req.user.id === task.client_id ||
            req.user.id === task.performer_id;
        
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                error: 'Нет доступа к чату'
            });
        }
        
        if (task.status === 'cancelled' || task.status === 'completed') {
            return res.status(400).json({
                success: false,
                error: 'Нельзя отправлять сообщения в завершенные или отмененные задачи'
            });
        }
        
        const result = await db.run(
            `INSERT INTO task_messages (task_id, user_id, message) 
             VALUES (?, ?, ?)`,
            [taskId, req.user.id, message.trim()]
        );
        
        const newMessage = await db.get(
            `SELECT tm.*, u.first_name, u.last_name, u.avatar_url, u.role
             FROM task_messages tm
             LEFT JOIN users u ON tm.user_id = u.id
             WHERE tm.id = ?`,
            [result.lastID]
        );
        
        let recipientId = null;
        if (req.user.id === task.client_id && task.performer_id) {
            recipientId = task.performer_id;
        } else if (req.user.id === task.performer_id) {
            recipientId = task.client_id;
        }
        
        if (recipientId) {
            await db.run(
                `INSERT INTO notifications 
                (user_id, type, title, message, related_id, related_type) 
                VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    recipientId,
                    'new_message',
                    'Новое сообщение',
                    `Новое сообщение в задаче "${task.title}"`,
                    taskId,
                    'task'
                ]
            );
        }
        
        res.status(201).json({
            success: true,
            message: 'Сообщение отправлено',
            data: { 
                message: newMessage
            }
        });
        
    } catch (error) {
        console.error('Ошибка отправки сообщения:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка отправки сообщения'
        });
    }
});

// ==================== ОТЗЫВЫ ====================

// Оставление отзыва
app.post('/api/tasks/:id/reviews', authMiddleware(['client']), async (req, res) => {
    const taskId = req.params.id;
    
    try {
        const { rating, comment, is_anonymous = false } = req.body;
        
        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({
                success: false,
                error: 'Рейтинг должен быть от 1 до 5'
            });
        }
        
        const task = await db.get(
            'SELECT * FROM tasks WHERE id = ?',
            [taskId]
        );
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        if (req.user.id !== task.client_id) {
            return res.status(403).json({
                success: false,
                error: 'Только клиент может оставлять отзыв'
            });
        }
        
        if (task.status !== 'completed') {
            return res.status(400).json({
                success: false,
                error: 'Можно оставить отзыв только к завершенным задачам'
            });
        }
        
        const existingReview = await db.get(
            'SELECT id FROM reviews WHERE task_id = ?',
            [taskId]
        );
        
        if (existingReview) {
            return res.status(400).json({
                success: false,
                error: 'Эта задача уже была оценена'
            });
        }
        
        if (!task.performer_id) {
            return res.status(400).json({
                success: false,
                error: 'Нельзя оставить отзыв к задаче без исполнителя'
            });
        }
        
        await db.run(
            `INSERT INTO reviews (task_id, client_id, performer_id, rating, comment, is_anonymous) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [taskId, req.user.id, task.performer_id, rating, comment || null, is_anonymous ? 1 : 0]
        );
        
        await db.run(
            'UPDATE tasks SET task_rating = ?, feedback = ? WHERE id = ?',
            [rating, comment || null, taskId]
        );
        
        const performerStats = await db.get(
            `SELECT AVG(r.rating) as avg_rating, COUNT(r.id) as reviews_count
             FROM reviews r
             WHERE r.performer_id = ?`,
            [task.performer_id]
        );
        
        if (performerStats && performerStats.avg_rating) {
            await db.run(
                'UPDATE users SET user_rating = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [performerStats.avg_rating.toFixed(1), task.performer_id]
            );
        }
        
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message, related_id, related_type) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                task.performer_id,
                'new_review',
                'Новый отзыв',
                `Вы получили новый отзыв от клиента. Рейтинг: ${rating}/5`,
                taskId,
                'task'
            ]
        );
        
        res.json({
            success: true,
            message: 'Спасибо за ваш отзыв!',
            data: {
                task_id: taskId,
                rating,
                comment: comment || null
            }
        });
        
    } catch (error) {
        console.error('Ошибка оставления отзыва:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка оставления отзыва'
        });
    }
});

// ==================== API ИСПОЛНИТЕЛЕЙ ====================

// Получение статистики исполнителя
app.get('/api/performer/stats', authMiddleware(['performer', 'admin', 'superadmin']), async (req, res) => {
    try {
        const userId = req.user.id;
        
        const stats = await db.get(`
            SELECT 
                COUNT(*) as total_tasks,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
                SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_tasks,
                SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_tasks,
                SUM(CASE WHEN status = 'completed' THEN price ELSE 0 END) as total_earnings,
                AVG(CASE WHEN status = 'completed' THEN price ELSE NULL END) as avg_price,
                MIN(CASE WHEN status = 'completed' THEN created_at END) as first_task_date,
                MAX(CASE WHEN status = 'completed' THEN created_at END) as last_task_date
            FROM tasks 
            WHERE performer_id = ?
        `, [userId]);
        
        const reviews = await db.all(`
            SELECT r.*, 
                   u.first_name as client_first_name,
                   u.last_name as client_last_name,
                   u.avatar_url as client_avatar,
                   t.title as task_title
            FROM reviews r
            JOIN users u ON r.client_id = u.id
            JOIN tasks t ON r.task_id = t.id
            WHERE r.performer_id = ?
            ORDER BY r.created_at DESC
            LIMIT 10
        `, [userId]);
        
        const categories = await db.all(`
            SELECT c.*, pc.experience_years, pc.hourly_rate
            FROM performer_categories pc
            JOIN categories c ON pc.category_id = c.id
            WHERE pc.performer_id = ? AND pc.is_active = 1
        `, [userId]);
        
        const avgRating = await db.get(`
            SELECT AVG(rating) as avg_rating
            FROM reviews 
            WHERE performer_id = ?
        `, [userId]);
        
        const activeTasks = await db.all(`
            SELECT COUNT(*) as count
            FROM tasks 
            WHERE performer_id = ? AND status IN ('assigned', 'in_progress')
        `, [userId]);
        
        const availableTasks = await db.all(`
            SELECT COUNT(*) as count
            FROM tasks t
            JOIN performer_categories pc ON t.category_id = pc.category_id
            WHERE pc.performer_id = ? 
              AND pc.is_active = 1
              AND t.status = 'searching'
        `, [userId]);
        
        res.json({
            success: true,
            data: {
                stats: {
                    total_tasks: stats?.total_tasks || 0,
                    completed_tasks: stats?.completed_tasks || 0,
                    in_progress_tasks: stats?.in_progress_tasks || 0,
                    cancelled_tasks: stats?.cancelled_tasks || 0,
                    total_earnings: stats?.total_earnings || 0,
                    avg_price: stats?.avg_price || 0,
                    first_task_date: stats?.first_task_date,
                    last_task_date: stats?.last_task_date,
                    avg_rating: avgRating?.avg_rating || 0
                },
                categories,
                recent_reviews: reviews,
                active_tasks: activeTasks?.[0]?.count || 0,
                available_tasks: availableTasks?.[0]?.count || 0
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения статистики исполнителя:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статистики'
        });
    }
});

// Получение доступных задач для исполнителя
// Получение доступных задач для исполнителей - УЛУЧШЕННАЯ ВЕРСИЯ
app.get('/api/performer/tasks/available', authMiddleware(['performer']), async (req, res) => {
    try {
        console.log(`🔍 Исполнитель ${req.user.id} запрашивает доступные задачи`);
        
        const { category_id, min_price, priority } = req.query;
        
        // Получаем специализации исполнителя
        const specializations = await db.all(
            'SELECT category_id FROM performer_categories WHERE performer_id = ? AND is_active = 1',
            [req.user.id]
        );
        
        console.log(`📊 Специализации исполнителя: ${specializations.length} категорий`);
        
        if (specializations.length === 0) {
            console.log('⚠️ У исполнителя нет специализаций');
            return res.json({
                success: true,
                data: {
                    tasks: [],
                    count: 0,
                    message: 'У вас нет активных специализаций. Выберите специализации в профиле.'
                }
            });
        }
        
        const categoryIds = specializations.map(s => s.category_id);
        console.log(`📋 ID категорий: ${categoryIds.join(', ')}`);
        
        let query = `
            SELECT t.*, 
                   c.display_name as category_name,
                   c.icon as category_icon,
                   u.first_name as client_first_name,
                   u.last_name as client_last_name,
                   u.avatar_url as client_avatar,
                   u.user_rating as client_rating
            FROM tasks t
            LEFT JOIN categories c ON t.category_id = c.id
            LEFT JOIN users u ON t.client_id = u.id
            WHERE t.status = 'searching' 
              AND t.category_id IN (${categoryIds.map(() => '?').join(',')})
              AND (t.performer_id IS NULL OR t.performer_id = 0)
              AND t.client_id != ?  -- Исключаем свои собственные задачи
        `;
        
        const params = [...categoryIds, req.user.id];
        
        // Добавляем фильтры
        if (category_id && category_id !== 'all') {
            query += ' AND t.category_id = ?';
            params.push(category_id);
        }
        
        if (min_price) {
            query += ' AND t.price >= ?';
            params.push(min_price);
        }
        
        if (priority && priority !== 'all') {
            query += ' AND t.priority = ?';
            params.push(priority);
        }
        
        query += ' ORDER BY t.priority DESC, t.created_at DESC';
        
        console.log(`🔎 SQL запрос: ${query}`);
        console.log(`🔎 Параметры: ${params}`);
        
        const tasks = await db.all(query, params);
        
        console.log(`✅ Найдено доступных задач: ${tasks.length}`);
        
        // Добавляем флаг can_take к каждой задаче
        const tasksWithFlag = tasks.map(task => ({
            ...task,
            can_take: true
        }));
        
        res.json({
            success: true,
            data: {
                tasks: tasksWithFlag,
                count: tasksWithFlag.length,
                categories: specializations.length,
                message: tasksWithFlag.length > 0 
                    ? `Найдено ${tasksWithFlag.length} доступных задач` 
                    : 'Нет доступных задач в ваших категориях'
            }
        });
        
    } catch (error) {
        console.error('🔥 Ошибка получения доступных задач:', error.message);
        console.error('Stack:', error.stack);
        
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера при получении задач',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Принятие задачи исполнителем - ОБНОВЛЕННАЯ ВЕРСИЯ
app.post('/api/performer/tasks/:taskId/accept', authMiddleware(['performer']), async (req, res) => {
    try {
        const taskId = req.params.taskId;
        const performerId = req.user.id;
        
        console.log(`🤝 Исполнитель ${performerId} принимает задачу ${taskId}`);
        
        // Проверяем задачу
        const task = await db.get(
            'SELECT * FROM tasks WHERE id = ? AND status = "searching"',
            [taskId]
        );
        
        if (!task) {
            console.log(`❌ Задача ${taskId} не найдена или уже принята`);
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена или уже принята'
            });
        }
        
        // Проверяем специализацию
        const canAccept = await db.get(
            'SELECT 1 FROM performer_categories WHERE performer_id = ? AND category_id = ? AND is_active = 1',
            [performerId, task.category_id]
        );
        
        if (!canAccept) {
            console.log(`❌ Исполнитель ${performerId} не имеет специализации в категории ${task.category_id}`);
            return res.status(403).json({
                success: false,
                error: 'У вас нет специализации в этой категории'
            });
        }
        
        // Проверяем, не занята ли уже задача
        if (task.performer_id && task.performer_id !== 0) {
            console.log(`❌ Задача ${taskId} уже назначена исполнителю ${task.performer_id}`);
            return res.status(400).json({
                success: false,
                error: 'Задача уже назначена другому исполнителю'
            });
        }
        
        // Принимаем задачу
        console.log(`✅ Назначаем задачу ${taskId} исполнителю ${performerId}`);
        
        await db.run(
            `UPDATE tasks SET 
                performer_id = ?,
                status = 'assigned',
                updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [performerId, taskId]
        );
        
        // Записываем историю статусов
        await db.run(
            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
             VALUES (?, ?, ?, ?)`,
            [taskId, 'assigned', performerId, 'Задача принята исполнителем']
        );
        
        // Уведомление исполнителю
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message, related_id, related_type) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                performerId,
                'task_assigned',
                'Вы приняли задачу',
                `Вы приняли задачу "${task.title}". Начинайте выполнение.`,
                taskId,
                'task'
            ]
        );
        
        // Уведомление клиенту
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message, related_id, related_type) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                task.client_id,
                'task_performer_assigned',
                'Исполнитель назначен',
                `Исполнитель принял вашу задачу "${task.title}".`,
                taskId,
                'task'
            ]
        );
        
        // Обновляем статистику исполнителя
        await db.run(
            'UPDATE users SET completed_tasks = completed_tasks + 1 WHERE id = ?',
            [performerId]
        );
        
        // Получаем обновленную задачу
        const updatedTask = await db.get(
            `SELECT t.*, c.display_name as category_name
             FROM tasks t 
             LEFT JOIN categories c ON t.category_id = c.id 
             WHERE t.id = ?`,
            [taskId]
        );
        
        res.json({
            success: true,
            message: '🎉 Задача успешно принята!',
            data: { 
                task: updatedTask,
                task_id: taskId,
                performer_id: performerId
            }
        });
        
    } catch (error) {
        console.error('🔥 Ошибка принятия задачи:', error.message);
        console.error('Stack:', error.stack);
        
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера при принятии задачи',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Получение задач исполнителя
app.get('/api/performer/tasks', authMiddleware(['performer']), async (req, res) => {
    try {
        const { status, limit = 50 } = req.query;
        
        let query = `
            SELECT t.*, 
                   c.display_name as category_name,
                   c.icon as category_icon,
                   u.first_name as client_first_name,
                   u.last_name as client_last_name,
                   u.avatar_url as client_avatar,
                   u.user_rating as client_rating
            FROM tasks t
            LEFT JOIN categories c ON t.category_id = c.id
            LEFT JOIN users u ON t.client_id = u.id
            WHERE t.performer_id = ?
        `;
        
        const params = [req.user.id];
        
        if (status && status !== 'all') {
            query += ' AND t.status = ?';
            params.push(status);
        }
        
        query += ' ORDER BY t.created_at DESC LIMIT ?';
        params.push(parseInt(limit));
        
        const tasks = await db.all(query, params);
        
        if (!status || status === 'searching' || status === 'all') {
            const specializations = await db.all(
                'SELECT category_id FROM performer_categories WHERE performer_id = ? AND is_active = 1',
                [req.user.id]
            );
            
            if (specializations.length > 0) {
                const categoryIds = specializations.map(s => s.category_id);
                const placeholders = categoryIds.map(() => '?').join(',');
                
                const availableTasks = await db.all(`
                    SELECT t.*, 
                           c.display_name as category_name,
                           c.icon as category_icon,
                           u.first_name as client_first_name,
                           u.last_name as client_last_name,
                           u.avatar_url as client_avatar,
                           u.user_rating as client_rating
                    FROM tasks t
                    LEFT JOIN categories c ON t.category_id = c.id
                    LEFT JOIN users u ON t.client_id = u.id
                    WHERE t.status = 'searching' 
                      AND t.category_id IN (${placeholders})
                      AND (t.performer_id IS NULL OR t.performer_id != ?)
                    ORDER BY t.priority DESC, t.created_at DESC
                    LIMIT 20
                `, [...categoryIds, req.user.id]);
                
                tasks.push(...availableTasks.map(task => ({
                    ...task,
                    is_available: true
                })));
            }
        }
        
        res.json({
            success: true,
            data: { tasks, count: tasks.length }
        });
        
    } catch (error) {
        console.error('Ошибка получения задач исполнителя:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения задач'
        });
    }
});

// Начать выполнение задачи
app.post('/api/performer/tasks/:taskId/start', authMiddleware(['performer']), async (req, res) => {
    try {
        const taskId = req.params.taskId;
        
        const task = await db.get(
            'SELECT * FROM tasks WHERE id = ? AND performer_id = ?',
            [taskId, req.user.id]
        );
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена или не назначена вам'
            });
        }
        
        if (task.status !== 'assigned') {
            return res.status(400).json({
                success: false,
                error: 'Можно начать только назначенные задачи'
            });
        }
        
        await db.run(
            `UPDATE tasks SET 
                status = 'in_progress',
                updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [taskId]
        );
        
        await db.run(
            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
             VALUES (?, ?, ?, ?)`,
            [taskId, 'in_progress', req.user.id, 'Исполнитель начал работу']
        );
        
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message, related_id, related_type) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                task.client_id,
                'task_in_progress',
                'Исполнитель начал работу',
                `Исполнитель начал выполнение задачи "${task.title}"`,
                taskId,
                'task'
            ]
        );
        
        res.json({
            success: true,
            message: 'Работа над задачей начата!',
            data: { task_id: taskId }
        });
        
    } catch (error) {
        console.error('Ошибка начала выполнения задачи:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка начала выполнения'
        });
    }
});

// Завершить задачу
app.post('/api/performer/tasks/:taskId/complete', authMiddleware(['performer']), async (req, res) => {
    try {
        const taskId = req.params.taskId;
        
        const task = await db.get(
            'SELECT * FROM tasks WHERE id = ? AND performer_id = ?',
            [taskId, req.user.id]
        );
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена или не назначена вам'
            });
        }
        
        if (task.status !== 'in_progress') {
            return res.status(400).json({
                success: false,
                error: 'Можно завершить только задачи в работе'
            });
        }
        
        await db.run(
            `UPDATE tasks SET 
                status = 'completed',
                completed_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [taskId]
        );
        
        await db.run(
            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
             VALUES (?, ?, ?, ?)`,
            [taskId, 'completed', req.user.id, 'Исполнитель завершил работу']
        );
        
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message, related_id, related_type) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                task.client_id,
                'task_completed',
                'Задача выполнена',
                `Исполнитель завершил задачу "${task.title}". Пожалуйста, оцените работу.`,
                taskId,
                'task'
            ]
        );
        
        await db.run(
            'UPDATE users SET completed_tasks = completed_tasks + 1 WHERE id = ?',
            [req.user.id]
        );
        
        res.json({
            success: true,
            message: 'Задача завершена! Ожидайте подтверждения клиента.',
            data: { task_id: taskId }
        });
        
    } catch (error) {
        console.error('Ошибка завершения задачи:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка завершения задачи'
        });
    }
});

// Отказаться от задачи
app.post('/api/performer/tasks/:taskId/reject', authMiddleware(['performer']), async (req, res) => {
    try {
        const taskId = req.params.taskId;
        const { reason } = req.body;
        
        const task = await db.get(
            'SELECT * FROM tasks WHERE id = ? AND performer_id = ?',
            [taskId, req.user.id]
        );
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена или не назначена вам'
            });
        }
        
        if (!['assigned', 'in_progress'].includes(task.status)) {
            return res.status(400).json({
                success: false,
                error: 'Можно отказаться только от назначенных задач или задач в работе'
            });
        }
        
        await db.run(
            `UPDATE tasks SET 
                performer_id = NULL,
                status = 'searching',
                updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [taskId]
        );
        
        await db.run(
            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
             VALUES (?, ?, ?, ?)`,
            [taskId, 'searching', req.user.id, `Исполнитель отказался. Причина: ${reason || 'не указана'}`]
        );
        
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message, related_id, related_type) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                task.client_id,
                'task_performer_rejected',
                'Исполнитель отказался',
                `Исполнитель отказался от задачи "${task.title}". Причина: ${reason || 'не указана'}`,
                taskId,
                'task'
            ]
        );
        
        res.json({
            success: true,
            message: 'Вы отказались от задачи',
            data: { task_id: taskId }
        });
        
    } catch (error) {
        console.error('Ошибка отказа от задачи:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка отказа от задачи'
        });
    }
});

// Получение специализаций исполнителя
app.get('/api/performer/categories', authMiddleware(['performer']), async (req, res) => {
    try {
        const categories = await db.all(`
            SELECT c.*, pc.experience_years, pc.hourly_rate
            FROM performer_categories pc
            JOIN categories c ON pc.category_id = c.id
            WHERE pc.performer_id = ? AND pc.is_active = 1
            ORDER BY c.display_name ASC
        `, [req.user.id]);

        res.json({
            success: true,
            data: { categories }
        });

    } catch (error) {
        console.error('Ошибка получения специализаций:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения специализаций'
        });
    }
});

// Обновление статуса доступности исполнителя
app.post('/api/performer/availability', authMiddleware(['performer']), async (req, res) => {
    try {
        const { is_available } = req.body;
        
        if (typeof is_available !== 'boolean') {
            return res.status(400).json({
                success: false,
                error: 'Некорректный статус доступности'
            });
        }
        
        await db.run(`
            INSERT OR REPLACE INTO settings (key, value, description, category) 
            VALUES (?, ?, ?, ?)
        `, [
            `performer_${req.user.id}_availability`,
            is_available ? 'available' : 'unavailable',
            'Статус доступности исполнителя',
            'performer'
        ]);
        
        res.json({
            success: true,
            message: 'Статус доступности обновлен',
            data: { is_available }
        });
        
    } catch (error) {
        console.error('Ошибка обновления статуса доступности:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления статуса'
        });
    }
});

// Получение уведомлений исполнителя
app.get('/api/performer/notifications', authMiddleware(['performer']), async (req, res) => {
    try {
        const { unread_only = false, limit = 20 } = req.query;
        
        let query = `
            SELECT n.*
            FROM notifications n
            WHERE n.user_id = ?
        `;
        
        const params = [req.user.id];
        
        if (unread_only === 'true') {
            query += ' AND n.is_read = 0';
        }
        
        query += ' ORDER BY n.created_at DESC LIMIT ?';
        params.push(parseInt(limit));
        
        const notifications = await db.all(query, params);
        
        res.json({
            success: true,
            data: { notifications }
        });
        
    } catch (error) {
        console.error('Ошибка получения уведомлений:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения уведомлений'
        });
    }
});

// Пометить уведомления как прочитанные
app.post('/api/performer/notifications/read', authMiddleware(['performer']), async (req, res) => {
    try {
        const { notification_ids } = req.body;
        
        if (notification_ids && Array.isArray(notification_ids)) {
            const placeholders = notification_ids.map(() => '?').join(',');
            await db.run(`
                UPDATE notifications 
                SET is_read = 1, read_at = CURRENT_TIMESTAMP 
                WHERE id IN (${placeholders}) AND user_id = ?
            `, [...notification_ids, req.user.id]);
        } else {
            await db.run(`
                UPDATE notifications 
                SET is_read = 1, read_at = CURRENT_TIMESTAMP 
                WHERE user_id = ? AND is_read = 0
            `, [req.user.id]);
        }
        
        res.json({
            success: true,
            message: 'Уведомления помечены как прочитанные'
        });
        
    } catch (error) {
        console.error('Ошибка отметки уведомлений:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка отметки уведомлений'
        });
    }
});

// Обновление профиля исполнителя
app.put('/api/performer/profile', authMiddleware(['performer']), async (req, res) => {
    try {
        const { first_name, last_name, phone, categories, bio, min_budget, max_tasks } = req.body;
        
        const updateFields = [];
        const updateValues = [];
        
        if (first_name !== undefined) {
            updateFields.push('first_name = ?');
            updateValues.push(first_name);
        }
        
        if (last_name !== undefined) {
            updateFields.push('last_name = ?');
            updateValues.push(last_name);
        }
        
        if (phone !== undefined) {
            const formattedPhone = formatPhone(phone);
            if (!validatePhone(formattedPhone)) {
                return res.status(400).json({
                    success: false,
                    error: 'Некорректный номер телефона'
                });
            }
            updateFields.push('phone = ?');
            updateValues.push(formattedPhone);
        }
        
        if (bio !== undefined) {
            updateFields.push('bio = ?');
            updateValues.push(bio);
        }
        
        if (min_budget !== undefined) {
            await db.run(`
                INSERT OR REPLACE INTO settings (key, value, description, category) 
                VALUES (?, ?, ?, ?)
            `, [
                `performer_${req.user.id}_min_budget`,
                min_budget,
                'Минимальный бюджет исполнителя',
                'performer'
            ]);
        }
        
        if (max_tasks !== undefined) {
            await db.run(`
                INSERT OR REPLACE INTO settings (key, value, description, category) 
                VALUES (?, ?, ?, ?)
            `, [
                `performer_${req.user.id}_max_tasks`,
                max_tasks,
                'Максимальное количество одновременных задач',
                'performer'
            ]);
        }
        
        if (updateFields.length === 0 && !categories) {
            return res.status(400).json({
                success: false,
                error: 'Нет данных для обновления'
            });
        }
        
        if (updateFields.length > 0) {
            updateFields.push('updated_at = CURRENT_TIMESTAMP');
            updateValues.push(req.user.id);
            
            const query = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`;
            await db.run(query, updateValues);
        }
        
        if (categories && Array.isArray(categories)) {
            await db.run('DELETE FROM performer_categories WHERE performer_id = ?', [req.user.id]);
            
            for (const categoryId of categories) {
                await db.run(
                    'INSERT INTO performer_categories (performer_id, category_id, is_active) VALUES (?, ?, 1)',
                    [req.user.id, categoryId]
                );
            }
        }
        
        const user = await db.get(
            `SELECT id, email, first_name, last_name, phone, phone_verified, role, 
                    avatar_url, user_rating, completed_tasks, bio
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        
        res.json({
            success: true,
            message: 'Профиль успешно обновлен',
            data: { 
                user: {
                    ...user,
                    rating: user.user_rating
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка обновления профиля исполнителя:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления профиля'
        });
    }
});

// Получение информации о заработке исполнителя
app.get('/api/performer/earnings', authMiddleware(['performer']), async (req, res) => {
    try {
        const { period = 'month' } = req.query;
        
        let dateFilter = '';
        const params = [req.user.id];
        
        const now = new Date();
        if (period === 'week') {
            const weekAgo = new Date(now);
            weekAgo.setDate(now.getDate() - 7);
            dateFilter = ' AND t.completed_at >= ?';
            params.push(weekAgo.toISOString());
        } else if (period === 'month') {
            const monthAgo = new Date(now);
            monthAgo.setMonth(now.getMonth() - 1);
            dateFilter = ' AND t.completed_at >= ?';
            params.push(monthAgo.toISOString());
        }
        
        const totalEarnings = await db.get(`
            SELECT SUM(t.price) as total
            FROM tasks t
            WHERE t.performer_id = ? 
              AND t.status = 'completed'
              ${dateFilter}
        `, params);
        
        const monthlyEarnings = await db.all(`
            SELECT 
                strftime('%Y-%m', t.completed_at) as month,
                SUM(t.price) as earnings,
                COUNT(*) as tasks_count
            FROM tasks t
            WHERE t.performer_id = ? 
              AND t.status = 'completed'
              AND t.completed_at IS NOT NULL
            GROUP BY strftime('%Y-%m', t.completed_at)
            ORDER BY month DESC
            LIMIT 6
        `, [req.user.id]);
        
        const recentPayments = await db.all(`
            SELECT *
            FROM transactions
            WHERE user_id = ? AND type = 'payout'
            ORDER BY created_at DESC
            LIMIT 5
        `, [req.user.id]);
        
        const availableForWithdrawal = totalEarnings?.total || 0;
        
        res.json({
            success: true,
            data: {
                total_earnings: totalEarnings?.total || 0,
                monthly_earnings: monthlyEarnings,
                recent_payments: recentPayments,
                available_for_withdrawal: availableForWithdrawal,
                period: period
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения информации о заработке:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения информации о заработке'
        });
    }
});

// Запрос выплаты средств
app.post('/api/performer/withdraw', authMiddleware(['performer']), async (req, res) => {
    try {
        const { amount, payment_details } = req.body;
        
        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Укажите сумму для выплаты'
            });
        }
        
        if (!payment_details) {
            return res.status(400).json({
                success: false,
                error: 'Укажите реквизиты для выплаты'
            });
        }
        
        const totalEarnings = await db.get(`
            SELECT SUM(t.price) as total
            FROM tasks t
            WHERE t.performer_id = ? 
              AND t.status = 'completed'
        `, [req.user.id]);
        
        const availableForWithdrawal = totalEarnings?.total || 0;
        
        if (amount > availableForWithdrawal) {
            return res.status(400).json({
                success: false,
                error: 'Запрошенная сумма превышает доступный баланс',
                available_balance: availableForWithdrawal,
                requested_amount: amount
            });
        }
        
        const result = await db.run(
            `INSERT INTO transactions 
            (user_id, type, amount, description, status, payment_method, payment_id, metadata) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.user.id,
                'payout',
                -amount,
                'Выплата средств исполнителю',
                'pending',
                'bank_transfer',
                `PAYOUT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                JSON.stringify({ payment_details })
            ]
        );
        
        const transactionId = result.lastID;
        
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message, related_id, related_type) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                req.user.id,
                'withdrawal_requested',
                'Запрос на выплату создан',
                `Ваш запрос на выплату ${amount} ₽ отправлен на рассмотрение.`,
                transactionId,
                'transaction'
            ]
        );
        
        res.json({
            success: true,
            message: 'Запрос на выплату создан и отправлен на рассмотрение',
            data: {
                transaction_id: transactionId,
                amount: amount,
                status: 'pending',
                payment_details: payment_details
            }
        });
        
    } catch (error) {
        console.error('Ошибка запроса выплаты:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка запроса выплаты'
        });
    }
});

// Получение отзывов об исполнителе
app.get('/api/performer/reviews', authMiddleware(['performer']), async (req, res) => {
    try {
        const { limit = 10 } = req.query;
        
        const reviews = await db.all(`
            SELECT r.*, 
                   u.first_name as client_first_name,
                   u.last_name as client_last_name,
                   u.avatar_url as client_avatar,
                   t.title as task_title,
                   t.task_number
            FROM reviews r
            JOIN users u ON r.client_id = u.id
            JOIN tasks t ON r.task_id = t.id
            WHERE r.performer_id = ?
            ORDER BY r.created_at DESC
            LIMIT ?
        `, [req.user.id, parseInt(limit)]);
        
        const avgRating = await db.get(`
            SELECT AVG(rating) as avg_rating, COUNT(*) as total_reviews
            FROM reviews 
            WHERE performer_id = ?
        `, [req.user.id]);
        
        res.json({
            success: true,
            data: {
                reviews,
                avg_rating: avgRating?.avg_rating || 0,
                total_reviews: avgRating?.total_reviews || 0
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения отзывов:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения отзывов'
        });
    }
});

// Получение количества доступных задач
app.get('/api/performer/tasks/available/count', authMiddleware(['performer']), async (req, res) => {
    try {
        const specializations = await db.all(
            'SELECT category_id FROM performer_categories WHERE performer_id = ? AND is_active = 1',
            [req.user.id]
        );
        
        if (specializations.length === 0) {
            return res.json({
                success: true,
                data: { count: 0 }
            });
        }
        
        const categoryIds = specializations.map(s => s.category_id);
        const placeholders = categoryIds.map(() => '?').join(',');
        
        const result = await db.get(`
            SELECT COUNT(*) as count
            FROM tasks t
            WHERE t.status = 'searching' 
              AND t.category_id IN (${placeholders})
              AND (t.performer_id IS NULL OR t.performer_id != ?)
        `, [...categoryIds, req.user.id]);
        
        res.json({
            success: true,
            data: { count: result?.count || 0 }
        });
        
    } catch (error) {
        console.error('Ошибка подсчета доступных задач:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка подсчета задач'
        });
    }
});

// ==================== API ЗАГРУЗКИ ФАЙЛОВ ====================

// Загрузка изображения
app.post('/api/admin/upload', authMiddleware(['admin', 'superadmin']), upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Файл не был загружен'
      });
    }
    
    const fileUrl = `/uploads/${req.file.filename}`;
    
    res.json({
      success: true,
      message: 'Файл успешно загружен',
      data: {
        filename: req.file.filename,
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        url: fileUrl,
        path: req.file.path
      }
    });
    
  } catch (error) {
    console.error('❌ Ошибка загрузки файла:', error.message);
    res.status(500).json({
      success: false,
      error: 'Ошибка загрузки файла'
    });
  }
});

// Получение списка загруженных изображений
app.get('/api/admin/uploads', authMiddleware(['admin', 'superadmin']), async (req, res) => {
  try {
    const uploadsDir = path.join(__dirname, 'public/uploads');
    
    try {
      await fs.access(uploadsDir);
    } catch {
      await fs.mkdir(uploadsDir, { recursive: true });
      return res.json({
        success: true,
        data: { files: [] }
      });
    }
    
    const files = await fs.readdir(uploadsDir);
    const fileList = files.map(filename => ({
      filename,
      url: `/uploads/${filename}`,
      path: path.join(uploadsDir, filename)
    }));
    
    res.json({
      success: true,
      data: { files: fileList }
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения списка файлов:', error.message);
    res.status(500).json({
      success: false,
      error: 'Ошибка получения файлов'
    });
  }
});

// ==================== АДМИН API (ПОЛНЫЕ ВОЗМОЖНОСТИ) ====================

// Аутентификация администратора (по телефону)
app.post('/api/admin/login', async (req, res) => {
    try {
        const { phone, password } = req.body; // Изменили email на phone
        
        console.log('👑 Попытка входа администратора по телефону:', { phone });
        
        if (!phone || !password) {
            return res.status(400).json({
                success: false,
                error: 'Укажите телефон и пароль'
            });
        }
        
        const formattedPhone = formatPhone(phone);
        
        const user = await db.get(
            `SELECT * FROM users WHERE phone = ? AND role IN ('admin', 'superadmin', 'manager')`,
            [formattedPhone]
        );
        
        if (!user) {
            console.log(`❌ Админ с телефоном ${formattedPhone} не найден`);
            return res.status(401).json({
                success: false,
                error: 'Пользователь не найден или недостаточно прав'
            });
        }
        
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            console.log(`❌ Неверный пароль для телефона ${formattedPhone}`);
            return res.status(401).json({
                success: false,
                error: 'Неверный пароль'
            });
        }
        
        await db.run(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
            [user.id]
        );
        
        const userForResponse = {
            id: user.id,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            phone: user.phone,
            phone_verified: user.phone_verified,
            role: user.role,
            subscription_plan: user.subscription_plan,
            subscription_status: user.subscription_status,
            subscription_expires: user.subscription_expires,
            avatar_url: user.avatar_url,
            balance: user.balance,
            initial_fee_paid: user.initial_fee_paid,
            initial_fee_amount: user.initial_fee_amount,
            rating: user.user_rating,
            completed_tasks: user.completed_tasks,
            tasks_limit: user.tasks_limit,
            tasks_used: user.tasks_used,
            total_spent: user.total_spent,
            last_login: user.last_login,
            email_verified: user.email_verified
        };
        
        const token = jwt.sign(
            { 
                id: user.id, 
                role: user.role,
                phone: user.phone,
                is_admin: true
            },
            process.env.JWT_SECRET || 'concierge-secret-key-2024-prod',
            { expiresIn: '30d' }
        );
        
        console.log(`✅ Успешный вход администратора: ${user.first_name} (${user.phone})`);
        
        res.json({
            success: true,
            message: 'Вход выполнен успешно!',
            data: { 
                user: userForResponse,
                token 
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка входа администратора:', error.message);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера при входе'
        });
    }
});

// Создание администратора (без подтверждения телефона)
app.post('/api/admin/create', authMiddleware(['superadmin']), async (req, res) => {
    try {
        const { email, password, first_name, last_name, phone, role = 'admin' } = req.body;
        
        console.log('👑 Создание администратора:', { email, role });
        
        if (!email || !password || !first_name) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля: email, пароль и имя'
            });
        }
        
        if (!validateEmail(email)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный email адрес'
            });
        }
        
        if (!['admin', 'manager'].includes(role)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректная роль. Допустимые значения: admin, manager'
            });
        }
        
        const existingUser = await db.get('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUser) {
            return res.status(409).json({
                success: false,
                error: 'Пользователь с таким email уже существует'
            });
        }
        
        const hashedPassword = await bcrypt.hash(password, 12);
        
        const avatarUrl = generateAvatarUrl(first_name, last_name, role);
        
        const result = await db.run(
            `INSERT INTO users 
            (email, password, first_name, last_name, phone, phone_verified, role, 
             subscription_plan, subscription_status, subscription_expires,
             initial_fee_paid, initial_fee_amount, tasks_limit, avatar_url,
             email_verified) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                email,
                hashedPassword,
                first_name,
                last_name || '',
                phone || null,
                1, // Админам не нужно подтверждение телефона
                role,
                'premium',
                'active',
                null, // Подписка без ограничений
                1,
                0,
                999,
                avatarUrl,
                1
            ]
        );
        
        const userId = result.lastID;
        
        const user = await db.get(
            `SELECT id, email, first_name, last_name, phone, phone_verified, role, 
                    subscription_plan, subscription_status, subscription_expires,
                    initial_fee_paid, initial_fee_amount, avatar_url
             FROM users WHERE id = ?`,
            [userId]
        );
        
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message) 
            VALUES (?, ?, ?, ?)`,
            [
                userId,
                'admin_created',
                'Аккаунт администратора создан',
                `Ваш аккаунт администратора успешно создан. Роль: ${role === 'admin' ? 'Администратор' : 'Менеджер'}`
            ]
        );
        
        res.status(201).json({
            success: true,
            message: 'Администратор успешно создан',
            data: { 
                user,
                login_credentials: {
                    email: email,
                    password: password // В реальной системе лучше отправлять отдельно
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка создания администратора:', error.message);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера при создании администратора'
        });
    }
});

// Получение статистики системы (расширенная)
app.get('/api/admin/dashboard-stats', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        // 1. Статистика пользователей
        const usersStats = await db.get(`
            SELECT 
                COUNT(*) as total_users,
                SUM(CASE WHEN role = 'client' THEN 1 ELSE 0 END) as clients,
                SUM(CASE WHEN role = 'performer' THEN 1 ELSE 0 END) as performers,
                SUM(CASE WHEN role IN ('admin', 'superadmin', 'manager') THEN 1 ELSE 0 END) as admins,
                SUM(CASE WHEN phone_verified = 1 THEN 1 ELSE 0 END) as verified_users,
                SUM(CASE WHEN subscription_status = 'active' THEN 1 ELSE 0 END) as active_subscriptions,
                SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) as inactive_users,
                SUM(CASE WHEN DATE(created_at) = DATE('now') THEN 1 ELSE 0 END) as new_users_today
            FROM users
        `);
        
        // 2. Статистика задач
        const tasksStats = await db.get(`
            SELECT 
                COUNT(*) as total_tasks,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
                SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_tasks,
                SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_tasks,
                SUM(CASE WHEN status = 'searching' THEN 1 ELSE 0 END) as searching_tasks,
                SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END) as assigned_tasks,
                SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_tasks,
                SUM(price) as total_revenue,
                AVG(price) as avg_task_price,
                SUM(CASE WHEN DATE(created_at) = DATE('now') THEN 1 ELSE 0 END) as new_tasks_today,
                SUM(CASE WHEN DATE(created_at) = DATE('now', '-1 day') THEN 1 ELSE 0 END) as new_tasks_yesterday
            FROM tasks
        `);
        
        // 3. Финансовая статистика
        const financeStats = await db.get(`
            SELECT 
                SUM(CASE WHEN type = 'initial_fee' THEN amount ELSE 0 END) as total_initial_fees,
                SUM(CASE WHEN type = 'subscription' THEN amount ELSE 0 END) as total_subscriptions,
                SUM(CASE WHEN type = 'payout' THEN amount ELSE 0 END) as total_payouts,
                SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END) as total_processed,
                SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) as total_pending,
                COUNT(DISTINCT user_id) as users_with_transactions
            FROM transactions
        `);
        
        // 4. Статистика по категориям
        const categoryStats = await db.all(`
            SELECT 
                c.id,
                c.display_name as category_name,
                c.icon,
                c.color,
                COUNT(t.id) as task_count,
                SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed_count,
                AVG(CASE WHEN t.status = 'completed' THEN t.price ELSE NULL END) as avg_price
            FROM categories c
            LEFT JOIN tasks t ON c.id = t.category_id
            GROUP BY c.id
            ORDER BY task_count DESC
        `);
        
        // 5. Статистика по подпискам
        const subscriptionStats = await db.all(`
            SELECT 
                s.name,
                s.display_name,
                s.price_monthly,
                s.initial_fee,
                COUNT(u.id) as user_count,
                SUM(CASE WHEN u.subscription_status = 'active' THEN 1 ELSE 0 END) as active_users
            FROM subscriptions s
            LEFT JOIN users u ON s.name = u.subscription_plan
            GROUP BY s.id
            ORDER BY s.sort_order
        `);
        
        // 6. Недавняя активность
        const recentActivity = await db.all(`
            SELECT 
                id,
                type,
                title,
                message,
                created_at,
                related_type,
                related_id
            FROM notifications
            ORDER BY created_at DESC
            LIMIT 10
        `);
        
        // 7. Выплаты за сегодня
        const todayPayouts = await db.get(`
            SELECT 
                SUM(amount) as total_amount,
                COUNT(*) as count
            FROM transactions
            WHERE type = 'payout' 
              AND DATE(created_at) = DATE('now')
              AND status = 'completed'
        `);
        
        res.json({
            success: true,
            data: {
                users: usersStats,
                tasks: tasksStats,
                finance: financeStats,
                categories: categoryStats,
                subscriptions: subscriptionStats,
                recent_activity: recentActivity,
                today_payouts: todayPayouts,
                system_info: {
                    demo_mode: DEMO_MODE,
                    total_categories: categoryStats.length,
                    total_services: await db.get('SELECT COUNT(*) as count FROM services').then(r => r.count),
                    total_subscriptions: subscriptionStats.length
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения статистики системы:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статистики системы'
        });
    }
});

// Управление категориями (админ)
app.get('/api/admin/categories', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const categories = await db.all(
            `SELECT c.*, 
                    COUNT(s.id) as services_count,
                    (SELECT COUNT(*) FROM tasks t WHERE t.category_id = c.id) as tasks_count
             FROM categories c
             LEFT JOIN services s ON c.id = s.category_id AND s.is_active = 1
             GROUP BY c.id
             ORDER BY c.sort_order ASC`
        );
        
        res.json({
            success: true,
            data: {
                categories,
                count: categories.length
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения категорий:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения категорий'
        });
    }
});

app.post('/api/admin/categories', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const { id, name, display_name, description, icon, color, sort_order, is_active, image_url } = req.body; // ДОБАВИЛИ image_url
        
        if (!name || !display_name || !description) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля'
            });
        }
        
        if (id) {
            // Обновление существующей категории
            await db.run(
                `UPDATE categories SET 
                    name = ?,
                    display_name = ?,
                    description = ?,
                    icon = ?,
                    image_url = ?,  // ДОБАВИЛИ
                    color = ?,
                    sort_order = ?,
                    is_active = ?,
                    updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [name, display_name, description, icon || 'fas fa-folder', image_url || null, // ДОБАВИЛИ
                 color || '#C5A880', sort_order || 0, is_active ? 1 : 0, id]
            );
            
            const category = await db.get('SELECT * FROM categories WHERE id = ?', [id]);
            
            res.json({
                success: true,
                message: 'Категория успешно обновлена',
                data: { category }
            });
        } else {
            // Создание новой категории
            const result = await db.run(
                `INSERT INTO categories 
                (name, display_name, description, icon, image_url, color, sort_order, is_active)  // ДОБАВИЛИ
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [name, display_name, description, icon || 'fas fa-folder', image_url || null, // ДОБАВИЛИ
                 color || '#C5A880', sort_order || 0, is_active ? 1 : 1]
            );
            
            const categoryId = result.lastID;
            const category = await db.get('SELECT * FROM categories WHERE id = ?', [categoryId]);
            
            res.status(201).json({
                success: true,
                message: 'Категория успешно создана',
                data: { category }
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка сохранения категории:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка сохранения категории'
        });
    }
});

// Удаление категории
app.delete('/api/admin/categories/:id', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const categoryId = req.params.id;
        
        // Проверяем, есть ли связанные услуги или задачи
        const hasServices = await db.get(
            'SELECT 1 FROM services WHERE category_id = ? LIMIT 1',
            [categoryId]
        );
        
        const hasTasks = await db.get(
            'SELECT 1 FROM tasks WHERE category_id = ? LIMIT 1',
            [categoryId]
        );
        
        if (hasServices || hasTasks) {
            // Не удаляем, а деактивируем
            await db.run(
                'UPDATE categories SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [categoryId]
            );
            
            return res.json({
                success: true,
                message: 'Категория деактивирована (есть связанные данные)',
                data: { id: categoryId, deactivated: true }
            });
        }
        
        // Если нет связанных данных - удаляем
        await db.run('DELETE FROM categories WHERE id = ?', [categoryId]);
        
        res.json({
            success: true,
            message: 'Категория успешно удалена',
            data: { id: categoryId }
        });
        
    } catch (error) {
        console.error('❌ Ошибка удаления категории:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка удаления категории'
        });
    }
});

// Управление услугами (админ)
app.get('/api/admin/services', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const { category_id, is_active } = req.query;
        
        let query = `
            SELECT s.*, 
                   c.display_name as category_name,
                   c.icon as category_icon,
                   (SELECT COUNT(*) FROM tasks t WHERE t.service_id = s.id) as tasks_count
            FROM services s
            LEFT JOIN categories c ON s.category_id = c.id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (category_id && category_id !== 'all') {
            query += ' AND s.category_id = ?';
            params.push(category_id);
        }
        
        if (is_active && is_active !== 'all') {
            query += ' AND s.is_active = ?';
            params.push(is_active === 'active' ? 1 : 0);
        }
        
        query += ' ORDER BY s.sort_order ASC, s.name ASC';
        
        const services = await db.all(query, params);
        
        res.json({
            success: true,
            data: {
                services,
                count: services.length
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения услуг:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения услуг'
        });
    }
});

// Создание/обновление услуги
app.post('/api/admin/services', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const { id, category_id, name, description, base_price, estimated_time, is_active, sort_order, is_featured } = req.body;
        
        if (!category_id || !name || !description) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля'
            });
        }
        
        // Проверяем существование категории
        const categoryExists = await db.get('SELECT 1 FROM categories WHERE id = ? AND is_active = 1', [category_id]);
        if (!categoryExists) {
            return res.status(404).json({
                success: false,
                error: 'Категория не найдена'
            });
        }
        
        if (id) {
            // Обновление существующей услуги
            await db.run(
                `UPDATE services SET 
                    category_id = ?,
                    name = ?,
                    description = ?,
                    base_price = ?,
                    estimated_time = ?,
                    is_active = ?,
                    sort_order = ?,
                    is_featured = ?,
                    updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [category_id, name, description, base_price || 0, estimated_time || null,
                 is_active ? 1 : 0, sort_order || 0, is_featured ? 1 : 0, id]
            );
            
            const service = await db.get(
                `SELECT s.*, c.display_name as category_name 
                 FROM services s 
                 LEFT JOIN categories c ON s.category_id = c.id 
                 WHERE s.id = ?`,
                [id]
            );
            
            res.json({
                success: true,
                message: 'Услуга успешно обновлена',
                data: { service }
            });
        } else {
            // Создание новой услуги
            const result = await db.run(
                `INSERT INTO services 
                (category_id, name, description, base_price, estimated_time, is_active, sort_order, is_featured) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [category_id, name, description, base_price || 0, estimated_time || null,
                 is_active ? 1 : 1, sort_order || 0, is_featured ? 1 : 0]
            );
            
            const serviceId = result.lastID;
            const service = await db.get(
                `SELECT s.*, c.display_name as category_name 
                 FROM services s 
                 LEFT JOIN categories c ON s.category_id = c.id 
                 WHERE s.id = ?`,
                [serviceId]
            );
            
            res.status(201).json({
                success: true,
                message: 'Услуга успешно создана',
                data: { service }
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка сохранения услуги:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка сохранения услуги'
        });
    }
});

// Удаление услуги
app.delete('/api/admin/services/:id', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const serviceId = req.params.id;
        
        // Проверяем, есть ли связанные задачи
        const hasTasks = await db.get(
            'SELECT 1 FROM tasks WHERE service_id = ? LIMIT 1',
            [serviceId]
        );
        
        if (hasTasks) {
            // Не удаляем, а деактивируем
            await db.run(
                'UPDATE services SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [serviceId]
            );
            
            return res.json({
                success: true,
                message: 'Услуга деактивирована (есть связанные задачи)',
                data: { id: serviceId, deactivated: true }
            });
        }
        
        // Если нет связанных данных - удаляем
        await db.run('DELETE FROM services WHERE id = ?', [serviceId]);
        
        res.json({
            success: true,
            message: 'Услуга успешно удалена',
            data: { id: serviceId }
        });
        
    } catch (error) {
        console.error('❌ Ошибка удаления услуги:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка удаления услуги'
        });
    }
});

// Управление подписками (админ)
app.get('/api/admin/subscriptions', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const subscriptions = await db.all(
            `SELECT s.*,
                    (SELECT COUNT(*) FROM users u WHERE u.subscription_plan = s.name) as user_count,
                    (SELECT COUNT(*) FROM users u WHERE u.subscription_plan = s.name AND u.subscription_status = 'active') as active_users
             FROM subscriptions s
             ORDER BY s.sort_order ASC, s.price_monthly ASC`
        );
        
        const subscriptionsWithParsedFeatures = subscriptions.map(sub => ({
            ...sub,
            features: typeof sub.features === 'string' ? JSON.parse(sub.features) : sub.features
        }));
        
        res.json({
            success: true,
            data: {
                subscriptions: subscriptionsWithParsedFeatures,
                count: subscriptions.length
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения подписок:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения подписок'
        });
    }
});

// Создание/обновление подписки
app.post('/api/admin/subscriptions', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const { id, name, display_name, description, price_monthly, price_yearly, 
                initial_fee, tasks_limit, features, color_theme, sort_order, 
                is_popular, is_active } = req.body;
        
        if (!name || !display_name || !description || price_monthly === undefined || 
            initial_fee === undefined || tasks_limit === undefined) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля'
            });
        }
        
        // Преобразуем features в строку JSON
        let featuresJson;
        try {
            if (typeof features === 'string') {
                featuresJson = JSON.stringify(JSON.parse(features));
            } else if (Array.isArray(features)) {
                featuresJson = JSON.stringify(features);
            } else {
                featuresJson = JSON.stringify([]);
            }
        } catch (error) {
            featuresJson = JSON.stringify([]);
        }
        
        if (id) {
            // Обновление существующей подписки
            await db.run(
                `UPDATE subscriptions SET 
                    name = ?,
                    display_name = ?,
                    description = ?,
                    price_monthly = ?,
                    price_yearly = ?,
                    initial_fee = ?,
                    tasks_limit = ?,
                    features = ?,
                    color_theme = ?,
                    sort_order = ?,
                    is_popular = ?,
                    is_active = ?,
                    updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [name, display_name, description, price_monthly, price_yearly || price_monthly * 12,
                 initial_fee, tasks_limit, featuresJson, color_theme || '#FF6B8B',
                 sort_order || 0, is_popular ? 1 : 0, is_active ? 1 : 0, id]
            );
            
            const subscription = await db.get('SELECT * FROM subscriptions WHERE id = ?', [id]);
            
            res.json({
                success: true,
                message: 'Подписка успешно обновлена',
                data: { subscription }
            });
        } else {
            // Создание новой подписки
            const result = await db.run(
                `INSERT INTO subscriptions 
                (name, display_name, description, price_monthly, price_yearly, 
                 initial_fee, tasks_limit, features, color_theme, sort_order, 
                 is_popular, is_active) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [name, display_name, description, price_monthly, price_yearly || price_monthly * 12,
                 initial_fee, tasks_limit, featuresJson, color_theme || '#FF6B8B',
                 sort_order || 0, is_popular ? 1 : 0, is_active ? 1 : 1]
            );
            
            const subscriptionId = result.lastID;
            const subscription = await db.get('SELECT * FROM subscriptions WHERE id = ?', [subscriptionId]);
            
            res.status(201).json({
                success: true,
                message: 'Подписка успешно создана',
                data: { subscription }
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка сохранения подписки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка сохранения подписки'
        });
    }
});

// Удаление подписки
app.delete('/api/admin/subscriptions/:id', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const subscriptionId = req.params.id;
        
        // Проверяем, есть ли пользователи с этой подпиской
        const hasUsers = await db.get(
            'SELECT 1 FROM users WHERE subscription_plan = (SELECT name FROM subscriptions WHERE id = ?) LIMIT 1',
            [subscriptionId]
        );
        
        if (hasUsers) {
            // Не удаляем, а деактивируем
            await db.run(
                'UPDATE subscriptions SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [subscriptionId]
            );
            
            return res.json({
                success: true,
                message: 'Подписка деактивирована (есть пользователи с этой подпиской)',
                data: { id: subscriptionId, deactivated: true }
            });
        }
        
        // Если нет пользователей - удаляем
        await db.run('DELETE FROM subscriptions WHERE id = ?', [subscriptionId]);
        
        res.json({
            success: true,
            message: 'Подписка успешно удалена',
            data: { id: subscriptionId }
        });
        
    } catch (error) {
        console.error('❌ Ошибка удаления подписки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка удаления подписки'
        });
    }
});

// Полный отчет по транзакциям
app.get('/api/admin/transactions', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const { start_date, end_date, type, status, limit = 100 } = req.query;
        
        let whereClause = '';
        const params = [];
        
        if (start_date) {
            whereClause += ' AND DATE(t.created_at) >= ?';
            params.push(start_date);
        }
        
        if (end_date) {
            whereClause += ' AND DATE(t.created_at) <= ?';
            params.push(end_date);
        }
        
        if (type && type !== 'all') {
            whereClause += ' AND t.type = ?';
            params.push(type);
        }
        
        if (status && status !== 'all') {
            whereClause += ' AND t.status = ?';
            params.push(status);
        }
        
        let query = `
            SELECT t.*, 
                   u.email as user_email,
                   u.first_name as user_first_name,
                   u.last_name as user_last_name,
                   u.phone as user_phone
            FROM transactions t
            LEFT JOIN users u ON t.user_id = u.id
            WHERE 1=1 ${whereClause}
            ORDER BY t.created_at DESC LIMIT ?
        `;
        
        params.push(parseInt(limit));
        
        const transactions = await db.all(query, params);
        
        // Суммарная статистика
        const statsQuery = `
            SELECT 
                SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END) as total_completed,
                SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) as total_pending,
                SUM(CASE WHEN status = 'failed' THEN amount ELSE 0 END) as total_failed,
                COUNT(*) as total_count,
                COUNT(DISTINCT user_id) as unique_users
            FROM transactions
            WHERE 1=1 ${whereClause}
        `;
        
        const stats = await db.get(statsQuery, params.slice(0, -1));
        
        res.json({
            success: true,
            data: {
                transactions,
                stats,
                count: transactions.length
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения транзакций:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения транзакций'
        });
    }
});

// Управление задачами (админ - полный доступ)
app.get('/api/admin/tasks-detailed', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const { status, category_id, performer_id, client_id, date_from, date_to, limit = 50, offset = 0 } = req.query;
        
        let whereClause = '';
        const params = [];
        
        if (status && status !== 'all') {
            whereClause += ' AND t.status = ?';
            params.push(status);
        }
        
        if (category_id && category_id !== 'all') {
            whereClause += ' AND t.category_id = ?';
            params.push(category_id);
        }
        
        if (performer_id && performer_id !== 'all') {
            whereClause += ' AND t.performer_id = ?';
            params.push(performer_id);
        }
        
        if (client_id && client_id !== 'all') {
            whereClause += ' AND t.client_id = ?';
            params.push(client_id);
        }
        
        if (date_from) {
            whereClause += ' AND DATE(t.created_at) >= ?';
            params.push(date_from);
        }
        
        if (date_to) {
            whereClause += ' AND DATE(t.created_at) <= ?';
            params.push(date_to);
        }
        
        const query = `
            SELECT t.*, 
                   c.display_name as category_name,
                   c.icon as category_icon,
                   s.name as service_name,
                   u1.first_name as client_first_name, 
                   u1.last_name as client_last_name,
                   u1.phone as client_phone,
                   u1.email as client_email,
                   u2.first_name as performer_first_name,
                   u2.last_name as performer_last_name,
                   u2.phone as performer_phone,
                   u2.email as performer_email,
                   u2.user_rating as performer_rating,
                   (SELECT COUNT(*) FROM task_messages WHERE task_id = t.id) as messages_count,
                   (SELECT COUNT(*) FROM reviews WHERE task_id = t.id) as reviews_count
            FROM tasks t
            LEFT JOIN categories c ON t.category_id = c.id
            LEFT JOIN services s ON t.service_id = s.id
            LEFT JOIN users u1 ON t.client_id = u1.id
            LEFT JOIN users u2 ON t.performer_id = u2.id
            WHERE 1=1 ${whereClause}
            ORDER BY t.created_at DESC LIMIT ? OFFSET ?
        `;
        
        params.push(parseInt(limit), parseInt(offset));
        
        const tasks = await db.all(query, params);
        
        // Общее количество для пагинации
        const countQuery = `SELECT COUNT(*) as total FROM tasks WHERE 1=1 ${whereClause}`;
        const countResult = await db.get(countQuery, params.slice(0, -2));
        
        res.json({
            success: true,
            data: {
                tasks,
                pagination: {
                    total: countResult?.total || 0,
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    pages: Math.ceil((countResult?.total || 0) / parseInt(limit))
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения задач:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения задач'
        });
    }
});

// Полное обновление задачи (админ)
app.put('/api/admin/tasks/:id', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const taskId = req.params.id;
        const { title, description, status, performer_id, priority, price, admin_notes, 
                category_id, service_id, deadline, address, contact_info } = req.body;
        
        const task = await db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        const updateFields = [];
        const updateValues = [];
        
        if (title !== undefined) {
            updateFields.push('title = ?');
            updateValues.push(title);
        }
        
        if (description !== undefined) {
            updateFields.push('description = ?');
            updateValues.push(description);
        }
        
        if (status !== undefined) {
            updateFields.push('status = ?');
            updateValues.push(status);
        }
        
        if (performer_id !== undefined) {
            updateFields.push('performer_id = ?');
            updateValues.push(performer_id);
        }
        
        if (priority !== undefined) {
            updateFields.push('priority = ?');
            updateValues.push(priority);
        }
        
        if (price !== undefined) {
            updateFields.push('price = ?');
            updateValues.push(price);
        }
        
        if (admin_notes !== undefined) {
            updateFields.push('admin_notes = ?');
            updateValues.push(admin_notes);
        }
        
        if (category_id !== undefined) {
            updateFields.push('category_id = ?');
            updateValues.push(category_id);
        }
        
        if (service_id !== undefined) {
            updateFields.push('service_id = ?');
            updateValues.push(service_id);
        }
        
        if (deadline !== undefined) {
            updateFields.push('deadline = ?');
            updateValues.push(deadline);
        }
        
        if (address !== undefined) {
            updateFields.push('address = ?');
            updateValues.push(address);
        }
        
        if (contact_info !== undefined) {
            updateFields.push('contact_info = ?');
            updateValues.push(contact_info);
        }
        
        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Нет данных для обновления'
            });
        }
        
        updateFields.push('updated_at = CURRENT_TIMESTAMP');
        updateValues.push(taskId);
        
        const query = `UPDATE tasks SET ${updateFields.join(', ')} WHERE id = ?`;
        
        await db.run(query, updateValues);
        
        // Записываем историю статусов, если статус изменился
        if (status && status !== task.status) {
            await db.run(
                `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
                 VALUES (?, ?, ?, ?)`,
                [taskId, status, req.user.id, admin_notes || `Статус изменен администратором`]
            );
            
            // Отправляем уведомления
            if (task.client_id) {
                await db.run(
                    `INSERT INTO notifications 
                    (user_id, type, title, message, related_id, related_type) 
                    VALUES (?, ?, ?, ?, ?, ?)`,
                    [
                        task.client_id,
                        'task_status_changed',
                        'Статус задачи изменен',
                        `Статус задачи "${title || task.title}" изменен на "${status}"`,
                        taskId,
                        'task'
                    ]
                );
            }
            
            if (performer_id && task.performer_id !== performer_id) {
                await db.run(
                    `INSERT INTO notifications 
                    (user_id, type, title, message, related_id, related_type) 
                    VALUES (?, ?, ?, ?, ?, ?)`,
                    [
                        performer_id,
                        'task_assigned',
                        'Задача назначена вам',
                        `Вам назначена задача "${title || task.title}"`,
                        taskId,
                        'task'
                    ]
                );
            }
        }
        
        const updatedTask = await db.get(
            `SELECT t.*, c.display_name as category_name, s.name as service_name
             FROM tasks t 
             LEFT JOIN categories c ON t.category_id = c.id 
             LEFT JOIN services s ON t.service_id = s.id 
             WHERE t.id = ?`,
            [taskId]
        );
        
        res.json({
            success: true,
            message: 'Задача успешно обновлена',
            data: { task: updatedTask }
        });
        
    } catch (error) {
        console.error('❌ Ошибка обновления задачи:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления задачи'
        });
    }
});

// Удаление задачи (админ)
app.delete('/api/admin/tasks/:id', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const taskId = req.params.id;
        
        const task = await db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        // Начинаем транзакцию для удаления связанных данных
        await db.exec('BEGIN TRANSACTION');
        
        try {
            // Удаляем связанные записи
            await db.run('DELETE FROM task_messages WHERE task_id = ?', [taskId]);
            await db.run('DELETE FROM task_status_history WHERE task_id = ?', [taskId]);
            await db.run('DELETE FROM reviews WHERE task_id = ?', [taskId]);
            
            // Удаляем саму задачу
            await db.run('DELETE FROM tasks WHERE id = ?', [taskId]);
            
            // Возвращаем использованные задачи клиенту
            await db.run(
                'UPDATE users SET tasks_used = tasks_used - 1 WHERE id = ? AND tasks_used > 0',
                [task.client_id]
            );
            
            await db.exec('COMMIT');
            
            res.json({
                success: true,
                message: 'Задача успешно удалена',
                data: { task_id: taskId }
            });
            
        } catch (error) {
            await db.exec('ROLLBACK');
            throw error;
        }
        
    } catch (error) {
        console.error('❌ Ошибка удаления задачи:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка удаления задачи'
        });
    }
});

// ==================== УДАЛЕНИЕ ПОЛЬЗОВАТЕЛЯ (АДМИН) ====================
app.delete('/api/admin/users/:id', authMiddleware(['admin', 'superadmin']), async (req, res) => {
  try {
    const userId = req.params.id;
    const currentUserId = req.user.id;
    
    console.log(`❌ Попытка удаления пользователя ${userId} администратором ${currentUserId}`);
    
    // Проверяем, не пытаемся ли удалить себя
    if (parseInt(userId) === parseInt(currentUserId)) {
      return res.status(400).json({
        success: false,
        error: 'Нельзя удалить самого себя'
      });
    }
    
    // Получаем информацию о пользователе
    const user = await db.get('SELECT id, role, email, phone FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Пользователь не найден'
      });
    }
    
    // Не даем удалять суперадминов обычным админам
    if (user.role === 'superadmin' && req.user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        error: 'Недостаточно прав для удаления суперадминистратора'
      });
    }
    
    // Проверяем, есть ли связанные задачи у пользователя
    const hasClientTasks = await db.get(
      'SELECT 1 FROM tasks WHERE client_id = ? LIMIT 1',
      [userId]
    );
    
    const hasPerformerTasks = await db.get(
      'SELECT 1 FROM tasks WHERE performer_id = ? LIMIT 1',
      [userId]
    );
    
    const hasTasks = hasClientTasks || hasPerformerTasks;
    
    // Проверяем, есть ли транзакции
    const hasTransactions = await db.get(
      'SELECT 1 FROM transactions WHERE user_id = ? LIMIT 1',
      [userId]
    );
    
    if (hasTasks || hasTransactions) {
      // Есть связанные данные - деактивируем вместо удаления
      console.log(`⚠️ Деактивация пользователя ${userId} (есть связанные данные)`);
      
      await db.run(
        'UPDATE users SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [userId]
      );
      
      // Создаем уведомление
      await db.run(
        `INSERT INTO notifications 
        (user_id, type, title, message) 
        VALUES (?, ?, ?, ?)`,
        [
          userId,
          'account_deactivated',
          'Аккаунт деактивирован',
          'Ваш аккаунт был деактивирован администратором.'
        ]
      );
      
      return res.json({
        success: true,
        message: 'Пользователь деактивирован (есть связанные задачи или транзакции)',
        data: { 
          id: userId,
          deactivated: true,
          email: user.email,
          phone: user.phone
        }
      });
    }
    
    // Нет связанных данных - удаляем полностью
    console.log(`🗑️ Полное удаление пользователя ${userId}`);
    
    // Начинаем транзакцию для безопасного удаления
    await db.exec('BEGIN TRANSACTION');
    
    try {
      // Удаляем связанные записи в правильном порядке
      await db.run('DELETE FROM phone_verification_codes WHERE phone = ?', [user.phone]);
      await db.run('DELETE FROM notifications WHERE user_id = ?', [userId]);
      await db.run('DELETE FROM performer_categories WHERE performer_id = ?', [userId]);
      
      // Удаляем пользователя
      await db.run('DELETE FROM users WHERE id = ?', [userId]);
      
      await db.exec('COMMIT');
      
      console.log(`✅ Пользователь ${userId} успешно удален`);
      
      res.json({
        success: true,
        message: 'Пользователь успешно удален',
        data: { 
          id: userId,
          email: user.email,
          phone: user.phone,
          permanently_deleted: true
        }
      });
      
    } catch (transactionError) {
      await db.exec('ROLLBACK');
      throw transactionError;
    }
    
  } catch (error) {
    console.error('❌ Ошибка удаления пользователя:', error.message);
    
    // Проверяем ошибки уникальности
    if (error.message.includes('SQLITE_CONSTRAINT') || error.message.includes('FOREIGN KEY')) {
      return res.status(400).json({
        success: false,
        error: 'Не удалось удалить пользователя из-за связанных данных. Попробуйте деактивировать аккаунт.'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Внутренняя ошибка сервера при удалении пользователя'
    });
  }
});

// Полное управление пользователями
app.get('/api/admin/users-detailed', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const { role, subscription_status, is_active, phone_verified, search, limit = 50, offset = 0 } = req.query;
        
        let whereClause = '';
        const params = [];
        
        if (role && role !== 'all') {
            whereClause += ' AND u.role = ?';
            params.push(role);
        }
        
        if (subscription_status && subscription_status !== 'all') {
            whereClause += ' AND u.subscription_status = ?';
            params.push(subscription_status);
        }
        
        if (is_active !== undefined && is_active !== 'all') {
            whereClause += ' AND u.is_active = ?';
            params.push(is_active === 'active' ? 1 : 0);
        }
        
        if (phone_verified !== undefined && phone_verified !== 'all') {
            whereClause += ' AND u.phone_verified = ?';
            params.push(phone_verified === 'verified' ? 1 : 0);
        }
        
        if (search) {
            whereClause += ' AND (u.email LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ? OR u.phone LIKE ?)';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }
        
        const query = `
            SELECT u.*,
                   (SELECT COUNT(*) FROM tasks t WHERE t.client_id = u.id) as tasks_count,
                   (SELECT COUNT(*) FROM tasks t WHERE t.performer_id = u.id) as performed_tasks_count,
                   (SELECT AVG(rating) FROM reviews r WHERE r.performer_id = u.id) as avg_rating,
                   (SELECT SUM(amount) FROM transactions tr WHERE tr.user_id = u.id AND tr.status = 'completed') as total_transactions
            FROM users u
            WHERE 1=1 ${whereClause}
            ORDER BY u.created_at DESC LIMIT ? OFFSET ?
        `;
        
        params.push(parseInt(limit), parseInt(offset));
        
        const users = await db.all(query, params);
        
        // Общее количество
        const countQuery = `SELECT COUNT(*) as total FROM users WHERE 1=1 ${whereClause}`;
        const countResult = await db.get(countQuery, params.slice(0, -2));
        
        res.json({
            success: true,
            data: {
                users,
                pagination: {
                    total: countResult?.total || 0,
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    pages: Math.ceil((countResult?.total || 0) / parseInt(limit))
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения пользователей:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения пользователей'
        });
    }
});

// Полное обновление пользователя (админ)
app.put('/api/admin/users/:id', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const userId = req.params.id;
        const { role, subscription_status, subscription_plan, subscription_expires,
                is_active, phone_verified, email_verified, tasks_limit, balance,
                first_name, last_name, email, phone, avatar_url, bio } = req.body;
        
        const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        // Проверка прав для изменения роли
        if (role && user.role === 'superadmin' && req.user.role !== 'superadmin') {
            return res.status(403).json({
                success: false,
                error: 'Недостаточно прав для изменения роли суперадмина'
            });
        }
        
        const updateFields = [];
        const updateValues = [];
        
        if (role !== undefined) {
            updateFields.push('role = ?');
            updateValues.push(role);
        }
        
        if (subscription_status !== undefined) {
            updateFields.push('subscription_status = ?');
            updateValues.push(subscription_status);
        }
        
        if (subscription_plan !== undefined) {
            updateFields.push('subscription_plan = ?');
            updateValues.push(subscription_plan);
        }
        
        if (subscription_expires !== undefined) {
            updateFields.push('subscription_expires = ?');
            updateValues.push(subscription_expires);
        }
        
        if (is_active !== undefined) {
            updateFields.push('is_active = ?');
            updateValues.push(is_active ? 1 : 0);
        }
        
        if (phone_verified !== undefined) {
            updateFields.push('phone_verified = ?');
            updateValues.push(phone_verified ? 1 : 0);
        }
        
        if (email_verified !== undefined) {
            updateFields.push('email_verified = ?');
            updateValues.push(email_verified ? 1 : 0);
        }
        
        if (tasks_limit !== undefined) {
            updateFields.push('tasks_limit = ?');
            updateValues.push(tasks_limit);
        }
        
        if (balance !== undefined) {
            updateFields.push('balance = ?');
            updateValues.push(balance);
        }
        
        if (first_name !== undefined) {
            updateFields.push('first_name = ?');
            updateValues.push(first_name);
        }
        
        if (last_name !== undefined) {
            updateFields.push('last_name = ?');
            updateValues.push(last_name);
        }
        
        if (email !== undefined && email.trim()) {
            if (!validateEmail(email)) {
                return res.status(400).json({
                    success: false,
                    error: 'Некорректный email адрес'
                });
            }
            
            // Проверяем уникальность email
            const existingUser = await db.get(
                'SELECT id FROM users WHERE email = ? AND id != ?',
                [email, userId]
            );
            
            if (existingUser) {
                return res.status(409).json({
                    success: false,
                    error: 'Этот email уже используется другим пользователем'
                });
            }
            
            updateFields.push('email = ?');
            updateValues.push(email);
        }
        
        if (phone !== undefined && phone.trim()) {
            const formattedPhone = formatPhone(phone);
            if (!validatePhone(formattedPhone)) {
                return res.status(400).json({
                    success: false,
                    error: 'Некорректный номер телефона'
                });
            }
            
            // Проверяем уникальность телефона
            const existingUser = await db.get(
                'SELECT id FROM users WHERE phone = ? AND id != ?',
                [formattedPhone, userId]
            );
            
            if (existingUser) {
                return res.status(409).json({
                    success: false,
                    error: 'Этот телефон уже используется другим пользователем'
                });
            }
            
            updateFields.push('phone = ?');
            updateValues.push(formattedPhone);
        }
        
        if (avatar_url !== undefined) {
            updateFields.push('avatar_url = ?');
            updateValues.push(avatar_url);
        }
        
        if (bio !== undefined) {
            updateFields.push('bio = ?');
            updateValues.push(bio);
        }
        
        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Нет данных для обновления'
            });
        }
        
        updateFields.push('updated_at = CURRENT_TIMESTAMP');
        updateValues.push(userId);
        
        const query = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`;
        
        await db.run(query, updateValues);
        
        const updatedUser = await db.get(
            `SELECT id, email, first_name, last_name, phone, phone_verified, role, 
                    subscription_plan, subscription_status, subscription_expires,
                    avatar_url, balance, initial_fee_paid, initial_fee_amount,
                    tasks_limit, tasks_used, user_rating, completed_tasks,
                    total_spent, is_active, last_login, email_verified, bio
             FROM users WHERE id = ?`,
            [userId]
        );
        
        res.json({
            success: true,
            message: 'Пользователь успешно обновлен',
            data: { user: updatedUser }
        });
        
    } catch (error) {
        console.error('❌ Ошибка обновления пользователя:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления пользователя'
        });
    }
});

// Создание пользователя администратором
app.post('/api/admin/users', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const { email, password, first_name, last_name, phone, role = 'client', 
                subscription_plan = 'essential', phone_verified = true } = req.body;
        
        if (!email || !password || !first_name) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля: email, пароль и имя'
            });
        }
        
        if (!validateEmail(email)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный email адрес'
            });
        }
        
        if (phone && !validatePhone(phone)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный номер телефона'
            });
        }
        
        const existingUser = await db.get('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUser) {
            return res.status(409).json({
                success: false,
                error: 'Пользователь с таким email уже существует'
            });
        }
        
        if (phone) {
            const formattedPhone = formatPhone(phone);
            const existingPhone = await db.get('SELECT id FROM users WHERE phone = ?', [formattedPhone]);
            if (existingPhone) {
                return res.status(409).json({
                    success: false,
                    error: 'Пользователь с таким телефоном уже существует'
                });
            }
        }
        
        const hashedPassword = await bcrypt.hash(password, 12);
        const avatarUrl = generateAvatarUrl(first_name, last_name, role);
        
        // Для администраторов и менеджеров не нужна подписка
        const isAdmin = ['admin', 'manager', 'superadmin'].includes(role);
        const finalSubscriptionPlan = isAdmin ? 'premium' : subscription_plan;
        const subscriptionStatus = isAdmin ? 'active' : 'pending';
        const tasksLimit = isAdmin ? 999 : 5;
        const initialFeePaid = isAdmin ? 1 : 0;
        
        const result = await db.run(
            `INSERT INTO users 
            (email, password, first_name, last_name, phone, phone_verified, role, 
             subscription_plan, subscription_status, tasks_limit, initial_fee_paid,
             avatar_url, email_verified) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                email,
                hashedPassword,
                first_name,
                last_name || '',
                phone ? formatPhone(phone) : null,
                phone_verified ? 1 : 0,
                role,
                finalSubscriptionPlan,
                subscriptionStatus,
                tasksLimit,
                initialFeePaid,
                avatarUrl,
                1
            ]
        );
        
        const userId = result.lastID;
        
        const user = await db.get(
            `SELECT id, email, first_name, last_name, phone, phone_verified, role, 
                    subscription_plan, subscription_status, avatar_url
             FROM users WHERE id = ?`,
            [userId]
        );
        
        res.status(201).json({
            success: true,
            message: 'Пользователь успешно создан',
            data: { 
                user,
                login_credentials: {
                    email: email,
                    password: password
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка создания пользователя:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания пользователя'
        });
    }
});

// Настройки системы
app.get('/api/admin/settings', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const settings = await db.all('SELECT * FROM settings ORDER BY category, key');
        
        // Преобразуем настройки в объект для удобства
        const settingsObject = {};
        settings.forEach(setting => {
            settingsObject[setting.key] = setting.value;
        });
        
        res.json({
            success: true,
            data: {
                settings: settingsObject,
                raw: settings
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения настроек:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения настроек'
        });
    }
});

// Сохранение настроек системы
app.post('/api/admin/settings', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const settings = req.body;
        
        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({
                success: false,
                error: 'Некорректные данные настроек'
            });
        }
        
        await db.exec('BEGIN TRANSACTION');
        
        try {
            for (const [key, value] of Object.entries(settings)) {
                await db.run(
                    `INSERT OR REPLACE INTO settings (key, value, updated_at) 
                     VALUES (?, ?, CURRENT_TIMESTAMP)`,
                    [key, value]
                );
            }
            
            await db.exec('COMMIT');
            
            res.json({
                success: true,
                message: 'Настройки успешно сохранены'
            });
            
        } catch (error) {
            await db.exec('ROLLBACK');
            throw error;
        }
        
    } catch (error) {
        console.error('❌ Ошибка сохранения настроек:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка сохранения настроек'
        });
    }
});

// Генерация отчетов
app.get('/api/admin/reports/:type', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const { type } = req.params;
        const { start_date, end_date } = req.query;
        
        let reportData = {};
        
        switch(type) {
            case 'financial':
                // Финансовый отчет
                let financialWhere = '';
                const financialParams = [];
                
                if (start_date) {
                    financialWhere += ' AND DATE(created_at) >= ?';
                    financialParams.push(start_date);
                }
                if (end_date) {
                    financialWhere += ' AND DATE(created_at) <= ?';
                    financialParams.push(end_date);
                }
                
                const financialReport = await db.all(`
                    SELECT 
                        DATE(created_at) as date,
                        type,
                        SUM(amount) as total_amount,
                        COUNT(*) as transaction_count
                    FROM transactions
                    WHERE status = 'completed' ${financialWhere}
                    GROUP BY DATE(created_at), type
                    ORDER BY date DESC, type
                `, financialParams);
                
                const dailyRevenue = await db.all(`
                    SELECT 
                        DATE(created_at) as date,
                        SUM(CASE WHEN type IN ('initial_fee', 'subscription') THEN amount ELSE 0 END) as revenue,
                        SUM(CASE WHEN type = 'payout' THEN amount ELSE 0 END) as expenses
                    FROM transactions
                    WHERE status = 'completed' ${financialWhere}
                    GROUP BY DATE(created_at)
                    ORDER BY date DESC
                `, financialParams);
                
                reportData = {
                    financial_summary: financialReport,
                    daily_revenue: dailyRevenue,
                    total_revenue: dailyRevenue.reduce((sum, day) => sum + (day.revenue || 0), 0),
                    total_expenses: dailyRevenue.reduce((sum, day) => sum + (day.expenses || 0), 0),
                    net_profit: dailyRevenue.reduce((sum, day) => sum + (day.revenue || 0) + (day.expenses || 0), 0)
                };
                break;
                
            case 'tasks':
                // Отчет по задачам
                let tasksWhere = '';
                const tasksParams = [];
                
                if (start_date) {
                    tasksWhere += ' WHERE DATE(t.created_at) >= ?';
                    tasksParams.push(start_date);
                }
                if (end_date) {
                    if (start_date) {
                        tasksWhere += ' AND DATE(t.created_at) <= ?';
                    } else {
                        tasksWhere += ' WHERE DATE(t.created_at) <= ?';
                    }
                    tasksParams.push(end_date);
                }
                
                const taskReport = await db.all(`
                    SELECT 
                        DATE(t.created_at) as date,
                        c.display_name as category,
                        t.status,
                        COUNT(*) as task_count,
                        AVG(t.price) as avg_price
                    FROM tasks t
                    LEFT JOIN categories c ON t.category_id = c.id
                    ${tasksWhere}
                    GROUP BY DATE(t.created_at), c.display_name, t.status
                    ORDER BY date DESC, category
                `, tasksParams);
                
                let statusWhere = '';
                const statusParams = [];
                
                if (start_date) {
                    statusWhere += ' WHERE DATE(created_at) >= ?';
                    statusParams.push(start_date);
                }
                if (end_date) {
                    if (start_date) {
                        statusWhere += ' AND DATE(created_at) <= ?';
                    } else {
                        statusWhere += ' WHERE DATE(created_at) <= ?';
                    }
                    statusParams.push(end_date);
                }
                
                const statusDistribution = await db.all(`
                    SELECT 
                        status,
                        COUNT(*) as count,
                        (COUNT(*) * 100.0 / (SELECT COUNT(*) FROM tasks ${statusWhere})) as percentage
                    FROM tasks
                    ${statusWhere}
                    GROUP BY status
                `, statusParams);
                
                reportData = {
                    task_summary: taskReport,
                    status_distribution: statusDistribution,
                    total_tasks: taskReport.reduce((sum, day) => sum + (day.task_count || 0), 0),
                    avg_completion_time: null // Можно добавить расчет
                };
                break;
                
            case 'users':
                // Отчет по пользователям
                let usersWhere = '';
                const usersParams = [];
                
                if (start_date) {
                    usersWhere += ' WHERE DATE(u.created_at) >= ?';
                    usersParams.push(start_date);
                }
                if (end_date) {
                    if (start_date) {
                        usersWhere += ' AND DATE(u.created_at) <= ?';
                    } else {
                        usersWhere += ' WHERE DATE(u.created_at) <= ?';
                    }
                    usersParams.push(end_date);
                }
                
                const userReport = await db.all(`
                    SELECT 
                        DATE(u.created_at) as date,
                        u.role,
                        u.subscription_plan,
                        COUNT(*) as user_count,
                        SUM(CASE WHEN u.subscription_status = 'active' THEN 1 ELSE 0 END) as active_subscriptions
                    FROM users u
                    ${usersWhere}
                    GROUP BY DATE(u.created_at), u.role, u.subscription_plan
                    ORDER BY date DESC
                `, usersParams);
                
                let growthWhere = '';
                const growthParams = [];
                
                if (start_date) {
                    growthWhere += ' WHERE DATE(created_at) >= ?';
                    growthParams.push(start_date);
                }
                if (end_date) {
                    if (start_date) {
                        growthWhere += ' AND DATE(created_at) <= ?';
                    } else {
                        growthWhere += ' WHERE DATE(created_at) <= ?';
                    }
                    growthParams.push(end_date);
                }
                
                const userGrowth = await db.all(`
                    SELECT 
                        DATE(created_at) as date,
                        COUNT(*) as new_users,
                        SUM(COUNT(*)) OVER (ORDER BY DATE(created_at)) as total_users
                    FROM users
                    ${growthWhere}
                    GROUP BY DATE(created_at)
                    ORDER BY date
                `, growthParams);
                
                reportData = {
                    user_summary: userReport,
                    user_growth: userGrowth,
                    total_users: userGrowth[userGrowth.length - 1]?.total_users || 0,
                    new_users_period: userGrowth.reduce((sum, day) => sum + (day.new_users || 0), 0)
                };
                break;
                
            default:
                return res.status(400).json({
                    success: false,
                    error: 'Неверный тип отчета'
                });
        }
        
        res.json({
            success: true,
            data: {
                report_type: type,
                period: { start_date, end_date },
                generated_at: new Date().toISOString(),
                ...reportData
            }
        });
        
    } catch (error) {
        console.error(`❌ Ошибка генерации отчета ${req.params.type}:`, error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка генерации отчета'
        });
    }
});

// Экспорт данных
app.get('/api/admin/export/:type', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const { type } = req.params;
        const { format = 'json' } = req.query;
        
        let data;
        let filename;
        
        switch(type) {
            case 'users':
                data = await db.all('SELECT * FROM users ORDER BY created_at DESC');
                filename = `users_export_${new Date().toISOString().split('T')[0]}`;
                break;
                
            case 'tasks':
                data = await db.all(`
                    SELECT t.*, 
                           c.display_name as category_name,
                           s.name as service_name,
                           u1.email as client_email,
                           u2.email as performer_email
                    FROM tasks t
                    LEFT JOIN categories c ON t.category_id = c.id
                    LEFT JOIN services s ON t.service_id = s.id
                    LEFT JOIN users u1 ON t.client_id = u1.id
                    LEFT JOIN users u2 ON t.performer_id = u2.id
                    ORDER BY t.created_at DESC
                `);
                filename = `tasks_export_${new Date().toISOString().split('T')[0]}`;
                break;
                
            case 'transactions':
                data = await db.all(`
                    SELECT t.*, u.email as user_email
                    FROM transactions t
                    LEFT JOIN users u ON t.user_id = u.id
                    ORDER BY t.created_at DESC
                `);
                filename = `transactions_export_${new Date().toISOString().split('T')[0]}`;
                break;
                
            default:
                return res.status(400).json({
                    success: false,
                    error: 'Неверный тип данных для экспорта'
                });
        }
        
        if (format === 'csv') {
            // Генерация CSV
            const csvData = convertToCSV(data);
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
            return res.send(csvData);
        } else {
            // JSON по умолчанию
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
            return res.json(data);
        }
        
    } catch (error) {
        console.error(`❌ Ошибка экспорта ${req.params.type}:`, error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка экспорта данных'
        });
    }
});

// Вспомогательная функция для конвертации в CSV
function convertToCSV(data) {
    if (!data || data.length === 0) return '';
    
    const headers = Object.keys(data[0]);
    const csvRows = [
        headers.join(','),
        ...data.map(row => 
            headers.map(header => {
                const value = row[header];
                // Экранируем запятые и кавычки
                const escaped = ('' + value).replace(/"/g, '""');
                return `"${escaped}"`;
            }).join(',')
        )
    ];
    
    return csvRows.join('\n');
}

// ==================== ДОПОЛНИТЕЛЬНЫЕ API МАРШРУТЫ ====================

// Получение топ услуг
app.get('/api/services/top', async (req, res) => {
    try {
        const services = await db.all(`
            SELECT s.*, c.display_name as category_name, c.icon as category_icon
            FROM services s
            LEFT JOIN categories c ON s.category_id = c.id
            WHERE s.is_active = 1 AND s.is_featured = 1
            ORDER BY s.sort_order ASC, s.name ASC
            LIMIT 6
        `);
        
        res.json({
            success: true,
            data: {
                services,
                count: services.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения топ услуг:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения топ услуг'
        });
    }
});

// Получение всех услуг
app.get('/api/services', async (req, res) => {
    try {
        const services = await db.all(`
            SELECT s.*, c.display_name as category_name, c.icon as category_icon
            FROM services s
            LEFT JOIN categories c ON s.category_id = c.id
            WHERE s.is_active = 1
            ORDER BY c.sort_order ASC, s.sort_order ASC, s.name ASC
        `);
        
        res.json({
            success: true,
            data: {
                services,
                count: services.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения всех услуг:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения услуг'
        });
    }
});

// Выбор подписки - исправленная версия
app.post('/api/subscriptions/select', authMiddleware(['client']), async (req, res) => {
    try {
        const { subscription_plan } = req.body;
        
        console.log('Выбор подписки:', { 
            user_id: req.user.id, 
            subscription_plan,
            current_subscription: req.user.subscription_plan 
        });
        
        if (!subscription_plan) {
            return res.status(400).json({
                success: false,
                error: 'Не указан тарифный план'
            });
        }
        
        // Проверяем, подтвержден ли телефон
        if (!req.user.phone_verified) {
            return res.status(403).json({
                success: false,
                error: 'Для выбора подписки необходимо подтвердить телефон',
                requires_phone_verification: true,
                user_phone: req.user.phone,
                user_id: req.user.id
            });
        }
        
        const subscription = await db.get(
            'SELECT * FROM subscriptions WHERE name = ? AND is_active = 1',
            [subscription_plan]
        );
        
        if (!subscription) {
            return res.status(404).json({
                success: false,
                error: 'Тарифный план не найден'
            });
        }
        
        // В демо-режиме автоматически активируем подписку
        if (DEMO_MODE) {
            console.log(`📱 [DEMO MODE] Активация подписки ${subscription_plan} для пользователя: ${req.user.phone}`);
            
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + 30);
            const expiryDateStr = expiryDate.toISOString().split('T')[0];
            
            await db.run(
                `UPDATE users SET 
                    subscription_plan = ?,
                    subscription_status = 'active',
                    subscription_expires = ?,
                    initial_fee_paid = 1,
                    tasks_limit = ?,
                    updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [subscription_plan, expiryDateStr, subscription.tasks_limit, req.user.id]
            );
            
            // Создаем транзакцию для вступительного взноса
            if (subscription.initial_fee > 0) {
                await db.run(
                    `INSERT INTO transactions 
                    (user_id, type, amount, description, status) 
                    VALUES (?, ?, ?, ?, ?)`,
                    [
                        req.user.id,
                        'initial_fee',
                        -subscription.initial_fee,
                        `Вступительный взнос: ${subscription.display_name}`,
                        'completed'
                    ]
                );
            }
            
            // Создаем уведомление
            await db.run(
                `INSERT INTO notifications 
                (user_id, type, title, message) 
                VALUES (?, ?, ?, ?)`,
                [
                    req.user.id,
                    'subscription_activated',
                    'Подписка активирована!',
                    `Поздравляем! Вы успешно активировали подписку "${subscription.display_name}". Теперь вы можете создавать задачи.`
                ]
            );
            
            // Обновляем данные пользователя
            const updatedUser = await db.get(
                `SELECT id, email, first_name, last_name, phone, phone_verified, role, 
                        subscription_plan, subscription_status, subscription_expires,
                        initial_fee_paid, initial_fee_amount, avatar_url, tasks_limit, tasks_used,
                        user_rating
                 FROM users WHERE id = ?`,
                [req.user.id]
            );
            
            const userForResponse = {
                ...updatedUser,
                rating: updatedUser.user_rating
            };
            
            return res.json({
                success: true,
                message: 'Подписка успешно активирована! (Демо-режим)',
                data: {
                    user: userForResponse,
                    subscription,
                    demo_mode: true
                }
            });
        }
        
        // В реальном режиме проверяем вступительный взнос
        if (subscription.initial_fee > 0 && !req.user.initial_fee_paid) {
            return res.status(402).json({
                success: false,
                error: 'Для активации подписки необходимо оплатить вступительный взнос',
                requires_initial_fee: true,
                initial_fee_amount: subscription.initial_fee,
                current_balance: req.user.balance
            });
        }
        
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 30);
        const expiryDateStr = expiryDate.toISOString().split('T')[0];
        
        await db.run(
            `UPDATE users SET 
                subscription_plan = ?,
                subscription_status = 'active',
                subscription_expires = ?,
                tasks_limit = ?,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [subscription_plan, expiryDateStr, subscription.tasks_limit, req.user.id]
        );
        
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message) 
            VALUES (?, ?, ?, ?)`,
            [
                req.user.id,
                'subscription_activated',
                'Подписка активирована!',
                `Поздравляем! Вы успешно активировали подписку "${subscription.display_name}". Теперь вы можете создавать задачи.`
            ]
        );
        
        const updatedUser = await db.get(
            `SELECT id, email, first_name, last_name, phone, phone_verified, role, 
                    subscription_plan, subscription_status, subscription_expires,
                    initial_fee_paid, initial_fee_amount, avatar_url, tasks_limit, tasks_used,
                    user_rating
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        
        const userForResponse = {
            ...updatedUser,
            rating: updatedUser.user_rating
        };
        
        res.json({
            success: true,
            message: 'Подписка успешно активирована!',
            data: {
                user: userForResponse,
                subscription,
                demo_mode: false
            }
        });
        
    } catch (error) {
        console.error('Ошибка выбора подписки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка выбора подписки'
        });
    }
});

// Получение последних задач пользователя
app.get('/api/tasks/recent', authMiddleware(), async (req, res) => {
    try {
        const tasks = await db.all(`
            SELECT t.*, c.display_name as category_name
            FROM tasks t
            LEFT JOIN categories c ON t.category_id = c.id
            WHERE t.client_id = ?
            ORDER BY t.created_at DESC
            LIMIT 5
        `, [req.user.id]);
        
        res.json({
            success: true,
            data: {
                tasks,
                count: tasks.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения последних задач:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения задач'
        });
    }
});

// Отправка SMS кода - альтернативный маршрут
app.post('/api/auth/send-verification-code', async (req, res) => {
    try {
        const { phone } = req.body;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Не указан номер телефона'
            });
        }
        
        const formattedPhone = formatPhone(phone);
        if (!validatePhone(formattedPhone)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный номер телефона'
            });
        }
        
        const user = await db.get('SELECT id, phone_verified FROM users WHERE phone = ?', [formattedPhone]);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        if (user.phone_verified) {
            return res.status(400).json({
                success: false,
                error: 'Телефон уже подтвержден'
            });
        }
        
        const lastCode = await db.get(
            `SELECT created_at FROM phone_verification_codes 
             WHERE phone = ? AND verified = 0 
             ORDER BY created_at DESC LIMIT 1`,
            [formattedPhone]
        );
        
        if (lastCode) {
            const lastSent = new Date(lastCode.created_at);
            const now = new Date();
            const diffSeconds = (now - lastSent) / 1000;
            
            if (diffSeconds < 60) {
                return res.status(429).json({
                    success: false,
                    error: `Подождите ${Math.ceil(60 - diffSeconds)} секунд перед повторной отправкой`
                });
            }
        }
        
        const smsCode = generateVerificationCode();
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 10);
        
        await db.run(
            `INSERT INTO phone_verification_codes (phone, code, expires_at) 
             VALUES (?, ?, ?)`,
            [formattedPhone, smsCode, expiresAt.toISOString()]
        );
        
        const smsResult = await sendSmsCode(formattedPhone, smsCode);
        
        if (!smsResult.success) {
            return res.status(500).json({
                success: false,
                error: 'Ошибка отправки SMS',
                demo_mode: DEMO_MODE
            });
        }
        
        res.json({
            success: true,
            message: 'Код подтверждения отправлен',
            data: {
                phone: formattedPhone,
                demo_mode: smsResult.demo || false,
                expires_in_minutes: 10,
                can_resend_after_seconds: 60
            }
        });
        
    } catch (error) {
        console.error('Ошибка отправки кода подтверждения:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка отправки кода подтверждения'
        });
    }
});

// Завершение задачи клиентом
app.put('/api/tasks/:id/complete', authMiddleware(['client', 'admin', 'superadmin']), async (req, res) => {
    try {
        const taskId = req.params.id;
        
        const task = await db.get(
            'SELECT * FROM tasks WHERE id = ?',
            [taskId]
        );
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        if (req.user.id !== task.client_id && !['admin', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'Только клиент или администратор может завершить задачу'
            });
        }
        
        if (!['assigned', 'in_progress'].includes(task.status)) {
            return res.status(400).json({
                success: false,
                error: 'Можно завершить только назначенные задачи или задачи в работе'
            });
        }
        
        await db.run(
            `UPDATE tasks SET 
                status = 'completed',
                completed_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [taskId]
        );
        
        await db.run(
            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
             VALUES (?, ?, ?, ?)`,
            [taskId, 'completed', req.user.id, 'Задача завершена клиентом']
        );
        
        if (task.performer_id) {
            await db.run(
                `INSERT INTO notifications 
                (user_id, type, title, message, related_id, related_type) 
                VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    task.performer_id,
                    'task_completed_by_client',
                    'Задача завершена',
                    `Клиент подтвердил завершение задачи "${task.title}"`,
                    taskId,
                    'task'
                ]
            );
            
            await db.run(
                'UPDATE users SET completed_tasks = completed_tasks + 1 WHERE id = ?',
                [task.performer_id]
            );
        }
        
        res.json({
            success: true,
            message: 'Задача успешно завершена',
            data: {
                task_id: taskId,
                status: 'completed'
            }
        });
        
    } catch (error) {
        console.error('Ошибка завершения задачи:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка завершения задачи'
        });
    }
});

// ==================== ОБСЛУЖИВАНИЕ ====================

// Обслуживание статических файлов
app.use(express.static(path.join(__dirname, 'public')));

// Обработка 404 для API маршрутов
app.use('/api/*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'API маршрут не найден'
    });
});

// SPA маршрутизация
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== ОБРАБОТКА ОШИБОК ====================
app.use((err, req, res, next) => {
    console.error('🔥 Ошибка сервера:', err.message);
    
    res.status(500).json({
        success: false,
        error: 'Внутренняя ошибка сервера',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎀 ЗАПУСК ЖЕНСКОГО КОНСЬЕРЖА v6.0.0');
        console.log('='.repeat(80));
        console.log(`🌐 PORT: ${process.env.PORT || 3000}`);
        console.log(`🏷️  NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
        console.log(`📱 Демо-режим SMS: ${DEMO_MODE ? 'ВКЛЮЧЕН' : 'ВЫКЛЮЧЕН'}`);
        console.log(`💾 База данных: ${process.env.NODE_ENV === 'production' ? '/tmp/concierge_prod.db' : './concierge.db'}`);
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        console.log('✅ SMS верификация настроена');
        console.log('✅ Все API настроены');
        
        const PORT = process.env.PORT || 3000;
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log('\n' + '='.repeat(80));
            console.log(`✅ Сервер запущен на порту ${PORT}`);
            console.log(`🌐 http://localhost:${PORT}`);
            console.log(`🌐 Панель исполнителя: http://localhost:${PORT}/performer.html`);
            console.log(`🏥 Health check: http://localhost:${PORT}/health`);
            console.log('='.repeat(80));
            console.log('🎀 СИСТЕМА ГОТОВА К РАБОТЕ!');
            console.log('='.repeat(80));
            
            console.log('\n🔑 ТЕСТОВЫЕ АККАУНТЫ:');
            console.log('='.repeat(70));
            console.log('👑 Главный админ: +79991112233 / admin123');
            console.log('👨‍💼 Админ: +79992223344 / admin123');
            console.log('👩‍🏫 Помощник 1: +79994445566 / performer123');
            console.log('👩‍🏫 Помощник 2: +79995556677 / performer123');
            console.log('👩‍🏫 Помощник 3: +79996667788 / performer123');
            console.log('👩 Клиент Премиум: +79997778899 / client123');
            console.log('👩 Клиент Эссеншл: +79998889900 / client123');
            console.log('='.repeat(70));
            
            console.log('\n📊 ОСНОВНЫЕ ФУНКЦИОНАЛЬНОСТИ:');
            console.log('='.repeat(60));
            console.log('✅ Регистрация клиентов и исполнителей');
            console.log('✅ SMS верификация телефона');
            console.log('✅ Подписки и вступительные взносы');
            console.log('✅ Создание и управление задачами');
            console.log('✅ Система чатов и уведомлений');
            console.log('✅ Отзывы и рейтинги');
            console.log('✅ Панель исполнителя со всеми функциями');
            console.log('✅ Админ панель с полным управлением');
            console.log('✅ Финансовая отчетность и статистика');
            console.log('='.repeat(60));
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        process.exit(1);
    }
};

// Запуск
startServer();
