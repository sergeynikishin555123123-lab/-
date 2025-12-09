require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs');

// ==================== TELEGRAM BOT ====================
let TelegramBot;
try {
    TelegramBot = require('node-telegram-bot-api');
    console.log('✅ Telegram Bot модуль загружен');
} catch (error) {
    console.log('⚠️ Telegram Bot не установлен, используйте: npm install node-telegram-bot-api');
    TelegramBot = null;
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
const app = express();

// CORS настройки
const corsOptions = {
    origin: [
        'https://sergeynikishin555123123-lab--86fa.twc1.net',
        'http://localhost:3000',
        'http://localhost:8080',
        'http://localhost:5500',
        'http://127.0.0.1:5500',
        'https://concierge-service.ru',
        'http://concierge-service.ru'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Логирование запросов
app.use((req, res, next) => {
    console.log(`🌐 ${req.method} ${req.path} - ${req.ip} - ${new Date().toISOString()}`);
    if (req.headers.authorization) {
        console.log('🔐 Authorization header present');
    }
    next();
});

// ==================== БАЗА ДАННЫХ ====================
let db;
let telegramBot = null;

const initDatabase = async () => {
    try {
        console.log('🔄 Инициализация базы данных...');
        
        // Для TimeWeb используем /tmp
        const dbPath = process.env.NODE_ENV === 'production' ? '/tmp/concierge.db' : './concierge.db';
        console.log(`📁 Путь к базе данных: ${dbPath}`);
        
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        console.log('✅ База данных SQLite подключена');

        // Создание всех таблиц с новыми таблицами для линий
        await db.exec(`
            -- Пользователи
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                firstName TEXT NOT NULL,
                lastName TEXT NOT NULL,
                phone TEXT NOT NULL,
                role TEXT DEFAULT 'client',
                subscription_plan TEXT DEFAULT 'free',
                subscription_status TEXT DEFAULT 'active',
                subscription_expires DATE,
                telegram_id TEXT,
                telegram_username TEXT,
                avatar_url TEXT,
                balance REAL DEFAULT 0,
                initial_fee_paid INTEGER DEFAULT 0,
                initial_fee_amount REAL DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Подписки (тарифные планы)
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
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Категории (линии задач)
            CREATE TABLE IF NOT EXISTS categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                display_name TEXT NOT NULL,
                description TEXT TEXT NOT NULL,
                icon TEXT NOT NULL,
                color TEXT DEFAULT '#FF6B8B',
                sort_order INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Топ услуги (сезонные)
            CREATE TABLE IF NOT EXISTS top_services (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                is_active INTEGER DEFAULT 1,
                sort_order INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (category_id) REFERENCES categories(id)
            );

            -- Шпаргалки для линий
            CREATE TABLE IF NOT EXISTS line_cheatsheets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                sort_order INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (category_id) REFERENCES categories(id)
            );

            -- Подсказки при создании задачи
            CREATE TABLE IF NOT EXISTS task_hints (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                step_number INTEGER NOT NULL,
                sort_order INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (category_id) REFERENCES categories(id)
            );

            -- Задачи
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_number TEXT UNIQUE,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                client_id INTEGER NOT NULL,
                performer_id INTEGER,
                category_id INTEGER NOT NULL,
                status TEXT DEFAULT 'new',
                priority TEXT DEFAULT 'medium',
                price REAL DEFAULT 0,
                address TEXT NOT NULL,
                location_lat REAL,
                location_lng REAL,
                deadline DATETIME NOT NULL,
                contact_info TEXT,
                additional_requirements TEXT,
                is_urgent INTEGER DEFAULT 0,
                completed_at TIMESTAMP,
                rating INTEGER,
                feedback TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (client_id) REFERENCES users(id),
                FOREIGN KEY (performer_id) REFERENCES users(id),
                FOREIGN KEY (category_id) REFERENCES categories(id)
            );

            -- История статусов задач
            CREATE TABLE IF NOT EXISTS task_status_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                status TEXT NOT NULL,
                changed_by INTEGER NOT NULL,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (task_id) REFERENCES tasks(id),
                FOREIGN KEY (changed_by) REFERENCES users(id)
            );

            -- Платежи
            CREATE TABLE IF NOT EXISTS payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                subscription_id INTEGER,
                amount REAL NOT NULL,
                currency TEXT DEFAULT 'RUB',
                description TEXT,
                status TEXT DEFAULT 'pending',
                payment_method TEXT,
                transaction_id TEXT UNIQUE,
                invoice_id TEXT,
                payment_data TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
            );

            -- Уведомления
            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                type TEXT DEFAULT 'info',
                is_read INTEGER DEFAULT 0,
                data TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            -- Чат задачи
            CREATE TABLE IF NOT EXISTS task_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                message TEXT NOT NULL,
                attachment_url TEXT,
                is_read INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (task_id) REFERENCES tasks(id),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            -- Отзывы
            CREATE TABLE IF NOT EXISTS reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                client_id INTEGER NOT NULL,
                performer_id INTEGER NOT NULL,
                rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
                comment TEXT,
                is_anonymous INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (task_id) REFERENCES tasks(id),
                FOREIGN KEY (client_id) REFERENCES users(id),
                FOREIGN KEY (performer_id) REFERENCES users(id)
            );

            -- Статистика
            CREATE TABLE IF NOT EXISTS statistics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date DATE UNIQUE,
                total_users INTEGER DEFAULT 0,
                active_users INTEGER DEFAULT 0,
                total_tasks INTEGER DEFAULT 0,
                completed_tasks INTEGER DEFAULT 0,
                total_revenue REAL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Настройки системы
            CREATE TABLE IF NOT EXISTS system_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT UNIQUE NOT NULL,
                value TEXT NOT NULL,
                description TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Индексы для производительности
            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
            CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
            CREATE INDEX IF NOT EXISTS idx_users_subscription ON users(subscription_plan, subscription_status);
            CREATE INDEX IF NOT EXISTS idx_tasks_client ON tasks(client_id);
            CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
            CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category_id);
            CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
            CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
            CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
            CREATE INDEX IF NOT EXISTS idx_categories_active ON categories(is_active, sort_order);
            CREATE INDEX IF NOT EXISTS idx_top_services_active ON top_services(is_active, sort_order);
        `);

        console.log('✅ Все таблицы созданы');
        
        // Создаем тестовые данные
        await createTestData();
        
        // Инициализируем Telegram бота
        await initTelegramBot();
        
        return db;
    } catch (error) {
        console.error('❌ Ошибка инициализации базы данных:', error.message);
        console.error(error.stack);
        
        // Пробуем in-memory базу для тестирования
        try {
            console.log('🔄 Пробуем in-memory базу данных...');
            db = await open({
                filename: ':memory:',
                driver: sqlite3.Database
            });
            
            await db.exec(`
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT UNIQUE NOT NULL,
                    password TEXT NOT NULL,
                    firstName TEXT NOT NULL,
                    lastName TEXT NOT NULL,
                    role TEXT DEFAULT 'client',
                    subscription_plan TEXT DEFAULT 'free'
                );
                
                CREATE TABLE categories (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL,
                    display_name TEXT NOT NULL
                );
                
                CREATE TABLE tasks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    client_id INTEGER,
                    category_id INTEGER,
                    status TEXT DEFAULT 'new'
                );
            `);
            
            await createTestData();
            console.log('✅ In-memory база создана');
            return db;
        } catch (fallbackError) {
            console.error('❌ Критическая ошибка:', fallbackError.message);
            throw error;
        }
    }
};

// ==================== ТЕСТОВЫЕ ДАННЫЕ ====================
const createTestData = async () => {
    try {
        console.log('📝 Создание тестовых данных...');
        
        // 1. Настройки системы
        const settingsCount = await db.get('SELECT COUNT(*) as count FROM system_settings');
        if (!settingsCount || settingsCount.count === 0) {
            console.log('📝 Создаем настройки системы...');
            
            const settings = [
                ['app_name', 'Консьерж Сервис', 'Название приложения'],
                ['contact_email', 'info@concierge-service.ru', 'Контактный email'],
                ['contact_phone', '+7 (999) 123-45-67', 'Контактный телефон'],
                ['support_hours', 'Ежедневно с 9:00 до 21:00', 'Часы работы поддержки'],
                ['telegram_channel', 'https://t.me/concierge_service', 'Telegram канал'],
                ['top_services_title', 'Здесь собраны самые популярные услуги', 'Заголовок для топ услуг'],
                ['task_help_title', 'Что не забыть при формировании заказа?', 'Заголовок подсказки задачи']
            ];

            for (const setting of settings) {
                await db.run(
                    `INSERT OR IGNORE INTO system_settings (key, value, description) VALUES (?, ?, ?)`,
                    setting
                );
            }
            console.log('✅ Настройки созданы');
        }

        // 2. Подписки
        const subscriptionCount = await db.get('SELECT COUNT(*) as count FROM subscriptions');
        if (!subscriptionCount || subscriptionCount.count === 0) {
            console.log('📝 Создаем подписки...');
            
            const subscriptions = [
                ['free', 'Бесплатная', 'Для знакомства с сервисом. 1 задача в месяц.', 0, 0, 0, 1, 
                 '["До 1 задачи в месяц", "Базовые категории", "Поддержка по email", "Доступ к мобильному приложению"]', '#95A5A6', 1],
                
                ['basic', 'Базовая', 'Для регулярных бытовых задач. 3 задачи в месяц.', 990, 9900, 500, 3,
                 '["До 3 задач в месяц", "Все категории услуг", "Приоритет 48 часов", "Поддержка 24/7 в чате", "Push-уведомления"]', '#3498DB', 2],
                
                ['premium', 'Премиум', 'Для максимального комфорта. 10 задач в месяц.', 2990, 29900, 1000, 10,
                 '["До 10 задач в месяц", "Все категории услуг", "Приоритет 24 часа", "Личный куратор", "Расширенная статистика", "Бесплатная отмена"]', '#9B59B6', 3],
                
                ['business', 'Бизнес', 'Для бизнеса и семьи. Неограниченные задачи.', 9990, 99900, 2000, 9999,
                 '["Неограниченные задачи", "Все категории услуг", "Приоритет 12 часов", "Личный менеджер", "Расширенная статистика", "API доступ", "Бесплатная отмена", "Приоритетная поддержка"]', '#E74C3C', 4]
            ];

            for (const sub of subscriptions) {
                await db.run(
                    `INSERT OR IGNORE INTO subscriptions 
                    (name, display_name, description, price_monthly, price_yearly, initial_fee, tasks_limit, features, color_theme, sort_order) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    sub
                );
            }
            console.log('✅ Подписки созданы');
        }

        // 3. Категории (линии задач)
        const categoriesCount = await db.get('SELECT COUNT(*) as count FROM categories');
        if (!categoriesCount || categoriesCount.count === 0) {
            console.log('📝 Создаем категории (линии задач)...');
            
            const categories = [
                ['home_and_household', 'Дом и быт', 'Услуги для дома и бытовых нужд', '🏠', '#FF6B8B', 1],
                ['family_and_children', 'Дети и семья', 'Услуги для детей и семейных нужд', '👨‍👩‍👧‍👦', '#3498DB', 2],
                ['beauty_and_health', 'Красота и здоровье', 'Услуги красоты и здоровья', '💅', '#9B59B6', 3],
                ['courses_and_education', 'Курсы и образование', 'Образовательные услуги', '🎓', '#2ECC71', 4],
                ['pets', 'Питомцы', 'Услуги для домашних животных', '🐕', '#F39C12', 5],
                ['events_and_entertainment', 'Мероприятия', 'Организация мероприятий', '🎉', '#E74C3C', 6]
            ];

            for (const cat of categories) {
                await db.run(
                    `INSERT OR IGNORE INTO categories 
                    (name, display_name, description, icon, color, sort_order) 
                    VALUES (?, ?, ?, ?, ?, ?)`,
                    cat
                );
            }
            console.log('✅ Категории созданы');
        }

        // 4. Топ услуги
        const topServicesCount = await db.get('SELECT COUNT(*) as count FROM top_services');
        if (!topServicesCount || topServicesCount.count === 0) {
            console.log('📝 Создаем топ услуги...');
            
            const topServices = [
                [1, 'Уборка квартиры', 'Генеральная уборка после ремонта или переезда', 1],
                [1, 'Химчистка мебели', 'Профессиональная химчистка диванов и кресел', 2],
                [1, 'Стирка белья', 'Стирка и глажка белья с доставкой', 3],
                [2, 'Няня на час', 'Присмотр за детьми на несколько часов', 1],
                [2, 'Репетитор для ребенка', 'Помощь с уроками по школьным предметам', 2],
                [2, 'Секция по интересам', 'Подбор и запись в детские кружки', 3],
                [3, 'Маникюр на дому', 'Профессиональный маникюр с выездом', 1],
                [3, 'Стрижка и укладка', 'Парикмахерские услуги дома', 2],
                [3, 'Массаж расслабляющий', 'Профессиональный массаж на дому', 3]
            ];

            for (const service of topServices) {
                await db.run(
                    `INSERT OR IGNORE INTO top_services 
                    (category_id, name, description, sort_order) 
                    VALUES (?, ?, ?, ?)`,
                    service
                );
            }
            console.log('✅ Топ услуги созданы');
        }

        // 5. Шпаргалки для линий
        const cheatsheetsCount = await db.get('SELECT COUNT(*) as count FROM line_cheatsheets');
        if (!cheatsheetsCount || cheatsheetsCount.count === 0) {
            console.log('📝 Создаем шпаргалки для линий...');
            
            const cheatsheets = [
                [1, 'Популярные услуги', 'Уборка квартиры (генеральная, после ремонта), химчистка мебели и ковров, прачечная услуги (стирка, глажка), помощь в организации пространства (расхламление), мелкий ремонт по дому', 1],
                [2, 'Что мы предлагаем', 'Няня на час/день/под задачу/беби ситер, репетитор по школьным предметам, кружки и секции (подбор и запись), сопровождение на мероприятия, помощь с подготовкой к школе', 1],
                [3, 'Наши специалисты', 'Маникюр/педикюр на дому, стилист/парикмахер/визажист, массажист (лечебный, расслабляющий), косметолог, инструктор по фитнесу (индивидуальные тренировки)', 1],
                [4, 'Образовательные услуги', 'Репетиторы по всем предметам, подготовка к ЕГЭ/ОГЭ, курсы иностранных языков, компьютерные курсы, помощь с дипломными и курсовыми', 1],
                [5, 'Для ваших питомцев', 'Выгул собак, передержка, груминг (стрижка), ветеринар на дом, дрессировка, зоотакси', 1],
                [6, 'Организация мероприятий', 'Детские праздники, корпоративы, дни рождения, фотосессии, кейтеринг, ведущие и аниматоры', 1]
            ];

            for (const sheet of cheatsheets) {
                await db.run(
                    `INSERT OR IGNORE INTO line_cheatsheets 
                    (category_id, title, content, sort_order) 
                    VALUES (?, ?, ?, ?)`,
                    sheet
                );
            }
            console.log('✅ Шпаргалки созданы');
        }

        // 6. Подсказки при создании задачи
        const hintsCount = await db.get('SELECT COUNT(*) as count FROM task_hints');
        if (!hintsCount || hintsCount.count === 0) {
            console.log('📝 Создаем подсказки для задач...');
            
            const hints = [
                [1, 'Что не забыть?', 'Опишите площадь помещения, есть ли домашние животные, нужны ли моющие средства, есть ли аллергия на химию', 1],
                [1, 'Когда нужно?', 'Укажите удобную дату и время, нужна ли срочная уборка, планируете ли регулярные услуги', 2],
                [2, 'О ребенке', 'Возраст ребенка, особенности поведения, аллергии, любимые занятия, режим дня', 1],
                [2, 'Требования к няне', 'Опыт работы, знание языков, образование, наличие медкнижки, водительские права', 2],
                [3, 'Детали услуги', 'Тип маникюра/стрижки, предпочтения по стилю, аллергии на материалы, сложность работы', 1],
                [3, 'Оборудование', 'Нужны ли свои инструменты, есть ли розетки, нужны ли дополнительные материалы', 2]
            ];

            for (const hint of hints) {
                await db.run(
                    `INSERT OR IGNORE INTO task_hints 
                    (category_id, title, content, step_number) 
                    VALUES (?, ?, ?, ?)`,
                    hint
                );
            }
            console.log('✅ Подсказки созданы');
        }

        // 7. Тестовые пользователи
        const usersCount = await db.get('SELECT COUNT(*) as count FROM users WHERE email LIKE ?', ['%@example.com']);
        if (!usersCount || usersCount.count === 0) {
            console.log('📝 Создаем тестовых пользователей...');
            
            const users = [
                {
                    email: 'superadmin@concierge.ru',
                    password: 'admin123',
                    firstName: 'Супер',
                    lastName: 'Администратор',
                    phone: '+79991112233',
                    role: 'superadmin',
                    subscription: 'business',
                    telegram: '@concierge_admin',
                    initial_fee_paid: 1,
                    initial_fee_amount: 2000
                },
                {
                    email: 'admin@concierge.ru',
                    password: 'admin123',
                    firstName: 'Администратор',
                    lastName: 'Системы',
                    phone: '+79992223344',
                    role: 'admin',
                    subscription: 'premium',
                    telegram: '@concierge_manager',
                    initial_fee_paid: 1,
                    initial_fee_amount: 1000
                },
                {
                    email: 'manager@concierge.ru',
                    password: 'manager123',
                    firstName: 'Менеджер',
                    lastName: 'Поддержки',
                    phone: '+79993334455',
                    role: 'manager',
                    subscription: 'premium',
                    telegram: '@concierge_support',
                    initial_fee_paid: 1,
                    initial_fee_amount: 1000
                },
                {
                    email: 'performer@concierge.ru',
                    password: 'performer123',
                    firstName: 'Исполнитель',
                    lastName: 'Тестовый',
                    phone: '+79994445566',
                    role: 'performer',
                    subscription: 'basic',
                    telegram: '@concierge_performer',
                    initial_fee_paid: 1,
                    initial_fee_amount: 500
                },
                {
                    email: 'client1@example.com',
                    password: 'client123',
                    firstName: 'Мария',
                    lastName: 'Иванова',
                    phone: '+79995556677',
                    role: 'client',
                    subscription: 'premium',
                    telegram: '@maria_ivanova',
                    initial_fee_paid: 1,
                    initial_fee_amount: 1000
                },
                {
                    email: 'client2@example.com',
                    password: 'client123',
                    firstName: 'Алексей',
                    lastName: 'Петров',
                    phone: '+79996667788',
                    role: 'client',
                    subscription: 'basic',
                    telegram: '@alexey_petrov',
                    initial_fee_paid: 1,
                    initial_fee_amount: 500
                }
            ];

            for (const user of users) {
                const hashedPassword = await bcrypt.hash(user.password, 10);
                const expiryDate = new Date();
                expiryDate.setFullYear(expiryDate.getFullYear() + 1);
                
                await db.run(
                    `INSERT OR IGNORE INTO users 
                    (email, password, firstName, lastName, phone, role, subscription_plan, subscription_status, 
                     subscription_expires, telegram_username, avatar_url, balance, initial_fee_paid, 
                     initial_fee_amount, is_active) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, 1)`,
                    [
                        user.email,
                        hashedPassword,
                        user.firstName,
                        user.lastName,
                        user.phone,
                        user.role,
                        user.subscription,
                        expiryDate.toISOString().split('T')[0],
                        user.telegram,
                        `https://ui-avatars.com/api/?name=${user.firstName}+${user.lastName}&background=FF6B8B&color=fff`,
                        user.role === 'client' ? 5000 : 0,
                        user.initial_fee_paid,
                        user.initial_fee_amount
                    ]
                );
            }
            console.log('✅ Тестовые пользователи созданы');
        }

        // 8. Тестовые задачи
        const tasksCount = await db.get('SELECT COUNT(*) as count FROM tasks');
        if (!tasksCount || tasksCount.count === 0) {
            console.log('📝 Создаем тестовые задачи...');
            
            const tasks = [
                {
                    task_number: 'TASK-2024-001',
                    title: 'Уборка 3-х комнатной квартиры после ремонта',
                    description: 'Нужна генеральная уборка после ремонта. Особое внимание кухне и санузлу. Площадь 85 кв.м.',
                    client_id: 5,
                    category_id: 1,
                    status: 'completed',
                    priority: 'high',
                    price: 3500,
                    address: 'Москва, ул. Тверская, д. 25, кв. 48',
                    deadline: '2024-01-15 18:00:00',
                    contact_info: 'Мария, +79995556677',
                    additional_requirements: 'Есть кот, убрать шерсть. Аллергия на хлор.'
                },
                {
                    task_number: 'TASK-2024-002',
                    title: 'Няня на субботу с 10:00 до 18:00',
                    description: 'Присмотреть за ребенком 6 лет. Помочь с обедом, погулять в парке, поиграть в развивающие игры.',
                    client_id: 5,
                    category_id: 2,
                    status: 'in_progress',
                    priority: 'medium',
                    price: 2000,
                    address: 'Москва, ул. Ленина, д. 10, кв. 12',
                    deadline: '2024-01-20 18:00:00',
                    contact_info: 'Мария, +79995556677',
                    additional_requirements: 'Ребенок аллергик (на цитрусовые). Любит лего и рисование.'
                },
                {
                    task_number: 'TASK-2024-003',
                    title: 'Маникюр с французским дизайном',
                    description: 'Сделать классический маникюр с покрытием гель-лаком. Французский дизайн. Ногти средней длины.',
                    client_id: 6,
                    category_id: 3,
                    status: 'new',
                    priority: 'medium',
                    price: 1500,
                    address: 'Москва, пр. Мира, д. 15, кв. 7',
                    deadline: '2024-01-18 19:00:00',
                    contact_info: 'Алексей, +79996667788',
                    additional_requirements: 'Для жены. Нужен мастер с оборудованием. Аллергия на некоторые гель-лаки.'
                },
                {
                    task_number: 'TASK-2024-004',
                    title: 'Репетитор по математике 8 класс',
                    description: 'Помочь с подготовкой к контрольной по алгебре. Тема: квадратные уравнения. 2 часа занятий.',
                    client_id: 6,
                    category_id: 4,
                    status: 'assigned',
                    priority: 'high',
                    price: 1200,
                    address: 'Москва, ул. Гагарина, д. 8, кв. 32',
                    deadline: '2024-01-16 17:00:00',
                    contact_info: 'Алексей, +79996667788',
                    additional_requirements: 'У ребенка трудности с пониманием темы. Нужен терпеливый репетитор.'
                }
            ];

            for (const task of tasks) {
                await db.run(
                    `INSERT OR IGNORE INTO tasks 
                    (task_number, title, description, client_id, category_id, status, priority, price, address, deadline, contact_info, additional_requirements) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        task.task_number,
                        task.title,
                        task.description,
                        task.client_id,
                        task.category_id,
                        task.status,
                        task.priority,
                        task.price,
                        task.address,
                        task.deadline,
                        task.contact_info,
                        task.additional_requirements
                    ]
                );
            }
            console.log('✅ Тестовые задачи созданы');
        }

        // 9. История статусов
        const statusHistoryCount = await db.get('SELECT COUNT(*) as count FROM task_status_history');
        if (!statusHistoryCount || statusHistoryCount.count === 0) {
            console.log('📝 Создаем историю статусов...');
            
            const history = [
                [1, 'new', 5, 'Задача создана клиентом'],
                [1, 'assigned', 2, 'Задача назначена менеджером'],
                [1, 'in_progress', 4, 'Исполнитель приступил к работе'],
                [1, 'completed', 5, 'Клиент подтвердил выполнение'],
                [2, 'new', 5, 'Задача создана клиентом'],
                [2, 'assigned', 2, 'Задача назначена менеджером'],
                [2, 'in_progress', 4, 'Исполнитель приступил к работе'],
                [3, 'new', 6, 'Задача создана клиентом'],
                [4, 'new', 6, 'Задача создана клиентом'],
                [4, 'assigned', 2, 'Задача назначена менеджером']
            ];

            for (const item of history) {
                await db.run(
                    `INSERT OR IGNORE INTO task_status_history 
                    (task_id, status, changed_by, notes) 
                    VALUES (?, ?, ?, ?)`,
                    item
                );
            }
            console.log('✅ История статусов создана');
        }

        console.log('🎉 Все тестовые данные успешно созданы!');
        
        // Выводим информацию для тестирования
        console.log('\n🔑 ТЕСТОВЫЕ АККАУНТЫ:');
        console.log('👑 Суперадмин: superadmin@concierge.ru / admin123');
        console.log('👨‍💼 Админ: admin@concierge.ru / admin123');
        console.log('👨‍💼 Менеджер: manager@concierge.ru / manager123');
        console.log('👨‍🏫 Исполнитель: performer@concierge.ru / performer123');
        console.log('👩 Клиент Premium: client1@example.com / client123');
        console.log('👨 Клиент Basic: client2@example.com / client123');
        
    } catch (error) {
        console.error('⚠️ Ошибка создания тестовых данных:', error.message);
        console.error(error.stack);
    }
};

// ==================== TELEGRAM BOT ====================
const initTelegramBot = async () => {
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    
    if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'YOUR_BOT_TOKEN_HERE') {
        console.log('🤖 Telegram Bot: Токен не указан. Добавьте TELEGRAM_BOT_TOKEN в .env файл');
        return null;
    }
    
    if (!TelegramBot) {
        console.log('🤖 Telegram Bot: модуль не установлен');
        return null;
    }
    
    try {
        console.log('🤖 Запуск Telegram Bot...');
        
        // Создаем бота с polling
        const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
            polling: {
                interval: 300,
                autoStart: true,
                params: {
                    timeout: 10
                }
            }
        });
        
        // Обработчики команд
        bot.onText(/\/start/, async (msg) => {
            const chatId = msg.chat.id;
            const userName = msg.from.first_name || 'друг';
            
            try {
                // Проверяем, есть ли пользователь в базе
                const user = await db.get(
                    'SELECT id, firstName, subscription_plan FROM users WHERE telegram_id = ? OR telegram_username = ?',
                    [chatId.toString(), `@${msg.from.username}`]
                );
                
                let message = `🎀 Привет, ${userName}! Добро пожаловать в Консьерж Сервис!\n\n`;
                
                if (user) {
                    message += `Я вижу, что вы уже зарегистрированы у нас!\n`;
                    message += `👤 Имя: ${user.firstName}\n`;
                    message += `📋 Подписка: ${user.subscription_plan}\n\n`;
                    message += `Используйте команды ниже для управления задачами:`;
                } else {
                    message += `Я ваш персональный помощник в бытовых вопросах.\n`;
                    message += `Для начала работы зарегистрируйтесь на нашем сайте:\n`;
                    message += `🌐 https://concierge-service.ru\n\n`;
                    message += `После регистрации привяжите Telegram в настройках профиля.`;
                }
                
                message += `\n\n🛠️ Доступные команды:\n`;
                message += `/start - Начало работы\n`;
                message += `/help - Помощь и инструкции\n`;
                message += `/status - Статус системы\n`;
                message += `/tasks - Мои задачи\n`;
                message += `/profile - Мой профиль\n`;
                message += `/website - Перейти на сайт`;
                
                const keyboard = {
                    reply_markup: {
                        keyboard: [
                            [{ text: '🌐 Открыть сайт' }],
                            [{ text: '📋 Мои задачи' }, { text: '👤 Профиль' }],
                            [{ text: '🆘 Помощь' }, { text: '📊 Статистика' }]
                        ],
                        resize_keyboard: true,
                        one_time_keyboard: false
                    }
                };
                
                bot.sendMessage(chatId, message, keyboard);
                
            } catch (error) {
                console.error('Ошибка обработки /start:', error);
                bot.sendMessage(chatId, 'Привет! Я бот Консьерж Сервиса. К сожалению, возникла техническая ошибка. Пожалуйста, попробуйте позже.');
            }
        });
        
        bot.onText(/\/tasks/, async (msg) => {
            const chatId = msg.chat.id;
            
            try {
                // Находим пользователя по telegram_id
                const user = await db.get('SELECT id FROM users WHERE telegram_id = ?', [chatId.toString()]);
                
                if (!user) {
                    bot.sendMessage(chatId, 'Вы не привязали Telegram к аккаунту. Сделайте это в настройках профиля на сайте.');
                    return;
                }
                
                const tasks = await db.all(
                    `SELECT t.*, c.display_name as category_name 
                     FROM tasks t 
                     LEFT JOIN categories c ON t.category_id = c.id 
                     WHERE t.client_id = ? 
                     ORDER BY t.created_at DESC LIMIT 5`,
                    [user.id]
                );
                
                if (tasks.length === 0) {
                    bot.sendMessage(chatId, 'У вас пока нет задач. Создайте первую задачу на сайте!');
                    return;
                }
                
                let message = `📋 *Ваши задачи (последние 5):*\n\n`;
                
                tasks.forEach((task, index) => {
                    const statusEmoji = {
                        'new': '🆕',
                        'assigned': '👤',
                        'in_progress': '🔄',
                        'completed': '✅',
                        'cancelled': '❌'
                    }[task.status] || '📝';
                    
                    message += `${index + 1}. ${statusEmoji} *${task.title}*\n`;
                    message += `   📍 Категория: ${task.category_name}\n`;
                    message += `   ⏰ До: ${new Date(task.deadline).toLocaleDateString('ru-RU')}\n`;
                    message += `   💰 ${task.price}₽\n`;
                    message += `   🏷️ ${task.status}\n\n`;
                });
                
                message += `🌐 Для управления задачами перейдите на сайт.`;
                
                bot.sendMessage(chatId, message, { 
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🌐 Открыть сайт', url: 'https://concierge-service.ru/tasks' }]
                        ]
                    }
                });
                
            } catch (error) {
                console.error('Ошибка получения задач:', error);
                bot.sendMessage(chatId, 'Ошибка получения задач. Попробуйте позже.');
            }
        });
        
        // Уведомление о новых задачах для менеджеров
        const notifyManagersAboutNewTask = async (taskId) => {
            try {
                const managers = await db.all(
                    'SELECT telegram_id FROM users WHERE role IN ("admin", "manager", "superadmin") AND telegram_id IS NOT NULL'
                );
                
                const task = await db.get(
                    `SELECT t.*, c.display_name as category_name, u.firstName, u.lastName 
                     FROM tasks t 
                     LEFT JOIN categories c ON t.category_id = c.id 
                     LEFT JOIN users u ON t.client_id = u.id 
                     WHERE t.id = ?`,
                    [taskId]
                );
                
                if (!task) return;
                
                const message = `🆕 *Новая задача создана!*\n\n` +
                               `*${task.title}*\n` +
                               `📋 Категория: ${task.category_name}\n` +
                               `👤 Клиент: ${task.firstName} ${task.lastName}\n` +
                               `📞 Контакт: ${task.contact_info}\n` +
                               `📍 Адрес: ${task.address}\n` +
                               `⏰ Срок: ${new Date(task.deadline).toLocaleString('ru-RU')}\n` +
                               `💰 Стоимость: ${task.price}₽\n\n` +
                               `[Перейти к задаче](https://concierge-service.ru/admin)`;
                
                for (const manager of managers) {
                    try {
                        await bot.sendMessage(
                            manager.telegram_id,
                            message,
                            { parse_mode: 'Markdown', disable_web_page_preview: true }
                        );
                    } catch (error) {
                        console.log(`Не удалось отправить уведомление менеджеру ${manager.telegram_id}:`, error.message);
                    }
                }
            } catch (error) {
                console.error('Ошибка отправки уведомлений менеджерам:', error);
            }
        };
        
        console.log('✅ Telegram Bot запущен успешно');
        telegramBot = bot;
        
        // Экспортируем функцию для использования в API
        module.exports.notifyManagersAboutNewTask = notifyManagersAboutNewTask;
        
        return bot;
        
    } catch (error) {
        console.error('❌ Ошибка запуска Telegram Bot:', error.message);
        return null;
    }
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
                'GET /api/system/info',
                'GET /api/subscriptions',
                'GET /api/categories',
                'GET /api/categories/top-services',
                'GET /api/categories/cheatsheet',
                'GET /api/categories/hints',
                'POST /api/auth/register',
                'POST /api/auth/login',
                'OPTIONS'
            ];
            
            const currentRoute = `${req.method} ${req.path}`;
            if (publicRoutes.some(route => currentRoute.startsWith(route))) {
                return next();
            }
            
            if (!authHeader) {
                return res.status(401).json({ 
                    success: false, 
                    error: 'Требуется авторизация. Отсутствует заголовок Authorization.' 
                });
            }
            
            if (!authHeader.startsWith('Bearer ')) {
                return res.status(401).json({ 
                    success: false, 
                    error: 'Неверный формат токена. Используйте "Bearer <token>".' 
                });
            }
            
            const token = authHeader.replace('Bearer ', '').trim();
            
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'concierge-secret-key-2024-prod');
                
                // Проверяем пользователя в БД
                const user = await db.get(
                    `SELECT id, email, firstName, lastName, phone, role, 
                            subscription_plan, subscription_status, subscription_expires,
                            initial_fee_paid, initial_fee_amount, is_active 
                     FROM users WHERE id = ?`,
                    [decoded.id]
                );
                
                if (!user || user.is_active !== 1) {
                    return res.status(401).json({ 
                        success: false, 
                        error: 'Пользователь не найден или аккаунт заблокирован' 
                    });
                }
                
                req.user = {
                    id: user.id,
                    email: user.email,
                    role: user.role,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    phone: user.phone,
                    subscription_plan: user.subscription_plan,
                    subscription_status: user.subscription_status,
                    subscription_expires: user.subscription_expires,
                    initial_fee_paid: user.initial_fee_paid,
                    initial_fee_amount: user.initial_fee_amount
                };
                
                // Проверка ролей
                if (roles.length > 0 && !roles.includes(user.role)) {
                    return res.status(403).json({ 
                        success: false, 
                        error: 'Недостаточно прав для выполнения этого действия' 
                    });
                }
                
                next();
                
            } catch (jwtError) {
                if (jwtError.name === 'TokenExpiredError') {
                    return res.status(401).json({ 
                        success: false, 
                        error: 'Токен истёк. Пожалуйста, войдите снова.' 
                    });
                }
                
                return res.status(401).json({ 
                    success: false, 
                    error: 'Неверный токен авторизации' 
                });
            }
            
        } catch (error) {
            console.error('Ошибка authMiddleware:', error);
            return res.status(500).json({ 
                success: false, 
                error: 'Внутренняя ошибка сервера при проверке авторизации' 
            });
        }
    };
};

