// server.js - Полный сервер для Женский Консьерж
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
const app = express();
const PORT = process.env.PORT || 3000;

// CORS настройки
app.use(cors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5500', 'http://127.0.0.1:5500'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.options('*', cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// ==================== БАЗА ДАННЫХ ====================
let db;

const ensureDbDirectory = () => {
    const dbDir = __dirname;
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }
};

const initDatabase = async () => {
    try {
        console.log('🔄 Инициализация базы данных...');
        
        // Создаем папку для базы данных
        ensureDbDirectory();
        
        const dbPath = process.env.NODE_ENV === 'production' 
            ? `${__dirname}/concierge.db`
            : './concierge.db';
            
        console.log(`📁 Путь к базе данных: ${dbPath}`);
        
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        console.log('✅ База данных SQLite подключена');

        // Включаем внешние ключи
        await db.run('PRAGMA foreign_keys = ON');

        // Проверяем существование таблиц и создаем их при необходимости
        await createTables();
        
        // Создаем тестовые данные
        await createInitialData();
        
        return db;
    } catch (error) {
        console.error('❌ Ошибка инициализации базы данных:', error.message);
        console.error('Stack trace:', error.stack);
        throw error;
    }
};

const createTables = async () => {
    try {
        console.log('📊 Проверка и создание таблиц...');
        
        // Проверяем существование таблицы users
        const tableCheck = await db.get(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='users'
        `);
        
        if (!tableCheck) {
            console.log('📝 Создание таблиц...');
            
            // Создание таблиц по отдельности
            await db.exec(`
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT UNIQUE NOT NULL,
                    password TEXT NOT NULL,
                    first_name TEXT NOT NULL,
                    last_name TEXT NOT NULL,
                    phone TEXT,
                    telegram_id INTEGER UNIQUE,
                    telegram_username TEXT,
                    role TEXT DEFAULT 'client' CHECK(role IN ('guest', 'client', 'performer', 'admin', 'manager', 'superadmin')),
                    subscription_plan TEXT DEFAULT 'free',
                    subscription_status TEXT DEFAULT 'active',
                    subscription_expires DATE,
                    avatar_url TEXT,
                    balance REAL DEFAULT 0,
                    initial_fee_paid INTEGER DEFAULT 1,
                    initial_fee_amount REAL DEFAULT 0,
                    tasks_limit INTEGER DEFAULT 5,
                    tasks_used INTEGER DEFAULT 0,
                    user_rating REAL DEFAULT 0,
                    completed_tasks INTEGER DEFAULT 0,
                    total_spent REAL DEFAULT 0,
                    bio TEXT,
                    city TEXT,
                    birth_date DATE,
                    profession TEXT,
                    education TEXT,
                    experience TEXT,
                    skills TEXT,
                    vk_url TEXT,
                    instagram_url TEXT,
                    website_url TEXT,
                    is_active INTEGER DEFAULT 1,
                    email_verified INTEGER DEFAULT 1,
                    verification_token TEXT,
                    reset_token TEXT,
                    reset_token_expires TIMESTAMP,
                    last_login TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('✅ Таблица users создана');
            
            // Создаем остальные таблицы
            await createOtherTables();
            
        } else {
            console.log('✅ Таблицы уже существуют');
        }
        
    } catch (error) {
        console.error('❌ Ошибка создания таблиц:', error.message);
        throw error;
    }
};

