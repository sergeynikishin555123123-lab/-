require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const fs = require('fs');

// ==================== TELEGRAM BOT ====================
let TelegramBot;
let telegramBot = null;

try {
    TelegramBot = require('node-telegram-bot-api');
    console.log('✅ Telegram Bot модуль загружеан');
} catch (error) {
    console.log('⚠️ Telegram Bot не установлен');
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ==================== SQLite БАЗА ДАННЫХ ====================
let db;

const initDatabase = async () => {
    try {
        console.log('🔄 Инициализация базы данных...');
        
        // Для TimeWeb используем специальный путь с правами записи
        const dbPath = '/tmp/concierge.db';
        console.log(`📁 Путь к базе данных: ${dbPath}`);
        
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        console.log('✅ База данных SQLite подключена');

        // Создание таблиц
        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                firstName TEXT NOT NULL,
                lastName TEXT NOT NULL,
                phone TEXT,
                role TEXT DEFAULT 'client',
                subscription_plan TEXT DEFAULT 'free',
                subscription_status TEXT DEFAULT 'inactive',
                subscription_expires DATE,
                telegram_id TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

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
                deadline DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (client_id) REFERENCES users(id),
                FOREIGN KEY (performer_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS services (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                category TEXT NOT NULL,
                icon TEXT,
                is_active INTEGER DEFAULT 1,
                is_popular INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                price_monthly REAL NOT NULL,
                price_yearly REAL NOT NULL,
                tasks_limit INTEGER NOT NULL,
                features TEXT NOT NULL,
                is_popular INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                amount REAL NOT NULL,
                currency TEXT DEFAULT 'RUB',
                description TEXT,
                status TEXT DEFAULT 'pending',
                payment_method TEXT,
                transaction_id TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                type TEXT DEFAULT 'info',
                is_read INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
        `);

        console.log('✅ Таблицы созданы');
        
        // Проверяем, есть ли уже тестовые данные
        const userCount = await db.get('SELECT COUNT(*) as count FROM users');
        if (!userCount.count || userCount.count === 0) {
            await createTestData();
        }
        
        return db;
    } catch (error) {
        console.error('❌ Ошибка инициализации базы данных:', error.message);
        
        // Пробуем in-memory как запасной вариант
        try {
            console.log('🔄 Пробуем in-memory базу данных...');
            db = await open({
                filename: ':memory:',
                driver: sqlite3.Database
            });
            
            // Создаем минимальные таблицы
            await db.exec(`
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT UNIQUE NOT NULL,
                    password TEXT NOT NULL,
                    firstName TEXT NOT NULL,
                    lastName TEXT NOT NULL,
                    role TEXT DEFAULT 'client',
                    subscription_plan TEXT DEFAULT 'free',
                    subscription_status TEXT DEFAULT 'inactive'
                );
                
                CREATE TABLE tasks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    description TEXT,
                    client_id INTEGER,
                    status TEXT DEFAULT 'new'
                );
                
                CREATE TABLE services (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    description TEXT,
                    category TEXT
                );
                
                CREATE TABLE subscriptions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    price_monthly REAL NOT NULL
                );
            `);
            
            await createTestData();
            console.log('✅ In-memory база создана с тестовыми данными');
            return db;
        } catch (fallbackError) {
            console.error('❌ Критическая ошибка:', fallbackError.message);
            throw error;
        }
    }
};

// ==================== СОЗДАНИЕ ТЕСТОВЫХ ДАННЫХ ====================
const createTestData = async () => {
    try {
        console.log('📝 Создание тестовых данных...');
        
        // Проверяем и создаем подписки
        const subscriptionCount = await db.get('SELECT COUNT(*) as count FROM subscriptions');
        if (!subscriptionCount || subscriptionCount.count === 0) {
            console.log('📝 Создаем тестовые подписки...');
            
            const subscriptions = [
                ['free', 'Бесплатная подписка', 'Попробуйте сервис бесплатно', 0, 0, 1, '["1 задача в месяц", "Базовые категории", "Поддержка в чате"]', 0],
                ['basic', 'Базовая', 'Для регулярных бытовых задач', 990, 9900, 3, '["3 задачи в месяц", "Все категории", "Приоритет 48ч", "Поддержка 24/7"]', 1],
                ['premium', 'Премиум', 'Для максимального комфорта', 2990, 29900, 10, '["10 задач в месяц", "Все категории", "Приоритет 24ч", "Личный куратор", "Статистика"]', 0],
                ['business', 'Бизнес', 'Для бизнеса и семьи', 9990, 99900, 999, '["Неограниченные задачи", "Все категории", "Приоритет 12ч", "Личный менеджер", "Расширенная статистика", "API доступ"]', 0]
            ];

            for (const subscription of subscriptions) {
                await db.run(
                    `INSERT OR IGNORE INTO subscriptions (name, description, price_monthly, price_yearly, tasks_limit, features, is_popular) 
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    subscription
                );
            }
            console.log('✅ Тестовые подписки созданы');
        }

        // Тестовые подписки
        const subscriptions = [
            ['free', 'Бесплатная подписка', 'Попробуйте сервис бесплатно', 0, 0, 1, '["1 задача в месяц", "Базовые категории", "Поддержка в чате"]', 0],
            ['basic', 'Базовая', 'Для регулярных бытовых задач', 990, 9900, 3, '["3 задачи в месяц", "Все категории", "Приоритет 48ч", "Поддержка 24/7"]', 1],
            ['premium', 'Премиум', 'Для максимального комфорта', 2990, 29900, 10, '["10 задач в месяц", "Все категории", "Приоритет 24ч", "Личный куратор", "Статистика"]', 0],
            ['business', 'Бизнес', 'Для бизнеса и семьи', 9990, 99900, 999, '["Неограниченные задачи", "Все категории", "Приоритет 12ч", "Личный менеджер", "Расширенная статистика", "API доступ"]', 0]
        ];

        for (const subscription of subscriptions) {
            await db.run(
                `INSERT OR IGNORE INTO subscriptions (name, description, price_monthly, price_yearly, tasks_limit, features, is_popular) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                subscription
            );
        }

        console.log('✅ Подписки созданы');

// Тестовые подписки для демонстрации
console.log('✅ Создаю тестовые подписки...');

// Активируем бесплатную подписку для тестового пользователя
await db.run(
    `UPDATE users SET subscription_plan = 'free', subscription_status = 'active', subscription_expires = '2025-12-31' WHERE email = 'test@example.com'`
);

console.log('✅ Тестовые аккаунты настроены:');
console.log('👑 Суперадмин: superadmin@concierge.com / admin123 (business подписка)');
console.log('👩‍💼 Админ: admin@concierge.com / admin123 (premium подписка)');
console.log('👩 Клиент: maria@example.com / client123 (basic подписка)');
console.log('👨‍🏫 Исполнитель: elena@performer.com / performer123 (premium подписка)');
console.log('🎯 Демо: test@example.com / test123 (free подписка)');
        
        // Тестовые услуги
        const services = [
            ['Уборка квартиры', 'Генеральная уборка, помощь в организации пространства', 'home_and_household', '🧹', 1, 1],
            ['Присмотр за детьми', 'Няня на несколько часов, помощь с уроками', 'family_and_children', '👶', 1, 1],
            ['Маникюр на дому', 'Профессиональный маникюр с выездом', 'beauty_and_health', '💅', 1, 1],
            ['Репетиторство', 'Помощь с уроками, подготовка к экзаменам', 'courses_and_education', '📚', 1, 0],
            ['Выгул собак', 'Прогулка с питомцем, кормление', 'pets', '🐕', 1, 0],
            ['Организация праздника', 'Помощь в организации детских и семейных праздников', 'events_and_entertainment', '🎂', 1, 1]
        ];

        for (const service of services) {
            await db.run(
                `INSERT OR IGNORE INTO services (name, description, category, icon, is_active, is_popular) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                service
            );
        }

        console.log('✅ Тестовые услуги созданы');
        
        // Тестовые задачи
        const tasks = [
            ['TASK-231201-001', 'Уборка квартиры', 'Нужно сделать генеральную уборку в 2-х комнатной квартире', 3, 'home_and_household', 'new', 'medium', 'Москва, ул. Тверская, 25', '2023-12-10'],
            ['TASK-231130-002', 'Няня на вечер', 'Присмотреть за ребенком 5 лет с 18:00 до 22:00', 3, 'family_and_children', 'in_progress', 'high', 'Москва, ул. Ленина, 10', '2023-12-05'],
            ['TASK-231125-003', 'Маникюр', 'Сделать классический маникюр с покрытием гель-лаком', 3, 'beauty_and_health', 'completed', 'medium', 'Москва, пр. Мира, 15', '2023-11-30']
        ];

        for (const task of tasks) {
            await db.run(
                `INSERT OR IGNORE INTO tasks (task_number, title, description, client_id, category, status, priority, address, deadline) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                task
            );
        }

        console.log('✅ Тестовые задачи созданы');
        
    } catch (error) {
        console.error('⚠️ Ошибка создания тестовых данных:', error.message);
    }
};

// ==================== ИНИЦИАЛИЗАЦИЯ TELEGRAM BOT ====================
const initTelegramBot = () => {
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    
    // Проверяем, что токен установлен и не стандартный
    if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'YOUR_BOT_TOKEN_HERE') {
        console.log('🤖 Telegram Bot: Токен не указан. Бот будет отключен.');
        return null;
    }
    
    if (TelegramBot) {
        try {
            console.log('🤖 Пробуем запустить Telegram Bot...');
            
            // Используем webhook вместо polling для TimeWeb
            const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
            
            // Останавливаем любой существующий polling
            bot.stopPolling && bot.stopPolling().catch(() => {});
            
            // Устанавливаем обработчики команд
            setupBotHandlers(bot);
            
            // Запускаем polling с параметрами
            bot.startPolling({
                polling: {
                    timeout: 10,
                    limit: 100,
                    autoStart: true
                }
            });
            
            console.log('✅ Telegram Bot запущен успешно');
            return bot;
            
        } catch (error) {
            console.warn('⚠️ Telegram Bot не запущен:', error.message);
            return null;
        }
    }
    
    return null;
};

// Функция для настройки обработчиков бота
const setupBotHandlers = (bot) => {
    try {
        // Команда /start
        bot.onText(/\/start/, (msg) => {
            const chatId = msg.chat.id;
            const userName = msg.from.first_name || 'пользователь';
            
            const welcomeMessage = `🎀 Привет, ${userName}! Добро пожаловать в Консьерж Сервис!\n\n` +
                `Я ваш персональный помощник в бытовых вопросах.\n\n` +
                `🛠️ Доступные команды:\n` +
                `/start - Начало работы\n` +
                `/help - Помощь и инструкции\n` +
                `/status - Статус системы\n` +
                `/website - Перейти на сайт`;
            
            bot.sendMessage(chatId, welcomeMessage, {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '🌐 Перейти на сайт', url: 'https://concierge-service.ru/' }
                        ]
                    ]
                }
            });
        });
        
        // Простые команды для демонстрации
        bot.onText(/\/help/, (msg) => {
            const chatId = msg.chat.id;
            bot.sendMessage(chatId, '🆘 Помощь: Для получения помощи перейдите на наш сайт или напишите в поддержку.');
        });
        
        bot.onText(/\/status/, (msg) => {
            const chatId = msg.chat.id;
            bot.sendMessage(chatId, `📊 Статус: Система работает\n🕐 Время сервера: ${new Date().toLocaleString('ru-RU')}`);
        });
        
        bot.onText(/\/website/, (msg) => {
            const chatId = msg.chat.id;
            bot.sendMessage(chatId, '🌐 Ссылка на сайт:', {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '🌐 Консьерж Сервис', url: 'https://concierge-service.ru/' }
                        ]
                    ]
                }
            });
        });
        
    } catch (error) {
        console.error('Ошибка настройки обработчиков бота:', error);
    }
};
// ==================== JWT МИДЛВАР ====================
const authMiddleware = (roles = []) => {
    return async (req, res, next) => {
        try {
            const authHeader = req.header('Authorization');
            console.log('🔐 Auth header:', authHeader ? 'present' : 'missing');
            
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                console.log('❌ Нет токена авторизации');
                return res.status(401).json({ 
                    success: false, 
                    error: 'Требуется авторизация' 
                });
            }
            
            const token = authHeader.replace('Bearer ', '');
            console.log('🔐 Токен получен, длина:', token.length);
            
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'concierge-pink-secret-2024');
            console.log('🔐 Токен расшифрован для пользователя:', decoded.email);
            
            req.user = decoded;
            
            if (roles.length > 0 && !roles.includes(decoded.role)) {
                console.log(`❌ Недостаточно прав. Роль: ${decoded.role}, требуемые: ${roles}`);
                return res.status(403).json({ 
                    success: false, 
                    error: 'Недостаточно прав' 
                });
            }
            
            next();
        } catch (error) {
            console.error('❌ Ошибка проверки токена:', error.message);
            res.status(401).json({ 
                success: false, 
                error: 'Неверный или просроченный токен' 
            });
        }
    };
};

// ==================== API МАРШРУТЫ ====================

// Главная страница
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: '🎀 Добро пожаловать в Консьерж Сервис',
        version: '4.4.0',
        status: '🟢 Работает',
        features: ['Подписки', 'Telegram Bot', 'Админ-панель', 'Мобильная адаптация'],
        telegram_bot: telegramBot ? '✅ Активен' : '⚠️ Отключен',
        timestamp: new Date().toISOString()
    });
});

// Health check
app.get('/health', async (req, res) => {
    try {
        await db.get('SELECT 1 as status');
        res.json({
            success: true,
            status: 'OK',
            timestamp: new Date().toISOString(),
            database: 'connected',
            telegram_bot: telegramBot ? 'connected' : 'disabled',
            uptime: process.uptime()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            status: 'ERROR',
            error: error.message
        });
    }
});

// ==================== АУТЕНТИФИКАЦИЯ ====================

// Регистрация
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, firstName, lastName, phone, role = 'client' } = req.body;
        
        if (!email || !password || !firstName || !lastName) {
            return res.status(400).json({
                success: false,
                error: 'Все обязательные поля должны быть заполнены'
            });
        }
        
        const existingUser = await db.get('SELECT * FROM users WHERE email = ?', [email]);
        if (existingUser) {
            return res.status(400).json({
                success: false,
                error: 'Пользователь с таким email уже существует'
            });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const result = await db.run(
            `INSERT INTO users (email, password, firstName, lastName, phone, role) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [email, hashedPassword, firstName, lastName, phone, role]
        );
        
        const user = await db.get(
            'SELECT id, email, firstName, lastName, phone, role, subscription_plan, subscription_status, created_at FROM users WHERE id = ?',
            [result.lastID]
        );
        
        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                role: user.role,
                firstName: user.firstName
            },
            process.env.JWT_SECRET || 'concierge-pink-secret-2024',
            { expiresIn: '30d' }
        );
        
        res.status(201).json({
            success: true,
            message: 'Регистрация успешна!',
            data: { user, token }
        });
        
    } catch (error) {
        console.error('Ошибка регистрации:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка регистрации'
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
        
        const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Неверный email или пароль'
            });
        }
        
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                error: 'Неверный email или пароль'
            });
        }
        
        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                role: user.role,
                firstName: user.firstName,
                subscription_plan: user.subscription_plan
            },
            process.env.JWT_SECRET || 'concierge-pink-secret-2024',
            { expiresIn: '30d' }
        );
        
        delete user.password;
        
        res.json({
            success: true,
            message: 'Вход выполнен успешно!',
            data: { user, token }
        });
        
    } catch (error) {
        console.error('Ошибка входа:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка входа'
        });
    }
});

