require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs');
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

// CORS настройки
const corsOptions = {
    origin: function (origin, callback) {
        const allowedOrigins = [
            'https://sergeynikishin555123123-lab--86fa.twc1.net',
            'http://localhost:3000',
            'http://localhost:8080',
            'http://localhost:5500',
            'http://127.0.0.1:5500',
            'https://concierge-service.ru',
            'http://concierge-service.ru',
            'https://your-domain.com'
        ];
        
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('CORS политика не разрешает доступ с этого источника'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'X-Request-ID']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Парсинг тела запроса
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// Логирование запросов
app.use((req, res, next) => {
    const requestId = crypto.randomBytes(8).toString('hex');
    req.requestId = requestId;
    
    const startTime = Date.now();
    
    console.log(`🌐 [${requestId}] ${req.method} ${req.path} - ${req.ip} - ${new Date().toISOString()}`);
    
    if (req.method === 'POST' && req.path.includes('/api/')) {
        console.log(`📦 [${requestId}] Body:`, JSON.stringify(req.body).substring(0, 200));
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

        // Подписки (тарифные планы)
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

        // Категории услуг
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

        // Задачи (заказы)
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

        // История статусов задач
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

        // Сообщения в чате задач
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

        // Блокировки пользователей
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

        // Журнал действий
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

        // Настройки системы
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

        // Индексы для производительности
        await db.exec(`
            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
            CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
            CREATE INDEX IF NOT EXISTS idx_users_subscription ON users(subscription_plan, subscription_status);
            CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);
            CREATE INDEX IF NOT EXISTS idx_tasks_client ON tasks(client_id);
            CREATE INDEX IF NOT EXISTS idx_tasks_performer ON tasks(performer_id);
            CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
            CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category_id);
            CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline);
            CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);
            CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
            CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
            CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
            CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
            CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
            CREATE INDEX IF NOT EXISTS idx_messages_task ON task_messages(task_id);
            CREATE INDEX IF NOT EXISTS idx_messages_user ON task_messages(user_id);
            CREATE INDEX IF NOT EXISTS idx_status_history_task ON task_status_history(task_id);
            CREATE INDEX IF NOT EXISTS idx_services_category ON services(category_id);
            CREATE INDEX IF NOT EXISTS idx_services_active ON services(is_active);
            CREATE INDEX IF NOT EXISTS idx_categories_active ON categories(is_active, sort_order);
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
                ['support_hours', 'Ежедневно с 9:00 до 21:00', 'Часы работы поддержки', 'general', 1],
                ['default_currency', 'RUB', 'Валюта по умолчанию', 'payment', 0],
                ['initial_fee_enabled', '1', 'Включен вступительный взнос', 'payment', 0],
                ['task_auto_cancel_hours', '24', 'Часов до автоматической отмены задачи', 'tasks', 0],
                ['min_task_price', '500', 'Минимальная цена задачи', 'payment', 0],
                ['max_task_price', '50000', 'Максимальная цена задачи', 'payment', 0],
                ['telegram_bot_enabled', '1', 'Включен Telegram бот', 'telegram', 0],
                ['new_user_welcome_message', 'Добро пожаловать в Женский Консьерж!', 'Приветственное сообщение', 'notifications', 0],
                ['task_created_message', 'Ваша задача успешно создана!', 'Сообщение при создании задачи', 'notifications', 0],
                ['task_completed_message', 'Задача завершена! Пожалуйста, оцените работу.', 'Сообщение при завершении задачи', 'notifications', 0]
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
                    '["До 5 задач в месяц", "Базовые услуги", "Поддержка по email", "Стандартное время ответа", "Базовые гарантии"]',
                    '#FF6B8B', 1, 1
                ],
                [
                    'premium', 'Премиум', 'Полный доступ ко всем услугам и приоритетная поддержка',
                    1990, 19900, 1000, 999,
                    '["Неограниченные задачи", "Все услуги премиум-класса", "Приоритетная поддержка 24/7", "Личный помощник", "Расширенные гарантии", "Гибкая отмена и перенос", "Скидки на дополнительные услуги", "Ранний доступ к новым функциям"]',
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
                ['events_and_entertainment', 'Мероприятия', 'Организация мероприятий', '🎉', '#E74C3C', 6, 1],
                ['shopping_and_delivery', 'Покупки и доставка', 'Помощь с покупками и доставкой', '🛍️', '#1ABC9C', 7, 1],
                ['business_and_finance', 'Бизнес и финансы', 'Бизнес-помощь и финансовые консультации', '💼', '#34495E', 8, 1]
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
                [categoryMap.home_and_household, 'Стирка и глажка', 'Стирка, сушка и глажка белья с доставкой', 1000, '4-6 часов'],
                [categoryMap.home_and_household, 'Мелкий ремонт', 'Мелкий бытовой ремонт по дому', 2000, '2-3 часа'],
                [categoryMap.home_and_household, 'Организация пространства', 'Расхламление и организация хранения вещей', 2500, '3-4 часа'],
                
                // Дети и семья
                [categoryMap.family_and_children, 'Няня на час', 'Присмотр за детьми на несколько часов', 500, '1 час'],
                [categoryMap.family_and_children, 'Репетитор для ребенка', 'Помощь с уроками по школьным предметам', 800, '1 час'],
                [categoryMap.family_and_children, 'Сопровождение на кружки', 'Сопровождение детей на занятия и обратно', 700, '2-3 часа'],
                [categoryMap.family_and_children, 'Подготовка к школе', 'Помощь с подготовкой к учебному году', 1500, '3-4 часа'],
                [categoryMap.family_and_children, 'Организация дня рождения', 'Помощь в организации детского праздника', 4000, '5-6 часов'],
                
                // Красота и здоровье
                [categoryMap.beauty_and_health, 'Маникюр на дому', 'Профессиональный маникюр с выездом', 1200, '1.5 часа'],
                [categoryMap.beauty_and_health, 'Стрижка и укладка', 'Парикмахерские услуги на дому', 1500, '2 часа'],
                [categoryMap.beauty_and_health, 'Массаж', 'Расслабляющий или лечебный массаж', 2000, '1 час'],
                [categoryMap.beauty_and_health, 'Визажист', 'Профессиональный макияж', 2500, '1.5 часа'],
                [categoryMap.beauty_and_health, 'Косметолог', 'Косметологические процедуры на дому', 3000, '2 часа'],
                
                // Образование
                [categoryMap.courses_and_education, 'Репетитор по предмету', 'Индивидуальные занятия по школьным предметам', 1000, '1 час'],
                [categoryMap.courses_and_education, 'Подготовка к ЕГЭ/ОГЭ', 'Интенсивная подготовка к экзаменам', 1500, '1.5 часа'],
                [categoryMap.courses_and_education, 'Иностранные языки', 'Занятия иностранными языками', 1200, '1 час'],
                [categoryMap.courses_and_education, 'Компьютерные курсы', 'Обучение компьютерной грамотности', 1300, '1.5 часа'],
                [categoryMap.courses_and_education, 'Музыкальные занятия', 'Уроки игры на музыкальных инструментах', 1400, '1 час'],
                
                // Питомцы
                [categoryMap.pets, 'Выгул собак', 'Прогулка с собакой в удобное время', 500, '1 час'],
                [categoryMap.pets, 'Передержка животных', 'Присмотр за питомцем во время вашего отсутствия', 1000, 'сутки'],
                [categoryMap.pets, 'Груминг', 'Стрижка и уход за шерстью животных', 2000, '2-3 часа'],
                [categoryMap.pets, 'Ветеринар на дом', 'Вызов ветеринара для консультации', 2500, '1 час'],
                [categoryMap.pets, 'Дрессировка', 'Занятия по дрессировке собак', 3000, '1 час'],
                
                // Мероприятия
                [categoryMap.events_and_entertainment, 'Организация праздника', 'Полная организация мероприятия', 10000, '6-8 часов'],
                [categoryMap.events_and_entertainment, 'Кейтеринг', 'Организация питания на мероприятии', 8000, '4-6 часов'],
                [categoryMap.events_and_entertainment, 'Фотосессия', 'Профессиональная фотосъемка', 5000, '2-3 часа'],
                [categoryMap.events_and_entertainment, 'Ведущий/аниматор', 'Услуги ведущего или аниматора', 4000, '3-4 часа'],
                [categoryMap.events_and_entertainment, 'Декорации', 'Оформление помещения для мероприятия', 6000, '4-5 часов'],
                
                // Покупки и доставка
                [categoryMap.shopping_and_delivery, 'Покупка продуктов', 'Закупка продуктов по списку', 800, '2-3 часа'],
                [categoryMap.shopping_and_delivery, 'Доставка товаров', 'Доставка покупок из магазинов', 700, '1-2 часа'],
                [categoryMap.shopping_and_delivery, 'Выбор подарков', 'Помощь в выборе и покупке подарков', 1500, '3-4 часа'],
                [categoryMap.shopping_and_delivery, 'Возврат товаров', 'Возврат товаров в магазины', 600, '2-3 часа'],
                [categoryMap.shopping_and_delivery, 'Сопутствующие покупки', 'Покупка бытовых товаров и средств', 900, '2-3 часа'],
                
                // Бизнес и финансы
                [categoryMap.business_and_finance, 'Бухгалтерские услуги', 'Помощь с бухгалтерией и отчетностью', 3000, '3-4 часа'],
                [categoryMap.business_and_finance, 'Консультация по налогам', 'Налоговые консультации', 2500, '2 часа'],
                [categoryMap.business_and_finance, 'Составление резюме', 'Помощь в составлении профессионального резюме', 2000, '2 часа'],
                [categoryMap.business_and_finance, 'Подготовка документов', 'Помощь в подготовке деловых документов', 1800, '2-3 часа'],
                [categoryMap.business_and_finance, 'Финансовое планирование', 'Помощь в планировании личного бюджета', 2200, '2 часа']
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

        // 5. Тестовые пользователи (только если их нет)
        const usersExist = await db.get("SELECT 1 FROM users WHERE email = 'admin@concierge.ru'");
        if (!usersExist) {
            // Создаем хеш пароля для всех тестовых пользователей
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
                ['manager@concierge.ru', passwordHash, 'Ольга', 'Сидорова', '+79993334455', 'manager', 'premium', 'active', expiryDateStr, null, '@manager', 1, 1000, 50000, 1],
                
                // Помощники
                ['performer1@concierge.ru', performerPasswordHash, 'Анна', 'Кузнецова', '+79994445566', 'performer', 'essential', 'active', expiryDateStr, null, '@anna_helper', 1, 500, 0, 1],
                ['performer2@concierge.ru', performerPasswordHash, 'Мария', 'Смирнова', '+79995556677', 'performer', 'essential', 'active', expiryDateStr, null, '@maria_helper', 1, 500, 0, 1],
                ['performer3@concierge.ru', performerPasswordHash, 'Ирина', 'Попова', '+79996667788', 'performer', 'essential', 'active', expiryDateStr, null, '@irina_helper', 1, 500, 0, 1],
                
                // Клиенты
                ['client1@example.com', clientPasswordHash, 'Елена', 'Васильева', '+79997778899', 'client', 'premium', 'active', expiryDateStr, null, '@elena_client', 1, 1000, 10000, 1],
                ['client2@example.com', clientPasswordHash, 'Наталья', 'Федорова', '+79998889900', 'client', 'essential', 'active', expiryDateStr, null, '@natalia_client', 1, 500, 5000, 1],
                ['client3@example.com', clientPasswordHash, 'Светлана', 'Михайлова', '+79999990011', 'client', 'essential', 'pending', null, null, '@svetlana_client', 0, 500, 0, 1],
                ['client4@example.com', clientPasswordHash, 'Татьяна', 'Алексеева', '+79990001122', 'client', 'essential', 'active', expiryDateStr, null, '@tatiana_client', 1, 500, 3000, 1]
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

        // 6. Тестовые задачи
        const tasksExist = await db.get("SELECT 1 FROM tasks LIMIT 1");
        if (!tasksExist) {
            // Получаем ID пользователей
            const clients = await db.all("SELECT id FROM users WHERE role = 'client' ORDER BY id LIMIT 2");
            const performers = await db.all("SELECT id FROM users WHERE role = 'performer' ORDER BY id LIMIT 2");
            const categories = await db.all("SELECT id FROM categories ORDER BY id LIMIT 3");
            const services = await db.all("SELECT id FROM services ORDER BY id LIMIT 5");

            if (clients.length >= 2 && performers.length >= 2 && categories.length >= 3 && services.length >= 5) {
                const now = new Date();
                const tasks = [
                    // Завершенные задачи
                    {
                        task_number: `TASK-${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}-0001`,
                        title: 'Уборка 3-х комнатной квартиры после ремонта',
                        description: 'Необходима генеральная уборка после ремонта. Особое внимание кухне и санузлу. Площадь 85 кв.м. Есть домашние животные (кот).',
                        client_id: clients[0].id,
                        performer_id: performers[0].id,
                        category_id: categories[0].id,
                        service_id: services[0].id,
                        status: 'completed',
                        priority: 'high',
                        price: 3500,
                        address: 'Москва, ул. Тверская, д. 25, кв. 48',
                        deadline: new Date(now.getTime() - 2*24*60*60*1000).toISOString(),
                        contact_info: '+79997778899, Елена',
                        additional_requirements: 'Есть кот, необходимо убрать шерсть. Аллергия на хлоросодержащие средства.',
                        is_urgent: 0,
                        is_approved: 1,
                        completed_at: new Date(now.getTime() - 1*24*60*60*1000).toISOString(),
                        rating: 5
                    },
                    {
                        task_number: `TASK-${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}-0002`,
                        title: 'Няня на субботу с 10:00 до 18:00',
                        description: 'Присмотреть за ребенком 6 лет. Помочь с обедом, погулять в парке, поиграть в развивающие игры. Ребенок активный, любит рисовать и читать.',
                        client_id: clients[0].id,
                        performer_id: performers[1].id,
                        category_id: categories[1].id,
                        service_id: services[1].id,
                        status: 'completed',
                        priority: 'medium',
                        price: 2000,
                        address: 'Москва, ул. Ленина, д. 10, кв. 12',
                        deadline: new Date(now.getTime() - 7*24*60*60*1000).toISOString(),
                        contact_info: '+79997778899, Елена',
                        additional_requirements: 'Ребенок аллергик (на цитрусовые и шоколад). Любит лего и рисование. Есть все необходимые игрушки.',
                        is_urgent: 0,
                        is_approved: 1,
                        completed_at: new Date(now.getTime() - 6*24*60*60*1000).toISOString(),
                        rating: 4
                    },
                    
                    // Задачи в работе
                    {
                        task_number: `TASK-${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}-0003`,
                        title: 'Маникюр с французским дизайном',
                        description: 'Сделать классический маникюр с покрытием гель-лаком. Французский дизайн. Ногти средней длины, нужна коррекция формы.',
                        client_id: clients[1].id,
                        performer_id: performers[0].id,
                        category_id: categories[2].id,
                        service_id: services[2].id,
                        status: 'in_progress',
                        priority: 'medium',
                        price: 1500,
                        address: 'Москва, пр. Мира, д. 15, кв. 7',
                        deadline: new Date(now.getTime() + 2*24*60*60*1000).toISOString(),
                        contact_info: '+79998889900, Наталья',
                        additional_requirements: 'Для особого случая. Нужен мастер со своим оборудованием. Аллергия на некоторые марки гель-лака (уточнить у мастера).',
                        is_urgent: 0,
                        is_approved: 1,
                        start_time: new Date(now.getTime() - 2*60*60*1000).toISOString()
                    },
                    {
                        task_number: `TASK-${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}-0004`,
                        title: 'Репетитор по математике 8 класс',
                        description: 'Помочь с подготовкой к контрольной по алгебре. Тема: квадратные уравнения, графики функций. Нужно 2 часа занятий с объяснением сложных моментов.',
                        client_id: clients[1].id,
                        performer_id: null,
                        category_id: categories[3].id,
                        service_id: services[3].id,
                        status: 'searching',
                        priority: 'high',
                        price: 1200,
                        address: 'Москва, ул. Гагарина, д. 8, кв. 32',
                        deadline: new Date(now.getTime() + 3*24*60*60*1000).toISOString(),
                        contact_info: '+79998889900, Наталья',
                        additional_requirements: 'У ребенка трудности с пониманием темы, нужен терпеливый репетитор с опытом работы с детьми. Предпочтительно женщина.',
                        is_urgent: 1,
                        is_approved: 1
                    },
                    
                    // Новая задача
                    {
                        task_number: `TASK-${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}-0005`,
                        title: 'Выгул собаки ежедневно утром',
                        description: 'Нужно выгуливать собаку (лабрадор, 3 года) каждое утро с 8:00 до 9:00 в течение недели. Собака дружелюбная, знает основные команды.',
                        client_id: clients[0].id,
                        performer_id: null,
                        category_id: categories[4].id,
                        service_id: services[4].id,
                        status: 'new',
                        priority: 'medium',
                        price: 3000,
                        address: 'Москва, ул. Пушкина, д. 42, кв. 15',
                        deadline: new Date(now.getTime() + 7*24*60*60*1000).toISOString(),
                        contact_info: '+79997778899, Елена',
                        additional_requirements: 'Собака на поводке, есть любимые игрушки для прогулки. Важно не отпускать с поводка в общественных местах.',
                        is_urgent: 0,
                        is_approved: 1
                    }
                ];

                for (const task of tasks) {
                    await db.run(
                        `INSERT INTO tasks 
                        (task_number, title, description, client_id, performer_id, 
                         category_id, service_id, status, priority, price, address, 
                         deadline, contact_info, additional_requirements, 
                         is_urgent, is_approved, completed_at, rating, start_time) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [task.task_number, task.title, task.description, task.client_id, task.performer_id,
                         task.category_id, task.service_id, task.status, task.priority, task.price, task.address,
                         task.deadline, task.contact_info, task.additional_requirements,
                         task.is_urgent, task.is_approved, task.completed_at, task.rating, task.start_time]
                    );

                    const taskId = (await db.get("SELECT last_insert_rowid() as id")).id;

                    // Создаем историю статусов
                    const statusHistory = [
                        [taskId, 'new', task.client_id, 'Задача создана клиентом'],
                        task.status === 'completed' || task.status === 'in_progress' ? 
                            [taskId, 'assigned', 2, 'Задача назначена менеджером'] : null,
                        task.status === 'in_progress' ? 
                            [taskId, 'in_progress', task.performer_id, 'Исполнитель приступил к работе'] : null,
                        task.status === 'completed' ? 
                            [taskId, 'completed', task.client_id, 'Клиент подтвердил выполнение'] : null
                    ].filter(Boolean);

                    for (const [task_id, status, changed_by, notes] of statusHistory) {
                        await db.run(
                            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
                             VALUES (?, ?, ?, ?)`,
                            [task_id, status, changed_by, notes]
                        );
                    }

                    // Создаем отзывы для завершенных задач
                    if (task.status === 'completed' && task.rating) {
                        await db.run(
                            `INSERT INTO reviews 
                            (task_id, client_id, performer_id, rating, comment, is_anonymous) 
                            VALUES (?, ?, ?, ?, ?, 0)`,
                            [taskId, task.client_id, task.performer_id, task.rating, 
                             task.rating >= 4 ? 'Отличная работа, все выполнено качественно и в срок!' : 'Нормально, но есть небольшие замечания.']
                        );
                    }

                    // Создаем несколько сообщений в чате
                    if (task.performer_id) {
                        const messages = [
                            [taskId, task.client_id, 'Здравствуйте! Уточните, пожалуйста, площадь квартиры для уборки?'],
                            [taskId, task.performer_id, 'Добрый день! Площадь 85 квадратных метров, как указано в описании.'],
                            [taskId, task.client_id, 'Отлично, поняла. Какие средства для уборки вы используете?'],
                            [taskId, task.performer_id, 'Использую профессиональные гипоаллергенные средства. Если у вас есть предпочтения, могу использовать ваши.']
                        ];

                        for (const [task_id, user_id, message] of messages) {
                            await db.run(
                                `INSERT INTO task_messages (task_id, user_id, message) 
                                 VALUES (?, ?, ?)`,
                                [task_id, user_id, message]
                            );
                        }
                    }
                }
                console.log('✅ Тестовые задачи созданы');
            }
        }

        // 7. Тестовые платежи
        const paymentsExist = await db.get("SELECT 1 FROM payments LIMIT 1");
        if (!paymentsExist) {
            const clients = await db.all("SELECT id FROM users WHERE role = 'client' ORDER BY id LIMIT 2");
            const subscriptions = await db.all("SELECT id FROM subscriptions ORDER BY id");
            const tasks = await db.all("SELECT id, price FROM tasks WHERE status = 'completed' ORDER BY id LIMIT 2");

            if (clients.length >= 2 && subscriptions.length >= 2 && tasks.length >= 2) {
                const now = new Date();
                const payments = [
                    // Вступительные взносы
                    [clients[0].id, subscriptions[1].id, null, 1000, 'Вступительный взнос для подписки Премиум', 'completed', 'initial_fee', `INIT-${now.getTime()}-001`, null],
                    [clients[1].id, subscriptions[0].id, null, 500, 'Вступительный взнос для подписки Эссеншл', 'completed', 'initial_fee', `INIT-${now.getTime()}-002`, null],
                    
                    // Оплата подписок
                    [clients[0].id, subscriptions[1].id, null, 1990, 'Оплата подписки Премиум за месяц', 'completed', 'subscription', `SUB-${now.getTime()}-001`, null],
                    [clients[1].id, subscriptions[0].id, null, 0, 'Оплата подписки Эссеншл за месяц', 'completed', 'subscription', `SUB-${now.getTime()}-002`, null],
                    
                    // Оплата задач
                    [clients[0].id, null, tasks[0].id, tasks[0].price, 'Оплата задачи: Уборка квартиры', 'completed', 'card', `TASK-${now.getTime()}-001`, null],
                    [clients[0].id, null, tasks[1].id, tasks[1].price, 'Оплата задачи: Няня на субботу', 'completed', 'card', `TASK-${now.getTime()}-002`, null]
                ];

                for (const [user_id, subscription_id, task_id, amount, description, status, payment_method, transaction_id, invoice_id] of payments) {
                    await db.run(
                        `INSERT INTO payments 
                        (user_id, subscription_id, task_id, amount, description, 
                         status, payment_method, transaction_id, invoice_id, completed_at) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [user_id, subscription_id, task_id, amount, description, 
                         status, payment_method, transaction_id, invoice_id, 
                         status === 'completed' ? new Date(now.getTime() - Math.random() * 30*24*60*60*1000).toISOString() : null]
                    );
                }
                console.log('✅ Тестовые платежи созданы');
            }
        }

        // 8. Тестовые уведомления
        const notificationsExist = await db.get("SELECT 1 FROM notifications LIMIT 1");
        if (!notificationsExist) {
            const users = await db.all("SELECT id FROM users ORDER BY id LIMIT 5");

            for (const user of users) {
                const notifications = [
                    [user.id, 'Добро пожаловать!', 'Регистрация прошла успешно. Добро пожаловать в Женский Консьерж!', 'success', null, null, JSON.stringify({type: 'welcome'})],
                    [user.id, 'Ваша подписка активирована', 'Подписка успешно активирована. Теперь вы можете создавать задачи.', 'info', '/subscriptions', 'Перейти к подписке', JSON.stringify({type: 'subscription_activated'})],
                    [user.id, 'Новое сообщение в задаче', 'Вам пришло новое сообщение в чате задачи.', 'info', '/tasks', 'Открыть чат', JSON.stringify({type: 'new_message'})],
                    [user.id, 'Задача завершена', 'Ваша задача была успешно завершена. Пожалуйста, оцените работу исполнителя.', 'success', '/tasks', 'Оценить задачу', JSON.stringify({type: 'task_completed'})],
                    [user.id, 'Напоминание о задаче', 'Завтра истекает срок выполнения вашей задачи.', 'warning', '/tasks', 'Проверить задачу', JSON.stringify({type: 'task_reminder'})]
                ];

                for (const [user_id, title, message, type, action_url, action_text, data] of notifications) {
                    await db.run(
                        `INSERT INTO notifications 
                        (user_id, title, message, type, action_url, action_text, data, created_at) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [user_id, title, message, type, action_url, action_text, data, 
                         new Date(Date.now() - Math.random() * 7*24*60*60*1000).toISOString()]
                    );
                }
            }
            console.log('✅ Тестовые уведомления созданы');
        }

        console.log('🎉 Все начальные данные успешно созданы!');
        
        // Выводим информацию для входа
        console.log('\n🔑 ТЕСТОВЫЕ АККАУНТЫ ДЛЯ ВХОДА:');
        console.log('='.repeat(60));
        console.log('👑 Суперадмин: superadmin@concierge.ru / admin123');
        console.log('👨‍💼 Админ: admin@concierge.ru / admin123');
        console.log('👨‍💼 Менеджер: manager@concierge.ru / admin123');
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
        
        const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
            polling: {
                interval: 300,
                autoStart: true,
                params: {
                    timeout: 10
                }
            },
            request: {
                timeout: 10000
            }
        });
        
        // Обработчик команды /start
        bot.onText(/\/start/, async (msg) => {
            const chatId = msg.chat.id;
            const userId = msg.from.id;
            const userName = msg.from.first_name || 'пользователь';
            const userUsername = msg.from.username ? `@${msg.from.username}` : null;
            
            try {
                // Проверяем, есть ли пользователь в базе
                let user = await db.get(
                    `SELECT u.id, u.first_name, u.last_name, u.role, u.subscription_plan, 
                            u.subscription_status, u.telegram_id, u.telegram_username 
                     FROM users u 
                     WHERE u.telegram_id = ? OR u.telegram_username = ?`,
                    [userId.toString(), userUsername]
                );
                
                let message = `🎀 *Привет, ${userName}!*\n\n`;
                
                if (user) {
                    // Обновляем telegram_id если он изменился или отсутствовал
                    if (!user.telegram_id || user.telegram_id !== userId.toString()) {
                        await db.run(
                            `UPDATE users SET telegram_id = ?, telegram_username = ?, updated_at = CURRENT_TIMESTAMP 
                             WHERE id = ?`,
                            [userId.toString(), userUsername, user.id]
                        );
                        user.telegram_id = userId.toString();
                        user.telegram_username = userUsername;
                    }
                    
                    message += `Рады снова вас видеть! 👋\n`;
                    message += `*Ваш профиль:*\n`;
                    message += `👤 *Имя:* ${user.first_name} ${user.last_name}\n`;
                    message += `🎫 *Роль:* ${getRoleDisplayName(user.role)}\n`;
                    message += `📋 *Подписка:* ${user.subscription_plan === 'premium' ? 'Премиум' : 'Эссеншл'}\n`;
                    message += `📊 *Статус:* ${user.subscription_status === 'active' ? '✅ Активна' : '❌ Не активна'}\n\n`;
                    
                    message += `*Доступные команды:*\n`;
                    message += `/profile - Мой профиль\n`;
                    message += `/tasks - Мои задачи\n`;
                    message += `/balance - Мой баланс\n`;
                    message += `/help - Помощь\n`;
                    message += `/website - Открыть сайт\n`;
                    
                } else {
                    message += `Добро пожаловать в *Женский Консьерж*! 👗\n\n`;
                    message += `Я ваш персональный помощник в бытовых вопросах.\n`;
                    message += `Для начала работы необходимо *зарегистрироваться* на нашем сайте:\n\n`;
                    message += `🌐 [Открыть сайт](https://concierge-service.ru)\n\n`;
                    message += `После регистрации вы сможете:\n`;
                    message += `• Создавать задачи\n`;
                    message += `• Общаться с помощниками\n`;
                    message += `• Отслеживать выполнение\n`;
                    message += `• Получать уведомления\n\n`;
                    message += `_После регистрации привяжите Telegram в настройках профиля._`;
                }
                
                const keyboard = {
                    reply_markup: {
                        keyboard: [
                            [{ text: '🌐 Открыть сайт' }],
                            [{ text: '📋 Мои задачи' }, { text: '👤 Профиль' }],
                            [{ text: '💰 Баланс' }, { text: '🆘 Помощь' }]
                        ],
                        resize_keyboard: true,
                        one_time_keyboard: false
                    },
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true
                };
                
                await bot.sendMessage(chatId, message, keyboard);
                
                // Логируем действие
                await logAudit(user ? user.id : null, 'telegram_start', 'user', userId, {
                    chat_id: chatId,
                    username: userUsername,
                    has_account: !!user
                });
                
            } catch (error) {
                console.error('Ошибка обработки /start:', error);
                await bot.sendMessage(chatId, 
                    'Привет! Я бот Женского Консьержа. К сожалению, возникла техническая ошибка. Пожалуйста, попробуйте позже или обратитесь в поддержку.',
                    { parse_mode: 'Markdown' }
                );
            }
        });
        
        // Команда /profile
        bot.onText(/\/profile/, async (msg) => {
            const chatId = msg.chat.id;
            
            try {
                const user = await db.get(
                    `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.role, 
                            u.subscription_plan, u.subscription_status, u.subscription_expires,
                            u.balance, u.rating, u.completed_tasks, u.avatar_url,
                            COUNT(DISTINCT t.id) as total_tasks,
                            SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed_tasks_count
                     FROM users u
                     LEFT JOIN tasks t ON u.id = t.client_id
                     WHERE u.telegram_id = ?
                     GROUP BY u.id`,
                    [chatId.toString()]
                );
                
                if (!user) {
                    await bot.sendMessage(chatId, 
                        'Вы не привязали Telegram к аккаунту. Сделайте это в настройках профиля на сайте.',
                        { parse_mode: 'Markdown' }
                    );
                    return;
                }
                
                let message = `*👤 Ваш профиль*\n\n`;
                message += `*Имя:* ${user.first_name} ${user.last_name}\n`;
                message += `*Email:* ${user.email}\n`;
                message += `*Телефон:* ${user.phone}\n`;
                message += `*Роль:* ${getRoleDisplayName(user.role)}\n\n`;
                
                message += `*📊 Статистика:*\n`;
                message += `• Всего задач: ${user.total_tasks || 0}\n`;
                message += `• Завершено: ${user.completed_tasks_count || 0}\n`;
                message += `• Рейтинг: ${user.rating ? '⭐'.repeat(Math.round(user.rating)) : 'Еще нет оценок'}\n`;
                message += `• Баланс: ${user.balance}₽\n\n`;
                
                message += `*📋 Подписка:*\n`;
                message += `• Тариф: ${user.subscription_plan === 'premium' ? 'Премиум' : 'Эссеншл'}\n`;
                message += `• Статус: ${user.subscription_status === 'active' ? '✅ Активна' : '❌ Не активна'}\n`;
                if (user.subscription_expires) {
                    const expires = new Date(user.subscription_expires);
                    message += `• Действует до: ${expires.toLocaleDateString('ru-RU')}\n`;
                }
                
                await bot.sendMessage(chatId, message, { 
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '✏️ Изменить профиль', callback_data: 'edit_profile' }],
                            [{ text: '💰 Пополнить баланс', callback_data: 'add_balance' }],
                            [{ text: '📋 Изменить подписку', callback_data: 'change_subscription' }]
                        ]
                    }
                });
                
            } catch (error) {
                console.error('Ошибка получения профиля:', error);
                await bot.sendMessage(chatId, 
                    'Ошибка получения данных профиля. Пожалуйста, попробуйте позже.',
                    { parse_mode: 'Markdown' }
                );
            }
        });
        
        // Команда /tasks
        bot.onText(/\/tasks/, async (msg) => {
            const chatId = msg.chat.id;
            
            try {
                const user = await db.get(
                    `SELECT id, role FROM users WHERE telegram_id = ?`,
                    [chatId.toString()]
                );
                
                if (!user) {
                    await bot.sendMessage(chatId, 
                        'Вы не привязали Telegram к аккаунту. Сделайте это в настройках профиля на сайте.',
                        { parse_mode: 'Markdown' }
                    );
                    return;
                }
                
                let tasks;
                if (user.role === 'client') {
                    tasks = await db.all(
                        `SELECT t.id, t.task_number, t.title, t.status, t.priority, 
                                t.price, t.deadline, c.display_name as category_name
                         FROM tasks t
                         LEFT JOIN categories c ON t.category_id = c.id
                         WHERE t.client_id = ?
                         ORDER BY t.created_at DESC
                         LIMIT 5`,
                        [user.id]
                    );
                } else if (user.role === 'performer') {
                    tasks = await db.all(
                        `SELECT t.id, t.task_number, t.title, t.status, t.priority, 
                                t.price, t.deadline, c.display_name as category_name,
                                u.first_name as client_first_name, u.last_name as client_last_name
                         FROM tasks t
                         LEFT JOIN categories c ON t.category_id = c.id
                         LEFT JOIN users u ON t.client_id = u.id
                         WHERE t.performer_id = ? OR (t.status = 'searching' AND t.performer_id IS NULL)
                         ORDER BY t.created_at DESC
                         LIMIT 5`,
                        [user.id]
                    );
                } else {
                    tasks = await db.all(
                        `SELECT t.id, t.task_number, t.title, t.status, t.priority, 
                                t.price, t.deadline, c.display_name as category_name,
                                u.first_name as client_first_name, u.last_name as client_last_name
                         FROM tasks t
                         LEFT JOIN categories c ON t.category_id = c.id
                         LEFT JOIN users u ON t.client_id = u.id
                         ORDER BY t.created_at DESC
                         LIMIT 5`,
                        []
                    );
                }
                
                if (tasks.length === 0) {
                    await bot.sendMessage(chatId, 
                        'У вас пока нет задач. Создайте первую задачу на сайте!',
                        { parse_mode: 'Markdown' }
                    );
                    return;
                }
                
                let message = `*📋 Ваши задачи (последние 5):*\n\n`;
                
                tasks.forEach((task, index) => {
                    const statusEmoji = {
                        'new': '🆕',
                        'searching': '🔍',
                        'assigned': '👤',
                        'in_progress': '🔄',
                        'completed': '✅',
                        'cancelled': '❌',
                        'rejected': '🚫',
                        'expired': '⏰'
                    }[task.status] || '📝';
                    
                    const priorityEmoji = {
                        'low': '🔵',
                        'medium': '🟡',
                        'high': '🟠',
                        'urgent': '🔴'
                    }[task.priority] || '⚪';
                    
                    message += `${index + 1}. ${statusEmoji} *${task.title}*\n`;
                    message += `   📍 ${task.category_name}\n`;
                    message += `   ${priorityEmoji} ${task.priority}\n`;
                    message += `   ⏰ ${new Date(task.deadline).toLocaleDateString('ru-RU')}\n`;
                    message += `   💰 ${task.price}₽\n`;
                    
                    if (task.client_first_name) {
                        message += `   👤 ${task.client_first_name} ${task.client_last_name}\n`;
                    }
                    
                    message += `   🆔 ${task.task_number}\n\n`;
                });
                
                message += `🌐 Для управления задачами перейдите на сайт.`;
                
                await bot.sendMessage(chatId, message, { 
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🌐 Открыть сайт', url: 'https://concierge-service.ru/tasks' }],
                            [{ text: '➕ Создать задачу', url: 'https://concierge-service.ru/services' }],
                            [{ text: '🔄 Обновить', callback_data: 'refresh_tasks' }]
                        ]
                    }
                });
                
            } catch (error) {
                console.error('Ошибка получения задач:', error);
                await bot.sendMessage(chatId, 
                    'Ошибка получения задач. Пожалуйста, попробуйте позже.',
                    { parse_mode: 'Markdown' }
                );
            }
        });
        
        // Команда /balance
        bot.onText(/\/balance/, async (msg) => {
            const chatId = msg.chat.id;
            
            try {
                const user = await db.get(
                    `SELECT balance, subscription_plan FROM users WHERE telegram_id = ?`,
                    [chatId.toString()]
                );
                
                if (!user) {
                    await bot.sendMessage(chatId, 
                        'Вы не привязали Telegram к аккаунту.',
                        { parse_mode: 'Markdown' }
                    );
                    return;
                }
                
                // Получаем историю платежей
                const payments = await db.all(
                    `SELECT description, amount, status, created_at 
                     FROM payments 
                     WHERE user_id = (SELECT id FROM users WHERE telegram_id = ?)
                     ORDER BY created_at DESC
                     LIMIT 5`,
                    [chatId.toString()]
                );
                
                let message = `*💰 Ваш баланс:* ${user.balance}₽\n\n`;
                message += `*📋 Тариф:* ${user.subscription_plan === 'premium' ? 'Премиум' : 'Эссеншл'}\n\n`;
                
                if (payments.length > 0) {
                    message += `*📜 Последние операции:*\n`;
                    payments.forEach(payment => {
                        const date = new Date(payment.created_at);
                        const statusEmoji = payment.status === 'completed' ? '✅' : 
                                          payment.status === 'pending' ? '⏳' : '❌';
                        message += `• ${statusEmoji} ${payment.description}: ${payment.amount}₽\n`;
                        message += `  📅 ${date.toLocaleDateString('ru-RU')}\n`;
                    });
                } else {
                    message += `*📜 История операций пуста*\n`;
                }
                
                message += `\n*Для пополнения баланса:*\n`;
                message += `1. Перейдите на сайт\n`;
                message += `2. Откройте раздел "Баланс"\n`;
                message += `3. Выберите способ оплаты\n`;
                
                await bot.sendMessage(chatId, message, { 
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '💳 Пополнить баланс', url: 'https://concierge-service.ru/profile' }],
                            [{ text: '📊 Подробная история', url: 'https://concierge-service.ru/profile#payments' }]
                        ]
                    }
                });
                
            } catch (error) {
                console.error('Ошибка получения баланса:', error);
                await bot.sendMessage(chatId, 
                    'Ошибка получения данных баланса. Пожалуйста, попробуйте позже.',
                    { parse_mode: 'Markdown' }
                );
            }
        });
        
        // Команда /help
        bot.onText(/\/help/, async (msg) => {
            const chatId = msg.chat.id;
            
            const message = `*🆘 Помощь по боту*\n\n`;
            message += `*Доступные команды:*\n`;
            message += `/start - Начало работы с ботом\n`;
            message += `/profile - Мой профиль и статистика\n`;
            message += `/tasks - Мои задачи\n`;
            message += `/balance - Мой баланс и история операций\n`;
            message += `/help - Эта справка\n`;
            message += `/website - Открыть сайт\n\n`;
            
            message += `*Как пользоваться:*\n`;
            message += `1. Зарегистрируйтесь на сайте\n`;
            message += `2. Привяжите Telegram в настройках профиля\n`;
            message += `3. Создавайте задачи через сайт\n`;
            message += `4. Получайте уведомления в Telegram\n`;
            message += `5. Общайтесь с помощниками в чате\n\n`;
            
            message += `*Поддержка:*\n`;
            message += `📧 Email: info@concierge-service.ru\n`;
            message += `📞 Телефон: +7 (999) 123-45-67\n`;
            message += `🕐 Часы работы: Ежедневно с 9:00 до 21:00\n\n`;
            
            message += `_Для сложных вопросов рекомендуем обращаться через сайт._`;
            
            await bot.sendMessage(chatId, message, { 
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🌐 Открыть сайт', url: 'https://concierge-service.ru' }],
                        [{ text: '📞 Связаться с поддержкой', url: 'https://concierge-service.ru/contact' }]
                    ]
                }
            });
        });
        
        // Команда /website
        bot.onText(/\/website/, async (msg) => {
            const chatId = msg.chat.id;
            
            await bot.sendMessage(chatId, 
                `🌐 *Женский Консьерж*\n\n` +
                `Перейдите на наш сайт для полного доступа ко всем функциям:\n\n` +
                `🔗 [concierge-service.ru](https://concierge-service.ru)\n\n` +
                `На сайте вы можете:\n` +
                `• Создавать и управлять задачами\n` +
                `• Выбирать помощников\n` +
                `• Общаться в чатах\n` +
                `• Управлять подпиской\n` +
                `• Смотреть историю операций`,
                { 
                    parse_mode: 'Markdown',
                    disable_web_page_preview: false,
                    reply_markup: {
                        inline_keyboard: [[{ text: '🌐 Открыть сайт', url: 'https://concierge-service.ru' }]]
                    }
                }
            );
        });
        
        // Обработка текстовых сообщений
        bot.on('message', async (msg) => {
            const chatId = msg.chat.id;
            const text = msg.text;
            
            // Пропускаем команды
            if (text && text.startsWith('/')) return;
            
            // Проверяем, есть ли пользователь
            const user = await db.get(
                `SELECT id, first_name, role FROM users WHERE telegram_id = ?`,
                [chatId.toString()]
            );
            
            if (!user) {
                await bot.sendMessage(chatId, 
                    'Для общения с ботом необходимо привязать Telegram к аккаунту на сайте.',
                    { parse_mode: 'Markdown' }
                );
                return;
            }
            
            // Если это кнопка "Открыть сайт"
            if (text === '🌐 Открыть сайт') {
                await bot.sendMessage(chatId, 
                    'Открываю сайт...',
                    {
                        reply_markup: {
                            inline_keyboard: [[{ text: '🌐 Перейти на сайт', url: 'https://concierge-service.ru' }]]
                        }
                    }
                );
                return;
            }
            
            // Если это кнопка "Мои задачи"
            if (text === '📋 Мои задачи') {
                // Вызываем команду /tasks
                const mockMsg = { ...msg, text: '/tasks' };
                bot.emit('text', mockMsg);
                return;
            }
            
            // Если это кнопка "Профиль"
            if (text === '👤 Профиль') {
                // Вызываем команду /profile
                const mockMsg = { ...msg, text: '/profile' };
                bot.emit('text', mockMsg);
                return;
            }
            
            // Если это кнопка "Баланс"
            if (text === '💰 Баланс') {
                // Вызываем команду /balance
                const mockMsg = { ...msg, text: '/balance' };
                bot.emit('text', mockMsg);
                return;
            }
            
            // Если это кнопка "Помощь"
            if (text === '🆘 Помощь') {
                // Вызываем команду /help
                const mockMsg = { ...msg, text: '/help' };
                bot.emit('text', mockMsg);
                return;
            }
            
            // Если это кнопка "Статистика"
            if (text === '📊 Статистика') {
                await bot.sendMessage(chatId, 
                    'Для просмотра статистики перейдите на сайт в раздел "Профиль".',
                    { parse_mode: 'Markdown' }
                );
                return;
            }
            
            // Обычное сообщение
            await bot.sendMessage(chatId, 
                `Привет, ${user.first_name}! 👋\n\n` +
                `Я могу помочь вам с:\n` +
                `• Просмотром профиля (/profile)\n` +
                `• Управлением задачами (/tasks)\n` +
                `• Проверкой баланса (/balance)\n` +
                `• Получением справки (/help)\n\n` +
                `Для сложных операций и создания задач используйте сайт.`,
                { parse_mode: 'Markdown' }
            );
        });
        
        // Обработка callback-запросов
        bot.on('callback_query', async (callbackQuery) => {
            const chatId = callbackQuery.message.chat.id;
            const data = callbackQuery.data;
            
            try {
                if (data === 'refresh_tasks') {
                    await bot.answerCallbackQuery(callbackQuery.id);
                    const mockMsg = { chat: { id: chatId }, text: '/tasks' };
                    bot.emit('text', mockMsg);
                    return;
                }
                
                if (data === 'edit_profile') {
                    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Для изменения профиля перейдите на сайт' });
                    await bot.sendMessage(chatId, 
                        'Для изменения данных профиля перейдите на сайт в раздел "Настройки".',
                        {
                            reply_markup: {
                                inline_keyboard: [[{ text: '🌐 Перейти к настройкам', url: 'https://concierge-service.ru/profile/settings' }]]
                            }
                        }
                    );
                    return;
                }
                
                if (data === 'add_balance') {
                    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Переход к пополнению баланса' });
                    await bot.sendMessage(chatId, 
                        'Для пополнения баланса перейдите на сайт:',
                        {
                            reply_markup: {
                                inline_keyboard: [[{ text: '💳 Пополнить баланс', url: 'https://concierge-service.ru/profile/balance' }]]
                            }
                        }
                    );
                    return;
                }
                
                if (data === 'change_subscription') {
                    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Переход к управлению подпиской' });
                    await bot.sendMessage(chatId, 
                        'Для изменения подписки перейдите на сайт:',
                        {
                            reply_markup: {
                                inline_keyboard: [[{ text: '📋 Управление подпиской', url: 'https://concierge-service.ru/subscriptions' }]]
                            }
                        }
                    );
                    return;
                }
                
                await bot.answerCallbackQuery(callbackQuery.id, { text: 'Команда не распознана' });
                
            } catch (error) {
                console.error('Ошибка обработки callback:', error);
                await bot.answerCallbackQuery(callbackQuery.id, { text: 'Произошла ошибка' });
            }
        });
        
        // Функция для отправки уведомлений менеджерам о новой задаче
        const notifyManagersAboutNewTask = async (taskId) => {
            try {
                const managers = await db.all(
                    `SELECT u.telegram_id 
                     FROM users u 
                     WHERE u.role IN ('admin', 'manager', 'superadmin') 
                     AND u.telegram_id IS NOT NULL 
                     AND u.is_active = 1`
                );
                
                const task = await db.get(
                    `SELECT t.task_number, t.title, t.description, t.price, t.address, 
                            t.deadline, t.contact_info, t.priority, t.is_urgent,
                            c.display_name as category_name,
                            u.first_name as client_first_name, u.last_name as client_last_name,
                            u.phone as client_phone
                     FROM tasks t
                     LEFT JOIN categories c ON t.category_id = c.id
                     LEFT JOIN users u ON t.client_id = u.id
                     WHERE t.id = ?`,
                    [taskId]
                );
                
                if (!task || managers.length === 0) return;
                
                const priorityEmoji = {
                    'low': '🔵',
                    'medium': '🟡',
                    'high': '🟠',
                    'urgent': '🔴'
                }[task.priority] || '⚪';
                
                const urgentText = task.is_urgent ? '🚨 *СРОЧНАЯ ЗАДАЧА* 🚨\n\n' : '';
                
                const message = `${urgentText}🆕 *Новая задача создана!*\n\n` +
                               `*${task.title}*\n` +
                               `📋 *Категория:* ${task.category_name}\n` +
                               `👤 *Клиент:* ${task.client_first_name} ${task.client_last_name}\n` +
                               `📞 *Телефон:* ${task.client_phone}\n` +
                               `📍 *Адрес:* ${task.address}\n` +
                               `${priorityEmoji} *Приоритет:* ${task.priority}\n` +
                               `⏰ *Срок:* ${new Date(task.deadline).toLocaleString('ru-RU')}\n` +
                               `💰 *Стоимость:* ${task.price}₽\n` +
                               `🔢 *Номер:* ${task.task_number}\n\n` +
                               `*Описание:*\n${task.description.substring(0, 200)}${task.description.length > 200 ? '...' : ''}\n\n` +
                               `_Требуется назначение исполнителя_`;
                
                for (const manager of managers) {
                    try {
                        await bot.sendMessage(
                            manager.telegram_id,
                            message,
                            { 
                                parse_mode: 'Markdown',
                                disable_web_page_preview: true,
                                reply_markup: {
                                    inline_keyboard: [[
                                        { text: '👁️ Просмотреть задачу', url: `https://concierge-service.ru/admin/tasks/${taskId}` },
                                        { text: '📋 Назначить исполнителя', url: `https://concierge-service.ru/admin/tasks/${taskId}/assign` }
                                    ]]
                                }
                            }
                        );
                    } catch (error) {
                        console.log(`Не удалось отправить уведомление менеджеру ${manager.telegram_id}:`, error.message);
                    }
                }
                
                await logAudit(null, 'telegram_notify_managers', 'task', taskId, {
                    managers_count: managers.length,
                    task_number: task.task_number
                });
                
            } catch (error) {
                console.error('Ошибка отправки уведомлений менеджерам:', error);
                await logAudit(null, 'telegram_notify_error', 'system', null, {
                    error: error.message,
                    task_id: taskId
                });
            }
        };
        
        // Функция для отправки уведомления клиенту о новом сообщении
        const notifyUserAboutNewMessage = async (userId, taskId, messagePreview, senderName) => {
            try {
                const user = await db.get(
                    `SELECT telegram_id FROM users WHERE id = ? AND telegram_id IS NOT NULL AND is_active = 1`,
                    [userId]
                );
                
                if (!user || !user.telegram_id) return;
                
                const task = await db.get(
                    `SELECT task_number, title FROM tasks WHERE id = ?`,
                    [taskId]
                );
                
                if (!task) return;
                
                const message = `💬 *Новое сообщение в задаче*\n\n` +
                               `*${task.title}*\n` +
                               `🔢 ${task.task_number}\n\n` +
                               `👤 *От:* ${senderName}\n` +
                               `📝 *Сообщение:*\n${messagePreview.substring(0, 100)}${messagePreview.length > 100 ? '...' : ''}\n\n` +
                               `_Перейдите в чат задачи, чтобы ответить_`;
                
                await bot.sendMessage(
                    user.telegram_id,
                    message,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '💬 Открыть чат', url: `https://concierge-service.ru/tasks/${taskId}/chat` }
                            ]]
                        }
                    }
                );
                
                await logAudit(null, 'telegram_notify_message', 'task', taskId, {
                    user_id: userId,
                    message_preview: messagePreview.substring(0, 50)
                });
                
            } catch (error) {
                console.error('Ошибка отправки уведомления о сообщении:', error);
            }
        };
        
        // Функция для отправки уведомления о изменении статуса задачи
        const notifyUserAboutTaskStatus = async (userId, taskId, oldStatus, newStatus, notes = '') => {
            try {
                const user = await db.get(
                    `SELECT telegram_id FROM users WHERE id = ? AND telegram_id IS NOT NULL AND is_active = 1`,
                    [userId]
                );
                
                if (!user || !user.telegram_id) return;
                
                const task = await db.get(
                    `SELECT task_number, title FROM tasks WHERE id = ?`,
                    [taskId]
                );
                
                if (!task) return;
                
                const statusNames = {
                    'new': 'Новая',
                    'searching': 'Поиск исполнителя',
                    'assigned': 'Назначена',
                    'in_progress': 'В работе',
                    'completed': 'Завершена',
                    'cancelled': 'Отменена',
                    'rejected': 'Отклонена',
                    'expired': 'Просрочена'
                };
                
                const statusEmojis = {
                    'new': '🆕',
                    'searching': '🔍',
                    'assigned': '👤',
                    'in_progress': '🔄',
                    'completed': '✅',
                    'cancelled': '❌',
                    'rejected': '🚫',
                    'expired': '⏰'
                };
                
                const message = `${statusEmojis[newStatus] || '📝'} *Статус задачи изменен*\n\n` +
                               `*${task.title}*\n` +
                               `🔢 ${task.task_number}\n\n` +
                               `📊 *Статус:* ${statusNames[oldStatus] || oldStatus} → ${statusNames[newStatus] || newStatus}\n`;
                
                if (notes) {
                    message += `📝 *Примечание:* ${notes}\n`;
                }
                
                message += `\n_Подробности в приложении_`;
                
                await bot.sendMessage(
                    user.telegram_id,
                    message,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '👁️ Просмотреть задачу', url: `https://concierge-service.ru/tasks/${taskId}` }
                            ]]
                        }
                    }
                );
                
                await logAudit(null, 'telegram_notify_status', 'task', taskId, {
                    user_id: userId,
                    old_status: oldStatus,
                    new_status: newStatus
                });
                
            } catch (error) {
                console.error('Ошибка отправки уведомления о статусе:', error);
            }
        };
        
        // Функция для отправки уведомления о новом отзыве
        const notifyUserAboutNewReview = async (userId, taskId, rating, comment = '') => {
            try {
                const user = await db.get(
                    `SELECT telegram_id FROM users WHERE id = ? AND telegram_id IS NOT NULL AND is_active = 1`,
                    [userId]
                );
                
                if (!user || !user.telegram_id) return;
                
                const task = await db.get(
                    `SELECT task_number, title FROM tasks WHERE id = ?`,
                    [taskId]
                );
                
                if (!task) return;
                
                const stars = '⭐'.repeat(rating) + '☆'.repeat(5 - rating);
                
                const message = `⭐ *Новый отзыв о вашей работе*\n\n` +
                               `*${task.title}*\n` +
                               `🔢 ${task.task_number}\n\n` +
                               `📊 *Оценка:* ${stars} (${rating}/5)\n`;
                
                if (comment) {
                    message += `📝 *Комментарий:* ${comment.substring(0, 200)}${comment.length > 200 ? '...' : ''}\n`;
                }
                
                message += `\n_Спасибо за вашу работу!_`;
                
                await bot.sendMessage(
                    user.telegram_id,
                    message,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '👁️ Просмотреть отзыв', url: `https://concierge-service.ru/tasks/${taskId}/review` }
                            ]]
                        }
                    }
                );
                
                await logAudit(null, 'telegram_notify_review', 'task', taskId, {
                    user_id: userId,
                    rating: rating
                });
                
            } catch (error) {
                console.error('Ошибка отправки уведомления об отзыве:', error);
            }
        };
        
        console.log('✅ Telegram Bot запущен успешно');
        telegramBot = bot;
        
        // Экспортируем функции для использования в API
        module.exports.notifyManagersAboutNewTask = notifyManagersAboutNewTask;
        module.exports.notifyUserAboutNewMessage = notifyUserAboutNewMessage;
        module.exports.notifyUserAboutTaskStatus = notifyUserAboutTaskStatus;
        module.exports.notifyUserAboutNewReview = notifyUserAboutNewReview;
        
        return bot;
        
    } catch (error) {
        console.error('❌ Ошибка запуска Telegram Bot:', error.message);
        console.error(error.stack);
        return null;
    }
};

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

