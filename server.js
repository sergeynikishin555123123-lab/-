// server-complete-bot.js - Сервер с интеграцией Telegram бота
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const crypto = require('crypto');
const TelegramBot = require('node-telegram-bot-api');

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
const app = express();
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN';
const TELEGRAM_ADMIN_ID = -898508164; // Ваш Telegram ID

// ==================== TELEGRAM БОТ ====================
let bot = null;
if (TELEGRAM_BOT_TOKEN && TELEGRAM_BOT_TOKEN !== 'YOUR_BOT_TOKEN') {
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
    console.log('🤖 Telegram бот запущен');
    
    // Обработка команды /start
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        const firstName = msg.from.first_name || 'Пользователь';
        
        try {
            // Создаем или обновляем пользователя в системе
            await createOrUpdateTelegramUser(msg.from, chatId);
            
            // Отправляем приветственное сообщение с кнопками
            const options = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '🌐 Основное приложение', url: `http://localhost:${PORT}` },
                            { text: '👑 Админ-панель', url: `http://localhost:${PORT}/admin.html` }
                        ],
                        [
                            { text: '💼 Панель менеджера', url: `http://localhost:${PORT}/manager.html` }
                        ],
                        [
                            { text: '📊 Статистика системы', callback_data: 'stats' },
                            { text: '🆘 Помощь', callback_data: 'help' }
                        ]
                    ]
                }
            };
            
            bot.sendMessage(chatId, 
                `👋 Привет, ${firstName}!\n\n` +
                `Добро пожаловать в *Женский Консьерж*!\n\n` +
                `📱 *Доступные интерфейсы:*\n` +
                `• 🌐 Основное приложение — для клиентов и исполнителей\n` +
                `• 👑 Админ-панель — для администраторов системы\n` +
                `• 💼 Панель менеджера — для менеджеров поддержки\n\n` +
                `🚀 *Быстрый доступ:*`, 
                { parse_mode: 'Markdown', ...options }
            );
            
            // Для администратора отправляем дополнительную информацию
            if (chatId === TELEGRAM_ADMIN_ID) {
                bot.sendMessage(chatId,
                    `🔐 *Вы администратор системы*\n\n` +
                    `Ваши права доступа:\n` +
                    `✅ Админ-панель: FULL ACCESS\n` +
                    `✅ Панель менеджера: FULL ACCESS\n` +
                    `✅ Основное приложение: все роли\n\n` +
                    `📋 Тестовые аккаунты:\n` +
                    `• admin@test.com / admin123\n` +
                    `• manager@test.com / admin123\n` +
                    `• client@test.com / client123`,
                    { parse_mode: 'Markdown' }
                );
            }
            
        } catch (error) {
            console.error('Ошибка обработки команды /start:', error);
            bot.sendMessage(chatId, '⚠️ Произошла ошибка. Попробуйте позже.');
        }
    });
    
    // Обработка callback-кнопок
    bot.on('callback_query', async (callbackQuery) => {
        const chatId = callbackQuery.message.chat.id;
        const data = callbackQuery.data;
        
        try {
            if (data === 'stats') {
                const stats = await getSystemStats();
                bot.sendMessage(chatId,
                    `📊 *Статистика системы*\n\n` +
                    `👥 Пользователей: ${stats.users}\n` +
                    `📋 Задач: ${stats.tasks}\n` +
                    `✅ Завершено: ${stats.completed_tasks}\n` +
                    `🔍 В поиске: ${stats.searching_tasks}\n` +
                    `💰 Общая выручка: ${stats.revenue} ₽\n\n` +
                    `⏱️ Обновлено: ${new Date().toLocaleTimeString('ru-RU')}`,
                    { parse_mode: 'Markdown' }
                );
            }
            else if (data === 'help') {
                bot.sendMessage(chatId,
                    `🆘 *Помощь и поддержка*\n\n` +
                    `*Основное приложение:*\n` +
                    `• Для клиентов: создание задач\n` +
                    `• Для исполнителей: выполнение задач\n\n` +
                    `*Админ-панель:*\n` +
                    `• Управление пользователями\n` +
                    `• Управление категориями и услугами\n` +
                    `• Статистика и аналитика\n\n` +
                    `*Панель менеджера:*\n` +
                    `• Назначение исполнителей\n` +
                    `• Контроль выполнения задач\n` +
                    `• Общение с клиентами\n\n` +
                    `📧 Поддержка: support@concierge.ru`,
                    { parse_mode: 'Markdown' }
                );
            }
            
            // Подтверждаем обработку callback
            bot.answerCallbackQuery(callbackQuery.id);
            
        } catch (error) {
            console.error('Ошибка обработки callback:', error);
            bot.answerCallbackQuery(callbackQuery.id, { text: 'Ошибка получения данных' });
        }
    });
    
    // Команда /links - быстрый доступ к ссылкам
    bot.onText(/\/links/, (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId,
            `🔗 *Быстрые ссылки*\n\n` +
            `🌐 Основное приложение:\n` +
            `http://localhost:${PORT}\n\n` +
            `👑 Админ-панель:\n` +
            `http://localhost:${PORT}/admin.html\n\n` +
            `💼 Панель менеджера:\n` +
            `http://localhost:${PORT}/manager.html`,
            { parse_mode: 'Markdown' }
        );
    });
    
    // Команда /status - статус системы
    bot.onText(/\/status/, async (msg) => {
        const chatId = msg.chat.id;
        
        try {
            const stats = await getSystemStats();
            const users = await db.all("SELECT role, COUNT(*) as count FROM users WHERE is_active = 1 GROUP BY role");
            
            let userStats = '';
            users.forEach(u => {
                userStats += `• ${u.role}: ${u.count}\n`;
            });
            
            bot.sendMessage(chatId,
                `🟢 *Статус системы*\n\n` +
                `📊 *Статистика:*\n` +
                userStats +
                `\n🔄 *Последние действия:*\n` +
                `• Сервер: ${process.uptime().toFixed(0)} сек\n` +
                `• Память: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB\n` +
                `• БД: подключена\n\n` +
                `📍 Адрес сервера: http://localhost:${PORT}`,
                { parse_mode: 'Markdown' }
            );
            
        } catch (error) {
            bot.sendMessage(chatId, '⚠️ Ошибка получения статуса');
        }
    });
    
    // Уведомления о важных событиях
    async function sendTelegramNotification(message, isImportant = false) {
        if (bot && TELEGRAM_ADMIN_ID) {
            try {
                await bot.sendMessage(
                    TELEGRAM_ADMIN_ID, 
                    isImportant ? `🔔 ${message}` : `📝 ${message}`,
                    { parse_mode: 'Markdown' }
                );
            } catch (error) {
                console.error('Ошибка отправки уведомления в Telegram:', error);
            }
        }
    }
    
} else {
    console.log('⚠️ Telegram бот не запущен (не указан токен)');
}