// ==================== API МАРШРУТЫ ====================

// Главная
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: '🎀 Добро пожаловать в Консьерж Сервис API',
        version: '5.0.0',
        status: '🟢 Работает',
        features: ['Линии задач', 'Подписки с вступительным взносом', 'Telegram Bot', 'Задачи', 'Админ-панель', 'Управление контентом'],
        endpoints: {
            auth: [
                'POST /api/auth/register - Регистрация с оплатой вступительного взноса',
                'POST /api/auth/login - Вход',
                'GET /api/auth/profile - Профиль (требуется токен)'
            ],
            categories: [
                'GET /api/categories - Все линии задач',
                'GET /api/categories/top-services - Топ услуги',
                'GET /api/categories/cheatsheet - Шпаргалки для линий',
                'GET /api/categories/hints - Подсказки при создании задачи'
            ],
            subscriptions: [
                'GET /api/subscriptions - Все подписки',
                'POST /api/subscriptions/subscribe - Оформить подписку (требуется токен)',
                'GET /api/subscriptions/my - Моя подписка (требуется токен)'
            ],
            tasks: [
                'GET /api/tasks - Мои задачи (требуется токен)',
                'POST /api/tasks - Создать задачу (требуется токен)',
                'GET /api/tasks/:id - Получить задачу (требуется токен)',
                'PUT /api/tasks/:id - Обновить задачу (требуется токен)'
            ],
            admin: [
                'GET /api/admin/dashboard - Дашборд (admin)',
                'GET /api/admin/users - Пользователи (admin)',
                'GET /api/admin/tasks - Все задачи (admin)',
                'GET /api/admin/categories - Управление линиями (admin)',
                'POST /api/admin/settings - Настройки системы (admin)'
            ]
        },
        telegram_bot: telegramBot ? '✅ Активен' : '⚠️ Отключен',
        server_time: new Date().toISOString()
    });
});

