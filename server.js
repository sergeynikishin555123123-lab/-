// server.js - ИСПРАВЛЕННАЯ ВЕРСИЯ С ВЕСЬМ ФУНКЦИОНАЛОМ
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
const fsSync = require('fs');

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

// Специальный middleware для обработки статических файлов с CORS
app.use('/uploads', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Max-Age', '86400');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    next();
});

// Упрощенный маршрут для статических файлов
app.get('/uploads/*', (req, res) => {
    const filePath = path.join(__dirname, 'public', req.path);
    
    if (fsSync.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
            '.svg': 'image/svg+xml',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.webp': 'image/webp',
            '.gif': 'image/gif'
        };
        
        if (mimeTypes[ext]) {
            res.set('Content-Type', mimeTypes[ext]);
        }
        
        return res.sendFile(filePath);
    }
    
    // Если файл не найден, возвращаем placeholder
    res.redirect(`/api/images/test/${req.path.includes('logo') ? 'logo' : 'default'}`);
});

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
    setHeaders: (res, filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        
        // Настройки кэширования для разных типов файлов
        if (ext.match(/\.(jpg|jpeg|png|gif|webp|svg|ico)$/)) {
            res.set('Cache-Control', 'public, max-age=31536000');
        } else if (ext.match(/\.(css|js)$/)) {
            res.set('Cache-Control', 'public, max-age=86400');
        } else {
            res.set('Cache-Control', 'public, max-age=3600');
        }
        
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('X-Frame-Options', 'DENY');
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Access-Control-Allow-Methods', 'GET');
    }
}));

// ==================== КОНФИГУРАЦИЯ ====================
const DEMO_MODE = true;

// ==================== УЛУЧШЕННАЯ НАСТРОЙКА ЗАГРУЗКИ ФАЙЛОВ ====================

// Функция для создания директорий
const ensureUploadDirs = () => {
    const dirs = [
        'public/uploads',
        'public/uploads/categories',
        'public/uploads/users',
        'public/uploads/services',
        'public/uploads/tasks',
        'public/uploads/logo'
    ];
    
    dirs.forEach(dir => {
        if (!fsSync.existsSync(dir)) {
            fsSync.mkdirSync(dir, { recursive: true });
            console.log(`✅ Создана директория: ${dir}`);
        }
    });
};

// Настраиваем хранилище
const categoryStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        ensureUploadDirs();
        cb(null, 'public/uploads/categories');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname).toLowerCase();
        const filename = `category-${uniqueSuffix}${extension}`;
        console.log(`📁 Сохранение изображения категории: ${filename}`);
        cb(null, filename);
    }
});

const userStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        ensureUploadDirs();
        cb(null, 'public/uploads/users');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname).toLowerCase();
        const filename = `user-${uniqueSuffix}${extension}`;
        cb(null, filename);
    }
});

const logoStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        ensureUploadDirs();
        cb(null, 'public/uploads/logo');
    },
    filename: function (req, file, cb) {
        const extension = path.extname(file.originalname).toLowerCase();
        const filename = `logo${extension}`;
        console.log(`📁 Сохранение логотипа: ${filename}`);
        cb(null, filename);
    }
});

const generalStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        ensureUploadDirs();
        cb(null, 'public/uploads');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname).toLowerCase();
        const filename = `file-${uniqueSuffix}${extension}`;
        cb(null, filename);
    }
});

// Фильтр файлов
const imageFilter = function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|svg|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
        return cb(null, true);
    } else {
        cb(new Error('Только изображения разрешены'));
    }
};

// Создаем загрузчики
const uploadCategoryImage = multer({ 
    storage: categoryStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: imageFilter
});

const uploadUserAvatar = multer({ 
    storage: userStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: imageFilter
});

const uploadLogo = multer({ 
    storage: logoStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: imageFilter
});

const uploadGeneral = multer({ 
    storage: generalStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: imageFilter
});

// Инициализируем директории
ensureUploadDirs();

// ==================== СИНХРОНИЗАЦИЯ ИЗОБРАЖЕНИЙ ====================

