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

        // Создание всех таблиц
        await db.exec(`
            -- Пользователи
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                firstName TEXT NOT NULL,
                lastName TEXT NOT NULL,
                phone TEXT,
                role TEXT DEFAULT 'client',
                subscription_plan TEXT DEFAULT 'free',
                subscription_status TEXT DEFAULT 'active',
                subscription_expires DATE,
                telegram_id TEXT,
                telegram_username TEXT,
                avatar_url TEXT,
                balance REAL DEFAULT 0,
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
                tasks_limit INTEGER NOT NULL,
                features TEXT NOT NULL,
                is_popular INTEGER DEFAULT 0,
                color_theme TEXT DEFAULT '#FF6B8B',
                sort_order INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Услуги/Категории
            CREATE TABLE IF NOT EXISTS services (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                category TEXT NOT NULL,
                icon TEXT,
                base_price REAL DEFAULT 0,
                estimated_time TEXT,
                is_active INTEGER DEFAULT 1,
                is_popular INTEGER DEFAULT 0,
                sort_order INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Задачи
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_number TEXT UNIQUE,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                client_id INTEGER NOT NULL,
                performer_id INTEGER,
                category TEXT NOT NULL,
                status TEXT DEFAULT 'new',
                priority TEXT DEFAULT 'medium',
                price REAL DEFAULT 0,
                address TEXT,
                location_lat REAL,
                location_lng REAL,
                deadline DATE,
                completed_at TIMESTAMP,
                rating INTEGER,
                feedback TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (client_id) REFERENCES users(id),
                FOREIGN KEY (performer_id) REFERENCES users(id)
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

            -- Индексы для производительности
            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
            CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
            CREATE INDEX IF NOT EXISTS idx_users_subscription ON users(subscription_plan, subscription_status);
            CREATE INDEX IF NOT EXISTS idx_tasks_client ON tasks(client_id);
            CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
            CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);
            CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
            CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
            CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
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
                    subscription_plan TEXT DEFAULT 'free',
                    subscription_status TEXT DEFAULT 'active'
                );
                
                CREATE TABLE subscriptions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL,
                    display_name TEXT NOT NULL,
                    price_monthly REAL NOT NULL,
                    tasks_limit INTEGER NOT NULL
                );
                
                CREATE TABLE tasks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    description TEXT,
                    client_id INTEGER,
                    category TEXT,
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
        
        // 1. Подписки
        const subscriptionCount = await db.get('SELECT COUNT(*) as count FROM subscriptions');
        if (!subscriptionCount || subscriptionCount.count === 0) {
            console.log('📝 Создаем подписки...');
            
            const subscriptions = [
                ['free', 'Бесплатная', 'Для знакомства с сервисом. 1 задача в месяц.', 0, 0, 1, 
                 '["До 1 задачи в месяц", "Базовые категории", "Поддержка по email", "Доступ к мобильному приложению"]', 0, '#95A5A6', 1],
                
                ['basic', 'Базовая', 'Для регулярных бытовых задач. 3 задачи в месяц.', 990, 9900, 3,
                 '["До 3 задач в месяц", "Все категории услуг", "Приоритет 48 часов", "Поддержка 24/7 в чате", "Push-уведомления"]', 1, '#3498DB', 2],
                
                ['premium', 'Премиум', 'Для максимального комфорта. 10 задач в месяц.', 2990, 29900, 10,
                 '["До 10 задач в месяц", "Все категории услуг", "Приоритет 24 часа", "Личный куратор", "Расширенная статистика", "Бесплатная отмена"]', 0, '#9B59B6', 3],
                
                ['business', 'Бизнес', 'Для бизнеса и семьи. Неограниченные задачи.', 9990, 99900, 9999,
                 '["Неограниченные задачи", "Все категории услуг", "Приоритет 12 часов", "Личный менеджер", "Расширенная статистика", "API доступ", "Бесплатная отмена", "Приоритетная поддержка"]', 0, '#E74C3C', 4]
            ];

            for (const sub of subscriptions) {
                await db.run(
                    `INSERT OR IGNORE INTO subscriptions 
                    (name, display_name, description, price_monthly, price_yearly, tasks_limit, features, is_popular, color_theme, sort_order) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    sub
                );
            }
            console.log('✅ Подписки созданы');
        }

        // 2. Тестовые пользователи с разными ролями и подписками
        const usersCount = await db.get('SELECT COUNT(*) as count FROM users WHERE email LIKE ?', ['%@example.com']);
        if (!usersCount || usersCount.count === 0) {
            console.log('📝 Создаем тестовых пользователей...');
            
            const users = [
                {
                    email: 'admin@concierge.ru',
                    password: 'admin123',
                    firstName: 'Администратор',
                    lastName: 'Системы',
                    phone: '+79991112233',
                    role: 'superadmin',
                    subscription: 'business',
                    telegram: '@concierge_admin'
                },
                {
                    email: 'manager@concierge.ru',
                    password: 'manager123',
                    firstName: 'Менеджер',
                    lastName: 'Поддержки',
                    phone: '+79992223344',
                    role: 'admin',
                    subscription: 'premium',
                    telegram: '@concierge_manager'
                },
                {
                    email: 'client1@example.com',
                    password: 'client123',
                    firstName: 'Мария',
                    lastName: 'Иванова',
                    phone: '+79993334455',
                    role: 'client',
                    subscription: 'premium',
                    telegram: '@maria_ivanova'
                },
                {
                    email: 'client2@example.com',
                    password: 'client123',
                    firstName: 'Алексей',
                    lastName: 'Петров',
                    phone: '+79994445566',
                    role: 'client',
                    subscription: 'basic',
                    telegram: '@alexey_petrov'
                },
                {
                    email: 'performer1@example.com',
                    password: 'performer123',
                    firstName: 'Елена',
                    lastName: 'Сидорова',
                    phone: '+79995556677',
                    role: 'performer',
                    subscription: 'premium',
                    telegram: '@elena_sidorova'
                },
                {
                    email: 'performer2@example.com',
                    password: 'performer123',
                    firstName: 'Дмитрий',
                    lastName: 'Кузнецов',
                    phone: '+79996667788',
                    role: 'performer',
                    subscription: 'basic',
                    telegram: '@dmitry_kuznetsov'
                }
            ];

            for (const user of users) {
                const hashedPassword = await bcrypt.hash(user.password, 10);
                const expiryDate = new Date();
                expiryDate.setFullYear(expiryDate.getFullYear() + 1);
                
                await db.run(
                    `INSERT OR IGNORE INTO users 
                    (email, password, firstName, lastName, phone, role, subscription_plan, subscription_status, subscription_expires, telegram_username, avatar_url, balance, is_active) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 1)`,
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
                        user.role === 'client' ? 5000 : 0
                    ]
                );
            }
            console.log('✅ Тестовые пользователи созданы');
        }

        // 3. Услуги
        const servicesCount = await db.get('SELECT COUNT(*) as count FROM services');
        if (!servicesCount || servicesCount.count === 0) {
            console.log('📝 Создаем услуги...');
            
// Услуги (оригинальные из кода пользователя)
const services = [
    ['Уборка квартиры', 'Генеральная уборка, помощь в организации пространства', 'home_and_household', '🧹', 2000, '3-4 часа', 1, 1, 1],
    ['Присмотр за детьми', 'Няня на несколько часов, помощь с уроками', 'family_and_children', '👶', 1500, '4-5 часов', 1, 1, 2],
    ['Маникюр на дому', 'Профессиональный маникюр с выездом', 'beauty_and_health', '💅', 1200, '2 часа', 1, 1, 3],
    ['Репетиторство', 'Помощь с уроками, подготовка к экзаменам', 'courses_and_education', '📚', 1000, '1-2 часа', 1, 0, 4],
    ['Выгул собак', 'Прогулка с питомцем, кормление', 'pets', '🐕', 800, '1 час', 1, 0, 5],
    ['Организация праздника', 'Помощь в организации детских и семейных праздников', 'events_and_entertainment', '🎂', 5000, '6-8 часов', 1, 1, 6]
];

for (const service of services) {
    await db.run(
        `INSERT OR IGNORE INTO services 
        (name, description, category, icon, base_price, estimated_time, is_active, is_popular, sort_order) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        service
    );
}
            console.log('✅ Услуги созданы');
        }

        // 4. Тестовые задачи
        const tasksCount = await db.get('SELECT COUNT(*) as count FROM tasks');
        if (!tasksCount || tasksCount.count === 0) {
            console.log('📝 Создаем тестовые задачи...');
            
            const tasks = [
                {
                    task_number: 'TASK-2024-001',
                    title: 'Уборка после ремонта',
                    description: 'Нужно сделать генеральную уборку в 3-х комнатной квартире после ремонта. Особое внимание кухне и санузлу.',
                    client_id: 3, // Мария
                    category: 'home_and_household',
                    status: 'completed',
                    priority: 'high',
                    price: 3500,
                    address: 'Москва, ул. Тверская, д. 25, кв. 48',
                    deadline: '2024-01-15',
                    completed_at: '2024-01-14 18:30:00',
                    rating: 5
                },
                {
                    task_number: 'TASK-2024-002',
                    title: 'Няня на субботу',
                    description: 'Присмотреть за ребенком 6 лет с 10:00 до 18:00. Помочь с обедом, погулять в парке, поиграть в развивающие игры.',
                    client_id: 3,
                    category: 'family_and_children',
                    status: 'in_progress',
                    priority: 'medium',
                    price: 2000,
                    address: 'Москва, ул. Ленина, д. 10, кв. 12',
                    deadline: '2024-01-20',
                    performer_id: 5 // Елена
                },
                {
                    task_number: 'TASK-2024-003',
                    title: 'Маникюр с дизайном',
                    description: 'Сделать классический маникюр с покрытием гель-лаком. Французский дизайн. Ногти средней длины.',
                    client_id: 4, // Алексей (для жены)
                    category: 'beauty_and_health',
                    status: 'new',
                    priority: 'medium',
                    price: 1500,
                    address: 'Москва, пр. Мира, д. 15, кв. 7',
                    deadline: '2024-01-18'
                },
                {
                    task_number: 'TASK-2024-004',
                    title: 'Репетитор по математике',
                    description: 'Помочь с подготовкой к контрольной по алгебре (8 класс). Тема: квадратные уравнения.',
                    client_id: 4,
                    category: 'courses_and_education',
                    status: 'assigned',
                    priority: 'high',
                    price: 1200,
                    address: 'Москва, ул. Гагарина, д. 8, кв. 32',
                    deadline: '2024-01-16',
                    performer_id: 6 // Дмитрий
                }
            ];

            for (const task of tasks) {
                await db.run(
                    `INSERT OR IGNORE INTO tasks 
                    (task_number, title, description, client_id, performer_id, category, status, priority, price, address, deadline, completed_at, rating) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        task.task_number,
                        task.title,
                        task.description,
                        task.client_id,
                        task.performer_id || null,
                        task.category,
                        task.status,
                        task.priority,
                        task.price,
                        task.address,
                        task.deadline,
                        task.completed_at || null,
                        task.rating || null
                    ]
                );
            }
            console.log('✅ Тестовые задачи созданы');
        }

        // 5. Тестовые платежи
        const paymentsCount = await db.get('SELECT COUNT(*) as count FROM payments');
        if (!paymentsCount || paymentsCount.count === 0) {
            console.log('📝 Создаем тестовые платежи...');
            
            const payments = [
                [3, 3, 2990, 'Оплата подписки Премиум на месяц', 'completed', 'card', 'PAY-001', '2024-01-01 10:30:00'],
                [4, 2, 990, 'Оплата подписки Базовая на месяц', 'completed', 'card', 'PAY-002', '2024-01-05 14:20:00'],
                [3, null, 3500, 'Оплата задачи TASK-2024-001', 'completed', 'card', 'PAY-003', '2024-01-14 19:00:00'],
                [4, null, 1200, 'Оплата задачи TASK-2024-004', 'pending', 'card', 'PAY-004', null]
            ];

            for (const payment of payments) {
                await db.run(
                    `INSERT OR IGNORE INTO payments 
                    (user_id, subscription_id, amount, description, status, payment_method, transaction_id, completed_at) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    payment
                );
            }
            console.log('✅ Тестовые платежи созданы');
        }

        // 6. Тестовые уведомления
        const notificationsCount = await db.get('SELECT COUNT(*) as count FROM notifications');
        if (!notificationsCount || notificationsCount.count === 0) {
            console.log('📝 Создаем тестовые уведомления...');
            
            const notifications = [
                [3, 'Задача выполнена!', 'Ваша задача "Уборка после ремонта" успешно выполнена. Оставьте отзыв исполнителю.', 'success'],
                [3, 'Новая задача создана', 'Задача "Няня на субботу" создана. Ожидайте предложений от исполнителей.', 'info'],
                [4, 'Исполнитель назначен', 'К вашей задаче "Репетитор по математике" назначен исполнитель Дмитрий К.', 'info'],
                [5, 'Новое задание', 'Вам назначена задача "Няня на субботу". Проверьте детали в личном кабинете.', 'warning']
            ];

            for (const notification of notifications) {
                await db.run(
                    `INSERT OR IGNORE INTO notifications 
                    (user_id, title, message, type, is_read) 
                    VALUES (?, ?, ?, ?, 0)`,
                    notification
                );
            }
            console.log('✅ Тестовые уведомления созданы');
        }

        console.log('🎉 Все тестовые данные успешно созданы!');
        
        // Выводим информацию для тестирования
        console.log('\n🔑 ТЕСТОВЫЕ АККАУНТЫ:');
        console.log('👑 Суперадмин: admin@concierge.ru / admin123 (Business подписка)');
        console.log('👨‍💼 Админ: manager@concierge.ru / manager123 (Premium подписка)');
        console.log('👩 Клиент 1: client1@example.com / client123 (Premium подписка)');
        console.log('👨 Клиент 2: client2@example.com / client123 (Basic подписка)');
        console.log('👩‍🏫 Исполнитель 1: performer1@example.com / performer123 (Premium подписка)');
        console.log('👨‍🏫 Исполнитель 2: performer2@example.com / performer123 (Basic подписка)');
        
    } catch (error) {
        console.error('⚠️ Ошибка создания тестовых данных:', error.message);
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
        
        bot.onText(/\/help/, (msg) => {
            const chatId = msg.chat.id;
            const helpMessage = `🆘 *Помощь по Консьерж Сервису*\n\n` +
                `*Как это работает:*\n` +
                `1. Выбираете подписку на сайте\n` +
                `2. Создаете задачи в личном кабинете\n` +
                `3. Исполнители берут ваши задачи\n` +
                `4. Вы отслеживаете выполнение\n` +
                `5. После выполнения оставляете отзыв\n\n` +
                `*Подписки:*\n` +
                `• Бесплатная - 1 задача/месяц\n` +
                `• Базовая - 3 задачи/месяц (990₽)\n` +
                `• Премиум - 10 задач/месяц (2990₽)\n` +
                `• Бизнес - безлимит (9990₽)\n\n` +
                `*Поддержка:*\n` +
                `📞 +7 (999) 123-45-67\n` +
                `✉️ support@concierge-service.ru\n` +
                `⏰ Ежедневно с 9:00 до 21:00`;
            
            bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
        });
        
        bot.onText(/\/status/, async (msg) => {
            const chatId = msg.chat.id;
            
            try {
                const [users, tasks, activeTasks] = await Promise.all([
                    db.get('SELECT COUNT(*) as count FROM users'),
                    db.get('SELECT COUNT(*) as count FROM tasks'),
                    db.get('SELECT COUNT(*) as count FROM tasks WHERE status IN ("new", "in_progress")')
                ]);
                
                const statusMessage = `📊 *Статус системы*\n\n` +
                    `🟢 Система работает\n` +
                    `🕐 Время сервера: ${new Date().toLocaleString('ru-RU')}\n\n` +
                    `*Статистика:*\n` +
                    `👥 Пользователей: ${users.count}\n` +
                    `📋 Всего задач: ${tasks.count}\n` +
                    `🔄 Активных задач: ${activeTasks.count}\n\n` +
                    `*Telegram Bot:* ✅ Активен`;
                
                bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
                
            } catch (error) {
                bot.sendMessage(chatId, `📊 Статус: Система работает\n🕐 ${new Date().toLocaleString('ru-RU')}`);
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
                    'SELECT * FROM tasks WHERE client_id = ? ORDER BY created_at DESC LIMIT 5',
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
                    message += `   📍 ${task.address || 'Адрес не указан'}\n`;
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
        
        bot.onText(/\/profile/, async (msg) => {
            const chatId = msg.chat.id;
            
            try {
                const user = await db.get(
                    `SELECT u.*, s.display_name 
                     FROM users u 
                     LEFT JOIN subscriptions s ON u.subscription_plan = s.name 
                     WHERE u.telegram_id = ?`,
                    [chatId.toString()]
                );
                
                if (!user) {
                    bot.sendMessage(chatId, 'Профиль не найден. Привяжите Telegram в настройках профиля на сайте.');
                    return;
                }
                
                // Получаем статистику задач
                const stats = await db.get(
                    `SELECT 
                        COUNT(*) as total_tasks,
                        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_tasks
                     FROM tasks 
                     WHERE client_id = ?`,
                    [user.id]
                );
                
                const profileMessage = `👤 *Ваш профиль*\n\n` +
                    `*Основная информация:*\n` +
                    `👤 Имя: ${user.firstName} ${user.lastName}\n` +
                    `📧 Email: ${user.email}\n` +
                    `📞 Телефон: ${user.phone || 'Не указан'}\n\n` +
                    `*Подписка:*\n` +
                    `📋 ${user.display_name || user.subscription_plan}\n` +
                    `📅 Действует до: ${user.subscription_expires ? new Date(user.subscription_expires).toLocaleDateString('ru-RU') : 'Не ограничено'}\n` +
                    `💎 Статус: ${user.subscription_status}\n\n` +
                    `*Статистика:*\n` +
                    `📊 Всего задач: ${stats.total_tasks || 0}\n` +
                    `✅ Выполнено: ${stats.completed_tasks || 0}\n` +
                    `💰 Баланс: ${user.balance}₽\n\n` +
                    `🌐 Для изменения профиля перейдите на сайт.`;
                
                bot.sendMessage(chatId, profileMessage, { 
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🌐 Открыть профиль', url: 'https://concierge-service.ru/profile' }]
                        ]
                    }
                });
                
            } catch (error) {
                console.error('Ошибка получения профиля:', error);
                bot.sendMessage(chatId, 'Ошибка получения профиля. Попробуйте позже.');
            }
        });
        
        bot.onText(/\/website/, (msg) => {
            const chatId = msg.chat.id;
            bot.sendMessage(chatId, '🌐 Перейдите на наш сайт:', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🌐 Консьерж Сервис', url: 'https://concierge-service.ru' }],
                        [{ text: '📋 Мои задачи', url: 'https://concierge-service.ru/tasks' }],
                        [{ text: '👤 Профиль', url: 'https://concierge-service.ru/profile' }]
                    ]
                }
            });
        });
        
        // Обработка текстовых сообщений с кнопок
        bot.on('message', (msg) => {
            const chatId = msg.chat.id;
            const text = msg.text;
            
            if (!text.startsWith('/')) {
                switch (text) {
                    case '🌐 Открыть сайт':
                        bot.sendMessage(chatId, 'Открываю сайт...', {
                            reply_markup: {
                                inline_keyboard: [[{ text: '🌐 Консьерж Сервис', url: 'https://concierge-service.ru' }]]
                            }
                        });
                        break;
                        
                    case '📋 Мои задачи':
                        bot.sendMessage(chatId, 'Переходим к задачам...', {
                            reply_markup: {
                                inline_keyboard: [[{ text: '📋 Мои задачи', url: 'https://concierge-service.ru/tasks' }]]
                            }
                        });
                        break;
                        
                    case '👤 Профиль':
                        bot.sendMessage(chatId, 'Открываю профиль...', {
                            reply_markup: {
                                inline_keyboard: [[{ text: '👤 Профиль', url: 'https://concierge-service.ru/profile' }]]
                            }
                        });
                        break;
                        
                    case '🆘 Помощь':
                        bot.sendMessage(chatId, 'Нужна помощь?', {
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '📞 Позвонить', callback_data: 'call_support' }],
                                    [{ text: '✉️ Написать', url: 'mailto:support@concierge-service.ru' }]
                                ]
                            }
                        });
                        break;
                        
                    case '📊 Статистика':
                        bot.sendMessage(chatId, 'Загружаю статистику...');
                        bot.onText(/\/status/, { chatId: chatId });
                        break;
                }
            }
        });
        
        // Обработка callback-запросов
        bot.on('callback_query', (callbackQuery) => {
            const chatId = callbackQuery.message.chat.id;
            const data = callbackQuery.data;
            
            if (data === 'call_support') {
                bot.answerCallbackQuery(callbackQuery.id, { text: 'Телефон поддержки: +7 (999) 123-45-67' });
            }
        });
        
        console.log('✅ Telegram Bot запущен успешно');
        telegramBot = bot;
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
                'GET /api/services',
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
                    'SELECT id, email, firstName, lastName, role, subscription_plan, subscription_status, is_active FROM users WHERE id = ?',
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
                    subscription_plan: user.subscription_plan,
                    subscription_status: user.subscription_status
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
        version: '4.6.0',
        status: '🟢 Работает',
        features: ['Подписки', 'Telegram Bot', 'Задачи', 'Платежи', 'Уведомления', 'Админ-панель'],
        endpoints: {
            auth: [
                'POST /api/auth/register - Регистрация',
                'POST /api/auth/login - Вход',
                'GET /api/auth/profile - Профиль (требуется токен)'
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
            services: [
                'GET /api/services - Все услуги',
                'GET /api/services/categories - Категории услуг'
            ],
            admin: [
                'GET /api/admin/stats - Статистика (admin)',
                'GET /api/admin/users - Пользователи (admin)',
                'GET /api/admin/tasks - Все задачи (admin)'
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
        
        const [users, tasks, services] = await Promise.all([
            db.get('SELECT COUNT(*) as count FROM users'),
            db.get('SELECT COUNT(*) as count FROM tasks'),
            db.get('SELECT COUNT(*) as count FROM services WHERE is_active = 1')
        ]);
        
        res.json({
            success: true,
            status: 'OK',
            database: 'connected',
            telegram_bot: telegramBot ? 'connected' : 'disabled',
            statistics: {
                users: users.count,
                tasks: tasks.count,
                services: services.count
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

// Регистрация
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, firstName, lastName, phone, role = 'client', telegram_username } = req.body;
        
        // Валидация
        if (!email || !password || !firstName || !lastName) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля: email, password, firstName, lastName'
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
        
        // Хеширование пароля
        const hashedPassword = await bcrypt.hash(password, 12);
        
        // Создание пользователя
        const result = await db.run(
            `INSERT INTO users 
            (email, password, firstName, lastName, phone, role, telegram_username, subscription_plan, subscription_status, avatar_url, balance) 
            VALUES (?, ?, ?, ?, ?, ?, ?, 'free', 'active', ?, 0)`,
            [
                email,
                hashedPassword,
                firstName,
                lastName,
                phone || null,
                role,
                telegram_username || null,
                `https://ui-avatars.com/api/?name=${encodeURIComponent(firstName)}+${encodeURIComponent(lastName)}&background=FF6B8B&color=fff&bold=true`
            ]
        );
        
        // Получаем созданного пользователя
        const user = await db.get(
            `SELECT id, email, firstName, lastName, phone, role, 
                    subscription_plan, subscription_status, subscription_expires,
                    telegram_username, avatar_url, balance, created_at 
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
                subscription_plan: user.subscription_plan
            },
            process.env.JWT_SECRET || 'concierge-secret-key-2024-prod',
            { expiresIn: '30d' }
        );
        
        // Отправляем приветственное уведомление в базу
        await db.run(
            `INSERT INTO notifications (user_id, title, message, type) 
             VALUES (?, ?, ?, ?)`,
            [user.id, 'Добро пожаловать!', 'Регистрация прошла успешно. Добро пожаловать в Консьерж Сервис!', 'success']
        );
        
        // Если указан Telegram, можно отправить уведомление в бот
        if (telegram_username && telegramBot) {
            try {
                // Здесь можно добавить логику поиска chat_id по username
                // и отправки приветственного сообщения
            } catch (telegramError) {
                console.log('Не удалось отправить Telegram уведомление:', telegramError.message);
            }
        }
        
        res.status(201).json({
            success: true,
            message: 'Регистрация успешно завершена!',
            data: { 
                user,
                token 
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
                subscription_plan: user.subscription_plan
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

// Обновление профиля
app.put('/api/auth/profile', authMiddleware(), async (req, res) => {
    try {
        const { firstName, lastName, phone, telegram_username, telegram_id } = req.body;
        
        // Подготовка полей для обновления
        const updates = [];
        const params = [];
        
        if (firstName) {
            updates.push('firstName = ?');
            params.push(firstName);
        }
        
        if (lastName) {
            updates.push('lastName = ?');
            params.push(lastName);
        }
        
        if (phone !== undefined) {
            updates.push('phone = ?');
            params.push(phone || null);
        }
        
        if (telegram_username !== undefined) {
            updates.push('telegram_username = ?');
            params.push(telegram_username || null);
        }
        
        if (telegram_id !== undefined) {
            updates.push('telegram_id = ?');
            params.push(telegram_id || null);
        }
        
        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Не указаны данные для обновления'
            });
        }
        
        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push(req.user.id);
        
        const query = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
        
        await db.run(query, params);
        
        // Получаем обновленного пользователя
        const user = await db.get(
            `SELECT id, email, firstName, lastName, phone, role, 
                    subscription_plan, subscription_status, subscription_expires,
                    telegram_username, telegram_id, avatar_url, balance, 
                    created_at, updated_at 
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        
        res.json({
            success: true,
            message: 'Профиль успешно обновлен',
            data: { user }
        });
        
    } catch (error) {
        console.error('Ошибка обновления профиля:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления профиля'
        });
    }
});

