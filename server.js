// server.js - исправленная версия с обработкой конфликтов телеграм бота и ошибок создания данных

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const crypto = require('crypto');

// ==================== ТЕЛЕГРАМ БОТ ====================
let TelegramBot;
try {
    TelegramBot = require('node-telegram-bot-api');
    console.log('✅ Telegram Bot модуль загружен');
} catch (error) {
    console.log('⚠️ Telegram Bot не установлен: npm install node-telegram-bot-api');
    TelegramBot = null;
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
const app = express();

// Улучшенные CORS настройки
app.use(cors({
    origin: function (origin, callback) {
        // Разрешаем все источники в режиме разработки
        if (!origin || process.env.NODE_ENV === 'development' || 
            process.env.NODE_ENV === 'production' || // Разрешаем всё в продакшене для тестирования
            origin.includes('localhost') || 
            origin.includes('127.0.0.1')) {
            callback(null, true);
        } else {
            const allowedOrigins = [
                'http://localhost:3000',
                'http://localhost:5500',
                'http://127.0.0.1:5500',
                'http://localhost:8080',
                'https://concierge-service.ru',
                'http://concierge-service.ru'
            ];
            
            if (allowedOrigins.indexOf(origin) !== -1) {
                callback(null, true);
            } else {
                callback(new Error('CORS политика не разрешает доступ с этого источника'));
            }
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// Улучшенное логирование
app.use((req, res, next) => {
    const requestId = crypto.randomBytes(4).toString('hex');
    req.requestId = requestId;
    
    const startTime = Date.now();
    
    console.log(`🌐 [${requestId}] ${req.method} ${req.path} - ${req.ip} - ${new Date().toISOString()}`);
    
    if (req.method === 'POST' && req.path.includes('/api/')) {
        const logBody = { ...req.body };
        if (logBody.password) logBody.password = '***';
        if (logBody.token) logBody.token = '***';
        console.log(`📦 [${requestId}] Body:`, JSON.stringify(logBody).substring(0, 200));
    }
    
    res.on('finish', () => {
        const duration = Date.now() - startTime;
        console.log(`⏱️ [${requestId}] ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
    });
    
    next();
});

// ==================== БАЗА ДАННЫХ ====================
let db;
let telegramBot = null;
let botPollingInterval = null;

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

        // Создание таблиц с транзакцией
        await db.exec('BEGIN TRANSACTION');

        // Пользователи
        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                first_name TEXT NOT NULL,
                last_name TEXT NOT NULL,
                phone TEXT NOT NULL,
                role TEXT DEFAULT 'client' CHECK(role IN ('client', 'performer', 'manager', 'admin', 'superadmin')),
                subscription_plan TEXT DEFAULT 'essential',
                subscription_status TEXT DEFAULT 'pending' CHECK(subscription_status IN ('pending', 'active', 'suspended', 'cancelled')),
                subscription_expires DATE,
                telegram_id TEXT,
                telegram_username TEXT,
                avatar_url TEXT DEFAULT 'https://ui-avatars.com/api/?name=User&background=FF6B8B&color=fff',
                balance REAL DEFAULT 0,
                initial_fee_paid INTEGER DEFAULT 0 CHECK(initial_fee_paid IN (0, 1)),
                initial_fee_amount REAL DEFAULT 0,
                rating REAL DEFAULT 0,
                completed_tasks INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
                is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
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
                color TEXT DEFAULT '#FF6B8B',
                sort_order INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
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
                is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
                sort_order INTEGER DEFAULT 0,
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
                status TEXT DEFAULT 'new' CHECK(status IN ('new', 'searching', 'assigned', 'in_progress', 'completed', 'cancelled', 'rejected', 'expired')),
                priority TEXT DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
                price REAL DEFAULT 0,
                address TEXT NOT NULL,
                location_lat REAL,
                location_lng REAL,
                deadline DATETIME NOT NULL,
                start_time DATETIME,
                end_time DATETIME,
                contact_info TEXT NOT NULL,
                additional_requirements TEXT,
                is_urgent INTEGER DEFAULT 0 CHECK(is_urgent IN (0, 1)),
                is_approved INTEGER DEFAULT 0 CHECK(is_approved IN (0, 1)),
                completed_at TIMESTAMP,
                rating INTEGER CHECK(rating >= 1 AND rating <= 5),
                feedback TEXT,
                cancellation_reason TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (performer_id) REFERENCES users(id) ON DELETE SET NULL,
                FOREIGN KEY (category_id) REFERENCES categories(id),
                FOREIGN KEY (service_id) REFERENCES services(id)
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

        // Платежи
        await db.exec(`
            CREATE TABLE IF NOT EXISTS payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                subscription_id INTEGER,
                task_id INTEGER,
                amount REAL NOT NULL,
                currency TEXT DEFAULT 'RUB',
                description TEXT,
                status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'refunded')),
                payment_method TEXT CHECK(payment_method IN ('card', 'bank_transfer', 'cash', 'online', 'initial_fee', 'subscription')),
                transaction_id TEXT UNIQUE,
                invoice_id TEXT,
                payment_data TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (subscription_id) REFERENCES subscriptions(id),
                FOREIGN KEY (task_id) REFERENCES tasks(id)
            )
        `);

        // Уведомления
        await db.exec(`
            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                type TEXT DEFAULT 'info' CHECK(type IN ('info', 'success', 'warning', 'error', 'system')),
                is_read INTEGER DEFAULT 0 CHECK(is_read IN (0, 1)),
                action_url TEXT,
                action_text TEXT,
                data TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Сообщения в чате
        await db.exec(`
            CREATE TABLE IF NOT EXISTS task_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                message TEXT NOT NULL,
                attachment_url TEXT,
                attachment_type TEXT CHECK(attachment_type IN ('image', 'document', 'voice', 'video')),
                is_read INTEGER DEFAULT 0 CHECK(is_read IN (0, 1)),
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
                rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
                comment TEXT,
                is_anonymous INTEGER DEFAULT 0 CHECK(is_anonymous IN (0, 1)),
                admin_comment TEXT,
                is_approved INTEGER DEFAULT 1 CHECK(is_approved IN (0, 1)),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (performer_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Блокировки
        await db.exec(`
            CREATE TABLE IF NOT EXISTS user_blocks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                blocked_user_id INTEGER NOT NULL,
                reason TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (blocked_user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE(user_id, blocked_user_id)
            )
        `);

        // Журнал
        await db.exec(`
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                action TEXT NOT NULL,
                entity_type TEXT,
                entity_id INTEGER,
                details TEXT,
                ip_address TEXT,
                user_agent TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
            )
        `);

        // Настройки
        await db.exec(`
            CREATE TABLE IF NOT EXISTS system_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT UNIQUE NOT NULL,
                value TEXT NOT NULL,
                description TEXT,
                category TEXT DEFAULT 'general',
                is_public INTEGER DEFAULT 0 CHECK(is_public IN (0, 1)),
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Индексы
        await db.exec(`
            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
            CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
            CREATE INDEX IF NOT EXISTS idx_tasks_client ON tasks(client_id);
            CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
            CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline);
        `);

        await db.exec('COMMIT');
        console.log('✅ Все таблицы и индексы созданы');

        // Создаем тестовые данные
        await createInitialData();
        
        // Инициализируем Telegram бота
        await initTelegramBot();
        
        // Запускаем фоновые задачи
        startBackgroundJobs();
        
        return db;
    } catch (error) {
        await db.exec('ROLLBACK');
        console.error('❌ Ошибка инициализации базы данных:', error.message);
        console.error(error.stack);
        throw error;
    }
};

// ==================== ТЕСТОВЫЕ ДАННЫЕ ====================
const createInitialData = async () => {
    try {
        console.log('📝 Создание начальных данных...');

        // 1. Настройки системы
        const settingsExist = await db.get("SELECT 1 FROM system_settings WHERE key = 'app_name'");
        if (!settingsExist) {
            const settings = [
                ['app_name', 'Женский Консьерж', 'Название приложения', 'general', 1],
                ['contact_email', 'info@concierge-service.ru', 'Контактный email', 'general', 1],
                ['contact_phone', '+7 (999) 123-45-67', 'Контактный телефон', 'general', 1],
                ['support_hours', 'Ежедневно с 9:00 до 21:00', 'Часы работы поддержки', 'general', 1]
            ];

            for (const [key, value, description, category, isPublic] of settings) {
                await db.run(
                    `INSERT INTO system_settings (key, value, description, category, is_public) 
                     VALUES (?, ?, ?, ?, ?)`,
                    [key, value, description, category, isPublic]
                );
            }
            console.log('✅ Настройки системы созданы');
        }

        // 2. Подписки
        const subscriptionsExist = await db.get("SELECT 1 FROM subscriptions WHERE name = 'essential'");
        if (!subscriptionsExist) {
            const subscriptions = [
                [
                    'essential', 'Эссеншл', 'Базовый набор услуг для эпизодических задач',
                    0, 0, 500, 5,
                    '["До 5 задач в месяц", "Базовые услуги", "Поддержка по email", "Стандартное время ответа"]',
                    '#FF6B8B', 1, 1
                ],
                [
                    'premium', 'Премиум', 'Полный доступ ко всем услугам и приоритетная поддержка',
                    1990, 19900, 1000, 999,
                    '["Неограниченные задачи", "Все услуги премиум-класса", "Приоритетная поддержка 24/7", "Личный помощник"]',
                    '#9B59B6', 2, 1
                ]
            ];

            for (const [name, display_name, description, price_monthly, price_yearly, initial_fee, tasks_limit, features, color_theme, sort_order, is_active] of subscriptions) {
                await db.run(
                    `INSERT INTO subscriptions 
                    (name, display_name, description, price_monthly, price_yearly, 
                     initial_fee, tasks_limit, features, color_theme, sort_order, is_active) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [name, display_name, description, price_monthly, price_yearly, 
                     initial_fee, tasks_limit, features, color_theme, sort_order, is_active]
                );
            }
            console.log('✅ Тарифы подписок созданы');
        }

        // 3. Категории услуг
        const categoriesExist = await db.get("SELECT 1 FROM categories WHERE name = 'home_and_household'");
        if (!categoriesExist) {
            const categories = [
                ['home_and_household', 'Дом и быт', 'Услуги для дома и бытовых нужд', '🏠', '#FF6B8B', 1, 1],
                ['family_and_children', 'Дети и семья', 'Услуги для детей и семейных нужд', '👨‍👩‍👧‍👦', '#3498DB', 2, 1],
                ['beauty_and_health', 'Красота и здоровье', 'Услуги красоты и здоровья', '💅', '#9B59B6', 3, 1],
                ['courses_and_education', 'Курсы и образование', 'Образовательные услуги', '🎓', '#2ECC71', 4, 1],
                ['pets', 'Питомцы', 'Услуги для домашних животных', '🐕', '#F39C12', 5, 1],
                ['events_and_entertainment', 'Мероприятия', 'Организация мероприятий', '🎉', '#E74C3C', 6, 1]
            ];

            for (const [name, display_name, description, icon, color, sort_order, is_active] of categories) {
                await db.run(
                    `INSERT INTO categories 
                    (name, display_name, description, icon, color, sort_order, is_active) 
                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [name, display_name, description, icon, color, sort_order, is_active]
                );
            }
            console.log('✅ Категории услуг созданы');
        }

        // 4. Услуги
        const servicesExist = await db.get("SELECT 1 FROM services WHERE name = 'Уборка квартиры'");
        if (!servicesExist) {
            // Получаем ID категорий
            const categories = await db.all("SELECT id, name FROM categories");
            const categoryMap = {};
            categories.forEach(cat => categoryMap[cat.name] = cat.id);

            const services = [
                // Дом и быт
                [categoryMap.home_and_household, 'Уборка квартиры', 'Генеральная или поддерживающая уборка квартиры', 1500, '2-4 часа'],
                [categoryMap.home_and_household, 'Химчистка мебели', 'Профессиональная химчистка диванов, кресел, матрасов', 3000, '3-5 часов'],
                
                // Дети и семья
                [categoryMap.family_and_children, 'Няня на час', 'Присмотр за детьми на несколько часов', 500, '1 час'],
                [categoryMap.family_and_children, 'Репетитор для ребенка', 'Помощь с уроками по школьным предметам', 800, '1 час'],
                
                // Красота и здоровье
                [categoryMap.beauty_and_health, 'Маникюр на дому', 'Профессиональный маникюр с выездом', 1200, '1.5 часа'],
                [categoryMap.beauty_and_health, 'Стрижка и укладка', 'Парикмахерские услуги на дому', 1500, '2 часа']
            ];

            for (const [category_id, name, description, base_price, estimated_time] of services) {
                await db.run(
                    `INSERT INTO services 
                    (category_id, name, description, base_price, estimated_time, is_active) 
                    VALUES (?, ?, ?, ?, ?, 1)`,
                    [category_id, name, description, base_price, estimated_time]
                );
            }
            console.log('✅ Услуги созданы');
        }

        // 5. Тестовые пользователи
        const usersExist = await db.get("SELECT 1 FROM users WHERE email = 'admin@concierge.ru'");
        if (!usersExist) {
            // Создаем хеш пароля
            const passwordHash = await bcrypt.hash('admin123', 12);
            const clientPasswordHash = await bcrypt.hash('client123', 12);
            const performerPasswordHash = await bcrypt.hash('performer123', 12);
            
            const expiryDate = new Date();
            expiryDate.setFullYear(expiryDate.getFullYear() + 1);
            const expiryDateStr = expiryDate.toISOString().split('T')[0];

            const users = [
                // Администраторы
                ['superadmin@concierge.ru', passwordHash, 'Александр', 'Иванов', '+79991112233', 'superadmin', 'premium', 'active', expiryDateStr, null, '@superadmin', 1, 1000, 50000, 1],
                ['admin@concierge.ru', passwordHash, 'Екатерина', 'Петрова', '+79992223344', 'admin', 'premium', 'active', expiryDateStr, null, '@admin', 1, 1000, 50000, 1],
                
                // Помощники
                ['performer1@concierge.ru', performerPasswordHash, 'Анна', 'Кузнецова', '+79994445566', 'performer', 'essential', 'active', expiryDateStr, null, '@anna_helper', 1, 500, 0, 1],
                ['performer2@concierge.ru', performerPasswordHash, 'Мария', 'Смирнова', '+79995556677', 'performer', 'essential', 'active', expiryDateStr, null, '@maria_helper', 1, 500, 0, 1],
                
                // Клиенты
                ['client1@example.com', clientPasswordHash, 'Елена', 'Васильева', '+79997778899', 'client', 'premium', 'active', expiryDateStr, null, '@elena_client', 1, 1000, 10000, 1],
                ['client2@example.com', clientPasswordHash, 'Наталья', 'Федорова', '+79998889900', 'client', 'essential', 'active', expiryDateStr, null, '@natalia_client', 1, 500, 5000, 1]
            ];

            for (const [email, password, first_name, last_name, phone, role, subscription_plan, subscription_status, subscription_expires, telegram_id, telegram_username, initial_fee_paid, initial_fee_amount, balance, is_active] of users) {
                const avatar_url = `https://ui-avatars.com/api/?name=${encodeURIComponent(first_name)}+${encodeURIComponent(last_name)}&background=${role === 'client' ? 'FF6B8B' : role === 'performer' ? '3498DB' : '2ECC71'}&color=fff&bold=true`;
                
                await db.run(
                    `INSERT INTO users 
                    (email, password, first_name, last_name, phone, role, 
                     subscription_plan, subscription_status, subscription_expires,
                     telegram_id, telegram_username, avatar_url, balance,
                     initial_fee_paid, initial_fee_amount, is_active) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [email, password, first_name, last_name, phone, role,
                     subscription_plan, subscription_status, subscription_expires,
                     telegram_id, telegram_username, avatar_url, balance,
                     initial_fee_paid, initial_fee_amount, is_active]
                );
            }
            console.log('✅ Тестовые пользователи созданы');
        }

        console.log('🎉 Все начальные данные успешно созданы!');
        
        // Выводим информацию для входа
        console.log('\n🔑 ТЕСТОВЫЕ АККАУНТЫ ДЛЯ ВХОДА:');
        console.log('='.repeat(60));
        console.log('👑 Суперадмин: superadmin@concierge.ru / admin123');
        console.log('👨‍💼 Админ: admin@concierge.ru / admin123');
        console.log('👩‍🏫 Помощник 1: performer1@concierge.ru / performer123');
        console.log('👩‍🏫 Помощник 2: performer2@concierge.ru / performer123');
        console.log('👩 Клиент Премиум: client1@example.com / client123');
        console.log('👩 Клиент Эссеншл: client2@example.com / client123');
        console.log('='.repeat(60));
        
    } catch (error) {
        console.error('⚠️ Ошибка создания начальных данных:', error.message);
        console.error(error.stack);
    }
};

// ==================== TELEGRAM БОТ ====================
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
        
        // Останавливаем предыдущий polling если есть
        if (botPollingInterval) {
            clearInterval(botPollingInterval);
            botPollingInterval = null;
        }
        
        const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
            polling: false // Начнем polling позже
        });
        
        // Проверяем соединение
        try {
            await bot.getMe();
            console.log('✅ Telegram Bot подключен');
        } catch (error) {
            console.log('❌ Ошибка подключения к Telegram:', error.message);
            return null;
        }
        
        // Функция для безопасного старта polling
        const startPollingSafely = () => {
            try {
                bot.startPolling({
                    interval: 300,
                    autoStart: true,
                    params: {
                        timeout: 10,
                        limit: 100
                    }
                });
                console.log('✅ Telegram Bot polling запущен');
                return true;
            } catch (error) {
                console.log('⚠️ Ошибка запуска polling:', error.message);
                return false;
            }
        };
        
        // Пробуем запустить polling
        let pollingStarted = startPollingSafely();
        
        // Если не удалось, ждем и пробуем снова
        if (!pollingStarted) {
            console.log('⏳ Ожидание 5 секунд перед повторной попыткой...');
            await new Promise(resolve => setTimeout(resolve, 5000));
            pollingStarted = startPollingSafely();
        }
        
        if (!pollingStarted) {
            console.log('❌ Не удалось запустить Telegram Bot polling');
            return null;
        }
        
        // Обработчик команды /start
        bot.onText(/\/start/, async (msg) => {
            const chatId = msg.chat.id;
            const userName = msg.from.first_name || 'пользователь';
            
            const message = `🎀 *Привет, ${userName}!*\n\n` +
                           `Добро пожаловать в *Женский Консьерж*! 👗\n\n` +
                           `Я ваш персональный помощник в бытовых вопросах.\n` +
                           `Для начала работы необходимо *зарегистрироваться* на нашем сайте:\n\n` +
                           `🌐 [Открыть сайт](https://concierge-service.ru)\n\n` +
                           `_После регистрации привяжите Telegram в настройках профиля._`;
            
            await bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            });
        });
        
        // Обработчик ошибок polling
        bot.on('polling_error', (error) => {
            console.log('⚠️ Ошибка Telegram Bot polling:', error.message);
            
            // Если ошибка 409 (конфликт), перезапускаем polling через 10 секунд
            if (error.code === 'ETELEGRAM' && error.message.includes('409')) {
                console.log('🔄 Обнаружен конфликт polling, перезапуск через 10 секунд...');
                
                if (botPollingInterval) {
                    clearInterval(botPollingInterval);
                }
                
                botPollingInterval = setTimeout(() => {
                    console.log('🔄 Перезапуск Telegram Bot polling...');
                    try {
                        bot.stopPolling();
                    } catch (e) {
                        // Игнорируем ошибки остановки
                    }
                    
                    startPollingSafely();
                }, 10000);
            }
        });
        
        // Обработчик ошибок вебхука
        bot.on('webhook_error', (error) => {
            console.log('⚠️ Ошибка Telegram Bot webhook:', error.message);
        });
        
        console.log('✅ Telegram Bot успешно настроен');
        telegramBot = bot;
        return bot;
        
    } catch (error) {
        console.error('❌ Ошибка запуска Telegram Bot:', error.message);
        console.error(error.stack);
        return null;
    }
};

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
const logAudit = async (userId, action, entityType, entityId, details = {}) => {
    try {
        await db.run(
            `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, created_at) 
             VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [userId, action, entityType, entityId, JSON.stringify(details)]
        );
    } catch (error) {
        console.error('Ошибка записи в audit_log:', error);
    }
};

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
    const re = /^\+?[1-9]\d{10,14}$/;
    return re.test(phone.replace(/\D/g, ''));
};

// ==================== JWT МИДЛВАР ====================
const authMiddleware = (roles = []) => {
    return async (req, res, next) => {
        const authHeader = req.headers.authorization;
        
        // Публичные маршруты
        const publicRoutes = [
            'GET /',
            'GET /health',
            'GET /api/system/info',
            'GET /api/subscriptions',
            'GET /api/categories',
            'GET /api/categories/*',
            'GET /api/services',
            'GET /api/services/*',
            'POST /api/auth/register',
            'POST /api/auth/login',
            'POST /api/auth/refresh',
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
        
        try {
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
                    `SELECT id, email, first_name, last_name, phone, role, 
                            subscription_plan, subscription_status, subscription_expires,
                            initial_fee_paid, initial_fee_amount, is_active, avatar_url,
                            balance, rating, completed_tasks
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
                    subscription_plan: user.subscription_plan,
                    subscription_status: user.subscription_status,
                    subscription_expires: user.subscription_expires,
                    initial_fee_paid: user.initial_fee_paid,
                    initial_fee_amount: user.initial_fee_amount,
                    avatar_url: user.avatar_url,
                    balance: user.balance,
                    rating: user.rating,
                    completed_tasks: user.completed_tasks
                };
                
                if (roles.length > 0 && !roles.includes(user.role)) {
                    return res.status(403).json({ 
                        success: false, 
                        error: 'Недостаточно прав' 
                    });
                }
                
                await logAudit(user.id, 'auth_success', 'user', user.id, {
                    route: currentRoute
                });
                
                next();
                
            } catch (jwtError) {
                if (jwtError.name === 'TokenExpiredError') {
                    return res.status(401).json({ 
                        success: false, 
                        error: 'Токен истёк' 
                    });
                }
                
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

// ==================== ФОНОВЫЕ ЗАДАЧИ ====================
const startBackgroundJobs = () => {
    console.log('🔄 Запуск фоновых задач...');
    
    // Проверка просроченных задач
    setInterval(async () => {
        try {
            const now = new Date();
            const expiredTasks = await db.all(
                `SELECT id, task_number, client_id, performer_id 
                 FROM tasks 
                 WHERE status NOT IN ('completed', 'cancelled', 'rejected', 'expired') 
                 AND deadline < ?`,
                [now.toISOString()]
            );
            
            for (const task of expiredTasks) {
                await db.run(
                    `UPDATE tasks SET status = 'expired', updated_at = CURRENT_TIMESTAMP 
                     WHERE id = ?`,
                    [task.id]
                );
                
                await db.run(
                    `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
                     VALUES (?, ?, ?, ?)`,
                    [task.id, 'expired', 0, 'Задача просрочена автоматически']
                );
            }
            
            if (expiredTasks.length > 0) {
                console.log(`⏰ Автоматически просрочено задач: ${expiredTasks.length}`);
            }
            
        } catch (error) {
            console.error('Ошибка проверки просроченных задач:', error);
        }
    }, 5 * 60 * 1000);
    
    console.log('✅ Фоновые задачи запущены');
};

// ==================== API МАРШРУТЫ ====================

// Главная
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: '🌸 Добро пожаловать в Женский Консьерж API',
        version: '5.2.0',
        status: '🟢 Работает',
        timestamp: new Date().toISOString(),
        endpoints: {
            auth: [
                'POST /api/auth/register - Регистрация',
                'POST /api/auth/login - Вход',
                'GET /api/auth/profile - Профиль'
            ],
            categories: [
                'GET /api/categories - Все категории',
                'GET /api/categories/:id/services - Услуги категории'
            ],
            services: [
                'GET /api/services - Все услуги'
            ],
            subscriptions: [
                'GET /api/subscriptions - Все подписки',
                'POST /api/subscriptions/subscribe - Оформить подписку'
            ],
            tasks: [
                'GET /api/tasks - Мои задачи',
                'POST /api/tasks - Создать задачу',
                'GET /api/tasks/:id - Получить задачу'
            ]
        },
        telegram_bot: telegramBot ? '✅ Активен' : '⚠️ Отключен',
        database: '✅ Подключена'
    });
});

// Health check
app.get('/health', async (req, res) => {
    try {
        await db.get('SELECT 1 as status');
        
        res.json({
            success: true,
            status: 'OK',
            database: 'connected',
            telegram_bot: telegramBot ? 'connected' : 'disabled',
            timestamp: new Date().toISOString()
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

// Регистрация
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, first_name, last_name, phone, subscription_plan = 'essential' } = req.body;
        
        if (!email || !password || !first_name || !last_name || !phone) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля'
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
        
        if (!validatePhone(phone)) {
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
        
        const initialFeePaid = subscription.initial_fee === 0 ? 1 : 0;
        const subscriptionStatus = initialFeePaid ? 'active' : 'pending';
        
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 30);
        const expiryDateStr = expiryDate.toISOString().split('T')[0];
        
        const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(first_name)}+${encodeURIComponent(last_name)}&background=FF6B8B&color=fff&bold=true`;
        
        const result = await db.run(
            `INSERT INTO users 
            (email, password, first_name, last_name, phone, role, 
             subscription_plan, subscription_status, subscription_expires,
             initial_fee_paid, initial_fee_amount, avatar_url, balance) 
            VALUES (?, ?, ?, ?, ?, 'client', ?, ?, ?, ?, ?, ?, 0)`,
            [
                email,
                hashedPassword,
                first_name,
                last_name,
                phone,
                subscription_plan,
                subscriptionStatus,
                initialFeePaid ? expiryDateStr : null,
                initialFeePaid,
                subscription.initial_fee,
                avatarUrl
            ]
        );
        
        const userId = result.lastID;
        
        const user = await db.get(
            `SELECT id, email, first_name, last_name, phone, role, 
                    subscription_plan, subscription_status, subscription_expires,
                    initial_fee_paid, initial_fee_amount, avatar_url
             FROM users WHERE id = ?`,
            [userId]
        );
        
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
        
        await db.run(
            `INSERT INTO notifications (user_id, title, message, type) 
             VALUES (?, ?, ?, ?)`,
            [user.id, 'Добро пожаловать!', 
             'Регистрация прошла успешно. Добро пожаловать в Женский Консьерж!', 
             'success']
        );
        
        await logAudit(user.id, 'register', 'user', user.id, {
            email: user.email,
            subscription_plan: user.subscription_plan
        });
        
        res.status(201).json({
            success: true,
            message: 'Регистрация успешно завершена!',
            data: { 
                user,
                token,
                requires_initial_fee: !initialFeePaid,
                initial_fee_amount: subscription.initial_fee
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
        
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            await logAudit(user.id, 'login_failed', 'user', user.id, {
                reason: 'wrong_password'
            });
            
            return res.status(401).json({
                success: false,
                error: 'Неверный email или пароль'
            });
        }
        
        if (user.subscription_status === 'pending' && user.initial_fee_paid === 0) {
            return res.status(403).json({
                success: false,
                error: 'Для входа необходимо оплатить вступительный взнос',
                requires_initial_fee: true,
                initial_fee_amount: user.initial_fee_amount,
                user: {
                    id: user.id,
                    email: user.email,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    subscription_plan: user.subscription_plan,
                    subscription_status: user.subscription_status
                }
            });
        }
        
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
        
        delete user.password;
        
        await db.run(
            'UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [user.id]
        );
        
        await logAudit(user.id, 'login_success', 'user', user.id, {});
        
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

// Профиль
app.get('/api/auth/profile', authMiddleware(), async (req, res) => {
    try {
        const user = await db.get(
            `SELECT id, email, first_name, last_name, phone, role, 
                    subscription_plan, subscription_status, subscription_expires,
                    telegram_username, telegram_id, avatar_url, balance, 
                    initial_fee_paid, initial_fee_amount, rating, completed_tasks,
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
        
        const subscription = await db.get(
            'SELECT * FROM subscriptions WHERE name = ?',
            [user.subscription_plan || 'essential']
        );
        
        const stats = await db.get(`
            SELECT 
                COUNT(*) as total_tasks,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
                SUM(CASE WHEN status IN ('new', 'searching', 'assigned', 'in_progress') THEN 1 ELSE 0 END) as active_tasks,
                SUM(price) as total_spent
            FROM tasks 
            WHERE client_id = ?
        `, [req.user.id]);
        
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
                    total_spent: stats?.total_spent || 0,
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

// Категории
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

// Услуги категории
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
        console.error('Ошибка получения услуг категории:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения услуг категории'
        });
    }
});

// Подписки
app.get('/api/subscriptions', async (req, res) => {
    try {
        const subscriptions = await db.all(
            'SELECT * FROM subscriptions WHERE is_active = 1 ORDER BY sort_order ASC, price_monthly ASC'
        );
        
        const subscriptionsWithParsedFeatures = subscriptions.map(sub => ({
            ...sub,
            features: typeof sub.features === 'string' ? JSON.parse(sub.features) : sub.features,
            color: sub.name === 'essential' ? '#FF6B8B' : '#9B59B6'
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
            additional_requirements,
            price
        } = req.body;
        
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
        
        const user = await db.get(
            'SELECT subscription_status, initial_fee_paid, balance FROM users WHERE id = ?',
            [req.user.id]
        );
        
        if (!user || user.subscription_status !== 'active') {
            return res.status(403).json({
                success: false,
                error: 'Ваша подписка не активна'
            });
        }
        
        if (!user.initial_fee_paid) {
            return res.status(403).json({
                success: false,
                error: 'Для создания задач необходимо оплатить вступительный взнос'
            });
        }
        
        const deadlineDate = new Date(deadline);
        if (deadlineDate < new Date()) {
            return res.status(400).json({
                success: false,
                error: 'Дата дедлайна не может быть в прошлом'
            });
        }
        
        let finalPrice = price;
        if (!finalPrice || finalPrice < 0) {
            return res.status(400).json({
                success: false,
                error: 'Укажите корректную цену задачи'
            });
        }
        
        if (finalPrice > user.balance) {
            return res.status(400).json({
                success: false,
                error: 'Недостаточно средств на балансе',
                balance: user.balance,
                required: finalPrice
            });
        }
        
        const taskNumber = generateTaskNumber();
        
        const result = await db.run(
            `INSERT INTO tasks 
            (task_number, title, description, client_id, category_id, service_id, 
             priority, price, address, deadline, contact_info, additional_requirements, 
             is_approved) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
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
                additional_requirements || null
            ]
        );
        
        const taskId = result.lastID;
        
        await db.run(
            'UPDATE users SET balance = balance - ? WHERE id = ?',
            [finalPrice, req.user.id]
        );
        
        const transactionId = `TASK-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
        await db.run(
            `INSERT INTO payments 
            (user_id, task_id, amount, description, status, payment_method, transaction_id) 
            VALUES (?, ?, ?, ?, 'completed', 'task_payment', ?)`,
            [
                req.user.id,
                taskId,
                finalPrice,
                `Оплата задачи: ${title}`,
                transactionId
            ]
        );
        
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
        
        await db.run(
            `INSERT INTO notifications (user_id, title, message, type, data) 
             VALUES (?, ?, ?, ?, ?)`,
            [
                req.user.id,
                'Задача создана!',
                `Задача "${title}" успешно создана. Номер: ${taskNumber}.`,
                'success',
                JSON.stringify({ task_id: task.id, task_number: taskNumber })
            ]
        );
        
        await logAudit(req.user.id, 'create_task', 'task', taskId, {
            task_number: taskNumber,
            title: title,
            price: finalPrice
        });
        
        res.status(201).json({
            success: true,
            message: 'Задача успешно создана!',
            data: { 
                task,
                balance_after: user.balance - finalPrice
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

// Получение задач пользователя
app.get('/api/tasks', authMiddleware(), async (req, res) => {
    try {
        const { status, category_id, limit = 50, offset = 0 } = req.query;
        
        let query = `
            SELECT t.*, 
                   c.display_name as category_name,
                   c.icon as category_icon,
                   s.name as service_name
            FROM tasks t
            LEFT JOIN categories c ON t.category_id = c.id
            LEFT JOIN services s ON t.service_id = s.id
            WHERE t.client_id = ?
        `;
        
        const params = [req.user.id];
        
        if (status && status !== 'all') {
            query += ' AND t.status = ?';
            params.push(status);
        }
        
        if (category_id) {
            query += ' AND t.category_id = ?';
            params.push(category_id);
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
                    u2.first_name as performer_first_name,
                    u2.last_name as performer_last_name,
                    u2.phone as performer_phone,
                    u2.avatar_url as performer_avatar,
                    u2.rating as performer_rating
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
        
        const statusHistory = await db.all(
            `SELECT tsh.*, u.first_name, u.last_name
             FROM task_status_history tsh
             LEFT JOIN users u ON tsh.changed_by = u.id
             WHERE tsh.task_id = ?
             ORDER BY tsh.created_at ASC`,
            [taskId]
        );
        
        res.json({
            success: true,
            data: {
                task: {
                    ...task,
                    status_history: statusHistory
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

// Обслуживание статических файлов
app.use(express.static(path.join(__dirname, 'public')));

// SPA маршрутизация
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({
            success: false,
            error: 'API маршрут не найден'
        });
    }
    
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Глобальный обработчик ошибок
app.use((err, req, res, next) => {
    console.error('Необработанная ошибка:', err);
    
    res.status(500).json({
        success: false,
        error: 'Внутренняя ошибка сервера'
    });
});

// ==================== ФУНКЦИИ ОЧИСТКИ ====================
const cleanupResources = async () => {
    console.log('🧹 Очистка ресурсов...');
    
    // Останавливаем Telegram Bot
    if (telegramBot) {
        try {
            telegramBot.stopPolling();
            console.log('🤖 Telegram Bot остановлен');
        } catch (e) {
            console.log('⚠️ Ошибка остановки Telegram Bot:', e.message);
        }
    }
    
    // Останавливаем интервалы
    if (botPollingInterval) {
        clearInterval(botPollingInterval);
        botPollingInterval = null;
    }
    
    // Закрываем базу данных
    if (db) {
        try {
            await db.close();
            console.log('🗃️ База данных закрыта');
        } catch (e) {
            console.log('⚠️ Ошибка закрытия базы данных:', e.message);
        }
    }
    
    console.log('✅ Ресурсы очищены');
};

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎀 ЗАПУСК ЖЕНСКОГО КОНСЬЕРЖА v5.2.0 (исправленная версия)');
        console.log('='.repeat(80));
        console.log(`🌐 PORT: ${process.env.PORT || 3000}`);
        console.log(`🏷️  NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🔐 JWT_SECRET: ${process.env.JWT_SECRET ? 'configured' : 'using default'}`);
        console.log(`🤖 TELEGRAM_BOT: ${process.env.TELEGRAM_BOT_TOKEN ? 'configured' : 'not configured'}`);
        console.log('='.repeat(80));
        
        // Инициализируем базу данных
        await initDatabase();
        console.log('✅ База данных готова');
        
        const PORT = process.env.PORT || 3000;
        
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log('\n' + '='.repeat(80));
            console.log(`✅ Сервер запущен на порту ${PORT}`);
            console.log(`🌐 http://localhost:${PORT}`);
            console.log(`🌐 http://localhost:${PORT}/app - Главное приложение`);
            console.log(`🏥 Health check: http://localhost:${PORT}/health`);
            console.log('='.repeat(80));
            console.log('🎀 СИСТЕМА ГОТОВА К РАБОТЕ!');
            console.log('='.repeat(80));
            
            console.log('\n🔑 ТЕСТОВЫЕ АККАУНТЫ ДЛЯ ВХОДА:');
            console.log('='.repeat(60));
            console.log('👑 Суперадмин: superadmin@concierge.ru / admin123');
            console.log('👨‍💼 Админ: admin@concierge.ru / admin123');
            console.log('👩‍🏫 Помощник 1: performer1@concierge.ru / performer123');
            console.log('👩‍🏫 Помощник 2: performer2@concierge.ru / performer123');
            console.log('👩 Клиент Премиум: client1@example.com / client123');
            console.log('👩 Клиент Эссеншл: client2@example.com / client123');
            console.log('='.repeat(60));
        });
        
        // Обработка graceful shutdown
        const shutdown = async (signal) => {
            console.log(`\n🛑 Получен сигнал ${signal}, остановка сервера...`);
            
            await cleanupResources();
            
            server.close(() => {
                console.log('👋 HTTP сервер закрыт');
                process.exit(0);
            });
            
            setTimeout(() => {
                console.log('⚠️ Принудительная остановка');
                process.exit(1);
            }, 10000);
        };
        
        // Обработка сигналов
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
        
        // Обработка необработанных ошибок
        process.on('uncaughtException', (error) => {
            console.error('⚠️ Необработанная ошибка:', error.message);
            console.error(error.stack);
        });
        
        process.on('unhandledRejection', (reason, promise) => {
            console.error('⚠️ Необработанный промис:', reason);
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        console.error('Stack trace:', error.stack);
        await cleanupResources();
        process.exit(1);
    }
};

// Запуск сервера
startServer();