// Функция для логирования действий
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

// Функция для получения отображаемого имени роли
const getRoleDisplayName = (role) => {
    const roleNames = {
        'client': 'Клиент',
        'performer': 'Помощник',
        'manager': 'Менеджер',
        'admin': 'Администратор',
        'superadmin': 'Супер-администратор'
    };
    return roleNames[role] || role;
};

// Функция для генерации номера задачи
const generateTaskNumber = () => {
    const now = new Date();
    const datePart = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}`;
    const randomPart = Math.random().toString(36).substr(2, 6).toUpperCase();
    return `TASK-${datePart}-${randomPart}`;
};

// Функция для генерации токена
const generateToken = (length = 32) => {
    return crypto.randomBytes(length).toString('hex');
};

// Функция для валидации email
const validateEmail = (email) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
};

// Функция для валидации телефона
const validatePhone = (phone) => {
    const re = /^\+?[1-9]\d{10,14}$/;
    return re.test(phone.replace(/\D/g, ''));
};

// Функция для форматирования цены
const formatPrice = (price) => {
    return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        minimumFractionDigits: 0
    }).format(price);
};

// Функция для вычисления времени до дедлайна
const getTimeToDeadline = (deadline) => {
    const now = new Date();
    const deadlineDate = new Date(deadline);
    const diffMs = deadlineDate - now;
    
    if (diffMs < 0) {
        return { expired: true, text: 'Просрочено' };
    }
    
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (diffDays > 0) {
        return { expired: false, text: `${diffDays} дн. ${diffHours} ч.` };
    } else if (diffHours > 0) {
        return { expired: false, text: `${diffHours} часов` };
    } else {
        const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        return { expired: false, text: `${diffMinutes} минут` };
    }
};

// ==================== JWT МИДЛВАР ====================
const authMiddleware = (roles = []) => {
    return async (req, res, next) => {
        const requestId = req.requestId;
        const authHeader = req.headers.authorization;
        const currentRoute = `${req.method} ${req.path}`;
        
        // Публичные маршруты - БОЛЕЕ ТОЧНЫЙ СПИСОК
       const publicRoutes = [
    'GET /',
    'GET /health',
    'GET /api/system/info',
    'GET /api/subscriptions',
    'GET /api/categories',
    'GET /api/categories/',
    'GET /api/services',
    'GET /api/services/',
    'POST /api/auth/register',
    'POST /api/auth/login',
    'POST /api/auth/refresh',
    'OPTIONS'
];
        
        console.log(`🔐 [${requestId}] Проверка авторизации для маршрута: ${currentRoute}`);
        
        // Более строгая проверка публичных маршрутов
        const isPublicRoute = publicRoutes.some(route => {
            if (route.endsWith('/')) {
                return currentRoute.startsWith(route);
            }
            return currentRoute === route;
        });
        
        if (isPublicRoute) {
            console.log(`🔐 [${requestId}] Публичный маршрут, пропускаем авторизацию`);
            return next();
        }
        
        // Проверяем авторизацию только для защищенных маршрутов
        try {
            if (!authHeader) {
                console.log(`🔐 [${requestId}] Ошибка: отсутствует заголовок Authorization`);
                return res.status(401).json({ 
                    success: false, 
                    error: 'Требуется авторизация' 
                });
            }
            
            
            if (!authHeader) {
                console.log(`🔐 [${requestId}] Ошибка: отсутствует заголовок Authorization`);
                return res.status(401).json({ 
                    success: false, 
                    error: 'Требуется авторизация. Отсутствует заголовок Authorization.' 
                });
            }
            
            if (!authHeader.startsWith('Bearer ')) {
                console.log(`🔐 [${requestId}] Ошибка: неверный формат токена`);
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
                    `SELECT id, email, first_name, last_name, phone, role, 
                            subscription_plan, subscription_status, subscription_expires,
                            initial_fee_paid, initial_fee_amount, is_active, avatar_url,
                            balance, rating, completed_tasks
                     FROM users WHERE id = ?`,
                    [decoded.id]
                );
                
                if (!user) {
                    console.log(`🔐 [${requestId}] Ошибка: пользователь с id ${decoded.id} не найден`);
                    return res.status(401).json({ 
                        success: false, 
                        error: 'Пользователь не найден' 
                    });
                }
                
                if (user.is_active !== 1) {
                    console.log(`🔐 [${requestId}] Ошибка: аккаунт пользователя ${user.email} заблокирован`);
                    return res.status(401).json({ 
                        success: false, 
                        error: 'Аккаунт заблокирован' 
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
                
                console.log(`🔐 [${requestId}] Пользователь авторизован: ${user.email} (${user.role})`);
                
                // Проверка ролей
                if (roles.length > 0 && !roles.includes(user.role)) {
                    console.log(`🔐 [${requestId}] Ошибка прав: у пользователя роль ${user.role}, требуется ${roles.join(', ')}`);
                    return res.status(403).json({ 
                        success: false, 
                        error: 'Недостаточно прав для выполнения этого действия' 
                    });
                }
                
                // Логируем успешную авторизацию
                await logAudit(user.id, 'auth_success', 'user', user.id, {
                    route: currentRoute,
                    ip: req.ip
                });
                
                next();
                
            } catch (jwtError) {
                console.log(`🔐 [${requestId}] Ошибка JWT: ${jwtError.message}`);
                
                await logAudit(null, 'auth_failed', 'system', null, {
                    error: jwtError.message,
                    route: currentRoute,
                    ip: req.ip
                });
                
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
            console.error(`🔐 Ошибка authMiddleware:`, error);
            return res.status(500).json({ 
                success: false, 
                error: 'Внутренняя ошибка сервера при проверке авторизации' 
            });
        }
    };
};

// ==================== ФОНОВЫЕ ЗАДАЧИ ====================
const startBackgroundJobs = () => {
    console.log('🔄 Запуск фоновых задач...');
    
    // Проверка просроченных задач каждые 5 минут
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
                
                // Отправляем уведомления
                await db.run(
                    `INSERT INTO notifications (user_id, title, message, type) 
                     VALUES (?, ?, ?, ?)`,
                    [task.client_id, 'Задача просрочена', 
                     `Задача ${task.task_number} просрочена. Статус изменен на "Просрочена".`,
                     'error']
                );
                
                if (task.performer_id) {
                    await db.run(
                        `INSERT INTO notifications (user_id, title, message, type) 
                         VALUES (?, ?, ?, ?)`,
                        [task.performer_id, 'Задача просрочена', 
                         `Задача ${task.task_number} просрочена. Статус изменен на "Просрочена".`,
                         'error']
                    );
                }
                
                // Отправляем уведомление в Telegram
                if (telegramBot && module.exports.notifyUserAboutTaskStatus) {
                    await module.exports.notifyUserAboutTaskStatus(
                        task.client_id, task.id, 'active', 'expired', 'Задача просрочена автоматически'
                    );
                }
            }
            
            if (expiredTasks.length > 0) {
                console.log(`⏰ Автоматически просрочено задач: ${expiredTasks.length}`);
            }
            
        } catch (error) {
            console.error('Ошибка проверки просроченных задач:', error);
        }
    }, 5 * 60 * 1000); // 5 минут
    
    // Проверка подписок каждый день
    setInterval(async () => {
        try {
            const today = new Date().toISOString().split('T')[0];
            const expiredSubscriptions = await db.all(
                `SELECT id, email, first_name, subscription_plan 
                 FROM users 
                 WHERE subscription_status = 'active' 
                 AND subscription_expires < ? 
                 AND subscription_expires IS NOT NULL`,
                [today]
            );
            
            for (const user of expiredSubscriptions) {
                await db.run(
                    `UPDATE users SET subscription_status = 'expired', updated_at = CURRENT_TIMESTAMP 
                     WHERE id = ?`,
                    [user.id]
                );
                
                await db.run(
                    `INSERT INTO notifications (user_id, title, message, type) 
                     VALUES (?, ?, ?, ?)`,
                    [user.id, 'Подписка истекла', 
                     `Ваша подписка "${user.subscription_plan}" истекла. Пожалуйста, продлите подписку для продолжения пользования услугами.`,
                     'warning']
                );
            }
            
            if (expiredSubscriptions.length > 0) {
                console.log(`📅 Истекло подписок: ${expiredSubscriptions.length}`);
            }
            
        } catch (error) {
            console.error('Ошибка проверки подписок:', error);
        }
    }, 24 * 60 * 60 * 1000); // 24 часа
    
    // Очистка старых уведомлений (старше 30 дней)
    setInterval(async () => {
        try {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            
            const result = await db.run(
                `DELETE FROM notifications 
                 WHERE created_at < ? AND is_read = 1`,
                [thirtyDaysAgo.toISOString()]
            );
            
            if (result.changes > 0) {
                console.log(`🗑️ Удалено старых уведомлений: ${result.changes}`);
            }
            
        } catch (error) {
            console.error('Ошибка очистки уведомлений:', error);
        }
    }, 24 * 60 * 60 * 1000); // 24 часа
    
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
                'POST /api/auth/register - Регистрация с оплатой вступительного взноса',
                'POST /api/auth/login - Вход в систему',
                'GET /api/auth/profile - Профиль пользователя (требуется токен)',
                'POST /api/auth/refresh - Обновление токена'
            ],
            categories: [
                'GET /api/categories - Все категории услуг',
                'GET /api/categories/:id/services - Услуги категории'
            ],
            services: [
                'GET /api/services - Все услуги',
                'GET /api/services/:id - Детали услуги'
            ],
            subscriptions: [
                'GET /api/subscriptions - Все подписки',
                'GET /api/subscriptions/my - Моя подписка (требуется токен)',
                'POST /api/subscriptions/subscribe - Оформить подписку (требуется токен)'
            ],
            tasks: [
                'GET /api/tasks - Мои задачи (требуется токен)',
                'POST /api/tasks - Создать задачу (требуется токен)',
                'GET /api/tasks/:id - Получить задачу (требуется токен)',
                'PUT /api/tasks/:id - Обновить задачу (требуется токен)',
                'POST /api/tasks/:id/cancel - Отменить задачу (требуется токен)',
                'POST /api/tasks/:id/complete - Завершить задачу (требуется токен)'
            ],
            chat: [
                'GET /api/tasks/:id/messages - Получить сообщения чата (требуется токен)',
                'POST /api/tasks/:id/messages - Отправить сообщение (требуется токен)'
            ],
            reviews: [
                'POST /api/tasks/:id/reviews - Оставить отзыв (требуется токен)'
            ],
            notifications: [
                'GET /api/notifications - Мои уведомления (требуется токен)',
                'PUT /api/notifications/:id/read - Отметить как прочитанное (требуется токен)'
            ],
            admin: [
                'GET /api/admin/dashboard - Дашборд администратора (требуется admin)',
                'GET /api/admin/users - Управление пользователями (требуется admin)',
                'GET /api/admin/tasks - Управление задачами (требуется admin)'
            ]
        },
        telegram_bot: telegramBot ? '✅ Активен' : '⚠️ Отключен',
        database: '✅ Подключена',
        uptime: process.uptime()
    });
});

// Health check
app.get('/health', async (req, res) => {
    try {
        // Проверяем подключение к базе данных
        await db.get('SELECT 1 as status');
        
        const [users, tasks, categories, services] = await Promise.all([
            db.get('SELECT COUNT(*) as count FROM users'),
            db.get('SELECT COUNT(*) as count FROM tasks'),
            db.get('SELECT COUNT(*) as count FROM categories WHERE is_active = 1'),
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
                categories: categories.count,
                services: services.count
            },
            system: {
                node_version: process.version,
                platform: process.platform,
                memory: {
                    rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`,
                    heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)} MB`,
                    heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`
                },
                uptime: `${Math.floor(process.uptime() / 60)} минут`
            },
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