// Функция для создания дефолтных изображений
const createDefaultImage = (type, text = '') => {
    const colors = {
        logo: { bg: '#F2DDE6', text: '#C5A880' },
        category: { bg: '#FAF2F6', text: '#C5A880' },
        user: { bg: '#E8CCD9', text: '#C5A880' },
        service: { bg: '#F9F7F3', text: '#C5A880' },
        default: { bg: '#F9F7F3', text: '#888' }
    };
    
    const color = colors[type] || colors.default;
    const displayText = text || type.charAt(0).toUpperCase();
    
    return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
        <rect width="200" height="200" fill="${color.bg}" rx="20"/>
        <text x="100" y="100" font-family="Arial" font-size="60" font-weight="bold" 
              fill="${color.text}" text-anchor="middle" dy=".3em">${displayText}</text>
        <text x="100" y="180" font-family="Arial" font-size="12" text-anchor="middle" 
              fill="#666">${type}</text>
    </svg>`;
};

// Инициализация дефолтных изображений при запуске
const initDefaultImages = async () => {
    const defaultImages = [
        { dir: 'uploads/logo', file: 'logo.svg', type: 'logo' },
        { dir: 'uploads/categories', file: 'default.svg', type: 'category' },
        { dir: 'uploads/users', file: 'default.svg', type: 'user' },
        { dir: 'uploads/services', file: 'default.svg', type: 'service' },
        { dir: 'uploads', file: 'default.svg', type: 'default' }
    ];
    
    for (const img of defaultImages) {
        const dirPath = path.join(__dirname, 'public', img.dir);
        const filePath = path.join(dirPath, img.file);
        
        if (!fsSync.existsSync(dirPath)) {
            fsSync.mkdirSync(dirPath, { recursive: true });
        }
        
        if (!fsSync.existsSync(filePath)) {
            await fs.writeFile(filePath, createDefaultImage(img.type));
            console.log(`✅ Создано дефолтное изображение: ${filePath}`);
        }
    }
};

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
                ['sms_cooldown_seconds', '60', 'Задержка между отправкой SMS (секунд)', 'sms'],
                ['site_logo', '/api/image/logo', 'Логотип сайта', 'appearance']
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
                ['home_and_household', 'Дом и быт', 'Уборка, готовка, уход за домом', '🏠', '/api/image/category', '#FF6B8B', 1, 1],
                ['family_and_children', 'Семья и дети', 'Няни, репетиторы, помощь с детьми', '👨‍👩‍👧‍👦', '/api/image/category', '#3498DB', 2, 1],
                ['beauty_and_health', 'Красота и здоровье', 'Маникюр, массаж, парикмахерские услуги', '💅', '/api/image/category', '#9B59B6', 3, 1],
                ['courses_and_education', 'Образование', 'Репетиторство, обучение, курсы', '🎓', '/api/image/category', '#2ECC71', 4, 1],
                ['shopping_and_delivery', 'Покупки и доставка', 'Покупка и доставка товаров', '🛒', '/api/image/category', '#E74C3C', 5, 1],
                ['events_and_organization', 'События и организация', 'Организация мероприятий и праздников', '🎉', '/api/image/category', '#F39C12', 6, 1]
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
                // Дом и быт
                [categoryMap.home_and_household, 'Уборка квартиры', 'Генеральная или поддерживающая уборка квартиры', 0, '2-4 часа', 1, 1, 1],
                [categoryMap.home_and_household, 'Химчистка мебели', 'Профессиональная химчистка диванов, кресел, матрасов', 0, '3-5 часов', 1, 2, 0],
                [categoryMap.home_and_household, 'Стирка и глажка', 'Стирка, сушка и глажка белья', 0, '2-3 часа', 1, 3, 0],
                [categoryMap.home_and_household, 'Приготовление еды', 'Приготовление блюд на день или неделю', 0, '3-4 часа', 1, 4, 1],
                
                // Дети и семья
                [categoryMap.family_and_children, 'Няня на час', 'Присмотр за детьми на несколько часов', 0, '1 час', 1, 5, 1],
                [categoryMap.family_and_children, 'Репетитор для ребенка', 'Помощь с уроками по школьным предметам', 0, '1 час', 1, 6, 0],
                
                // Красота и здоровье
                [categoryMap.beauty_and_health, 'Маникюр на дому', 'Профессиональный маникюр с выездом', 0, '1.5 часа', 1, 7, 1],
                [categoryMap.beauty_and_health, 'Стрижка и укладка', 'Парикмахерские услуги на дому', 0, '2 часа', 1, 8, 0],
                [categoryMap.beauty_and_health, 'Массаж', 'Расслабляющий или лечебный массаж', 0, '1 час', 1, 9, 1],
                
                // Курсы и образование
                [categoryMap.courses_and_education, 'Репетиторство', 'Индивидуальные занятия по предметы', 0, '1 час', 1, 10, 1],
                
                // Покупки и доставка
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
                ['superadmin@concierge.test', passwordHash, 'Александр', 'Иванов', '+79991112233', 1, 'superadmin', 'premium', 'active', expiryDateStr, '/api/image/user', 0, 1000, 1, 1000, 999, 3, 5, 0, 4.9, 100, 1, 1, null, null, null],
                
                // Администраторы
                ['admin@concierge.test', passwordHash, 'Мария', 'Петрова', '+79992223344', 1, 'admin', 'premium', 'active', expiryDateStr, '/api/image/user', 0, 1000, 1, 1000, 999, 2, 5, 0, 4.8, 50, 1, 1, null, null, null],
                
                // Помощники
                ['performer1@concierge.test', performerPasswordHash, 'Анна', 'Кузнецова', '+79994445566', 1, 'performer', 'essential', 'active', expiryDateStr, '/api/image/user', 0, 500, 1, 500, 20, 5, 5, 0, 4.5, 30, 1, 1, null, null, null],
                ['performer2@concierge.test', performerPasswordHash, 'Мария', 'Смирнова', '+79995556677', 1, 'performer', 'essential', 'active', expiryDateStr, '/api/image/user', 0, 500, 1, 500, 20, 8, 5, 0, 4.6, 45, 1, 1, null, null, null],
                ['performer3@concierge.test', performerPasswordHash, 'Ирина', 'Васильева', '+79996667788', 1, 'performer', 'premium', 'active', expiryDateStr, '/api/image/user', 0, 1000, 1, 1000, 50, 15, 5, 0, 4.8, 60, 1, 1, null, null, null],
                
                // Клиенты
                ['client1@concierge.test', clientPasswordHash, 'Елена', 'Васильева', '+79997778899', 1, 'client', 'premium', 'active', expiryDateStr, '/api/image/user', 0, 1000, 1, 1000, 999, 2, 5, 0, 4.0, 10, 1, 1, null, null, null],
                ['client2@concierge.test', clientPasswordHash, 'Наталья', 'Федорова', '+79998889900', 1, 'client', 'essential', 'active', expiryDateStr, '/api/image/user', 0, 500, 1, 500, 5, 1, 5, 0, 4.5, 3, 1, 1, null, null, null],
                ['client3@concierge.test', clientPasswordHash, 'Оксана', 'Николаева', '+79999990011', 0, 'client', 'essential', 'pending', null, '/api/image/user', 0, 500, 0, 500, 5, 0, 5, 0, 0, 0, 1, 1, null, null, null]
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
                                null, // performer_id изначально null
                                category.id,
                                service.id,
                                'searching', // Начальный статус - поиск исполнителя
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
    
    const formattedPhone = formatPhone(phone);
    
    const russianRegex = /^\+7\d{10}$/;
    const internationalRegex = /^\+\d{10,15}$/;
    
    return russianRegex.test(formattedPhone) || internationalRegex.test(formattedPhone);
};

const formatPhone = (phone) => {
    if (!phone) return '';
    
    let cleaned = phone.toString().trim();
    const hasPlus = cleaned.startsWith('+');
    cleaned = cleaned.replace(/[^\d]/g, '');
    
    if (cleaned.length === 0) return '';
    
    let result = '';
    
    if (cleaned.startsWith('7')) {
        if (cleaned.length === 11) {
            result = '+7' + cleaned.substring(1);
        } else if (cleaned.length === 10) {
            result = '+7' + cleaned;
        } else if (cleaned.length === 9) {
            result = '+79' + cleaned.substring(1);
        } else {
            result = '+' + cleaned;
        }
    } else if (cleaned.startsWith('8')) {
        if (cleaned.length === 11) {
            result = '+7' + cleaned.substring(1);
        } else if (cleaned.length === 10) {
            result = '+7' + cleaned.substring(1);
        } else if (cleaned.length === 9) {
            result = '+7' + cleaned;
        } else {
            result = '+7' + cleaned.substring(1);
        }
    } else if (cleaned.length === 10 && cleaned.startsWith('9')) {
        result = '+7' + cleaned;
    } else if (cleaned.length < 10 && cleaned.startsWith('9')) {
        result = '+7' + cleaned;
    } else if (hasPlus && cleaned.length === 11) {
        result = '+' + cleaned;
    } else if (hasPlus && cleaned.length === 10) {
        result = '+' + cleaned;
    } else {
        if (cleaned.length >= 10) {
            const last10 = cleaned.substring(cleaned.length - 10);
            result = '+7' + last10;
        } else {
            result = '+7' + cleaned;
        }
    }
    
    if (!result.startsWith('+7')) {
        result = '+7' + result.replace(/^\+/, '');
    }
    
    if (result.length > 12) {
        result = result.substring(0, 12);
    }
    
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
    
    return `/api/image/user?name=${encodeURIComponent(firstName)}+${encodeURIComponent(lastName)}&background=${avatarBgColor}`;
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
                'GET /api/services/top',
                'GET /api/faq',
                'GET /api/reviews',
                'POST /api/auth/register',
                'POST /api/auth/register-performer',
                'POST /api/auth/login',
                'POST /api/auth/verify-phone',
                'POST /api/auth/send-verification',
                'POST /api/auth/send-verification-code',
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

// ==================== API ЗАГРУЗКИ ФОТО ====================

// Загрузка логотипа сайта
app.post('/api/admin/upload-logo', authMiddleware(['admin', 'superadmin']), uploadLogo.single('logo'), async (req, res) => {
    try {
        console.log('📤 Загрузка логотипа сайта...');
        
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'Файл логотипа не был загружен'
            });
        }
        
        const fileUrl = `/uploads/logo/${req.file.filename}`;
        console.log(`✅ Логотип сохранен: ${fileUrl}`);
        
        await db.run(
            `INSERT OR REPLACE INTO settings (key, value, description, category, updated_at) 
             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            ['site_logo', fileUrl, 'Логотип сайта', 'appearance']
        );
        
        res.json({
            success: true,
            message: 'Логотип успешно загружен и установлен',
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
        console.error('❌ Ошибка загрузки логотипа:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка загрузки логотипа'
        });
    }
});