const createOtherTables = async () => {
    const tables = [
        // Подписки
        `CREATE TABLE subscriptions (
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
            is_featured INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        
        // Категории услуг
        `CREATE TABLE categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            display_name TEXT NOT NULL,
            description TEXT NOT NULL,
            icon TEXT NOT NULL,
            color TEXT DEFAULT '#FF6B8B',
            sort_order INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        
        // Услуги
        `CREATE TABLE services (
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
        )`,
        
        // Задачи
        `CREATE TABLE tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_number TEXT UNIQUE NOT NULL,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            client_id INTEGER NOT NULL,
            performer_id INTEGER,
            category_id INTEGER NOT NULL,
            service_id INTEGER,
            status TEXT DEFAULT 'new' CHECK(status IN ('new', 'searching', 'assigned', 'in_progress', 'completed', 'cancelled')),
            priority TEXT DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
            budget REAL,
            address TEXT,
            deadline DATETIME,
            contact_info TEXT,
            additional_requirements TEXT,
            requirements_experience INTEGER DEFAULT 0,
            requirements_certified INTEGER DEFAULT 0,
            requirements_reviews INTEGER DEFAULT 0,
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
        )`,
        
        // История статусов задач
        `CREATE TABLE task_status_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL,
            status TEXT NOT NULL,
            changed_by INTEGER NOT NULL,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
            FOREIGN KEY (changed_by) REFERENCES users(id)
        )`,
        
        // Сообщения в чате
        `CREATE TABLE task_messages (
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
        )`,
        
        // Отзывы
        `CREATE TABLE reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL,
            client_id INTEGER NOT NULL,
            performer_id INTEGER NOT NULL,
            rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
            comment TEXT,
            is_anonymous INTEGER DEFAULT 0,
            is_featured INTEGER DEFAULT 0,
            admin_approved INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
            FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (performer_id) REFERENCES users(id) ON DELETE CASCADE
        )`,
        
        // Специализации исполнителей
        `CREATE TABLE performer_categories (
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
        )`,
        
        // Транзакции
        `CREATE TABLE transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('deposit', 'withdrawal', 'subscription', 'task_payment', 'initial_fee', 'refund', 'subscription_renewal', 'subscription_reactivation')),
            amount REAL NOT NULL,
            description TEXT NOT NULL,
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'failed', 'refunded')),
            payment_method TEXT,
            payment_id TEXT,
            metadata TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`,
        
        // Уведомления
        `CREATE TABLE notifications (
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
        )`,
        
        // Настройки системы
        `CREATE TABLE settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE NOT NULL,
            value TEXT,
            description TEXT,
            category TEXT DEFAULT 'general',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        
        // FAQ
        `CREATE TABLE faq (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            question TEXT NOT NULL,
            answer TEXT NOT NULL,
            category TEXT DEFAULT 'general',
            sort_order INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`
    ];
    
    for (const tableSql of tables) {
        try {
            await db.exec(tableSql);
        } catch (error) {
            // Игнорируем ошибку "таблица уже существует"
            if (!error.message.includes('already exists')) {
                console.warn(`⚠️ Ошибка создания таблицы: ${error.message}`);
            }
        }
    }
    
    console.log('✅ Все таблицы созданы');
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
                ['telegram_bot_token', process.env.TELEGRAM_BOT_TOKEN || 'none', 'Токен Telegram бота', 'telegram'],
                ['telegram_admin_id', '-898508164', 'ID администратора Telegram', 'telegram'],
                ['system_fee_percent', '10', 'Комиссия системы (%)', 'financial'],
                ['min_task_price', '0', 'Минимальная цена задачи', 'financial'],
                ['max_task_price', '100000', 'Максимальная цена задачи', 'financial']
            ];

            for (const setting of settings) {
                await db.run(
                    `INSERT INTO settings (key, value, description, category) VALUES (?, ?, ?, ?)`,
                    setting
                );
            }
            console.log('✅ Настройки системы созданы');
        }

        // 2. FAQ
        const faqExist = await db.get("SELECT 1 FROM faq WHERE question LIKE '%Как работает система%'");
        if (!faqExist) {
            const faqs = [
                ['Как работает система подписок?', 'Вы выбираете подходящий тариф, оплачиваете его и получаете доступ ко всем услугам в рамках выбранного пакета. Можно менять тариф в любое время.', 'subscriptions', 1, 1],
                ['Можно ли отменить подписку?', 'Да, вы можете отменить подписку в любой момент в настройках профиля. Подписка останется активной до конца оплаченного периода.', 'subscriptions', 2, 1],
                ['Как выбрать исполнителя?', 'После создания задачи система автоматически подберет подходящих исполнителей. Вы можете просмотреть их профили, рейтинги и отзывы перед выбором.', 'tasks', 3, 1],
                ['Что делать, если не устроило качество услуги?', 'Мы гарантируем возврат средств или повторное оказание услуги, если качество не устроило. Свяжитесь с нашей поддержкой в течение 24 часов после выполнения задачи.', 'quality', 4, 1],
                ['Как пополнить баланс?', 'Вы можете пополнить баланс через раздел "Пополнение баланса" в вашем профиле. Доступны банковские карты, ЮMoney и СБП.', 'payments', 5, 1]
            ];

            for (const faq of faqs) {
                await db.run(
                    `INSERT INTO faq (question, answer, category, sort_order, is_active) VALUES (?, ?, ?, ?, ?)`,
                    faq
                );
            }
            console.log('✅ FAQ созданы');
        }

        // 3. Подписки (4 тарифа)
        const subscriptionsExist = await db.get("SELECT 1 FROM subscriptions WHERE name = 'free'");
        if (!subscriptionsExist) {
            const subscriptions = [
                [
                    'free', 'Бесплатный', 'Пробный доступ к платформе',
                    0, 0, 0, 3,
                    '["До 3 задач в месяц", "Базовые категории услуг", "Обычная поддержка", "Возможность оценивать исполнителей"]',
                    '#6B7280', 1, 0, 0, 1
                ],
                [
                    'basic', 'Базовый', 'Для регулярного использования',
                    990, 9500, 0, 10,
                    '["До 10 задач в месяц", "Все категории услуг", "Приоритетная поддержка", "Подбор исполнителей", "Безопасные платежи"]',
                    '#3B82F6', 2, 0, 0, 1
                ],
                [
                    'premium', 'Премиум', 'Полный доступ ко всем возможностям',
                    2990, 28650, 0, 999,
                    '["Неограниченное количество задач", "Все категории услуг премиум-класса", "Персональный менеджер", "Экспресс-подбор исполнителей", "VIP-поддержка 24/7", "Страхование задач", "Скидки на услуги"]',
                    '#F59E0B', 3, 1, 1, 1
                ],
                [
                    'vip', 'VIP', 'Эксклюзивное обслуживание',
                    5990, 57500, 0, 9999,
                    '["Все возможности Премиум", "Персональная помощница", "Эксклюзивные исполнительницы", "Консьерж-сервис", "Бесплатные консультации", "Подарки и бонусы", "Приоритет во всем"]',
                    '#8B5CF6', 4, 0, 0, 1
                ]
            ];

            for (const sub of subscriptions) {
                await db.run(
                    `INSERT INTO subscriptions 
                    (name, display_name, description, price_monthly, price_yearly, 
                     initial_fee, tasks_limit, features, color_theme, sort_order, is_popular, is_featured, is_active) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    sub
                );
            }
            console.log('✅ Тарифы подписок созданы (4 тарифа)');
        }

        // 4. Категории услуг (10 категорий)
        const categoriesExist = await db.get("SELECT 1 FROM categories WHERE name = 'cleaning'");
        if (!categoriesExist) {
            const categories = [
                ['cleaning', 'Уборка', 'Генеральная уборка, регулярная уборка, уборка после ремонта', 'fas fa-broom', '#FF6B8B', 1, 1],
                ['cooking', 'Готовка', 'Приготовление еды, семейные ужины, диетическое питание', 'fas fa-utensils', '#4CAF50', 2, 1],
                ['shopping', 'Покупки', 'Покупка продуктов, одежды, подарков, онлайн-шопинг', 'fas fa-shopping-bag', '#2196F3', 3, 1],
                ['beauty', 'Красота', 'Маникюр, прически, макияж, уходовые процедуры', 'fas fa-spa', '#9C27B0', 4, 1],
                ['organization', 'Организация', 'Планирование мероприятий, организация пространства', 'fas fa-calendar-alt', '#FF9800', 5, 1],
                ['education', 'Образование', 'Репетиторство, курсы, помощь с учебой', 'fas fa-graduation-cap', '#795548', 6, 1],
                ['childcare', 'Уход за детьми', 'Няни, сопровождение, помощь с детьми', 'fas fa-baby', '#00BCD4', 7, 1],
                ['petcare', 'Уход за питомцами', 'Выгул, кормление, уход за животными', 'fas fa-paw', '#FF5722', 8, 1],
                ['delivery', 'Доставка', 'Доставка еды, документов, покупок', 'fas fa-shipping-fast', '#673AB7', 9, 1],
                ['repair', 'Ремонт', 'Мелкий ремонт, сборка мебели, техническая помощь', 'fas fa-tools', '#607D8B', 10, 1]
            ];

            for (const cat of categories) {
                await db.run(
                    `INSERT INTO categories 
                    (name, display_name, description, icon, color, sort_order, is_active) 
                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    cat
                );
            }
            console.log('✅ Категории услуг созданы (10 категорий)');
        }

        // 5. Услуги (расширенные)
        const servicesExist = await db.get("SELECT 1 FROM services WHERE name = 'Уборка квартиры'");
        if (!servicesExist) {
            const categories = await db.all("SELECT id, name FROM categories");
            const categoryMap = {};
            categories.forEach(cat => categoryMap[cat.name] = cat.id);

            const services = [
                // Уборка
                [categoryMap.cleaning, 'Уборка квартиры', 'Генеральная или поддерживающая уборка квартиры любой площади', 0, '2-6 часов', 1, 1, 1],
                [categoryMap.cleaning, 'Уборка после ремонта', 'Тщательная уборка помещения после строительных работ', 0, '4-8 часов', 1, 2, 0],
                [categoryMap.cleaning, 'Еженедельная уборка', 'Регулярная уборка по заданному графику', 0, '2-3 часа', 1, 3, 0],
                
                // Готовка
                [categoryMap.cooking, 'Приготовление ужина', 'Приготовление ужина на 2-6 персон', 0, '2-3 часа', 1, 4, 1],
                [categoryMap.cooking, 'Праздничный стол', 'Организация и приготовление блюд для праздника', 0, '4-6 часов', 1, 5, 0],
                [categoryMap.cooking, 'Диетическое питание', 'Приготовление блюд по диетическому меню', 0, '2-3 часа', 1, 6, 0],
                
                // Покупки
                [categoryMap.shopping, 'Покупка продуктов', 'Закупка продуктов по списку', 0, '1-3 часа', 1, 7, 1],
                [categoryMap.shopping, 'Шопинг-сопровождение', 'Помощь в выборе одежды, обуви, аксессуаров', 0, '2-4 часа', 1, 8, 0],
                [categoryMap.shopping, 'Покупка подарков', 'Подбор и покупка подарков к празднику', 0, '1-2 часа', 1, 9, 0],
                
                // Красота
                [categoryMap.beauty, 'Маникюр на дому', 'Профессиональный маникюр с выездом', 0, '1-2 часа', 1, 10, 1],
                [categoryMap.beauty, 'Стрижка и укладка', 'Парикмахерские услуги на дому', 0, '2-3 часа', 1, 11, 0],
                [categoryMap.beauty, 'Макияж', 'Профессиональный макияж для любого случая', 0, '1-2 часа', 1, 12, 0],
                
                // Образование
                [categoryMap.education, 'Репетиторство', 'Индивидуальные занятия по школьным предметам', 0, '1-2 часа', 1, 13, 1],
                [categoryMap.education, 'Подготовка к экзаменам', 'Интенсивная подготовка к ОГЭ, ЕГЭ', 0, '1-3 часа', 1, 14, 0],
                [categoryMap.education, 'Иностранные языки', 'Обучение иностранным языкам с нуля', 0, '1-2 часа', 1, 15, 0],
                
                // Уход за детьми
                [categoryMap.childcare, 'Няня на час', 'Присмотр за детьми на несколько часов', 0, '1-4 часа', 1, 16, 1],
                [categoryMap.childcare, 'Сопровождение ребенка', 'Сопровождение в школу, кружки, поликлинику', 0, '1-2 часа', 1, 17, 0],
                [categoryMap.childcare, 'Помощь с уроками', 'Помощь в выполнении домашних заданий', 0, '1-2 часа', 1, 18, 0],
                
                // Уход за питомцами
                [categoryMap.petcare, 'Выгул собак', 'Прогулка с собакой в удобное время', 0, '30-60 минут', 1, 19, 1],
                [categoryMap.petcare, 'Присмотр за питомцем', 'Кормление и уход за животным во время вашего отсутствия', 0, '1-2 раза в день', 1, 20, 0],
                [categoryMap.petcare, 'Груминг', 'Стрижка и гигиенический уход за питомцами', 0, '1-2 часа', 1, 21, 0],
                
                // Доставка
                [categoryMap.delivery, 'Доставка документов', 'Срочная доставка документов по городу', 0, '30-90 минут', 1, 22, 1],
                [categoryMap.delivery, 'Доставка еды', 'Доставка готовой еды из ресторанов', 0, '30-60 минут', 1, 23, 0],
                [categoryMap.delivery, 'Курьерские услуги', 'Доставка покупок, посылок, корреспонденции', 0, '1-2 часа', 1, 24, 0],
                
                // Ремонт
                [categoryMap.repair, 'Мелкий бытовой ремонт', 'Ремонт мелкой бытовой техники, мебели', 0, '1-3 часа', 1, 25, 1],
                [categoryMap.repair, 'Сборка мебели', 'Сборка мебели из IKEA и других магазинов', 0, '2-5 часов', 1, 26, 0],
                [categoryMap.repair, 'Установка техники', 'Установка и подключение бытовой техники', 0, '1-2 часа', 1, 27, 0]
            ];

            for (const service of services) {
                await db.run(
                    `INSERT INTO services 
                    (category_id, name, description, base_price, estimated_time, is_active, sort_order, is_featured) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    service
                );
            }
            console.log('✅ Услуги созданы (27 услуг)');
        }

        // 6. Тестовые пользователи с Telegram ID -898508164 как администратор
        const adminExists = await db.get("SELECT 1 FROM users WHERE telegram_id = ?", [-898508164]);
        if (!adminExists) {
            const passwordHash = await bcrypt.hash('admin123', 10);
            const clientPasswordHash = await bcrypt.hash('client123', 10);
            const performerPasswordHash = await bcrypt.hash('performer123', 10);
            
            const expiryDate = new Date();
            expiryDate.setFullYear(expiryDate.getFullYear() + 1);

            const users = [
                // 👑 Суперадмин с Telegram ID -898508164
                ['admin@test.com', passwordHash, 'Александр', 'Иванов', '+79991112233', -898508164, '@admin_telegram', 'superadmin', 'premium', 'active', expiryDate.toISOString().split('T')[0], 'https://ui-avatars.com/api/?name=Александр+Иванов&background=9B59B6&color=fff&bold=true', 100000, 1, 0, 9999, 0, 5.0, 100, 10000, 'Главный администратор системы', 'Москва', '1985-05-15', 'Системный администратор', 'МГТУ им. Баумана', 'Опыт работы 10+ лет', '["Управление проектами", "Разработка", "Администрирование"]', 'https://vk.com/admin', 'https://instagram.com/admin', 'https://admin-portfolio.ru', 1, 1],
                
                // 👨‍💼 Менеджер
                ['manager@test.com', passwordHash, 'Мария', 'Петрова', '+79992223344', null, null, 'manager', 'premium', 'active', expiryDate.toISOString().split('T')[0], 'https://ui-avatars.com/api/?name=Мария+Петрова&background=2ECC71&color=fff&bold=true', 50000, 1, 0, 9999, 0, 4.8, 50, 5000, 'Менеджер по работе с клиентами', 'Санкт-Петербург', '1990-08-20', 'Менеджер', 'СПбГУ', 'Опыт работы 5 лет', '["Работа с клиентами", "Управление командой", "Аналитика"]', 'https://vk.com/maria', 'https://instagram.com/maria', null, 1, 1],
                
                // 👩‍🏫 Исполнители
                ['performer@test.com', performerPasswordHash, 'Анна', 'Кузнецова', '+79994445566', null, null, 'performer', 'premium', 'active', expiryDate.toISOString().split('T')[0], 'https://ui-avatars.com/api/?name=Анна+Кузнецова&background=3498DB&color=fff&bold=true', 25000, 1, 0, 999, 42, 4.8, 42, 125400, 'Профессиональная помощница с опытом работы 5 лет. Специализируюсь на уборке, организации пространства и бытовых задачах. Ответственная, аккуратная, с рекомендациями.', 'Москва', '1988-03-10', 'Помощница по хозяйству', 'Курсы профессиональной уборки', 'Опыт работы 5+ лет', '["Уборка", "Организация", "Готовка", "Уход за детьми"]', 'https://vk.com/anna_performer', 'https://instagram.com/anna_performer', null, 1, 1],
                
                // 👩 Клиенты
                ['client@test.com', clientPasswordHash, 'Елена', 'Васильева', '+79997778899', null, null, 'client', 'premium', 'active', expiryDate.toISOString().split('T')[0], 'https://ui-avatars.com/api/?name=Елена+Васильева&background=FF6B8B&color=fff&bold=true', 15000, 1, 0, 999, 12, 4.5, 12, 36000, 'Предпринимательница, мама двоих детей. Ценю свое время и качество услуг. Люблю, когда все организовано и работает как часы.', 'Москва', '1985-12-03', 'Предприниматель', 'ВШЭ', 'Собственный бизнес 8 лет', '["Организация", "Тайм-менеджмент", "Бизнес"]', 'https://vk.com/elena_client', 'https://instagram.com/elena_client', 'https://mybusiness.ru', 1, 1]
            ];

            for (const user of users) {
                await db.run(
                    `INSERT INTO users 
                    (email, password, first_name, last_name, phone, telegram_id, telegram_username, role, 
                     subscription_plan, subscription_status, subscription_expires,
                     avatar_url, balance, initial_fee_paid, initial_fee_amount, 
                     tasks_limit, tasks_used, user_rating, completed_tasks, total_spent,
                     bio, city, birth_date, profession, education, experience, skills,
                     vk_url, instagram_url, website_url,
                     is_active, email_verified) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    user
                );
            }
            console.log('✅ Тестовые пользователи созданы (с Telegram ID -898508164 как админ)');
        }

        console.log('🎉 Все начальные данные созданы!');
        
        console.log('\n🔑 ТЕСТОВЫЕ АККАУНТЫ:');
        console.log('='.repeat(60));
        console.log('👑 Суперадмин (Telegram ID -898508164): admin@test.com / admin123');
        console.log('👨‍💼 Менеджер: manager@test.com / admin123');
        console.log('👩‍🏫 Исполнитель: performer@test.com / performer123');
        console.log('👩 Клиент Премиум: client@test.com / client123');
        console.log('='.repeat(60));
        
        console.log('\n🔗 ДОСТУПНЫЕ ИНТЕРФЕЙСЫ:');
        console.log('='.repeat(60));
        console.log('🌐 Основное приложение: http://localhost:' + PORT + '/index.html');
        console.log('👑 Админ-панель: http://localhost:' + PORT + '/admin.html');
        console.log('💼 Панель менеджера: http://localhost:' + PORT + '/manager.html');
        console.log('='.repeat(60));
        
    } catch (error) {
        console.error('⚠️ Ошибка создания начальных данных:', error.message);
        console.error('Stack trace:', error.stack);
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
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
};

const validatePhone = (phone) => {
    if (!phone) return true;
    const re = /^\+?[1-9]\d{10,14}$/;
    return re.test(phone.replace(/\D/g, ''));
};

// ==================== JWT МИДЛВАР ====================
const authMiddleware = (roles = []) => {
    return async (req, res, next) => {
        try {
            const authHeader = req.headers.authorization;
            
            // Публичные маршруты
            const publicRoutes = [
                'GET /',
                'GET /health',
                'GET /api/health',
                'GET /api/subscriptions',
                'GET /api/categories',
                'GET /api/categories/*',
                'GET /api/services',
                'GET /api/faq',
                'GET /api/reviews',
                'GET /api/reviews/*',
                'POST /api/auth/register',
                'POST /api/auth/login',
                'POST /api/auth/telegram',
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
                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'concierge-pink-secret-2024-prod-safe-key');
                
                const user = await db.get(
                    `SELECT id, email, first_name, last_name, phone, telegram_id, role, 
                            subscription_plan, subscription_status, subscription_expires,
                            initial_fee_paid, initial_fee_amount, is_active, avatar_url,
                            balance, user_rating, completed_tasks, tasks_limit, tasks_used,
                            total_spent, last_login, email_verified, bio, city,
                            birth_date, profession, education, experience, skills,
                            vk_url, instagram_url, website_url
                     FROM users WHERE id = ? AND is_active = 1`,
                    [decoded.id]
                );
                
                if (!user) {
                    return res.status(401).json({ 
                        success: false, 
                        error: 'Пользователь не найден' 
                    });
                }
                
                // Переименовываем user_rating в rating для совместимости с фронтендом
                req.user = {
                    id: user.id,
                    email: user.email,
                    telegram_id: user.telegram_id,
                    role: user.role,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    phone: user.phone,
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
                    email_verified: user.email_verified,
                    bio: user.bio,
                    city: user.city,
                    birth_date: user.birth_date,
                    profession: user.profession,
                    education: user.education,
                    experience: user.experience,
                    skills: user.skills ? JSON.parse(user.skills) : [],
                    vk_url: user.vk_url,
                    instagram_url: user.instagram_url,
                    website_url: user.website_url
                };
                
                if (roles.length > 0 && !roles.includes(user.role)) {
                    return res.status(403).json({ 
                        success: false, 
                        error: 'Недостаточно прав' 
                    });
                }
                
                next();
                
            } catch (jwtError) {
                console.error('JWT Error:', jwtError);
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

// ==================== ОСНОВНЫЕ МАРШРУТЫ ====================

// Главная страница API
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: '🌸 Добро пожаловать в Женский Консьерж API',
        version: '7.0.0',
        status: '🟢 Работает',
        telegram_admin_id: -898508164,
        features: ['Подписки', 'Задачи', 'Чат', 'Отзывы', 'Админ панель', 'Управление услугами', 'Финансы', 'Уведомления'],
        interfaces: [
            { name: 'Основное приложение', url: '/index.html' },
            { name: 'Админ-панель', url: '/admin.html' },
            { name: 'Панель менеджера', url: '/manager.html' }
        ],
        timestamp: new Date().toISOString()
    });
});

// Health check для платформы
app.get('/health', async (req, res) => {
    try {
        if (!db) {
            return res.status(500).json({
                success: false,
                status: 'DATABASE_NOT_CONNECTED',
                error: 'База данных не подключена'
            });
        }
        
        await db.get('SELECT 1 as status');
        
        // Простая статистика
        const usersCount = await db.get('SELECT COUNT(*) as count FROM users');
        const tasksCount = await db.get('SELECT COUNT(*) as count FROM tasks');
        
        res.json({
            success: true,
            status: 'OK',
            database: 'connected',
            stats: {
                users: usersCount?.count || 0,
                tasks: tasksCount?.count || 0
            },
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            port: PORT,
            node_version: process.version
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

app.get('/api/health', async (req, res) => {
    try {
        await db.get('SELECT 1 as status');
        
        const usersCount = await db.get('SELECT COUNT(*) as count FROM users');
        const tasksCount = await db.get('SELECT COUNT(*) as count FROM tasks');
        const categoriesCount = await db.get('SELECT COUNT(*) as count FROM categories');
        
        res.json({
            success: true,
            status: 'OK',
            stats: {
                users: usersCount?.count || 0,
                tasks: tasksCount?.count || 0,
                categories: categoriesCount?.count || 0
            },
            timestamp: new Date().toISOString(),
            links: {
                main: `/index.html`,
                admin: `/admin.html`,
                manager: `/manager.html`
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            status: 'ERROR',
            error: error.message
        });
    }
});

// Получение всех ссылок для интерфейсов
app.get('/api/links', (req, res) => {
    res.json({
        success: true,
        data: {
            interfaces: [
                {
                    name: 'Основное приложение',
                    description: 'Для клиентов и исполнителей',
                    url: `/index.html`,
                    icon: '🌐'
                },
                {
                    name: 'Админ-панель',
                    description: 'Управление системой',
                    url: `/admin.html`,
                    icon: '👑',
                    roles: ['admin', 'superadmin']
                },
                {
                    name: 'Панель менеджера',
                    description: 'Управление задачами',
                    url: `/manager.html`,
                    icon: '💼',
                    roles: ['manager', 'admin', 'superadmin']
                }
            ],
            telegram_admin_id: -898508164,
            test_accounts: [
                { email: 'admin@test.com', password: 'admin123', role: 'superadmin' },
                { email: 'manager@test.com', password: 'admin123', role: 'manager' },
                { email: 'client@test.com', password: 'client123', role: 'client' },
                { email: 'performer@test.com', password: 'performer123', role: 'performer' }
            ]
        }
    });
});

// ==================== ПРОСТЫЕ API МАРШРУТЫ ====================

// Регистрация
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, first_name, last_name } = req.body;
        
        if (!email || !password || !first_name || !last_name) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля'
            });
        }
        
        // Хеширование пароля
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Создание пользователя
        const result = await db.run(
            `INSERT INTO users (email, password, first_name, last_name) 
             VALUES (?, ?, ?, ?)`,
            [email, hashedPassword, first_name, last_name]
        );
        
        const userId = result.lastID;
        
        // Создаем JWT токен
        const token = jwt.sign(
            { 
                id: userId, 
                email: email,
                first_name: first_name,
                last_name: last_name
            },
            process.env.JWT_SECRET || 'concierge-pink-secret-2024-prod-safe-key',
            { expiresIn: '30d' }
        );
        
        res.status(201).json({
            success: true,
            message: 'Регистрация успешно завершена!',
            data: { 
                user: {
                    id: userId,
                    email,
                    first_name,
                    last_name,
                    role: 'client'
                },
                token
            }
        });
        
    } catch (error) {
        console.error('Ошибка регистрации:', error);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера при регистрации'
        });
    }
});

// Вход
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Email и пароль обязательны'
            });
        }
        
        // Находим пользователя
        const user = await db.get(
            `SELECT * FROM users WHERE email = ? AND is_active = 1`,
            [email]
        );
        
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Неверный email или пароль'
            });
        }
        
        // Проверяем пароль
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                error: 'Неверный email или пароль'
            });
        }
        
        // Создаем токен
        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                role: user.role,
                first_name: user.first_name,
                last_name: user.last_name
            },
            process.env.JWT_SECRET || 'concierge-pink-secret-2024-prod-safe-key',
            { expiresIn: '30d' }
        );
        
        res.json({
            success: true,
            message: 'Вход выполнен успешно!',
            data: { 
                user: {
                    id: user.id,
                    email: user.email,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    role: user.role,
                    avatar_url: user.avatar_url,
                    balance: user.balance,
                    rating: user.user_rating
                },
                token
            }
        });
        
    } catch (error) {
        console.error('Ошибка входа:', error);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера при входе'
        });
    }
});

// Авторизация через Telegram ID
app.post('/api/auth/telegram', async (req, res) => {
    try {
        const { telegram_id } = req.body;
        
        if (!telegram_id) {
            return res.status(400).json({
                success: false,
                error: 'Не указан Telegram ID'
            });
        }
        
        // Ищем пользователя по Telegram ID
        let user = await db.get(
            `SELECT id, email, first_name, last_name, role, 
                    subscription_plan, subscription_status, avatar_url,
                    balance, user_rating, telegram_id
             FROM users WHERE telegram_id = ? AND is_active = 1`,
            [telegram_id]
        );
        
        if (!user) {
            // Если пользователь не найден, создаем нового клиента
            const hashedPassword = await bcrypt.hash(`telegram_${telegram_id}`, 10);
            
            // Если это администратор (ID -898508164), создаем как суперадмина
            let role = 'client';
            let subscription = 'free';
            
            if (telegram_id == -898508164) {
                role = 'superadmin';
                subscription = 'premium';
            }
            
            const result = await db.run(`
                INSERT INTO users 
                (email, password, first_name, last_name, telegram_id,
                 role, subscription_plan, subscription_status,
                 initial_fee_paid, initial_fee_amount, tasks_limit, avatar_url, balance) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    `telegram_${telegram_id}@concierge.local`,
                    hashedPassword,
                    'Telegram',
                    'User',
                    telegram_id,
                    role,
                    subscription,
                    'active',
                    1,
                    0,
                    role === 'client' ? 5 : 9999,
                    `https://ui-avatars.com/api/?name=Telegram+User&background=7289DA&color=fff&bold=true`,
                    1000
                ]
            );
            
            const userId = result.lastID;
            
            user = await db.get(
                `SELECT id, email, first_name, last_name, role, 
                        subscription_plan, subscription_status, avatar_url,
                        balance, user_rating, telegram_id
                 FROM users WHERE id = ?`,
                [userId]
            );
        }
        
        // Создаем JWT токен
        const token = jwt.sign(
            { 
                id: user.id, 
                telegram_id: user.telegram_id,
                role: user.role,
                first_name: user.first_name,
                last_name: user.last_name
            },
            process.env.JWT_SECRET || 'concierge-pink-secret-2024-prod-safe-key',
            { expiresIn: '30d' }
        );
        
        res.json({
            success: true,
            message: 'Авторизация через Telegram успешна',
            data: { 
                user: {
                    ...user,
                    rating: user.user_rating
                },
                token
            }
        });
        
    } catch (error) {
        console.error('Ошибка авторизации через Telegram:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка авторизации через Telegram'
        });
    }
});

