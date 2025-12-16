// server.js - исправленная версия для работы с вашим фронтендом
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
const app = express();

// CORS настройки для продакшена
const corsOptions = {
    origin: function (origin, callback) {
        // Разрешаем запросы без origin
        if (!origin) return callback(null, true);
        
        // Разрешенные домены
        const allowedOrigins = process.env.ALLOWED_ORIGINS 
            ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
            : ['https://sergeynikishin555123123-lab--86fa.twc1.net'];
        
        // Добавляем localhost для разработки
        if (process.env.NODE_ENV !== 'production') {
            allowedOrigins.push('http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3001');
        }
        
        // Проверяем origin
        if (allowedOrigins.indexOf(origin) !== -1 || allowedOrigins.includes('*')) {
            callback(null, true);
        } else {
            console.log(`❌ CORS заблокирован для origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Forwarded-For'],
    exposedHeaders: ['Content-Range', 'X-Content-Range'],
    maxAge: 86400
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Body parsing с лимитами
app.use(express.json({ 
    limit: process.env.BODY_LIMIT || '10mb'
}));
app.use(express.urlencoded({ 
    extended: true, 
    limit: process.env.BODY_LIMIT || '10mb',
    parameterLimit: 100
}));

// Статические файлы
app.use(express.static('public', {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
    setHeaders: (res, path) => {
        if (path.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

// ==================== ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ ====================
let db;

const initDatabase = async () => {
    try {
        console.log('🔄 Инициализация базы данных...');
        
        // Определяем путь к базе данных
        let dbPath;
        if (process.env.DATABASE_PATH) {
            dbPath = process.env.DATABASE_PATH;
        } else if (process.env.NODE_ENV === 'production' && os.platform() !== 'win32') {
            dbPath = '/tmp/concierge_prod.db';
        } else if (process.env.NODE_ENV === 'production') {
            dbPath = './concierge_prod.db';
        } else if (process.env.NODE_ENV === 'test') {
            dbPath = process.env.TEST_DATABASE_PATH || './concierge_test.db';
        } else {
            dbPath = './concierge.db';
        }
        
        console.log(`📁 Путь к базе данных: ${dbPath}`);
        
        // Проверяем доступные пути для записи
        const possiblePaths = [
            dbPath,
            '/tmp/concierge_prod.db',
            '/var/tmp/concierge_prod.db',
            os.tmpdir() + '/concierge_prod.db',
            './concierge_prod.db',
            './data/concierge.db'
        ];
        
        let selectedPath = null;
        
        for (const testPath of possiblePaths) {
            try {
                const testDir = path.dirname(testPath);
                
                // Пытаемся создать директорию
                if (!fs.existsSync(testDir)) {
                    fs.mkdirSync(testDir, { recursive: true, mode: 0o755 });
                }
                
                // Пытаемся создать тестовый файл
                const testFile = testPath + '.test';
                fs.writeFileSync(testFile, 'test');
                fs.unlinkSync(testFile);
                
                selectedPath = testPath;
                console.log(`✅ Найден доступный путь: ${testPath}`);
                break;
            } catch (error) {
                console.log(`❌ Путь недоступен: ${testPath} - ${error.message}`);
                continue;
            }
        }
        
        if (!selectedPath) {
            throw new Error('Не удалось найти доступное место для базы данных');
        }
        
        dbPath = selectedPath;
        console.log(`📁 Финальный выбранный путь: ${dbPath}`);
        
        // Открываем базу данных
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database,
            verbose: process.env.NODE_ENV === 'development'
        });

        console.log('✅ База данных SQLite подключена');

        // Оптимизация
        await db.run('PRAGMA foreign_keys = ON');
        await db.run('PRAGMA journal_mode = WAL');
        await db.run('PRAGMA synchronous = NORMAL');
        await db.run('PRAGMA cache_size = -2000');
        await db.run('PRAGMA temp_store = MEMORY');
        
        if (process.env.NODE_ENV === 'production') {
            await db.run('PRAGMA auto_vacuum = INCREMENTAL');
            await db.run('PRAGMA busy_timeout = 5000');
        }

        // Создание таблиц
        await createTables();
        
        console.log('✅ Все таблицы созданы');

        // Создаем начальные данные
        await createInitialData();
        
        return db;
    } catch (error) {
        console.error('❌ Ошибка инициализации базы данных:', error.message);
        console.error('Stack trace:', error.stack);
        throw error;
    }
};

// Создание таблиц
const createTables = async () => {
    const tables = [
        // users table
        `CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            phone TEXT NOT NULL,
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,

        // subscriptions table
        `CREATE TABLE IF NOT EXISTS subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            display_name TEXT NOT NULL,
            description TEXT NOT NULL,
            price_monthly REAL NOT NULL,
            price_yearly REAL,
            initial_fee REAL NOT NULL DEFAULT 0,
            tasks_limit INTEGER NOT NULL,
            features TEXT NOT NULL,
            color_theme TEXT DEFAULT '#FF6B8B',
            sort_order INTEGER DEFAULT 0,
            is_popular INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,

        // categories table
        `CREATE TABLE IF NOT EXISTS categories (
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

        // services table
        `CREATE TABLE IF NOT EXISTS services (
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

        // tasks table
        `CREATE TABLE IF NOT EXISTS tasks (
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
            started_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP,
            FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (performer_id) REFERENCES users(id) ON DELETE SET NULL,
            FOREIGN KEY (category_id) REFERENCES categories(id),
            FOREIGN KEY (service_id) REFERENCES services(id),
            FOREIGN KEY (cancellation_by) REFERENCES users(id)
        )`,

        // task_status_history table
        `CREATE TABLE IF NOT EXISTS task_status_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL,
            status TEXT NOT NULL,
            changed_by INTEGER NOT NULL,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
            FOREIGN KEY (changed_by) REFERENCES users(id)
        )`,

        // task_messages table
        `CREATE TABLE IF NOT EXISTS task_messages (
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

        // reviews table
        `CREATE TABLE IF NOT EXISTS reviews (
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
        )`,

        // performer_categories table
        `CREATE TABLE IF NOT EXISTS performer_categories (
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

        // transactions table
        `CREATE TABLE IF NOT EXISTS transactions (
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
        )`,

        // notifications table
        `CREATE TABLE IF NOT EXISTS notifications (
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

        // performer_stats table
        `CREATE TABLE IF NOT EXISTS performer_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            performer_id INTEGER NOT NULL,
            total_tasks INTEGER DEFAULT 0,
            completed_tasks INTEGER DEFAULT 0,
            cancelled_tasks INTEGER DEFAULT 0,
            avg_rating REAL DEFAULT 0,
            total_earnings REAL DEFAULT 0,
            last_activity TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (performer_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(performer_id)
        )`,

        // settings table
        `CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE NOT NULL,
            value TEXT,
            description TEXT,
            category TEXT DEFAULT 'general',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,

        // faq table
        `CREATE TABLE IF NOT EXISTS faq (
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
            console.error(`Ошибка создания таблицы: ${tableSql.substring(0, 50)}...`, error);
        }
    }
    
    // Создаем индексы для оптимизации
    try {
        await db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_client_id ON tasks(client_id)');
        await db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_performer_id ON tasks(performer_id)');
        await db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)');
        await db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_category_id ON tasks(category_id)');
        await db.exec('CREATE INDEX IF NOT EXISTS idx_task_messages_task_id ON task_messages(task_id)');
        await db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)');
        await db.exec('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
        await db.exec('CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)');
        await db.exec('CREATE INDEX IF NOT EXISTS idx_users_subscription_status ON users(subscription_status)');
    } catch (error) {
        console.error('Ошибка создания индексов:', error);
    }
};

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

// Генерация номера задачи
const generateTaskNumber = () => {
    const now = new Date();
    const datePart = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}`;
    const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `TASK-${datePart}-${randomPart}`;
};

// Валидация email
const validateEmail = (email) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
};

// Валидация телефона
const validatePhone = (phone) => {
    const cleaned = phone.replace(/\D/g, '');
    return cleaned.length >= 10 && cleaned.length <= 15;
};

// Получение текста статуса
const getStatusText = (status) => {
    const statusMap = {
        'new': 'Новая',
        'searching': 'Поиск исполнителя',
        'assigned': 'Назначена',
        'in_progress': 'В работе',
        'completed': 'Выполнена',
        'cancelled': 'Отменена'
    };
    return statusMap[status] || status;
};

// Обновление статистики исполнителя
async function updatePerformerStats(performerId) {
    try {
        const stats = await db.get(`
            SELECT 
                COUNT(*) as total_tasks,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
                SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_tasks,
                AVG(task_rating) as avg_rating,
                SUM(price) as total_earnings
            FROM tasks 
            WHERE performer_id = ?
        `, [performerId]);
        
        const existingStats = await db.get(
            'SELECT id FROM performer_stats WHERE performer_id = ?',
            [performerId]
        );
        
        if (existingStats) {
            await db.run(
                `UPDATE performer_stats SET 
                    total_tasks = ?,
                    completed_tasks = ?,
                    cancelled_tasks = ?,
                    avg_rating = ?,
                    total_earnings = ?,
                    last_activity = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                 WHERE performer_id = ?`,
                [
                    stats.total_tasks || 0,
                    stats.completed_tasks || 0,
                    stats.cancelled_tasks || 0,
                    stats.avg_rating || 0,
                    stats.total_earnings || 0,
                    performerId
                ]
            );
        } else {
            await db.run(
                `INSERT INTO performer_stats 
                (performer_id, total_tasks, completed_tasks, cancelled_tasks, avg_rating, total_earnings, last_activity)
                VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [
                    performerId,
                    stats.total_tasks || 0,
                    stats.completed_tasks || 0,
                    stats.cancelled_tasks || 0,
                    stats.avg_rating || 0,
                    stats.total_earnings || 0
                ]
            );
        }
        
        await db.run(
            'UPDATE users SET user_rating = ? WHERE id = ?',
            [stats.avg_rating || 0, performerId]
        );
        
    } catch (error) {
        console.error('Ошибка обновления статистики исполнителя:', error);
    }
}

