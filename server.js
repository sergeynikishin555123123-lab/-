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
    console.log('✅ Telegram Bot модуль загружен');
} catch (error) {
    console.log('⚠️ Telegram Bot не установлен, используйте: npm install node-telegram-bot-api');
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
        
        // Создаем директорию для базы данных если её нет
        const dbDir = path.join(__dirname);
        console.log(`📁 Текущая директория: ${dbDir}`);
        
        // Используем базу в текущей директории
        const dbPath = path.join(dbDir, 'concierge.db');
        console.log(`📁 Путь к базе данных: ${dbPath}`);
        
        // Проверяем существует ли файл базы данных
        const dbExists = fs.existsSync(dbPath);
        
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
        
        // Создаем тестовые данные только если база новая
        if (!dbExists) {
            await createTestData();
        }
        
        return db;
    } catch (error) {
        console.error('❌ Ошибка инициализации базы данных:', error.message);
        console.error('💡 Попробуйте удалить файл concierge.db и перезапустить сервер');
        throw error;
    }
};

// ==================== СОЗДАНИЕ ТЕСТОВЫХ ДАННЫХ ====================
const createTestData = async () => {
    try {
        console.log('📝 Создание тестовых данных...');
        
        // Тестовые пользователи
        const users = [
            ['superadmin@concierge.com', await bcrypt.hash('admin123', 10), 'Супер', 'Администратор', '+79999999999', 'superadmin', 'business', 'active', '2025-12-31', null],
            ['admin@concierge.com', await bcrypt.hash('admin123', 10), 'Анна', 'Администратор', '+79998887766', 'admin', 'premium', 'active', '2025-06-30', null],
            ['maria@example.com', await bcrypt.hash('client123', 10), 'Мария', 'Иванова', '+79997776655', 'client', 'basic', 'active', '2025-03-31', null],
            ['elena@performer.com', await bcrypt.hash('performer123', 10), 'Елена', 'Смирнова', '+79994443322', 'performer', 'premium', 'active', '2025-06-30', null],
            ['test@example.com', await bcrypt.hash('test123', 10), 'Демо', 'Пользователь', '+79993332211', 'client', 'free', 'inactive', null, null]
        ];

        for (const user of users) {
            await db.run(
                `INSERT OR IGNORE INTO users (email, password, firstName, lastName, phone, role, subscription_plan, subscription_status, subscription_expires, telegram_id) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                user
            );
        }

        console.log('✅ Тестовые пользователи созданы');

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
        
    } catch (error) {
        console.error('⚠️ Ошибка создания тестовых данных:', error.message);
    }
};

// ==================== ИНИЦИАЛИЗАЦИЯ TELEGRAM BOT ====================
const initTelegramBot = () => {
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '7196229933:AAE_M18KDQWdhhsvuUlA-wbGpFIEwC75pzE';
    
    if (TelegramBot && TELEGRAM_BOT_TOKEN && TELEGRAM_BOT_TOKEN !== 'YOUR_BOT_TOKEN_HERE') {
        try {
            telegramBot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
            
            telegramBot.onText(/\/start/, (msg) => {
                const chatId = msg.chat.id;
                const welcomeMessage = `🎀 Добро пожаловать в Консьерж Сервис!\n\n` +
                    `Я ваш персональный помощник в бытовых вопросах.\n\n` +
                    `Доступные команды:\n` +
                    `/start - Начало работы\n` +
                    `/help - Помощь\n` +
                    `/status - Статус сервиса\n` +
                    `/admin - Связь с администратором\n` +
                    `/subscribe - Информация о подписках`;
                
                telegramBot.sendMessage(chatId, welcomeMessage);
            });
            
            telegramBot.onText(/\/admin/, (msg) => {
                const chatId = msg.chat.id;
                const adminMessage = `👑 Администрация Консьерж Сервиса\n\n` +
                    `📞 Телефон: +7 (999) 123-45-67\n` +
                    `📧 Email: admin@concierge-service.ru\n` +
                    `🕐 Время работы: 9:00 - 21:00\n\n` +
                    `Мы всегда рады помочь!`;
                
                telegramBot.sendMessage(chatId, adminMessage);
            });
            
            telegramBot.onText(/\/help/, (msg) => {
                const chatId = msg.chat.id;
                const helpMessage = `🆘 Помощь по Консьерж Сервису\n\n` +
                    `📋 Как работает сервис:\n` +
                    `1. Выбираете подписку\n` +
                    `2. Создаете задачи\n` +
                    `3. Исполнители помогают\n\n` +
                    `🎟️ Подписки:\n` +
                    `• Базовая: 3 задачи в месяц\n` +
                    `• Премиум: 10 задач + приоритет\n` +
                    `• Бизнес: неограниченно + личный менеджер\n\n` +
                    `💬 Вопросы: @concierge_support`;
                
                telegramBot.sendMessage(chatId, helpMessage);
            });
            
            telegramBot.onText(/\/status/, (msg) => {
                const chatId = msg.chat.id;
                const statusMessage = `📊 Статус системы:\n\n` +
                    `✅ Веб-сайт: Работает\n` +
                    `✅ База данных: Активна\n` +
                    `✅ API: Доступен\n` +
                    `✅ Подписки: Активны\n\n` +
                    `🔄 Последнее обновление: ${new Date().toLocaleString('ru-RU')}`;
                
                telegramBot.sendMessage(chatId, statusMessage);
            });
            
            telegramBot.onText(/\/subscribe/, (msg) => {
                const chatId = msg.chat.id;
                const subscribeMessage = `💖 Подписки Консьерж Сервиса\n\n` +
                    `🎗️ БАЗОВАЯ - 990₽/мес\n` +
                    `• 3 задачи в месяц\n` +
                    `• Базовые категории\n` +
                    `• Поддержка 24/7\n\n` +
                    `👑 ПРЕМИУМ - 2 990₽/мес\n` +
                    `• 10 задач в месяц\n` +
                    `• Все категории\n` +
                    `• Приоритетное выполнение\n` +
                    `• Личный куратор\n\n` +
                    `🏢 БИЗНЕС - 9 990₽/мес\n` +
                    `• Неограниченные задачи\n` +
                    `• Все категории + эксклюзив\n` +
                    `• Личный менеджер\n` +
                    `• Статистика и отчеты\n\n` +
                    `💳 Для оформления: https://concierge-service.ru/subscribe`;
                
                telegramBot.sendMessage(chatId, subscribeMessage);
            });
            
            console.log('🤖 Telegram Bot запущен');
            return true;
        } catch (error) {
            console.warn('⚠️ Telegram Bot не запущен:', error.message);
            return false;
        }
    } else {
        console.log('🤖 Telegram Bot: Токен не указан или стандартный');
        return false;
    }
};