// Health check
app.get('/health', async (req, res) => {
    try {
        await db.get('SELECT 1 as status');
        
        const [users, tasks, categories] = await Promise.all([
            db.get('SELECT COUNT(*) as count FROM users'),
            db.get('SELECT COUNT(*) as count FROM tasks'),
            db.get('SELECT COUNT(*) as count FROM categories WHERE is_active = 1')
        ]);
        
        res.json({
            success: true,
            status: 'OK',
            database: 'connected',
            telegram_bot: telegramBot ? 'connected' : 'disabled',
            statistics: {
                users: users.count,
                tasks: tasks.count,
                active_categories: categories.count
            },
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: {
                rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`,
                heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`,
                heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)} MB`
            }
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

// Регистрация с оплатой вступительного взноса
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, firstName, lastName, phone, role = 'client', subscription_plan = 'free' } = req.body;
        
        // Валидация
        if (!email || !password || !firstName || !lastName || !phone) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля: email, password, firstName, lastName, phone'
            });
        }
        
        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'Пароль должен содержать не менее 6 символов'
            });
        }
        
        if (!validateEmail(email)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный email адрес'
            });
        }
        
        // Проверка существующего пользователя
        const existingUser = await db.get('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUser) {
            return res.status(409).json({
                success: false,
                error: 'Пользователь с таким email уже существует'
            });
        }
        
        // Получаем информацию о выбранной подписке
        const subscription = await db.get(
            'SELECT * FROM subscriptions WHERE name = ? AND is_active = 1',
            [subscription_plan]
        );
        
        if (!subscription) {
            return res.status(400).json({
                success: false,
                error: 'Выбранная подписка не найдена'
            });
        }
        
        // Хеширование пароля
        const hashedPassword = await bcrypt.hash(password, 12);
        
        // Определяем, нужно ли оплачивать вступительный взнос
        const initialFeePaid = subscription.initial_fee === 0 ? 1 : 0;
        
        // Создание пользователя
        const result = await db.run(
            `INSERT INTO users 
            (email, password, firstName, lastName, phone, role, 
             subscription_plan, subscription_status, subscription_expires,
             initial_fee_paid, initial_fee_amount, avatar_url, balance) 
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, 0)`,
            [
                email,
                hashedPassword,
                firstName,
                lastName,
                phone,
                role,
                subscription_plan,
                null, // subscription_expires - будет установлено после оплаты
                initialFeePaid,
                subscription.initial_fee,
                `https://ui-avatars.com/api/?name=${encodeURIComponent(firstName)}+${encodeURIComponent(lastName)}&background=FF6B8B&color=fff&bold=true`
            ]
        );
        
        // Получаем созданного пользователя
        const user = await db.get(
            `SELECT id, email, firstName, lastName, phone, role, 
                    subscription_plan, subscription_status, subscription_expires,
                    initial_fee_paid, initial_fee_amount, avatar_url, created_at 
             FROM users WHERE id = ?`,
            [result.lastID]
        );
        
        // Создаем JWT токен
        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                role: user.role,
                firstName: user.firstName,
                lastName: user.lastName,
                subscription_plan: user.subscription_plan,
                initial_fee_paid: user.initial_fee_paid
            },
            process.env.JWT_SECRET || 'concierge-secret-key-2024-prod',
            { expiresIn: '30d' }
        );
        
        // Отправляем приветственное уведомление в базу
        await db.run(
            `INSERT INTO notifications (user_id, title, message, type) 
             VALUES (?, ?, ?, ?)`,
            [user.id, 'Добро пожаловать!', 'Регистрация прошла успешно. Для активации подписки оплатите вступительный взнос.', 'info']
        );
        
        res.status(201).json({
            success: true,
            message: initialFeePaid ? 'Регистрация успешно завершена!' : 'Регистрация успешна. Требуется оплата вступительного взноса.',
            data: { 
                user,
                token,
                requires_initial_fee: !initialFeePaid,
                initial_fee_amount: subscription.initial_fee,
                subscription_info: subscription
            }
        });
        
    } catch (error) {
        console.error('Ошибка регистрации:', error);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера при регистрации',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
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
        const user = await db.get('SELECT * FROM users WHERE email = ? AND is_active = 1', [email]);
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
                firstName: user.firstName,
                lastName: user.lastName,
                subscription_plan: user.subscription_plan,
                initial_fee_paid: user.initial_fee_paid
            },
            process.env.JWT_SECRET || 'concierge-secret-key-2024-prod',
            { expiresIn: '30d' }
        );
        
        // Удаляем пароль из ответа
        delete user.password;
        
        // Обновляем время последнего входа
        await db.run('UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
        
        // Добавляем уведомление о входе
        await db.run(
            `INSERT INTO notifications (user_id, title, message, type) 
             VALUES (?, ?, ?, ?)`,
            [user.id, 'Успешный вход', `Вы вошли в систему с IP: ${req.ip}`, 'info']
        );
        
        res.json({
            success: true,
            message: 'Вход выполнен успешно!',
            data: { 
                user,
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

// Профиль пользователя
app.get('/api/auth/profile', authMiddleware(), async (req, res) => {
    try {
        const user = await db.get(
            `SELECT id, email, firstName, lastName, phone, role, 
                    subscription_plan, subscription_status, subscription_expires,
                    telegram_username, telegram_id, avatar_url, balance, 
                    initial_fee_paid, initial_fee_amount,
                    is_active, created_at, updated_at 
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        // Получаем информацию о текущей подписке
        const subscription = await db.get(
            'SELECT * FROM subscriptions WHERE name = ?',
            [user.subscription_plan || 'free']
        );
        
        // Статистика за текущий месяц
        const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
        const stats = await db.get(`
            SELECT 
                COUNT(*) as total_tasks,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
                SUM(CASE WHEN status IN ('new', 'assigned', 'in_progress') THEN 1 ELSE 0 END) as active_tasks
            FROM tasks 
            WHERE client_id = ? 
            AND strftime('%Y-%m', created_at) = ?
        `, [req.user.id, currentMonth]);
        
        // Непрочитанные уведомления
        const unreadNotifications = await db.get(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
            [req.user.id]
        );
        
        res.json({
            success: true,
            data: { 
                user,
                subscription: subscription || null,
                stats: {
                    total_tasks: stats?.total_tasks || 0,
                    completed_tasks: stats?.completed_tasks || 0,
                    active_tasks: stats?.active_tasks || 0,
                    unread_notifications: unreadNotifications?.count || 0
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения профиля:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения профиля'
        });
    }
});

// ==================== КАТЕГОРИИ (ЛИНИИ ЗАДАЧ) ====================

// Получение всех активных категорий
app.get('/api/categories', async (req, res) => {
    try {
        const categories = await db.all(
            'SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order ASC'
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

// Получение топ услуг
app.get('/api/categories/top-services', async (req, res) => {
    try {
        const { category_id } = req.query;
        
        let query = `
            SELECT ts.*, c.display_name as category_name, c.icon as category_icon 
            FROM top_services ts 
            LEFT JOIN categories c ON ts.category_id = c.id 
            WHERE ts.is_active = 1
        `;
        const params = [];
        
        if (category_id) {
            query += ' AND ts.category_id = ?';
            params.push(category_id);
        }
        
        query += ' ORDER BY ts.sort_order ASC';
        
        const services = await db.all(query, params);
        
        // Получаем заголовок для топ услуг из настроек
        const titleSetting = await db.get(
            'SELECT value FROM system_settings WHERE key = ?',
            ['top_services_title']
        );
        
        res.json({
            success: true,
            data: {
                services,
                title: titleSetting?.value || 'Здесь собраны самые популярные услуги',
                count: services.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения топ услуг:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения топ услуг'
        });
    }
});

// Получение шпаргалки для линии
app.get('/api/categories/cheatsheet', async (req, res) => {
    try {
        const { category_id } = req.query;
        
        if (!category_id) {
            return res.status(400).json({
                success: false,
                error: 'Не указан category_id'
            });
        }
        
        const cheatsheets = await db.all(
            `SELECT lc.*, c.display_name as category_name 
             FROM line_cheatsheets lc 
             LEFT JOIN categories c ON lc.category_id = c.id 
             WHERE lc.category_id = ? 
             ORDER BY lc.sort_order ASC`,
            [category_id]
        );
        
        if (cheatsheets.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Шпаргалка не найдена для этой категории'
            });
        }
        
        res.json({
            success: true,
            data: {
                cheatsheets,
                category_name: cheatsheets[0].category_name
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения шпаргалки:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения шпаргалки'
        });
    }
});

// Получение подсказок при создании задачи
app.get('/api/categories/hints', async (req, res) => {
    try {
        const { category_id } = req.query;
        
        if (!category_id) {
            return res.status(400).json({
                success: false,
                error: 'Не указан category_id'
            });
        }
        
        const hints = await db.all(
            `SELECT th.*, c.display_name as category_name 
             FROM task_hints th 
             LEFT JOIN categories c ON th.category_id = c.id 
             WHERE th.category_id = ? 
             ORDER BY th.step_number ASC, th.sort_order ASC`,
            [category_id]
        );
        
        // Получаем заголовок подсказки из настроек
        const titleSetting = await db.get(
            'SELECT value FROM system_settings WHERE key = ?',
            ['task_help_title']
        );
        
        res.json({
            success: true,
            data: {
                hints,
                title: titleSetting?.value || 'Что не забыть при формировании заказа?',
                category_name: hints.length > 0 ? hints[0].category_name : ''
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения подсказок:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения подсказок'
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

// Оформление подписки с оплатой вступительного взноса
app.post('/api/subscriptions/subscribe', authMiddleware(['client']), async (req, res) => {
    try {
        const { plan, period = 'monthly', initial_fee_paid = false } = req.body;
        
        if (!plan) {
            return res.status(400).json({
                success: false,
                error: 'Укажите план подписки'
            });
        }
        
        // Проверяем существование плана
        const subscriptionPlan = await db.get(
            'SELECT * FROM subscriptions WHERE name = ? AND is_active = 1',
            [plan]
        );
        
        if (!subscriptionPlan) {
            return res.status(404).json({
                success: false,
                error: `План подписки "${plan}" не найден`
            });
        }
        
        // Проверяем, оплачен ли вступительный взнос
        if (!req.user.initial_fee_paid && !initial_fee_paid) {
            return res.status(400).json({
                success: false,
                error: 'Для активации подписки необходимо оплатить вступительный взнос',
                requires_initial_fee: true,
                initial_fee_amount: subscriptionPlan.initial_fee
            });
        }
        
        // Рассчитываем стоимость
        let amount = 0;
        if (plan !== 'free') {
            amount = period === 'monthly' ? subscriptionPlan.price_monthly : subscriptionPlan.price_yearly;
        }
        
        // Обновляем подписку пользователя
        const expiryDate = new Date();
        if (period === 'monthly') {
            expiryDate.setMonth(expiryDate.getMonth() + 1);
        } else if (period === 'yearly') {
            expiryDate.setFullYear(expiryDate.getFullYear() + 1);
        }
        
        const expiryDateString = expiryDate.toISOString().split('T')[0];
        
        await db.run(
            `UPDATE users SET 
                subscription_plan = ?,
                subscription_status = 'active',
                subscription_expires = ?,
                initial_fee_paid = ?,
                initial_fee_amount = ?,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [
                plan,
                expiryDateString,
                initial_fee_paid ? 1 : req.user.initial_fee_paid,
                subscriptionPlan.initial_fee,
                req.user.id
            ]
        );
        
        // Создаем запись о платеже
        const transactionId = `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
        
        // Если был вступительный взнос
        if (!req.user.initial_fee_paid && initial_fee_paid) {
            await db.run(
                `INSERT INTO payments 
                (user_id, subscription_id, amount, description, status, payment_method, transaction_id) 
                VALUES (?, ?, ?, ?, 'completed', 'initial_fee', ?)`,
                [
                    req.user.id,
                    subscriptionPlan.id,
                    subscriptionPlan.initial_fee,
                    `Вступительный взнос для подписки ${subscriptionPlan.display_name}`,
                    transactionId + '-INIT'
                ]
            );
        }
        
        // Если есть ежемесячная/ежегодная плата
        if (amount > 0) {
            await db.run(
                `INSERT INTO payments 
                (user_id, subscription_id, amount, description, status, payment_method, transaction_id) 
                VALUES (?, ?, ?, ?, 'completed', 'subscription', ?)`,
                [
                    req.user.id,
                    subscriptionPlan.id,
                    amount,
                    `Оплата подписки ${subscriptionPlan.display_name} (${period === 'monthly' ? 'месяц' : 'год'})`,
                    transactionId
                ]
            );
        }
        
        // Добавляем уведомление
        await db.run(
            `INSERT INTO notifications (user_id, title, message, type) 
             VALUES (?, ?, ?, ?)`,
            [
                req.user.id,
                'Подписка активирована!',
                `Вы успешно активировали подписку "${subscriptionPlan.display_name}". Действует до ${expiryDateString}.`,
                'success'
            ]
        );
        
        // Получаем обновленного пользователя
        const user = await db.get(
            `SELECT id, email, firstName, lastName, subscription_plan, 
                    subscription_status, subscription_expires, initial_fee_paid 
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        
        res.json({
            success: true,
            message: `Подписка "${subscriptionPlan.display_name}" успешно активирована!`,
            data: { 
                user,
                subscription: subscriptionPlan,
                payment: {
                    initial_fee: !req.user.initial_fee_paid ? subscriptionPlan.initial_fee : 0,
                    subscription_fee: amount,
                    total: (!req.user.initial_fee_paid ? subscriptionPlan.initial_fee : 0) + amount
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка оформления подписки:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка оформления подписки'
        });
    }
});

// Моя подписка
app.get('/api/subscriptions/my', authMiddleware(), async (req, res) => {
    try {
        const user = await db.get(
            `SELECT subscription_plan, subscription_status, subscription_expires, 
                    initial_fee_paid, initial_fee_amount 
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
            [user.subscription_plan || 'free']
        );
        
        // Статистика использования
        const currentMonth = new Date().toISOString().slice(0, 7);
        const tasksUsed = await db.get(
            `SELECT COUNT(*) as count FROM tasks 
             WHERE client_id = ? 
             AND strftime('%Y-%m', created_at) = ?`,
            [req.user.id, currentMonth]
        );
        
        const subscriptionInfo = {
            ...subscription,
            features: typeof subscription.features === 'string' ? JSON.parse(subscription.features) : subscription.features,
            current_usage: {
                tasks_used: tasksUsed?.count || 0,
                tasks_limit: subscription?.tasks_limit || 1,
                percentage: subscription?.tasks_limit ? Math.round((tasksUsed?.count || 0) / subscription.tasks_limit * 100) : 0
            },
            user_data: {
                status: user.subscription_status,
                expires: user.subscription_expires,
                initial_fee_paid: user.initial_fee_paid,
                initial_fee_amount: user.initial_fee_amount,
                is_active: user.subscription_status === 'active' && 
                          (!user.subscription_expires || new Date(user.subscription_expires) > new Date())
            }
        };
        
        res.json({
            success: true,
            data: subscriptionInfo
        });
        
    } catch (error) {
        console.error('Ошибка получения информации о подписке:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения информации о подписке'
        });
    }
});

// ==================== ЗАДАЧИ ====================

// Создание задачи через линию
app.post('/api/tasks', authMiddleware(['client', 'admin', 'superadmin']), async (req, res) => {
    try {
        const { 
            title, 
            description, 
            category_id, 
            priority = 'medium', 
            deadline, 
            address, 
            contact_info,
            additional_requirements,
            is_urgent = false
        } = req.body;
        
        // Валидация
        if (!title || !description || !category_id || !deadline || !address || !contact_info) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля: title, description, category_id, deadline, address, contact_info'
            });
        }
        
        // Проверяем существование категории
        const category = await db.get('SELECT * FROM categories WHERE id = ? AND is_active = 1', [category_id]);
        if (!category) {
            return res.status(404).json({
                success: false,
                error: 'Категория не найдена'
            });
        }
        
        // Проверяем подписку пользователя
        const user = await db.get(
            'SELECT subscription_plan, subscription_status, initial_fee_paid FROM users WHERE id = ?',
            [req.user.id]
        );
        
        if (!user || user.subscription_status !== 'active') {
            return res.status(403).json({
                success: false,
                error: 'Ваша подписка не активна. Активируйте подписку для создания задач.'
            });
        }
        
        // Проверяем оплачен ли вступительный взнос
        if (!user.initial_fee_paid) {
            return res.status(403).json({
                success: false,
                error: 'Для создания задач необходимо оплатить вступительный взнос'
            });
        }
        
        // Проверяем лимит задач
        const subscription = await db.get(
            'SELECT tasks_limit FROM subscriptions WHERE name = ?',
            [user.subscription_plan || 'free']
        );
        
        if (subscription) {
            const currentMonth = new Date().toISOString().slice(0, 7);
            const tasksCount = await db.get(
                `SELECT COUNT(*) as count FROM tasks 
                 WHERE client_id = ? 
                 AND strftime('%Y-%m', created_at) = ?`,
                [req.user.id, currentMonth]
            );
            
            if (tasksCount && tasksCount.count >= subscription.tasks_limit) {
                return res.status(403).json({
                    success: false,
                    error: `Лимит задач исчерпан (${subscription.tasks_limit} в месяц). Оформите более высокий тариф или дождитесь следующего месяца.`
                });
            }
        }
        
        // Проверяем дату дедлайна
        const deadlineDate = new Date(deadline);
        if (deadlineDate < new Date()) {
            return res.status(400).json({
                success: false,
                error: 'Дата дедлайна не может быть в прошлом'
            });
        }
        
        // Генерируем номер задачи
        const now = new Date();
        const taskNumber = `TASK-${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
        
        // Создаем задачу
        const result = await db.run(
            `INSERT INTO tasks 
            (task_number, title, description, client_id, category_id, priority, deadline, 
             address, contact_info, additional_requirements, is_urgent) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                taskNumber,
                title,
                description,
                req.user.id,
                category_id,
                priority,
                deadline,
                address,
                contact_info,
                additional_requirements || null,
                is_urgent ? 1 : 0
            ]
        );
        
        const taskId = result.lastID;
        
        // Добавляем запись в историю статусов
        await db.run(
            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
             VALUES (?, ?, ?, ?)`,
            [taskId, 'new', req.user.id, 'Задача создана клиентом']
        );
        
        const task = await db.get(
            `SELECT t.*, c.display_name as category_name 
             FROM tasks t 
             LEFT JOIN categories c ON t.category_id = c.id 
             WHERE t.id = ?`,
            [taskId]
        );
        
        // Добавляем уведомление клиенту
        await db.run(
            `INSERT INTO notifications (user_id, title, message, type, data) 
             VALUES (?, ?, ?, ?, ?)`,
            [
                req.user.id,
                'Задача создана!',
                `Задача "${title}" успешно создана. Номер: ${taskNumber}. Ожидайте предложений от менеджеров.`,
                'success',
                JSON.stringify({ task_id: task.id, task_number: taskNumber })
            ]
        );
        
        // Отправляем уведомления менеджерам
        const managers = await db.all(
            'SELECT id FROM users WHERE role IN ("admin", "manager", "superadmin")'
        );
        
        for (const manager of managers) {
            await db.run(
                `INSERT INTO notifications (user_id, title, message, type, data) 
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    manager.id,
                    'Новая задача создана',
                    `Клиент создал новую задачу: "${title}" (${category.display_name}). Номер: ${taskNumber}`,
                    'warning',
                    JSON.stringify({ task_id: task.id, category_id: category_id })
                ]
            );
        }
        
        // Отправляем уведомление в Telegram
        if (telegramBot && typeof telegramBot.sendMessage === 'function') {
            try {
                const managersWithTelegram = await db.all(
                    'SELECT telegram_id FROM users WHERE role IN ("admin", "manager", "superadmin") AND telegram_id IS NOT NULL'
                );
                
                for (const manager of managersWithTelegram) {
                    await telegramBot.sendMessage(
                        manager.telegram_id,
                        `🆕 *Новая задача создана!*\n\n` +
                        `*${title}*\n` +
                        `📋 Категория: ${category.display_name}\n` +
                        `👤 Клиент: ${req.user.firstName} ${req.user.lastName}\n` +
                        `📞 Контакт: ${contact_info}\n` +
                        `📍 Адрес: ${address}\n` +
                        `⏰ Срок: ${new Date(deadline).toLocaleString('ru-RU')}\n` +
                        `🔢 Номер: ${taskNumber}\n\n` +
                        `_Требуется назначение менеджера_`,
                        { parse_mode: 'Markdown' }
                    );
                }
            } catch (telegramError) {
                console.log('Не удалось отправить Telegram уведомление:', telegramError.message);
            }
        }
        
        res.status(201).json({
            success: true,
            message: 'Задача успешно создана! Менеджеры уведомлены.',
            data: { 
                task,
                notification: 'Менеджеры получили уведомление о новой задаче'
            }
        });
        
    } catch (error) {
        console.error('Ошибка создания задачи:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания задачи',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Получение задач пользователя
app.get('/api/tasks', authMiddleware(), async (req, res) => {
    try {
        const { status, category_id, limit = 50, offset = 0, sort = 'created_at', order = 'DESC' } = req.query;
        const userId = req.user.id;
        const userRole = req.user.role;
        
        let query = `
            SELECT t.*, 
                   c.display_name as category_name,
                   c.icon as category_icon,
                   u1.firstName as client_firstName, 
                   u1.lastName as client_lastName,
                   u1.avatar_url as client_avatar,
                   u2.firstName as performer_firstName,
                   u2.lastName as performer_lastName,
                   u2.avatar_url as performer_avatar
            FROM tasks t
            LEFT JOIN categories c ON t.category_id = c.id
            LEFT JOIN users u1 ON t.client_id = u1.id
            LEFT JOIN users u2 ON t.performer_id = u2.id
            WHERE 1=1
        `;
        
        const params = [];
        
        // Если пользователь не админ/менеджер, показываем только его задачи
        if (!['admin', 'manager', 'superadmin'].includes(userRole)) {
            query += ' AND t.client_id = ?';
            params.push(userId);
        }
        
        // Фильтрация по статусу
        if (status && status !== 'all') {
            query += ' AND t.status = ?';
            params.push(status);
        }
        
        // Фильтрация по категории
        if (category_id) {
            query += ' AND t.category_id = ?';
            params.push(category_id);
        }
        
        // Сортировка
        const validSortFields = ['created_at', 'deadline', 'priority', 'updated_at'];
        const validOrders = ['ASC', 'DESC'];
        const sortField = validSortFields.includes(sort) ? sort : 'created_at';
        const sortOrder = validOrders.includes(order.toUpperCase()) ? order.toUpperCase() : 'DESC';
        
        query += ` ORDER BY t.${sortField} ${sortOrder} LIMIT ? OFFSET ?`;
        params.push(parseInt(limit), parseInt(offset));
        
        const tasks = await db.all(query, params);
        
        // Получаем общее количество для пагинации
        let countQuery = 'SELECT COUNT(*) as total FROM tasks WHERE 1=1';
        const countParams = [];
        
        if (!['admin', 'manager', 'superadmin'].includes(userRole)) {
            countQuery += ' AND client_id = ?';
            countParams.push(userId);
        }
        
        if (status && status !== 'all') {
            countQuery += ' AND status = ?';
            countParams.push(status);
        }
        
        if (category_id) {
            countQuery += ' AND category_id = ?';
            countParams.push(category_id);
        }
        
        const countResult = await db.get(countQuery, countParams);
        const total = countResult?.total || 0;
        
        // Обогащаем задачи дополнительной информацией
        const enrichedTasks = tasks.map(task => {
            const statusInfo = {
                'new': { label: 'Новая', color: '#FF6B8B', icon: '🆕', can_cancel: true },
                'assigned': { label: 'Назначена', color: '#3498DB', icon: '👤', can_cancel: true },
                'in_progress': { label: 'В работе', color: '#F39C12', icon: '🔄', can_complete: true },
                'completed': { label: 'Завершена', color: '#2ECC71', icon: '✅', can_review: true },
                'cancelled': { label: 'Отменена', color: '#95A5A6', icon: '❌', can_recreate: true }
            }[task.status] || { label: task.status, color: '#95A5A6', icon: '📝' };
            
            const priorityInfo = {
                'low': { label: 'Низкий', color: '#2ECC71' },
                'medium': { label: 'Средний', color: '#F39C12' },
                'high': { label: 'Высокий', color: '#E74C3C' },
                'urgent': { label: 'Срочный', color: '#C0392B' }
            }[task.priority] || { label: task.priority, color: '#95A5A6' };
            
            return {
                ...task,
                status_info: statusInfo,
                priority_info: priorityInfo,
                is_urgent: task.is_urgent === 1,
                can_edit: task.status === 'new' && req.user.id === task.client_id,
                can_cancel: ['new', 'assigned'].includes(task.status) && 
                           (req.user.id === task.client_id || ['admin', 'manager', 'superadmin'].includes(req.user.role)),
                can_complete: task.status === 'in_progress' && 
                            (req.user.id === task.client_id || ['admin', 'manager', 'superadmin'].includes(req.user.role)),
                can_assign: ['admin', 'manager', 'superadmin'].includes(req.user.role) && task.status === 'new',
                can_chat: true
            };
        });
        
        res.json({
            success: true,
            data: {
                tasks: enrichedTasks,
                pagination: {
                    total,
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    has_more: (parseInt(offset) + parseInt(limit)) < total
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения задач:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения задач'
        });
    }
});

// Получение деталей задачи
app.get('/api/tasks/:id', authMiddleware(), async (req, res) => {
    try {
        const taskId = parseInt(req.params.id);
        
        if (isNaN(taskId)) {
            return res.status(400).json({
                success: false,
                error: 'Неверный ID задачи'
            });
        }
        
        const task = await db.get(
            `SELECT t.*, 
                    c.display_name as category_name,
                    c.icon as category_icon,
                    c.description as category_description,
                    u1.firstName as client_firstName, 
                    u1.lastName as client_lastName, 
                    u1.phone as client_phone,
                    u1.avatar_url as client_avatar,
                    u2.firstName as performer_firstName,
                    u2.lastName as performer_lastName,
                    u2.phone as performer_phone,
                    u2.avatar_url as performer_avatar
             FROM tasks t
             LEFT JOIN categories c ON t.category_id = c.id
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
        
        // Проверяем права доступа
        if (!['admin', 'manager', 'superadmin'].includes(req.user.role) && 
            req.user.id !== task.client_id && req.user.id !== task.performer_id) {
            return res.status(403).json({
                success: false,
                error: 'Нет доступа к этой задаче'
            });
        }
        
        // Получаем историю статусов
        const statusHistory = await db.all(
            `SELECT tsh.*, u.firstName, u.lastName 
             FROM task_status_history tsh
             LEFT JOIN users u ON tsh.changed_by = u.id
             WHERE tsh.task_id = ?
             ORDER BY tsh.created_at ASC`,
            [taskId]
        );
        
        // Получаем сообщения чата
        const messages = await db.all(
            `SELECT tm.*, u.firstName, u.lastName, u.avatar_url, u.role
             FROM task_messages tm
             LEFT JOIN users u ON tm.user_id = u.id
             WHERE tm.task_id = ?
             ORDER BY tm.created_at ASC`,
            [taskId]
        );
        
        // Получаем отзыв если есть
        const review = task.status === 'completed' ? await db.get(
            'SELECT * FROM reviews WHERE task_id = ?',
            [taskId]
        ) : null;
        
        // Определяем доступные действия
        const statusActions = {
            'new': ['cancel', 'assign'],
            'assigned': ['cancel', 'start_progress'],
            'in_progress': ['complete', 'request_changes'],
            'completed': ['review'],
            'cancelled': ['recreate']
        };
        
        const availableActions = statusActions[task.status] || [];
        
        // Добавляем дополнительные права
        if (req.user.id === task.client_id) {
            if (task.status === 'new') availableActions.push('edit');
            if (['new', 'assigned'].includes(task.status)) availableActions.push('cancel');
            if (task.status === 'in_progress') availableActions.push('complete');
            if (task.status === 'completed' && !review) availableActions.push('review');
        }
        
        if (['admin', 'manager', 'superadmin'].includes(req.user.role)) {
            if (task.status === 'new') availableActions.push('assign');
            if (['new', 'assigned', 'in_progress'].includes(task.status)) availableActions.push('cancel');
            if (task.status === 'assigned') availableActions.push('start_progress');
            if (task.status === 'in_progress') availableActions.push('complete');
        }
        
        res.json({
            success: true,
            data: {
                task: {
                    ...task,
                    is_urgent: task.is_urgent === 1,
                    status_history: statusHistory,
                    messages,
                    review,
                    available_actions: [...new Set(availableActions)], // Удаляем дубликаты
                    permissions: {
                        can_chat: true,
                        can_view_details: true,
                        can_manage: ['admin', 'manager', 'superadmin'].includes(req.user.role) || 
                                   req.user.id === task.client_id
                    }
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения задачи:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения задачи'
        });
    }
});

// Обновление статуса задачи
app.post('/api/tasks/:id/status', authMiddleware(), async (req, res) => {
    try {
        const taskId = parseInt(req.params.id);
        const { status, notes, performer_id } = req.body;
        
        if (isNaN(taskId)) {
            return res.status(400).json({
                success: false,
                error: 'Неверный ID задачи'
            });
        }
        
        if (!status) {
            return res.status(400).json({
                success: false,
                error: 'Не указан новый статус'
            });
        }
        
        // Получаем задачу
        const task = await db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        // Проверяем права
        const canChangeStatus = 
            ['admin', 'manager', 'superadmin'].includes(req.user.role) ||
            (req.user.id === task.client_id && ['cancelled', 'completed'].includes(status));
        
        if (!canChangeStatus) {
            return res.status(403).json({
                success: false,
                error: 'Нет прав для изменения статуса задачи'
            });
        }
        
        // Проверяем валидность перехода статусов
        const validTransitions = {
            'new': ['assigned', 'cancelled'],
            'assigned': ['in_progress', 'cancelled'],
            'in_progress': ['completed', 'cancelled'],
            'completed': [],
            'cancelled': ['new']
        };
        
        if (!validTransitions[task.status]?.includes(status)) {
            return res.status(400).json({
                success: false,
                error: `Недопустимый переход статуса: ${task.status} -> ${status}`
            });
        }
        
        // Обновляем статус задачи
        const updateData = { status };
        if (status === 'assigned' && performer_id) {
            updateData.performer_id = performer_id;
        }
        if (status === 'completed') {
            updateData.completed_at = new Date().toISOString();
        }
        
        const updateFields = Object.keys(updateData).map(key => `${key} = ?`).join(', ');
        const updateValues = [...Object.values(updateData), taskId];
        
        await db.run(
            `UPDATE tasks SET ${updateFields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            updateValues
        );
        
        // Добавляем запись в историю
        await db.run(
            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
             VALUES (?, ?, ?, ?)`,
            [taskId, status, req.user.id, notes || `Статус изменен на "${status}"`]
        );
        
        // Отправляем уведомления
        const notificationTitle = {
            'assigned': 'Задача назначена',
            'in_progress': 'Работа начата',
            'completed': 'Задача завершена',
            'cancelled': 'Задача отменена'
        }[status];
        
        const notificationMessage = {
            'assigned': `Задача "${task.title}" назначена исполнителю.`,
            'in_progress': `Исполнитель приступил к выполнению задачи "${task.title}".`,
            'completed': `Задача "${task.title}" завершена.`,
            'cancelled': `Задача "${task.title}" отменена.`
        }[status];
        
        // Уведомляем клиента
        if (req.user.id !== task.client_id) {
            await db.run(
                `INSERT INTO notifications (user_id, title, message, type, data) 
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    task.client_id,
                    notificationTitle,
                    notificationMessage + (notes ? ` Примечание: ${notes}` : ''),
                    'info',
                    JSON.stringify({ task_id: task.id, status })
                ]
            );
        }
        
        // Уведомляем исполнителя если есть
        if (performer_id && req.user.id !== performer_id) {
            await db.run(
                `INSERT INTO notifications (user_id, title, message, type, data) 
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    performer_id,
                    notificationTitle,
                    notificationMessage,
                    'info',
                    JSON.stringify({ task_id: task.id, status })
                ]
            );
        }
        
        // Если задача завершена, спрашиваем у клиента оценку
        if (status === 'completed') {
            await db.run(
                `INSERT INTO notifications (user_id, title, message, type, data) 
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    task.client_id,
                    'Оцените выполнение задачи',
                    `Задача "${task.title}" завершена. Пожалуйста, оцените качество выполнения.`,
                    'warning',
                    JSON.stringify({ task_id: task.id, action: 'rate_task' })
                ]
            );
        }
        
        res.json({
            success: true,
            message: `Статус задачи успешно изменен на "${status}"`,
            data: { 
                task_id: taskId,
                new_status: status,
                changed_by: req.user.id,
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Ошибка изменения статуса задачи:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка изменения статуса задачи'
        });
    }
});

// Отмена задачи
app.post('/api/tasks/:id/cancel', authMiddleware(), async (req, res) => {
    try {
        const taskId = parseInt(req.params.id);
        const { reason } = req.body;
        
        if (isNaN(taskId)) {
            return res.status(400).json({
                success: false,
                error: 'Неверный ID задачи'
            });
        }
        
        const task = await db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        // Проверяем права
        const canCancel = 
            ['admin', 'manager', 'superadmin'].includes(req.user.role) ||
            (req.user.id === task.client_id && ['new', 'assigned'].includes(task.status));
        
        if (!canCancel) {
            return res.status(403).json({
                success: false,
                error: 'Нет прав для отмены этой задачи'
            });
        }
        
        // Обновляем статус
        await db.run(
            `UPDATE tasks SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [taskId]
        );
        
        // Добавляем в историю
        await db.run(
            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
             VALUES (?, ?, ?, ?)`,
            [taskId, 'cancelled', req.user.id, reason || `Задача отменена ${req.user.role === 'client' ? 'клиентом' : 'менеджером'}`]
        );
        
        // Уведомляем всех участников
        const participants = [task.client_id];
        if (task.performer_id) participants.push(task.performer_id);
        
        for (const participantId of participants) {
            if (participantId !== req.user.id) {
                await db.run(
                    `INSERT INTO notifications (user_id, title, message, type, data) 
                     VALUES (?, ?, ?, ?, ?)`,
                    [
                        participantId,
                        'Задача отменена',
                        `Задача "${task.title}" была отменена. ${reason ? `Причина: ${reason}` : ''}`,
                        'warning',
                        JSON.stringify({ task_id: task.id })
                    ]
                );
            }
        }
        
        res.json({
            success: true,
            message: 'Задача успешно отменена',
            data: {
                task_id: taskId,
                cancelled_by: req.user.id,
                reason: reason || 'Не указана',
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Ошибка отмены задачи:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка отмены задачи'
        });
    }
});

// Оценка выполненной задачи
app.post('/api/tasks/:id/rate', authMiddleware(['client']), async (req, res) => {
    try {
        const taskId = parseInt(req.params.id);
        const { rating, comment, is_anonymous = false } = req.body;
        
        if (isNaN(taskId)) {
            return res.status(400).json({
                success: false,
                error: 'Неверный ID задачи'
            });
        }
        
        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({
                success: false,
                error: 'Рейтинг должен быть от 1 до 5'
            });
        }
        
        const task = await db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        // Проверяем права
        if (req.user.id !== task.client_id) {
            return res.status(403).json({
                success: false,
                error: 'Только клиент может оценивать задачу'
            });
        }
        
        if (task.status !== 'completed') {
            return res.status(400).json({
                success: false,
                error: 'Можно оценить только завершенные задачи'
            });
        }
        
        // Проверяем, не оценивалась ли уже задача
        const existingReview = await db.get('SELECT id FROM reviews WHERE task_id = ?', [taskId]);
        if (existingReview) {
            return res.status(400).json({
                success: false,
                error: 'Эта задача уже была оценена'
            });
        }
        
        // Создаем отзыв
        await db.run(
            `INSERT INTO reviews (task_id, client_id, performer_id, rating, comment, is_anonymous) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [taskId, req.user.id, task.performer_id, rating, comment || null, is_anonymous ? 1 : 0]
        );
        
        // Обновляем рейтинг в задаче
        await db.run(
            'UPDATE tasks SET rating = ?, feedback = ? WHERE id = ?',
            [rating, comment || null, taskId]
        );
        
        // Уведомляем исполнителя
        if (task.performer_id) {
            await db.run(
                `INSERT INTO notifications (user_id, title, message, type, data) 
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    task.performer_id,
                    'Новый отзыв о вашей работе',
                    `Клиент оценил вашу работу по задаче "${task.title}" на ${rating}/5${comment ? ` с комментарием: ${comment}` : ''}`,
                    'success',
                    JSON.stringify({ task_id: task.id, rating })
                ]
            );
        }
        
        res.json({
            success: true,
            message: 'Спасибо за вашу оценку!',
            data: {
                task_id: taskId,
                rating,
                comment: comment || null,
                is_anonymous,
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Ошибка оценки задачи:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка оценки задачи'
        });
    }
});

// ==================== ЧАТ ЗАДАЧИ ====================

// Получение сообщений чата
app.get('/api/tasks/:id/messages', authMiddleware(), async (req, res) => {
    try {
        const taskId = parseInt(req.params.id);
        
        if (isNaN(taskId)) {
            return res.status(400).json({
                success: false,
                error: 'Неверный ID задачи'
            });
        }
        
        // Проверяем доступ к задаче
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
                error: 'Нет доступа к чату этой задачи'
            });
        }
        
        // Проверяем можно ли общаться в чате
        if (task.status === 'cancelled') {
            return res.status(400).json({
                success: false,
                error: 'Нельзя общаться в отмененных задачах'
            });
        }
        
        const messages = await db.all(
            `SELECT tm.*, u.firstName, u.lastName, u.avatar_url, u.role
             FROM task_messages tm
             LEFT JOIN users u ON tm.user_id = u.id
             WHERE tm.task_id = ?
             ORDER BY tm.created_at ASC`,
            [taskId]
        );
        
        // Помечаем сообщения как прочитанные для текущего пользователя
        if (messages.length > 0) {
            await db.run(
                `UPDATE task_messages 
                 SET is_read = 1 
                 WHERE task_id = ? 
                 AND user_id != ? 
                 AND is_read = 0`,
                [taskId, req.user.id]
            );
        }
        
        res.json({
            success: true,
            data: { 
                messages,
                can_send: task.status !== 'completed' && task.status !== 'cancelled'
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения сообщений:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения сообщений'
        });
    }
});

// Отправка сообщения в чат
app.post('/api/tasks/:id/messages', authMiddleware(), async (req, res) => {
    try {
        const taskId = parseInt(req.params.id);
        const { message } = req.body;
        
        if (isNaN(taskId)) {
            return res.status(400).json({
                success: false,
                error: 'Неверный ID задачи'
            });
        }
        
        if (!message || message.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Сообщение не может быть пустым'
            });
        }
        
        // Проверяем доступ к задаче
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
                error: 'Нет доступа к чату этой задачи'
            });
        }
        
        // Проверяем можно ли отправлять сообщения
        if (task.status === 'cancelled' || task.status === 'completed') {
            return res.status(400).json({
                success: false,
                error: 'Нельзя отправлять сообщения в завершенные или отмененные задачи'
            });
        }
        
        // Отправляем сообщение
        const result = await db.run(
            `INSERT INTO task_messages (task_id, user_id, message) 
             VALUES (?, ?, ?)`,
            [taskId, req.user.id, message.trim()]
        );
        
        const newMessage = await db.get(
            `SELECT tm.*, u.firstName, u.lastName, u.avatar_url, u.role
             FROM task_messages tm
             LEFT JOIN users u ON tm.user_id = u.id
             WHERE tm.id = ?`,
            [result.lastID]
        );
        
        // Определяем кому отправлять уведомление
        const notifyUserIds = [];
        
        if (req.user.id === task.client_id) {
            if (task.performer_id) notifyUserIds.push(task.performer_id);
            // Уведомляем менеджеров
            const managers = await db.all(
                'SELECT id FROM users WHERE role IN ("admin", "manager", "superadmin") AND id != ?',
                [req.user.id]
            );
            managers.forEach(m => notifyUserIds.push(m.id));
        } else if (req.user.id === task.performer_id) {
            notifyUserIds.push(task.client_id);
        } else if (['admin', 'manager', 'superadmin'].includes(req.user.role)) {
            if (task.client_id !== req.user.id) notifyUserIds.push(task.client_id);
            if (task.performer_id && task.performer_id !== req.user.id) notifyUserIds.push(task.performer_id);
        }
        
        // Отправляем уведомления
        for (const userId of notifyUserIds) {
            await db.run(
                `INSERT INTO notifications (user_id, title, message, type, data) 
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    userId,
                    'Новое сообщение в задаче',
                    `Новое сообщение в задаче "${task.title}".`,
                    'info',
                    JSON.stringify({ task_id: task.id, message_id: newMessage.id })
                ]
            );
        }
        
        res.status(201).json({
            success: true,
            message: 'Сообщение отправлено',
            data: { 
                message: newMessage,
                notified_users: notifyUserIds.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка отправки сообщения:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка отправки сообщения'
        });
    }
});

// ==================== АДМИН ПАНЕЛЬ ====================

// Дашборд администратора
app.get('/api/admin/dashboard', authMiddleware(['admin', 'manager', 'superadmin']), async (req, res) => {
    try {
        const today = new Date();
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        
        // Основная статистика
        const [users, activeUsers, tasks, completedTasks, revenue] = await Promise.all([
            db.get('SELECT COUNT(*) as count FROM users'),
            db.get('SELECT COUNT(*) as count FROM users WHERE is_active = 1 AND subscription_status = "active"'),
            db.get('SELECT COUNT(*) as count FROM tasks'),
            db.get('SELECT COUNT(*) as count FROM tasks WHERE status = "completed"'),
            db.get('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = "completed"')
        ]);
        
        // Статистика за месяц
        const [monthlyUsers, monthlyTasks, monthlyRevenue] = await Promise.all([
            db.get('SELECT COUNT(*) as count FROM users WHERE created_at >= ?', [monthStart.toISOString()]),
            db.get('SELECT COUNT(*) as count FROM tasks WHERE created_at >= ?', [monthStart.toISOString()]),
            db.get('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = "completed" AND created_at >= ?', [monthStart.toISOString()])
        ]);
        
        // Распределение по категориям
        const categoriesStats = await db.all(`
            SELECT c.id, c.display_name, c.icon, 
                   COUNT(t.id) as task_count,
                   SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed_count,
                   AVG(t.rating) as avg_rating
            FROM categories c
            LEFT JOIN tasks t ON c.id = t.category_id
            WHERE c.is_active = 1
            GROUP BY c.id
            ORDER BY task_count DESC
        `);
        
        // Последние задачи
        const recentTasks = await db.all(`
            SELECT t.*, c.display_name as category_name,
                   u1.firstName as client_firstName, u1.lastName as client_lastName,
                   u2.firstName as performer_firstName, u2.lastName as performer_lastName
            FROM tasks t
            LEFT JOIN categories c ON t.category_id = c.id
            LEFT JOIN users u1 ON t.client_id = u1.id
            LEFT JOIN users u2 ON t.performer_id = u2.id
            ORDER BY t.created_at DESC
            LIMIT 10
        `);
        
        // Последние пользователи
        const recentUsers = await db.all(`
            SELECT id, email, firstName, lastName, role, subscription_plan, created_at
            FROM users
            ORDER BY created_at DESC
            LIMIT 10
        `);
        
        // Статистика подписок
        const subscriptionStats = await db.all(`
            SELECT subscription_plan, COUNT(*) as user_count
            FROM users
            WHERE subscription_status = 'active'
            GROUP BY subscription_plan
            ORDER BY user_count DESC
        `);
        
        res.json({
            success: true,
            data: {
                summary: {
                    total_users: users.count,
                    active_users: activeUsers.count,
                    total_tasks: tasks.count,
                    completed_tasks: completedTasks.count,
                    total_revenue: revenue.total,
                    monthly_new_users: monthlyUsers.count,
                    monthly_new_tasks: monthlyTasks.count,
                    monthly_revenue: monthlyRevenue.total
                },
                categories: categoriesStats,
                recent_tasks: recentTasks,
                recent_users: recentUsers,
                subscriptions: subscriptionStats,
                time_period: {
                    month_start: monthStart.toISOString(),
                    month_end: monthEnd.toISOString()
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения дашборда:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения дашборда'
        });
    }
});

// Управление пользователями
app.get('/api/admin/users', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const { role, subscription, search, limit = 50, offset = 0 } = req.query;
        
        let query = `
            SELECT id, email, firstName, lastName, phone, role, 
                   subscription_plan, subscription_status, subscription_expires,
                   initial_fee_paid, initial_fee_amount,
                   telegram_username, balance, is_active, created_at, updated_at
            FROM users
            WHERE 1=1
        `;
        
        const params = [];
        
        if (role && role !== 'all') {
            query += ' AND role = ?';
            params.push(role);
        }
        
        if (subscription && subscription !== 'all') {
            query += ' AND subscription_plan = ?';
            params.push(subscription);
        }
        
        if (search) {
            query += ' AND (email LIKE ? OR firstName LIKE ? OR lastName LIKE ? OR phone LIKE ?)';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }
        
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const users = await db.all(query, params);
        
        // Получаем общее количество
        let countQuery = 'SELECT COUNT(*) as total FROM users WHERE 1=1';
        const countParams = [];
        
        if (role && role !== 'all') {
            countQuery += ' AND role = ?';
            countParams.push(role);
        }
        
        if (subscription && subscription !== 'all') {
            countQuery += ' AND subscription_plan = ?';
            countParams.push(subscription);
        }
        
        if (search) {
            countQuery += ' AND (email LIKE ? OR firstName LIKE ? OR lastName LIKE ? OR phone LIKE ?)';
            const searchTerm = `%${search}%`;
            countParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }
        
        const countResult = await db.get(countQuery, countParams);
        const total = countResult.total;
        
        res.json({
            success: true,
            data: {
                users,
                pagination: {
                    total,
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    has_more: (parseInt(offset) + parseInt(limit)) < total
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения пользователей:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения пользователей'
        });
    }
});

// Управление задачами (админ)
app.get('/api/admin/tasks', authMiddleware(['admin', 'manager', 'superadmin']), async (req, res) => {
    try {
        const { status, category_id, date_from, date_to, limit = 50, offset = 0 } = req.query;
        
        let query = `
            SELECT t.*, 
                   c.display_name as category_name,
                   c.icon as category_icon,
                   u1.firstName as client_firstName, 
                   u1.lastName as client_lastName,
                   u1.phone as client_phone,
                   u2.firstName as performer_firstName,
                   u2.lastName as performer_lastName,
                   u2.phone as performer_phone
            FROM tasks t
            LEFT JOIN categories c ON t.category_id = c.id
            LEFT JOIN users u1 ON t.client_id = u1.id
            LEFT JOIN users u2 ON t.performer_id = u2.id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (status && status !== 'all') {
            query += ' AND t.status = ?';
            params.push(status);
        }
        
        if (category_id && category_id !== 'all') {
            query += ' AND t.category_id = ?';
            params.push(category_id);
        }
        
        if (date_from) {
            query += ' AND DATE(t.created_at) >= ?';
            params.push(date_from);
        }
        
        if (date_to) {
            query += ' AND DATE(t.created_at) <= ?';
            params.push(date_to);
        }
        
        query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const tasks = await db.all(query, params);
        
        res.json({
            success: true,
            data: {
                tasks,
                pagination: {
                    limit: parseInt(limit),
                    offset: parseInt(offset)
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения задач:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения задач'
        });
    }
});

// Управление категориями (линиями)
app.get('/api/admin/categories', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const categories = await db.all(`
            SELECT c.*, 
                   COUNT(ts.id) as top_services_count,
                   COUNT(lc.id) as cheatsheets_count,
                   COUNT(th.id) as hints_count
            FROM categories c
            LEFT JOIN top_services ts ON c.id = ts.category_id AND ts.is_active = 1
            LEFT JOIN line_cheatsheets lc ON c.id = lc.category_id
            LEFT JOIN task_hints th ON c.id = th.category_id
            GROUP BY c.id
            ORDER BY c.sort_order ASC
        `);
        
        // Получаем все подписки для привязки
        const subscriptions = await db.all(
            'SELECT id, name, display_name FROM subscriptions WHERE is_active = 1 ORDER BY sort_order ASC'
        );
        
        res.json({
            success: true,
            data: {
                categories,
                subscriptions,
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

// Создание/обновление категории
app.post('/api/admin/categories', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const { id, name, display_name, description, icon, color, sort_order, is_active, subscription_ids } = req.body;
        
        if (!name || !display_name || !description || !icon) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля: name, display_name, description, icon'
            });
        }
        
        if (id) {
            // Обновление существующей категории
            await db.run(
                `UPDATE categories SET 
                    name = ?, display_name = ?, description = ?, icon = ?, 
                    color = ?, sort_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP 
                 WHERE id = ?`,
                [name, display_name, description, icon, color || '#FF6B8B', sort_order || 0, is_active ? 1 : 0, id]
            );
        } else {
            // Создание новой категории
            await db.run(
                `INSERT INTO categories 
                (name, display_name, description, icon, color, sort_order, is_active) 
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [name, display_name, description, icon, color || '#FF6B8B', sort_order || 0, is_active ? 1 : 1]
            );
        }
        
        res.json({
            success: true,
            message: id ? 'Категория обновлена' : 'Категория создана',
            data: { id: id || null }
        });
        
    } catch (error) {
        console.error('Ошибка сохранения категории:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сохранения категории'
        });
    }
});

// Управление топ услугами
app.get('/api/admin/top-services', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const { category_id } = req.query;
        
        let query = `
            SELECT ts.*, c.display_name as category_name 
            FROM top_services ts 
            LEFT JOIN categories c ON ts.category_id = c.id 
            WHERE 1=1
        `;
        const params = [];
        
        if (category_id) {
            query += ' AND ts.category_id = ?';
            params.push(category_id);
        }
        
        query += ' ORDER BY ts.category_id ASC, ts.sort_order ASC';
        
        const services = await db.all(query, params);
        
        res.json({
            success: true,
            data: {
                services,
                count: services.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения топ услуг:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения топ услуг'
        });
    }
});

// Создание/обновление топ услуги
app.post('/api/admin/top-services', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const { id, category_id, name, description, sort_order, is_active } = req.body;
        
        if (!category_id || !name || !description) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля: category_id, name, description'
            });
        }
        
        if (id) {
            // Обновление существующей услуги
            await db.run(
                `UPDATE top_services SET 
                    category_id = ?, name = ?, description = ?, 
                    sort_order = ?, is_active = ? 
                 WHERE id = ?`,
                [category_id, name, description, sort_order || 0, is_active ? 1 : 0, id]
            );
        } else {
            // Создание новой услуги
            await db.run(
                `INSERT INTO top_services 
                (category_id, name, description, sort_order, is_active) 
                VALUES (?, ?, ?, ?, ?)`,
                [category_id, name, description, sort_order || 0, is_active ? 1 : 1]
            );
        }
        
        res.json({
            success: true,
            message: id ? 'Услуга обновлена' : 'Услуга создана',
            data: { id: id || null }
        });
        
    } catch (error) {
        console.error('Ошибка сохранения топ услуги:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сохранения топ услуги'
        });
    }
});

// Управление шпаргалками
app.get('/api/admin/cheatsheets', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const { category_id } = req.query;
        
        let query = `
            SELECT lc.*, c.display_name as category_name 
            FROM line_cheatsheets lc 
            LEFT JOIN categories c ON lc.category_id = c.id 
            WHERE 1=1
        `;
        const params = [];
        
        if (category_id) {
            query += ' AND lc.category_id = ?';
            params.push(category_id);
        }
        
        query += ' ORDER BY lc.category_id ASC, lc.sort_order ASC';
        
        const cheatsheets = await db.all(query, params);
        
        res.json({
            success: true,
            data: {
                cheatsheets,
                count: cheatsheets.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения шпаргалок:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения шпаргалок'
        });
    }
});

// Создание/обновление шпаргалки
app.post('/api/admin/cheatsheets', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const { id, category_id, title, content, sort_order } = req.body;
        
        if (!category_id || !title || !content) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля: category_id, title, content'
            });
        }
        
        if (id) {
            // Обновление существующей шпаргалки
            await db.run(
                `UPDATE line_cheatsheets SET 
                    category_id = ?, title = ?, content = ?, sort_order = ? 
                 WHERE id = ?`,
                [category_id, title, content, sort_order || 0, id]
            );
        } else {
            // Создание новой шпаргалки
            await db.run(
                `INSERT INTO line_cheatsheets 
                (category_id, title, content, sort_order) 
                VALUES (?, ?, ?, ?)`,
                [category_id, title, content, sort_order || 0]
            );
        }
        
        res.json({
            success: true,
            message: id ? 'Шпаргалка обновлена' : 'Шпаргалка создана',
            data: { id: id || null }
        });
        
    } catch (error) {
        console.error('Ошибка сохранения шпаргалки:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сохранения шпаргалки'
        });
    }
});

