// server.js - полная рабочая версия
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

// Упрощенные CORS настройки для разработки
app.use(cors({
    origin: '*', // В разработке разрешаем все
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.options('*', cors());

// Дополнительные CORS headers для всех ответов
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// Логирование
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

        // Создание таблиц
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
                subscription_status TEXT DEFAULT 'pending',
                subscription_expires DATE,
                telegram_id TEXT,
                telegram_username TEXT,
                avatar_url TEXT DEFAULT 'https://ui-avatars.com/api/?name=User&background=FF6B8B&color=fff',
                balance REAL DEFAULT 0,
                initial_fee_paid INTEGER DEFAULT 0,
                initial_fee_amount REAL DEFAULT 0,
                rating REAL DEFAULT 0,
                completed_tasks INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
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
                location_lat REAL,
                location_lng REAL,
                deadline DATETIME NOT NULL,
                start_time DATETIME,
                end_time DATETIME,
                contact_info TEXT NOT NULL,
                additional_requirements TEXT,
                is_urgent INTEGER DEFAULT 0,
                is_approved INTEGER DEFAULT 0,
                completed_at TIMESTAMP,
                rating INTEGER,
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
                status TEXT DEFAULT 'pending',
                payment_method TEXT,
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
                type TEXT DEFAULT 'info',
                is_read INTEGER DEFAULT 0,
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
                attachment_type TEXT,
                is_read INTEGER DEFAULT 0,
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
                admin_comment TEXT,
                is_approved INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (performer_id) REFERENCES users(id) ON DELETE CASCADE
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

        // 1. Подписки
        const subscriptionsExist = await db.get("SELECT 1 FROM subscriptions WHERE name = 'essential'");
        if (!subscriptionsExist) {
           // server.js - обновить данные подписок (примерно строка 180-200)
const subscriptions = [
    [
        'essential', 'Эссеншл', 'Базовый набор услуг для эпизодических задач',
        500, 5000, 500, 5, // месячная цена 500₽, годовая 5000₽, вступительный 500₽, 5 задач в месяц
        '["До 5 задач в месяц", "Базовые услуги бесплатно", "Поддержка по email", "Стандартное время ответа"]',
        '#FF6B8B', 1, 1
    ],
    [
        'premium', 'Премиум', 'Полный доступ ко всем услугам и приоритетная поддержка',
        1990, 19900, 1000, 999, // месячная цена 1990₽, годовая 19900₽, вступительный 1000₽, неограниченно
        '["Неограниченные задачи", "Все услуги бесплатно", "Приоритетная поддержка 24/7", "Личный помощник"]',
        '#9B59B6', 2, 1
    ]
];

            for (const sub of subscriptions) {
                await db.run(
                    `INSERT INTO subscriptions 
                    (name, display_name, description, price_monthly, price_yearly, 
                     initial_fee, tasks_limit, features, color_theme, sort_order, is_active) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    sub
                );
            }
            console.log('✅ Тарифы подписок созданы');
        }

        // 2. Категории услуг
        const categoriesExist = await db.get("SELECT 1 FROM categories WHERE name = 'home_and_household'");
        if (!categoriesExist) {
            const categories = [
                ['home_and_household', 'Дом и быт', 'Услуги для дома и бытовых нужд', '🏠', '#FF6B8B', 1, 1],
                ['family_and_children', 'Дети и семья', 'Услуги для детей и семейных нужд', '👨‍👩‍👧‍👦', '#3498DB', 2, 1],
                ['beauty_and_health', 'Красота и здоровье', 'Услуги красоты и здоровья', '💅', '#9B59B6', 3, 1],
                ['courses_and_education', 'Курсы и образование', 'Образовательные услуги', '🎓', '#2ECC71', 4, 1]
            ];

            for (const cat of categories) {
                await db.run(
                    `INSERT INTO categories 
                    (name, display_name, description, icon, color, sort_order, is_active) 
                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    cat
                );
            }
            console.log('✅ Категории услуг созданы');
        }

        // 3. Услуги
        const servicesExist = await db.get("SELECT 1 FROM services WHERE name = 'Уборка квартиры'");
        if (!servicesExist) {
            const categories = await db.all("SELECT id, name FROM categories");
            const categoryMap = {};
            categories.forEach(cat => categoryMap[cat.name] = cat.id);

            const services = [
                [categoryMap.home_and_household, 'Уборка квартиры', 'Генеральная или поддерживающая уборка квартиры', 1500, '2-4 часа'],
                [categoryMap.home_and_household, 'Химчистка мебели', 'Профессиональная химчистка диванов, кресел, матрасов', 3000, '3-5 часов'],
                [categoryMap.family_and_children, 'Няня на час', 'Присмотр за детьми на несколько часов', 500, '1 час'],
                [categoryMap.family_and_children, 'Репетитор для ребенка', 'Помощь с уроками по школьным предметам', 800, '1 час'],
                [categoryMap.beauty_and_health, 'Маникюр на дому', 'Профессиональный маникюр с выездом', 1200, '1.5 часа'],
                [categoryMap.beauty_and_health, 'Стрижка и укладка', 'Парикмахерские услуги на дому', 1500, '2 часа']
            ];

            for (const service of services) {
                await db.run(
                    `INSERT INTO services 
                    (category_id, name, description, base_price, estimated_time, is_active) 
                    VALUES (?, ?, ?, ?, ?, 1)`,
                    service
                );
            }
            console.log('✅ Услуги созданы');
        }

        // 4. Тестовые пользователи
        const usersExist = await db.get("SELECT 1 FROM users WHERE email = 'admin@concierge.ru'");
        if (!usersExist) {
            const passwordHash = await bcrypt.hash('admin123', 12);
            const clientPasswordHash = await bcrypt.hash('client123', 12);
            const performerPasswordHash = await bcrypt.hash('performer123', 12);
            
            const expiryDate = new Date();
            expiryDate.setFullYear(expiryDate.getFullYear() + 1);
            const expiryDateStr = expiryDate.toISOString().split('T')[0];

            const users = [
                // Администраторы
                ['superadmin@concierge.ru', passwordHash, 'Александр', 'Иванов', '+79991112233', 'superadmin', 'premium', 'active', expiryDateStr, null, null, 1, 1000, 50000, 1],
                ['admin@concierge.ru', passwordHash, 'Екатерина', 'Петрова', '+79992223344', 'admin', 'premium', 'active', expiryDateStr, null, null, 1, 1000, 50000, 1],
                ['manager@concierge.ru', passwordHash, 'Ольга', 'Сидорова', '+79993334455', 'manager', 'premium', 'active', expiryDateStr, null, null, 1, 1000, 50000, 1],
                
                // Помощники
                ['performer1@concierge.ru', performerPasswordHash, 'Анна', 'Кузнецова', '+79994445566', 'performer', 'essential', 'active', expiryDateStr, null, null, 1, 500, 0, 1],
                ['performer2@concierge.ru', performerPasswordHash, 'Мария', 'Смирнова', '+79995556677', 'performer', 'essential', 'active', expiryDateStr, null, null, 1, 500, 0, 1],
                
                // Клиенты
                ['client1@example.com', clientPasswordHash, 'Елена', 'Васильева', '+79997778899', 'client', 'premium', 'active', expiryDateStr, null, null, 1, 1000, 10000, 1],
                ['client2@example.com', clientPasswordHash, 'Наталья', 'Федорова', '+79998889900', 'client', 'essential', 'active', expiryDateStr, null, null, 1, 500, 5000, 1]
            ];

            for (const user of users) {
                const [email, password, first_name, last_name, phone, role, subscription_plan, subscription_status, subscription_expires, telegram_id, telegram_username, initial_fee_paid, initial_fee_amount, balance, is_active] = user;
                
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

        console.log('🎉 Все начальные данные созданы!');
        
        console.log('\n🔑 ТЕСТОВЫЕ АККАУНТЫ:');
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

const formatPrice = (price) => {
    return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        minimumFractionDigits: 0
    }).format(price);
};

// server.js - добавить перед authMiddleware (примерно строка 630)
// Проверка токена (для веб-приложения)
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
        
        res.json({
            success: true,
            data: { user }
        });
        
    } catch (error) {
        console.error('Ошибка проверки токена:', error);
        res.status(401).json({
            success: false,
            error: 'Неверный токен'
        });
    }
});

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
        version: '5.3.0',
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
                'GET /api/subscriptions - Все подписки'
            ],
            tasks: [
                'GET /api/tasks - Мои задачи',
                'POST /api/tasks - Создать задачу',
                'GET /api/tasks/:id - Получить задачу',
                'POST /api/tasks/:id/status - Изменить статус',
                'POST /api/tasks/:id/cancel - Отменить задачу',
                'POST /api/tasks/:id/take - Принять задачу (для помощников)'
            ],
            chat: [
                'GET /api/tasks/:id/messages - Получить сообщения',
                'POST /api/tasks/:id/messages - Отправить сообщение'
            ],
            reviews: [
                'POST /api/tasks/:id/reviews - Оставить отзыв'
            ],
            notifications: [
                'GET /api/notifications - Мои уведомления',
                'PUT /api/notifications/:id/read - Отметить как прочитанное'
            ]
        },
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
    try {
        const { email, password, first_name, last_name, phone, subscription_plan = 'essential' } = req.body;
        
        // Валидация
        if (!email || !password || !first_name || !last_name || !phone) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля: email, password, first_name, last_name, phone'
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
                error: 'Некорректный номер телефона. Используйте формат +7XXXXXXXXXX'
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
        
        // Проверяем существование подписки
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
        
        // Хеширование пароля
        const hashedPassword = await bcrypt.hash(password, 12);
        
        // Определяем статус подписки
        const initialFeePaid = subscription.initial_fee === 0 ? 1 : 0;
        const subscriptionStatus = initialFeePaid ? 'active' : 'pending';
        
        // Дата истечения подписки
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 30);
        const expiryDateStr = initialFeePaid ? expiryDate.toISOString().split('T')[0] : null;
        
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
                expiryDateStr,
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
                    initial_fee_paid, initial_fee_amount, avatar_url
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
            await logAudit(user.id, 'login_failed', 'user', user.id, {
                reason: 'wrong_password'
            });
            
            return res.status(401).json({
                success: false,
                error: 'Неверный email или пароль'
            });
        }
        
        // Проверяем, оплачен ли вступительный взнос
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
        
        // Логируем успешный вход
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