// В функции получения профиля /api/auth/profile добавьте подписку и статистику:
app.get('/api/auth/profile', authMiddleware(), async (req, res) => {
    try {
        const user = await db.get(
            'SELECT id, email, firstName, lastName, phone, role, subscription_plan, subscription_status, subscription_expires, telegram_id, created_at FROM users WHERE id = ?',
            [req.user.id]
        );
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        // Получаем информацию о подписке
        const subscription = await db.get(
            'SELECT * FROM subscriptions WHERE name = ?',
            [user.subscription_plan || 'free']
        );
        
        // Получаем статистику задач пользователя за текущий месяц
        const currentDate = new Date();
        const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).toISOString().split('T')[0];
        
        const stats = await db.get(`
            SELECT COUNT(*) as total FROM tasks 
            WHERE client_id = ? 
            AND DATE(created_at) >= ?
        `, [req.user.id, firstDayOfMonth]);
        
        res.json({
            success: true,
            data: { 
                user,
                subscription: subscription || null,
                stats: stats || { total: 0 }
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

// ==================== УСЛУГИ ====================

// Получение всех услуг
app.get('/api/services', async (req, res) => {
    try {
        const services = await db.all('SELECT * FROM services WHERE is_active = 1 ORDER BY is_popular DESC, name ASC');
        
        res.json({
            success: true,
            data: {
                services: services || [],
                count: services ? services.length : 0
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

// Подписка на план (этот маршрут должен быть ДО /api/subscriptions)
app.post('/api/subscriptions/subscribe', authMiddleware(['client', 'admin', 'superadmin']), async (req, res) => {
    try {
        console.log('📝 Запрос на подписку:', req.body);
        
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
            return res.status(404).json({
                success: false,
                error: `План подписки "${plan}" не найден`
            });
        }
        
        // Обновляем подписку пользователя
        const expiryDate = new Date();
        if (period === 'monthly') {
            expiryDate.setMonth(expiryDate.getMonth() + 1);
        } else if (period === 'yearly') {
            expiryDate.setFullYear(expiryDate.getFullYear() + 1);
        }
        
        await db.run(
            `UPDATE users SET 
                subscription_plan = ?,
                subscription_status = 'active',
                subscription_expires = ?
             WHERE id = ?`,
            [plan, expiryDate.toISOString().split('T')[0], req.user.id]
        );
        
        // Создаем запись о платеже (демо-режим)
        const amount = period === 'monthly' ? subscriptionPlan.price_monthly : subscriptionPlan.price_yearly;
        
        // Проверяем существование таблицы payments
        try {
            await db.run(
                `INSERT INTO payments (user_id, amount, description, status, payment_method) 
                 VALUES (?, ?, ?, 'completed', 'subscription')`,
                [req.user.id, amount, `Подписка ${subscriptionPlan.name} (${period})`]
            );
        } catch (paymentError) {
            console.log('⚠️ Таблица payments не существует, пропускаем создание платежа');
        }
        
        // Создаем уведомление
        try {
            await db.run(
                `INSERT INTO notifications (user_id, title, message, type) 
                 VALUES (?, ?, ?, 'success')`,
                [req.user.id, 'Подписка оформлена', `Вы успешно оформили подписку ${subscriptionPlan.name}`, 'success']
            );
        } catch (notificationError) {
            console.log('⚠️ Таблица notifications не существует, пропускаем создание уведомления');
        }
        
        // Получаем обновленного пользователя
        const user = await db.get(
            'SELECT id, email, firstName, lastName, subscription_plan, subscription_status, subscription_expires FROM users WHERE id = ?',
            [req.user.id]
        );
        
        console.log(`✅ Подписка "${plan}" оформлена для пользователя ${user.email}`);
        
        res.json({
            success: true,
            message: `Подписка успешно оформлена!`,
            data: { 
                user,
                subscription: subscriptionPlan
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка оформления подписки:', error);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера при оформлении подписки'
        });
    }
});

// Получение всех подписок
app.get('/api/subscriptions', async (req, res) => {
    try {
        const subscriptions = await db.all(
            'SELECT * FROM subscriptions ORDER BY price_monthly ASC'
        );
        
        console.log(`📊 Загружено подписок: ${subscriptions ? subscriptions.length : 0}`);
        
        // Если нет подписок в базе, возвращаем демо-данные
        if (!subscriptions || subscriptions.length === 0) {
            console.log('📝 Возвращаем демо-подписки');
            const demoSubscriptions = [
                {
                    id: 1,
                    name: 'free',
                    description: 'Бесплатная подписка для знакомства с сервисом',
                    price_monthly: 0,
                    price_yearly: 0,
                    tasks_limit: 1,
                    features: '["1 задача в месяц", "Базовые категории", "Поддержка в чате"]',
                    is_popular: 0
                },
                {
                    id: 2,
                    name: 'basic',
                    description: 'Для регулярных бытовых задач',
                    price_monthly: 990,
                    price_yearly: 9900,
                    tasks_limit: 3,
                    features: '["3 задачи в месяц", "Все категории", "Приоритет 48ч", "Поддержка 24/7"]',
                    is_popular: 1
                },
                {
                    id: 3,
                    name: 'premium',
                    description: 'Для максимального комфорта',
                    price_monthly: 2990,
                    price_yearly: 29900,
                    tasks_limit: 10,
                    features: '["10 задач в месяц", "Все категории", "Приоритет 24ч", "Личный куратор", "Статистика"]',
                    is_popular: 0
                },
                {
                    id: 4,
                    name: 'business',
                    description: 'Для бизнеса и семьи',
                    price_monthly: 9990,
                    price_yearly: 99900,
                    tasks_limit: 999,
                    features: '["Неограниченные задачи", "Все категории", "Приоритет 12ч", "Личный менеджер", "Расширенная статистика"]',
                    is_popular: 0
                }
            ];
            
            return res.json({
                success: true,
                data: {
                    subscriptions: demoSubscriptions,
                    count: demoSubscriptions.length
                }
            });
        }
        
        res.json({
            success: true,
            data: {
                subscriptions: subscriptions || [],
                count: subscriptions ? subscriptions.length : 0
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения подписок:', error);
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
        const user = await db.get('SELECT subscription_status FROM users WHERE id = ?', [req.user.id]);
        
        if (!user || user.subscription_status !== 'active') {
            return res.status(403).json({
                success: false,
                error: 'Подписка не активна. Оформите подписку для создания задач.'
            });
        }
        
        const { title, description, category } = req.body;
        
        if (!title || !description || !category) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля'
            });
        }
        
        const taskNumber = `TASK-${Date.now().toString().slice(-8)}-${Math.floor(Math.random() * 1000)}`;
        
        const result = await db.run(
            `INSERT INTO tasks (task_number, title, description, client_id, category) 
             VALUES (?, ?, ?, ?, ?)`,
            [taskNumber, title, description, req.user.id, category]
        );
        
        const task = await db.get('SELECT * FROM tasks WHERE id = ?', [result.lastID]);
        
        res.status(201).json({
            success: true,
            message: 'Задача успешно создана!',
            data: { task }
        });
        
    } catch (error) {
        console.error('Ошибка создания задачи:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания задачи'
        });
    }
});

// Получение задач пользователя
app.get('/api/tasks', authMiddleware(), async (req, res) => {
    try {
        const userId = req.user.id;
        const tasks = await db.all(
            'SELECT * FROM tasks WHERE client_id = ? ORDER BY created_at DESC LIMIT 50',
            [userId]
        );
        
        res.json({
            success: true,
            data: {
                tasks: tasks || [],
                count: tasks ? tasks.length : 0
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

// ==================== АДМИН ПАНЕЛЬ ====================

// Статистика для админа
app.get('/api/admin/stats', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const [totalUsers, totalTasks, activeSubscriptions] = await Promise.all([
            db.get('SELECT COUNT(*) as count FROM users'),
            db.get('SELECT COUNT(*) as count FROM tasks'),
            db.get('SELECT COUNT(*) as count FROM users WHERE subscription_status = "active"')
        ]);

        const recentTasks = await db.all(`
            SELECT t.*, u.firstName, u.lastName 
            FROM tasks t 
            LEFT JOIN users u ON t.client_id = u.id 
            ORDER BY t.created_at DESC 
            LIMIT 10
        `);
        
        res.json({
            success: true,
            data: {
                summary: {
                    totalUsers: totalUsers ? totalUsers.count : 0,
                    totalTasks: totalTasks ? totalTasks.count : 0,
                    activeSubscriptions: activeSubscriptions ? activeSubscriptions.count : 0
                },
                recentTasks: recentTasks || []
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

// ==================== СИСТЕМА ====================

// Информация о системе
app.get('/api/system/info', async (req, res) => {
    try {
        const [servicesCount, tasksCount, usersCount] = await Promise.all([
            db.get('SELECT COUNT(*) as count FROM services WHERE is_active = 1'),
            db.get('SELECT COUNT(*) as count FROM tasks'),
            db.get('SELECT COUNT(*) as count FROM users')
        ]);
        
        res.json({
            success: true,
            data: {
                services: servicesCount ? servicesCount.count : 0,
                tasks: tasksCount ? tasksCount.count : 0,
                users: usersCount ? usersCount.count : 0,
                version: '4.4.0',
                telegramBot: telegramBot ? 'active' : 'inactive',
                nodeVersion: process.version,
                platform: process.platform,
                memory: {
                    rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`,
                    heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)} MB`,
                    heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`
                }
            }
        });
        
    } catch (error) {
        res.json({
            success: true,
            data: {
                version: '4.4.0',
                status: 'running',
                error: error.message
            }
        });
    }
});

// Простая админ-панель
app.get('/admin', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Консьерж Сервис - Админ Панель</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    margin: 0;
                    padding: 20px;
                    background: linear-gradient(135deg, #f9c5d1 0%, #f5a3b7 100%);
                    min-height: 100vh;
                }
                .container {
                    max-width: 1200px;
                    margin: 0 auto;
                    background: white;
                    padding: 30px;
                    border-radius: 20px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.1);
                }
                h1 {
                    color: #ff4081;
                    text-align: center;
                    margin-bottom: 30px;
                }
                .stats {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 20px;
                    margin-bottom: 30px;
                }
                .stat-card {
                    background: linear-gradient(135deg, #ff6b8b 0%, #ff4081 100%);
                    color: white;
                    padding: 20px;
                    border-radius: 15px;
                    text-align: center;
                }
                .stat-card h3 {
                    margin: 0 0 10px 0;
                    font-size: 16px;
                    opacity: 0.9;
                }
                .stat-card .value {
                    font-size: 28px;
                    font-weight: bold;
                }
                .section {
                    margin: 30px 0;
                    padding: 20px;
                    background: #f8f9fa;
                    border-radius: 15px;
                }
                .btn {
                    background: #ff4081;
                    color: white;
                    border: none;
                    padding: 12px 24px;
                    border-radius: 10px;
                    cursor: pointer;
                    font-size: 16px;
                    transition: all 0.3s;
                    text-decoration: none;
                    display: inline-block;
                }
                .btn:hover {
                    background: #e91e63;
                    transform: translateY(-2px);
                }
                .api-list {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                    gap: 15px;
                    margin-top: 20px;
                }
                .api-item {
                    background: white;
                    padding: 15px;
                    border-radius: 10px;
                    border-left: 4px solid #ff4081;
                }
                .method {
                    display: inline-block;
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-weight: bold;
                    font-size: 12px;
                    margin-right: 10px;
                }
                .method.get { background: #4CAF50; color: white; }
                .method.post { background: #2196F3; color: white; }
                .endpoint {
                    font-family: monospace;
                    color: #333;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🎀 Консьерж Сервис - Админ Панель v4.4.0</h1>
                
                <div class="stats" id="stats">
                    <div class="stat-card">
                        <h3>Пользователи</h3>
                        <div class="value" id="users-count">0</div>
                    </div>
                    <div class="stat-card">
                        <h3>Задачи</h3>
                        <div class="value" id="tasks-count">0</div>
                    </div>
                    <div class="stat-card">
                        <h3>Активные подписки</h3>
                        <div class="value" id="subs-count">0</div>
                    </div>
                    <div class="stat-card">
                        <h3>Telegram Bot</h3>
                        <div class="value" id="bot-status">❓</div>
                    </div>
                </div>
                
                <div style="text-align: center; margin: 30px 0;">
                    <a href="/" class="btn" target="_blank">Главная страница API</a>
                    <a href="/health" class="btn" target="_blank">Health Check</a>
                    <button class="btn" onclick="refreshStats()">Обновить статистику</button>
                </div>
                
                <div class="section">
                    <h2>📊 Статистика системы</h2>
                    <div id="system-info">Загрузка...</div>
                </div>
                
                <div class="section">
                    <h2>🔧 Доступные API endpoints</h2>
                    <div class="api-list">
                        <div class="api-item">
                            <span class="method get">GET</span>
                            <span class="endpoint">/</span>
                            <p>Главная страница API</p>
                        </div>
                        <div class="api-item">
                            <span class="method get">GET</span>
                            <span class="endpoint">/health</span>
                            <p>Проверка здоровья системы</p>
                        </div>
                        <div class="api-item">
                            <span class="method post">POST</span>
                            <span class="endpoint">/api/auth/register</span>
                            <p>Регистрация пользователя</p>
                        </div>
                        <div class="api-item">
                            <span class="method post">POST</span>
                            <span class="endpoint">/api/auth/login</span>
                            <p>Вход в систему</p>
                        </div>
                        <div class="api-item">
                            <span class="method get">GET</span>
                            <span class="endpoint">/api/subscriptions</span>
                            <p>Получение списка подписок</p>
                        </div>
                        <div class="api-item">
                            <span class="method get">GET</span>
                            <span class="endpoint">/api/services</span>
                            <p>Получение списка услуг</p>
                        </div>
                        <div class="api-item">
                            <span class="method get">GET</span>
                            <span class="endpoint">/api/system/info</span>
                            <p>Информация о системе</p>
                        </div>
                    </div>
                </div>
                
                <div class="section">
                    <h2>🔑 Тестовые аккаунты</h2>
                    <div style="background: white; padding: 15px; border-radius: 10px;">
                        <p><strong>👑 Суперадмин:</strong> superadmin@concierge.com / admin123</p>
                        <p><strong>👩‍💼 Админ:</strong> admin@concierge.com / admin123</p>
                        <p><strong>👩 Клиент:</strong> maria@example.com / client123</p>
                        <p><strong>👨‍🏫 Исполнитель:</strong> elena@performer.com / performer123</p>
                        <p><strong>🎯 Демо:</strong> test@example.com / test123</p>
                    </div>
                </div>
            </div>
            
            <script>
                async function loadStats() {
                    try {
                        // Загружаем статистику
                        const statsResponse = await fetch('/api/admin/stats');
                        const statsData = await statsResponse.json();
                        
                        if (statsData.success) {
                            document.getElementById('users-count').textContent = statsData.data.summary.totalUsers;
                            document.getElementById('tasks-count').textContent = statsData.data.summary.totalTasks;
                            document.getElementById('subs-count').textContent = statsData.data.summary.activeSubscriptions;
                        }
                        
                        // Загружаем информацию о системе
                        const systemResponse = await fetch('/api/system/info');
                        const systemData = await systemResponse.json();
                        
                        if (systemData.success) {
                            document.getElementById('bot-status').textContent = 
                                systemData.data.telegramBot === 'active' ? '✅' : '⚠️';
                            
                            document.getElementById('system-info').innerHTML = \`
                                <div style="background: white; padding: 15px; border-radius: 10px;">
                                    <p><strong>Версия:</strong> \${systemData.data.version}</p>
                                    <p><strong>Node.js:</strong> \${systemData.data.nodeVersion}</p>
                                    <p><strong>Платформа:</strong> \${systemData.data.platform}</p>
                                    <p><strong>Память:</strong> \${systemData.data.memory.heapUsed} из \${systemData.data.memory.heapTotal}</p>
                                    <p><strong>Услуг в базе:</strong> \${systemData.data.services}</p>
                                    <p><strong>Задач в базе:</strong> \${systemData.data.tasks}</p>
                                    <p><strong>Пользователей:</strong> \${systemData.data.users}</p>
                                </div>
                            \`;
                        }
                    } catch (error) {
                        console.error('Ошибка загрузки статистики:', error);
                        document.getElementById('system-info').innerHTML = 
                            '<div style="color: red;">Ошибка загрузки данных</div>';
                    }
                }
                
                function refreshStats() {
                    document.getElementById('stats').innerHTML = '<div style="text-align: center;">Загрузка...</div>';
                    document.getElementById('system-info').innerHTML = 'Загрузка...';
                    loadStats();
                }
                
                // Загружаем данные при загрузке страницы
                document.addEventListener('DOMContentLoaded', loadStats);
                
                // Обновляем каждые 30 секунд
                setInterval(loadStats, 30000);
            </script>
        </body>
        </html>
    `);
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎀 ЗАПУСК КОНСЬЕРЖ СЕРВИСА v4.4.2');
        console.log('='.repeat(80));
        console.log(`🌐 PORT: ${process.env.PORT || 3000}`);
        console.log(`🏷️  NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🤖 TELEGRAM_BOT: ${process.env.TELEGRAM_BOT_TOKEN ? 'configured' : 'not configured'}`);
        console.log(`🔐 JWT_SECRET: ${process.env.JWT_SECRET ? 'configured' : 'using default'}`);
        
        // Инициализируем базу данных
        await initDatabase();
        console.log('✅ База данных готова');
        
        // Проверяем существующие маршруты
        console.log('\n📡 Доступные API endpoints:');
        console.log('  POST /api/subscriptions/subscribe - Оформление подписки');
        console.log('  GET  /api/subscriptions          - Получить все подписки');
        console.log('  POST /api/auth/register          - Регистрация');
        console.log('  POST /api/auth/login             - Вход');
        console.log('  GET  /api/auth/profile           - Профиль пользователя');
        console.log('  POST /api/tasks                  - Создать задачу');
        console.log('  GET  /api/tasks                  - Получить задачи');
        console.log('  GET  /api/services               - Получить услуги');
        
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
            
            console.log('\n🔑 Тестовые аккаунты для входа:');
            console.log('👑 Суперадмин: superadmin@concierge.com / admin123');
            console.log('👩‍💼 Админ: admin@concierge.com / admin123');
            console.log('👩 Клиент: maria@example.com / client123');
            console.log('👨‍🏫 Исполнитель: elena@performer.com / performer123');
            console.log('🎯 Демо: test@example.com / test123');
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
            telegramBot.stopPolling && telegramBot.stopPolling();
            console.log('🤖 Telegram Bot остановлен');
        } catch (e) {
            console.log('⚠️ Ошибка остановки бота:', e.message);
        }
    }
    if (db) {
        await db.close();
        console.log('🗃️ База данных закрыта');
    }
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