// Управление подсказками
app.get('/api/admin/hints', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const { category_id } = req.query;
        
        let query = `
            SELECT th.*, c.display_name as category_name 
            FROM task_hints th 
            LEFT JOIN categories c ON th.category_id = c.id 
            WHERE 1=1
        `;
        const params = [];
        
        if (category_id) {
            query += ' AND th.category_id = ?';
            params.push(category_id);
        }
        
        query += ' ORDER BY th.category_id ASC, th.step_number ASC, th.sort_order ASC';
        
        const hints = await db.all(query, params);
        
        res.json({
            success: true,
            data: {
                hints,
                count: hints.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения подсказок:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения подсказок'
        });
    }
});

// Создание/обновление подсказки
app.post('/api/admin/hints', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const { id, category_id, title, content, step_number, sort_order } = req.body;
        
        if (!category_id || !title || !content || !step_number) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля: category_id, title, content, step_number'
            });
        }
        
        if (id) {
            // Обновление существующей подсказки
            await db.run(
                `UPDATE task_hints SET 
                    category_id = ?, title = ?, content = ?, 
                    step_number = ?, sort_order = ? 
                 WHERE id = ?`,
                [category_id, title, content, step_number, sort_order || 0, id]
            );
        } else {
            // Создание новой подсказки
            await db.run(
                `INSERT INTO task_hints 
                (category_id, title, content, step_number, sort_order) 
                VALUES (?, ?, ?, ?, ?)`,
                [category_id, title, content, step_number, sort_order || 0]
            );
        }
        
        res.json({
            success: true,
            message: id ? 'Подсказка обновлена' : 'Подсказка создана',
            data: { id: id || null }
        });
        
    } catch (error) {
        console.error('Ошибка сохранения подсказки:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сохранения подсказки'
        });
    }
});