// Функция для получения статистики системы
async function getSystemStats() {
    try {
        const stats = await db.get(`
            SELECT 
                (SELECT COUNT(*) FROM users) as users,
                (SELECT COUNT(*) FROM tasks) as tasks,
                (SELECT COUNT(*) FROM tasks WHERE status = 'completed') as completed_tasks,
                (SELECT COUNT(*) FROM tasks WHERE status = 'searching') as searching_tasks,
                (SELECT COALESCE(SUM(budget), 0) FROM tasks) as revenue
        `);
        return stats;
    } catch (error) {
        console.error('Ошибка получения статистики:', error);
        return { users: 0, tasks: 0, completed_tasks: 0, searching_tasks: 0, revenue: 0 };
    }
}

// Функция создания/обновления пользователя из Telegram
async function createOrUpdateTelegramUser(telegramUser, chatId) {
    try {
        // Проверяем, существует ли пользователь
        const existingUser = await db.get(
            "SELECT id FROM users WHERE telegram_id = ? OR email = ?",
            [chatId, `telegram_${chatId}@concierge.local`]
        );
        
        if (existingUser) {
            // Обновляем последнюю активность
            await db.run(
                "UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?",
                [existingUser.id]
            );
            return existingUser.id;
        }
        
        // Создаем нового пользователя
        const firstName = telegramUser.first_name || 'Telegram';
        const lastName = telegramUser.last_name || 'User';
        const username = telegramUser.username ? `@${telegramUser.username}` : null;
        
        // Если это администратор (ID -898508164), создаем его как суперадмина и менеджера
        let role = 'client';
        let subscription = 'free';
        
        if (chatId === TELEGRAM_ADMIN_ID) {
            role = 'superadmin';
            subscription = 'premium';
        }
        
        // Хешируем пароль
        const hashedPassword = await bcrypt.hash('telegram123', 10);
        
        // Дата истечения подписки
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 365);
        
        // Создаем пользователя
        const result = await db.run(`
            INSERT INTO users 
            (email, password, first_name, last_name, telegram_id, telegram_username, 
             role, subscription_plan, subscription_status, subscription_expires,
             initial_fee_paid, initial_fee_amount, tasks_limit, avatar_url, balance) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                `telegram_${chatId}@concierge.local`,
                hashedPassword,
                firstName,
                lastName,
                chatId,
                username,
                role,
                subscription,
                'active',
                expiryDate.toISOString().split('T')[0],
                1,
                0,
                9999,
                `https://ui-avatars.com/api/?name=${encodeURIComponent(firstName)}+${encodeURIComponent(lastName)}&background=7289DA&color=fff&bold=true`,
                1000
            ]
        );
        
        const userId = result.lastID;
        
        // Для администратора создаем также менеджера
        if (chatId === TELEGRAM_ADMIN_ID) {
            await db.run(`
                INSERT INTO users 
                (email, password, first_name, last_name, role, 
                 subscription_plan, subscription_status, subscription_expires,
                 initial_fee_paid, initial_fee_amount, tasks_limit, avatar_url, balance) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    'admin@test.com',
                    hashedPassword,
                    'Администратор',
                    'Системы',
                    'manager',
                    'premium',
                    'active',
                    expiryDate.toISOString().split('T')[0],
                    1,
                    0,
                    9999,
                    `https://ui-avatars.com/api/?name=Администратор+Системы&background=9B59B6&color=fff&bold=true`,
                    50000
                ]
            );
        }
        
        // Создаем приветственное уведомление в системе
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message) 
            VALUES (?, ?, ?, ?)`,
            [
                userId,
                'welcome',
                'Добро пожаловать из Telegram!',
                'Вы успешно зарегистрированы через Telegram бота.'
            ]
        );
        
        return userId;
        
    } catch (error) {
        console.error('Ошибка создания пользователя из Telegram:', error);
        throw error;
    }
}

// ==================== ОСНОВНОЙ СЕРВЕР ====================
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

const initDatabase = async () => {
    try {
        console.log('🔄 Инициализация базы данных...');
        
        const dbPath = './concierge.db';
        console.log(`📁 Путь к базе данных: ${dbPath}`);
        
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        console.log('✅ База данных SQLite подключена');

        // Включаем внешние ключи
        await db.run('PRAGMA foreign_keys = ON');

        // Создание таблиц с Telegram полями
        await db.exec('BEGIN TRANSACTION');

        // Пользователи с полем для Telegram
        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (
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
                telegram_username TEXT,
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

        // Остальные таблицы (как в предыдущем примере)
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
                is_featured INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await db.exec(`
            CREATE TABLE IF NOT EXISTS categories (
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
            )
        `);

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
            )
        `);

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

        await db.exec(`
            CREATE TABLE IF NOT EXISTS reviews (
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
            )
        `);

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

        await db.exec(`
            CREATE TABLE IF NOT EXISTS transactions (
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
            )
        `);

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
        await db.exec('ROLLBACK');
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
                ['telegram_bot', TELEGRAM_BOT_TOKEN || 'none', 'Токен Telegram бота', 'telegram'],
                ['telegram_admin_id', TELEGRAM_ADMIN_ID.toString(), 'ID администратора Telegram', 'telegram'],
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

        // 2. Автоматически создаем администратора с Telegram ID -898508164
        const adminExists = await db.get("SELECT 1 FROM users WHERE telegram_id = ?", [TELEGRAM_ADMIN_ID]);
        if (!adminExists) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            const expiryDate = new Date();
            expiryDate.setFullYear(expiryDate.getFullYear() + 1);
            
            // Создаем суперадмина
            await db.run(`
                INSERT INTO users 
                (email, password, first_name, last_name, telegram_id, role, 
                 subscription_plan, subscription_status, subscription_expires,
                 initial_fee_paid, initial_fee_amount, tasks_limit, avatar_url, balance) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    'admin@test.com',
                    hashedPassword,
                    'Александр',
                    'Иванов',
                    TELEGRAM_ADMIN_ID,
                    'superadmin',
                    'premium',
                    'active',
                    expiryDate.toISOString().split('T')[0],
                    1,
                    0,
                    9999,
                    'https://ui-avatars.com/api/?name=Александр+Иванов&background=9B59B6&color=fff&bold=true',
                    100000
                ]
            );
            
            // Создаем менеджера для этого же пользователя
            await db.run(`
                INSERT INTO users 
                (email, password, first_name, last_name, role, 
                 subscription_plan, subscription_status, subscription_expires,
                 initial_fee_paid, initial_fee_amount, tasks_limit, avatar_url, balance) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    'manager@test.com',
                    hashedPassword,
                    'Мария',
                    'Петрова',
                    'manager',
                    'premium',
                    'active',
                    expiryDate.toISOString().split('T')[0],
                    1,
                    0,
                    9999,
                    'https://ui-avatars.com/api/?name=Мария+Петрова&background=2ECC71&color=fff&bold=true',
                    50000
                ]
            );
            
            console.log(`✅ Администратор с Telegram ID ${TELEGRAM_ADMIN_ID} создан`);
        }

        // 3. Остальные тестовые данные (как в предыдущем примере)
        // ... [остальной код создания тестовых данных без изменений]

        console.log('🎉 Все начальные данные созданы!');
        
        // Отправляем уведомление в Telegram о запуске системы
        if (bot && TELEGRAM_ADMIN_ID) {
            try {
                await bot.sendMessage(
                    TELEGRAM_ADMIN_ID,
                    `🚀 *Система запущена!*\n\n` +
                    `📍 Сервер: http://localhost:${PORT}\n` +
                    `📊 БД: SQLite (concierge.db)\n` +
                    `👥 Пользователей: 8\n` +
                    `📋 Задач: 15\n` +
                    `🕐 Время: ${new Date().toLocaleString('ru-RU')}`,
                    { parse_mode: 'Markdown' }
                );
            } catch (error) {
                console.error('Ошибка отправки уведомления:', error);
            }
        }
        
    } catch (error) {
        console.error('⚠️ Ошибка создания начальных данных:', error.message);
    }
};