// ==================== АУТЕНТИФИКАЦИЯ ====================

// Регистрация
app.post('/api/auth/register', async (req, res) => {
    const requestId = req.requestId;
    console.log(`👤 [${requestId}] Регистрация нового пользователя`);
    
    try {
        const { email, password, first_name, last_name, phone, subscription_plan = 'essential' } = req.body;
        
        // Валидация
        if (!email || !password || !first_name || !last_name || !phone) {
            console.log(`❌ [${requestId}] Не все обязательные поля заполнены`);
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля: email, password, first_name, last_name, phone'
            });
        }
        
        if (password.length < 6) {
            console.log(`❌ [${requestId}] Слишком короткий пароль`);
            return res.status(400).json({
                success: false,
                error: 'Пароль должен содержать не менее 6 символов'
            });
        }
        
        if (!validateEmail(email)) {
            console.log(`❌ [${requestId}] Неверный формат email: ${email}`);
            return res.status(400).json({
                success: false,
                error: 'Некорректный email адрес'
            });
        }
        
        if (!validatePhone(phone)) {
            console.log(`❌ [${requestId}] Неверный формат телефона: ${phone}`);
            return res.status(400).json({
                success: false,
                error: 'Некорректный номер телефона. Используйте формат +7XXXXXXXXXX'
            });
        }
        
        // Проверяем существующего пользователя
        const existingUser = await db.get('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUser) {
            console.log(`❌ [${requestId}] Пользователь с email ${email} уже существует`);
            return res.status(409).json({
                success: false,
                error: 'Пользователь с таким email уже существует'
            });
        }
        
        // Проверяем существование выбранной подписки
        const subscription = await db.get(
            'SELECT * FROM subscriptions WHERE name = ? AND is_active = 1',
            [subscription_plan]
        );
        
        if (!subscription) {
            console.log(`❌ [${requestId}] Подписка ${subscription_plan} не найдена`);
            return res.status(400).json({
                success: false,
                error: `Подписка "${subscription_plan}" не найдена или не активна`
            });
        }
        
        // Хеширование пароля
        const hashedPassword = await bcrypt.hash(password, 12);
        
        // Определяем, нужно ли оплачивать вступительный взнос
        const initialFeePaid = subscription.initial_fee === 0 ? 1 : 0;
        const subscriptionStatus = initialFeePaid ? 'active' : 'pending';
        
        // Дата истечения подписки (через 30 дней)
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 30);
        const expiryDateStr = expiryDate.toISOString().split('T')[0];
        
        // Аватар по умолчанию
        const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(first_name)}+${encodeURIComponent(last_name)}&background=FF6B8B&color=fff&bold=true`;
        
        // Создание пользователя
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
        
        // Получаем созданного пользователя
        const user = await db.get(
            `SELECT id, email, first_name, last_name, phone, role, 
                    subscription_plan, subscription_status, subscription_expires,
                    initial_fee_paid, initial_fee_amount, avatar_url, created_at 
             FROM users WHERE id = ?`,
            [userId]
        );
        
        // Создаем JWT токен
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
        
        // Добавляем приветственное уведомление
        await db.run(
            `INSERT INTO notifications (user_id, title, message, type) 
             VALUES (?, ?, ?, ?)`,
            [user.id, 'Добро пожаловать!', 
             'Регистрация прошла успешно. Добро пожаловать в Женский Консьерж!', 
             'success']
        );
        
        // Логируем регистрацию
        await logAudit(user.id, 'register', 'user', user.id, {
            email: user.email,
            subscription_plan: user.subscription_plan,
            initial_fee_paid: user.initial_fee_paid
        });
        
        console.log(`✅ [${requestId}] Пользователь ${email} успешно зарегистрирован`);
        
        res.status(201).json({
            success: true,
            message: 'Регистрация успешно завершена!',
            data: { 
                user,
                token,
                requires_initial_fee: !initialFeePaid,
                initial_fee_amount: subscription.initial_fee,
                subscription_info: subscription
            }
        });
        
    } catch (error) {
        console.error(`❌ [${requestId}] Ошибка регистрации:`, error);
        await logAudit(null, 'register_error', 'system', null, {
            error: error.message,
            email: req.body.email
        });
        
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера при регистрации',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Вход
app.post('/api/auth/login', async (req, res) => {
    const requestId = req.requestId;
    console.log(`🔑 [${requestId}] Попытка входа`);
    
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            console.log(`❌ [${requestId}] Не указан email или пароль`);
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
            console.log(`❌ [${requestId}] Пользователь с email ${email} не найден`);
            return res.status(401).json({
                success: false,
                error: 'Неверный email или пароль'
            });
        }
        
        // Проверяем пароль
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            console.log(`❌ [${requestId}] Неверный пароль для пользователя ${email}`);
            
            // Логируем неудачную попытку входа
            await logAudit(user.id, 'login_failed', 'user', user.id, {
                reason: 'wrong_password',
                ip: req.ip
            });
            
            return res.status(401).json({
                success: false,
                error: 'Неверный email или пароль'
            });
        }
        
        // Проверяем, оплачен ли вступительный взнос если требуется
        if (user.subscription_status === 'pending' && user.initial_fee_paid === 0) {
            console.log(`⚠️ [${requestId}] Пользователь ${email} не оплатил вступительный взнос`);
            
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
        
        // Удаляем пароль из ответа
        delete user.password;
        
        // Обновляем время последнего входа
        await db.run(
            'UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [user.id]
        );
        
        // Добавляем уведомление о входе
        await db.run(
            `INSERT INTO notifications (user_id, title, message, type) 
             VALUES (?, ?, ?, ?)`,
            [user.id, 'Успешный вход', 
             `Вы вошли в систему. Время входа: ${new Date().toLocaleString('ru-RU')}`, 
             'info']
        );
        
        // Логируем успешный вход
        await logAudit(user.id, 'login_success', 'user', user.id, {
            ip: req.ip,
            user_agent: req.headers['user-agent']
        });
        
        console.log(`✅ [${requestId}] Пользователь ${email} успешно вошел`);
        
        res.json({
            success: true,
            message: 'Вход выполнен успешно!',
            data: { 
                user,
                token 
            }
        });
        
    } catch (error) {
        console.error(`❌ [${requestId}] Ошибка входа:`, error);
        
        await logAudit(null, 'login_error', 'system', null, {
            error: error.message,
            email: req.body.email,
            ip: req.ip
        });
        
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера при входе'
        });
    }
});

// Обновление токена
app.post('/api/auth/refresh', async (req, res) => {
    const requestId = req.requestId;
    console.log(`🔄 [${requestId}] Обновление токена`);
    
    try {
        const { refresh_token } = req.body;
        
        if (!refresh_token) {
            console.log(`❌ [${requestId}] Отсутствует refresh_token`);
            return res.status(400).json({
                success: false,
                error: 'Refresh token обязателен'
            });
        }
        
        // Проверяем refresh token (в реальном приложении нужно хранить refresh tokens в БД)
        // Для упрощения будем использовать JWT
        try {
            const decoded = jwt.verify(refresh_token, process.env.JWT_SECRET || 'concierge-secret-key-2024-prod');
            
            // Проверяем пользователя
            const user = await db.get(
                `SELECT id, email, first_name, last_name, role, subscription_plan, 
                        initial_fee_paid, is_active 
                 FROM users WHERE id = ? AND is_active = 1`,
                [decoded.id]
            );
            
            if (!user) {
                console.log(`❌ [${requestId}] Пользователь не найден`);
                return res.status(401).json({
                    success: false,
                    error: 'Пользователь не найден'
                });
            }
            
            // Создаем новый токен
            const newToken = jwt.sign(
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
            
            console.log(`✅ [${requestId}] Токен обновлен для пользователя ${user.email}`);
            
            res.json({
                success: true,
                message: 'Токен успешно обновлен',
                data: { 
                    token: newToken 
                }
            });
            
        } catch (jwtError) {
            console.log(`❌ [${requestId}] Неверный refresh token: ${jwtError.message}`);
            return res.status(401).json({
                success: false,
                error: 'Неверный refresh token'
            });
        }
        
    } catch (error) {
        console.error(`❌ [${requestId}] Ошибка обновления токена:`, error);
        
        await logAudit(null, 'refresh_token_error', 'system', null, {
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера при обновлении токена'
        });
    }
});

// Профиль пользователя
app.get('/api/auth/profile', authMiddleware(), async (req, res) => {
    const requestId = req.requestId;
    
    // Проверяем что пользователь существует
    if (!req.user || !req.user.email) {
        console.log(`❌ [${requestId}] Пользователь не найден в запросе`);
        return res.status(401).json({
            success: false,
            error: 'Пользователь не авторизован'
        });
    }
    
    console.log(`👤 [${requestId}] Получение профиля пользователя ${req.user.email}`);
    
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
            console.log(`❌ [${requestId}] Пользователь не найден`);
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        // Получаем информацию о текущей подписке
        const subscription = await db.get(
            'SELECT * FROM subscriptions WHERE name = ?',
            [user.subscription_plan || 'essential']
        );
        
        // Статистика за текущий месяц
        const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
        const stats = await db.get(`
            SELECT 
                COUNT(*) as total_tasks,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
                SUM(CASE WHEN status IN ('new', 'searching', 'assigned', 'in_progress') THEN 1 ELSE 0 END) as active_tasks,
                SUM(price) as total_spent
            FROM tasks 
            WHERE client_id = ? 
            AND strftime('%Y-%m', created_at) = ?
        `, [req.user.id, currentMonth]);
        
        // Непрочитанные уведомления
        const unreadNotifications = await db.get(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
            [req.user.id]
        );
        
        // Последние 3 задачи
        const recentTasks = await db.all(
            `SELECT t.id, t.task_number, t.title, t.status, t.priority, 
                    t.price, t.deadline, c.display_name as category_name,
                    t.created_at
             FROM tasks t
             LEFT JOIN categories c ON t.category_id = c.id
             WHERE t.client_id = ?
             ORDER BY t.created_at DESC
             LIMIT 3`,
            [req.user.id]
        );
        
        // Форматируем задачи
        const formattedTasks = recentTasks.map(task => {
            const timeToDeadline = getTimeToDeadline(task.deadline);
            return {
                ...task,
                time_to_deadline: timeToDeadline.text,
                is_expired: timeToDeadline.expired,
                formatted_price: formatPrice(task.price)
            };
        });
        
        // Парсим features подписки
        let subscriptionFeatures = [];
        if (subscription && subscription.features) {
            try {
                subscriptionFeatures = JSON.parse(subscription.features);
            } catch (e) {
                subscriptionFeatures = [];
            }
        }
        
        const responseData = { 
            user,
            subscription: subscription ? {
                ...subscription,
                features: subscriptionFeatures
            } : null,
            stats: {
                total_tasks: stats?.total_tasks || 0,
                completed_tasks: stats?.completed_tasks || 0,
                active_tasks: stats?.active_tasks || 0,
                total_spent: stats?.total_spent || 0,
                unread_notifications: unreadNotifications?.count || 0
            },
            recent_tasks: formattedTasks,
            subscription_usage: subscription ? {
                tasks_used: stats?.total_tasks || 0,
                tasks_limit: subscription.tasks_limit,
                percentage: subscription.tasks_limit ? Math.round((stats?.total_tasks || 0) / subscription.tasks_limit * 100) : 0,
                is_unlimited: subscription.tasks_limit >= 999
            } : null
        };
        
        console.log(`✅ [${requestId}] Профиль получен для пользователя ${user.email}`);
        
        res.json({
            success: true,
            data: responseData
        });
        
    } catch (error) {
        console.error(`❌ [${requestId}] Ошибка получения профиля:`, error);
        
        await logAudit(req.user.id, 'get_profile_error', 'user', req.user.id, {
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: 'Ошибка получения профиля',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Обновление профиля
app.put('/api/auth/profile', authMiddleware(), async (req, res) => {
    const requestId = req.requestId;
    console.log(`✏️ [${requestId}] Обновление профиля пользователя ${req.user.email}`);
    
    try {
        const { first_name, last_name, phone, avatar_url, telegram_username } = req.body;
        
        // Валидация
        if (phone && !validatePhone(phone)) {
            console.log(`❌ [${requestId}] Неверный формат телефона: ${phone}`);
            return res.status(400).json({
                success: false,
                error: 'Некорректный номер телефона. Используйте формат +7XXXXXXXXXX'
            });
        }
        
        // Собираем поля для обновления
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
            updateFields.push('phone = ?');
            updateValues.push(phone);
        }
        
        if (avatar_url !== undefined) {
            updateFields.push('avatar_url = ?');
            updateValues.push(avatar_url);
        }
        
        if (telegram_username !== undefined) {
            updateFields.push('telegram_username = ?');
            updateValues.push(telegram_username);
        }
        
        if (updateFields.length === 0) {
            console.log(`❌ [${requestId}] Нет полей для обновления`);
            return res.status(400).json({
                success: false,
                error: 'Нет данных для обновления'
            });
        }
        
        updateFields.push('updated_at = CURRENT_TIMESTAMP');
        updateValues.push(req.user.id);
        
        const query = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`;
        
        await db.run(query, updateValues);
        
        // Получаем обновленного пользователя
        const user = await db.get(
            `SELECT id, email, first_name, last_name, phone, role, 
                    subscription_plan, subscription_status, telegram_username,
                    avatar_url, created_at, updated_at 
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        
        // Логируем обновление
        await logAudit(req.user.id, 'update_profile', 'user', req.user.id, {
            fields_updated: updateFields.filter(f => !f.includes('updated_at')).length,
            new_values: { first_name, last_name, phone, telegram_username }
        });
        
        console.log(`✅ [${requestId}] Профиль пользователя ${user.email} обновлен`);
        
        res.json({
            success: true,
            message: 'Профиль успешно обновлен',
            data: { user }
        });
        
    } catch (error) {
        console.error(`❌ [${requestId}] Ошибка обновления профиля:`, error);
        
        await logAudit(req.user.id, 'update_profile_error', 'user', req.user.id, {
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления профиля'
        });
    }
});

// ==================== КАТЕГОРИИ И УСЛУГИ ====================

// Получение всех категорий
app.get('/api/categories', async (req, res) => {
    const requestId = req.requestId;
    console.log(`📁 [${requestId}] Получение всех категорий`);
    
    try {
        const categories = await db.all(
            `SELECT c.*, 
                    COUNT(s.id) as services_count,
                    (SELECT COUNT(*) FROM tasks t WHERE t.category_id = c.id AND t.status = 'completed') as completed_tasks_count
             FROM categories c
             LEFT JOIN services s ON c.id = s.category_id AND s.is_active = 1
             WHERE c.is_active = 1
             GROUP BY c.id
             ORDER BY c.sort_order ASC`
        );
        
        console.log(`✅ [${requestId}] Получено ${categories.length} категорий`);
        
        res.json({
            success: true,
            data: {
                categories,
                count: categories.length
            }
        });
        
    } catch (error) {
        console.error(`❌ [${requestId}] Ошибка получения категорий:`, error);
        
        await logAudit(null, 'get_categories_error', 'system', null, {
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: 'Ошибка получения категорий'
        });
    }
});

// Получение услуг категории
app.get('/api/categories/:id/services', async (req, res) => {
    const requestId = req.requestId;
    const categoryId = req.params.id;
    
    console.log(`🔧 [${requestId}] Получение услуг категории ${categoryId}`);
    
    try {
        // Проверяем что id есть
        if (!categoryId) {
            console.log(`❌ [${requestId}] Не указан ID категории`);
            return res.status(400).json({
                success: false,
                error: 'Не указан ID категории'
            });
        }
        
        const categoryIdNum = parseInt(categoryId);
        
        if (isNaN(categoryIdNum)) {
            console.log(`❌ [${requestId}] Неверный ID категории: ${categoryId}`);
            return res.status(400).json({
                success: false,
                error: 'Неверный ID категории'
            });
        }
        
        // Проверяем существование категории
        const category = await db.get(
            'SELECT * FROM categories WHERE id = ? AND is_active = 1',
            [categoryIdNum]
        );
        
        if (!category) {
            console.log(`❌ [${requestId}] Категория ${categoryId} не найдена`);
            return res.status(404).json({
                success: false,
                error: 'Категория не найдена'
            });
        }
        
        // Получаем услуги категории
        const services = await db.all(
            `SELECT s.*, 
                    (SELECT COUNT(*) FROM tasks t WHERE t.service_id = s.id AND t.status = 'completed') as completed_count,
                    (SELECT AVG(r.rating) FROM reviews r 
                     JOIN tasks t ON r.task_id = t.id 
                     WHERE t.service_id = s.id AND r.rating IS NOT NULL) as avg_rating
             FROM services s
             WHERE s.category_id = ? AND s.is_active = 1
             ORDER BY s.sort_order ASC, s.name ASC`,
            [categoryId]
        );
        
        console.log(`✅ [${requestId}] Получено ${services.length} услуг для категории ${category.display_name}`);
        
        res.json({
            success: true,
            data: {
                category,
                services,
                count: services.length
            }
        });
        
    } catch (error) {
        console.error(`❌ [${requestId}] Ошибка получения услуг категории:`, error);
        
        await logAudit(null, 'get_category_services_error', 'category', categoryId, {
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: 'Ошибка получения услуг категории'
        });
    }
});

// Получение всех услуг
app.get('/api/services', async (req, res) => {
    const requestId = req.requestId;
    console.log(`🔧 [${requestId}] Получение всех услуг`);
    
    try {
        const { category_id, search, limit = 50, offset = 0 } = req.query;
        
        let query = `
            SELECT s.*, c.display_name as category_name, c.icon as category_icon,
                   (SELECT COUNT(*) FROM tasks t WHERE t.service_id = s.id AND t.status = 'completed') as completed_count,
                   (SELECT AVG(r.rating) FROM reviews r 
                    JOIN tasks t ON r.task_id = t.id 
                    WHERE t.service_id = s.id AND r.rating IS NOT NULL) as avg_rating
            FROM services s
            LEFT JOIN categories c ON s.category_id = c.id
            WHERE s.is_active = 1
        `;
        
        const params = [];
        
        if (category_id) {
            query += ' AND s.category_id = ?';
            params.push(parseInt(category_id));
        }
        
        if (search) {
            query += ' AND (s.name LIKE ? OR s.description LIKE ?)';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm);
        }
        
        query += ' ORDER BY s.sort_order ASC, s.name ASC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const services = await db.all(query, params);
        
        // Получаем общее количество
        let countQuery = 'SELECT COUNT(*) as total FROM services s WHERE s.is_active = 1';
        const countParams = [];
        
        if (category_id) {
            countQuery += ' AND s.category_id = ?';
            countParams.push(parseInt(category_id));
        }
        
        if (search) {
            countQuery += ' AND (s.name LIKE ? OR s.description LIKE ?)';
            const searchTerm = `%${search}%`;
            countParams.push(searchTerm, searchTerm);
        }
        
        const countResult = await db.get(countQuery, countParams);
        const total = countResult?.total || 0;
        
        console.log(`✅ [${requestId}] Получено ${services.length} услуг`);
        
        res.json({
            success: true,
            data: {
                services,
                pagination: {
                    total,
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    has_more: (parseInt(offset) + parseInt(limit)) < total
                }
            }
        });
        
    } catch (error) {
        console.error(`❌ [${requestId}] Ошибка получения услуг:`, error);
        
        await logAudit(null, 'get_services_error', 'system', null, {
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: 'Ошибка получения услуг'
        });
    }
});

// Получение деталей услуги
app.get('/api/services/:id', async (req, res) => {
    const requestId = req.requestId;
    const serviceId = parseInt(req.params.id);
    
    console.log(`🔧 [${requestId}] Получение деталей услуги ${serviceId}`);
    
    try {
        if (isNaN(serviceId)) {
            console.log(`❌ [${requestId}] Неверный ID услуги: ${req.params.id}`);
            return res.status(400).json({
                success: false,
                error: 'Неверный ID услуги'
            });
        }
        
        const service = await db.get(
            `SELECT s.*, c.display_name as category_name, c.icon as category_icon,
                    c.description as category_description,
                    (SELECT COUNT(*) FROM tasks t WHERE t.service_id = s.id AND t.status = 'completed') as completed_count,
                    (SELECT AVG(r.rating) FROM reviews r 
                     JOIN tasks t ON r.task_id = t.id 
                     WHERE t.service_id = s.id AND r.rating IS NOT NULL) as avg_rating,
                    (SELECT COUNT(DISTINCT r.id) FROM reviews r 
                     JOIN tasks t ON r.task_id = t.id 
                     WHERE t.service_id = s.id) as reviews_count
             FROM services s
             LEFT JOIN categories c ON s.category_id = c.id
             WHERE s.id = ? AND s.is_active = 1`,
            [serviceId]
        );
        
        if (!service) {
            console.log(`❌ [${requestId}] Услуга ${serviceId} не найдена`);
            return res.status(404).json({
                success: false,
                error: 'Услуга не найдена'
            });
        }
        
        // Получаем последние отзывы
        const reviews = await db.all(
            `SELECT r.*, t.title as task_title, 
                    u.first_name as client_first_name, u.last_name as client_last_name,
                    u.avatar_url as client_avatar
             FROM reviews r
             JOIN tasks t ON r.task_id = t.id
             JOIN users u ON r.client_id = u.id
             WHERE t.service_id = ? AND r.is_approved = 1
             ORDER BY r.created_at DESC
             LIMIT 5`,
            [serviceId]
        );
        
        // Получаем похожие услуги
        const similarServices = await db.all(
            `SELECT s.id, s.name, s.description, s.base_price, s.estimated_time,
                    (SELECT AVG(r.rating) FROM reviews r 
                     JOIN tasks t ON r.task_id = t.id 
                     WHERE t.service_id = s.id AND r.rating IS NOT NULL) as avg_rating
             FROM services s
             WHERE s.category_id = ? AND s.id != ? AND s.is_active = 1
             ORDER BY RANDOM()
             LIMIT 3`,
            [service.category_id, serviceId]
        );
        
        console.log(`✅ [${requestId}] Получены детали услуги ${service.name}`);
        
        res.json({
            success: true,
            data: {
                service,
                reviews,
                similar_services: similarServices,
                reviews_count: service.reviews_count || 0
            }
        });
        
    } catch (error) {
        console.error(`❌ [${requestId}] Ошибка получения деталей услуги:`, error);
        
        await logAudit(null, 'get_service_error', 'service', serviceId, {
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: 'Ошибка получения деталей услуги'
        });
    }
});

// ==================== ПОДПИСКИ ====================

// Получение всех подписок
app.get('/api/subscriptions', async (req, res) => {
    const requestId = req.requestId;
    console.log(`📋 [${requestId}] Получение всех подписок`);
    
    try {
        const subscriptions = await db.all(
            'SELECT * FROM subscriptions WHERE is_active = 1 ORDER BY sort_order ASC, price_monthly ASC'
        );
        
        // Парсим features из JSON строки
        const subscriptionsWithParsedFeatures = subscriptions.map(sub => ({
            ...sub,
            features: typeof sub.features === 'string' ? JSON.parse(sub.features) : sub.features,
            color: sub.name === 'essential' ? '#FF6B8B' : '#9B59B6',
            formatted_price_monthly: formatPrice(sub.price_monthly),
            formatted_price_yearly: formatPrice(sub.price_yearly),
            formatted_initial_fee: formatPrice(sub.initial_fee)
        }));
        
        console.log(`✅ [${requestId}] Получено ${subscriptions.length} подписок`);
        
        res.json({
            success: true,
            data: {
                subscriptions: subscriptionsWithParsedFeatures,
                count: subscriptions.length
            }
        });
        
    } catch (error) {
        console.error(`❌ [${requestId}] Ошибка получения подписок:`, error);
        
        await logAudit(null, 'get_subscriptions_error', 'system', null, {
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: 'Ошибка получения подписок'
        });
    }
});

// Оформление подписки
app.post('/api/subscriptions/subscribe', authMiddleware(['client']), async (req, res) => {
    const requestId = req.requestId;
    const userId = req.user.id;
    
    console.log(`🛒 [${requestId}] Оформление подписки пользователем ${userId}`);
    
    try {
        const { plan, period = 'monthly', initial_fee_paid = false } = req.body;
        
        if (!plan) {
            console.log(`❌ [${requestId}] Не указан план подписки`);
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
            console.log(`❌ [${requestId}] План подписки "${plan}" не найден`);
            return res.status(404).json({
                success: false,
                error: `План подписки "${plan}" не найден`
            });
        }
        
        // Получаем текущего пользователя
        const currentUser = await db.get(
            'SELECT initial_fee_paid, subscription_plan FROM users WHERE id = ?',
            [userId]
        );
        
        if (!currentUser) {
            console.log(`❌ [${requestId}] Пользователь ${userId} не найден`);
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        // Проверяем, оплачен ли вступительный взнос
        if (!currentUser.initial_fee_paid && !initial_fee_paid) {
            console.log(`❌ [${requestId}] Требуется оплата вступительного взноса`);
            
            return res.status(400).json({
                success: false,
                error: 'Для активации подписки необходимо оплатить вступительный взнос',
                requires_initial_fee: true,
                initial_fee_amount: subscriptionPlan.initial_fee,
                user: {
                    id: userId,
                    initial_fee_paid: currentUser.initial_fee_paid,
                    current_plan: currentUser.subscription_plan
                }
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
                initial_fee_paid ? 1 : currentUser.initial_fee_paid,
                subscriptionPlan.initial_fee,
                userId
            ]
        );
        
        // Создаем запись о платеже
        const transactionId = `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
        
        // Если был вступительный взнос
        if (!currentUser.initial_fee_paid && initial_fee_paid) {
            await db.run(
                `INSERT INTO payments 
                (user_id, subscription_id, amount, description, status, payment_method, transaction_id) 
                VALUES (?, ?, ?, ?, 'completed', 'initial_fee', ?)`,
                [
                    userId,
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
                    userId,
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
                userId,
                'Подписка активирована!',
                `Вы успешно активировали подписку "${subscriptionPlan.display_name}". Действует до ${expiryDateString}.`,
                'success'
            ]
        );
        
        // Получаем обновленного пользователя
        const user = await db.get(
            `SELECT id, email, first_name, last_name, subscription_plan, 
                    subscription_status, subscription_expires, initial_fee_paid 
             FROM users WHERE id = ?`,
            [userId]
        );
        
        // Логируем оформление подписки
        await logAudit(userId, 'subscribe', 'subscription', subscriptionPlan.id, {
            plan: plan,
            period: period,
            amount: amount,
            initial_fee_paid: !currentUser.initial_fee_paid && initial_fee_paid,
            transaction_id: transactionId
        });
        
        console.log(`✅ [${requestId}] Пользователь ${userId} оформил подписку ${plan}`);
        
        res.json({
            success: true,
            message: `Подписка "${subscriptionPlan.display_name}" успешно активирована!`,
            data: { 
                user,
                subscription: subscriptionPlan,
                payment: {
                    initial_fee: !currentUser.initial_fee_paid ? subscriptionPlan.initial_fee : 0,
                    subscription_fee: amount,
                    total: (!currentUser.initial_fee_paid ? subscriptionPlan.initial_fee : 0) + amount
                },
                expiry_date: expiryDateString
            }
        });
        
    } catch (error) {
        console.error(`❌ [${requestId}] Ошибка оформления подписки:`, error);
        
        await logAudit(userId, 'subscribe_error', 'subscription', null, {
            error: error.message,
            plan: req.body.plan
        });
        
        res.status(500).json({
            success: false,
            error: 'Ошибка оформления подписки'
        });
    }
});