// Настройки системы
app.get('/api/admin/settings', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const settings = await db.all('SELECT * FROM system_settings ORDER BY key ASC');
        
        // Преобразуем в объект для удобства
        const settingsObj = {};
        settings.forEach(setting => {
            settingsObj[setting.key] = setting.value;
        });
        
        res.json({
            success: true,
            data: {
                settings: settingsObj,
                raw_settings: settings
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения настроек:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения настроек'
        });
    }
});

// Обновление настроек системы
app.post('/api/admin/settings', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const { settings } = req.body;
        
        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({
                success: false,
                error: 'Неверный формат настроек'
            });
        }
        
        // Обновляем каждую настройку
        for (const [key, value] of Object.entries(settings)) {
            await db.run(
                `INSERT OR REPLACE INTO system_settings (key, value, updated_at) 
                 VALUES (?, ?, CURRENT_TIMESTAMP)`,
                [key, value]
            );
        }
        
        res.json({
            success: true,
            message: 'Настройки успешно обновлены',
            data: { updated_count: Object.keys(settings).length }
        });
        
    } catch (error) {
        console.error('Ошибка обновления настроек:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления настроек'
        });
    }
});

// Управление подписками (админ)
app.get('/api/admin/subscriptions', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const subscriptions = await db.all(
            'SELECT * FROM subscriptions ORDER BY sort_order ASC'
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
        console.error('Ошибка получения подписок:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения подписок'
        });
    }
});