// Загрузка изображения категории
app.post('/api/admin/upload-category-image', authMiddleware(['admin', 'superadmin']), uploadCategoryImage.single('image'), async (req, res) => {
    try {
        console.log('📤 Загрузка изображения категории...');
        
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'Файл изображения не был загружен'
            });
        }
        
        const fileUrl = `/uploads/categories/${req.file.filename}`;
        console.log(`✅ Изображение категории сохранено: ${fileUrl}`);
        
        if (req.body.category_id) {
            await db.run(
                'UPDATE categories SET image_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [fileUrl, req.body.category_id]
            );
            console.log(`✅ Изображение привязано к категории ID: ${req.body.category_id}`);
        }
        
        res.json({
            success: true,
            message: 'Изображение категории успешно загружено',
            data: {
                filename: req.file.filename,
                originalname: req.file.originalname,
                size: req.file.size,
                mimetype: req.file.mimetype,
                url: fileUrl,
                path: req.file.path,
                category_id: req.body.category_id || null
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка загрузки изображения категории:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка загрузки изображения категории'
        });
    }
});

// Загрузка аватара пользователя
app.post('/api/admin/upload-user-avatar', authMiddleware(['admin', 'superadmin']), uploadUserAvatar.single('avatar'), async (req, res) => {
    try {
        console.log('📤 Загрузка аватара пользователя...');
        
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'Файл аватара не был загружен'
            });
        }
        
        const fileUrl = `/uploads/users/${req.file.filename}`;
        console.log(`✅ Аватар пользователя сохранен: ${fileUrl}`);
        
        res.json({
            success: true,
            message: 'Аватар пользователя успешно загружен',
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
        console.error('❌ Ошибка загрузки аватара пользователя:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка загрузки аватара пользователя'
        });
    }
});