// Моя подписка
app.get('/api/subscriptions/my', authMiddleware(), async (req, res) => {
    const requestId = req.requestId;
    const userId = req.user.id;
    
    console.log(`📋 [${requestId}] Получение подписки пользователя ${userId}`);
    
    try {
        const user = await db.get(
            `SELECT subscription_plan, subscription_status, subscription_expires, 
                    initial_fee_paid, initial_fee_amount 
             FROM users WHERE id = ?`,
            [userId]
        );
        
        if (!user) {
            console.log(`❌ [${requestId}] Пользователь ${userId} не найден`);
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        const subscription = await db.get(
            'SELECT * FROM subscriptions WHERE name = ?',
            [user.subscription_plan || 'essential']
        );
        
        if (!subscription) {
            console.log(`❌ [${requestId}] Подписка ${user.subscription_plan} не найдена`);
            return res.status(404).json({
                success: false,
                error: 'Подписка не найдена'
            });
        }
        
        // Статистика использования
        const currentMonth = new Date().toISOString().slice(0, 7);
        const tasksUsed = await db.get(
            `SELECT COUNT(*) as count FROM tasks 
             WHERE client_id = ? 
             AND strftime('%Y-%m', created_at) = ?`,
            [userId, currentMonth]
        );
        
        // Парсим features
        let subscriptionFeatures = [];
        if (subscription.features) {
            try {
                subscriptionFeatures = JSON.parse(subscription.features);
            } catch (e) {
                subscriptionFeatures = [];
            }
        }
        
        const subscriptionInfo = {
            ...subscription,
            features: subscriptionFeatures,
            current_usage: {
                tasks_used: tasksUsed?.count || 0,
                tasks_limit: subscription.tasks_limit,
                percentage: subscription.tasks_limit ? Math.round((tasksUsed?.count || 0) / subscription.tasks_limit * 100) : 0,
                is_unlimited: subscription.tasks_limit >= 999
            },
            user_data: {
                status: user.subscription_status,
                expires: user.subscription_expires,
                initial_fee_paid: user.initial_fee_paid,
                initial_fee_amount: user.initial_fee_amount,
                is_active: user.subscription_status === 'active' && 
                          (!user.subscription_expires || new Date(user.subscription_expires) > new Date())
            },
            formatted_price_monthly: formatPrice(subscription.price_monthly),
            formatted_price_yearly: formatPrice(subscription.price_yearly),
            formatted_initial_fee: formatPrice(subscription.initial_fee)
        };
        
        console.log(`✅ [${requestId}] Получена подписка пользователя ${userId}`);
        
        res.json({
            success: true,
            data: subscriptionInfo
        });
        
    } catch (error) {
        console.error(`❌ [${requestId}] Ошибка получения подписки:`, error);
        
        await logAudit(userId, 'get_subscription_error', 'subscription', null, {
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: 'Ошибка получения информации о подписке'
        });
    }
});

// ==================== ЗАДАЧИ ====================

// Создание задачи
app.post('/api/tasks', authMiddleware(['client', 'admin', 'superadmin']), async (req, res) => {
    const requestId = req.requestId;
    const userId = req.user.id;
    
    console.log(`➕ [${requestId}] Создание задачи пользователем ${userId}`);
    
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
            is_urgent = false,
            price
        } = req.body;
        
        // Валидация
        if (!title || !description || !category_id || !deadline || !address || !contact_info) {
            console.log(`❌ [${requestId}] Не все обязательные поля заполнены`);
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля: title, description, category_id, deadline, address, contact_info'
            });
        }
        
        // Проверяем существование категории
        const category = await db.get(
            'SELECT * FROM categories WHERE id = ? AND is_active = 1',
            [category_id]
        );
        
        if (!category) {
            console.log(`❌ [${requestId}] Категория ${category_id} не найдена`);
            return res.status(404).json({
                success: false,
                error: 'Категория не найдена'
            });
        }
        
        // Проверяем существование услуги если указана
        let service = null;
        if (service_id) {
            service = await db.get(
                'SELECT * FROM services WHERE id = ? AND is_active = 1',
                [service_id]
            );
            
            if (!service) {
                console.log(`❌ [${requestId}] Услуга ${service_id} не найдена`);
                return res.status(404).json({
                    success: false,
                    error: 'Услуга не найдена'
                });
            }
        }
        
        // Проверяем подписку пользователя
        const user = await db.get(
            'SELECT subscription_plan, subscription_status, initial_fee_paid, balance FROM users WHERE id = ?',
            [userId]
        );
        
        if (!user || user.subscription_status !== 'active') {
            console.log(`❌ [${requestId}] Подписка пользователя ${userId} не активна`);
            return res.status(403).json({
                success: false,
                error: 'Ваша подписка не активна. Активируйте подписку для создания задач.'
            });
        }
        
        // Проверяем оплачен ли вступительный взнос
        if (!user.initial_fee_paid) {
            console.log(`❌ [${requestId}] Пользователь ${userId} не оплатил вступительный взнос`);
            return res.status(403).json({
                success: false,
                error: 'Для создания задач необходимо оплатить вступительный взнос'
            });
        }
        
        // Проверяем лимит задач
        const subscription = await db.get(
            'SELECT tasks_limit FROM subscriptions WHERE name = ?',
            [user.subscription_plan || 'essential']
        );
        
        if (subscription && subscription.tasks_limit < 999) { // 999 означает безлимит
            const currentMonth = new Date().toISOString().slice(0, 7);
            const tasksCount = await db.get(
                `SELECT COUNT(*) as count FROM tasks 
                 WHERE client_id = ? 
                 AND strftime('%Y-%m', created_at) = ?`,
                [userId, currentMonth]
            );
            
            if (tasksCount && tasksCount.count >= subscription.tasks_limit) {
                console.log(`❌ [${requestId}] Лимит задач исчерпан для пользователя ${userId}`);
                return res.status(403).json({
                    success: false,
                    error: `Лимит задач исчерпан (${subscription.tasks_limit} в месяц). Оформите более высокий тариф или дождитесь следующего месяца.`
                });
            }
        }
        
        // Проверяем дату дедлайна
        const deadlineDate = new Date(deadline);
        if (deadlineDate < new Date()) {
            console.log(`❌ [${requestId}] Дата дедлайна в прошлом: ${deadline}`);
            return res.status(400).json({
                success: false,
                error: 'Дата дедлайна не может быть в прошлом'
            });
        }
        
        // Рассчитываем цену
        let finalPrice = price;
        if (!finalPrice && service) {
            finalPrice = service.base_price;
        }
        
        if (!finalPrice || finalPrice < 0) {
            console.log(`❌ [${requestId}] Неверная цена: ${finalPrice}`);
            return res.status(400).json({
                success: false,
                error: 'Укажите корректную цену задачи'
            });
        }
        
        // Проверяем баланс пользователя
        if (finalPrice > user.balance) {
            console.log(`❌ [${requestId}] Недостаточно средств: баланс ${user.balance}, цена ${finalPrice}`);
            return res.status(400).json({
                success: false,
                error: 'Недостаточно средств на балансе. Пополните баланс или уменьшите цену задачи.',
                balance: user.balance,
                required: finalPrice,
                deficit: finalPrice - user.balance
            });
        }
        
        // Генерируем номер задачи
        const taskNumber = generateTaskNumber();
        
        // Создаем задачу
        const result = await db.run(
            `INSERT INTO tasks 
            (task_number, title, description, client_id, category_id, service_id, 
             priority, price, address, deadline, contact_info, additional_requirements, 
             is_urgent, is_approved) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [
                taskNumber,
                title,
                description,
                userId,
                category_id,
                service_id || null,
                priority,
                finalPrice,
                address,
                deadline,
                contact_info,
                additional_requirements || null,
                is_urgent ? 1 : 0
            ]
        );
        
        const taskId = result.lastID;
        
        // Списываем средства с баланса пользователя
        await db.run(
            'UPDATE users SET balance = balance - ? WHERE id = ?',
            [finalPrice, userId]
        );
        
        // Создаем запись о платеже
        const transactionId = `TASK-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
        await db.run(
            `INSERT INTO payments 
            (user_id, task_id, amount, description, status, payment_method, transaction_id) 
            VALUES (?, ?, ?, ?, 'completed', 'task_payment', ?)`,
            [
                userId,
                taskId,
                finalPrice,
                `Оплата задачи: ${title}`,
                transactionId
            ]
        );
        
        // Добавляем запись в историю статусов
        await db.run(
            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
             VALUES (?, ?, ?, ?)`,
            [taskId, 'new', userId, 'Задача создана клиентом']
        );
        
        // Получаем созданную задачу
        const task = await db.get(
            `SELECT t.*, c.display_name as category_name, c.icon as category_icon,
                    s.name as service_name, s.description as service_description
             FROM tasks t 
             LEFT JOIN categories c ON t.category_id = c.id 
             LEFT JOIN services s ON t.service_id = s.id
             WHERE t.id = ?`,
            [taskId]
        );
        
        // Добавляем уведомление клиенту
        await db.run(
            `INSERT INTO notifications (user_id, title, message, type, data) 
             VALUES (?, ?, ?, ?, ?)`,
            [
                userId,
                'Задача создана!',
                `Задача "${title}" успешно создана. Номер: ${taskNumber}. Ожидайте предложений от помощников.`,
                'success',
                JSON.stringify({ task_id: task.id, task_number: taskNumber })
            ]
        );
        
        // Отправляем уведомления менеджерам
        const managers = await db.all(
            'SELECT id FROM users WHERE role IN ("admin", "manager", "superadmin") AND is_active = 1'
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
        
        // Отправляем уведомление в Telegram менеджерам
        if (telegramBot && module.exports.notifyManagersAboutNewTask) {
            await module.exports.notifyManagersAboutNewTask(taskId);
        }
        
        // Логируем создание задачи
        await logAudit(userId, 'create_task', 'task', taskId, {
            task_number: taskNumber,
            title: title,
            category_id: category_id,
            service_id: service_id,
            price: finalPrice,
            deadline: deadline
        });
        
        console.log(`✅ [${requestId}] Задача ${taskNumber} создана пользователем ${userId}`);
        
        res.status(201).json({
            success: true,
            message: 'Задача успешно создана! Помощники уведомлены.',
            data: { 
                task,
                notification: 'Помощники получили уведомление о новой задаче',
                balance_after: user.balance - finalPrice
            }
        });
        
    } catch (error) {
        console.error(`❌ [${requestId}] Ошибка создания задачи:`, error);
        
        await logAudit(userId, 'create_task_error', 'task', null, {
            error: error.message,
            title: req.body.title
        });
        
        res.status(500).json({
            success: false,
            error: 'Ошибка создания задачи',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Получение задач пользователя
app.get('/api/tasks', authMiddleware(), async (req, res) => {
    const requestId = req.requestId;
    const userId = req.user.id;
    const userRole = req.user.role;
    
    console.log(`📋 [${requestId}] Получение задач пользователя ${userId} (роль: ${userRole})`);
    
    try {
        const { status, category_id, limit = 50, offset = 0, sort = 'created_at', order = 'DESC' } = req.query;
        
        let query = `
            SELECT t.*, 
                   c.display_name as category_name,
                   c.icon as category_icon,
                   s.name as service_name,
                   u1.first_name as client_first_name, 
                   u1.last_name as client_last_name,
                   u2.first_name as performer_first_name,
                   u2.last_name as performer_last_name
            FROM tasks t
            LEFT JOIN categories c ON t.category_id = c.id
            LEFT JOIN services s ON t.service_id = s.id
            LEFT JOIN users u1 ON t.client_id = u1.id
            LEFT JOIN users u2 ON t.performer_id = u2.id
            WHERE 1=1
        `;
        
        const params = [];
        
        // Если пользователь не админ/менеджер, показываем только его задачи
        if (!['admin', 'manager', 'superadmin'].includes(userRole)) {
            if (userRole === 'client') {
                query += ' AND t.client_id = ?';
                params.push(userId);
            } else if (userRole === 'performer') {
                query += ' AND (t.performer_id = ? OR t.status = "searching")';
                params.push(userId);
            }
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
        const validSortFields = ['created_at', 'deadline', 'priority', 'updated_at', 'price'];
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
            if (userRole === 'client') {
                countQuery += ' AND client_id = ?';
                countParams.push(userId);
            } else if (userRole === 'performer') {
                countQuery += ' AND (performer_id = ? OR status = "searching")';
                countParams.push(userId);
            }
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
                'searching': { label: 'Поиск помощника', color: '#3498DB', icon: '🔍', can_cancel: true },
                'assigned': { label: 'Назначена', color: '#9B59B6', icon: '👤', can_cancel: true },
                'in_progress': { label: 'В работе', color: '#F39C12', icon: '🔄', can_complete: true },
                'completed': { label: 'Завершена', color: '#2ECC71', icon: '✅', can_review: true },
                'cancelled': { label: 'Отменена', color: '#95A5A6', icon: '❌', can_recreate: true },
                'rejected': { label: 'Отклонена', color: '#E74C3C', icon: '🚫', can_recreate: true },
                'expired': { label: 'Просрочена', color: '#34495E', icon: '⏰', can_recreate: true }
            }[task.status] || { label: task.status, color: '#95A5A6', icon: '📝' };
            
            const priorityInfo = {
                'low': { label: 'Низкий', color: '#2ECC71' },
                'medium': { label: 'Средний', color: '#F39C12' },
                'high': { label: 'Высокий', color: '#E74C3C' },
                'urgent': { label: 'Срочный', color: '#C0392B' }
            }[task.priority] || { label: task.priority, color: '#95A5A6' };
            
            const timeToDeadline = getTimeToDeadline(task.deadline);
            
            return {
                ...task,
                status_info: statusInfo,
                priority_info: priorityInfo,
                time_to_deadline: timeToDeadline.text,
                is_expired: timeToDeadline.expired,
                is_urgent: task.is_urgent === 1,
                formatted_price: formatPrice(task.price),
                can_edit: task.status === 'new' && userId === task.client_id,
                can_cancel: ['new', 'searching', 'assigned'].includes(task.status) && 
                           (userId === task.client_id || ['admin', 'manager', 'superadmin'].includes(userRole)),
                can_complete: task.status === 'in_progress' && 
                            (userId === task.client_id || ['admin', 'manager', 'superadmin'].includes(userRole)),
                can_assign: ['admin', 'manager', 'superadmin'].includes(userRole) && task.status === 'searching',
                can_take: userRole === 'performer' && task.status === 'searching',
                can_chat: task.status !== 'cancelled' && task.status !== 'rejected' && 
                         (userId === task.client_id || userId === task.performer_id || ['admin', 'manager', 'superadmin'].includes(userRole))
            };
        });
        
        // Получаем статистику по статусам
        let statsQuery = 'SELECT status, COUNT(*) as count FROM tasks WHERE 1=1';
        const statsParams = [];
        
        if (!['admin', 'manager', 'superadmin'].includes(userRole)) {
            if (userRole === 'client') {
                statsQuery += ' AND client_id = ?';
                statsParams.push(userId);
            } else if (userRole === 'performer') {
                statsQuery += ' AND performer_id = ?';
                statsParams.push(userId);
            }
        }
        
        statsQuery += ' GROUP BY status';
        
        const statsResult = await db.all(statsQuery, statsParams);
        const statusStats = {};
        let totalTasks = 0;
        
        statsResult.forEach(stat => {
            statusStats[stat.status] = stat.count;
            totalTasks += stat.count;
        });
        
        console.log(`✅ [${requestId}] Получено ${tasks.length} задач для пользователя ${userId}`);
        
        res.json({
            success: true,
            data: {
                tasks: enrichedTasks,
                statistics: {
                    total: totalTasks,
                    by_status: statusStats
                },
                pagination: {
                    total,
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    has_more: (parseInt(offset) + parseInt(limit)) < total
                }
            }
        });
        
    } catch (error) {
        console.error(`❌ [${requestId}] Ошибка получения задач:`, error);
        
        await logAudit(userId, 'get_tasks_error', 'user', userId, {
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: 'Ошибка получения задач',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Получение деталей задачи
app.get('/api/tasks/:id', authMiddleware(), async (req, res) => {
    const requestId = req.requestId;
    const taskId = parseInt(req.params.id);
    const userId = req.user.id;
    const userRole = req.user.role;
    
    console.log(`👁️ [${requestId}] Получение деталей задачи ${taskId} пользователем ${userId}`);
    
    try {
        if (isNaN(taskId)) {
            console.log(`❌ [${requestId}] Неверный ID задачи: ${req.params.id}`);
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
                    s.name as service_name,
                    s.description as service_description,
                    s.base_price as service_base_price,
                    s.estimated_time as service_estimated_time,
                    u1.first_name as client_first_name, 
                    u1.last_name as client_last_name, 
                    u1.phone as client_phone,
                    u1.avatar_url as client_avatar,
                    u1.email as client_email,
                    u2.first_name as performer_first_name,
                    u2.last_name as performer_last_name,
                    u2.phone as performer_phone,
                    u2.avatar_url as performer_avatar,
                    u2.email as performer_email,
                    u2.rating as performer_rating,
                    u2.completed_tasks as performer_completed_tasks
             FROM tasks t
             LEFT JOIN categories c ON t.category_id = c.id
             LEFT JOIN services s ON t.service_id = s.id
             LEFT JOIN users u1 ON t.client_id = u1.id
             LEFT JOIN users u2 ON t.performer_id = u2.id
             WHERE t.id = ?`,
            [taskId]
        );
        
        if (!task) {
            console.log(`❌ [${requestId}] Задача ${taskId} не найдена`);
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        // Проверяем права доступа
        const hasAccess = 
            ['admin', 'manager', 'superadmin'].includes(userRole) ||
            userId === task.client_id ||
            userId === task.performer_id;
        
        if (!hasAccess) {
            console.log(`❌ [${requestId}] Пользователь ${userId} не имеет доступа к задаче ${taskId}`);
            return res.status(403).json({
                success: false,
                error: 'Нет доступа к этой задаче'
            });
        }
        
        // Получаем историю статусов
        const statusHistory = await db.all(
            `SELECT tsh.*, u.first_name, u.last_name, u.avatar_url 
             FROM task_status_history tsh
             LEFT JOIN users u ON tsh.changed_by = u.id
             WHERE tsh.task_id = ?
             ORDER BY tsh.created_at ASC`,
            [taskId]
        );
        
        // Получаем количество сообщений в чате
        const messagesCount = await db.get(
            'SELECT COUNT(*) as count FROM task_messages WHERE task_id = ?',
            [taskId]
        );
        
        // Получаем отзыв если есть
        const review = task.status === 'completed' ? await db.get(
            `SELECT r.*, u.first_name as client_first_name, u.last_name as client_last_name,
                    u.avatar_url as client_avatar
             FROM reviews r
             LEFT JOIN users u ON r.client_id = u.id
             WHERE r.task_id = ?`,
            [taskId]
        ) : null;
        
        // Определяем доступные действия
        const statusActions = {
            'new': ['cancel'],
            'searching': ['cancel', 'assign', 'take'],
            'assigned': ['cancel', 'start'],
            'in_progress': ['complete', 'cancel'],
            'completed': ['review'],
            'cancelled': ['recreate'],
            'rejected': ['recreate'],
            'expired': ['recreate']
        };
        
        const availableActions = statusActions[task.status] || [];
        
        // Добавляем дополнительные права в зависимости от роли
        if (userId === task.client_id) {
            if (task.status === 'new') availableActions.push('edit');
            if (['new', 'searching', 'assigned'].includes(task.status)) availableActions.push('cancel');
            if (task.status === 'in_progress') availableActions.push('complete');
            if (task.status === 'completed' && !review) availableActions.push('review');
        }
        
        if (userId === task.performer_id) {
            if (task.status === 'assigned') availableActions.push('start');
            if (task.status === 'in_progress') availableActions.push('complete');
        }
        
        if (['admin', 'manager', 'superadmin'].includes(userRole)) {
            if (task.status === 'searching') availableActions.push('assign');
            if (['new', 'searching', 'assigned', 'in_progress'].includes(task.status)) availableActions.push('cancel');
            if (task.status === 'assigned') availableActions.push('start');
            if (task.status === 'in_progress') availableActions.push('complete');
        }
        
        if (userRole === 'performer' && task.status === 'searching') {
            availableActions.push('take');
        }
        
        // Удаляем дубликаты
        const uniqueActions = [...new Set(availableActions)];
        
        // Форматируем данные задачи
        const timeToDeadline = getTimeToDeadline(task.deadline);
        const formattedTask = {
            ...task,
            is_urgent: task.is_urgent === 1,
            formatted_price: formatPrice(task.price),
            time_to_deadline: timeToDeadline.text,
            is_expired: timeToDeadline.expired,
            status_history: statusHistory,
            messages_count: messagesCount?.count || 0,
            review,
            available_actions: uniqueActions,
            permissions: {
                can_chat: task.status !== 'cancelled' && task.status !== 'rejected',
                can_view_details: true,
                can_manage: ['admin', 'manager', 'superadmin'].includes(userRole) || 
                           userId === task.client_id,
                can_communicate: task.status !== 'cancelled' && task.status !== 'rejected' && 
                               (userId === task.client_id || userId === task.performer_id || 
                                ['admin', 'manager', 'superadmin'].includes(userRole))
            }
        };
        
        // Логируем просмотр задачи
        await logAudit(userId, 'view_task', 'task', taskId, {
            task_number: task.task_number,
            status: task.status
        });
        
        console.log(`✅ [${requestId}] Получены детали задачи ${taskId}`);
        
        res.json({
            success: true,
            data: {
                task: formattedTask
            }
        });
        
    } catch (error) {
        console.error(`❌ [${requestId}] Ошибка получения задачи:`, error);
        
        await logAudit(userId, 'get_task_error', 'task', taskId, {
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: 'Ошибка получения задачи'
        });
    }
});