// Создание/обновление подписки
app.post('/api/admin/subscriptions', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const { 
            id, name, display_name, description, price_monthly, price_yearly, 
            initial_fee, tasks_limit, features, color_theme, sort_order, is_active 
        } = req.body;
        
        if (!name || !display_name || !description || price_monthly === undefined || tasks_limit === undefined) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля'
            });
        }
        
        const featuresStr = typeof features === 'string' ? features : JSON.stringify(features || []);
        
        if (id) {
            // Обновление существующей подписки
            await db.run(
                `UPDATE subscriptions SET 
                    name = ?, display_name = ?, description = ?, 
                    price_monthly = ?, price_yearly = ?, initial_fee = ?,
                    tasks_limit = ?, features = ?, color_theme = ?,
                    sort_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [
                    name, display_name, description, 
                    price_monthly, price_yearly || price_monthly * 12, initial_fee || 0,
                    tasks_limit, featuresStr, color_theme || '#FF6B8B',
                    sort_order || 0, is_active ? 1 : 0, id
                ]
            );
        } else {
            // Создание новой подписки
            await db.run(
                `INSERT INTO subscriptions 
                (name, display_name, description, price_monthly, price_yearly, 
                 initial_fee, tasks_limit, features, color_theme, sort_order, is_active) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    name, display_name, description, 
                    price_monthly, price_yearly || price_monthly * 12, initial_fee || 0,
                    tasks_limit, featuresStr, color_theme || '#FF6B8B',
                    sort_order || 0, is_active ? 1 : 1
                ]
            );
        }
        
        res.json({
            success: true,
            message: id ? 'Подписка обновлена' : 'Подписка создана',
            data: { id: id || null }
        });
        
    } catch (error) {
        console.error('Ошибка сохранения подписки:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сохранения подписки'
        });
    }
});