// Профиль пользователя
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
        
        // Получаем информацию о подписке
        const subscription = await db.get(
            'SELECT * FROM subscriptions WHERE name = ?',
            [user.subscription_plan || 'essential']
        );
        
        // Статистика
        const stats = await db.get(`
            SELECT 
                COUNT(*) as total_tasks,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
                SUM(CASE WHEN status IN ('new', 'searching', 'assigned', 'in_progress') THEN 1 ELSE 0 END) as active_tasks,
                SUM(price) as total_spent
            FROM tasks 
            WHERE client_id = ?
        `, [req.user.id]);
        
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

// Обновление профиля
app.put('/api/auth/profile', authMiddleware(), async (req, res) => {
    try {
        const { first_name, last_name, phone, avatar_url, telegram_username } = req.body;
        
        // Валидация
        if (phone && !validatePhone(phone)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный номер телефона'
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
                    avatar_url
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        
        // Логируем обновление
        await logAudit(req.user.id, 'update_profile', 'user', req.user.id, {
            fields_updated: updateFields.length - 1
        });
        
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
        
        // Проверяем существование категории
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
        
        // Получаем услуги категории
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

// Получение всех услуг
app.get('/api/services', async (req, res) => {
    try {
        const { category_id, search, limit = 50, offset = 0 } = req.query;
        
        let query = `
            SELECT s.*, c.display_name as category_name, c.icon as category_icon
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
        
        res.json({
            success: true,
            data: {
                services,
                pagination: {
                    limit: parseInt(limit),
                    offset: parseInt(offset)
                }
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

// Получение деталей услуги
app.get('/api/services/:id', async (req, res) => {
    const serviceId = parseInt(req.params.id);
    
    try {
        if (isNaN(serviceId)) {
            return res.status(400).json({
                success: false,
                error: 'Неверный ID услуги'
            });
        }
        
        const service = await db.get(
            `SELECT s.*, c.display_name as category_name, c.icon as category_icon,
                    c.description as category_description
             FROM services s
             LEFT JOIN categories c ON s.category_id = c.id
             WHERE s.id = ? AND s.is_active = 1`,
            [serviceId]
        );
        
        if (!service) {
            return res.status(404).json({
                success: false,
                error: 'Услуга не найдена'
            });
        }
        
        // Получаем похожие услуги
        const similarServices = await db.all(
            `SELECT s.id, s.name, s.description, s.base_price, s.estimated_time
             FROM services s
             WHERE s.category_id = ? AND s.id != ? AND s.is_active = 1
             ORDER BY RANDOM()
             LIMIT 3`,
            [service.category_id, serviceId]
        );
        
        res.json({
            success: true,
            data: {
                service,
                similar_services: similarServices
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения деталей услуги:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения деталей услуги'
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
            features: typeof sub.features === 'string' ? JSON.parse(sub.features) : sub.features,
            formatted_price_monthly: formatPrice(sub.price_monthly),
            formatted_price_yearly: formatPrice(sub.price_yearly),
            formatted_initial_fee: formatPrice(sub.initial_fee)
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

// server.js - обновить /api/subscriptions/subscribe
app.post('/api/subscriptions/subscribe', authMiddleware(['client']), async (req, res) => {
    try {
        const { plan, period = 'monthly' } = req.body;
        
        if (!plan) {
            return res.status(400).json({
                success: false,
                error: 'Не указан тарифный план'
            });
        }
        
        // Проверяем существование подписки
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
        
        const price = period === 'yearly' ? subscription.price_yearly : subscription.price_monthly;
        const requiresInitialFee = subscription.initial_fee > 0;
        const totalAmount = price + (requiresInitialFee ? subscription.initial_fee : 0);
        
        // Проверяем баланс
        if (req.user.balance < totalAmount) {
            return res.status(400).json({
                success: false,
                error: 'Недостаточно средств на балансе',
                requires_initial_fee: requiresInitialFee,
                initial_fee_amount: subscription.initial_fee,
                subscription_price: price,
                total_amount: totalAmount,
                current_balance: req.user.balance
            });
        }
        
        // Списываем общую сумму
        await db.run(
            'UPDATE users SET balance = balance - ? WHERE id = ?',
            [totalAmount, req.user.id]
        );
        
        // Создаем записи о платежах
        
        // 1. Вступительный взнос (если требуется)
        if (requiresInitialFee) {
            const initialFeeTransactionId = `INITIAL-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
            await db.run(
                `INSERT INTO payments 
                (user_id, subscription_id, amount, description, status, payment_method, transaction_id) 
                VALUES (?, ?, ?, ?, 'completed', 'initial_fee', ?)`,
                [
                    req.user.id,
                    subscription.id,
                    subscription.initial_fee,
                    `Вступительный взнос для подписки "${subscription.display_name}"`,
                    initialFeeTransactionId
                ]
            );
        }
        
        // 2. Платеж за подписку
        const subscriptionTransactionId = `SUBSCRIPTION-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
        await db.run(
            `INSERT INTO payments 
            (user_id, subscription_id, amount, description, status, payment_method, transaction_id) 
            VALUES (?, ?, ?, ?, 'completed', 'subscription', ?)`,
            [
                req.user.id,
                subscription.id,
                price,
                `Подписка "${subscription.display_name}" на ${period === 'yearly' ? 'год' : 'месяц'}`,
                subscriptionTransactionId
            ]
        );
        
        // Обновляем статус пользователя
        const expiryDate = new Date();
        if (period === 'yearly') {
            expiryDate.setFullYear(expiryDate.getFullYear() + 1);
        } else {
            expiryDate.setMonth(expiryDate.getMonth() + 1);
        }
        
        await db.run(
            `UPDATE users SET 
                subscription_plan = ?,
                subscription_status = 'active',
                initial_fee_paid = ?,
                initial_fee_amount = ?,
                subscription_expires = ?
             WHERE id = ?`,
            [
                plan,
                requiresInitialFee ? 1 : 0,
                subscription.initial_fee,
                expiryDate.toISOString().split('T')[0],
                req.user.id
            ]
        );
        
        // Получаем обновленного пользователя
        const updatedUser = await db.get(
            `SELECT id, email, first_name, last_name, role, 
                    subscription_plan, subscription_status, subscription_expires,
                    initial_fee_paid, initial_fee_amount, balance
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        
        // Добавляем уведомление
        await db.run(
            `INSERT INTO notifications (user_id, title, message, type) 
             VALUES (?, ?, ?, ?)`,
            [
                req.user.id,
                'Подписка активирована!',
                `Подписка "${subscription.display_name}" успешно активирована. 
                 Вступительный взнос: ${requiresInitialFee ? subscription.initial_fee + '₽' : 'не требуется'}.
                 Абонентская плата: ${price}₽ за ${period === 'yearly' ? 'год' : 'месяц'}.`,
                'success'
            ]
        );
        
        // Логируем активацию подписки
        await logAudit(req.user.id, 'subscribe', 'subscription', subscription.id, {
            plan: plan,
            period: period,
            initial_fee: subscription.initial_fee,
            subscription_price: price,
            total_amount: totalAmount
        });
        
        res.json({
            success: true,
            message: 'Подписка успешно активирована!',
            data: {
                user: updatedUser,
                subscription,
                payment_details: {
                    initial_fee: subscription.initial_fee,
                    subscription_price: price,
                    period: period,
                    total_amount: totalAmount,
                    balance_after: req.user.balance - totalAmount
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка активации подписки:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка активации подписки'
        });
    }
});

// ==================== ЗАДАЧИ ====================

// server.js - обновить POST /api/tasks (примерно строка 1050-1100)
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
        
        // Валидация
        if (!title || !description || !category_id || !deadline || !address || !contact_info) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля'
            });
        }
        
        // Проверяем существование категории
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
        
        // Проверяем подписку пользователя
        const user = await db.get(
            `SELECT u.*, s.tasks_limit 
             FROM users u
             LEFT JOIN subscriptions s ON u.subscription_plan = s.name
             WHERE u.id = ?`,
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
        
        // Проверяем лимит задач
        if (user.tasks_limit !== 999) { // 999 = безлимит
            const tasksThisMonth = await db.get(
                `SELECT COUNT(*) as count FROM tasks 
                 WHERE client_id = ? 
                 AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`,
                [req.user.id]
            );
            
            if (tasksThisMonth.count >= user.tasks_limit) {
                return res.status(403).json({
                    success: false,
                    error: `Вы исчерпали лимит задач на этот месяц (${user.tasks_limit}). Обновите подписку или дождитесь следующего месяца.`
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
        const taskNumber = generateTaskNumber();
        
        // Для услуг получаем базовую цену для отображения, но не списываем с баланса
        let servicePrice = 0;
        if (service_id) {
            const service = await db.get(
                'SELECT base_price FROM services WHERE id = ?',
                [service_id]
            );
            if (service) {
                servicePrice = service.base_price;
            }
        }
        
        // Создаем задачу БЕЗ списания средств
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
                servicePrice, // Сохраняем цену услуги, но не списываем
                address,
                deadline,
                contact_info,
                additional_requirements || null
            ]
        );
        
        const taskId = result.lastID;
        
        // Добавляем запись в историю статусов
        await db.run(
            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
             VALUES (?, ?, ?, ?)`,
            [taskId, 'new', req.user.id, 'Задача создана клиентом']
        );
        
        // Получаем созданную задачу
        const task = await db.get(
            `SELECT t.*, c.display_name as category_name
             FROM tasks t 
             LEFT JOIN categories c ON t.category_id = c.id 
             WHERE t.id = ?`,
            [taskId]
        );
        
        // Добавляем уведомление
        await db.run(
            `INSERT INTO notifications (user_id, title, message, type, data) 
             VALUES (?, ?, ?, ?, ?)`,
            [
                req.user.id,
                'Задача создана!',
                `Задача "${title}" успешно создана. Номер: ${taskNumber}. Включена в вашу подписку.`,
                'success',
                JSON.stringify({ task_id: task.id, task_number: taskNumber })
            ]
        );
        
        // Логируем создание задачи
        await logAudit(req.user.id, 'create_task', 'task', taskId, {
            task_number: taskNumber,
            title: title,
            included_in_subscription: true
        });
        
        res.status(201).json({
            success: true,
            message: 'Задача успешно создана и включена в вашу подписку!',
            data: { 
                task,
                included_in_subscription: true
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
        if (!['admin', 'manager', 'superadmin'].includes(req.user.role)) {
            if (req.user.role === 'client') {
                query += ' AND t.client_id = ?';
                params.push(req.user.id);
            } else if (req.user.role === 'performer') {
                query += ' AND (t.performer_id = ? OR t.status = "searching")';
                params.push(req.user.id);
            }
        }
        
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
        
        // Проверяем права доступа
        if (req.user.id !== task.client_id && 
            req.user.id !== task.performer_id && 
            !['admin', 'manager', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'Нет доступа к этой задаче'
            });
        }
        
        // Получаем историю статусов
        const statusHistory = await db.all(
            `SELECT tsh.*, u.first_name, u.last_name
             FROM task_status_history tsh
             LEFT JOIN users u ON tsh.changed_by = u.id
             WHERE tsh.task_id = ?
             ORDER BY tsh.created_at ASC`,
            [taskId]
        );
        
        // Получаем количество сообщений
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
        console.error('Ошибка получения задачи:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения задачи'
        });
    }
});

// Изменение статуса задачи
app.post('/api/tasks/:id/status', authMiddleware(), async (req, res) => {
    const taskId = req.params.id;
    
    try {
        const { status, notes, performer_id } = req.body;
        
        if (!status) {
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
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        // Проверяем права
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
        
        // Обновляем статус
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
            [taskId, status, req.user.id, notes || `Статус изменен`]
        );
        
        // Отправляем уведомления
        if (req.user.id !== task.client_id) {
            await db.run(
                `INSERT INTO notifications (user_id, title, message, type) 
                 VALUES (?, ?, ?, ?)`,
                [
                    task.client_id,
                    `Статус задачи изменен`,
                    `Статус задачи "${task.title}" изменен на "${status}".`,
                    'info'
                ]
            );
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
        console.error('Ошибка изменения статуса:', error);
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
        
        // Проверяем права
        const canCancel = 
            ['admin', 'manager', 'superadmin'].includes(req.user.role) ||
            (req.user.id === task.client_id && ['new', 'searching', 'assigned'].includes(task.status));
        
        if (!canCancel) {
            return res.status(403).json({
                success: false,
                error: 'Нет прав для отмены задачи'
            });
        }
        
        // Возвращаем деньги клиенту
        if (task.status !== 'completed' && task.price > 0) {
            await db.run(
                'UPDATE users SET balance = balance + ? WHERE id = ?',
                [task.price, task.client_id]
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
            [taskId, 'cancelled', req.user.id, reason || 'Задача отменена']
        );
        
        // Уведомляем клиента
        if (req.user.id !== task.client_id) {
            await db.run(
                `INSERT INTO notifications (user_id, title, message, type) 
                 VALUES (?, ?, ?, ?)`,
                [
                    task.client_id,
                    'Задача отменена',
                    `Задача "${task.title}" была отменена. ${reason ? `Причина: ${reason}` : ''}`,
                    'warning'
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
        console.error('Ошибка отмены задачи:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка отмены задачи'
        });
    }
});

// server.js - добавить новый маршрут
// Получение статистики использования подписки
app.get('/api/tasks/usage', authMiddleware(['client']), async (req, res) => {
    try {
        const user = await db.get(
            `SELECT u.*, s.tasks_limit 
             FROM users u
             LEFT JOIN subscriptions s ON u.subscription_plan = s.name
             WHERE u.id = ?`,
            [req.user.id]
        );
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        const tasksUsed = await db.get(
            `SELECT COUNT(*) as count FROM tasks 
             WHERE client_id = ? 
             AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
             AND status != 'cancelled'`,
            [req.user.id]
        );
        
        res.json({
            success: true,
            data: {
                tasks_limit: user.tasks_limit,
                tasks_used: tasksUsed.count || 0,
                tasks_remaining: user.tasks_limit === 999 ? '∞' : Math.max(0, user.tasks_limit - tasksUsed.count),
                is_unlimited: user.tasks_limit === 999,
                subscription_plan: user.subscription_plan
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

// Принятие задачи исполнителем
app.post('/api/tasks/:id/take', authMiddleware(['performer']), async (req, res) => {
    const taskId = req.params.id;
    
    try {
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
        
        // Назначаем задачу исполнителю
        await db.run(
            `UPDATE tasks SET 
                performer_id = ?,
                status = 'assigned',
                updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [req.user.id, taskId]
        );
        
        // Добавляем запись в историю
        await db.run(
            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
             VALUES (?, ?, ?, ?)`,
            [taskId, 'assigned', req.user.id, 'Задача принята исполнителем']
        );
        
        // Уведомляем клиента
        await db.run(
            `INSERT INTO notifications (user_id, title, message, type) 
             VALUES (?, ?, ?, ?)`,
            [
                task.client_id,
                'Исполнитель найден!',
                `Исполнитель принял вашу задачу "${task.title}".`,
                'success'
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
        console.error('Ошибка принятия задачи:', error);
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
                error: 'Нет доступа к чату'
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
        
        // Помечаем сообщения как прочитанные
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
        
        // Получаем участников чата
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
        console.error('Ошибка получения сообщений:', error);
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
                error: 'Нет доступа к чату'
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
            `SELECT tm.*, u.first_name, u.last_name, u.avatar_url, u.role
             FROM task_messages tm
             LEFT JOIN users u ON tm.user_id = u.id
             WHERE tm.id = ?`,
            [result.lastID]
        );
        
        // Определяем кому отправлять уведомление
        const notifyUserIds = [];
        
        if (req.user.id === task.client_id && task.performer_id) {
            notifyUserIds.push(task.performer_id);
        } else if (req.user.id === task.performer_id) {
            notifyUserIds.push(task.client_id);
        } else if (['admin', 'manager', 'superadmin'].includes(req.user.role)) {
            if (task.client_id !== req.user.id) notifyUserIds.push(task.client_id);
            if (task.performer_id && task.performer_id !== req.user.id) notifyUserIds.push(task.performer_id);
        }
        
        // Отправляем уведомления
        for (const notifyUserId of notifyUserIds) {
            await db.run(
                `INSERT INTO notifications (user_id, title, message, type) 
                 VALUES (?, ?, ?, ?)`,
                [
                    notifyUserId,
                    'Новое сообщение в задаче',
                    `Новое сообщение в задаче "${task.title}".`,
                    'info'
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
        console.error('Ошибка отправки сообщения:', error);
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
        
        // Проверяем права
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
        
        // Проверяем, не оценивалась ли уже задача
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
        
        // Проверяем, есть ли исполнитель
        if (!task.performer_id) {
            return res.status(400).json({
                success: false,
                error: 'Нельзя оставить отзыв к задаче без исполнителя'
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
        
        // Обновляем рейтинг исполнителя
        const performerStats = await db.get(
            `SELECT AVG(r.rating) as avg_rating, COUNT(r.id) as reviews_count
             FROM reviews r
             WHERE r.performer_id = ?`,
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
            `INSERT INTO notifications (user_id, title, message, type) 
             VALUES (?, ?, ?, ?)`,
            [
                task.performer_id,
                'Новый отзыв о вашей работе',
                `Клиент оценил вашу работу по задаче "${task.title}" на ${rating}/5`,
                'success'
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
        console.error('Ошибка оставления отзыва:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка оставления отзыва'
        });
    }
});

// ==================== УВЕДОМЛЕНИЯ ====================

// Получение уведомлений
app.get('/api/notifications', authMiddleware(), async (req, res) => {
    try {
        const { unread_only = false, limit = 50, offset = 0 } = req.query;
        
        let query = `
            SELECT n.* 
            FROM notifications n
            WHERE n.user_id = ?
        `;
        
        const params = [req.user.id];
        
        if (unread_only === 'true') {
            query += ' AND n.is_read = 0';
        }
        
        query += ' ORDER BY n.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const notifications = await db.all(query, params);
        
        // Получаем количество непрочитанных
        const unreadCount = await db.get(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
            [req.user.id]
        );
        
        res.json({
            success: true,
            data: {
                notifications,
                unread_count: unreadCount?.count || 0,
                pagination: {
                    limit: parseInt(limit),
                    offset: parseInt(offset)
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

// Отметка уведомления как прочитанного
app.put('/api/notifications/:id/read', authMiddleware(), async (req, res) => {
    const notificationId = req.params.id;
    
    try {
        // Проверяем, принадлежит ли уведомление пользователю
        const notification = await db.get(
            'SELECT id FROM notifications WHERE id = ? AND user_id = ?',
            [notificationId, req.user.id]
        );
        
        if (!notification) {
            return res.status(404).json({
                success: false,
                error: 'Уведомление не найдено'
            });
        }
        
        // Обновляем статус
        await db.run(
            'UPDATE notifications SET is_read = 1 WHERE id = ?',
            [notificationId]
        );
        
        res.json({
            success: true,
            message: 'Уведомление отмечено как прочитанное'
        });
        
    } catch (error) {
        console.error('Ошибка отметки уведомления:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка отметки уведомления'
        });
    }
});

// Отметка всех уведомлений как прочитанных
app.put('/api/notifications/read-all', authMiddleware(), async (req, res) => {
    try {
        const result = await db.run(
            'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0',
            [req.user.id]
        );
        
        res.json({
            success: true,
            message: `Все уведомления (${result.changes}) отмечены как прочитанные`,
            data: {
                marked_count: result.changes
            }
        });
        
    } catch (error) {
        console.error('Ошибка отметки всех уведомлений:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка отметки уведомлений'
        });
    }
});

// ==================== АДМИН ПАНЕЛЬ ====================

// Дашборд администратора
app.get('/api/admin/dashboard', authMiddleware(['admin', 'manager', 'superadmin']), async (req, res) => {
    try {
        const today = new Date();
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        
        // Основная статистика
        const [totalUsers, totalTasks, completedTasks, totalRevenue] = await Promise.all([
            db.get('SELECT COUNT(*) as count FROM users'),
            db.get('SELECT COUNT(*) as count FROM tasks'),
            db.get('SELECT COUNT(*) as count FROM tasks WHERE status = "completed"'),
            db.get('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = "completed"')
        ]);
        
        // Статистика за месяц
        const [monthlyTasks, monthlyRevenue] = await Promise.all([
            db.get('SELECT COUNT(*) as count FROM tasks WHERE created_at >= ?', [monthStart.toISOString()]),
            db.get('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = "completed" AND created_at >= ?', [monthStart.toISOString()])
        ]);
        
        // Распределение по категориям
        const categoriesStats = await db.all(`
            SELECT c.id, c.display_name, c.icon, c.color,
                   COUNT(t.id) as task_count,
                   SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed_count,
                   SUM(t.price) as total_revenue
            FROM categories c
            LEFT JOIN tasks t ON c.id = t.category_id
            WHERE c.is_active = 1
            GROUP BY c.id
            ORDER BY task_count DESC
            LIMIT 5
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
            LIMIT 5
        `);
        
        // Последние пользователи
        const recentUsers = await db.all(`
            SELECT id, email, first_name, last_name, role, subscription_plan, created_at
            FROM users
            ORDER BY created_at DESC
            LIMIT 5
        `);
        
        res.json({
            success: true,
            data: {
                summary: {
                    total_users: totalUsers.count,
                    total_tasks: totalTasks.count,
                    completed_tasks: completedTasks.count,
                    total_revenue: totalRevenue.total,
                    monthly_new_tasks: monthlyTasks.count,
                    monthly_revenue: monthlyRevenue.total
                },
                categories: categoriesStats,
                recent_tasks: recentTasks,
                recent_users: recentUsers
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

// ==================== СИСТЕМА ====================

// Информация о системе
app.get('/api/system/info', async (req, res) => {
    try {
        const [categoriesCount, tasksCount, usersCount, servicesCount] = await Promise.all([
            db.get('SELECT COUNT(*) as count FROM categories WHERE is_active = 1'),
            db.get('SELECT COUNT(*) as count FROM tasks'),
            db.get('SELECT COUNT(*) as count FROM users'),
            db.get('SELECT COUNT(*) as count FROM services WHERE is_active = 1')
        ]);
        
        res.json({
            success: true,
            data: {
                statistics: {
                    categories: categoriesCount.count,
                    tasks: tasksCount.count,
                    users: usersCount.count,
                    services: servicesCount.count
                },
                system: {
                    version: '5.3.0',
                    environment: process.env.NODE_ENV || 'development',
                    uptime: `${Math.floor(process.uptime() / 60)} минут`,
                    database: 'SQLite'
                },
                server_time: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения информации о системе:', error);
        res.json({
            success: false,
            data: {
                version: '5.3.0',
                status: 'running',
                error: error.message
            }
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
        error: 'API маршрут не найден',
        path: req.path,
        method: req.method
    });
});

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

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎀 ЗАПУСК ЖЕНСКОГО КОНСЬЕРЖА v5.3.0');
        console.log('='.repeat(80));
        console.log(`🌐 PORT: ${process.env.PORT || 3000}`);
        console.log(`🏷️  NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🔐 JWT_SECRET: ${process.env.JWT_SECRET ? 'configured' : 'using default'}`);
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
            console.log(`🏥 Health check: http://localhost:${PORT}/health`);
            console.log('='.repeat(80));
            console.log('🎀 СИСТЕМА ГОТОВА К РАБОТЕ!');
            console.log('='.repeat(80));
            
            console.log('\n🔑 ТЕСТОВЫЕ АККАУНТЫ:');
            console.log('='.repeat(60));
            console.log('👑 Суперадмин: superadmin@concierge.ru / admin123');
            console.log('👨‍💼 Админ: admin@concierge.ru / admin123');
            console.log('👨‍💼 Менеджер: manager@concierge.ru / admin123');
            console.log('👩‍🏫 Помощник 1: performer1@concierge.ru / performer123');
            console.log('👩‍🏫 Помощник 2: performer2@concierge.ru / performer123');
            console.log('👩 Клиент Премиум: client1@example.com / client123');
            console.log('👩 Клиент Эссеншл: client2@example.com / client123');
            console.log('='.repeat(60));
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

// Запуск
startServer();