// ==================== API МАРШРУТЫ ====================

// Главная страница с информацией о боте
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: '🌸 Женский Консьерж API v7.0.0',
        version: '7.0.0',
        status: '🟢 Работает',
        features: ['Telegram Bot Integration', 'Подписки', 'Задачи', 'Чат', 'Отзывы', 'Админ панель', 'Управление услугами'],
        telegram_bot: bot ? '🟢 Активен' : '🔴 Не активен',
        admin_telegram_id: TELEGRAM_ADMIN_ID,
        interfaces: [
            { name: 'Основное приложение', url: '/index.html' },
            { name: 'Админ-панель', url: '/admin.html' },
            { name: 'Панель менеджера', url: '/manager.html' }
        ],
        endpoints: {
            auth: '/api/auth/*',
            tasks: '/api/tasks/*',
            users: '/api/users/*',
            admin: '/api/admin/*',
            telegram: '/api/telegram/*'
        },
        timestamp: new Date().toISOString()
    });
});

// Health check с информацией о боте
app.get('/api/health', async (req, res) => {
    try {
        await db.get('SELECT 1 as status');
        
        const usersCount = await db.get('SELECT COUNT(*) as count FROM users');
        const tasksCount = await db.get('SELECT COUNT(*) as count FROM tasks');
        const telegramUsers = await db.get('SELECT COUNT(*) as count FROM users WHERE telegram_id IS NOT NULL');
        
        res.json({
            success: true,
            status: 'OK',
            telegram_bot: bot ? 'active' : 'inactive',
            stats: {
                total_users: usersCount?.count || 0,
                telegram_users: telegramUsers?.count || 0,
                tasks: tasksCount?.count || 0,
                admin_id: TELEGRAM_ADMIN_ID
            },
            interfaces: {
                main: `http://localhost:${PORT}/index.html`,
                admin: `http://localhost:${PORT}/admin.html`,
                manager: `http://localhost:${PORT}/manager.html`
            },
            timestamp: new Date().toISOString(),
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

// Telegram Webhook для получения уведомлений
app.post('/api/telegram/webhook', express.json(), async (req, res) => {
    try {
        const { event, data } = req.body;
        
        if (bot && TELEGRAM_ADMIN_ID) {
            let message = '';
            
            switch (event) {
                case 'task_created':
                    message = `📋 Новая задача: "${data.title}"\n💰 Бюджет: ${data.budget}₽\n👤 Клиент: ${data.client_name}`;
                    break;
                case 'task_completed':
                    message = `✅ Задача завершена: "${data.title}"\n⭐ Оценка: ${data.rating}/5\n👩‍💼 Исполнитель: ${data.performer_name}`;
                    break;
                case 'new_user':
                    message = `👤 Новый пользователь: ${data.name}\n📧 Email: ${data.email}\n👑 Роль: ${data.role}`;
                    break;
                case 'payment_received':
                    message = `💰 Платеж получен: ${data.amount}₽\n👤 От: ${data.user_name}\n📝 Тип: ${data.type}`;
                    break;
                case 'error':
                    message = `🚨 Ошибка: ${data.message}\n📁 Файл: ${data.file}\n📍 Строка: ${data.line}`;
                    break;
                default:
                    message = `ℹ️ Событие: ${event}\n📊 Данные: ${JSON.stringify(data, null, 2)}`;
            }
            
            await bot.sendMessage(TELEGRAM_ADMIN_ID, message, { parse_mode: 'Markdown' });
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка Telegram webhook:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Получение ссылок для Telegram бота
app.get('/api/telegram/links', (req, res) => {
    res.json({
        success: true,
        data: {
            interfaces: [
                {
                    name: 'Основное приложение',
                    description: 'Для клиентов и исполнителей',
                    url: `http://localhost:${PORT}/index.html`,
                    icon: '🌐'
                },
                {
                    name: 'Админ-панель',
                    description: 'Управление системой',
                    url: `http://localhost:${PORT}/admin.html`,
                    icon: '👑'
                },
                {
                    name: 'Панель менеджера',
                    description: 'Управление задачами',
                    url: `http://localhost:${PORT}/manager.html`,
                    icon: '💼'
                }
            ],
            api_endpoints: {
                main: `http://localhost:${PORT}/api`,
                health: `http://localhost:${PORT}/api/health`,
                auth: `http://localhost:${PORT}/api/auth`
            }
        }
    });
});

// Авторизация через Telegram
app.post('/api/auth/telegram', async (req, res) => {
    try {
        const { telegram_id, first_name, last_name, username } = req.body;
        
        if (!telegram_id) {
            return res.status(400).json({
                success: false,
                error: 'Не указан Telegram ID'
            });
        }
        
        // Проверяем существующего пользователя
        let user = await db.get(
            `SELECT id, email, first_name, last_name, role, 
                    subscription_plan, subscription_status, avatar_url,
                    balance, user_rating, telegram_id
             FROM users WHERE telegram_id = ?`,
            [telegram_id]
        );
        
        // Если пользователь не найден, создаем нового
        if (!user) {
            const hashedPassword = await bcrypt.hash(`telegram_${telegram_id}_${Date.now()}`, 10);
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + 30);
            
            // Определяем роль по Telegram ID
            let role = 'client';
            let subscription = 'free';
            
            if (telegram_id === TELEGRAM_ADMIN_ID) {
                role = 'superadmin';
                subscription = 'premium';
            }
            
            const result = await db.run(`
                INSERT INTO users 
                (email, password, first_name, last_name, telegram_id, telegram_username,
                 role, subscription_plan, subscription_status, subscription_expires,
                 initial_fee_paid, initial_fee_amount, tasks_limit, avatar_url, balance) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    `telegram_${telegram_id}@concierge.local`,
                    hashedPassword,
                    first_name || 'Telegram',
                    last_name || 'User',
                    telegram_id,
                    username || null,
                    role,
                    subscription,
                    'active',
                    expiryDate.toISOString().split('T')[0],
                    1,
                    0,
                    role === 'client' ? 5 : 9999,
                    `https://ui-avatars.com/api/?name=${encodeURIComponent(first_name || 'Telegram')}+${encodeURIComponent(last_name || 'User')}&background=7289DA&color=fff&bold=true`,
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
            
            // Отправляем уведомление в Telegram
            if (bot) {
                await bot.sendMessage(
                    telegram_id,
                    `👋 Добро пожаловать в *Женский Консьерж*!\n\n` +
                    `✅ Вы успешно зарегистрированы через Telegram.\n` +
                    `👑 Ваша роль: ${role === 'superadmin' ? 'Суперадминистратор' : 'Клиент'}\n` +
                    `💰 Начальный баланс: 1000₽\n\n` +
                    `🔗 Ссылки для доступа:\n` +
                    `• Основное приложение: http://localhost:${PORT}/index.html\n` +
                    `• Админ-панель: http://localhost:${PORT}/admin.html`,
                    { parse_mode: 'Markdown' }
                );
            }
        }
        
        // Обновляем время последнего входа
        await db.run(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
            [user.id]
        );
        
        // Создаем JWT токен
        const token = jwt.sign(
            { 
                id: user.id, 
                telegram_id: user.telegram_id,
                role: user.role,
                first_name: user.first_name,
                last_name: user.last_name
            },
            process.env.JWT_SECRET || 'concierge-secret-key-2024-prod',
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

// ... [остальные API маршруты остаются без изменений, как в предыдущем примере]
// ==================== ОСНОВНЫЕ API МАРШРУТЫ ====================

// Аутентификация
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
        
        // Обновляем время последнего входа
        await db.run(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
            [user.id]
        );
        
        // Подготавливаем ответ
        const userForResponse = {
            id: user.id,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            phone: user.phone,
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
            telegram_id: user.telegram_id,
            telegram_username: user.telegram_username
        };
        
        // Создаем токен
        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                role: user.role,
                first_name: user.first_name,
                last_name: user.last_name,
                subscription_plan: user.subscription_plan,
                initial_fee_paid: user.initial_fee_paid
            },
            process.env.JWT_SECRET || 'concierge-secret-key-2024-prod',
            { expiresIn: '30d' }
        );
        
        // Если это администратор (Telegram ID -898508164), отправляем уведомление
        if (bot && user.telegram_id === TELEGRAM_ADMIN_ID) {
            try {
                await bot.sendMessage(
                    TELEGRAM_ADMIN_ID,
                    `🔐 *Вход в систему*\n\n` +
                    `👤 Пользователь: ${user.first_name} ${user.last_name}\n` +
                    `📧 Email: ${user.email}\n` +
                    `👑 Роль: ${user.role}\n` +
                    `🌐 IP: ${req.ip}\n` +
                    `🕐 Время: ${new Date().toLocaleString('ru-RU')}`,
                    { parse_mode: 'Markdown' }
                );
            } catch (error) {
                console.error('Ошибка отправки уведомления:', error);
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
        console.error('Ошибка входа:', error);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера при входе'
        });
    }
});

// Получение текущего пользователя
app.get('/api/auth/me', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Требуется авторизация'
            });
        }
        
        // Проверяем токен
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'concierge-secret-key-2024-prod');
        
        const user = await db.get(
            `SELECT id, email, first_name, last_name, phone, role, 
                    subscription_plan, subscription_status, subscription_expires,
                    avatar_url, balance, user_rating, completed_tasks,
                    tasks_limit, tasks_used, total_spent, telegram_id
             FROM users WHERE id = ? AND is_active = 1`,
            [decoded.id]
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

// ==================== СТАТИЧЕСКИЕ ФАЙЛЫ ====================

// Отдаем HTML файлы
app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/manager.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'manager.html'));
});

app.get('/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== ЗАПУСК СЕРВЕРА ====================

const PORT = process.env.PORT || 3000;

const startServer = async () => {
    try {
        await initDatabase();
        
        app.listen(PORT, () => {
            console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🌸 Женский Консьерж API v7.0.0                         ║
║                  с Telegram Bot Integration               ║
║                                                            ║
║   🚀 Сервер запущен на порту ${PORT}                      ║
║   🤖 Telegram бот: ${bot ? '🟢 Активен' : '🔴 Не активен'}║
║   👑 Админ Telegram ID: ${TELEGRAM_ADMIN_ID}              ║
║                                                            ║
║   🔗 Основные интерфейсы:                                 ║
║   • http://localhost:${PORT}/ - API                       ║
║   • http://localhost:${PORT}/index.html - Основное прилож.║
║   • http://localhost:${PORT}/admin.html - Админ-панель    ║
║   • http://localhost:${PORT}/manager.html - Менеджер      ║
║                                                            ║
║   🤖 Команды Telegram бота:                               ║
║   • /start - Получить ссылки                              ║
║   • /links - Быстрые ссылки                               ║
║   • /status - Статус системы                              ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
            `);
            
            // Отправляем стартовое сообщение в Telegram
            if (bot && TELEGRAM_ADMIN_ID) {
                setTimeout(async () => {
                    try {
                        await bot.sendMessage(
                            TELEGRAM_ADMIN_ID,
                            `🎉 *Сервер запущен!*\n\n` +
                            `📍 *Доступные интерфейсы:*\n` +
                            `• 🌐 Основное приложение: http://localhost:${PORT}/index.html\n` +
                            `• 👑 Админ-панель: http://localhost:${PORT}/admin.html\n` +
                            `• 💼 Панель менеджера: http://localhost:${PORT}/manager.html\n\n` +
                            `🔐 *Тестовые аккаунты:*\n` +
                            `• Админ: admin@test.com / admin123\n` +
                            `• Менеджер: manager@test.com / admin123\n` +
                            `• Клиент: client@test.com / client123\n\n` +
                            `🚀 *Система готова к работе!*`,
                            { parse_mode: 'Markdown' }
                        );
                    } catch (error) {
                        console.error('Ошибка отправки стартового сообщения:', error);
                    }
                }, 2000);
            }
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error);
        process.exit(1);
    }
};

startServer();

// Обработка завершения работы
process.on('SIGINT', async () => {
    console.log('🔄 Завершение работы...');
    
    // Отправляем уведомление в Telegram
    if (bot && TELEGRAM_ADMIN_ID) {
        try {
            await bot.sendMessage(
                TELEGRAM_ADMIN_ID,
                '🔴 *Сервер останавливается...*\n\n' +
                'Система будет недоступна до следующего запуска.',
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('Ошибка отправки уведомления:', error);
        }
    }
    
    // Закрываем соединения
    if (db) {
        await db.close();
    }
    if (bot) {
        bot.stopPolling();
    }
    
    console.log('👋 Сервер остановлен');
    process.exit(0);
});

// Экспорт для тестирования
module.exports = {
    app,
    db,
    bot,
    initDatabase,
    createInitialData,
    createOrUpdateTelegramUser,
    getSystemStats
};