// Создание пользователя (админ)
app.post('/api/admin/users', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const { 
            email, password, firstName, lastName, phone, role, 
            subscription_plan, initial_fee_paid, is_active 
        } = req.body;
        
        if (!email || !firstName || !lastName || !phone || !role) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля: email, firstName, lastName, phone, role'
            });
        }
        
        // Проверяем существующего пользователя
        const existingUser = await db.get('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUser) {
            return res.status(409).json({
                success: false,
                error: 'Пользователь с таким email уже существует'
            });
        }
        
        // Хешируем пароль если предоставлен, иначе генерируем случайный
        let hashedPassword;
        if (password) {
            hashedPassword = await bcrypt.hash(password, 12);
        } else {
            // Генерируем случайный пароль
            const randomPassword = Math.random().toString(36).slice(-8);
            hashedPassword = await bcrypt.hash(randomPassword, 12);
        }
        
        // Определяем подписку
        const userSubscription = subscription_plan || 'free';
        const subscription = await db.get(
            'SELECT * FROM subscriptions WHERE name = ?',
            [userSubscription]
        );
        
        const expiryDate = new Date();
        expiryDate.setFullYear(expiryDate.getFullYear() + 1);
        
        const result = await db.run(
            `INSERT INTO users 
            (email, password, firstName, lastName, phone, role, 
             subscription_plan, subscription_status, subscription_expires,
             initial_fee_paid, initial_fee_amount, avatar_url, is_active) 
            VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
            [
                email,
                hashedPassword,
                firstName,
                lastName,
                phone,
                role,
                userSubscription,
                expiryDate.toISOString().split('T')[0],
                initial_fee_paid ? 1 : 0,
                subscription?.initial_fee || 0,
                `https://ui-avatars.com/api/?name=${encodeURIComponent(firstName)}+${encodeURIComponent(lastName)}&background=FF6B8B&color=fff&bold=true`,
                is_active ? 1 : 1
            ]
        );
        
        // Создаем токен для нового пользователя
        const token = jwt.sign(
            { 
                id: result.lastID, 
                email: email, 
                role: role,
                firstName: firstName,
                lastName: lastName,
                subscription_plan: userSubscription,
                initial_fee_paid: initial_fee_paid ? 1 : 0
            },
            process.env.JWT_SECRET || 'concierge-secret-key-2024-prod',
            { expiresIn: '30d' }
        );
        
        res.status(201).json({
            success: true,
            message: 'Пользователь успешно создан',
            data: { 
                user_id: result.lastID,
                token: password ? null : token, // Отправляем токен только если пароль не был задан
                generated_password: password ? null : Math.random().toString(36).slice(-8)
            }
        });
        
    } catch (error) {
        console.error('Ошибка создания пользователя:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания пользователя'
        });
    }
});