// Простая загрузка файла
app.post('/api/admin/upload', authMiddleware(['admin', 'superadmin']), uploadGeneral.single('image'), async (req, res) => {
    try {
        console.log('📤 Загрузка файла через универсальный endpoint...');
        
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'Файл не был загружен'
            });
        }
        
        let fileUrl = `/uploads/${req.file.filename}`;
        
        if (req.body.type === 'logo') {
            fileUrl = `/uploads/logo/${req.file.filename}`;
            
            await db.run(
                `INSERT OR REPLACE INTO settings (key, value, description, category, updated_at) 
                 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                ['site_logo', fileUrl, 'Логотип сайта', 'appearance']
            );
            
            console.log(`✅ Логотип сохранен в настройках: ${fileUrl}`);
        } else if (req.body.type === 'category') {
            fileUrl = `/uploads/categories/${req.file.filename}`;
            console.log(`✅ Изображение категории сохранено: ${fileUrl}`);
        }
        
        console.log(`✅ Файл сохранен: ${fileUrl}`);
        
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

// Общая загрузка файла
app.post('/api/admin/upload-file', authMiddleware(['admin', 'superadmin']), uploadGeneral.single('file'), async (req, res) => {
    try {
        console.log('📤 Общая загрузка файла...');
        
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'Файл не был загружен'
            });
        }
        
        const fileUrl = `/uploads/${req.file.filename}`;
        console.log(`✅ Файл сохранен: ${fileUrl}`);
        
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
        
        const getAllFiles = async (dir, basePath = '') => {
            const files = await fs.readdir(dir);
            const fileList = [];
            
            for (const file of files) {
                const fullPath = path.join(dir, file);
                const stat = await fs.stat(fullPath);
                
                if (stat.isDirectory()) {
                    const subFiles = await getAllFiles(fullPath, path.join(basePath, file));
                    fileList.push(...subFiles);
                } else {
                    const fileUrl = `/uploads${basePath ? '/' + basePath : ''}/${file}`;
                    const extension = path.extname(file).toLowerCase();
                    const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(extension);
                    
                    fileList.push({
                        filename: file,
                        url: fileUrl,
                        path: fullPath,
                        size: stat.size,
                        modified: stat.mtime,
                        isImage,
                        extension
                    });
                }
            }
            
            return fileList;
        };
        
        const fileList = await getAllFiles(uploadsDir);
        
        fileList.sort((a, b) => {
            if (a.isImage !== b.isImage) {
                return a.isImage ? -1 : 1;
            }
            return b.modified - a.modified;
        });
        
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

// Удаление загруженного файла
app.delete('/api/admin/uploads/:filename', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(__dirname, 'public/uploads', filename);
        
        try {
            await fs.access(filePath);
        } catch {
            return res.status(404).json({
                success: false,
                error: 'Файл не найден'
            });
        }
        
        const fileUrl = `/uploads/${filename}`;
        
        const usedInCategories = await db.get(
            'SELECT 1 FROM categories WHERE image_url = ? LIMIT 1',
            [fileUrl]
        );
        
        const usedInUsers = await db.get(
            'SELECT 1 FROM users WHERE avatar_url = ? LIMIT 1',
            [fileUrl]
        );
        
        const usedInSettings = await db.get(
            'SELECT 1 FROM settings WHERE value = ? LIMIT 1',
            [fileUrl]
        );
        
        if (usedInCategories || usedInUsers || usedInSettings) {
            return res.status(400).json({
                success: false,
                error: 'Файл используется в системе и не может быть удален'
            });
        }
        
        await fs.unlink(filePath);
        
        res.json({
            success: true,
            message: 'Файл успешно удален',
            data: { filename }
        });
        
    } catch (error) {
        console.error('❌ Ошибка удаления файла:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка удаления файла'
        });
    }
});

// ==================== API ДЛЯ ПОЛУЧЕНИЯ ИЗОБРАЖЕНИЙ С FALLBACK ====================

// API для получения изображений с fallback
app.get('/api/image/:type/:id?', async (req, res) => {
    try {
        const { type, id } = req.params;
        let imageUrl = null;
        
        switch(type) {
            case 'logo':
                const logoSetting = await db.get("SELECT value FROM settings WHERE key = 'site_logo'");
                imageUrl = logoSetting?.value || '/uploads/logo/logo.svg';
                break;
                
            case 'category':
                if (id) {
                    const category = await db.get('SELECT image_url FROM categories WHERE id = ?', [id]);
                    imageUrl = category?.image_url || '/uploads/categories/default.svg';
                } else {
                    imageUrl = '/uploads/categories/default.svg';
                }
                break;
                
            case 'user':
                if (id) {
                    const user = await db.get('SELECT avatar_url FROM users WHERE id = ?', [id]);
                    imageUrl = user?.avatar_url || '/uploads/users/default.svg';
                } else {
                    imageUrl = '/uploads/users/default.svg';
                }
                break;
                
            default:
                imageUrl = '/uploads/default.svg';
        }
        
        const filePath = path.join(__dirname, 'public', imageUrl);
        
        if (fsSync.existsSync(filePath)) {
            const ext = path.extname(filePath).toLowerCase();
            const mimeTypes = {
                '.svg': 'image/svg+xml',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.webp': 'image/webp'
            };
            
            res.set('Content-Type', mimeTypes[ext] || 'image/svg+xml');
            res.set('Cache-Control', 'public, max-age=86400');
            res.set('Access-Control-Allow-Origin', '*');
            return res.sendFile(filePath);
        }
        
        // Fallback SVG
        res.set('Content-Type', 'image/svg+xml');
        res.send(createDefaultImage(type, id));
        
    } catch (error) {
        console.error(`Ошибка загрузки изображения ${type}:`, error.message);
        res.set('Content-Type', 'image/svg+xml');
        res.send(createDefaultImage('default', 'Error'));
    }
});

// ==================== АУТЕНТИФИКАЦИЯ ====================

// Регистрация клиента
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, first_name, last_name = '', phone, subscription_plan = 'essential' } = req.body;
        
        console.log('📝 Регистрация клиента:', { phone, first_name });
        
        // ОСНОВНОЕ ИЗМЕНЕНИЕ: телефон обязателен, email опционален
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
        
        // Email теперь необязателен
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
        
        // Email проверяем только если он передан
        if (email && email.trim()) {
            const existingEmail = await db.get('SELECT id FROM users WHERE email = ? AND email IS NOT NULL', [email]);
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
        
        // Email может быть null
        const finalEmail = email && email.trim() ? email : null;
        
        const result = await db.run(
            `INSERT INTO users 
            (email, password, first_name, last_name, phone, phone_verified, role, 
             subscription_plan, subscription_status, subscription_expires,
             initial_fee_paid, initial_fee_amount, tasks_limit, avatar_url,
             verification_token) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                finalEmail, // Может быть null
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
        
        res.status(201).json({
            success: true,
            message: 'Регистрация почти завершена! Подтвердите телефон для активации аккаунта.',
            data: { 
                user: userForResponse,
                token: null,
                requires_phone_verification: true,
                phone_verification_sent: smsResult.success,
                demo_mode: smsResult.demo || false,
                expires_in_minutes: 10,
                requires_initial_fee: !initialFeePaid && !DEMO_MODE,
                initial_fee_amount: subscription.initial_fee,
                phone: formattedPhone,
                can_verify_immediately: true,
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
        
        // Телефон обязателен, email опционален
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
        
        // Email теперь необязателен
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
        
        // Email проверяем только если он передан
        if (email && email.trim()) {
            const existingEmail = await db.get('SELECT id FROM users WHERE email = ? AND email IS NOT NULL', [email]);
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
        
        // Email может быть null
        const finalEmail = email && email.trim() ? email : null;
        
        const result = await db.run(
            `INSERT INTO users 
            (email, password, first_name, last_name, phone, phone_verified, role, 
             subscription_plan, subscription_status, subscription_expires,
             initial_fee_paid, initial_fee_amount, tasks_limit, avatar_url,
             verification_token, bio) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                finalEmail, // Может быть null
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

// Вход
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, phone, password } = req.body;
        
        console.log('🔐 Попытка входа:', { email, phone });
        
        // ПРИОРИТЕТ ТЕЛЕФОНА ПЕРЕД EMAIL
        let user;
        let loginType = '';
        
        if (phone) {
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
        } else if (email && email.trim()) {
            user = await db.get(
                `SELECT * FROM users WHERE email = ? AND is_active = 1`,
                [email.trim().toLowerCase()]
            );
            loginType = 'email';
        } else {
            return res.status(400).json({
                success: false,
                error: 'Укажите телефон или email и пароль'
            });
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

// ==================== ИСПОЛНИТЕЛЬСКИЕ API ====================

// Получение специализаций исполнителя
app.get('/api/performer/specializations', authMiddleware(['performer']), async (req, res) => {
    try {
        const specializations = await db.all(`
            SELECT pc.*, c.display_name, c.icon, c.color
            FROM performer_categories pc
            JOIN categories c ON pc.category_id = c.id
            WHERE pc.performer_id = ? AND pc.is_active = 1
            ORDER BY c.display_name
        `, [req.user.id]);
        
        res.json({
            success: true,
            data: {
                specializations,
                count: specializations.length
            }
        });
    } catch (error) {
        console.error('Ошибка получения специализаций:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения специализаций'
        });
    }
});

// Обновление специализаций исполнителя
app.post('/api/performer/specializations', authMiddleware(['performer']), async (req, res) => {
    try {
        const { category_ids } = req.body;
        
        if (!Array.isArray(category_ids)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректные данные'
            });
        }
        
        await db.run('DELETE FROM performer_categories WHERE performer_id = ?', [req.user.id]);
        
        for (const categoryId of category_ids) {
            await db.run(
                `INSERT OR IGNORE INTO performer_categories (performer_id, category_id, is_active) 
                 VALUES (?, ?, 1)`,
                [req.user.id, categoryId]
            );
        }
        
        res.json({
            success: true,
            message: 'Специализации обновлены',
            data: {
                category_ids,
                count: category_ids.length
            }
        });
    } catch (error) {
        console.error('Ошибка обновления специализаций:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления специализаций'
        });
    }
});

// Исправленный маршрут доступных задач для исполнителя
app.get('/api/performer/available-tasks', authMiddleware(['performer']), async (req, res) => {
    try {
        console.log(`🔍 Исполнитель ${req.user.id} запрашивает доступные задачи`);
        
        const { category_id, priority, min_price } = req.query;
        
        // Получаем специализации исполнителя
        const specializations = await db.all(
            'SELECT category_id FROM performer_categories WHERE performer_id = ? AND is_active = 1',
            [req.user.id]
        );
        
        if (!specializations || specializations.length === 0) {
            return res.json({
                success: true,
                data: {
                    tasks: [],
                    count: 0,
                    message: 'У вас нет активных специализаций. Настройте профиль.'
                }
            });
        }
        
        const categoryIds = specializations.map(s => s.category_id);
        
        let query = `
            SELECT t.*,
                   c.display_name as category_name,
                   c.icon as category_icon,
                   u.first_name as client_first_name,
                   u.last_name as client_last_name,
                   u.avatar_url as client_avatar,
                   u.user_rating as client_rating
            FROM tasks t
            JOIN categories c ON t.category_id = c.id
            JOIN users u ON t.client_id = u.id
            WHERE t.status = 'searching'
              AND t.category_id IN (${categoryIds.map(() => '?').join(',')})
              AND t.performer_id IS NULL
              AND t.client_id != ?
        `;
        
        let params = [...categoryIds, req.user.id];
        
        // Применяем фильтры
        if (category_id && category_id !== 'all') {
            query += ' AND t.category_id = ?';
            params.push(category_id);
        }
        
        if (min_price) {
            query += ' AND t.price >= ?';
            params.push(parseFloat(min_price));
        }
        
        if (priority && priority !== 'all') {
            query += ' AND t.priority = ?';
            params.push(priority);
        }
        
        query += ' ORDER BY t.priority DESC, t.created_at DESC';
        
        console.log('Query:', query);
        console.log('Params:', params);
        
        const tasks = await db.all(query, params);
        
        console.log(`✅ Найдено доступных задач: ${tasks.length}`);
        
        res.json({
            success: true,
            data: {
                tasks: tasks.map(task => ({
                    ...task,
                    can_take: true
                })),
                count: tasks.length,
                categories_count: categoryIds.length,
                message: tasks.length > 0 
                    ? `Найдено ${tasks.length} доступных задач` 
                    : 'Нет доступных задач в ваших категориях'
            }
        });
        
    } catch (error) {
        console.error('🔥 Ошибка получения доступных задач:', error.message);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера'
        });
    }
});

// Принятие задачи исполнителем
app.post('/api/performer/tasks/:taskId/accept', authMiddleware(['performer']), async (req, res) => {
    try {
        const taskId = req.params.taskId;
        const performerId = req.user.id;
        
        console.log(`🤝 Исполнитель ${performerId} принимает задачу ${taskId}`);
        
        // Проверяем, существует ли задача и доступна ли она
        const task = await db.get(
            `SELECT t.*, u.phone_verified as client_verified 
             FROM tasks t 
             JOIN users u ON t.client_id = u.id 
             WHERE t.id = ? AND t.status = 'searching'`,
            [taskId]
        );
        
        if (!task) {
            console.log(`❌ Задача ${taskId} не найдена или уже принята`);
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена или уже принята другим исполнителем'
            });
        }
        
        // Проверяем специализацию исполнителя
        const canAccept = await db.get(
            `SELECT 1 FROM performer_categories 
             WHERE performer_id = ? AND category_id = ? AND is_active = 1`,
            [performerId, task.category_id]
        );
        
        if (!canAccept) {
            console.log(`❌ Исполнитель не имеет специализации в категории ${task.category_id}`);
            return res.status(403).json({
                success: false,
                error: 'У вас нет специализации в этой категории'
            });
        }
        
        // Проверяем, подтвержден ли телефон клиента
        if (!task.client_verified) {
            console.log(`❌ У клиента не подтвержден телефон`);
            return res.status(400).json({
                success: false,
                error: 'Клиент не подтвердил телефон'
            });
        }
        
        // Обновляем задачу
        await db.run(
            `UPDATE tasks SET 
                performer_id = ?,
                status = 'assigned',
                updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [performerId, taskId]
        );
        
        // Добавляем в историю статусов
        await db.run(
            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
             VALUES (?, ?, ?, ?)`,
            [taskId, 'assigned', performerId, 'Задача принята исполнителем']
        );
        
        // Отправляем уведомления
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message, related_id, related_type) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                performerId,
                'task_assigned',
                'Задача принята',
                `Вы приняли задачу "${task.title}". Начинайте выполнение.`,
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
                `Исполнитель принял вашу задачу "${task.title}".`,
                taskId,
                'task'
            ]
        );
        
        // Обновляем статистику исполнителя
        await db.run(
            `UPDATE users SET 
                completed_tasks = completed_tasks + 1 
             WHERE id = ?`,
            [performerId]
        );
        
        console.log(`✅ Задача ${taskId} успешно назначена исполнителю ${performerId}`);
        
        res.json({
            success: true,
            message: '🎉 Задача успешно принята!',
            data: { 
                task_id: taskId,
                performer_id: performerId,
                new_status: 'assigned'
            }
        });
        
    } catch (error) {
        console.error('🔥 Ошибка принятия задачи:', error.message);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера'
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
        
        res.json({
            success: true,
            data: {
                categories,
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

// ==================== ЗАДАЧИ ====================

// Создание задачи
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
        
        const finalPrice = 0;
        const taskNumber = generateTaskNumber();
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
                taskStatus
            ]
        );
        
        const taskId = result.lastID;
        
        if (req.user.role === 'client') {
            await db.run(
                'UPDATE users SET tasks_used = tasks_used + 1 WHERE id = ?',
                [req.user.id]
            );
        }
        
        await db.run(
            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
             VALUES (?, ?, ?, ?)`,
            [taskId, taskStatus, req.user.id, 'Задача создана и опубликована для исполнителей']
        );
        
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
            } catch (error) {
                console.warn(`Ошибка отправки уведомления исполнителю ${performer.id}:`, error.message);
            }
        }
        
        const task = await db.get(
            `SELECT t.*, c.display_name as category_name
             FROM tasks t 
             LEFT JOIN categories c ON t.category_id = c.id 
             WHERE t.id = ?`,
            [taskId]
        );
        
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

// ==================== АДМИН API ====================

// Аутентификация администратора
app.post('/api/admin/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        
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

// Создание пользователя администратором (ИСПРАВЛЕННАЯ ВЕРСИЯ)
app.post('/api/admin/users', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const { phone, password, first_name, last_name, email, role = 'client', 
                subscription_plan = 'essential', phone_verified = true } = req.body;
        
        // ОСНОВНОЕ ИЗМЕНЕНИЕ: телефон вместо email как обязательное поле
        if (!phone || !password || !first_name) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля: телефон, пароль и имя'
            });
        }
        
        const formattedPhone = formatPhone(phone);
        if (!validatePhone(formattedPhone)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный номер телефона'
            });
        }
        
        // Email теперь необязателен
        if (email && email.trim() && !validateEmail(email)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный email адрес'
            });
        }
        
        const existingUser = await db.get('SELECT id FROM users WHERE phone = ?', [formattedPhone]);
        if (existingUser) {
            return res.status(409).json({
                success: false,
                error: 'Пользователь с таким телефоном уже существует'
            });
        }
        
        // Email проверяем только если он передан
        if (email && email.trim()) {
            const existingEmail = await db.get('SELECT id FROM users WHERE email = ? AND email IS NOT NULL', [email]);
            if (existingEmail) {
                return res.status(409).json({
                    success: false,
                    error: 'Пользователь с таким email уже существует'
                });
            }
        }
        
        const hashedPassword = await bcrypt.hash(password, 12);
        const avatarUrl = `/api/image/user?name=${encodeURIComponent(first_name)}+${encodeURIComponent(last_name)}`;
        
        const isAdmin = ['admin', 'manager', 'superadmin'].includes(role);
        const finalSubscriptionPlan = isAdmin ? 'premium' : subscription_plan;
        const subscriptionStatus = isAdmin ? 'active' : 'pending';
        const tasksLimit = isAdmin ? 999 : 5;
        const initialFeePaid = isAdmin ? 1 : 0;
        
        // Email может быть null
        const finalEmail = email && email.trim() ? email : null;
        
        const result = await db.run(
            `INSERT INTO users 
            (email, password, first_name, last_name, phone, phone_verified, role, 
             subscription_plan, subscription_status, tasks_limit, initial_fee_paid,
             avatar_url, email_verified) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                finalEmail, // Может быть null
                hashedPassword,
                first_name,
                last_name || '',
                formattedPhone,
                phone_verified ? 1 : 0,
                role,
                finalSubscriptionPlan,
                subscriptionStatus,
                tasksLimit,
                initialFeePaid,
                avatarUrl,
                finalEmail ? 1 : 0 // Email верифицирован только если email указан
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
                    phone: formattedPhone,
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

// ==================== ДОПОЛНИТЕЛЬНЫЕ API ====================

// Получение всех услуг с фильтрацией
app.get('/api/services/filtered', async (req, res) => {
    try {
        const { category_id, featured, limit } = req.query;
        
        let query = `
            SELECT s.*, c.display_name as category_name, c.icon as category_icon
            FROM services s
            LEFT JOIN categories c ON s.category_id = c.id
            WHERE s.is_active = 1
        `;
        
        const params = [];
        
        if (category_id && category_id !== 'all') {
            query += ' AND s.category_id = ?';
            params.push(category_id);
        }
        
        if (featured === 'true') {
            query += ' AND s.is_featured = 1';
        }
        
        query += ' ORDER BY s.sort_order ASC, s.name ASC';
        
        if (limit) {
            query += ' LIMIT ?';
            params.push(parseInt(limit));
        }
        
        const services = await db.all(query, params);
        
        res.json({
            success: true,
            data: {
                services,
                count: services.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения услуг:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения услуг'
        });
    }
});

// Обновление задачи
app.put('/api/tasks/:id', authMiddleware(['admin', 'superadmin', 'manager', 'client']), async (req, res) => {
    try {
        const taskId = req.params.id;
        const updates = req.body;
        
        const task = await db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        // Проверка прав
        if (req.user.role === 'client' && task.client_id !== req.user.id) {
            return res.status(403).json({
                success: false,
                error: 'Нет прав для редактирования этой задачи'
            });
        }
        
        const allowedFields = ['price', 'status', 'priority', 'deadline', 'address', 
                              'contact_info', 'additional_requirements', 'performer_id'];
        
        const updateFields = [];
        const updateValues = [];
        
        for (const field of allowedFields) {
            if (field in updates) {
                updateFields.push(`${field} = ?`);
                updateValues.push(updates[field]);
            }
        }
        
        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Нет данных для обновления'
            });
        }
        
        updateFields.push('updated_at = CURRENT_TIMESTAMP');
        updateValues.push(taskId);
        
        await db.run(
            `UPDATE tasks SET ${updateFields.join(', ')} WHERE id = ?`,
            updateValues
        );
        
        // Логирование изменения
        if (updates.status && updates.status !== task.status) {
            await db.run(
                `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
                 VALUES (?, ?, ?, ?)`,
                [taskId, updates.status, req.user.id, 'Статус изменен через API']
            );
        }
        
        const updatedTask = await db.get(
            `SELECT t.*, c.display_name as category_name 
             FROM tasks t 
             LEFT JOIN categories c ON t.category_id = c.id 
             WHERE t.id = ?`,
            [taskId]
        );
        
        res.json({
            success: true,
            message: 'Задача обновлена',
            data: { task: updatedTask }
        });
        
    } catch (error) {
        console.error('Ошибка обновления задачи:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления задачи'
        });
    }
});

// Получение статистики пользователя
app.get('/api/users/:id/stats', authMiddleware(['admin', 'superadmin', 'manager']), async (req, res) => {
    try {
        const userId = req.params.id;
        
        const stats = await db.get(`
            SELECT 
                (SELECT COUNT(*) FROM tasks WHERE client_id = ?) as tasks_created,
                (SELECT COUNT(*) FROM tasks WHERE performer_id = ?) as tasks_performed,
                (SELECT AVG(rating) FROM reviews WHERE performer_id = ?) as avg_rating,
                (SELECT SUM(amount) FROM transactions WHERE user_id = ? AND status = 'completed') as total_spent,
                (SELECT SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) 
                 FROM transactions WHERE user_id = ? AND status = 'completed') as total_earned
        `, [userId, userId, userId, userId, userId]);
        
        const user = await db.get(
            'SELECT id, first_name, last_name, phone, role, subscription_plan FROM users WHERE id = ?',
            [userId]
        );
        
        res.json({
            success: true,
            data: {
                user,
                stats: {
                    tasks_created: stats?.tasks_created || 0,
                    tasks_performed: stats?.tasks_performed || 0,
                    avg_rating: stats?.avg_rating || 0,
                    total_spent: stats?.total_spent || 0,
                    total_earned: stats?.total_earned || 0
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения статистики пользователя:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статистики'
        });
    }
});

// ==================== СЕРВИСНЫЕ API ====================

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

// Выбор подписки
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

// ==================== ТЕСТОВЫЕ ИЗОБРАЖЕНИЯ ====================

// Маршрут для тестовых изображений
app.get('/api/images/test/:type', (req, res) => {
    const type = req.params.type || 'default';
    
    console.log(`🖼️ Запрос тестового изображения: ${type}`);
    
    const placeholders = {
        'logo': {
            svg: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
                <rect width="100" height="100" fill="#F2DDE6" rx="20"/>
                <text x="50" y="50" font-family="Arial" font-size="40" font-weight="bold" 
                      fill="#C5A880" text-anchor="middle" dy=".3em">W</text>
            </svg>`
        },
        'category': {
            svg: `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150" viewBox="0 0 200 150">
                <rect width="200" height="150" fill="#FAF2F6"/>
                <circle cx="100" cy="60" r="30" fill="#F2DDE6"/>
                <text x="100" y="60" font-family="Arial" font-size="14" text-anchor="middle" dy=".3em" fill="#C5A880">
                    C
                </text>
                <text x="100" y="110" font-family="Arial" font-size="12" text-anchor="middle" fill="#888">
                    Категория
                </text>
            </svg>`
        },
        'service': {
            svg: `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150" viewBox="0 0 200 150">
                <rect width="200" height="150" fill="#F9F7F3"/>
                <rect x="50" y="50" width="100" height="50" fill="#E8CCD9" rx="5"/>
                <text x="100" y="78" font-family="Arial" font-size="12" text-anchor="middle" fill="#C5A880">
                    Услуга
                </text>
            </svg>`
        },
        'user': {
            svg: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
                <circle cx="50" cy="40" r="25" fill="#E8CCD9"/>
                <circle cx="50" cy="40" r="22" fill="#F2DDE6"/>
                <circle cx="50" cy="90" r="35" fill="#E8CCD9"/>
                <circle cx="50" cy="90" r="32" fill="#F2DDE6"/>
                <text x="50" y="45" font-family="Arial" font-size="20" text-anchor="middle" dy=".3em" fill="#C5A880">
                    U
                </text>
            </svg>`
        },
        'default': {
            svg: `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150" viewBox="0 0 200 150">
                <rect width="200" height="150" fill="#F9F7F3"/>
                <rect x="50" y="50" width="100" height="50" fill="#E8CCD9" rx="5"/>
                <text x="100" y="78" font-family="Arial" font-size="12" text-anchor="middle" fill="#C5A880">
                    ${type}
                </text>
            </svg>`
        }
    };
    
    const placeholder = placeholders[type] || placeholders['default'];
    
    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'public, max-age=3600');
    res.set('Access-Control-Allow-Origin', '*');
    
    res.send(placeholder.svg);
});

// Общий маршрут для тестовых изображений
app.get('/api/images/test', (req, res) => {
    const placeholder = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150" viewBox="0 0 200 150">
        <rect width="200" height="150" fill="#F9F7F3"/>
        <rect x="50" y="50" width="100" height="50" fill="#E8CCD9" rx="5"/>
        <text x="100" y="78" font-family="Arial" font-size="12" text-anchor="middle" fill="#C5A880">
            Image
        </text>
    </svg>`;
    
    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'public, max-age=3600');
    res.set('Access-Control-Allow-Origin', '*');
    
    res.send(placeholder);
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
        
        await initDefaultImages();
        console.log('✅ Дефолтные изображения созданы');
        
        console.log('✅ SMS верификация настроена');
        console.log('✅ Все API настроены');
        console.log('✅ Система загрузки файлов настроена');
        
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
            console.log('✅ Загрузка изображений категорий и логотипа');
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