// ==================== ПОДПИСКИ ====================

// Получение всех подписок
app.get('/api/subscriptions', async (req, res) => {
    try {
        console.log('📊 Получение списка подписок');
        
        const subscriptions = await db.all(
            'SELECT * FROM subscriptions ORDER BY sort_order ASC, price_monthly ASC'
        );
        
        // Парсим features из JSON строки
        const subscriptionsWithParsedFeatures = subscriptions.map(sub => ({
            ...sub,
            features: typeof sub.features === 'string' ? JSON.parse(sub.features) : sub.features
        }));
        
        console.log(`✅ Найдено подписок: ${subscriptions.length}`);
        
        res.json({
            success: true,
            data: {
                subscriptions: subscriptionsWithParsedFeatures,
                count: subscriptions.length
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения подписок:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения подписок',
            details: error.message
        });
    }
});

// Оформление подписки
app.post('/api/subscriptions/subscribe', authMiddleware(['client', 'admin', 'superadmin']), async (req, res) => {
    try {
        console.log('📝 Запрос на подписку от пользователя:', req.user.email);
        console.log('📝 Данные запроса:', req.body);
        
        const { plan, period = 'monthly' } = req.body;
        
        if (!plan) {
            return res.status(400).json({
                success: false,
                error: 'Укажите план подписки'
            });
        }
        
        // Проверяем существование плана
        const subscriptionPlan = await db.get(
            'SELECT * FROM subscriptions WHERE name = ?',
            [plan]
        );
        
        if (!subscriptionPlan) {
            console.log(`❌ План "${plan}" не найден в БД`);
            return res.status(404).json({
                success: false,
                error: `План подписки "${plan}" не найден`
            });
        }
        
        console.log(`✅ План найден: ${subscriptionPlan.display_name}`);
        
        // Проверяем, не пытается ли пользователь перейти на бесплатный план с платного
        if (plan === 'free' && req.user.subscription_plan !== 'free') {
            return res.status(400).json({
                success: false,
                error: 'Нельзя перейти на бесплатный план с платного. Обратитесь в поддержку.'
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
        
        console.log(`📅 Устанавливаем срок подписки до: ${expiryDateString}`);
        
        await db.run(
            `UPDATE users SET 
                subscription_plan = ?,
                subscription_status = 'active',
                subscription_expires = ?,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [plan, expiryDateString, req.user.id]
        );
        
        // Создаем запись о платеже
        if (amount > 0) {
            const transactionId = `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
            
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
            
            console.log(`💰 Платеж создан: ${transactionId} на сумму ${amount}₽`);
        }
        
        // Добавляем уведомление
        await db.run(
            `INSERT INTO notifications (user_id, title, message, type) 
             VALUES (?, ?, ?, ?)`,
            [
                req.user.id,
                'Подписка оформлена!',
                `Вы успешно оформили подписку "${subscriptionPlan.display_name}". Действует до ${expiryDateString}.`,
                'success'
            ]
        );
        
        console.log(`✅ Подписка обновлена для пользователя ${req.user.id}`);
        
        // Получаем обновленного пользователя
        const user = await db.get(
            'SELECT id, email, firstName, lastName, subscription_plan, subscription_status, subscription_expires FROM users WHERE id = ?',
            [req.user.id]
        );
        
        console.log(`✅ Новые данные пользователя:`, user);
        
        res.json({
            success: true,
            message: `Подписка "${subscriptionPlan.display_name}" успешно оформлена!`,
            data: { 
                user,
                subscription: subscriptionPlan,
                payment: amount > 0 ? {
                    amount,
                    period,
                    expiryDate: expiryDateString
                } : null
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка оформления подписки:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка оформления подписки',
            details: error.message
        });
    }
});

// Моя подписка
app.get('/api/subscriptions/my', authMiddleware(), async (req, res) => {
    try {
        const user = await db.get(
            'SELECT subscription_plan, subscription_status, subscription_expires FROM users WHERE id = ?',
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

// ==================== УСЛУГИ ====================

app.get('/api/services', async (req, res) => {
    try {
        const { category, popular } = req.query;
        
        let query = 'SELECT * FROM services WHERE is_active = 1';
        const params = [];
        
        if (category) {
            query += ' AND category = ?';
            params.push(category);
        }
        
        if (popular === 'true') {
            query += ' AND is_popular = 1';
        }
        
        query += ' ORDER BY sort_order ASC, name ASC';
        
        const services = await db.all(query, params);
        
        // Группируем по категориям
        const categories = {};
        services.forEach(service => {
            if (!categories[service.category]) {
                categories[service.category] = [];
            }
            categories[service.category].push(service);
        });
        
        res.json({
            success: true,
            data: {
                services,
                categories,
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

app.get('/api/services/categories', async (req, res) => {
    try {
        const categories = await db.all(
            `SELECT category, COUNT(*) as service_count, 
                    GROUP_CONCAT(DISTINCT icon) as icons
             FROM services 
             WHERE is_active = 1 
             GROUP BY category 
             ORDER BY COUNT(*) DESC`
        );
        
        // Добавляем русские названия категорий
        const categoryNames = {
            'home_and_household': { name: 'Дом и быт', icon: '🏠' },
            'family_and_children': { name: 'Дети и семья', icon: '👨‍👩‍👧‍👦' },
            'beauty_and_health': { name: 'Красота и здоровье', icon: '💅' },
            'courses_and_education': { name: 'Образование', icon: '🎓' },
            'pets': { name: 'Питомцы', icon: '🐕' },
            'events_and_entertainment': { name: 'Мероприятия', icon: '🎉' },
            'delivery': { name: 'Доставка', icon: '🚚' },
            'repair': { name: 'Ремонт', icon: '🔧' },
            'photo': { name: 'Фото', icon: '📸' },
            'food': { name: 'Еда', icon: '🍳' }
        };
        
        const enrichedCategories = categories.map(cat => ({
            ...cat,
            display_name: categoryNames[cat.category]?.name || cat.category,
            icon: categoryNames[cat.category]?.icon || '📋'
        }));
        
        res.json({
            success: true,
            data: {
                categories: enrichedCategories,
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

// ==================== ЗАДАЧИ ====================

// Создание задачи
app.post('/api/tasks', authMiddleware(['client', 'admin', 'superadmin']), async (req, res) => {
    try {
        const { title, description, category, priority = 'medium', deadline, address, price } = req.body;
        
        // Валидация
        if (!title || !description || !category || !deadline) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля: title, description, category, deadline'
            });
        }
        
        // Проверяем подписку пользователя
        const user = await db.get(
            'SELECT subscription_plan, subscription_status FROM users WHERE id = ?',
            [req.user.id]
        );
        
        if (!user || user.subscription_status !== 'active') {
            return res.status(403).json({
                success: false,
                error: 'Ваша подписка не активна. Оформите подписку для создания задач.'
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
            (task_number, title, description, client_id, category, priority, deadline, address, price) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                taskNumber,
                title,
                description,
                req.user.id,
                category,
                priority,
                deadline,
                address || null,
                price || 0
            ]
        );
        
        const task = await db.get('SELECT * FROM tasks WHERE id = ?', [result.lastID]);
        
        // Добавляем уведомление
        await db.run(
            `INSERT INTO notifications (user_id, title, message, type, data) 
             VALUES (?, ?, ?, ?, ?)`,
            [
                req.user.id,
                'Задача создана!',
                `Задача "${title}" успешно создана. Номер: ${taskNumber}`,
                'success',
                JSON.stringify({ task_id: task.id, task_number: taskNumber })
            ]
        );
        
        // Если есть Telegram бот и у пользователя привязан Telegram
        if (telegramBot) {
            const userWithTelegram = await db.get(
                'SELECT telegram_id FROM users WHERE id = ? AND telegram_id IS NOT NULL',
                [req.user.id]
            );
            
            if (userWithTelegram && userWithTelegram.telegram_id) {
                try {
                    await telegramBot.sendMessage(
                        userWithTelegram.telegram_id,
                        `🎉 *Новая задача создана!*\n\n` +
                        `*${title}*\n` +
                        `📝 ${description.substring(0, 100)}${description.length > 100 ? '...' : ''}\n` +
                        `📅 Дедлайн: ${new Date(deadline).toLocaleDateString('ru-RU')}\n` +
                        `🔢 Номер: ${taskNumber}\n\n` +
                        `_Ожидайте предложений от исполнителей_`,
                        { parse_mode: 'Markdown' }
                    );
                } catch (telegramError) {
                    console.log('Не удалось отправить Telegram уведомление:', telegramError.message);
                }
            }
        }
        
        res.status(201).json({
            success: true,
            message: 'Задача успешно создана!',
            data: { task }
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
        const { status, category, limit = 50, offset = 0, sort = 'created_at', order = 'DESC' } = req.query;
        const userId = req.user.id;
        
        let query = `
            SELECT t.*, 
                   u1.firstName as client_firstName, 
                   u1.lastName as client_lastName,
                   u2.firstName as performer_firstName,
                   u2.lastName as performer_lastName
            FROM tasks t
            LEFT JOIN users u1 ON t.client_id = u1.id
            LEFT JOIN users u2 ON t.performer_id = u2.id
            WHERE t.client_id = ?
        `;
        
        const params = [userId];
        
        // Фильтрация по статусу
        if (status && status !== 'all') {
            query += ' AND t.status = ?';
            params.push(status);
        }
        
        // Фильтрация по категории
        if (category) {
            query += ' AND t.category = ?';
            params.push(category);
        }
        
        // Сортировка
        const validSortFields = ['created_at', 'deadline', 'price', 'priority'];
        const validOrders = ['ASC', 'DESC'];
        const sortField = validSortFields.includes(sort) ? sort : 'created_at';
        const sortOrder = validOrders.includes(order.toUpperCase()) ? order.toUpperCase() : 'DESC';
        
        query += ` ORDER BY t.${sortField} ${sortOrder} LIMIT ? OFFSET ?`;
        params.push(parseInt(limit), parseInt(offset));
        
        const tasks = await db.all(query, params);
        
        // Получаем общее количество для пагинации
        let countQuery = 'SELECT COUNT(*) as total FROM tasks WHERE client_id = ?';
        const countParams = [userId];
        
        if (status && status !== 'all') {
            countQuery += ' AND status = ?';
            countParams.push(status);
        }
        
        if (category) {
            countQuery += ' AND category = ?';
            countParams.push(category);
        }
        
        const countResult = await db.get(countQuery, countParams);
        const total = countResult.total;
        
        // Обогащаем задачи дополнительной информацией
        const enrichedTasks = tasks.map(task => {
            const statusInfo = {
                'new': { label: 'Новая', color: '#FF6B8B', icon: '🆕' },
                'assigned': { label: 'Назначена', color: '#3498DB', icon: '👤' },
                'in_progress': { label: 'В работе', color: '#F39C12', icon: '🔄' },
                'completed': { label: 'Завершена', color: '#2ECC71', icon: '✅' },
                'cancelled': { label: 'Отменена', color: '#95A5A6', icon: '❌' }
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
                can_edit: task.status === 'new',
                can_cancel: ['new', 'assigned'].includes(task.status),
                can_complete: task.status === 'in_progress' && req.user.id === task.client_id
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

// Получение конкретной задачи
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
                    u1.firstName as client_firstName, u1.lastName as client_lastName, u1.avatar_url as client_avatar,
                    u2.firstName as performer_firstName, u2.lastName as performer_lastName, u2.avatar_url as performer_avatar
             FROM tasks t
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
        if (req.user.role !== 'admin' && req.user.role !== 'superadmin' && 
            req.user.id !== task.client_id && req.user.id !== task.performer_id) {
            return res.status(403).json({
                success: false,
                error: 'Нет доступа к этой задаче'
            });
        }
        
        // Получаем сообщения чата
        const messages = await db.all(
            `SELECT tm.*, u.firstName, u.lastName, u.avatar_url, u.role
             FROM task_messages tm
             LEFT JOIN users u ON tm.user_id = u.id
             WHERE tm.task_id = ?
             ORDER BY tm.created_at ASC`,
            [taskId]
        );
        
        // Обогащаем задачу дополнительной информацией
        const statusInfo = {
            'new': { label: 'Новая', color: '#FF6B8B', icon: '🆕', actions: ['edit', 'cancel', 'assign'] },
            'assigned': { label: 'Назначена', color: '#3498DB', icon: '👤', actions: ['chat', 'cancel'] },
            'in_progress': { label: 'В работе', color: '#F39C12', icon: '🔄', actions: ['chat', 'complete'] },
            'completed': { label: 'Завершена', color: '#2ECC71', icon: '✅', actions: ['review'] },
            'cancelled': { label: 'Отменена', color: '#95A5A6', icon: '❌', actions: [] }
        }[task.status] || { label: task.status, color: '#95A5A6', icon: '📝', actions: [] };
        
        const priorityInfo = {
            'low': { label: 'Низкий', color: '#2ECC71' },
            'medium': { label: 'Средний', color: '#F39C12' },
            'high': { label: 'Высокий', color: '#E74C3C' },
            'urgent': { label: 'Срочный', color: '#C0392B' }
        }[task.priority] || { label: task.priority, color: '#95A5A6' };
        
        // Получаем отзыв если есть
        const review = task.status === 'completed' ? await db.get(
            'SELECT * FROM reviews WHERE task_id = ?',
            [taskId]
        ) : null;
        
        res.json({
            success: true,
            data: {
                task: {
                    ...task,
                    status_info: statusInfo,
                    priority_info: priorityInfo,
                    messages,
                    review,
                    permissions: {
                        can_edit: req.user.id === task.client_id && task.status === 'new',
                        can_cancel: req.user.id === task.client_id && ['new', 'assigned'].includes(task.status),
                        can_complete: req.user.id === task.client_id && task.status === 'in_progress',
                        can_assign: req.user.role === 'admin' || req.user.role === 'superadmin',
                        can_chat: true,
                        can_review: req.user.id === task.client_id && task.status === 'completed' && !review
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

// Обновление задачи
app.put('/api/tasks/:id', authMiddleware(), async (req, res) => {
    try {
        const taskId = parseInt(req.params.id);
        const { title, description, priority, deadline, address, status } = req.body;
        
        if (isNaN(taskId)) {
            return res.status(400).json({
                success: false,
                error: 'Неверный ID задачи'
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
        if (req.user.id !== task.client_id && req.user.role !== 'admin' && req.user.role !== 'superadmin') {
            return res.status(403).json({
                success: false,
                error: 'Нет прав для редактирования этой задачи'
            });
        }
        
        // Проверяем можно ли редактировать
        if (task.status !== 'new' && !['admin', 'superadmin'].includes(req.user.role)) {
            return res.status(400).json({
                success: false,
                error: 'Можно редактировать только новые задачи'
            });
        }
        
        // Подготавливаем обновления
        const updates = [];
        const params = [];
        
        if (title !== undefined) {
            updates.push('title = ?');
            params.push(title);
        }
        
        if (description !== undefined) {
            updates.push('description = ?');
            params.push(description);
        }
        
        if (priority !== undefined) {
            updates.push('priority = ?');
            params.push(priority);
        }
        
        if (deadline !== undefined) {
            updates.push('deadline = ?');
            params.push(deadline);
        }
        
        if (address !== undefined) {
            updates.push('address = ?');
            params.push(address);
        }
        
        if (status !== undefined && ['admin', 'superadmin'].includes(req.user.role)) {
            updates.push('status = ?');
            params.push(status);
            
            if (status === 'completed') {
                updates.push('completed_at = CURRENT_TIMESTAMP');
            }
        }
        
        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Не указаны данные для обновления'
            });
        }
        
        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push(taskId);
        
        const query = `UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`;
        await db.run(query, params);
        
        // Получаем обновленную задачу
        const updatedTask = await db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
        
        // Добавляем уведомление об изменении
        await db.run(
            `INSERT INTO notifications (user_id, title, message, type, data) 
             VALUES (?, ?, ?, ?, ?)`,
            [
                task.client_id,
                'Задача обновлена',
                `Задача "${updatedTask.title}" была обновлена.`,
                'info',
                JSON.stringify({ task_id: task.id })
            ]
        );
        
        // Если есть исполнитель, уведомляем его
        if (task.performer_id) {
            await db.run(
                `INSERT INTO notifications (user_id, title, message, type, data) 
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    task.performer_id,
                    'Задача обновлена',
                    `Задача "${updatedTask.title}" была обновлена заказчиком.`,
                    'info',
                    JSON.stringify({ task_id: task.id })
                ]
            );
        }
        
        res.json({
            success: true,
            message: 'Задача успешно обновлена',
            data: { task: updatedTask }
        });
        
    } catch (error) {
        console.error('Ошибка обновления задачи:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления задачи'
        });
    }
});

// Отмена задачи
app.post('/api/tasks/:id/cancel', authMiddleware(), async (req, res) => {
    try {
        const taskId = parseInt(req.params.id);
        
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
        if (req.user.id !== task.client_id && !['admin', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'Нет прав для отмены этой задачи'
            });
        }
        
        // Проверяем можно ли отменить
        if (!['new', 'assigned'].includes(task.status)) {
            return res.status(400).json({
                success: false,
                error: 'Можно отменить только новые или назначенные задачи'
            });
        }
        
        // Отменяем задачу
        await db.run(
            `UPDATE tasks SET 
                status = 'cancelled',
                updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [taskId]
        );
        
        // Добавляем уведомления
        await db.run(
            `INSERT INTO notifications (user_id, title, message, type, data) 
             VALUES (?, ?, ?, ?, ?)`,
            [
                task.client_id,
                'Задача отменена',
                `Задача "${task.title}" была отменена.`,
                'warning',
                JSON.stringify({ task_id: task.id })
            ]
        );
        
        if (task.performer_id) {
            await db.run(
                `INSERT INTO notifications (user_id, title, message, type, data) 
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    task.performer_id,
                    'Задача отменена',
                    `Задача "${task.title}" была отменена заказчиком.`,
                    'warning',
                    JSON.stringify({ task_id: task.id })
                ]
            );
        }
        
        res.json({
            success: true,
            message: 'Задача успешно отменена'
        });
        
    } catch (error) {
        console.error('Ошибка отмены задачи:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка отмены задачи'
        });
    }
});

// Завершение задачи
app.post('/api/tasks/:id/complete', authMiddleware(), async (req, res) => {
    try {
        const taskId = parseInt(req.params.id);
        const { rating, feedback } = req.body;
        
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
        if (req.user.id !== task.client_id && !['admin', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'Нет прав для завершения этой задачи'
            });
        }
        
        // Проверяем статус
        if (task.status !== 'in_progress') {
            return res.status(400).json({
                success: false,
                error: 'Можно завершить только задачи в работе'
            });
        }
        
        // Проверяем рейтинг если указан
        if (rating && (rating < 1 || rating > 5)) {
            return res.status(400).json({
                success: false,
                error: 'Рейтинг должен быть от 1 до 5'
            });
        }
        
        // Завершаем задачу
        await db.run(
            `UPDATE tasks SET 
                status = 'completed',
                completed_at = CURRENT_TIMESTAMP,
                rating = ?,
                feedback = ?,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [rating || null, feedback || null, taskId]
        );
        
        // Если указан рейтинг, создаем отзыв
        if (rating && task.performer_id) {
            await db.run(
                `INSERT INTO reviews (task_id, client_id, performer_id, rating, comment) 
                 VALUES (?, ?, ?, ?, ?)`,
                [taskId, task.client_id, task.performer_id, rating, feedback || null]
            );
        }
        
        // Добавляем уведомления
        await db.run(
            `INSERT INTO notifications (user_id, title, message, type, data) 
             VALUES (?, ?, ?, ?, ?)`,
            [
                task.client_id,
                'Задача завершена',
                `Задача "${task.title}" успешно завершена.`,
                'success',
                JSON.stringify({ task_id: task.id })
            ]
        );
        
        if (task.performer_id) {
            await db.run(
                `INSERT INTO notifications (user_id, title, message, type, data) 
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    task.performer_id,
                    'Задача завершена',
                    `Задача "${task.title}" завершена заказчиком.`,
                    'success',
                    JSON.stringify({ task_id: task.id })
                ]
            );
        }
        
        res.json({
            success: true,
            message: 'Задача успешно завершена'
        });
        
    } catch (error) {
        console.error('Ошибка завершения задачи:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка завершения задачи'
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
            'SELECT client_id, performer_id FROM tasks WHERE id = ?',
            [taskId]
        );
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        if (req.user.id !== task.client_id && req.user.id !== task.performer_id && 
            !['admin', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'Нет доступа к чату этой задачи'
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
            data: { messages }
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
            'SELECT id, client_id, performer_id, status FROM tasks WHERE id = ?',
            [taskId]
        );
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        if (req.user.id !== task.client_id && req.user.id !== task.performer_id && 
            !['admin', 'superadmin'].includes(req.user.role)) {
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
        let notifyUserId = null;
        if (req.user.id === task.client_id && task.performer_id) {
            notifyUserId = task.performer_id;
        } else if (req.user.id === task.performer_id) {
            notifyUserId = task.client_id;
        }
        
        // Отправляем уведомление если есть кому
        if (notifyUserId) {
            await db.run(
                `INSERT INTO notifications (user_id, title, message, type, data) 
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    notifyUserId,
                    'Новое сообщение в задаче',
                    `Новое сообщение в задаче "${task.title}".`,
                    'info',
                    JSON.stringify({ task_id: task.id, message_id: newMessage.id })
                ]
            );
            
            // Отправляем Telegram уведомление если есть бот
            if (telegramBot) {
                const notifyUser = await db.get(
                    'SELECT telegram_id FROM users WHERE id = ? AND telegram_id IS NOT NULL',
                    [notifyUserId]
                );
                
                if (notifyUser && notifyUser.telegram_id) {
                    try {
                        await telegramBot.sendMessage(
                            notifyUser.telegram_id,
                            `💬 *Новое сообщение в задаче*\n\n` +
                            `*${task.title}*\n` +
                            `👤 От: ${req.user.firstName} ${req.user.lastName}\n` +
                            `💭 ${message.substring(0, 200)}${message.length > 200 ? '...' : ''}\n\n` +
                            `[Перейти к чату](https://concierge-service.ru/tasks/${taskId})`,
                            { parse_mode: 'Markdown', disable_web_page_preview: true }
                        );
                    } catch (telegramError) {
                        console.log('Не удалось отправить Telegram уведомление:', telegramError.message);
                    }
                }
            }
        }
        
        res.status(201).json({
            success: true,
            message: 'Сообщение отправлено',
            data: { message: newMessage }
        });
        
    } catch (error) {
        console.error('Ошибка отправки сообщения:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка отправки сообщения'
        });
    }
});

// ==================== УВЕДОМЛЕНИЯ ====================

// Получение уведомлений
app.get('/api/notifications', authMiddleware(), async (req, res) => {
    try {
        const { limit = 50, offset = 0, unread_only } = req.query;
        
        let query = 'SELECT * FROM notifications WHERE user_id = ?';
        const params = [req.user.id];
        
        if (unread_only === 'true') {
            query += ' AND is_read = 0';
        }
        
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const notifications = await db.all(query, params);
        
        // Получаем общее количество
        let countQuery = 'SELECT COUNT(*) as total FROM notifications WHERE user_id = ?';
        const countParams = [req.user.id];
        
        if (unread_only === 'true') {
            countQuery += ' AND is_read = 0';
            countParams.push(unread_only);
        }
        
        const countResult = await db.get(countQuery, countParams);
        const total = countResult.total;
        
        res.json({
            success: true,
            data: {
                notifications,
                pagination: {
                    total,
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    has_more: (parseInt(offset) + parseInt(limit)) < total
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения уведомлений:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения уведомлений'
        });
    }
});

// Отметить уведомления как прочитанные
app.post('/api/notifications/read', authMiddleware(), async (req, res) => {
    try {
        const { notification_ids, mark_all } = req.body;
        
        if (mark_all) {
            await db.run(
                'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0',
                [req.user.id]
            );
        } else if (notification_ids && Array.isArray(notification_ids) && notification_ids.length > 0) {
            // Создаем плейсхолдеры для IN запроса
            const placeholders = notification_ids.map(() => '?').join(',');
            await db.run(
                `UPDATE notifications SET is_read = 1 
                 WHERE user_id = ? AND id IN (${placeholders})`,
                [req.user.id, ...notification_ids]
            );
        } else {
            return res.status(400).json({
                success: false,
                error: 'Укажите notification_ids или mark_all: true'
            });
        }
        
        res.json({
            success: true,
            message: 'Уведомления отмечены как прочитанные'
        });
        
    } catch (error) {
        console.error('Ошибка отметки уведомлений:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка отметки уведомлений'
        });
    }
});

// ==================== АДМИН ПАНЕЛЬ ====================

// Статистика системы
app.get('/api/admin/stats', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const [
            users,
            activeUsers,
            tasks,
            completedTasks,
            revenue,
            subscriptions
        ] = await Promise.all([
            db.get('SELECT COUNT(*) as count FROM users'),
            db.get('SELECT COUNT(*) as count FROM users WHERE is_active = 1'),
            db.get('SELECT COUNT(*) as count FROM tasks'),
            db.get('SELECT COUNT(*) as count FROM tasks WHERE status = "completed"'),
            db.get('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = "completed"'),
            db.get('SELECT subscription_plan, COUNT(*) as count FROM users GROUP BY subscription_plan')
        ]);
        
        // Статистика по дням за последние 7 дней
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        const dailyStats = await db.all(`
            SELECT 
                DATE(created_at) as date,
                COUNT(*) as new_users,
                SUM(CASE WHEN subscription_plan != 'free' THEN 1 ELSE 0 END) as paid_users
            FROM users 
            WHERE created_at >= ?
            GROUP BY DATE(created_at)
            ORDER BY date ASC
        `, [sevenDaysAgo.toISOString().split('T')[0]]);
        
        // Недавние задачи
        const recentTasks = await db.all(`
            SELECT t.*, 
                   u1.firstName as client_firstName, u1.lastName as client_lastName,
                   u2.firstName as performer_firstName, u2.lastName as performer_lastName
            FROM tasks t
            LEFT JOIN users u1 ON t.client_id = u1.id
            LEFT JOIN users u2 ON t.performer_id = u2.id
            ORDER BY t.created_at DESC
            LIMIT 10
        `);
        
        // Недавние платежи
        const recentPayments = await db.all(`
            SELECT p.*, u.firstName, u.lastName, s.display_name
            FROM payments p
            LEFT JOIN users u ON p.user_id = u.id
            LEFT JOIN subscriptions s ON p.subscription_id = s.id
            WHERE p.status = 'completed'
            ORDER BY p.created_at DESC
            LIMIT 10
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
                    conversion_rate: users.count > 0 ? Math.round((activeUsers.count / users.count) * 100) : 0
                },
                subscriptions: subscriptions || [],
                daily_stats: dailyStats,
                recent_tasks: recentTasks,
                recent_payments: recentPayments
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения статистики:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статистики'
        });
    }
});

// Пользователи
app.get('/api/admin/users', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const { role, subscription, limit = 50, offset = 0, search } = req.query;
        
        let query = `
            SELECT id, email, firstName, lastName, phone, role, 
                   subscription_plan, subscription_status, subscription_expires,
                   telegram_username, balance, is_active, created_at
            FROM users
            WHERE 1=1
        `;
        
        const params = [];
        
        if (role) {
            query += ' AND role = ?';
            params.push(role);
        }
        
        if (subscription) {
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
        
        if (role) {
            countQuery += ' AND role = ?';
            countParams.push(role);
        }
        
        if (subscription) {
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

// Все задачи
app.get('/api/admin/tasks', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const { status, category, limit = 50, offset = 0 } = req.query;
        
        let query = `
            SELECT t.*, 
                   u1.firstName as client_firstName, u1.lastName as client_lastName,
                   u2.firstName as performer_firstName, u2.lastName as performer_lastName
            FROM tasks t
            LEFT JOIN users u1 ON t.client_id = u1.id
            LEFT JOIN users u2 ON t.performer_id = u2.id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (status && status !== 'all') {
            query += ' AND t.status = ?';
            params.push(status);
        }
        
        if (category) {
            query += ' AND t.category = ?';
            params.push(category);
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

// ==================== СИСТЕМА ====================

app.get('/api/system/info', async (req, res) => {
    try {
        const [servicesCount, tasksCount, usersCount, subscriptionsCount] = await Promise.all([
            db.get('SELECT COUNT(*) as count FROM services WHERE is_active = 1'),
            db.get('SELECT COUNT(*) as count FROM tasks'),
            db.get('SELECT COUNT(*) as count FROM users'),
            db.get('SELECT COUNT(*) as count FROM subscriptions')
        ]);
        
        // Получаем информацию о подписках
        const subscriptions = await db.all(
            'SELECT name, display_name, COUNT(u.id) as user_count FROM subscriptions s LEFT JOIN users u ON s.name = u.subscription_plan GROUP BY s.name ORDER BY s.sort_order'
        );
        
        res.json({
            success: true,
            data: {
                services: servicesCount.count,
                tasks: tasksCount.count,
                users: usersCount.count,
                subscriptions: subscriptionsCount.count,
                subscription_distribution: subscriptions,
                version: '4.6.0',
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
                version: '4.6.0',
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
        console.log('🎀 ЗАПУСК КОНСЬЕРЖ СЕРВИСА v4.6.0');
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
            console.log(`🌐 https://sergeynikishin555123123-lab--86fa.twc1.net/`);
            console.log(`🎛️  Админ-панель: http://localhost:${PORT}/admin`);
            console.log(`🏥 Health check: http://localhost:${PORT}/health`);
            console.log('='.repeat(80));
            console.log('🎀 СИСТЕМА ГОТОВА К РАБОТЕ!');
            console.log('='.repeat(80));
            
            console.log('\n🔑 ТЕСТОВЫЕ АККАУНТЫ:');
            console.log('👑 Суперадмин: admin@concierge.ru / admin123');
            console.log('👨‍💼 Админ: manager@concierge.ru / manager123');
            console.log('👩 Клиент Premium: client1@example.com / client123');
            console.log('👨 Клиент Basic: client2@example.com / client123');
            console.log('👩‍🏫 Исполнитель Premium: performer1@example.com / performer123');
            console.log('👨‍🏫 Исполнитель Basic: performer2@example.com / performer123');
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