// ==================== СИСТЕМА ====================

app.get('/api/system/info', async (req, res) => {
    try {
        const [categoriesCount, tasksCount, usersCount, subscriptionsCount] = await Promise.all([
            db.get('SELECT COUNT(*) as count FROM categories WHERE is_active = 1'),
            db.get('SELECT COUNT(*) as count FROM tasks'),
            db.get('SELECT COUNT(*) as count FROM users'),
            db.get('SELECT COUNT(*) as count FROM subscriptions WHERE is_active = 1')
        ]);
        
        // Получаем информацию о подписках
        const subscriptions = await db.all(
            `SELECT s.name, s.display_name, COUNT(u.id) as user_count 
             FROM subscriptions s 
             LEFT JOIN users u ON s.name = u.subscription_plan 
             WHERE s.is_active = 1 
             GROUP BY s.name 
             ORDER BY s.sort_order`
        );
        
        res.json({
            success: true,
            data: {
                categories: categoriesCount.count,
                tasks: tasksCount.count,
                users: usersCount.count,
                subscriptions: subscriptionsCount.count,
                subscription_distribution: subscriptions,
                version: '5.0.0',
                nodeVersion: process.version,
                platform: process.platform,
                environment: process.env.NODE_ENV || 'development',
                telegram_bot: telegramBot ? 'active' : 'inactive',
                memory: {
                    rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`,
                    heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)} MB`,
                    heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`
                },
                uptime: `${Math.floor(process.uptime() / 60)} минут`,
                server_time: new Date().toISOString(),
                server_time_local: new Date().toLocaleString('ru-RU')
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения информации о системе:', error);
        res.json({
            success: false,
            data: {
                version: '5.0.0',
                status: 'running',
                error: error.message,
                server_time: new Date().toISOString()
            }
        });
    }
});

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

// ==================== СТАТИЧЕСКИЕ ФАЙЛЫ И АДМИН ПАНЕЛЬ ====================

// Админ панель
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Главное приложение
app.get('/app', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Обработка 404
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Маршрут не найден',
        path: req.path,
        method: req.method
    });
});

// Глобальный обработчик ошибок
app.use((err, req, res, next) => {
    console.error('❌ Необработанная ошибка:', err);
    
    res.status(500).json({
        success: false,
        error: 'Внутренняя ошибка сервера',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎀 ЗАПУСК КОНСЬЕРЖ СЕРВИСА v5.0.0');
        console.log('='.repeat(80));
        console.log(`🌐 PORT: ${process.env.PORT || 3000}`);
        console.log(`🏷️  NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🔐 JWT_SECRET: ${process.env.JWT_SECRET ? 'configured' : 'using default'}`);
        console.log(`🤖 TELEGRAM_BOT: ${process.env.TELEGRAM_BOT_TOKEN ? 'configured' : 'not configured'}`);
        
        // Инициализируем базу данных
        await initDatabase();
        console.log('✅ База данных готова');
        
        const PORT = process.env.PORT || 3000;
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log('\n' + '='.repeat(80));
            console.log(`✅ Сервер запущен на порту ${PORT}`);
            console.log(`🌐 http://localhost:${PORT}`);
            console.log(`🌐 http://localhost:${PORT}/app - Главное приложение`);
            console.log(`🎛️  Админ-панель: http://localhost:${PORT}/admin`);
            console.log(`🏥 Health check: http://localhost:${PORT}/health`);
            console.log('='.repeat(80));
            console.log('🎀 СИСТЕМА ГОТОВА К РАБОТЕ!');
            console.log('='.repeat(80));
            
            console.log('\n🔑 ТЕСТОВЫЕ АККАУНТЫ:');
            console.log('👑 Суперадмин: superadmin@concierge.ru / admin123');
            console.log('👨‍💼 Админ: admin@concierge.ru / admin123');
            console.log('👨‍💼 Менеджер: manager@concierge.ru / manager123');
            console.log('👨‍🏫 Исполнитель: performer@concierge.ru / performer123');
            console.log('👩 Клиент Premium: client1@example.com / client123');
            console.log('👨 Клиент Basic: client2@example.com / client123');
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
};

// Обработка завершения работы
process.on('SIGINT', async () => {
    console.log('\n🛑 Остановка сервера...');
    
    if (telegramBot) {
        try {
            telegramBot.stopPolling();
            console.log('🤖 Telegram Bot остановлен');
        } catch (e) {
            console.log('⚠️ Ошибка остановки бота:', e.message);
        }
    }
    
    if (db) {
        try {
            await db.close();
            console.log('🗃️ База данных закрыта');
        } catch (e) {
            console.log('⚠️ Ошибка закрытия базы данных:', e.message);
        }
    }
    
    console.log('👋 Сервер остановлен');
    process.exit(0);
});

// Обработка необработанных ошибок
process.on('uncaughtException', (error) => {
    console.error('⚠️ Необработанная ошибка:', error.message);
    console.error(error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Необработанный промис:', reason);
});

// Запуск
startServer();