// ==================== JWT МИДЛВАР ====================
const authMiddleware = (roles = []) => {
    return async (req, res, next) => {
        try {
            const token = req.header('Authorization')?.replace('Bearer ', '');
            
            if (!token) {
                return res.status(401).json({ 
                    success: false, 
                    error: 'Требуется авторизация' 
                });
            }
            
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'concierge-pink-secret-2024');
            req.user = decoded;
            
            if (roles.length > 0 && !roles.includes(decoded.role)) {
                return res.status(403).json({ 
                    success: false, 
                    error: 'Недостаточно прав' 
                });
            }
            
            next();
        } catch (error) {
            res.status(401).json({ 
                success: false, 
                error: 'Неверный токен' 
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
        version: '4.3.0',
        status: '🟢 Работает',
        features: ['Подписки', 'Telegram Bot', 'Админ-панель', 'Мобильная адаптация'],
        telegram_bot: telegramBot ? '✅ Активен' : '⚠️ Отключен'
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
            telegram_bot: telegramBot ? 'connected' : 'disabled'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            status: 'ERROR'
        });
    }
});

// ==================== АУТЕНТИФИКАЦИЯ ====================

// Регистрация
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, firstName, lastName, phone, role = 'client', telegram_id } = req.body;
        
        // Проверяем существует ли пользователь
        const existingUser = await db.get('SELECT * FROM users WHERE email = ?', [email]);
        if (existingUser) {
            return res.status(400).json({
                success: false,
                error: 'Пользователь с таким email уже существует'
            });
        }
        
        // Хешируем пароль
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Создаем пользователя
        const result = await db.run(
            `INSERT INTO users (email, password, firstName, lastName, phone, role, telegram_id) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [email, hashedPassword, firstName, lastName, phone, role, telegram_id]
        );
        
        // Получаем созданного пользователя
        const user = await db.get('SELECT * FROM users WHERE id = ?', [result.lastID]);
        
        // Создаем приветственное уведомление
        await db.run(
            `INSERT INTO notifications (user_id, title, message, type) 
             VALUES (?, ?, ?, ?)`,
            [user.id, '🎀 Добро пожаловать!', 'Вы успешно зарегистрировались в Консьерж Сервисе. Оформите подписку для создания задач.', 'info']
        );
        
        // Генерируем токен
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
        
        // Не возвращаем пароль
        delete user.password;
        
        // Отправляем уведомление в Telegram если есть ID и бот активен
        if (telegram_id && telegramBot) {
            try {
                telegramBot.sendMessage(telegram_id, 
                    `🎉 Добро пожаловать в Консьерж Сервис, ${firstName}!\n\n` +
                    `Ваш аккаунт успешно создан.\n` +
                    `Для начала работы оформите подписку.\n\n` +
                    `Используйте команду /subscribe для информации о подписках`
                );
            } catch (tgError) {
                console.log('⚠️ Не удалось отправить сообщение в Telegram:', tgError.message);
            }
        }
        
        res.status(201).json({
            success: true,
            message: 'Регистрация успешна!',
            data: {
                user,
                token
            }
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
        
        // Находим пользователя
        const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
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
        
        // Генерируем токен
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
        
        // Не возвращаем пароль
        delete user.password;
        
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
            error: 'Ошибка входа'
        });
    }
});

// Получение профиля
app.get('/api/auth/profile', authMiddleware(), async (req, res) => {
    try {
        const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        // Не возвращаем пароль
        delete user.password;
        
        // Получаем активную подписку
        const subscription = await db.get('SELECT * FROM subscriptions WHERE name = ?', [user.subscription_plan]);
        
        // Получаем статистику задач за месяц
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        
        const tasksStats = await db.get(
            `SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress
             FROM tasks 
             WHERE client_id = ? 
             AND created_at >= ?`,
            [req.user.id, startOfMonth.toISOString()]
        );
        
        res.json({
            success: true,
            data: { 
                user,
                subscription: subscription || null,
                stats: tasksStats || { total: 0, completed: 0, in_progress: 0 }
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

// ==================== ПОДПИСКИ ====================

// Получение всех подписок
app.get('/api/subscriptions', async (req, res) => {
    try {
        const subscriptions = await db.all('SELECT * FROM subscriptions ORDER BY price_monthly ASC');
        
        res.json({
            success: true,
            data: {
                subscriptions: subscriptions || [],
                count: subscriptions ? subscriptions.length : 0
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

// Оформление подписки
app.post('/api/subscriptions/subscribe', authMiddleware(['client', 'performer']), async (req, res) => {
    try {
        const { plan, period = 'monthly' } = req.body;
        
        // Проверяем существование плана
        const subscription = await db.get('SELECT * FROM subscriptions WHERE name = ?', [plan]);
        if (!subscription) {
            return res.status(404).json({
                success: false,
                error: 'План подписки не найден'
            });
        }
        
        // Рассчитываем дату окончания
        const expires = new Date();
        if (period === 'monthly') {
            expires.setMonth(expires.getMonth() + 1);
        } else if (period === 'yearly') {
            expires.setFullYear(expires.getFullYear() + 1);
        }
        
        // Обновляем подписку пользователя
        await db.run(
            `UPDATE users 
             SET subscription_plan = ?, 
                 subscription_status = 'active', 
                 subscription_expires = ?
             WHERE id = ?`,
            [plan, expires.toISOString().split('T')[0], req.user.id]
        );
        
        // Создаем платежную запись
        const amount = period === 'monthly' ? subscription.price_monthly : subscription.price_yearly;
        await db.run(
            `INSERT INTO payments (user_id, amount, description, status, payment_method) 
             VALUES (?, ?, ?, ?, ?)`,
            [req.user.id, amount, `Подписка ${subscription.name} (${period})`, 'completed', 'subscription']
        );
        
        // Создаем уведомление
        await db.run(
            `INSERT INTO notifications (user_id, title, message, type) 
             VALUES (?, ?, ?, ?)`,
            [req.user.id, '🎟️ Подписка оформлена!', `Вы успешно оформили подписку ${subscription.name}. Теперь вы можете создавать задачи.`, 'success']
        );
        
        // Отправляем в Telegram если есть бот и ID пользователя
        const user = await db.get('SELECT telegram_id FROM users WHERE id = ?', [req.user.id]);
        if (user && user.telegram_id && telegramBot) {
            try {
                telegramBot.sendMessage(user.telegram_id,
                    `🎟️ Подписка оформлена!\n\n` +
                    `План: ${subscription.name}\n` +
                    `Период: ${period === 'monthly' ? 'месяц' : 'год'}\n` +
                    `Сумма: ${amount}₽\n` +
                    `Действует до: ${expires.toLocaleDateString('ru-RU')}\n\n` +
                    `Теперь вы можете создавать задачи!`
                );
            } catch (tgError) {
                console.log('⚠️ Не удалось отправить уведомление в Telegram');
            }
        }
        
        res.json({
            success: true,
            message: 'Подписка успешно оформлена!',
            data: {
                subscription,
                expires: expires.toISOString().split('T')[0]
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

// ==================== УСЛУГИ ====================

// Получение всех услуг
app.get('/api/services', async (req, res) => {
    try {
        const { category, limit = 20 } = req.query;
        
        let query = 'SELECT * FROM services WHERE is_active = 1';
        const params = [];
        
        if (category && category !== 'all') {
            query += ' AND category = ?';
            params.push(category);
        }
        
        query += ' ORDER BY is_popular DESC, name ASC LIMIT ?';
        params.push(parseInt(limit));
        
        const services = await db.all(query, params);
        
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

// Получение категорий
app.get('/api/services/categories', async (req, res) => {
    try {
        const categories = await db.all(`
            SELECT category, COUNT(*) as count 
            FROM services 
            WHERE is_active = 1 
            GROUP BY category
        `);
        
        const categoryNames = {
            'home_and_household': { name: 'Дом и быт', icon: '🏠', color: '#FF6B8B' },
            'family_and_children': { name: 'Дети и семья', icon: '👨‍👩‍👧‍👦', color: '#7C3AED' },
            'beauty_and_health': { name: 'Красота и здоровье', icon: '💅', color: '#EC4899' },
            'courses_and_education': { name: 'Курсы и образование', icon: '🎓', color: '#8B5CF6' },
            'pets': { name: 'Питомцы', icon: '🐶', color: '#F59E0B' },
            'events_and_entertainment': { name: 'Мероприятия', icon: '🎉', color: '#10B981' }
        };
        
        const result = categories.map(cat => ({
            id: cat.category,
            name: categoryNames[cat.category]?.name || cat.category,
            icon: categoryNames[cat.category]?.icon || '✨',
            color: categoryNames[cat.category]?.color || '#7C3AED',
            count: cat.count || 0
        }));
        
        res.json({
            success: true,
            data: result
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
        const user = await db.get('SELECT subscription_status, subscription_plan FROM users WHERE id = ?', [req.user.id]);
        
        // Проверяем подписку
        if (!user || user.subscription_status !== 'active') {
            return res.status(403).json({
                success: false,
                error: 'Подписка не активна. Оформите подписку для создания задач.'
            });
        }
        
        const { title, description, category, deadline, address, priority = 'medium' } = req.body;
        
        // Генерируем номер задачи
        const generateTaskNumber = () => {
            const date = new Date();
            const year = date.getFullYear().toString().slice(-2);
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const day = date.getDate().toString().padStart(2, '0');
            const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
            return `TASK-${year}${month}${day}-${random}`;
        };
        
        const taskNumber = generateTaskNumber();
        
        // Создаем задачу
        const result = await db.run(
            `INSERT INTO tasks (task_number, title, description, client_id, category, priority, address, deadline) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [taskNumber, title, description, req.user.id, category, priority, address, deadline]
        );
        
        // Получаем созданную задачу
        const task = await db.get('SELECT * FROM tasks WHERE id = ?', [result.lastID]);
        
        // Создаем уведомление
        await db.run(
            `INSERT INTO notifications (user_id, title, message, type) 
             VALUES (?, ?, ?, ?)`,
            [req.user.id, '📋 Новая задача создана!', `Задача "${title}" создана. Мы ищем исполнителя.`, 'info']
        );
        
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
        const { status, limit = 50, page = 1 } = req.query;
        const userId = req.user.id;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        
        let query = 'SELECT * FROM tasks WHERE client_id = ?';
        const params = [userId];
        
        if (status && status !== 'all') {
            query += ' AND status = ?';
            params.push(status);
        }
        
        // Получаем общее количество
        const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as count');
        const countResult = await db.get(countQuery, params);
        const total = countResult ? countResult.count : 0;
        
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), offset);
        
        const tasks = await db.all(query, params);
        
        res.json({
            success: true,
            data: {
                tasks: tasks || [],
                pagination: {
                    total: total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    pages: Math.ceil(total / parseInt(limit))
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

// ==================== УВЕДОМЛЕНИЯ ====================

// Получение уведомлений
app.get('/api/notifications', authMiddleware(), async (req, res) => {
    try {
        const { limit = 20, unread_only = false } = req.query;
        
        let query = 'SELECT * FROM notifications WHERE user_id = ?';
        const params = [req.user.id];
        
        if (unread_only === 'true') {
            query += ' AND is_read = 0';
        }
        
        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(parseInt(limit));
        
        const notifications = await db.all(query, params);
        
        // Получаем количество непрочитанных
        const unreadCount = await db.get(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
            [req.user.id]
        );
        
        res.json({
            success: true,
            data: {
                notifications: notifications || [],
                unreadCount: unreadCount ? unreadCount.count : 0
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
        const { notification_ids } = req.body;
        
        if (notification_ids && notification_ids.length > 0) {
            await db.run(
                `UPDATE notifications SET is_read = 1 WHERE id IN (${notification_ids.map(() => '?').join(',')}) AND user_id = ?`,
                [...notification_ids, req.user.id]
            );
        } else {
            // Пометить все как прочитанные
            await db.run(
                'UPDATE notifications SET is_read = 1 WHERE user_id = ?',
                [req.user.id]
            );
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

// Статистика для админа
app.get('/api/admin/stats', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const [totalUsers, totalTasks, totalRevenue, monthlyRevenue] = await Promise.all([
            db.get('SELECT COUNT(*) as count FROM users'),
            db.get('SELECT COUNT(*) as count FROM tasks'),
            db.get('SELECT SUM(amount) as total FROM payments WHERE status = "completed"'),
            db.get(`SELECT SUM(amount) as total FROM payments WHERE status = "completed" AND created_at >= date('now', 'start of month')`)
        ]);

        // Последние задачи
        const recentTasks = await db.all(`
            SELECT t.*, u.firstName, u.lastName 
            FROM tasks t 
            LEFT JOIN users u ON t.client_id = u.id 
            ORDER BY t.created_at DESC 
            LIMIT 10
        `);
        
        // Статистика по подпискам
        const subscriptionStats = await db.all(`
            SELECT subscription_plan, COUNT(*) as count 
            FROM users 
            WHERE subscription_status = 'active' 
            GROUP BY subscription_plan
        `);
        
        res.json({
            success: true,
            data: {
                summary: {
                    totalUsers: totalUsers ? totalUsers.count : 0,
                    totalTasks: totalTasks ? totalTasks.count : 0,
                    totalRevenue: totalRevenue ? totalRevenue.total : 0,
                    monthlyRevenue: monthlyRevenue ? monthlyRevenue.total : 0
                },
                subscriptionStats: subscriptionStats || [],
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

// Получение всех пользователей (админ)
app.get('/api/admin/users', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const { role, search, limit = 50, page = 1 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        
        let query = 'SELECT id, email, firstName, lastName, phone, role, subscription_plan, subscription_status, subscription_expires, telegram_id, created_at FROM users WHERE 1=1';
        const params = [];
        
        if (role && role !== 'all') {
            query += ' AND role = ?';
            params.push(role);
        }
        
        if (search) {
            query += ' AND (email LIKE ? OR firstName LIKE ? OR lastName LIKE ? OR phone LIKE ?)';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }
        
        // Получаем общее количество
        const countQuery = query.replace('SELECT id, email, firstName, lastName, phone, role, subscription_plan, subscription_status, subscription_expires, telegram_id, created_at', 'SELECT COUNT(*) as count');
        const countResult = await db.get(countQuery, params);
        const total = countResult ? countResult.count : 0;
        
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), offset);
        
        const users = await db.all(query, params);
        
        res.json({
            success: true,
            data: {
                users: users || [],
                pagination: {
                    total: total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    pages: Math.ceil(total / parseInt(limit))
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

// Получение всех задач (админ)
app.get('/api/admin/tasks', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const { status, limit = 50, page = 1 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        
        let query = `
            SELECT t.*, 
                   u1.firstName as client_firstName, 
                   u1.lastName as client_lastName,
                   u2.firstName as performer_firstName, 
                   u2.lastName as performer_lastName
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
        
        // Получаем общее количество
        const countQuery = query.replace('SELECT t.*, u1.firstName as client_firstName, u1.lastName as client_lastName, u2.firstName as performer_firstName, u2.lastName as performer_lastName', 'SELECT COUNT(*) as count');
        const countResult = await db.get(countQuery, params);
        const total = countResult ? countResult.count : 0;
        
        query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), offset);
        
        const tasks = await db.all(query, params);
        
        res.json({
            success: true,
            data: {
                tasks: tasks || [],
                pagination: {
                    total: total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    pages: Math.ceil(total / parseInt(limit))
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

// Обновление статуса задачи (админ)
app.put('/api/admin/tasks/:id/status', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const { id } = req.params;
        const { status, performer_id } = req.body;
        
        const task = await db.get('SELECT * FROM tasks WHERE id = ?', [id]);
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        // Обновляем статус задачи
        await db.run(
            'UPDATE tasks SET status = ?, performer_id = ? WHERE id = ?',
            [status, performer_id || null, id]
        );
        
        // Создаем уведомление для клиента
        await db.run(
            `INSERT INTO notifications (user_id, title, message, type) 
             VALUES (?, ?, ?, ?)`,
            [task.client_id, '📋 Статус задачи обновлен!', `Статус задачи "${task.title}" изменен на "${status}".`, 'info']
        );
        
        res.json({
            success: true,
            message: 'Статус задачи обновлен'
        });
        
    } catch (error) {
        console.error('Ошибка обновления задачи:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления задачи'
        });
    }
});

// ==================== ОБЩИЕ МАРШРУТЫ ====================

// Получение информации о системе
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
                version: '4.3.0',
                telegramBot: telegramBot ? 'active' : 'inactive',
                uptime: process.uptime(),
                memory: process.memoryUsage()
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения информации о системе:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения информации о системе'
        });
    }
});

// HTML админ-панель
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
                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                    gap: 20px;
                    margin-bottom: 40px;
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
                    font-size: 18px;
                }
                .stat-card .value {
                    font-size: 32px;
                    font-weight: bold;
                }
                .section {
                    margin-bottom: 40px;
                    padding: 20px;
                    background: #f9f9f9;
                    border-radius: 15px;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 15px;
                }
                th, td {
                    padding: 12px;
                    text-align: left;
                    border-bottom: 1px solid #ddd;
                }
                th {
                    background: #ff4081;
                    color: white;
                }
                tr:hover {
                    background: #fff0f5;
                }
                .status-badge {
                    padding: 5px 10px;
                    border-radius: 20px;
                    font-size: 12px;
                    font-weight: bold;
                }
                .status-new { background: #ffd700; color: #000; }
                .status-in_progress { background: #4169e1; color: white; }
                .status-completed { background: #32cd32; color: white; }
                .search-box {
                    margin: 20px 0;
                    padding: 10px;
                    width: 100%;
                    border: 2px solid #ff4081;
                    border-radius: 10px;
                    font-size: 16px;
                }
                .btn {
                    background: #ff4081;
                    color: white;
                    border: none;
                    padding: 10px 20px;
                    border-radius: 10px;
                    cursor: pointer;
                    font-size: 16px;
                    transition: all 0.3s;
                }
                .btn:hover {
                    background: #e91e63;
                    transform: translateY(-2px);
                    box-shadow: 0 5px 15px rgba(255, 64, 129, 0.3);
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🎀 Админ Панель Консьерж Сервиса</h1>
                
                <div class="stats-grid" id="stats">
                    <!-- Статистика загрузится через JavaScript -->
                </div>
                
                <div class="section">
                    <h2>📊 Последние задачи</h2>
                    <div id="recent-tasks">Загрузка...</div>
                </div>
                
                <div class="section">
                    <h2>👥 Пользователи</h2>
                    <input type="text" class="search-box" placeholder="Поиск пользователей..." onkeyup="searchUsers(this.value)">
                    <div id="users-list">Загрузка...</div>
                </div>
                
                <div class="section">
                    <h2>📋 Все задачи</h2>
                    <div id="all-tasks">Загрузка...</div>
                </div>
            </div>
            
            <script>
                let token = '';
                
                // Функция для обновления статистики
                async function loadStats() {
                    try {
                        const response = await fetch('/api/admin/stats', {
                            headers: token ? { 'Authorization': 'Bearer ' + token } : {}
                        });
                        const data = await response.json();
                        
                        if (data.success) {
                            const stats = data.data.summary;
                            document.getElementById('stats').innerHTML = \`
                                <div class="stat-card">
                                    <h3>👥 Пользователи</h3>
                                    <div class="value">\${stats.totalUsers}</div>
                                </div>
                                <div class="stat-card">
                                    <h3>📋 Задачи</h3>
                                    <div class="value">\${stats.totalTasks}</div>
                                </div>
                                <div class="stat-card">
                                    <h3>💰 Общая выручка</h3>
                                    <div class="value">\${stats.totalRevenue ? stats.totalRevenue.toFixed(2) : 0}₽</div>
                                </div>
                                <div class="stat-card">
                                    <h3>💰 За месяц</h3>
                                    <div class="value">\${stats.monthlyRevenue ? stats.monthlyRevenue.toFixed(2) : 0}₽</div>
                                </div>
                            \`;
                        }
                    } catch (error) {
                        console.error('Ошибка загрузки статистики:', error);
                    }
                }
                
                // Функция для поиска пользователей
                async function searchUsers(query) {
                    try {
                        const response = await fetch(\`/api/admin/users?search=\${query}\`, {
                            headers: token ? { 'Authorization': 'Bearer ' + token } : {}
                        });
                        const data = await response.json();
                        
                        if (data.success) {
                            let html = '<table>';
                            html += '<tr><th>ID</th><th>Имя</th><th>Email</th><th>Роль</th><th>Подписка</th><th>Дата регистрации</th></tr>';
                            
                            data.data.users.forEach(user => {
                                html += \`
                                    <tr>
                                        <td>\${user.id}</td>
                                        <td>\${user.firstName} \${user.lastName}</td>
                                        <td>\${user.email}</td>
                                        <td>\${user.role}</td>
                                        <td>\${user.subscription_plan} (\${user.subscription_status})</td>
                                        <td>\${new Date(user.created_at).toLocaleDateString('ru-RU')}</td>
                                    </tr>
                                \`;
                            });
                            
                            html += '</table>';
                            document.getElementById('users-list').innerHTML = html;
                        }
                    } catch (error) {
                        console.error('Ошибка поиска пользователей:', error);
                    }
                }
                
                // Загружаем данные при загрузке страницы
                document.addEventListener('DOMContentLoaded', async () => {
                    // Попробуем получить токен из localStorage
                    token = localStorage.getItem('admin_token');
                    
                    if (!token) {
                        // Если нет токена, показываем форму входа
                        document.getElementById('stats').innerHTML = \`
                            <div style="text-align: center; padding: 50px;">
                                <h2>🔐 Вход в админ-панель</h2>
                                <input type="email" id="email" placeholder="Email" style="display: block; margin: 10px auto; padding: 10px; width: 300px;">
                                <input type="password" id="password" placeholder="Пароль" style="display: block; margin: 10px auto; padding: 10px; width: 300px;">
                                <button class="btn" onclick="login()">Войти</button>
                            </div>
                        \`;
                    } else {
                        loadStats();
                        searchUsers('');
                    }
                });
                
                // Функция входа
                async function login() {
                    const email = document.getElementById('email').value;
                    const password = document.getElementById('password').value;
                    
                    try {
                        const response = await fetch('/api/auth/login', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ email, password })
                        });
                        
                        const data = await response.json();
                        
                        if (data.success) {
                            token = data.data.token;
                            localStorage.setItem('admin_token', token);
                            location.reload();
                        } else {
                            alert('Ошибка входа: ' + data.error);
                        }
                    } catch (error) {
                        alert('Ошибка сети');
                    }
                }
                
                // Функция выхода
                function logout() {
                    localStorage.removeItem('admin_token');
                    location.reload();
                }
            </script>
        </body>
        </html>
    `);
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎀 ЗАПУСК КОНСЬЕРЖ СЕРВИСА v4.3.0');
        console.log('='.repeat(80));
        console.log(`🌐 PORT: ${process.env.PORT || 3000}`);
        console.log(`🏷️  NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
        
        // Инициализируем базу данных
        await initDatabase();
        console.log('✅ База данных готова');
        
        // Инициализируем Telegram бота
        const botStarted = initTelegramBot();
        console.log(`🤖 Telegram Bot: ${botStarted ? '✅ Активен' : '⚠️ Отключен'}`);
        
        const PORT = process.env.PORT || 3000;
        
        app.listen(PORT, () => {
            console.log(`✅ Сервер запущен на порту ${PORT}`);
            console.log(`🌐 http://localhost:${PORT}`);
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
            
            console.log('\n💖 Особенности системы:');
            console.log('• Розовая стилистика с градиентами');
            console.log('• Полная система подписок');
            console.log('• Telegram бот с командами');
            console.log('• Полноценная админ-панель');
            console.log('• Статистика и аналитика');
            console.log('• Готово к продакшену');
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        console.log('💡 Попробуйте:');
        console.log('1. Удалить файл concierge.db и перезапустить сервер');
        console.log('2. Проверить права доступа к файловой системе');
        console.log('3. Проверить установку зависимостей: npm install');
        process.exit(1);
    }
};

// Обработка завершения работы
process.on('SIGINT', async () => {
    console.log('\n🛑 Остановка сервера...');
    if (telegramBot) {
        telegramBot.stopPolling();
        console.log('🤖 Telegram Bot остановлен');
    }
    if (db) {
        await db.close();
        console.log('🗃️ База данных закрыта');
    }
    process.exit(0);
});

// Запуск
startServer();