// ==================== JWT МИДЛВАР ====================
const authMiddleware = (roles = []) => {
    return async (req, res, next) => {
        try {
            const authHeader = req.headers.authorization;
            
            // Публичные маршруты
            const publicRoutes = [
                'GET /',
                'GET /health',
                'GET /api',
                'GET /api/subscriptions',
                'GET /api/categories',
                'GET /api/categories/*',
                'GET /api/faq',
                'POST /api/auth/register',
                'POST /api/auth/login',
                'OPTIONS /*',
                'GET /admin.html',
                'GET /performer.html',
                'GET /index.html',
                'GET /api/settings'
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
                console.error('JWT Error:', jwtError.message);
                return res.status(401).json({ 
                    success: false, 
                    error: 'Неверный или истекший токен' 
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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/performer.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'performer.html'));
});

// API информация
app.get('/api', (req, res) => {
    res.json({
        success: true,
        message: '🌸 Добро пожаловать в Женский Консьерж API',
        version: '2.1.0',
        status: '🟢 Работает',
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
        endpoints: {
            auth: '/api/auth/*',
            categories: '/api/categories',
            subscriptions: '/api/subscriptions',
            tasks: '/api/tasks',
            chat: '/api/tasks/:id/messages',
            performer: '/api/performer/*',
            admin: '/api/admin/*',
            notifications: '/api/notifications',
            stats: '/api/stats',
            balance: '/api/balance'
        }
    });
});

// Проверка здоровья
app.get('/health', async (req, res) => {
    try {
        await db.get('SELECT 1 as status');
        
        const tables = ['users', 'categories', 'services', 'tasks', 'subscriptions', 'task_messages', 'performer_stats'];
        const tableStatus = {};
        
        for (const table of tables) {
            try {
                await db.get(`SELECT 1 FROM ${table} LIMIT 1`);
                tableStatus[table] = 'OK';
            } catch (error) {
                tableStatus[table] = 'ERROR';
            }
        }
        
        const memoryUsage = process.memoryUsage();
        
        res.json({
            success: true,
            status: 'OK',
            version: '2.1.0',
            environment: process.env.NODE_ENV || 'development',
            database: 'connected',
            tables: tableStatus,
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: {
                rss: Math.round(memoryUsage.rss / 1024 / 1024) + 'MB',
                heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + 'MB',
                heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB'
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

app.post('/api/auth/register', async (req, res) => {
    try {
        const { phone, password, first_name, last_name = '', email = '', subscription_plan = 'essential', role = 'client' } = req.body;
        
        // Валидация - теперь телефон обязателен, email не обязателен
        if (!phone || !password || !first_name) {
            return res.status(400).json({
                success: false,
                error: 'Заполните телефон, пароль и имя'
            });
        }
        
        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'Пароль должен содержать не менее 6 символов'
            });
        }
        
        if (!validatePhone(phone)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный номер телефона'
            });
        }
        
        // Генерируем email из телефона, если не указан
        const userEmail = email || `${phone.replace(/\D/g, '')}@concierge.local`;
        
        // Проверка существующего пользователя по телефону
        const existingUser = await db.get('SELECT id FROM users WHERE phone = ?', [phone]);
        if (existingUser) {
            return res.status(409).json({
                success: false,
                error: 'Пользователь с таким телефоном уже существует'
            });
        }
        
        // Проверка существующего пользователя по email (если email указан)
        if (email) {
            const existingEmailUser = await db.get('SELECT id FROM users WHERE email = ? AND email != ""', [email]);
            if (existingEmailUser) {
                return res.status(409).json({
                    success: false,
                    error: 'Пользователь с таким email уже существует'
                });
            }
        }
        
        // Проверка подписки - если не существует, используем дефолтные значения
        let subscription;
        try {
            subscription = await db.get(
                'SELECT * FROM subscriptions WHERE name = ? AND is_active = 1',
                [subscription_plan]
            );
        } catch (error) {
            console.log('Подписка не найдена, используем дефолтные значения');
        }
        
        // Если подписка не найдена, создаем дефолтные значения
        if (!subscription) {
            subscription = {
                name: 'essential',
                display_name: 'Эссеншл',
                initial_fee: 500,
                tasks_limit: 5
            };
        }
        
        // Хэширование пароля
        const hashedPassword = await bcrypt.hash(password, 12);
        
        // Для клиентов устанавливаем статус pending, для исполнителей - active
        const isPerformer = role === 'performer';
        const initialFeePaid = isPerformer ? 1 : 0; // Исполнители не платят вступительный взнос
        const subscriptionStatus = isPerformer ? 'active' : 'pending';
        
        let expiryDateStr = null;
        if (isPerformer) {
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + 365); // Год для исполнителей
            expiryDateStr = expiryDate.toISOString().split('T')[0];
        }
        
        // Определяем лимит задач
        let tasksLimit = subscription.tasks_limit || 5;
        if (isPerformer) {
            tasksLimit = 999;
        } else if (role === 'admin' || role === 'manager' || role === 'superadmin') {
            tasksLimit = 9999;
        }
        
        // Генерация аватара
        let avatarBgColor = 'FF6B8B';
        if (role === 'performer') {
            avatarBgColor = '3498DB';
        } else if (role === 'admin' || role === 'manager') {
            avatarBgColor = '2ECC71';
        } else if (role === 'superadmin') {
            avatarBgColor = '9B59B6';
        }
        
        const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(first_name)}+${encodeURIComponent(last_name)}&background=${avatarBgColor}&color=fff&bold=true`;
        
        // Создание пользователя
        const result = await db.run(
            `INSERT INTO users 
            (email, password, first_name, last_name, phone, role, 
             subscription_plan, subscription_status, subscription_expires,
             initial_fee_paid, initial_fee_amount, tasks_limit, avatar_url,
             balance) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                email,
                hashedPassword,
                first_name,
                last_name,
                phone,
                role,
                subscription.name,
                subscriptionStatus,
                expiryDateStr,
                initialFeePaid,
                subscription.initial_fee || 500,
                tasksLimit,
                avatarUrl,
                initialFeePaid ? 0 : (subscription.initial_fee || 500)
            ]
        );
        
        const userId = result.lastID;
        
        // Транзакция для вступительного взноса (если нужно)
        if (subscription.initial_fee > 0 && initialFeePaid) {
            await db.run(
                `INSERT INTO transactions 
                (user_id, type, amount, description, status) 
                VALUES (?, ?, ?, ?, ?)`,
                [
                    userId,
                    'initial_fee',
                    -(subscription.initial_fee || 500),
                    'Вступительный взнос',
                    'completed'
                ]
            );
        }
        
        // Для исполнителей добавляем категории
        if (isPerformer) {
            const categories = await db.all('SELECT id FROM categories WHERE is_active = 1 LIMIT 3');
            for (const category of categories) {
                try {
                    await db.run(
                        `INSERT OR IGNORE INTO performer_categories (performer_id, category_id, is_active) 
                         VALUES (?, ?, 1)`,
                        [userId, category.id]
                    );
                } catch (error) {
                    console.error('Ошибка добавления категории исполнителю:', error);
                }
            }
            
            // Создаем статистику
            try {
                await db.run(
                    `INSERT INTO performer_stats (performer_id, last_activity) VALUES (?, CURRENT_TIMESTAMP)`,
                    [userId]
                );
            } catch (error) {
                console.error('Ошибка создания статистики исполнителя:', error);
            }
        }
        
        // Получаем созданного пользователя
        const user = await db.get(
            `SELECT id, email, first_name, last_name, phone, role, 
                    subscription_plan, subscription_status, subscription_expires,
                    initial_fee_paid, initial_fee_amount, avatar_url, tasks_limit, tasks_used,
                    user_rating, balance
             FROM users WHERE id = ?`,
            [userId]
        );
        
        const userForResponse = {
            ...user,
            rating: user.user_rating || 0
        };
        
        // Генерация JWT токена
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
        
        res.status(201).json({
            success: true,
            message: 'Регистрация успешно завершена!',
            data: { 
                user: userForResponse,
                token,
                requires_initial_fee: !initialFeePaid && (subscription.initial_fee || 500) > 0,
                initial_fee_amount: subscription.initial_fee || 500
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

// Вход (УПРОЩЕННАЯ ВЕРСИЯ)
app.post('/api/auth/login', async (req, res) => {
    try {
        const { phone, email, password } = req.body;
        
        if ((!phone && !email) || !password) {
            return res.status(400).json({
                success: false,
                error: 'Телефон/email и пароль обязательны'
            });
        }
        
        // Ищем пользователя по телефону или email
        const user = await db.get(
            `SELECT * FROM users WHERE (phone = ? OR email = ?) AND is_active = 1`,
            [phone || email, phone || email]
        );
        
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
        
        // Проверка вступительного взноса для клиентов
        if (user.role === 'client' && user.subscription_status === 'pending' && user.initial_fee_paid === 0) {
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
        
        // Обновляем время последнего входа
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
            role: user.role,
            subscription_plan: user.subscription_plan,
            subscription_status: user.subscription_status,
            subscription_expires: user.subscription_expires,
            avatar_url: user.avatar_url,
            balance: user.balance,
            initial_fee_paid: user.initial_fee_paid,
            initial_fee_amount: user.initial_fee_amount,
            rating: user.user_rating || 0,
            completed_tasks: user.completed_tasks,
            tasks_limit: user.tasks_limit,
            tasks_used: user.tasks_used,
            total_spent: user.total_spent,
            last_login: user.last_login,
            email_verified: user.email_verified
        };
        
        // Генерация JWT токена
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
            `SELECT id, email, first_name, last_name, phone, role, 
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
            rating: user.user_rating || 0
        };
        
        res.json({
            success: true,
            data: { user: userForResponse }
        });
        
    } catch (error) {
        console.error('Ошибка проверки токена:', error);
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
            `SELECT id, email, first_name, last_name, phone, role, 
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
        
        const unreadNotifications = await db.get(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
            [req.user.id]
        );
        
        const userForResponse = {
            ...user,
            rating: user.user_rating || 0
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
                    tasks_remaining: (user.tasks_limit || 5) - (user.tasks_used || 0),
                    tasks_limit: user.tasks_limit || 5,
                    tasks_used: user.tasks_used || 0,
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
                categories: categories || [],
                count: categories?.length || 0
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения категорий:', error);
        res.status(500).json({
            success: false,
            data: {
                categories: [],
                count: 0
            }
        });
    }
});

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
                services: services || [],
                count: services?.length || 0
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

// ==================== FAQ ====================
app.get('/api/faq', async (req, res) => {
    try {
        const faq = await db.all(
            'SELECT * FROM faq WHERE is_active = 1 ORDER BY sort_order ASC, category ASC'
        );
        
        res.json({
            success: true,
            data: { faq: faq || [] }
        });
    } catch (error) {
        console.error('Ошибка получения FAQ:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения FAQ'
        });
    }
});

// ==================== ПОДПИСКИ ====================

app.get('/api/subscriptions', async (req, res) => {
    try {
        const subscriptions = await db.all(
            'SELECT * FROM subscriptions WHERE is_active = 1 ORDER BY sort_order ASC, price_monthly ASC'
        );
        
        const subscriptionsWithParsedFeatures = (subscriptions || []).map(sub => ({
            ...sub,
            features: typeof sub.features === 'string' ? JSON.parse(sub.features) : sub.features
        }));
        
        res.json({
            success: true,
            data: {
                subscriptions: subscriptionsWithParsedFeatures,
                count: subscriptions?.length || 0
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения подписок:', error);
        res.status(500).json({
            success: true,
            data: {
                subscriptions: [],
                count: 0
            }
        });
    }
});

// ИСПРАВЛЕННАЯ ФУНКЦИЯ: активация подписки
app.post('/api/subscriptions/subscribe', authMiddleware(), async (req, res) => {
    try {
        const { plan } = req.body;
        const userId = req.user.id;
        
        if (!plan) {
            return res.status(400).json({
                success: false,
                error: 'Не указан тарифный план'
            });
        }
        
        let subscription;
        try {
            subscription = await db.get(
                'SELECT * FROM subscriptions WHERE name = ? AND is_active = 1',
                [plan]
            );
        } catch (error) {
            console.log('Подписка не найдена в базе, используем дефолтные значения');
        }
        
        // Если подписка не найдена, используем дефолтные значения
        if (!subscription) {
            subscription = {
                name: plan,
                display_name: plan === 'essential' ? 'Эссеншл' : plan === 'premium' ? 'Премиум' : 'VIP',
                initial_fee: plan === 'essential' ? 500 : plan === 'premium' ? 1000 : 2000,
                tasks_limit: plan === 'essential' ? 5 : 999
            };
        }
        
        const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        const wasSubscriptionPending = user.subscription_status === 'pending';
        
        // Обновляем пользователя
        await db.run(
            `UPDATE users SET 
                subscription_plan = ?,
                subscription_status = 'active',
                initial_fee_paid = 1,
                initial_fee_amount = ?,
                tasks_limit = ?,
                subscription_expires = DATE('now', '+30 days')
             WHERE id = ?`,
            [
                plan, 
                subscription.initial_fee || 500, 
                subscription.tasks_limit || 5,
                userId
            ]
        );
        
        const updatedUser = await db.get(
            `SELECT id, email, first_name, last_name, role, 
                    subscription_plan, subscription_status, subscription_expires,
                    initial_fee_paid, initial_fee_amount, balance, tasks_limit, tasks_used,
                    user_rating
             FROM users WHERE id = ?`,
            [userId]
        );
        
        const userForResponse = {
            ...updatedUser,
            rating: updatedUser.user_rating || 0
        };
        
        res.json({
            success: true,
            message: wasSubscriptionPending 
                ? 'Подписка успешно активирована!'
                : 'Тариф успешно изменен!',
            data: {
                user: userForResponse,
                subscription,
                tasks_used: updatedUser.tasks_used || 0,
                tasks_remaining: (updatedUser.tasks_limit || 5) - (updatedUser.tasks_used || 0)
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
                   u2.last_name as performer_last_name,
                   u2.user_rating as performer_rating
            FROM tasks t
            LEFT JOIN categories c ON t.category_id = c.id
            LEFT JOIN services s ON t.service_id = s.id
            LEFT JOIN users u1 ON t.client_id = u1.id
            LEFT JOIN users u2 ON t.performer_id = u2.id
            WHERE t.client_id = ?
        `;
        
        const params = [req.user.id];
        
        if (status && status !== 'all') {
            query += ' AND t.status = ?';
            params.push(status);
        }
        
        if (category_id && category_id !== 'all') {
            query += ' AND t.category_id = ?';
            params.push(category_id);
        }
        
        query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const tasks = await db.all(query, params);
        
        let countQuery = `SELECT COUNT(*) as total FROM tasks WHERE client_id = ?`;
        let countParams = [req.user.id];
        
        if (status && status !== 'all') {
            countQuery += ' AND status = ?';
            countParams.push(status);
        }
        
        const countResult = await db.get(countQuery, countParams);
        
        res.json({
            success: true,
            data: {
                tasks: tasks || [],
                pagination: {
                    total: countResult?.total || 0,
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    pages: Math.ceil((countResult?.total || 0) / parseInt(limit))
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения задач:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения задач',
            data: {
                tasks: [],
                pagination: {
                    total: 0,
                    limit: 50,
                    offset: 0,
                    pages: 0
                }
            }
        });
    }
});

// Получение детальной информации о задаче
app.get('/api/tasks/:id', authMiddleware(), async (req, res) => {
    try {
        const taskId = req.params.id;
        
        const task = await db.get(`
            SELECT t.*, 
                   c.display_name as category_name,
                   c.icon as category_icon,
                   s.name as service_name,
                   s.description as service_description,
                   u1.first_name as client_first_name, 
                   u1.last_name as client_last_name,
                   u1.phone as client_phone,
                   u2.first_name as performer_first_name,
                   u2.last_name as performer_last_name,
                   u2.phone as performer_phone,
                   u2.user_rating as performer_rating,
                   u2.avatar_url as performer_avatar
            FROM tasks t
            LEFT JOIN categories c ON t.category_id = c.id
            LEFT JOIN services s ON t.service_id = s.id
            LEFT JOIN users u1 ON t.client_id = u1.id
            LEFT JOIN users u2 ON t.performer_id = u2.id
            WHERE t.id = ? AND (t.client_id = ? OR t.performer_id = ? OR ? IN ('admin', 'superadmin', 'manager'))
        `, [taskId, req.user.id, req.user.id, req.user.role]);
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена или у вас нет доступа'
            });
        }
        
        const history = await db.all(`
            SELECT h.*, u.first_name, u.last_name
            FROM task_status_history h
            LEFT JOIN users u ON h.changed_by = u.id
            WHERE h.task_id = ?
            ORDER BY h.created_at ASC
        `, [taskId]);
        
        const messages = await db.all(`
            SELECT m.*, u.first_name, u.last_name, u.avatar_url
            FROM task_messages m
            LEFT JOIN users u ON m.user_id = u.id
            WHERE m.task_id = ?
            ORDER BY m.created_at ASC
        `, [taskId]);
        
        res.json({
            success: true,
            data: {
                task,
                history: history || [],
                messages: messages || []
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

// Создание задачи
app.post('/api/tasks', authMiddleware(['client', 'admin', 'superadmin', 'manager']), async (req, res) => {
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
                'SELECT subscription_status, initial_fee_paid, tasks_limit, tasks_used FROM users WHERE id = ?',
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
        
        const result = await db.run(
            `INSERT INTO tasks 
            (task_number, title, description, client_id, category_id, service_id, 
             priority, price, address, deadline, contact_info, additional_requirements) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        
        if (req.user.role === 'client') {
            await db.run(
                'UPDATE users SET tasks_used = COALESCE(tasks_used, 0) + 1 WHERE id = ?',
                [req.user.id]
            );
        }
        
        await db.run(
            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
             VALUES (?, ?, ?, ?)`,
            [taskId, 'new', req.user.id, 'Задача создана']
        );
        
        const updatedUser = await db.get(
            'SELECT tasks_used, tasks_limit FROM users WHERE id = ?',
            [req.user.id]
        );
        
        const task = await db.get(
            `SELECT t.*, c.display_name as category_name
             FROM tasks t 
             LEFT JOIN categories c ON t.category_id = c.id 
             WHERE t.id = ?`,
            [taskId]
        );
        
        res.status(201).json({
            success: true,
            message: 'Задача успешно создана!',
            data: { 
                task,
                tasks_used: updatedUser.tasks_used || 0,
                tasks_remaining: (updatedUser.tasks_limit || 5) - (updatedUser.tasks_used || 0)
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

// ==================== API ДЛЯ ЧАТА ====================

// Получить сообщения задачи
app.get('/api/tasks/:id/messages', authMiddleware(), async (req, res) => {
    try {
        const taskId = req.params.id;
        
        // Проверяем доступ к задаче
        const task = await db.get(
            `SELECT * FROM tasks WHERE id = ? AND (client_id = ? OR performer_id = ? OR ? IN ('admin', 'superadmin', 'manager'))`,
            [taskId, req.user.id, req.user.id, req.user.role]
        );
        
        if (!task) {
            return res.status(403).json({
                success: false,
                error: 'Нет доступа к задаче'
            });
        }
        
        const messages = await db.all(`
            SELECT tm.*, u.first_name, u.last_name, u.avatar_url, u.role
            FROM task_messages tm
            LEFT JOIN users u ON tm.user_id = u.id
            WHERE tm.task_id = ?
            ORDER BY tm.created_at ASC
        `, [taskId]);
        
        res.json({
            success: true,
            data: {
                messages: messages || [],
                count: messages?.length || 0
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

// Отправить сообщение в задачу
app.post('/api/tasks/:id/messages', authMiddleware(), async (req, res) => {
    try {
        const taskId = req.params.id;
        const { message, attachment_url, attachment_type } = req.body;
        
        if (!message || message.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Сообщение не может быть пустым'
            });
        }
        
        // Проверяем доступ к задаче
        const task = await db.get(
            `SELECT * FROM tasks WHERE id = ? AND (client_id = ? OR performer_id = ? OR ? IN ('admin', 'superadmin', 'manager'))`,
            [taskId, req.user.id, req.user.id, req.user.role]
        );
        
        if (!task) {
            return res.status(403).json({
                success: false,
                error: 'Нет доступа к задаче'
            });
        }
        
        // Вставляем сообщение
        const result = await db.run(
            `INSERT INTO task_messages (task_id, user_id, message, attachment_url, attachment_type)
             VALUES (?, ?, ?, ?, ?)`,
            [taskId, req.user.id, message.trim(), attachment_url || null, attachment_type || null]
        );
        
        const messageId = result.lastID;
        
        // Получаем полную информацию о сообщении
        const newMessage = await db.get(`
            SELECT tm.*, u.first_name, u.last_name, u.avatar_url, u.role
            FROM task_messages tm
            LEFT JOIN users u ON tm.user_id = u.id
            WHERE tm.id = ?
        `, [messageId]);
        
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

// ==================== ОБНОВЛЕНИЕ СТАТУСА ЗАДАЧИ ====================

app.put('/api/tasks/:id/status', authMiddleware(), async (req, res) => {
    try {
        const taskId = req.params.id;
        const { status, notes } = req.body;
        
        if (!status) {
            return res.status(400).json({
                success: false,
                error: 'Не указан статус'
            });
        }
        
        // Проверяем доступ к задаче
        const task = await db.get(
            `SELECT * FROM tasks WHERE id = ? AND (client_id = ? OR performer_id = ? OR ? IN ('admin', 'superadmin', 'manager'))`,
            [taskId, req.user.id, req.user.id, req.user.role]
        );
        
        if (!task) {
            return res.status(403).json({
                success: false,
                error: 'Нет доступа к задаче'
            });
        }
        
        // Обновляем статус
        await db.run(
            `UPDATE tasks SET 
                status = ?,
                updated_at = CURRENT_TIMESTAMP
                ${status === 'cancelled' ? ', cancellation_by = ?, cancellation_reason = ?' : ''}
             WHERE id = ?`,
            status === 'cancelled' 
                ? [status, req.user.id, notes || 'Отменено пользователем', taskId]
                : [status, taskId]
        );
        
        // Добавляем в историю
        await db.run(
            `INSERT INTO task_status_history (task_id, status, changed_by, notes)
             VALUES (?, ?, ?, ?)`,
            [taskId, status, req.user.id, notes || `Статус изменен на ${status}`]
        );
        
        // Обновляем статистику исполнителя
        if (task.performer_id && (status === 'completed' || status === 'cancelled')) {
            await updatePerformerStats(task.performer_id);
        }
        
        res.json({
            success: true,
            message: 'Статус задачи обновлен'
        });
        
    } catch (error) {
        console.error('Ошибка обновления статуса:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления статуса'
        });
    }
});

// Завершить задачу (клиент)
app.post('/api/tasks/:id/complete', authMiddleware(['client', 'admin', 'superadmin', 'manager']), async (req, res) => {
    try {
        const taskId = req.params.id;
        
        // Проверяем, является ли пользователь клиентом этой задачи
        const task = await db.get(
            'SELECT * FROM tasks WHERE id = ? AND client_id = ?',
            [taskId, req.user.id]
        );
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        if (task.status !== 'in_progress' && task.status !== 'assigned') {
            return res.status(400).json({
                success: false,
                error: 'Задача должна быть в статусе "В работе" или "Назначена"'
            });
        }
        
        // Обновляем статус
        await db.run(
            `UPDATE tasks SET 
                status = 'completed',
                completed_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [taskId]
        );
        
        // Добавляем в историю статусов
        await db.run(
            `INSERT INTO task_status_history (task_id, status, changed_by, notes)
             VALUES (?, ?, ?, ?)`,
            [taskId, 'completed', req.user.id, 'Клиент подтвердил выполнение']
        );
        
        // Обновляем статистику исполнителя
        if (task.performer_id) {
            await updatePerformerStats(task.performer_id);
        }
        
        // Обновляем статистику клиента
        await db.run(
            'UPDATE users SET completed_tasks = COALESCE(completed_tasks, 0) + 1 WHERE id = ?',
            [req.user.id]
        );
        
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

// ==================== УВЕДОМЛЕНИЯ ====================

app.get('/api/notifications', authMiddleware(), async (req, res) => {
    try {
        const { unread = false, limit = 50, offset = 0 } = req.query;
        
        let query = `SELECT * FROM notifications WHERE user_id = ?`;
        const params = [req.user.id];
        
        if (unread === 'true') {
            query += ' AND is_read = 0';
        }
        
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const notifications = await db.all(query, params);
        
        const unreadCount = await db.get(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
            [req.user.id]
        );
        
        res.json({
            success: true,
            data: {
                notifications: notifications || [],
                unread_count: unreadCount?.count || 0,
                total: notifications?.length || 0
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

// ==================== БАЛАНС И ТРАНЗАКЦИИ ====================

app.get('/api/balance', authMiddleware(), async (req, res) => {
    try {
        const transactions = await db.all(
            `SELECT * FROM transactions 
             WHERE user_id = ? 
             ORDER BY created_at DESC 
             LIMIT 50`,
            [req.user.id]
        );
        
        const user = await db.get(
            'SELECT balance FROM users WHERE id = ?',
            [req.user.id]
        );
        
        res.json({
            success: true,
            data: {
                balance: user?.balance || 0,
                transactions: transactions || []
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения баланса:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения баланса'
        });
    }
});

// ==================== СТАТИСТИКА ====================

app.get('/api/stats', authMiddleware(), async (req, res) => {
    try {
        const userStats = await db.get(`
            SELECT 
                COUNT(*) as total_tasks,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
                SUM(CASE WHEN status IN ('new', 'searching', 'assigned', 'in_progress') THEN 1 ELSE 0 END) as active_tasks,
                SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_tasks,
                AVG(task_rating) as avg_rating
            FROM tasks 
            WHERE client_id = ?
        `, [req.user.id]);
        
        res.json({
            success: true,
            data: {
                overview: userStats || {
                    total_tasks: 0,
                    completed_tasks: 0,
                    active_tasks: 0,
                    cancelled_tasks: 0,
                    avg_rating: 0
                },
                monthly: [],
                categories: []
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

// ==================== НАСТРОЙКИ СИСТЕМЫ ====================

app.get('/api/settings', async (req, res) => {
    try {
        const settings = await db.all('SELECT * FROM settings');
        
        const settingsObj = {};
        (settings || []).forEach(setting => {
            settingsObj[setting.key] = setting.value;
        });
        
        res.json({
            success: true,
            data: settingsObj
        });
        
    } catch (error) {
        console.error('Ошибка получения настроек:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения настроек'
        });
    }
});

// ==================== ИНИЦИАЛИЗАЦИЯ ДАННЫХ ====================

const createInitialData = async () => {
    try {
        console.log('📝 Создание начальных данных...');

        // Настройки системы
        const settingsExist = await db.get("SELECT 1 FROM settings LIMIT 1");
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
                ['frontend_url', process.env.FRONTEND_URL || 'http://localhost:3000', 'URL фронтенда', 'system']
            ];

            for (const setting of settings) {
                await db.run(
                    `INSERT INTO settings (key, value, description, category) VALUES (?, ?, ?, ?)`,
                    setting
                );
            }
            console.log('✅ Настройки системы созданы');
        }

        // FAQ
        const faqExist = await db.get("SELECT 1 FROM faq LIMIT 1");
        if (!faqExist) {
            const faqs = [
                ['Как работает система подписок?', 'Вы оплачиваете вступительный взнос один раз при регистрации, затем ежемесячную плату. Все услуги в рамках вашего тарифа бесплатны для вас.', 'subscriptions', 1, 1],
                ['Можно ли изменить тариф?', 'Да, вы можете изменить тариф в любой момент. Разница в стоимости будет учтена при следующем платеже.', 'subscriptions', 2, 1],
                ['Что входит в вступительный взнос?', 'Вступительный взнос покрывает расходы на проверку и обучение помощниц, а также страховку качества услуг.', 'payments', 3, 1],
                ['Как отменить подпику?', 'Вы можете отменить подписку в любое время в разделе "Мой профиль". Подписка останется активной до конца оплаченного периода.', 'subscriptions', 4, 1],
                ['Как работает чат с исполнителем?', 'После назначения исполнителя к задаче, вы можете общаться с ним через встроенный чат. Все сообщения сохраняются в истории задачи.', 'tasks', 5, 1],
                ['Как оставить отзыв?', 'После выполнения задачи вы можете оставить отзыв и оценить работу исполнителя в разделе "Мои задачи".', 'tasks', 6, 1]
            ];

            for (const faq of faqs) {
                await db.run(
                    `INSERT INTO faq (question, answer, category, sort_order, is_active) VALUES (?, ?, ?, ?, ?)`,
                    faq
                );
            }
            console.log('✅ FAQ созданы');
        }

        // Подписки
        const subscriptionsExist = await db.get("SELECT 1 FROM subscriptions LIMIT 1");
        if (!subscriptionsExist) {
            const subscriptions = [
                [
                    'essential', 'Эссеншл', 'Базовый набор услуг для эпизодических задач',
                    990, 9900, 500, 5,
                    JSON.stringify(['До 5 задач в месяц', 'Все базовые услуги', 'Поддержка по email', 'Стандартное время ответа']),
                    '#FF6B8B', 1, 0, 1
                ],
                [
                    'premium', 'Премиум', 'Полный доступ ко всем услугам и приоритетная поддержка',
                    1990, 19900, 1000, 999,
                    JSON.stringify(['Неограниченные задачи', 'Все услуги премиум-класса', 'Приоритетная поддержка 24/7', 'Личный помощник', 'Срочные заказы']),
                    '#9B59B6', 2, 1, 1
                ],
                [
                    'vip', 'VIP', 'Индивидуальный подход и максимальный комфорт',
                    4990, 49900, 2000, 999,
                    JSON.stringify(['Неограниченные задачи', 'Все услуги VIP-класса', 'Персональный менеджер', 'Экстренная поддержка', 'Высший приоритет']),
                    '#C5A880', 3, 0, 1
                ]
            ];

            for (const sub of subscriptions) {
                await db.run(
                    `INSERT INTO subscriptions 
                    (name, display_name, description, price_monthly, price_yearly, 
                     initial_fee, tasks_limit, features, color_theme, sort_order, is_popular, is_active) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    sub
                );
            }
            console.log('✅ Тарифы подписок созданы');
        }

        // Категории
        const categoriesExist = await db.get("SELECT 1 FROM categories LIMIT 1");
        if (!categoriesExist) {
            const categories = [
                ['home_and_household', 'Дом и быт', 'Уборка, готовка, уход за домом', 'fas fa-home', '#FF6B8B', 1, 1],
                ['family_and_children', 'Дети и семья', 'Няни, репетиторы, помощь с детьми', 'fas fa-baby', '#3498DB', 2, 1],
                ['beauty_and_health', 'Красота и здоровье', 'Маникюр, массаж, парикмахерские услуги', 'fas fa-spa', '#9B59B6', 3, 1],
                ['courses_and_education', 'Курсы и образование', 'Репетиторство, обучение, курсы', 'fas fa-graduation-cap', '#2ECC71', 4, 1],
                ['shopping_and_delivery', 'Покупки и доставка', 'Покупка и доставка товаров', 'fas fa-shopping-cart', '#E74C3C', 5, 1],
                ['events_and_organization', 'События и организация', 'Организация мероприятий и праздников', 'fas fa-birthday-cake', '#F39C12', 6, 1]
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

        // Услуги
        const servicesExist = await db.get("SELECT 1 FROM services LIMIT 1");
        if (!servicesExist) {
            const categories = await db.all("SELECT id, name FROM categories");
            const categoryMap = {};
            categories.forEach(cat => categoryMap[cat.name] = cat.id);

            const services = [
                [categoryMap.home_and_household, 'Уборка квартиры', 'Генеральная или поддерживающая уборка квартиры', 0, '2-4 часа', 1, 1, 1],
                [categoryMap.home_and_household, 'Химчистка мебели', 'Профессиональная химчистка диванов, кресел, матрасов', 0, '3-5 часов', 1, 2, 0],
                [categoryMap.home_and_household, 'Стирка и глажка', 'Стирка, сушка и глажка белья', 0, '2-3 часа', 1, 3, 0],
                [categoryMap.home_and_household, 'Приготовление еды', 'Приготовление блюд на день или неделю', 0, '3-4 часа', 1, 4, 1],
                
                [categoryMap.family_and_children, 'Няня на час', 'Присмотр за детьми на несколько часов', 0, '1 час', 1, 5, 1],
                [categoryMap.family_and_children, 'Репетитор для ребенка', 'Помощь с уроками по школьным предметам', 0, '1 час', 1, 6, 0],
                
                [categoryMap.beauty_and_health, 'Маникюр на дому', 'Профессиональный маникюр с выездом', 0, '1.5 часа', 1, 7, 1],
                [categoryMap.beauty_and_health, 'Стрижка и укладка', 'Парикмахерские услуги на дому', 0, '2 часа', 1, 8, 0],
                [categoryMap.beauty_and_health, 'Массаж', 'Расслабляющий или лечебный массаж', 0, '1 час', 1, 9, 1]
            ];

            for (const service of services) {
                await db.run(
                    `INSERT INTO services 
                    (category_id, name, description, base_price, estimated_time, is_active, sort_order, is_featured) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    service
                );
            }
            console.log('✅ Услуги созданы');
        }

        // Тестовые пользователи (только для разработки)
        const usersExist = await db.get("SELECT 1 FROM users WHERE email = 'admin@concierge.ru'");
        if (!usersExist && process.env.NODE_ENV !== 'production') {
            const passwordHash = await bcrypt.hash('admin123', 12);
            const clientPasswordHash = await bcrypt.hash('client123', 12);
            
            const users = [
                ['admin@concierge.ru', passwordHash, 'Админ', 'Админов', '+79991112233', 'admin', 'premium', 'active', '2025-12-31', 'https://ui-avatars.com/api/?name=Админ+Админов&background=2ECC71&color=fff&bold=true', 0, 1000, 1, 1000, 999, 0, 0, 5.0, 0, 1, 1],
                ['client@example.com', clientPasswordHash, 'Елена', 'Васильева', '+79997778899', 'client', 'premium', 'active', '2025-12-31', 'https://ui-avatars.com/api/?name=Елена+Васильева&background=FF6B8B&color=fff&bold=true', 0, 1000, 1, 1000, 999, 0, 0, 4.0, 0, 1, 1],
                ['performer@concierge.ru', passwordHash, 'Анна', 'Кузнецова', '+79994445566', 'performer', 'essential', 'active', '2025-12-31', 'https://ui-avatars.com/api/?name=Анна+Кузнецова&background=3498DB&color=fff&bold=true', 0, 500, 1, 500, 20, 0, 0, 4.5, 0, 1, 1]
            ];

            for (const user of users) {
                await db.run(
                    `INSERT INTO users 
                    (email, password, first_name, last_name, phone, role, 
                     subscription_plan, subscription_status, subscription_expires,
                     avatar_url, balance, initial_fee_paid, initial_fee_amount, 
                     tasks_limit, tasks_used, total_spent, user_rating, completed_tasks, 
                     is_active, email_verified) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    user
                );
            }
            console.log('✅ Тестовые пользователи созданы');
            
            // Для исполнителя добавляем категории и статистику
            const performer = await db.get("SELECT id FROM users WHERE email = 'performer@concierge.ru'");
            if (performer) {
                const categories = await db.all("SELECT id FROM categories LIMIT 2");
                for (const category of categories) {
                    await db.run(
                        `INSERT INTO performer_categories (performer_id, category_id, is_active) 
                         VALUES (?, ?, 1)`,
                        [performer.id, category.id]
                    );
                }
                
                await db.run(
                    `INSERT INTO performer_stats (performer_id, last_activity) VALUES (?, CURRENT_TIMESTAMP)`,
                    [performer.id]
                );
            }
        }

        console.log('🎉 Все начальные данные созданы!');
        
    } catch (error) {
        console.error('⚠️ Ошибка создания начальных данных:', error.message);
        if (process.env.NODE_ENV === 'development') {
            console.error('Stack trace:', error.stack);
        }
    }
};

// ==================== ИНФОРМАЦИЯ О ПОДПИСКЕ ====================

app.get('/api/auth/subscription-info', authMiddleware(), async (req, res) => {
    try {
        const user = await db.get(
            `SELECT subscription_plan, subscription_status, subscription_expires,
                    initial_fee_paid, initial_fee_amount, tasks_limit, tasks_used
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        const today = new Date();
        const expiryDate = new Date(user.subscription_expires);
        const daysRemaining = Math.max(0, Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24)));
        
        // Вычисляем дату следующего списания
        const nextChargeDate = new Date(expiryDate);
        nextChargeDate.setDate(expiryDate.getDate() + 1);
        
        // Получаем информацию о подписке
        const subscription = await db.get(
            'SELECT * FROM subscriptions WHERE name = ?',
            [user.subscription_plan || 'essential']
        );
        
        res.json({
            success: true,
            data: {
                subscription_plan: user.subscription_plan,
                subscription_status: user.subscription_status,
                subscription_expires: user.subscription_expires,
                days_remaining: daysRemaining,
                next_charge_date: nextChargeDate.toISOString().split('T')[0],
                tasks_limit: user.tasks_limit,
                tasks_used: user.tasks_used,
                tasks_remaining: Math.max(0, (user.tasks_limit || 0) - (user.tasks_used || 0)),
                subscription_info: subscription || null
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения информации о подписке:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения информации о подписке'
        });
    }
});

// ==================== ОБСЛУЖИВАНИЕ СТАТИЧЕСКИХ ФАЙЛОВ ====================

app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({
            success: false,
            error: 'API маршрут не найден'
        });
    }
    
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== ОБРАБОТКА ОШИБОК ====================
app.use((err, req, res, next) => {
    console.error('🔥 Ошибка сервера:', err.message);
    if (process.env.NODE_ENV === 'development') {
        console.error('Stack:', err.stack);
    }
    
    res.status(500).json({
        success: false,
        error: 'Внутренняя ошибка сервера',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Получен SIGTERM. Начинаю graceful shutdown...');
    if (db) {
        db.close();
    }
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 Получен SIGINT. Начинаю graceful shutdown...');
    if (db) {
        db.close();
    }
    process.exit(0);
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎀 ЗАПУСК ЖЕНСКОГО КОНСЬЕРЖА v2.1.0');
        console.log('='.repeat(80));
        console.log(`🌐 PORT: ${process.env.PORT || 3000}`);
        console.log(`🏷️  NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
        console.log(`📁 Текущая рабочая директория: ${process.cwd()}`);
        console.log(`💻 Платформа: ${os.platform()} ${os.arch()}`);
        console.log(`🔐 JWT Secret: ${process.env.JWT_SECRET ? '✅ Set' : '⚠️ Using default'}`);
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        const PORT = process.env.PORT || 3000;
        const HOST = process.env.HOST || '0.0.0.0';
        
        app.listen(PORT, HOST, () => {
            console.log('\n' + '='.repeat(80));
            console.log(`✅ Сервер запущен на http://${HOST}:${PORT}`);
            console.log('='.repeat(80));
            console.log('\n🌐 ДОСТУПНЫЕ ССЫЛКИ:');
            console.log('='.repeat(60));
            console.log(`🏠 Основное приложение:`);
            console.log(`   👉 http://${HOST}:${PORT}`);
            console.log(`\n👑 Админ-панель:`);
            console.log(`   👉 http://${HOST}:${PORT}/admin.html`);
            console.log(`\n👨‍💼 Панель исполнителя:`);
            console.log(`   👉 http://${HOST}:${PORT}/performer.html`);
            console.log(`\n📊 API и здоровье системы:`);
            console.log(`   👉 http://${HOST}:${PORT}/api`);
            console.log(`   👉 http://${HOST}:${PORT}/health`);
            console.log('='.repeat(60));
            
            if (process.env.NODE_ENV !== 'production') {
                console.log('\n🔑 ТЕСТОВЫЕ АККАУНТЫ:');
                console.log('='.repeat(60));
                console.log('👑 Админ: admin@concierge.ru / admin123');
                console.log('👩 Клиент: client@example.com / client123');
                console.log('👩‍🏫 Исполнитель: performer@concierge.ru / admin123');
                console.log('='.repeat(60));
            }
            
            console.log('\n🚀 СИСТЕМА ГОТОВА К РАБОТЕ!');
            console.log('='.repeat(60));
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
};

startServer();