// Обновление статуса задачи
app.post('/api/tasks/:id/status', authMiddleware(), async (req, res) => {
    const requestId = req.requestId;
    const taskId = parseInt(req.params.id);
    const userId = req.user.id;
    const userRole = req.user.role;
    
    console.log(`🔄 [${requestId}] Изменение статуса задачи ${taskId} пользователем ${userId}`);
    
    try {
        if (isNaN(taskId)) {
            console.log(`❌ [${requestId}] Неверный ID задачи: ${req.params.id}`);
            return res.status(400).json({
                success: false,
                error: 'Неверный ID задачи'
            });
        }
        
        const { status, notes, performer_id } = req.body;
        
        if (!status) {
            console.log(`❌ [${requestId}] Не указан новый статус`);
            return res.status(400).json({
                success: false,
                error: 'Не указан новый статус'
            });
        }
        
        // Получаем задачу
        const task = await db.get(
            'SELECT * FROM tasks WHERE id = ?',
            [taskId]
        );
        
        if (!task) {
            console.log(`❌ [${requestId}] Задача ${taskId} не найдена`);
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        // Проверяем права
        let canChangeStatus = false;
        let isAdmin = ['admin', 'manager', 'superadmin'].includes(userRole);
        
        if (isAdmin) {
            canChangeStatus = true;
        } else if (userId === task.client_id) {
            // Клиент может отменять или завершать задачи
            canChangeStatus = ['cancelled', 'completed'].includes(status);
        } else if (userId === task.performer_id) {
            // Исполнитель может начинать и завершать задачи
            canChangeStatus = ['in_progress', 'completed'].includes(status);
        }
        
        if (!canChangeStatus) {
            console.log(`❌ [${requestId}] Пользователь ${userId} не имеет прав для изменения статуса задачи ${taskId}`);
            return res.status(403).json({
                success: false,
                error: 'Нет прав для изменения статуса задачи'
            });
        }
        
        // Проверяем валидность перехода статусов
        const validTransitions = {
            'new': ['searching', 'cancelled'],
            'searching': ['assigned', 'cancelled', 'rejected'],
            'assigned': ['in_progress', 'cancelled'],
            'in_progress': ['completed', 'cancelled'],
            'completed': [],
            'cancelled': ['new'],
            'rejected': ['new'],
            'expired': ['new']
        };
        
        if (!validTransitions[task.status]?.includes(status)) {
            console.log(`❌ [${requestId}] Недопустимый переход статуса: ${task.status} -> ${status}`);
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
        if (status === 'in_progress') {
            updateData.start_time = new Date().toISOString();
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
            [taskId, status, userId, notes || `Статус изменен на "${status}" пользователем ${userRole}`]
        );
        
        // Отправляем уведомления
        const notificationTitle = {
            'searching': 'Поиск помощника',
            'assigned': 'Задача назначена',
            'in_progress': 'Работа начата',
            'completed': 'Задача завершена',
            'cancelled': 'Задача отменена',
            'rejected': 'Задача отклонена'
        }[status];
        
        const notificationMessage = {
            'searching': `Задача "${task.title}" перешла в статус поиска помощника.`,
            'assigned': `Задача "${task.title}" назначена исполнителю.`,
            'in_progress': `Исполнитель приступил к выполнению задачи "${task.title}".`,
            'completed': `Задача "${task.title}" завершена.`,
            'cancelled': `Задача "${task.title}" отменена.`,
            'rejected': `Задача "${task.title}" отклонена.`
        }[status];
        
        // Уведомляем клиента если не он изменил статус
        if (userId !== task.client_id) {
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
        
        // Уведомляем исполнителя если есть и не он изменил статус
        if (performer_id && userId !== performer_id) {
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
            
            // Обновляем статистику исполнителя
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
        
        // Отправляем уведомление в Telegram
        if (telegramBot && module.exports.notifyUserAboutTaskStatus) {
            if (userId !== task.client_id) {
                await module.exports.notifyUserAboutTaskStatus(
                    task.client_id, taskId, task.status, status, notes
                );
            }
            
            if (performer_id && userId !== performer_id) {
                await module.exports.notifyUserAboutTaskStatus(
                    performer_id, taskId, task.status, status, notes
                );
            }
        }
        
        // Логируем изменение статуса
        await logAudit(userId, 'change_task_status', 'task', taskId, {
            old_status: task.status,
            new_status: status,
            notes: notes,
            performer_id: performer_id
        });
        
        console.log(`✅ [${requestId}] Статус задачи ${taskId} изменен: ${task.status} -> ${status}`);
        
        res.json({
            success: true,
            message: `Статус задачи успешно изменен на "${status}"`,
            data: { 
                task_id: taskId,
                new_status: status,
                changed_by: userId,
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error(`❌ [${requestId}] Ошибка изменения статуса задачи:`, error);
        
        await logAudit(userId, 'change_status_error', 'task', taskId, {
            error: error.message,
            new_status: req.body.status
        });
        
        res.status(500).json({
            success: false,
            error: 'Ошибка изменения статуса задачи'
        });
    }
});

// Отмена задачи
app.post('/api/tasks/:id/cancel', authMiddleware(), async (req, res) => {
    const requestId = req.requestId;
    const taskId = parseInt(req.params.id);
    const userId = req.user.id;
    const userRole = req.user.role;
    
    console.log(`❌ [${requestId}] Отмена задачи ${taskId} пользователем ${userId}`);
    
    try {
        if (isNaN(taskId)) {
            console.log(`❌ [${requestId}] Неверный ID задачи: ${req.params.id}`);
            return res.status(400).json({
                success: false,
                error: 'Неверный ID задачи'
            });
        }
        
        const { reason } = req.body;
        
        const task = await db.get(
            'SELECT * FROM tasks WHERE id = ?',
            [taskId]
        );
        
        if (!task) {
            console.log(`❌ [${requestId}] Задача ${taskId} не найдена`);
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        // Проверяем права
        const canCancel = 
            ['admin', 'manager', 'superadmin'].includes(userRole) ||
            (userId === task.client_id && ['new', 'searching', 'assigned'].includes(task.status));
        
        if (!canCancel) {
            console.log(`❌ [${requestId}] Пользователь ${userId} не имеет прав для отмены задачи ${taskId}`);
            return res.status(403).json({
                success: false,
                error: 'Нет прав для отмены этой задачи'
            });
        }
        
        // Возвращаем деньги клиенту если задача оплачена
        if (task.status !== 'completed' && task.price > 0) {
            await db.run(
                'UPDATE users SET balance = balance + ? WHERE id = ?',
                [task.price, task.client_id]
            );
            
            // Создаем запись о возврате платежа
            const transactionId = `REFUND-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
            await db.run(
                `INSERT INTO payments 
                (user_id, task_id, amount, description, status, payment_method, transaction_id) 
                VALUES (?, ?, ?, ?, 'refunded', 'refund', ?)`,
                [
                    task.client_id,
                    taskId,
                    task.price,
                    `Возврат средств по отмененной задаче: ${task.title}`,
                    transactionId
                ]
            );
        }
        
        // Обновляем статус
        await db.run(
            `UPDATE tasks SET status = 'cancelled', cancellation_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [reason || 'Отменена пользователем', taskId]
        );
        
        // Добавляем в историю
        await db.run(
            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
             VALUES (?, ?, ?, ?)`,
            [taskId, 'cancelled', userId, reason || `Задача отменена ${userRole === 'client' ? 'клиентом' : 'менеджером'}`]
        );
        
        // Уведомляем всех участников
        const participants = [task.client_id];
        if (task.performer_id) participants.push(task.performer_id);
        
        for (const participantId of participants) {
            if (participantId !== userId) {
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
        
        // Отправляем уведомление в Telegram
        if (telegramBot && module.exports.notifyUserAboutTaskStatus) {
            for (const participantId of participants) {
                if (participantId !== userId) {
                    await module.exports.notifyUserAboutTaskStatus(
                        participantId, taskId, task.status, 'cancelled', reason
                    );
                }
            }
        }
        
        // Логируем отмену задачи
        await logAudit(userId, 'cancel_task', 'task', taskId, {
            task_number: task.task_number,
            reason: reason,
            price_refunded: task.price,
            previous_status: task.status
        });
        
        console.log(`✅ [${requestId}] Задача ${taskId} отменена пользователем ${userId}`);
        
        res.json({
            success: true,
            message: 'Задача успешно отменена',
            data: {
                task_id: taskId,
                cancelled_by: userId,
                reason: reason || 'Не указана',
                price_refunded: task.price,
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error(`❌ [${requestId}] Ошибка отмены задачи:`, error);
        
        await logAudit(userId, 'cancel_task_error', 'task', taskId, {
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: 'Ошибка отмены задачи'
        });
    }
});

// Принятие задачи исполнителем
app.post('/api/tasks/:id/take', authMiddleware(['performer']), async (req, res) => {
    const requestId = req.requestId;
    const taskId = parseInt(req.params.id);
    const userId = req.user.id;
    
    console.log(`👤 [${requestId}] Принятие задачи ${taskId} исполнителем ${userId}`);
    
    try {
        if (isNaN(taskId)) {
            console.log(`❌ [${requestId}] Неверный ID задачи: ${req.params.id}`);
            return res.status(400).json({
                success: false,
                error: 'Неверный ID задачи'
            });
        }
        
        const task = await db.get(
            'SELECT * FROM tasks WHERE id = ?',
            [taskId]
        );
        
        if (!task) {
            console.log(`❌ [${requestId}] Задача ${taskId} не найдена`);
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        // Проверяем, что задача в статусе поиска
        if (task.status !== 'searching') {
            console.log(`❌ [${requestId}] Задача ${taskId} не в статусе поиска (текущий статус: ${task.status})`);
            return res.status(400).json({
                success: false,
                error: 'Задача не доступна для принятия'
            });
        }
        
        // Проверяем, что у исполнителя активна подписка
        const performer = await db.get(
            'SELECT subscription_status FROM users WHERE id = ?',
            [userId]
        );
        
        if (!performer || performer.subscription_status !== 'active') {
            console.log(`❌ [${requestId}] У исполнителя ${userId} не активна подписка`);
            return res.status(403).json({
                success: false,
                error: 'Ваша подписка не активна'
            });
        }
        
        // Назначаем задачу исполнителю
        await db.run(
            `UPDATE tasks SET 
                performer_id = ?,
                status = 'assigned',
                updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [userId, taskId]
        );
        
        // Добавляем запись в историю
        await db.run(
            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
             VALUES (?, ?, ?, ?)`,
            [taskId, 'assigned', userId, 'Задача принята исполнителем']
        );
        
        // Уведомляем клиента
        await db.run(
            `INSERT INTO notifications (user_id, title, message, type, data) 
             VALUES (?, ?, ?, ?, ?)`,
            [
                task.client_id,
                'Исполнитель найден!',
                `Исполнитель принял вашу задачу "${task.title}".`,
                'success',
                JSON.stringify({ task_id: task.id, performer_id: userId })
            ]
        );
        
        // Уведомляем исполнителя
        await db.run(
            `INSERT INTO notifications (user_id, title, message, type, data) 
             VALUES (?, ?, ?, ?, ?)`,
            [
                userId,
                'Задача принята',
                `Вы приняли задачу "${task.title}". Свяжитесь с клиентом для уточнения деталей.`,
                'info',
                JSON.stringify({ task_id: task.id, client_id: task.client_id })
            ]
        );
        
        // Отправляем уведомление в Telegram
        if (telegramBot && module.exports.notifyUserAboutTaskStatus) {
            await module.exports.notifyUserAboutTaskStatus(
                task.client_id, taskId, task.status, 'assigned', 'Задача принята исполнителем'
            );
        }
        
        // Логируем принятие задачи
        await logAudit(userId, 'take_task', 'task', taskId, {
            task_number: task.task_number,
            client_id: task.client_id
        });
        
        console.log(`✅ [${requestId}] Исполнитель ${userId} принял задачу ${taskId}`);
        
        res.json({
            success: true,
            message: 'Задача успешно принята',
            data: {
                task_id: taskId,
                performer_id: userId,
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error(`❌ [${requestId}] Ошибка принятия задачи:`, error);
        
        await logAudit(userId, 'take_task_error', 'task', taskId, {
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: 'Ошибка принятия задачи'
        });
    }
});

// ==================== ЧАТ ЗАДАЧИ ====================

// Получение сообщений чата
app.get('/api/tasks/:id/messages', authMiddleware(), async (req, res) => {
    const requestId = req.requestId;
    const taskId = parseInt(req.params.id);
    const userId = req.user.id;
    const userRole = req.user.role;
    
    console.log(`💬 [${requestId}] Получение сообщений чата задачи ${taskId} пользователем ${userId}`);
    
    try {
        if (isNaN(taskId)) {
            console.log(`❌ [${requestId}] Неверный ID задачи: ${req.params.id}`);
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
            console.log(`❌ [${requestId}] Задача ${taskId} не найдена`);
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        const hasAccess = 
            ['admin', 'manager', 'superadmin'].includes(userRole) ||
            userId === task.client_id ||
            userId === task.performer_id;
        
        if (!hasAccess) {
            console.log(`❌ [${requestId}] Пользователь ${userId} не имеет доступа к чату задачи ${taskId}`);
            return res.status(403).json({
                success: false,
                error: 'Нет доступа к чату этой задачи'
            });
        }
        
        // Проверяем можно ли общаться в чате
        if (task.status === 'cancelled' || task.status === 'rejected') {
            console.log(`❌ [${requestId}] Задача ${taskId} отменена или отклонена`);
            return res.status(400).json({
                success: false,
                error: 'Нельзя общаться в отмененных или отклоненных задачах'
            });
        }
        
        // Получаем сообщения
        const messages = await db.all(
            `SELECT tm.*, u.first_name, u.last_name, u.avatar_url, u.role
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
                [taskId, userId]
            );
        }
        
        // Получаем информацию о участниках чата
        const participants = await db.all(
            `SELECT u.id, u.first_name, u.last_name, u.avatar_url, u.role
             FROM users u
             WHERE u.id IN (?, ?) AND u.is_active = 1`,
            [task.client_id, task.performer_id].filter(Boolean)
        );
        
        console.log(`✅ [${requestId}] Получено ${messages.length} сообщений для задачи ${taskId}`);
        
        res.json({
            success: true,
            data: { 
                messages,
                participants,
                can_send: task.status !== 'completed' && task.status !== 'cancelled' && task.status !== 'rejected' && task.status !== 'expired'
            }
        });
        
    } catch (error) {
        console.error(`❌ [${requestId}] Ошибка получения сообщений:`, error);
        
        await logAudit(userId, 'get_messages_error', 'task', taskId, {
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: 'Ошибка получения сообщений'
        });
    }
});

// Отправка сообщения в чат
app.post('/api/tasks/:id/messages', authMiddleware(), async (req, res) => {
    const requestId = req.requestId;
    const taskId = parseInt(req.params.id);
    const userId = req.user.id;
    const userRole = req.user.role;
    
    console.log(`💬 [${requestId}] Отправка сообщения в чат задачи ${taskId} пользователем ${userId}`);
    
    try {
        if (isNaN(taskId)) {
            console.log(`❌ [${requestId}] Неверный ID задачи: ${req.params.id}`);
            return res.status(400).json({
                success: false,
                error: 'Неверный ID задачи'
            });
        }
        
        const { message } = req.body;
        
        if (!message || message.trim().length === 0) {
            console.log(`❌ [${requestId}] Пустое сообщение`);
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
            console.log(`❌ [${requestId}] Задача ${taskId} не найдена`);
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        const hasAccess = 
            ['admin', 'manager', 'superadmin'].includes(userRole) ||
            userId === task.client_id ||
            userId === task.performer_id;
        
        if (!hasAccess) {
            console.log(`❌ [${requestId}] Пользователь ${userId} не имеет доступа к чату задачи ${taskId}`);
            return res.status(403).json({
                success: false,
                error: 'Нет доступа к чату этой задачи'
            });
        }
        
        // Проверяем можно ли отправлять сообщения
        if (task.status === 'cancelled' || task.status === 'rejected' || task.status === 'completed' || task.status === 'expired') {
            console.log(`❌ [${requestId}] Задача ${taskId} завершена, отменена или отклонена`);
            return res.status(400).json({
                success: false,
                error: 'Нельзя отправлять сообщения в завершенные, отмененные или отклоненные задачи'
            });
        }
        
        // Отправляем сообщение
        const result = await db.run(
            `INSERT INTO task_messages (task_id, user_id, message) 
             VALUES (?, ?, ?)`,
            [taskId, userId, message.trim()]
        );
        
        const newMessage = await db.get(
            `SELECT tm.*, u.first_name, u.last_name, u.avatar_url, u.role
             FROM task_messages tm
             LEFT JOIN users u ON tm.user_id = u.id
             WHERE tm.id = ?`,
            [result.lastID]
        );
        
        // Определяем кому отправлять уведомление
        const notifyUserIds = [];
        
        if (userId === task.client_id) {
            if (task.performer_id) notifyUserIds.push(task.performer_id);
            // Уведомляем менеджеров
            const managers = await db.all(
                `SELECT id FROM users WHERE role IN ('admin', 'manager', 'superadmin') 
                 AND id != ? AND is_active = 1`,
                [userId]
            );
            managers.forEach(m => notifyUserIds.push(m.id));
        } else if (userId === task.performer_id) {
            notifyUserIds.push(task.client_id);
        } else if (['admin', 'manager', 'superadmin'].includes(userRole)) {
            if (task.client_id !== userId) notifyUserIds.push(task.client_id);
            if (task.performer_id && task.performer_id !== userId) notifyUserIds.push(task.performer_id);
        }
        
        // Отправляем уведомления
        for (const notifyUserId of notifyUserIds) {
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
        }
        
        // Отправляем уведомление в Telegram
        if (telegramBot && module.exports.notifyUserAboutNewMessage) {
            for (const notifyUserId of notifyUserIds) {
                const sender = await db.get(
                    'SELECT first_name, last_name FROM users WHERE id = ?',
                    [userId]
                );
                const senderName = sender ? `${sender.first_name} ${sender.last_name}` : 'Пользователь';
                
                await module.exports.notifyUserAboutNewMessage(
                    notifyUserId, taskId, message, senderName
                );
            }
        }
        
        // Логируем отправку сообщения
        await logAudit(userId, 'send_message', 'task', taskId, {
            message_preview: message.substring(0, 50),
            notified_users: notifyUserIds.length
        });
        
        console.log(`✅ [${requestId}] Сообщение отправлено в чат задачи ${taskId}`);
        
        res.status(201).json({
            success: true,
            message: 'Сообщение отправлено',
            data: { 
                message: newMessage,
                notified_users: notifyUserIds.length
            }
        });
        
    } catch (error) {
        console.error(`❌ [${requestId}] Ошибка отправки сообщения:`, error);
        
        await logAudit(userId, 'send_message_error', 'task', taskId, {
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: 'Ошибка отправки сообщения'
        });
    }
});

// ==================== ОТЗЫВЫ ====================

// Оставление отзыва
app.post('/api/tasks/:id/reviews', authMiddleware(['client']), async (req, res) => {
    const requestId = req.requestId;
    const taskId = parseInt(req.params.id);
    const userId = req.user.id;
    
    console.log(`⭐ [${requestId}] Оставление отзыва к задаче ${taskId} пользователем ${userId}`);
    
    try {
        if (isNaN(taskId)) {
            console.log(`❌ [${requestId}] Неверный ID задачи: ${req.params.id}`);
            return res.status(400).json({
                success: false,
                error: 'Неверный ID задачи'
            });
        }
        
        const { rating, comment, is_anonymous = false } = req.body;
        
        if (!rating || rating < 1 || rating > 5) {
            console.log(`❌ [${requestId}] Неверный рейтинг: ${rating}`);
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
            console.log(`❌ [${requestId}] Задача ${taskId} не найдена`);
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        // Проверяем права
        if (userId !== task.client_id) {
            console.log(`❌ [${requestId}] Пользователь ${userId} не является клиентом задачи ${taskId}`);
            return res.status(403).json({
                success: false,
                error: 'Только клиент может оставлять отзыв'
            });
        }
        
        if (task.status !== 'completed') {
            console.log(`❌ [${requestId}] Задача ${taskId} не завершена (статус: ${task.status})`);
            return res.status(400).json({
                success: false,
                error: 'Можно оставить отзыв только к завершенным задачам'
            });
        }
        
        // Проверяем, не оценивалась ли уже задача
        const existingReview = await db.get(
            'SELECT id FROM reviews WHERE task_id = ?',
            [taskId]
        );
        
        if (existingReview) {
            console.log(`❌ [${requestId}] Задача ${taskId} уже была оценена`);
            return res.status(400).json({
                success: false,
                error: 'Эта задача уже была оценена'
            });
        }
        
        // Проверяем, есть ли исполнитель
        if (!task.performer_id) {
            console.log(`❌ [${requestId}] У задачи ${taskId} нет исполнителя`);
            return res.status(400).json({
                success: false,
                error: 'Нельзя оставить отзыв к задаче без исполнителя'
            });
        }
        
        // Создаем отзыв
        await db.run(
            `INSERT INTO reviews (task_id, client_id, performer_id, rating, comment, is_anonymous) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [taskId, userId, task.performer_id, rating, comment || null, is_anonymous ? 1 : 0]
        );
        
        // Обновляем рейтинг в задаче
        await db.run(
            'UPDATE tasks SET rating = ?, feedback = ? WHERE id = ?',
            [rating, comment || null, taskId]
        );
        
        // Обновляем рейтинг исполнителя
        const performerStats = await db.get(
            `SELECT AVG(r.rating) as avg_rating, COUNT(r.id) as reviews_count
             FROM reviews r
             WHERE r.performer_id = ? AND r.is_approved = 1`,
            [task.performer_id]
        );
        
        if (performerStats && performerStats.avg_rating) {
            await db.run(
                'UPDATE users SET rating = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [performerStats.avg_rating, task.performer_id]
            );
        }
        
        // Уведомляем исполнителя
        await db.run(
            `INSERT INTO notifications (user_id, title, message, type, data) 
             VALUES (?, ?, ?, ?, ?)`,
            [
                task.performer_id,
                'Новый отзыв о вашей работе',
                `Клиент оценил вашу работу по задаче "${task.title}" на ${rating}/5${comment ? ` с комментарием: ${comment.substring(0, 100)}` : ''}`,
                'success',
                JSON.stringify({ task_id: task.id, rating })
            ]
        );
        
        // Отправляем уведомление в Telegram
        if (telegramBot && module.exports.notifyUserAboutNewReview) {
            await module.exports.notifyUserAboutNewReview(
                task.performer_id, taskId, rating, comment
            );
        }
        
        // Логируем оставление отзыва
        await logAudit(userId, 'leave_review', 'task', taskId, {
            rating: rating,
            is_anonymous: is_anonymous,
            performer_id: task.performer_id
        });
        
        console.log(`✅ [${requestId}] Отзыв оставлен к задаче ${taskId}`);
        
        res.json({
            success: true,
            message: 'Спасибо за ваш отзыв!',
            data: {
                task_id: taskId,
                rating,
                comment: comment || null,
                is_anonymous,
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error(`❌ [${requestId}] Ошибка оставления отзыва:`, error);
        
        await logAudit(userId, 'leave_review_error', 'task', taskId, {
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: 'Ошибка оставления отзыва'
        });
    }
});

// ==================== УВЕДОМЛЕНИЯ ====================

// Получение уведомлений
app.get('/api/notifications', authMiddleware(), async (req, res) => {
    const requestId = req.requestId;
    const userId = req.user.id;
    
    console.log(`🔔 [${requestId}] Получение уведомлений пользователя ${userId}`);
    
    try {
        const { unread_only = false, limit = 50, offset = 0 } = req.query;
        
        let query = `
            SELECT n.* 
            FROM notifications n
            WHERE n.user_id = ?
        `;
        
        const params = [userId];
        
        if (unread_only === 'true') {
            query += ' AND n.is_read = 0';
        }
        
        query += ' ORDER BY n.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const notifications = await db.all(query, params);
        
        // Получаем общее количество
        let countQuery = 'SELECT COUNT(*) as total FROM notifications WHERE user_id = ?';
        const countParams = [userId];
        
        if (unread_only === 'true') {
            countQuery += ' AND is_read = 0';
        }
        
        const countResult = await db.get(countQuery, countParams);
        const total = countResult?.total || 0;
        
        // Получаем количество непрочитанных
        const unreadCount = await db.get(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
            [userId]
        );
        
        console.log(`✅ [${requestId}] Получено ${notifications.length} уведомлений для пользователя ${userId}`);
        
        res.json({
            success: true,
            data: {
                notifications,
                unread_count: unreadCount?.count || 0,
                pagination: {
                    total,
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    has_more: (parseInt(offset) + parseInt(limit)) < total
                }
            }
        });
        
    } catch (error) {
        console.error(`❌ [${requestId}] Ошибка получения уведомлений:`, error);
        
        await logAudit(userId, 'get_notifications_error', 'user', userId, {
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: 'Ошибка получения уведомлений'
        });
    }
});

// Отметка уведомления как прочитанного
app.put('/api/notifications/:id/read', authMiddleware(), async (req, res) => {
    const requestId = req.requestId;
    const notificationId = parseInt(req.params.id);
    const userId = req.user.id;
    
    console.log(`👁️ [${requestId}] Отметка уведомления ${notificationId} как прочитанного пользователем ${userId}`);
    
    try {
        if (isNaN(notificationId)) {
            console.log(`❌ [${requestId}] Неверный ID уведомления: ${req.params.id}`);
            return res.status(400).json({
                success: false,
                error: 'Неверный ID уведомления'
            });
        }
        
        // Проверяем, принадлежит ли уведомление пользователю
        const notification = await db.get(
            'SELECT id FROM notifications WHERE id = ? AND user_id = ?',
            [notificationId, userId]
        );
        
        if (!notification) {
            console.log(`❌ [${requestId}] Уведомление ${notificationId} не найдено или не принадлежит пользователю ${userId}`);
            return res.status(404).json({
                success: false,
                error: 'Уведомление не найдено'
            });
        }
        
        // Обновляем статус
        await db.run(
            'UPDATE notifications SET is_read = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [notificationId]
        );
        
        // Логируем действие
        await logAudit(userId, 'mark_notification_read', 'notification', notificationId, {});
        
        console.log(`✅ [${requestId}] Уведомление ${notificationId} отмечено как прочитанное`);
        
        res.json({
            success: true,
            message: 'Уведомление отмечено как прочитанное'
        });
        
    } catch (error) {
        console.error(`❌ [${requestId}] Ошибка отметки уведомления:`, error);
        
        await logAudit(userId, 'mark_notification_error', 'notification', notificationId, {
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: 'Ошибка отметки уведомления'
        });
    }
});

// Отметка всех уведомлений как прочитанных
app.put('/api/notifications/read-all', authMiddleware(), async (req, res) => {
    const requestId = req.requestId;
    const userId = req.user.id;
    
    console.log(`👁️ [${requestId}] Отметка всех уведомлений как прочитанных пользователем ${userId}`);
    
    try {
        const result = await db.run(
            'UPDATE notifications SET is_read = 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND is_read = 0',
            [userId]
        );
        
        // Логируем действие
        await logAudit(userId, 'mark_all_notifications_read', 'user', userId, {
            marked_count: result.changes
        });
        
        console.log(`✅ [${requestId}] Отмечено ${result.changes} уведомлений как прочитанных`);
        
        res.json({
            success: true,
            message: `Все уведомления (${result.changes}) отмечены как прочитанные`,
            data: {
                marked_count: result.changes
            }
        });
        
    } catch (error) {
        console.error(`❌ [${requestId}] Ошибка отметки всех уведомлений:`, error);
        
        await logAudit(userId, 'mark_all_notifications_error', 'user', userId, {
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: 'Ошибка отметки уведомлений'
        });
    }
});

// ==================== АДМИН ПАНЕЛЬ ====================

// Дашборд администратора
app.get('/api/admin/dashboard', authMiddleware(['admin', 'manager', 'superadmin']), async (req, res) => {
    const requestId = req.requestId;
    const userId = req.user.id;
    
    console.log(`📊 [${requestId}] Получение дашборда администратором ${userId}`);
    
    try {
        const today = new Date();
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        
        // Основная статистика
        const [totalUsers, activeUsers, totalTasks, completedTasks, totalRevenue] = await Promise.all([
            db.get('SELECT COUNT(*) as count FROM users'),
            db.get('SELECT COUNT(*) as count FROM users WHERE is_active = 1 AND subscription_status = "active"'),
            db.get('SELECT COUNT(*) as count FROM tasks'),
            db.get('SELECT COUNT(*) as count FROM tasks WHERE status = "completed"'),
            db.get('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = "completed"')
        ]);
        
        // Статистика за месяц
        const [monthlyUsers, monthlyTasks, monthlyRevenue, monthlyPayments] = await Promise.all([
            db.get('SELECT COUNT(*) as count FROM users WHERE created_at >= ?', [monthStart.toISOString()]),
            db.get('SELECT COUNT(*) as count FROM tasks WHERE created_at >= ?', [monthStart.toISOString()]),
            db.get('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = "completed" AND created_at >= ?', [monthStart.toISOString()]),
            db.get('SELECT COUNT(*) as count FROM payments WHERE status = "completed" AND created_at >= ?', [monthStart.toISOString()])
        ]);
        
        // Статистика за неделю
        const [weeklyTasks, weeklyRevenue, weeklyUsers] = await Promise.all([
            db.get('SELECT COUNT(*) as count FROM tasks WHERE created_at >= ?', [weekAgo.toISOString()]),
            db.get('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = "completed" AND created_at >= ?', [weekAgo.toISOString()]),
            db.get('SELECT COUNT(*) as count FROM users WHERE created_at >= ?', [weekAgo.toISOString()])
        ]);
        
        // Распределение по категориям
        const categoriesStats = await db.all(`
            SELECT c.id, c.display_name, c.icon, c.color,
                   COUNT(t.id) as task_count,
                   SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed_count,
                   AVG(t.rating) as avg_rating,
                   SUM(t.price) as total_revenue
            FROM categories c
            LEFT JOIN tasks t ON c.id = t.category_id
            WHERE c.is_active = 1
            GROUP BY c.id
            ORDER BY task_count DESC
            LIMIT 10
        `);
        
        // Распределение по статусам задач
        const tasksByStatus = await db.all(`
            SELECT status, COUNT(*) as count
            FROM tasks
            GROUP BY status
            ORDER BY count DESC
        `);
        
        // Последние задачи
        const recentTasks = await db.all(`
            SELECT t.*, c.display_name as category_name,
                   u1.first_name as client_first_name, u1.last_name as client_last_name,
                   u2.first_name as performer_first_name, u2.last_name as performer_last_name
            FROM tasks t
            LEFT JOIN categories c ON t.category_id = c.id
            LEFT JOIN users u1 ON t.client_id = u1.id
            LEFT JOIN users u2 ON t.performer_id = u2.id
            ORDER BY t.created_at DESC
            LIMIT 10
        `);
        
        // Последние пользователи
        const recentUsers = await db.all(`
            SELECT id, email, first_name, last_name, role, subscription_plan, created_at
            FROM users
            ORDER BY created_at DESC
            LIMIT 10
        `);
        
        // Последние платежи
        const recentPayments = await db.all(`
            SELECT p.*, u.email as user_email, u.first_name, u.last_name,
                   s.display_name as subscription_name, t.task_number
            FROM payments p
            LEFT JOIN users u ON p.user_id = u.id
            LEFT JOIN subscriptions s ON p.subscription_id = s.id
            LEFT JOIN tasks t ON p.task_id = t.id
            ORDER BY p.created_at DESC
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
        
        // Статистика по дням за последние 7 дней
        const dailyStats = await db.all(`
            SELECT 
                DATE(created_at) as date,
                COUNT(*) as tasks_count,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count,
                SUM(price) as revenue
            FROM tasks
            WHERE created_at >= DATE('now', '-7 days')
            GROUP BY DATE(created_at)
            ORDER BY date ASC
        `);
        
        console.log(`✅ [${requestId}] Дашборд получен администратором ${userId}`);
        
        res.json({
            success: true,
            data: {
                summary: {
                    total_users: totalUsers.count,
                    active_users: activeUsers.count,
                    total_tasks: totalTasks.count,
                    completed_tasks: completedTasks.count,
                    total_revenue: totalRevenue.total,
                    monthly_new_users: monthlyUsers.count,
                    monthly_new_tasks: monthlyTasks.count,
                    monthly_revenue: monthlyRevenue.total,
                    monthly_payments: monthlyPayments.count,
                    weekly_new_tasks: weeklyTasks.count,
                    weekly_revenue: weeklyRevenue.total,
                    weekly_new_users: weeklyUsers.count
                },
                categories: categoriesStats,
                tasks_by_status: tasksByStatus,
                recent_tasks: recentTasks,
                recent_users: recentUsers,
                recent_payments: recentPayments,
                subscriptions: subscriptionStats,
                daily_stats: dailyStats,
                time_period: {
                    month_start: monthStart.toISOString(),
                    month_end: monthEnd.toISOString(),
                    week_ago: weekAgo.toISOString()
                }
            }
        });
        
    } catch (error) {
        console.error(`❌ [${requestId}] Ошибка получения дашборда:`, error);
        
        await logAudit(userId, 'get_dashboard_error', 'admin', userId, {
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: 'Ошибка получения дашборда'
        });
    }
});

// Управление пользователями (админ)
app.get('/api/admin/users', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    const requestId = req.requestId;
    const userId = req.user.id;
    
    console.log(`👥 [${requestId}] Получение списка пользователей администратором ${userId}`);
    
    try {
        const { role, subscription, search, is_active, limit = 50, offset = 0 } = req.query;
        
        let query = `
            SELECT id, email, first_name, last_name, phone, role, 
                   subscription_plan, subscription_status, subscription_expires,
                   initial_fee_paid, initial_fee_amount,
                   telegram_username, balance, rating, completed_tasks, 
                   is_active, created_at, updated_at
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
        
        if (is_active && is_active !== 'all') {
            query += ' AND is_active = ?';
            params.push(is_active === 'active' ? 1 : 0);
        }
        
        if (search) {
            query += ' AND (email LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR phone LIKE ?)';
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
        
        if (is_active && is_active !== 'all') {
            countQuery += ' AND is_active = ?';
            countParams.push(is_active === 'active' ? 1 : 0);
        }
        
        if (search) {
            countQuery += ' AND (email LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR phone LIKE ?)';
            const searchTerm = `%${search}%`;
            countParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }
        
        const countResult = await db.get(countQuery, countParams);
        const total = countResult.total;
        
        console.log(`✅ [${requestId}] Получено ${users.length} пользователей администратором ${userId}`);
        
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
        console.error(`❌ [${requestId}] Ошибка получения пользователей:`, error);
        
        await logAudit(userId, 'get_users_error', 'admin', userId, {
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: 'Ошибка получения пользователей'
        });
    }
});

// Управление задачами (админ)
app.get('/api/admin/tasks', authMiddleware(['admin', 'manager', 'superadmin']), async (req, res) => {
    const requestId = req.requestId;
    const userId = req.user.id;
    
    console.log(`📋 [${requestId}] Получение списка задач администратором ${userId}`);
    
    try {
        const { status, category_id, date_from, date_to, search, limit = 50, offset = 0 } = req.query;
        
        let query = `
            SELECT t.*, 
                   c.display_name as category_name,
                   c.icon as category_icon,
                   s.name as service_name,
                   u1.first_name as client_first_name, 
                   u1.last_name as client_last_name,
                   u1.phone as client_phone,
                   u2.first_name as performer_first_name,
                   u2.last_name as performer_last_name,
                   u2.phone as performer_phone
            FROM tasks t
            LEFT JOIN categories c ON t.category_id = c.id
            LEFT JOIN services s ON t.service_id = s.id
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
        
        if (search) {
            query += ' AND (t.title LIKE ? OR t.task_number LIKE ? OR u1.email LIKE ? OR u2.email LIKE ?)';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }
        
        query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const tasks = await db.all(query, params);
        
        console.log(`✅ [${requestId}] Получено ${tasks.length} задач администратором ${userId}`);
        
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
        console.error(`❌ [${requestId}] Ошибка получения задач:`, error);
        
        await logAudit(userId, 'get_admin_tasks_error', 'admin', userId, {
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: 'Ошибка получения задач'
        });
    }
});

// ==================== СИСТЕМА ====================

// Информация о системе
app.get('/api/system/info', async (req, res) => {
    const requestId = req.requestId;
    console.log(`ℹ️ [${requestId}] Получение информации о системе`);
    
    try {
        const [categoriesCount, tasksCount, usersCount, servicesCount, subscriptionsCount] = await Promise.all([
            db.get('SELECT COUNT(*) as count FROM categories WHERE is_active = 1'),
            db.get('SELECT COUNT(*) as count FROM tasks'),
            db.get('SELECT COUNT(*) as count FROM users'),
            db.get('SELECT COUNT(*) as count FROM services WHERE is_active = 1'),
            db.get('SELECT COUNT(*) as count FROM subscriptions WHERE is_active = 1')
        ]);
        
        // Получаем информацию о подписках
        const subscriptions = await db.all(
            `SELECT s.name, s.display_name, COUNT(u.id) as user_count 
             FROM subscriptions s 
             LEFT JOIN users u ON s.name = u.subscription_plan AND u.subscription_status = 'active'
             WHERE s.is_active = 1 
             GROUP BY s.name 
             ORDER BY s.sort_order`
        );
        
        // Получаем последние действия из аудита
        const recentActivity = await db.all(
            `SELECT a.*, u.email as user_email, u.first_name, u.last_name
             FROM audit_log a
             LEFT JOIN users u ON a.user_id = u.id
             ORDER BY a.created_at DESC
             LIMIT 10`
        );
        
        console.log(`✅ [${requestId}] Информация о системе получена`);
        
        res.json({
            success: true,
            data: {
                statistics: {
                    categories: categoriesCount.count,
                    tasks: tasksCount.count,
                    users: usersCount.count,
                    services: servicesCount.count,
                    subscriptions: subscriptionsCount.count
                },
                subscription_distribution: subscriptions,
                system: {
                    version: '5.2.0',
                    node_version: process.version,
                    platform: process.platform,
                    environment: process.env.NODE_ENV || 'development',
                    memory: {
                        rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`,
                        heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)} MB`,
                        heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`
                    },
                    uptime: `${Math.floor(process.uptime() / 60)} минут`,
                    database: 'SQLite'
                },
                services: {
                    telegram_bot: telegramBot ? '✅ Активен' : '⚠️ Отключен',
                    background_jobs: '✅ Активны',
                    api: '✅ Работает'
                },
                recent_activity: recentActivity,
                server_time: new Date().toISOString(),
                server_time_local: new Date().toLocaleString('ru-RU')
            }
        });
        
    } catch (error) {
        console.error(`❌ [${requestId}] Ошибка получения информации о системе:`, error);
        
        await logAudit(null, 'get_system_info_error', 'system', null, {
            error: error.message
        });
        
        res.json({
            success: false,
            data: {
                version: '5.2.0',
                status: 'running',
                error: error.message,
                server_time: new Date().toISOString()
            }
        });
    }
});

// ==================== ОБСЛУЖИВАНИЕ СТАТИЧЕСКИХ ФАЙЛОВ ====================

// Обслуживание статических файлов из папки public
app.use(express.static(path.join(__dirname, 'public')));

// API маршруты должны обрабатываться раньше
// Для SPA - отправляем index.html для всех не-API маршрутов
app.get('*', (req, res, next) => {
    // Если это API маршрут - пропускаем
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({
            success: false,
            error: 'API маршрут не найден'
        });
    }
    
    // Для всех остальных маршрутов отправляем index.html
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== ОБРАБОТКА ОШИБОК ====================

// Обработка 404 для API
app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({
            success: false,
            error: 'API маршрут не найден',
            path: req.path,
            method: req.method
        });
    }
    next();
});

// Глобальный обработчик ошибок
app.use((err, req, res, next) => {
    const requestId = req.requestId;
    console.error(`❌ [${requestId}] Необработанная ошибка:`, err);
    
    res.status(500).json({
        success: false,
        error: 'Внутренняя ошибка сервера',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined,
        request_id: requestId
    });
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎀 ЗАПУСК ЖЕНСКОГО КОНСЬЕРЖА v5.2.0');
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
            
            console.log('\n🔑 ТЕСТОВЫЕ АККАУНТЫ ДЛЯ ВХОДА:');
            console.log('='.repeat(60));
            console.log('👑 Суперадмин: superadmin@concierge.ru / admin123');
            console.log('👨‍💼 Админ: admin@concierge.ru / admin123');
            console.log('👨‍💼 Менеджер: manager@concierge.ru / admin123');
            console.log('👩‍🏫 Помощник 1: performer1@concierge.ru / performer123');
            console.log('👩‍🏫 Помощник 2: performer2@concierge.ru / performer123');
            console.log('👩 Клиент Премиум: client1@example.com / client123');
            console.log('👩 Клиент Эссеншл: client2@example.com / client123');
            console.log('='.repeat(60));
            console.log('\n📚 ДОКУМЕНТАЦИЯ API:');
            console.log('🌐 http://localhost:3000 - Документация API');
            console.log('📖 Все эндпоинты описаны в корневом маршруте');
            console.log('='.repeat(80));
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
