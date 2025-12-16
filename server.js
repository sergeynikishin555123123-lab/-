// server.js - продакшен версия с полным функционалом
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
const TelegramBot = require('node-telegram-bot-api');

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
const app = express();

// CORS настройки для продакшена
const corsOptions = {
    origin: function (origin, callback) {
        // Разрешаем запросы без origin (например, из мобильных приложений, Postman)
        if (!origin) return callback(null, true);
        
        // Разрешенные домены
        const allowedOrigins = process.env.ALLOWED_ORIGINS 
            ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
            : ['https://sergeynikishin555123123-lab--86fa.twc1.net'];
        
        // Добавляем localhost для разработки, если NODE_ENV не production
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

// Security middleware
app.use((req, res, next) => {
    // Security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    
    // Rate limiting headers
    res.setHeader('X-RateLimit-Limit', '100');
    res.setHeader('X-RateLimit-Remaining', '99');
    
    next();
});

// Body parsing с лимитами
app.use(express.json({ 
    limit: process.env.BODY_LIMIT || '10mb',
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));
app.use(express.urlencoded({ 
    extended: true, 
    limit: process.env.BODY_LIMIT || '10mb',
    parameterLimit: 100
}));

// ==================== ТЕЛЕГРАМ БОТ ====================

let bot;
if (process.env.TELEGRAM_BOT_TOKEN) {
    bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { 
        polling: true,
        request: {
            proxy: process.env.PROXY_URL || null
        }
    });
    
    // Функция для получения текста статуса
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
    
   bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    // Используем ваш домен
    const adminUrl = `${process.env.FRONTEND_URL || 'https://sergeynikishin555123123-lab--86fa.twc1.net'}/admin.html`;
    const performerUrl = `${process.env.FRONTEND_URL || 'https://sergeynikishin555123123-lab--86fa.twc1.net'}/performer.html`;
    const appUrl = process.env.FRONTEND_URL || 'https://sergeynikishin555123123-lab--86fa.twc1.net';
    
    const message = `
🎀 *Женский Консьерж - Управление системой*

*Доступные команды:*
/start - Показать это меню
/status - Статус системы
/tasks - Статистика задач
/users - Статистика пользователей
/notify - Уведомление всем пользователям
/help - Справка по командам

*Ссылки для доступа:*
🌐 Приложение: ${appUrl}
👑 Админ-панель: ${adminUrl}
👨‍💼 Панель исполнителя: ${performerUrl}

*Токен для API:* \`${process.env.JWT_SECRET?.substring(0, 10)}...\`

*Версия системы:* 2.1.0
*Окружение:* ${process.env.NODE_ENV || 'development'}
*Домен:* sergeynikishin555123123-lab--86fa.twc1.net
    `;
    
    bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true
    });
});
    
    bot.onText(/\/help/, (msg) => {
        const chatId = msg.chat.id;
        const message = `
📚 *Справка по командам:*

/status - Получить текущую статистику системы
/tasks - Получить статистику по задачам
/users - Получить статистику по пользователям
/notify [текст] - Отправить уведомление всем пользователям (только админы)
/start - Показать стартовое меню

*Доступ администратора:*
Для доступа к админ-панели перейдите по ссылке в стартовом меню и войдите с учетной записью администратора.

*Техническая поддержка:*
Для технических вопросов обращайтесь к разработчику системы.
        `;
        
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });
    
    bot.onText(/\/status/, async (msg) => {
        const chatId = msg.chat.id;
        try {
            // Используем глобальную db переменную
            if (!db) {
                bot.sendMessage(chatId, '⏳ База данных не готова. Попробуйте позже.');
                return;
            }
            
            const stats = await db.get("SELECT COUNT(*) as users FROM users");
            const tasks = await db.get("SELECT COUNT(*) as tasks FROM tasks");
            const activeTasks = await db.get("SELECT COUNT(*) as active FROM tasks WHERE status IN ('new', 'searching', 'assigned', 'in_progress')");
            const completedTasks = await db.get("SELECT COUNT(*) as completed FROM tasks WHERE status = 'completed'");
            
            const message = `
📊 *Статус системы:*

👥 *Пользователи:*
• Всего: ${stats.users || 0}
• Клиентов: ${(await db.get("SELECT COUNT(*) as count FROM users WHERE role = 'client'"))?.count || 0}
• Исполнителей: ${(await db.get("SELECT COUNT(*) as count FROM users WHERE role = 'performer'"))?.count || 0}
• Админов: ${(await db.get("SELECT COUNT(*) as count FROM users WHERE role IN ('admin', 'superadmin', 'manager')"))?.count || 0}

📋 *Задачи:*
• Всего: ${tasks.tasks || 0}
• Активных: ${activeTasks.active || 0}
• Выполнено: ${completedTasks.completed || 0}
• Отменено: ${(await db.get("SELECT COUNT(*) as count FROM tasks WHERE status = 'cancelled'"))?.count || 0}

⚡ *Производительность:*
• Память: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB
• Аптайм: ${Math.floor(process.uptime() / 3600)}ч ${Math.floor((process.uptime() % 3600) / 60)}м
• Окружение: ${process.env.NODE_ENV || 'development'}

⏰ *Время сервера:* ${new Date().toLocaleString('ru-RU')}
            `;
            
            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('Ошибка бота /status:', error);
            bot.sendMessage(chatId, `❌ Ошибка получения статуса: ${error.message}`);
        }
    });
    
    bot.onText(/\/tasks/, async (msg) => {
        const chatId = msg.chat.id;
        try {
            if (!db) {
                bot.sendMessage(chatId, '⏳ База данных не готова.');
                return;
            }
            
            const stats = await db.all(`
                SELECT status, COUNT(*) as count 
                FROM tasks 
                GROUP BY status 
                ORDER BY 
                    CASE status
                        WHEN 'new' THEN 1
                        WHEN 'searching' THEN 2
                        WHEN 'assigned' THEN 3
                        WHEN 'in_progress' THEN 4
                        WHEN 'completed' THEN 5
                        WHEN 'cancelled' THEN 6
                        ELSE 7
                    END
            `);
            
            let message = "📋 *Статистика задач:*\n\n";
            let total = 0;
            
            stats.forEach(stat => {
                message += `• ${getStatusText(stat.status)}: ${stat.count}\n`;
                total += stat.count;
            });
            
            message += `\n📈 *Всего задач:* ${total}`;
            
            // Добавляем информацию по категориям
            const categoryStats = await db.all(`
                SELECT c.display_name, COUNT(t.id) as count
                FROM tasks t
                JOIN categories c ON t.category_id = c.id
                GROUP BY t.category_id
                ORDER BY count DESC
                LIMIT 5
            `);
            
            if (categoryStats.length > 0) {
                message += "\n\n🏷️ *Топ категорий:*";
                categoryStats.forEach((cat, index) => {
                    message += `\n${index + 1}. ${cat.display_name}: ${cat.count}`;
                });
            }
            
            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('Ошибка бота /tasks:', error);
            bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
        }
    });
    
    bot.onText(/\/users/, async (msg) => {
        const chatId = msg.chat.id;
        try {
            if (!db) {
                bot.sendMessage(chatId, '⏳ База данных не готова.');
                return;
            }
            
            const stats = await db.all(`
                SELECT 
                    role,
                    COUNT(*) as count,
                    SUM(CASE WHEN subscription_status = 'active' THEN 1 ELSE 0 END) as active
                FROM users 
                GROUP BY role 
                ORDER BY 
                    CASE role
                        WHEN 'superadmin' THEN 1
                        WHEN 'admin' THEN 2
                        WHEN 'manager' THEN 3
                        WHEN 'performer' THEN 4
                        WHEN 'client' THEN 5
                        ELSE 6
                    END
            `);
            
            let message = "👥 *Статистика пользователей:*\n\n";
            let total = 0;
            let totalActive = 0;
            
            stats.forEach(stat => {
                const roleText = {
                    'superadmin': '👑 Суперадмин',
                    'admin': '👨‍💼 Админ',
                    'manager': '👔 Менеджер',
                    'performer': '👩‍🏫 Исполнитель',
                    'client': '👩 Клиент'
                }[stat.role] || stat.role;
                
                message += `• ${roleText}: ${stat.count} (активных: ${stat.active})\n`;
                total += stat.count;
                totalActive += stat.active;
            });
            
            message += `\n📊 *Итого:* ${total} пользователей, ${totalActive} активных`;
            
            // Информация по подпискам
            const subscriptionStats = await db.all(`
                SELECT subscription_plan, COUNT(*) as count
                FROM users 
                WHERE subscription_status = 'active'
                GROUP BY subscription_plan
                ORDER BY count DESC
            `);
            
            if (subscriptionStats.length > 0) {
                message += "\n\n💳 *Активные подписки:*";
                subscriptionStats.forEach(sub => {
                    const planName = {
                        'essential': '🎀 Эссеншл',
                        'premium': '🌟 Премиум',
                        'vip': '👑 VIP'
                    }[sub.subscription_plan] || sub.subscription_plan;
                    
                    message += `\n• ${planName}: ${sub.count}`;
                });
            }
            
            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('Ошибка бота /users:', error);
            bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
        }
    });
    
    bot.onText(/\/notify (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const notificationText = match[1];
        
        // Проверка прав администратора
        const adminChatIds = process.env.ADMIN_CHAT_IDS ? process.env.ADMIN_CHAT_IDS.split(',').map(id => id.trim()) : [];
        
        if (!adminChatIds.includes(chatId.toString())) {
            bot.sendMessage(chatId, "❌ У вас нет прав для этой команды");
            return;
        }
        
        try {
            if (!db) {
                bot.sendMessage(chatId, '⏳ База данных не готова.');
                return;
            }
            
            const users = await db.all("SELECT id, first_name, email FROM users WHERE is_active = 1");
            
            let notified = 0;
            let errors = 0;
            
            bot.sendMessage(chatId, `⏳ Начинаю отправку уведомлений ${users.length} пользователям...`);
            
            for (const user of users) {
                try {
                    await db.run(
                        `INSERT INTO notifications (user_id, type, title, message) VALUES (?, 'system', 'Системное уведомление', ?)`,
                        [user.id, notificationText]
                    );
                    notified++;
                    
                    // Пауза между уведомлениями чтобы не перегрузить базу
                    if (notified % 50 === 0) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                } catch (error) {
                    console.error(`Ошибка уведомления пользователя ${user.id}:`, error);
                    errors++;
                }
            }
            
            bot.sendMessage(chatId, `✅ Уведомление отправлено\n• Успешно: ${notified}\n• Ошибок: ${errors}`);
        } catch (error) {
            console.error('Ошибка бота /notify:', error);
            bot.sendMessage(chatId, `❌ Ошибка отправки уведомлений: ${error.message}`);
        }
    });
    
    // Обработка ошибок бота
    bot.on('polling_error', (error) => {
        console.error('Ошибка polling Telegram бота:', error.message);
    });
    
    bot.on('webhook_error', (error) => {
        console.error('Ошибка webhook Telegram бота:', error.message);
    });
    
    console.log('🤖 Telegram бот запущен');
}