// Получение текущего пользователя
app.get('/api/auth/me', authMiddleware(), async (req, res) => {
    try {
        const user = await db.get(
            `SELECT id, email, first_name, last_name, phone, role, 
                    subscription_plan, subscription_status, subscription_expires,
                    avatar_url, balance, user_rating, completed_tasks,
                    tasks_limit, tasks_used, total_spent, telegram_id
             FROM users WHERE id = ? AND is_active = 1`,
            [req.user.id]
        );
        
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        res.json({
            success: true,
            data: { 
                user: {
                    ...user,
                    rating: user.user_rating
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка проверки токена:', error);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера'
        });
    }
});

// ==================== КАТЕГОРИИ И УСЛУГИ ====================

// Получение всех категорий
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
        console.error('Ошибка получения категорий:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения категорий'
        });
    }
});

// Получение всех услуг
app.get('/api/services', async (req, res) => {
    try {
        const services = await db.all(
            `SELECT s.*, c.display_name as category_name, c.icon as category_icon
             FROM services s
             LEFT JOIN categories c ON s.category_id = c.id
             WHERE s.is_active = 1
             ORDER BY s.sort_order ASC, s.name ASC`
        );
        
        res.json({
            success: true,
            data: {
                services,
                count: services.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения услуг:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения услуг'
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
        
        // Парсим features из JSON строки
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
        console.error('Ошибка получения подписок:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения подписок'
        });
    }
});

// ==================== FAQ ====================
app.get('/api/faq', async (req, res) => {
    try {
        const { category } = req.query;
        
        let query = 'SELECT * FROM faq WHERE is_active = 1';
        const params = [];
        
        if (category && category !== 'all') {
            query += ' AND category = ?';
            params.push(category);
        }
        
        query += ' ORDER BY sort_order ASC, category ASC';
        
        const faq = await db.all(query, params);
        
        res.json({
            success: true,
            data: { 
                faq,
                count: faq.length
            }
        });
    } catch (error) {
        console.error('Ошибка получения FAQ:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения FAQ'
        });
    }
});

// ==================== ЗАДАЧИ ====================

// Создание задачи
app.post('/api/tasks', authMiddleware(['client', 'admin', 'superadmin', 'manager']), async (req, res) => {
    try {
        const { 
            title, 
            description, 
            category_id, 
            budget
        } = req.body;
        
        // Валидация
        if (!title || !description || !category_id) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля'
            });
        }
        
        // Генерируем номер задачи
        const taskNumber = generateTaskNumber();
        
        // Создаем задачу
        const result = await db.run(
            `INSERT INTO tasks 
            (task_number, title, description, client_id, category_id, budget) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                taskNumber,
                title,
                description,
                req.user.id,
                category_id,
                budget || null
            ]
        );
        
        const taskId = result.lastID;
        
        // Получаем созданную задачу
        const task = await db.get(
            `SELECT t.*, c.display_name as category_name, c.icon as category_icon
             FROM tasks t 
             LEFT JOIN categories c ON t.category_id = c.id 
             WHERE t.id = ?`,
            [taskId]
        );
        
        res.status(201).json({
            success: true,
            message: 'Задача успешно создана!',
            data: { 
                task
            }
        });
        
    } catch (error) {
        console.error('Ошибка создания задачи:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания задачи'
        });
    }
});

// ==================== ОБРАБОТКА ОШИБОК ====================

// 404 - Маршрут не найден
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Маршрут не найден',
        available_routes: {
            main: '/',
            health: '/health',
            api_health: '/api/health',
            links: '/api/links',
            auth: '/api/auth/*',
            categories: '/api/categories',
            services: '/api/services',
            subscriptions: '/api/subscriptions',
            faq: '/api/faq'
        }
    });
});

// Обработчик ошибок
app.use((err, req, res, next) => {
    console.error('🚨 Ошибка сервера:', err.stack);
    
    res.status(err.status || 500).json({
        success: false,
        error: process.env.NODE_ENV === 'production' ? 'Внутренняя ошибка сервера' : err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

// ==================== ЗАПУСК СЕРВЕРА ====================

const startServer = async () => {
    try {
        // Инициализируем базу данных
        await initDatabase();
        
        // Запускаем сервер
        app.listen(PORT, () => {
            console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🌸 Женский Консьерж API v7.0.0                         ║
║                  Полная версия без Telegram Bot           ║
║                                                            ║
║   🚀 Сервер запущен на порту ${PORT}                      ║
║   👑 Админ Telegram ID: -898508164                        ║
║                                                            ║
║   🔗 Основные интерфейсы:                                 ║
║   • http://localhost:${PORT}/index.html - Основное прилож.║
║   • http://localhost:${PORT}/admin.html - Админ-панель    ║
║   • http://localhost:${PORT}/manager.html - Менеджер      ║
║                                                            ║
║   🔑 Тестовые аккаунты:                                   ║
║   • Админ: admin@test.com / admin123                      ║
║   • Менеджер: manager@test.com / admin123                 ║
║   • Клиент: client@test.com / client123                   ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
            `);
            
            console.log('\n📋 БЫСТРЫЕ КОМАНДЫ:');
            console.log('='.repeat(60));
            console.log('🔗 Получить все ссылки:');
            console.log(`curl http://localhost:${PORT}/api/links`);
            console.log('');
            console.log('🔐 Войти как админ:');
            console.log(`curl -X POST http://localhost:${PORT}/api/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"email":"admin@test.com","password":"admin123"}'`);
            console.log('');
            console.log('👑 Войти через Telegram ID админа:');
            console.log(`curl -X POST http://localhost:${PORT}/api/auth/telegram \\
  -H "Content-Type: application/json" \\
  -d '{"telegram_id":-898508164}'`);
            console.log('='.repeat(60));
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error);
        process.exit(1);
    }
};

// Запускаем сервер
startServer();

// Обработка завершения работы
process.on('SIGINT', async () => {
    console.log('🔄 Завершение работы...');
    
    // Закрываем соединения
    if (db) {
        await db.close();
    }
    
    console.log('👋 Сервер остановлен');
    process.exit(0);
});

// Экспорт для тестирования
module.exports = {
    app,
    db,
    initDatabase,
    createInitialData
};