// ==================== ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ ====================
let db;

const initDatabase = async () => {
    try {
        console.log('🔄 Инициализация базы данных...');
        
        // Определяем путь к базе данных с приоритетами:
        // 1. Переменная окружения DATABASE_PATH
        // 2. /tmp для контейнеров
        // 3. ./data для локальной разработки
        
        let dbPath;
        if (process.env.DATABASE_PATH) {
            // Используем путь из переменной окружения
            dbPath = process.env.DATABASE_PATH;
        } else if (process.env.NODE_ENV === 'production' && require('os').platform() !== 'win32') {
            // Для продакшена на Linux/Unix используем /tmp
            dbPath = '/tmp/concierge_prod.db';
        } else if (process.env.NODE_ENV === 'production') {
            // Для Windows продакшена
            dbPath = './concierge_prod.db';
        } else if (process.env.NODE_ENV === 'test') {
            dbPath = process.env.TEST_DATABASE_PATH || './concierge_test.db';
        } else {
            dbPath = './concierge.db';
        }
        
        console.log(`📁 Путь к базе данных: ${dbPath}`);
        console.log(`📁 Абсолютный путь: ${path.resolve(dbPath)}`);
        
        // Проверяем доступные пути для записи
        const possiblePaths = [
            dbPath,
            '/tmp/concierge_prod.db',
            '/var/tmp/concierge_prod.db',
            os.tmpdir() + '/concierge_prod.db',
            './concierge_prod.db'
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

        // Оптимизация для продакшена
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

        // Создаем тестовые данные только для разработки
        if (process.env.NODE_ENV !== 'production' || process.env.SEED_DATA === 'true') {
            await createInitialData();
        }
        
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
        await db.exec(tableSql);
    }
    
    // Создаем индексы для оптимизации
    await db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_client_id ON tasks(client_id)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_performer_id ON tasks(performer_id)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_category_id ON tasks(category_id)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_task_messages_task_id ON task_messages(task_id)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_users_subscription_status ON users(subscription_status)');
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

// ==================== СТАТИЧЕСКИЕ ФАЙЛЫ ====================
app.use(express.static('public', {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
    setHeaders: (res, path) => {
        if (path.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

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

// Регистрация
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, first_name, last_name, phone, subscription_plan = 'essential', role = 'client' } = req.body;
        
        // Валидация
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
        
        // Проверка существующего пользователя
        const existingUser = await db.get('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUser) {
            return res.status(409).json({
                success: false,
                error: 'Пользователь с таким email уже существует'
            });
        }
        
        // Проверка подписки
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
        
        // Хэширование пароля
        const hashedPassword = await bcrypt.hash(password, 12);
        const verificationToken = crypto.randomBytes(32).toString('hex');
        
        // Определяем статус подписки
        const initialFeePaid = (role === 'performer' || role === 'admin' || role === 'manager' || role === 'superadmin') ? 1 : (subscription.initial_fee === 0 ? 1 : 0);
        const subscriptionStatus = initialFeePaid ? 'active' : 'pending';
        
        let expiryDateStr = null;
        if (initialFeePaid) {
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + 30);
            expiryDateStr = expiryDate.toISOString().split('T')[0];
        }
        
        // Определяем лимит задач
        let tasksLimit = subscription.tasks_limit;
        if (role === 'performer') {
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
             verification_token, balance) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                email,
                hashedPassword,
                first_name,
                last_name,
                phone,
                role,
                subscription_plan,
                subscriptionStatus,
                expiryDateStr,
                initialFeePaid,
                subscription.initial_fee,
                tasksLimit,
                avatarUrl,
                verificationToken,
                initialFeePaid ? 0 : subscription.initial_fee
            ]
        );
        
        const userId = result.lastID;
        
        // Транзакция для вступительного взноса
        if (subscription.initial_fee > 0 && initialFeePaid) {
            await db.run(
                `INSERT INTO transactions 
                (user_id, type, amount, description, status) 
                VALUES (?, ?, ?, ?, ?)`,
                [
                    userId,
                    'initial_fee',
                    -subscription.initial_fee,
                    'Вступительный взнос',
                    'completed'
                ]
            );
        }
        
        // Для исполнителей добавляем категории
        if (role === 'performer') {
            const categories = await db.all('SELECT id FROM categories WHERE is_active = 1');
            for (const category of categories) {
                await db.run(
                    `INSERT OR IGNORE INTO performer_categories (performer_id, category_id, is_active) 
                     VALUES (?, ?, 1)`,
                    [userId, category.id]
                );
            }
            
            // Создаем статистику
            await db.run(
                `INSERT INTO performer_stats (performer_id, last_activity) VALUES (?, CURRENT_TIMESTAMP)`,
                [userId]
            );
        }
        
        // Отправляем приветственное уведомление
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message) 
            VALUES (?, ?, ?, ?)`,
            [
                userId,
                'welcome',
                'Добро пожаловать!',
                role === 'performer' 
                    ? 'Спасибо за регистрацию в качестве помощницы. Теперь вы можете принимать задачи от клиентов.'
                    : role === 'client'
                    ? 'Спасибо за регистрацию в Женском Консьерже. Для начала работы оплатите вступительный взнос и выберите услугу.'
                    : 'Добро пожаловать в админ панель Женского Консьержа.'
            ]
        );
        
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
            rating: user.user_rating
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
                requires_initial_fee: !initialFeePaid && subscription.initial_fee > 0,
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
            rating: user.user_rating,
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
            rating: user.user_rating
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
            rating: user.user_rating
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
                    tasks_remaining: user.tasks_limit - user.tasks_used,
                    tasks_limit: user.tasks_limit,
                    tasks_used: user.tasks_used,
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
                messages,
                count: messages.length
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

// Получить сообщения с пагинацией
app.get('/api/tasks/:id/messages/all', authMiddleware(), async (req, res) => {
    try {
        const taskId = req.params.id;
        const { limit = 50, offset = 0 } = req.query;
        
        // Проверяем доступ
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
            SELECT tm.*, 
                   u.first_name, 
                   u.last_name, 
                   u.avatar_url, 
                   u.role,
                   CASE 
                     WHEN tm.user_id = ? THEN 1
                     ELSE 0
                   END as is_own
            FROM task_messages tm
            LEFT JOIN users u ON tm.user_id = u.id
            WHERE tm.task_id = ?
            ORDER BY tm.created_at DESC
            LIMIT ? OFFSET ?
        `, [req.user.id, taskId, parseInt(limit), parseInt(offset)]);
        
        const total = await db.get(
            `SELECT COUNT(*) as count FROM task_messages WHERE task_id = ?`,
            [taskId]
        );
        
        res.json({
            success: true,
            data: {
                messages: messages.reverse(),
                total: total?.count || 0,
                limit: parseInt(limit),
                offset: parseInt(offset)
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
        
        // Проверяем, что задача не отменена
        if (task.status === 'cancelled') {
            return res.status(400).json({
                success: false,
                error: 'Нельзя отправлять сообщения в отмененную задачу'
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
        
        // Определяем получателя
        let recipientId;
        if (req.user.id === task.client_id) {
            recipientId = task.performer_id;
        } else if (req.user.id === task.performer_id) {
            recipientId = task.client_id;
        }
        
        // Отправляем уведомление получателю
        if (recipientId) {
            await db.run(
                `INSERT INTO notifications (user_id, type, title, message, related_id, related_type)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    recipientId,
                    'new_message',
                    'Новое сообщение в задаче',
                    `Новое сообщение в задаче #${task.task_number}: ${message.substring(0, 50)}...`,
                    taskId,
                    'task'
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

// Пометить сообщения как прочитанные
app.post('/api/tasks/:id/messages/read', authMiddleware(), async (req, res) => {
    try {
        const taskId = req.params.id;
        
        // Помечаем все сообщения в задаче как прочитанные для текущего пользователя
        await db.run(
            `UPDATE task_messages 
             SET is_read = 1, read_at = CURRENT_TIMESTAMP 
             WHERE task_id = ? AND user_id != ? AND is_read = 0`,
            [taskId, req.user.id]
        );
        
        res.json({
            success: true,
            message: 'Сообщения помечены как прочитанные'
        });
        
    } catch (error) {
        console.error('Ошибка пометки сообщений как прочитанных:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления статуса сообщений'
        });
    }
});

// ==================== API ДЛЯ ИСПОЛНИТЕЛЕЙ ====================

// Получить доступные задачи для исполнителя
app.get('/api/performer/tasks/available', authMiddleware(['performer', 'admin', 'superadmin', 'manager']), async (req, res) => {
    try {
        const { category_id, limit = 50, offset = 0 } = req.query;
        
        // Получаем категории исполнителя
        const performerCategories = await db.all(
            'SELECT category_id FROM performer_categories WHERE performer_id = ? AND is_active = 1',
            [req.user.id]
        );
        
        const categoryIds = performerCategories.map(pc => pc.category_id);
        
        if (categoryIds.length === 0) {
            return res.json({
                success: true,
                data: {
                    tasks: [],
                    count: 0
                }
            });
        }
        
        let query = `
            SELECT t.*, 
                   c.display_name as category_name,
                   c.icon as category_icon,
                   u.first_name as client_first_name,
                   u.last_name as client_last_name,
                   u.user_rating as client_rating
            FROM tasks t
            LEFT JOIN categories c ON t.category_id = c.id
            LEFT JOIN users u ON t.client_id = u.id
            WHERE t.status IN ('new', 'searching')
              AND t.category_id IN (${categoryIds.map(() => '?').join(',')})
              AND t.performer_id IS NULL
        `;
        
        const params = [...categoryIds];
        
        if (category_id && category_id !== 'all') {
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
                count: tasks.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения доступных задач:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения доступных задач'
        });
    }
});

// Получить задачи исполнителя
app.get('/api/performer/tasks', authMiddleware(['performer', 'admin', 'superadmin', 'manager']), async (req, res) => {
    try {
        const { status, limit = 50, offset = 0 } = req.query;
        
        let query = `
            SELECT t.*, 
                   c.display_name as category_name,
                   c.icon as category_icon,
                   u.first_name as client_first_name,
                   u.last_name as client_last_name,
                   u.phone as client_phone,
                   u.user_rating as client_rating
            FROM tasks t
            LEFT JOIN categories c ON t.category_id = c.id
            LEFT JOIN users u ON t.client_id = u.id
            WHERE t.performer_id = ?
        `;
        
        const params = [req.user.id];
        
        if (status && status !== 'all') {
            query += ' AND t.status = ?';
            params.push(status);
        }
        
        query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const tasks = await db.all(query, params);
        
        res.json({
            success: true,
            data: {
                tasks,
                count: tasks.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения задач исполнителя:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения задач исполнителя'
        });
    }
});

// Принять задачу
app.post('/api/performer/tasks/:id/accept', authMiddleware(['performer', 'admin', 'superadmin', 'manager']), async (req, res) => {
    try {
        const taskId = req.params.id;
        
        // Проверяем, существует ли задача и доступна ли она
        const task = await db.get(`
            SELECT t.*, 
                   pc.performer_id as can_perform
            FROM tasks t
            LEFT JOIN performer_categories pc ON t.category_id = pc.category_id AND pc.performer_id = ?
            WHERE t.id = ? AND t.status IN ('new', 'searching')
        `, [req.user.id, taskId]);
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена или недоступна'
            });
        }
        
        if (!task.can_perform) {
            return res.status(403).json({
                success: false,
                error: 'У вас нет доступа к этой категории задач'
            });
        }
        
        // Начинаем транзакцию
        await db.run('BEGIN TRANSACTION');
        
        try {
            // Назначаем исполнителя
            await db.run(
                `UPDATE tasks SET 
                    performer_id = ?, 
                    status = 'assigned',
                    started_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [req.user.id, taskId]
            );
            
            // Добавляем в историю статусов
            await db.run(
                `INSERT INTO task_status_history (task_id, status, changed_by, notes)
                 VALUES (?, ?, ?, ?)`,
                [taskId, 'assigned', req.user.id, 'Исполнитель принял задачу']
            );
            
            // Отправляем уведомление клиенту
            await db.run(
                `INSERT INTO notifications (user_id, type, title, message, related_id, related_type)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    task.client_id,
                    'task_assigned',
                    'Исполнитель назначен',
                    `Исполнитель принял вашу задачу "${task.title}"`,
                    taskId,
                    'task'
                ]
            );
            
            // Отправляем уведомление исполнителю
            await db.run(
                `INSERT INTO notifications (user_id, type, title, message, related_id, related_type)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    req.user.id,
                    'task_accepted',
                    'Задача принята',
                    `Вы приняли задачу "${task.title}"`,
                    taskId,
                    'task'
                ]
            );
            
            await db.run('COMMIT');
            
            // Получаем обновленную задачу
            const updatedTask = await db.get(`
                SELECT t.*, 
                       c.display_name as category_name,
                       u.first_name as client_first_name,
                       u.last_name as client_last_name
                FROM tasks t
                LEFT JOIN categories c ON t.category_id = c.id
                LEFT JOIN users u ON t.client_id = u.id
                WHERE t.id = ?
            `, [taskId]);
            
            res.json({
                success: true,
                message: 'Задача успешно принята',
                data: {
                    task: updatedTask
                }
            });
            
        } catch (error) {
            await db.run('ROLLBACK');
            throw error;
        }
        
    } catch (error) {
        console.error('Ошибка принятия задачи:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка принятия задачи'
        });
    }
});

// Начать выполнение задачи
app.post('/api/performer/tasks/:id/start', authMiddleware(['performer', 'admin', 'superadmin', 'manager']), async (req, res) => {
    try {
        const taskId = req.params.id;
        
        // Проверяем, является ли пользователь исполнителем этой задачи
        const task = await db.get(
            'SELECT * FROM tasks WHERE id = ? AND performer_id = ?',
            [taskId, req.user.id]
        );
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        if (task.status !== 'assigned') {
            return res.status(400).json({
                success: false,
                error: 'Задача должна быть в статусе "Назначена"'
            });
        }
        
        // Обновляем статус
        await db.run(
            `UPDATE tasks SET 
                status = 'in_progress',
                updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [taskId]
        );
        
        // Добавляем в историю статусов
        await db.run(
            `INSERT INTO task_status_history (task_id, status, changed_by, notes)
             VALUES (?, ?, ?, ?)`,
            [taskId, 'in_progress', req.user.id, 'Исполнитель начал работу']
        );
        
        // Отправляем уведомление клиенту
        await db.run(
            `INSERT INTO notifications (user_id, type, title, message, related_id, related_type)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                task.client_id,
                'task_started',
                'Работа начата',
                `Исполнитель начал работу над задачей "${task.title}"`,
                taskId,
                'task'
            ]
        );
        
        res.json({
            success: true,
            message: 'Работа над задачей начата'
        });
        
    } catch (error) {
        console.error('Ошибка начала работы:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка начала работы'
        });
    }
});

// Завершить задачу (исполнитель)
app.post('/api/performer/tasks/:id/complete', authMiddleware(['performer', 'admin', 'superadmin', 'manager']), async (req, res) => {
    try {
        const taskId = req.params.id;
        
        // Проверяем, является ли пользователь исполнителем этой задачи
        const task = await db.get(
            'SELECT * FROM tasks WHERE id = ? AND performer_id = ?',
            [taskId, req.user.id]
        );
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        if (task.status !== 'in_progress') {
            return res.status(400).json({
                success: false,
                error: 'Задача должна быть в статусе "В работе"'
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
            [taskId, 'completed', req.user.id, 'Исполнитель завершил работу']
        );
        
        // Обновляем статистику исполнителя
        await updatePerformerStats(req.user.id);
        
        // Обновляем статистику клиента
        await db.run(
            'UPDATE users SET completed_tasks = completed_tasks + 1 WHERE id = ?',
            [task.client_id]
        );
        
        // Отправляем уведомление клиенту
        await db.run(
            `INSERT INTO notifications (user_id, type, title, message, related_id, related_type)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                task.client_id,
                'task_completed',
                'Задача выполнена',
                `Исполнитель завершил работу над задачей "${task.title}"`,
                taskId,
                'task'
            ]
        );
        
        res.json({
            success: true,
            message: 'Задача отмечена как выполненная'
        });
        
    } catch (error) {
        console.error('Ошибка завершения задачи:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка завершения задачи'
        });
    }
});

// Получить статистику исполнителя
app.get('/api/performer/stats', authMiddleware(['performer', 'admin', 'superadmin', 'manager']), async (req, res) => {
    try {
        // Получаем статистику из performer_stats
        const stats = await db.get(
            'SELECT * FROM performer_stats WHERE performer_id = ?',
            [req.user.id]
        );
        
        // Получаем дополнительные данные
        const activeTasks = await db.get(
            `SELECT COUNT(*) as count FROM tasks 
             WHERE performer_id = ? AND status IN ('assigned', 'in_progress')`,
            [req.user.id]
        );
        
        const availableTasks = await db.get(`
            SELECT COUNT(*) as count FROM tasks t
            JOIN performer_categories pc ON t.category_id = pc.category_id
            WHERE pc.performer_id = ? 
              AND t.status IN ('new', 'searching')
              AND t.performer_id IS NULL`,
            [req.user.id]
        );
        
        // Получаем категории исполнителя
        const categories = await db.all(`
            SELECT c.*, pc.experience_years, pc.hourly_rate
            FROM performer_categories pc
            JOIN categories c ON pc.category_id = c.id
            WHERE pc.performer_id = ? AND pc.is_active = 1
            ORDER BY c.sort_order`,
            [req.user.id]
        );
        
        // Получаем последние отзывы
        const recentReviews = await db.all(`
            SELECT r.*, u.first_name as client_first_name, u.last_name as client_last_name, t.title as task_title
            FROM reviews r
            JOIN tasks t ON r.task_id = t.id
            JOIN users u ON r.client_id = u.id
            WHERE r.performer_id = ?
            ORDER BY r.created_at DESC
            LIMIT 5`,
            [req.user.id]
        );
        
        res.json({
            success: true,
            data: {
                stats: stats || {
                    total_tasks: 0,
                    completed_tasks: 0,
                    cancelled_tasks: 0,
                    avg_rating: 0,
                    total_earnings: 0
                },
                active_tasks: activeTasks?.count || 0,
                available_tasks: availableTasks?.count || 0,
                categories,
                recent_reviews: recentReviews
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения статистики исполнителя:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статистики исполнителя'
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
        
        // Проверяем валидность перехода статуса
        const validTransitions = {
            'new': ['searching', 'cancelled'],
            'searching': ['assigned', 'cancelled'],
            'assigned': ['in_progress', 'cancelled'],
            'in_progress': ['completed', 'cancelled'],
            'completed': [],
            'cancelled': []
        };
        
        if (!validTransitions[task.status]?.includes(status)) {
            return res.status(400).json({
                success: false,
                error: `Нельзя изменить статус с ${task.status} на ${status}`
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
        
        // Отправляем уведомления
        const notifyUsers = [];
        if (task.client_id !== req.user.id) {
            notifyUsers.push(task.client_id);
        }
        if (task.performer_id && task.performer_id !== req.user.id) {
            notifyUsers.push(task.performer_id);
        }
        
        const statusText = getStatusText(status);
        for (const userId of notifyUsers) {
            await db.run(
                `INSERT INTO notifications (user_id, type, title, message, related_id, related_type)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    userId,
                    'task_status_changed',
                    'Статус задачи изменен',
                    `Статус задачи "${task.title}" изменен на "${statusText}"`,
                    taskId,
                    'task'
                ]
            );
        }
        
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
                notifications,
                unread_count: unreadCount?.count || 0,
                total: notifications.length
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

app.post('/api/notifications/:id/read', authMiddleware(), async (req, res) => {
    try {
        await db.run(
            'UPDATE notifications SET is_read = 1, read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
            [req.params.id, req.user.id]
        );
        
        res.json({
            success: true,
            message: 'Уведомление помечено как прочитанное'
        });
        
    } catch (error) {
        console.error('Ошибка обновления уведомления:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления уведомления'
        });
    }
});

app.post('/api/notifications/read-all', authMiddleware(), async (req, res) => {
    try {
        await db.run(
            'UPDATE notifications SET is_read = 1, read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND is_read = 0',
            [req.user.id]
        );
        
        res.json({
            success: true,
            message: 'Все уведомления помечены как прочитанные'
        });
        
    } catch (error) {
        console.error('Ошибка обновления уведомлений:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления уведомлений'
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
        
        const monthlyStats = await db.all(`
            SELECT 
                strftime('%Y-%m', created_at) as month,
                COUNT(*) as task_count,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count
            FROM tasks 
            WHERE client_id = ?
            GROUP BY strftime('%Y-%m', created_at)
            ORDER BY month DESC
            LIMIT 6
        `, [req.user.id]);
        
        const categoryStats = await db.all(`
            SELECT 
                c.display_name as category,
                COUNT(t.id) as task_count
            FROM tasks t
            JOIN categories c ON t.category_id = c.id
            WHERE t.client_id = ?
            GROUP BY t.category_id
            ORDER BY task_count DESC
            LIMIT 5
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
                monthly: monthlyStats || [],
                categories: categoryStats || []
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

// ==================== ПОИСК ИСПОЛНИТЕЛЕЙ ====================

app.get('/api/performers/search', authMiddleware(), async (req, res) => {
    try {
        const { category_id, rating_min, rating_max, limit = 20, offset = 0 } = req.query;
        
        let query = `
            SELECT DISTINCT u.*, 
                   ps.avg_rating,
                   ps.completed_tasks,
                   ps.total_earnings,
                   GROUP_CONCAT(DISTINCT c.display_name) as categories
            FROM users u
            LEFT JOIN performer_stats ps ON u.id = ps.performer_id
            LEFT JOIN performer_categories pc ON u.id = pc.performer_id
            LEFT JOIN categories c ON pc.category_id = c.id
            WHERE u.role = 'performer' 
              AND u.is_active = 1
              AND u.subscription_status = 'active'
        `;
        
        const params = [];
        
        if (category_id && category_id !== 'all') {
            query += ` AND pc.category_id = ?`;
            params.push(category_id);
        }
        
        if (rating_min) {
            query += ` AND ps.avg_rating >= ?`;
            params.push(rating_min);
        }
        
        if (rating_max) {
            query += ` AND ps.avg_rating <= ?`;
            params.push(rating_max);
        }
        
        query += ` GROUP BY u.id ORDER BY ps.avg_rating DESC LIMIT ? OFFSET ?`;
        params.push(parseInt(limit), parseInt(offset));
        
        const performers = await db.all(query, params);
        
        // Форматируем результат
        const formattedPerformers = performers.map(p => ({
            ...p,
            categories: p.categories ? p.categories.split(',') : []
        }));
        
        res.json({
            success: true,
            data: {
                performers: formattedPerformers,
                count: formattedPerformers.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка поиска исполнителей:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка поиска исполнителей'
        });
    }
});

// ==================== ОТЗЫВЫ ====================

app.post('/api/tasks/:id/review', authMiddleware(['client']), async (req, res) => {
    try {
        const taskId = req.params.id;
        const { rating, comment, is_anonymous = false } = req.body;
        
        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({
                success: false,
                error: 'Рейтинг должен быть от 1 до 5'
            });
        }
        
        // Проверяем, что задача выполнена и пользователь - клиент
        const task = await db.get(
            `SELECT * FROM tasks WHERE id = ? AND client_id = ? AND status = 'completed'`,
            [taskId, req.user.id]
        );
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена или не завершена'
            });
        }
        
        // Проверяем, не оставлял ли уже отзыв
        const existingReview = await db.get(
            'SELECT * FROM reviews WHERE task_id = ? AND client_id = ?',
            [taskId, req.user.id]
        );
        
        if (existingReview) {
            return res.status(400).json({
                success: false,
                error: 'Вы уже оставили отзыв по этой задаче'
            });
        }
        
        // Создаем отзыв
        await db.run(
            `INSERT INTO reviews (task_id, client_id, performer_id, rating, comment, is_anonymous)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [taskId, req.user.id, task.performer_id, rating, comment || null, is_anonymous ? 1 : 0]
        );
        
        // Обновляем рейтинг исполнителя
        await updatePerformerStats(task.performer_id);
        
        res.status(201).json({
            success: true,
            message: 'Отзыв успешно добавлен'
        });
        
    } catch (error) {
        console.error('Ошибка добавления отзыва:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка добавления отзыва'
        });
    }
});

// ==================== ПОЛУЧИТЬ ОТЗЫВЫ ИСПОЛНИТЕЛЯ ====================

app.get('/api/performers/:id/reviews', async (req, res) => {
    try {
        const performerId = req.params.id;
        const { limit = 10, offset = 0 } = req.query;
        
        const reviews = await db.all(`
            SELECT r.*, 
                   u.first_name as client_first_name,
                   u.last_name as client_last_name,
                   t.title as task_title
            FROM reviews r
            JOIN tasks t ON r.task_id = t.id
            JOIN users u ON r.client_id = u.id
            WHERE r.performer_id = ?
            ORDER BY r.created_at DESC
            LIMIT ? OFFSET ?
        `, [performerId, parseInt(limit), parseInt(offset)]);
        
        const total = await db.get(
            'SELECT COUNT(*) as count FROM reviews WHERE performer_id = ?',
            [performerId]
        );
        
        res.json({
            success: true,
            data: {
                reviews,
                total: total?.count || 0
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения отзывов:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения отзывов'
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

// ==================== FAQ ====================
app.get('/api/faq', async (req, res) => {
    try {
        const faq = await db.all(
            'SELECT * FROM faq WHERE is_active = 1 ORDER BY sort_order ASC, category ASC'
        );
        
        res.json({
            success: true,
            data: { faq }
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

// ИСПРАВЛЕННАЯ ФУНКЦИЯ: не сбрасываем tasks_used при смене подписки
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
        
        const subscription = await db.get(
            'SELECT * FROM subscriptions WHERE name = ? AND is_active = 1',
            [plan]
        );
        
        if (!subscription) {
            return res.status(404).json({
                success: false,
                error: 'Тарифный план не найдена'
            });
        }
        
        const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        const wasSubscriptionPending = user.subscription_status === 'pending';
        
        if (subscription.initial_fee > 0 && !user.initial_fee_paid) {
            await db.run(
                'UPDATE users SET balance = balance - ? WHERE id = ?',
                [subscription.initial_fee, userId]
            );
            
            await db.run(
                `INSERT INTO transactions 
                (user_id, type, amount, description, status) 
                VALUES (?, ?, ?, ?, ?)`,
                [
                    userId,
                    'initial_fee',
                    -subscription.initial_fee,
                    `Вступительный взнос: ${subscription.display_name}`,
                    'completed'
                ]
            );
            
            await db.run(
                'UPDATE users SET total_spent = total_spent + ? WHERE id = ?',
                [subscription.initial_fee, userId]
            );
        }
        
        // ВАЖНОЕ ИСПРАВЛЕНИЕ: сохраняем текущее значение tasks_used
        await db.run(
            `UPDATE users SET 
                subscription_plan = ?,
                subscription_status = 'active',
                initial_fee_paid = 1,
                initial_fee_amount = ?,
                tasks_limit = ?,
                subscription_expires = COALESCE(?, DATE('now', '+30 days'))
             WHERE id = ?`,
            [
                plan, 
                subscription.initial_fee, 
                subscription.tasks_limit,
                user.subscription_expires,
                userId
            ]
        );
        
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message) 
            VALUES (?, ?, ?, ?)`,
            [
                userId,
                wasSubscriptionPending ? 'subscription_activated' : 'subscription_changed',
                wasSubscriptionPending ? 'Подписка активирована!' : 'Тариф изменен',
                wasSubscriptionPending 
                    ? `Поздравляем! Вы успешно активировали подписку "${subscription.display_name}". Теперь вы можете создавать задачи.`
                    : `Ваш тариф изменен на "${subscription.display_name}".`
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
            rating: updatedUser.user_rating
        };
        
        res.json({
            success: true,
            message: wasSubscriptionPending 
                ? 'Подписка успешно активирована!'
                : 'Тариф успешно изменен!',
            data: {
                user: userForResponse,
                subscription,
                // Возвращаем количество использованных задач для отображения в интерфейсе
                tasks_used: updatedUser.tasks_used,
                tasks_remaining: updatedUser.tasks_limit - updatedUser.tasks_used
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
            'UPDATE users SET completed_tasks = completed_tasks + 1 WHERE id = ?',
            [req.user.id]
        );
        
        // Отправляем уведомление исполнителю
        if (task.performer_id) {
            await db.run(
                `INSERT INTO notifications (user_id, type, title, message, related_id, related_type)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    task.performer_id,
                    'task_completed',
                    'Клиент подтвердил выполнение',
                    `Клиент подтвердил выполнение задачи "${task.title}"`,
                    taskId,
                    'task'
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
                'UPDATE users SET tasks_used = tasks_used + 1 WHERE id = ?',
                [req.user.id]
            );
        }
        
        await db.run(
            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
             VALUES (?, ?, ?, ?)`,
            [taskId, 'new', req.user.id, 'Задача создана']
        );
        
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message, related_id, related_type) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                req.user.id,
                'task_created',
                'Задача создана',
                `Задача "${title}" успешно создана. Ожидайте назначения исполнителя.`,
                taskId,
                'task'
            ]
        );
        
        const performers = await db.all(
            `SELECT u.id, u.first_name, u.last_name, u.avatar_url, u.user_rating as rating
             FROM users u
             JOIN performer_categories pc ON u.id = pc.performer_id
             WHERE u.role = 'performer' 
               AND u.is_active = 1
               AND pc.category_id = ?
               AND pc.is_active = 1`,
            [category_id]
        );
        
        for (const performer of performers) {
            await db.run(
                `INSERT INTO notifications 
                (user_id, type, title, message, related_id, related_type) 
                VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    performer.id,
                    'new_task_available',
                    'Новая задача доступна',
                    `Доступна новая задача в категории "${category.display_name}"`,
                    taskId,
                    'task'
                ]
            );
        }
        
        const task = await db.get(
            `SELECT t.*, c.display_name as category_name
             FROM tasks t 
             LEFT JOIN categories c ON t.category_id = c.id 
             WHERE t.id = ?`,
            [taskId]
        );
        
        const updatedUser = await db.get(
            'SELECT tasks_used, tasks_limit FROM users WHERE id = ?',
            [req.user.id]
        );
        
        res.status(201).json({
            success: true,
            message: 'Задача успешно создана!',
            data: { 
                task,
                tasks_used: updatedUser.tasks_used,
                tasks_remaining: updatedUser.tasks_limit - updatedUser.tasks_used,
                available_performers: performers.length
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
                tasks,
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
            error: 'Ошибка получения задач'
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
                history,
                messages
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

// ==================== НАСТРОЙКИ СИСТЕМЫ ====================

app.get('/api/settings', async (req, res) => {
    try {
        const settings = await db.all('SELECT * FROM settings');
        
        const settingsObj = {};
        settings.forEach(setting => {
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

// ==================== АДМИН API ====================

app.get('/api/admin/stats', authMiddleware(['admin', 'superadmin', 'manager']), async (req, res) => {
    try {
        const totalUsers = await db.get("SELECT COUNT(*) as count FROM users");
        const totalTasks = await db.get("SELECT COUNT(*) as count FROM tasks");
        const activeSubscriptions = await db.get("SELECT COUNT(*) as count FROM users WHERE subscription_status = 'active'");
        const totalIncome = await db.get("SELECT SUM(amount) as total FROM transactions WHERE type = 'initial_fee' AND status = 'completed'");
        
        res.json({
            success: true,
            data: {
                total_users: totalUsers.count,
                total_tasks: totalTasks.count,
                active_subscriptions: activeSubscriptions.count,
                total_income: totalIncome.total || 0
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

app.get('/api/admin/users', authMiddleware(['admin', 'superadmin', 'manager']), async (req, res) => {
    try {
        const { search, role, limit = 50, offset = 0 } = req.query;
        
        let query = `SELECT * FROM users WHERE 1=1`;
        const params = [];
        
        if (search) {
            query += ` AND (email LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR phone LIKE ?)`;
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }
        
        if (role && role !== 'all') {
            query += ` AND role = ?`;
            params.push(role);
        }
        
        query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        params.push(parseInt(limit), parseInt(offset));
        
        const users = await db.all(query, params);
        
        res.json({
            success: true,
            data: { users }
        });
    } catch (error) {
        console.error('Ошибка получения пользователей:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения пользователей'
        });
    }
});

// Получить список всех исполнителей
app.get('/api/admin/performers', authMiddleware(['admin', 'superadmin', 'manager']), async (req, res) => {
    try {
        const { search, status, limit = 50, offset = 0 } = req.query;
        
        let query = `
            SELECT u.*, 
                   ps.total_tasks,
                   ps.completed_tasks,
                   ps.avg_rating,
                   ps.total_earnings,
                   ps.last_activity,
                   GROUP_CONCAT(DISTINCT c.display_name) as categories
            FROM users u
            LEFT JOIN performer_stats ps ON u.id = ps.performer_id
            LEFT JOIN performer_categories pc ON u.id = pc.performer_id
            LEFT JOIN categories c ON pc.category_id = c.id
            WHERE u.role = 'performer'
        `;
        
        const params = [];
        
        if (search) {
            query += ` AND (u.email LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ? OR u.phone LIKE ?)`;
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }
        
        if (status && status !== 'all') {
            if (status === 'active') {
                query += ` AND u.is_active = 1`;
            } else if (status === 'inactive') {
                query += ` AND u.is_active = 0`;
            }
        }
        
        query += ` GROUP BY u.id ORDER BY u.created_at DESC LIMIT ? OFFSET ?`;
        params.push(parseInt(limit), parseInt(offset));
        
        const performers = await db.all(query, params);
        
        res.json({
            success: true,
            data: { performers }
        });
        
    } catch (error) {
        console.error('Ошибка получения исполнителей:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения исполнителей'
        });
    }
});

app.get('/api/admin/tasks', authMiddleware(['admin', 'superadmin', 'manager']), async (req, res) => {
    try {
        const { status, limit = 50, offset = 0 } = req.query;
        
        let query = `
            SELECT t.*, 
                   c.display_name as category_name,
                   u1.first_name as client_first_name, 
                   u1.last_name as client_last_name,
                   u2.first_name as performer_first_name,
                   u2.last_name as performer_last_name
            FROM tasks t
            LEFT JOIN categories c ON t.category_id = c.id
            LEFT JOIN users u1 ON t.client_id = u1.id
            LEFT JOIN users u2 ON t.performer_id = u2.id
            WHERE 1=1
        `;
        const params = [];
        
        if (status && status !== 'all') {
            query += ` AND t.status = ?`;
            params.push(status);
        }
        
        query += ` ORDER BY t.created_at DESC LIMIT ? OFFSET ?`;
        params.push(parseInt(limit), parseInt(offset));
        
        const tasks = await db.all(query, params);
        
        res.json({
            success: true,
            data: { tasks }
        });
    } catch (error) {
        console.error('Ошибка получения задач:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения задач'
        });
    }
});

app.get('/api/admin/subscriptions', authMiddleware(['admin', 'superadmin', 'manager']), async (req, res) => {
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
            data: { subscriptions: subscriptionsWithParsedFeatures }
        });
    } catch (error) {
        console.error('Ошибка получения подписок:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения подписок'
        });
    }
});

app.get('/api/admin/services', authMiddleware(['admin', 'superadmin', 'manager']), async (req, res) => {
    try {
        const services = await db.all(`
            SELECT s.*, c.display_name as category_name
            FROM services s
            LEFT JOIN categories c ON s.category_id = c.id
            ORDER BY s.category_id, s.sort_order ASC
        `);
        
        res.json({
            success: true,
            data: { services }
        });
    } catch (error) {
        console.error('Ошибка получения услуг:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения услуг'
        });
    }
});

app.get('/api/admin/categories', authMiddleware(['admin', 'superadmin', 'manager']), async (req, res) => {
    try {
        const categories = await db.all(
            'SELECT * FROM categories ORDER BY sort_order ASC'
        );
        
        res.json({
            success: true,
            data: { categories }
        });
    } catch (error) {
        console.error('Ошибка получения категорий:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения категорий'
        });
    }
});

app.post('/api/admin/categories', authMiddleware(['admin', 'superadmin', 'manager']), async (req, res) => {
    try {
        const { id, name, display_name, description, icon, color, sort_order, is_active } = req.body;
        
        if (!name || !display_name || !description || !icon) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля'
            });
        }
        
        if (id) {
            await db.run(
                `UPDATE categories SET 
                    name = ?, display_name = ?, description = ?, icon = ?, 
                    color = ?, sort_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [name, display_name, description, icon, color || '#FF6B8B', sort_order || 0, is_active ? 1 : 0, id]
            );
        } else {
            await db.run(
                `INSERT INTO categories (name, display_name, description, icon, color, sort_order, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [name, display_name, description, icon, color || '#FF6B8B', sort_order || 0, is_active ? 1 : 0]
            );
        }
        
        res.json({
            success: true,
            message: id ? 'Категория обновлена' : 'Категория создана'
        });
    } catch (error) {
        console.error('Ошибка сохранения категории:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сохранения категории'
        });
    }
});

app.post('/api/admin/subscriptions', authMiddleware(['admin', 'superadmin', 'manager']), async (req, res) => {
    try {
        const { 
            id, name, display_name, description, price_monthly, price_yearly, 
            initial_fee, tasks_limit, features, color_theme, sort_order, is_popular, is_active 
        } = req.body;
        
        if (!name || !display_name || !description || !price_monthly || !tasks_limit) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля'
            });
        }
        
        const featuresArray = Array.isArray(features) ? features : [];
        
        if (id) {
            await db.run(
                `UPDATE subscriptions SET 
                    name = ?, display_name = ?, description = ?, price_monthly = ?, 
                    price_yearly = ?, initial_fee = ?, tasks_limit = ?, features = ?,
                    color_theme = ?, sort_order = ?, is_popular = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [
                    name, display_name, description, price_monthly, price_yearly || price_monthly * 12,
                    initial_fee || 0, tasks_limit, JSON.stringify(featuresArray),
                    color_theme || '#FF6B8B', sort_order || 0, is_popular ? 1 : 0, is_active ? 1 : 0, id
                ]
            );
        } else {
            await db.run(
                `INSERT INTO subscriptions 
                (name, display_name, description, price_monthly, price_yearly, initial_fee, 
                 tasks_limit, features, color_theme, sort_order, is_popular, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    name, display_name, description, price_monthly, price_yearly || price_monthly * 12,
                    initial_fee || 0, tasks_limit, JSON.stringify(featuresArray),
                    color_theme || '#FF6B8B', sort_order || 0, is_popular ? 1 : 0, is_active ? 1 : 0
                ]
            );
        }
        
        res.json({
            success: true,
            message: id ? 'Подписка обновлена' : 'Подписка создана'
        });
    } catch (error) {
        console.error('Ошибка сохранения подписки:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сохранения подписки'
        });
    }
});

app.post('/api/admin/services', authMiddleware(['admin', 'superadmin', 'manager']), async (req, res) => {
    try {
        const { id, category_id, name, description, base_price, estimated_time, is_active, sort_order, is_featured } = req.body;
        
        if (!category_id || !name || !description) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля'
            });
        }
        
        if (id) {
            await db.run(
                `UPDATE services SET 
                    category_id = ?, name = ?, description = ?, base_price = ?, 
                    estimated_time = ?, is_active = ?, sort_order = ?, is_featured = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [category_id, name, description, base_price || 0, estimated_time || null, 
                 is_active ? 1 : 0, sort_order || 0, is_featured ? 1 : 0, id]
            );
        } else {
            await db.run(
                `INSERT INTO services (category_id, name, description, base_price, estimated_time, is_active, sort_order, is_featured)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [category_id, name, description, base_price || 0, estimated_time || null, 
                 is_active ? 1 : 0, sort_order || 0, is_featured ? 1 : 0]
            );
        }
        
        res.json({
            success: true,
            message: id ? 'Услуга обновлена' : 'Услуга создана'
        });
    } catch (error) {
        console.error('Ошибка сохранения услуги:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сохранения услуги'
        });
    }
});

// Создать пользователя-исполнителя
app.post('/api/admin/performers', authMiddleware(['admin', 'superadmin', 'manager']), async (req, res) => {
    try {
        const { email, password, first_name, last_name, phone, categories } = req.body;
        
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
        
        // Проверяем, существует ли пользователь с таким email
        const existingUser = await db.get(
            'SELECT id FROM users WHERE email = ?',
            [email]
        );
        
        if (existingUser) {
            return res.status(409).json({
                success: false,
                error: 'Пользователь с таким email уже существует'
            });
        }
        
        // Хэшируем пароль
        const hashedPassword = await bcrypt.hash(password, 12);
        
        // Создаем аватар
        const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(first_name)}+${encodeURIComponent(last_name)}&background=3498DB&color=fff&bold=true`;
        
        // Создаем пользователя
        const result = await db.run(
            `INSERT INTO users 
            (email, password, first_name, last_name, phone, role, 
             subscription_plan, subscription_status, subscription_expires,
             initial_fee_paid, initial_fee_amount, avatar_url, is_active) 
            VALUES (?, ?, ?, ?, ?, 'performer', 'essential', 'active', DATE('now', '+365 days'), 1, 0, ?, 1)`,
            [email, hashedPassword, first_name, last_name, phone, avatarUrl]
        );
        
        const performerId = result.lastID;
        
        // Добавляем категории
        if (categories && Array.isArray(categories)) {
            for (const category of categories) {
                await db.run(
                    `INSERT INTO performer_categories (performer_id, category_id, is_active)
                     VALUES (?, ?, 1)`,
                    [performerId, category.id || category]
                );
            }
        }
        
        // Создаем запись статистики
        await db.run(
            `INSERT INTO performer_stats (performer_id, last_activity)
             VALUES (?, CURRENT_TIMESTAMP)`,
            [performerId]
        );
        
        // Отправляем уведомление
        await db.run(
            `INSERT INTO notifications (user_id, type, title, message)
             VALUES (?, ?, ?, ?)`,
            [
                performerId,
                'welcome',
                'Добро пожаловать в команду исполнителей!',
                'Ваш аккаунт исполнителя успешно создан. Теперь вы можете принимать задачи от клиентов.'
            ]
        );
        
        res.status(201).json({
            success: true,
            message: 'Исполнитель успешно создан',
            data: {
                performer_id: performerId
            }
        });
        
    } catch (error) {
        console.error('Ошибка создания исполнителя:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания исполнителя'
        });
    }
});

// Добавить исполнителя в категорию
app.post('/api/admin/performers/:id/categories', authMiddleware(['admin', 'superadmin', 'manager']), async (req, res) => {
    try {
        const performerId = req.params.id;
        const { category_id, experience_years = 0, hourly_rate = 0 } = req.body;
        
        if (!category_id) {
            return res.status(400).json({
                success: false,
                error: 'Не указана категория'
            });
        }
        
        // Проверяем, существует ли пользователь и является ли он исполнителем
        const performer = await db.get(
            'SELECT * FROM users WHERE id = ? AND role = "performer"',
            [performerId]
        );
        
        if (!performer) {
            return res.status(404).json({
                success: false,
                error: 'Исполнитель не найден'
            });
        }
        
        // Проверяем, существует ли категория
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
        
        // Проверяем, не добавлена ли уже эта категория
        const existing = await db.get(
            'SELECT * FROM performer_categories WHERE performer_id = ? AND category_id = ?',
            [performerId, category_id]
        );
        
        if (existing) {
            // Обновляем существующую запись
            await db.run(
                `UPDATE performer_categories SET 
                    is_active = 1,
                    experience_years = ?,
                    hourly_rate = ?,
                    updated_at = CURRENT_TIMESTAMP
                 WHERE performer_id = ? AND category_id = ?`,
                [experience_years, hourly_rate, performerId, category_id]
            );
        } else {
            // Добавляем новую запись
            await db.run(
                `INSERT INTO performer_categories (performer_id, category_id, experience_years, hourly_rate)
                 VALUES (?, ?, ?, ?)`,
                [performerId, category_id, experience_years, hourly_rate]
            );
        }
        
        res.json({
            success: true,
            message: 'Категория успешно добавлена исполнителю'
        });
        
    } catch (error) {
        console.error('Ошибка добавления категории исполнителю:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка добавления категории исполнителю'
        });
    }
});

// Удалить исполнителя из категории
app.delete('/api/admin/performers/:id/categories/:categoryId', authMiddleware(['admin', 'superadmin', 'manager']), async (req, res) => {
    try {
        const performerId = req.params.id;
        const categoryId = req.params.categoryId;
        
        // Удаляем связь
        await db.run(
            'DELETE FROM performer_categories WHERE performer_id = ? AND category_id = ?',
            [performerId, categoryId]
        );
        
        res.json({
            success: true,
            message: 'Категория успешно удалена у исполнителя'
        });
        
    } catch (error) {
        console.error('Ошибка удаления категории у исполнителя:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка удаления категории у исполнителя'
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
                ['frontend_url', process.env.FRONTEND_URL || 'http://localhost:3000', 'URL фронтенда', 'system'],
                ['admin_chat_ids', process.env.ADMIN_CHAT_IDS || '', 'ID чатов администраторов для Telegram', 'system'],
                ['bot_token_hash', process.env.TELEGRAM_BOT_TOKEN ? crypto.createHash('sha256').update(process.env.TELEGRAM_BOT_TOKEN).digest('hex').substring(0, 10) : 'none', 'Хэш токена бота', 'security']
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
                [categoryMap.beauty_and_health, 'Массаж', 'Расслабляющий или лечебный массаж', 0, '1 час', 1, 9, 1],
                
                [categoryMap.courses_and_education, 'Репетиторство', 'Индивидуальные занятия по предметам', 0, '1 час', 1, 10, 1],
                
                [categoryMap.shopping_and_delivery, 'Покупка продуктов', 'Покупка и доставка продуктов', 0, '1-2 часа', 1, 11, 1],
                [categoryMap.shopping_and_delivery, 'Доставка документов', 'Срочная доставка документов', 0, '1 час', 1, 12, 0]
            ];

            for (const service of services) {
                await db.run(
                    `INSERT INTO services 
                    (category_id, name, description, base_price, estimated_time, is_active, sort_order, is_featured) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    service
                );
            }
            console.log('✅ Услуги созданы (12 услуг)');
        }

        // Тестовые пользователи (только для разработки)
        const usersExist = await db.get("SELECT 1 FROM users WHERE email = 'superadmin@concierge.ru'");
        if (!usersExist && process.env.NODE_ENV !== 'production') {
            const passwordHash = await bcrypt.hash('admin123', 12);
            const clientPasswordHash = await bcrypt.hash('client123', 12);
            const performerPasswordHash = await bcrypt.hash('performer123', 12);
            
            const expiryDate = new Date();
            expiryDate.setFullYear(expiryDate.getFullYear() + 1);
            const expiryDateStr = expiryDate.toISOString().split('T')[0];

            const users = [
                ['superadmin@concierge.ru', passwordHash, 'Александр', 'Иванов', '+79991112233', 'superadmin', 'premium', 'active', expiryDateStr, 'https://ui-avatars.com/api/?name=Александр+Иванов&background=9B59B6&color=fff&bold=true', 0, 1000, 1, 1000, 999, 0, 0, 4.9, 0, 1, 1, null, null, null],
                ['admin@concierge.ru', passwordHash, 'Мария', 'Петрова', '+79992223344', 'admin', 'premium', 'active', expiryDateStr, 'https://ui-avatars.com/api/?name=Мария+Петрова&background=2ECC71&color=fff&bold=true', 0, 1000, 1, 1000, 999, 0, 0, 4.8, 0, 1, 1, null, null, null],
                ['performer1@concierge.ru', performerPasswordHash, 'Анна', 'Кузнецова', '+79994445566', 'performer', 'essential', 'active', expiryDateStr, 'https://ui-avatars.com/api/?name=Анна+Кузнецова&background=3498DB&color=fff&bold=true', 0, 500, 1, 500, 20, 5, 0, 4.5, 30, 1, 1, null, null, null],
                ['performer2@concierge.ru', performerPasswordHash, 'Мария', 'Смирнова', '+79995556677', 'performer', 'essential', 'active', expiryDateStr, 'https://ui-avatars.com/api/?name=Мария+Смирнова&background=3498DB&color=fff&bold=true', 0, 500, 1, 500, 20, 8, 0, 4.6, 45, 1, 1, null, null, null],
                ['client1@example.com', clientPasswordHash, 'Елена', 'Васильева', '+79997778899', 'client', 'premium', 'active', expiryDateStr, 'https://ui-avatars.com/api/?name=Елена+Васильева&background=FF6B8B&color=fff&bold=true', 0, 1000, 1, 1000, 999, 2, 10, 4.0, 10, 1, 1, null, null, null],
                ['client2@example.com', clientPasswordHash, 'Наталья', 'Федорова', '+79998889900', 'client', 'essential', 'active', expiryDateStr, 'https://ui-avatars.com/api/?name=Наталья+Федорова&background=FF6B8B&color=fff&bold=true', 0, 500, 1, 500, 5, 1, 5, 4.5, 3, 1, 1, null, null, null],
                ['client3@example.com', clientPasswordHash, 'Оксана', 'Николаева', '+79999990011', 'client', 'essential', 'pending', null, 'https://ui-avatars.com/api/?name=Оксана+Николаева&background=FF6B8B&color=fff&bold=true', 0, 500, 0, 500, 5, 0, 0, 0, 0, 1, 1, null, null, null]
            ];

            for (const user of users) {
                await db.run(
                    `INSERT INTO users 
                    (email, password, first_name, last_name, phone, role, 
                     subscription_plan, subscription_status, subscription_expires,
                     avatar_url, balance, initial_fee_paid, initial_fee_amount, 
                     tasks_limit, tasks_used, total_spent, user_rating, completed_tasks, 
                     is_active, email_verified, verification_token, reset_token, reset_token_expires) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    user
                );
            }
            console.log('✅ Тестовые пользователи созданы');
            
            // Статистика для исполнителей
            const performers = await db.all("SELECT id FROM users WHERE role = 'performer'");
            for (const performer of performers) {
                await db.run(
                    `INSERT INTO performer_stats (performer_id, last_activity) VALUES (?, CURRENT_TIMESTAMP)`,
                    [performer.id]
                );
            }
            
            // Категории для исполнителей
            const categories = await db.all("SELECT id FROM categories");
            const performerUsers = await db.all("SELECT id FROM users WHERE role = 'performer'");
            
            for (const performer of performerUsers) {
                const categoryIds = categories
                    .sort(() => Math.random() - 0.5)
                    .slice(0, 2 + Math.floor(Math.random() * 2))
                    .map(c => c.id);
                
                for (const categoryId of categoryIds) {
                    await db.run(
                        `INSERT OR IGNORE INTO performer_categories (performer_id, category_id, experience_years, hourly_rate) 
                         VALUES (?, ?, ?, ?)`,
                        [performer.id, categoryId, Math.floor(Math.random() * 5) + 1, Math.floor(Math.random() * 500) + 500]
                    );
                }
            }
            console.log('✅ Назначения помощников по категориям созданы');
            
            // Тестовые задачи
            const clients = await db.all("SELECT id FROM users WHERE role = 'client' AND subscription_status = 'active'");
            const categoriesList = await db.all("SELECT id FROM categories");
            const servicesList = await db.all("SELECT id FROM services WHERE is_active = 1");
            
            if (clients.length > 0 && categoriesList.length > 0 && servicesList.length > 0) {
                const taskTitles = [
                    'Уборка двухкомнатной квартиры',
                    'Приготовление ужина на 4 персоны',
                    'Маникюр с выездом на дом',
                    'Покупка продуктов на неделю',
                    'Няня на 4 часа'
                ];
                
                const taskDescriptions = [
                    'Необходимо сделать генеральную уборку в двухкомнатной квартире 55 кв.м. Особое внимание кухне и санузлу.',
                    'Нужно приготовить ужин из 3-х блюд на 4 человека. Предпочтение русской кухне.',
                    'Требуется сделать классический маникюр с покрытием гель-лаком. Цвет предпочитаю нейтральный.',
                    'Собрать продуктовую корзину по списку из Ашана. Доставить до 18:00.',
                    'Присмотреть за ребенком 5 лет на 4 часа. Поиграть, покормить обедом, погулять на площадке.'
                ];
                
                for (let i = 0; i < 5; i++) {
                    const client = clients[Math.floor(Math.random() * clients.length)];
                    const category = categoriesList[Math.floor(Math.random() * categoriesList.length)];
                    const service = servicesList[Math.floor(Math.random() * servicesList.length)];
                    const performer = performerUsers[Math.floor(Math.random() * performerUsers.length)];
                    
                    const taskNumber = generateTaskNumber();
                    
                    const statuses = ['new', 'searching', 'assigned', 'in_progress', 'completed'];
                    const status = statuses[Math.floor(Math.random() * statuses.length)];
                    
                    const deadline = new Date();
                    deadline.setDate(deadline.getDate() + Math.floor(Math.random() * 7) + 1);
                    
                    await db.run(
                        `INSERT INTO tasks 
                        (task_number, title, description, client_id, performer_id, category_id, service_id, 
                         status, priority, price, address, deadline, contact_info) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            taskNumber,
                            taskTitles[i],
                            taskDescriptions[i],
                            client.id,
                            status === 'completed' || status === 'in_progress' || status === 'assigned' ? performer.id : null,
                            category.id,
                            service.id,
                            status,
                            ['low', 'medium', 'high'][Math.floor(Math.random() * 3)],
                            0,
                            'г. Москва, ул. Примерная, д. ' + (Math.floor(Math.random() * 100) + 1),
                            deadline.toISOString(),
                            '+79991234567'
                        ]
                    );
                    
                    const taskId = (await db.get('SELECT last_insert_rowid() as id')).id;
                    
                    // История статусов
                    await db.run(
                        `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
                         VALUES (?, ?, ?, ?)`,
                        [taskId, 'new', client.id, 'Задача создана']
                    );
                    
                    if (status !== 'new') {
                        await db.run(
                            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
                             VALUES (?, ?, ?, ?)`,
                            [taskId, 'searching', client.id, 'Поиск исполнителя']
                        );
                    }
                    
                    if (status === 'assigned' || status === 'in_progress' || status === 'completed') {
                        await db.run(
                            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
                             VALUES (?, ?, ?, ?)`,
                            [taskId, 'assigned', performer.id, 'Исполнитель назначен']
                        );
                    }
                    
                    if (status === 'in_progress' || status === 'completed') {
                        await db.run(
                            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
                             VALUES (?, ?, ?, ?)`,
                            [taskId, 'in_progress', performer.id, 'Исполнитель начал работу']
                        );
                    }
                    
                    if (status === 'completed') {
                        await db.run(
                            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
                             VALUES (?, ?, ?, ?)`,
                            [taskId, 'completed', performer.id, 'Задача выполнена']
                        );
                        
                        // Отзыв
                        await db.run(
                            `INSERT INTO reviews (task_id, client_id, performer_id, rating, comment, is_anonymous) 
                             VALUES (?, ?, ?, ?, ?, ?)`,
                            [taskId, client.id, performer.id, Math.floor(Math.random() * 2) + 4, 'Отличная работа! Быстро и качественно.', 0]
                        );
                        
                        // Тестовые сообщения в чат
                        await db.run(
                            `INSERT INTO task_messages (task_id, user_id, message) 
                             VALUES (?, ?, ?)`,
                            [taskId, client.id, 'Здравствуйте! Буду ждать вас завтра в назначенное время.']
                        );
                        
                        await db.run(
                            `INSERT INTO task_messages (task_id, user_id, message) 
                             VALUES (?, ?, ?)`,
                            [taskId, performer.id, 'Добрый день! Да, я буду в 10:00 утра. Нужно что-то подготовить?']
                        );
                        
                        await db.run(
                            `INSERT INTO task_messages (task_id, user_id, message) 
                             VALUES (?, ?, ?)`,
                            [taskId, client.id, 'Нет, всё готово. До встречи!']
                        );
                    }
                }
                console.log('✅ Тестовые задачи созданы (5 задач)');
                
                // Обновляем статистику исполнителей
                for (const performer of performerUsers) {
                    await updatePerformerStats(performer.id);
                }
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
    if (bot) {
        bot.stopPolling();
    }
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 Получен SIGINT. Начинаю graceful shutdown...');
    if (db) {
        db.close();
    }
    if (bot) {
        bot.stopPolling();
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
        console.log(`📁 Директория скрипта: ${__dirname}`);
        console.log(`💻 Платформа: ${os.platform()} ${os.arch()}`);
        console.log(`📁 Временная директория системы: ${os.tmpdir()}`);
        console.log(`🤖 Telegram Bot: ${process.env.TELEGRAM_BOT_TOKEN ? '✅ Enabled' : '❌ Disabled'}`);
        console.log(`🔐 JWT Secret: ${process.env.JWT_SECRET ? '✅ Set' : '⚠️ Using default'}`);
        console.log('='.repeat(80));
        
        // Проверяем доступные директории
        console.log('\n🔍 Проверка доступных директорий для записи:');
        console.log('='.repeat(60));
        
        const testDirs = [
            '/tmp',
            '/var/tmp',
            os.tmpdir(),
            process.cwd(),
            __dirname
        ];
        
        testDirs.forEach(dir => {
            try {
                const testFile = path.join(dir, '.write_test_' + Date.now() + '.tmp');
                fs.writeFileSync(testFile, 'test');
                fs.unlinkSync(testFile);
                console.log(`✅ ${dir} - доступен для записи`);
            } catch (error) {
                console.log(`❌ ${dir} - недоступен: ${error.message}`);
            }
        });
        console.log('='.repeat(60));
        
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
            console.log(`   👉 https://sergeynikishin555123123-lab--86fa.twc1.net`);
            console.log(`\n👑 Админ-панель:`);
            console.log(`   👉 https://sergeynikishin555123123-lab--86fa.twc1.net/admin.html`);
            console.log(`\n👨‍💼 Панель исполнителя:`);
            console.log(`   👉 https://sergeynikishin555123123-lab--86fa.twc1.net/performer.html`);
            console.log(`\n📊 API и здоровье системы:`);
            console.log(`   👉 https://sergeynikishin555123123-lab--86fa.twc1.net/api`);
            console.log(`   👉 https://sergeynikishin555123123-lab--86fa.twc1.net/health`);
            console.log('='.repeat(60));
            
            if (process.env.NODE_ENV !== 'production') {
                console.log('\n🔑 ТЕСТОВЫЕ АККАУНТЫ:');
                console.log('='.repeat(60));
                console.log('👑 Главный админ: superadmin@concierge.ru / admin123');
                console.log('👨‍💼 Админ: admin@concierge.ru / admin123');
                console.log('👩‍🏫 Помощник 1: performer1@concierge.ru / performer123');
                console.log('👩‍🏫 Помощник 2: performer2@concierge.ru / performer123');
                console.log('👩 Клиент Премиум: client1@example.com / client123');
                console.log('👩 Клиент Эссеншл: client2@example.com / client123');
                console.log('👩 Клиент без оплаты: client3@example.com / client123');
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
