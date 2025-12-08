require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
const app = express();

// Middleware
app.use(cors());
app.use(helmet({
    contentSecurityPolicy: false
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ==================== SQLite БАЗА ДАННЫХ ====================
let db;

const initDatabase = async () => {
    try {
        db = await open({
            filename: './concierge.db',
            driver: sqlite3.Database
        });

        // Создание таблиц
        await db.exec(`
            -- Пользователи
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                firstName TEXT NOT NULL,
                lastName TEXT NOT NULL,
                phone TEXT,
                role TEXT CHECK(role IN ('client', 'performer', 'admin', 'superadmin')) DEFAULT 'client',
                avatar TEXT DEFAULT 'default-avatar.png',
                rating REAL DEFAULT 0,
                subscription_plan TEXT DEFAULT 'free',
                subscription_status TEXT DEFAULT 'active',
                balance REAL DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                last_login TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
                subcategory TEXT,
                status TEXT DEFAULT 'new',
                priority TEXT DEFAULT 'medium',
                deadline TIMESTAMP NOT NULL,
                price REAL NOT NULL,
                address TEXT,
                city TEXT,
                rating INTEGER,
                feedback_text TEXT,
                feedback_images TEXT,
                cancellation_reason TEXT,
                payment_status TEXT DEFAULT 'pending',
                payment_method TEXT,
                tags TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (client_id) REFERENCES users (id),
                FOREIGN KEY (performer_id) REFERENCES users (id)
            );

            -- Услуги
            CREATE TABLE IF NOT EXISTS services (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                category TEXT NOT NULL,
                subcategories TEXT,
                price_one_time REAL,
                price_hourly REAL,
                duration INTEGER DEFAULT 60,
                requirements TEXT,
                included TEXT,
                images TEXT,
                is_active INTEGER DEFAULT 1,
                is_popular INTEGER DEFAULT 0,
                display_order INTEGER DEFAULT 0,
                tags TEXT,
                rating_average REAL DEFAULT 0,
                rating_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Уведомления
            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                task_id INTEGER,
                is_read INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            );

            -- Сообщения
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                sender_id INTEGER NOT NULL,
                receiver_id INTEGER NOT NULL,
                message TEXT NOT NULL,
                is_read INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (task_id) REFERENCES tasks (id),
                FOREIGN KEY (sender_id) REFERENCES users (id),
                FOREIGN KEY (receiver_id) REFERENCES users (id)
            );

            -- Платежи
            CREATE TABLE IF NOT EXISTS payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                amount REAL NOT NULL,
                status TEXT DEFAULT 'pending',
                payment_method TEXT,
                transaction_id TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (task_id) REFERENCES tasks (id),
                FOREIGN KEY (user_id) REFERENCES users (id)
            );
        `);

        // Создание индексов
        await db.exec(`
            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
            CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
            CREATE INDEX IF NOT EXISTS idx_tasks_client ON tasks(client_id);
            CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
            CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);
            CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
            CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
        `);

        console.log('✅ База данных SQLite инициализирована');
        
        // Создаем тестовые данные если нужно
        await createTestData();
        
        return db;
    } catch (error) {
        console.error('❌ Ошибка инициализации базы данных:', error);
        process.exit(1);
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
            
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'concierge-secret-key');
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

// ==================== СОЗДАНИЕ ТЕСТОВЫХ ДАННЫХ ====================
const createTestData = async () => {
    try {
        // Проверяем есть ли уже пользователи
        const userCount = await db.get('SELECT COUNT(*) as count FROM users');
        
        if (userCount.count === 0) {
            console.log('📝 Создание тестовых данных...');
            
            const now = new Date().toISOString();
            
            // Создаем тестовых пользователей
            const users = [
                // Суперадминистратор
                {
                    email: 'superadmin@concierge.com',
                    password: await bcrypt.hash('admin123', 10),
                    firstName: 'Супер',
                    lastName: 'Администратор',
                    phone: '+79999999999',
                    role: 'superadmin',
                    subscription_plan: 'vip',
                    created_at: now
                },
                // Администратор
                {
                    email: 'admin@concierge.com',
                    password: await bcrypt.hash('admin123', 10),
                    firstName: 'Анна',
                    lastName: 'Администратор',
                    phone: '+79998887766',
                    role: 'admin',
                    subscription_plan: 'vip',
                    created_at: now
                },
                // Клиенты
                {
                    email: 'maria@example.com',
                    password: await bcrypt.hash('client123', 10),
                    firstName: 'Мария',
                    lastName: 'Иванова',
                    phone: '+79997776655',
                    role: 'client',
                    subscription_plan: 'premium',
                    created_at: now
                },
                {
                    email: 'ekaterina@example.com',
                    password: await bcrypt.hash('client123', 10),
                    firstName: 'Екатерина',
                    lastName: 'Петрова',
                    phone: '+79996665544',
                    role: 'client',
                    subscription_plan: 'basic',
                    created_at: now
                },
                // Исполнители
                {
                    email: 'elena@performer.com',
                    password: await bcrypt.hash('performer123', 10),
                    firstName: 'Елена',
                    lastName: 'Смирнова',
                    phone: '+79994443322',
                    role: 'performer',
                    rating: 4.7,
                    subscription_plan: 'basic',
                    created_at: now
                },
                {
                    email: 'anna@performer.com',
                    password: await bcrypt.hash('performer123', 10),
                    firstName: 'Анна',
                    lastName: 'Кузнецова',
                    phone: '+79993332211',
                    role: 'performer',
                    rating: 4.9,
                    subscription_plan: 'premium',
                    created_at: now
                }
            ];

            for (const user of users) {
                await db.run(
                    `INSERT INTO users (email, password, firstName, lastName, phone, role, subscription_plan, rating, created_at) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [user.email, user.password, user.firstName, user.lastName, user.phone, user.role, 
                     user.subscription_plan, user.rating || 0, user.created_at]
                );
            }

            console.log(`✅ Создано ${users.length} тестовых пользователей`);

            // Создаем тестовые услуги
            const services = [
                {
                    name: 'Помощь с уборкой',
                    description: 'Помогу навести порядок в квартире, разобрать гардероб, организовать пространство.',
                    category: 'home_and_household',
                    subcategories: 'Уборка,Организация',
                    price_one_time: 2500,
                    price_hourly: 500,
                    duration: 180,
                    is_active: 1,
                    is_popular: 1,
                    rating_average: 4.8,
                    rating_count: 127,
                    tags: 'уборка,помощь,организация'
                },
                {
                    name: 'Присмотр за детьми',
                    description: 'Посижу с вашим ребенком, погуляю, помогу с уроками, организую досуг.',
                    category: 'family_and_children',
                    subcategories: 'Няня,Репетитор',
                    price_one_time: 1500,
                    price_hourly: 350,
                    duration: 240,
                    is_active: 1,
                    is_popular: 1,
                    rating_average: 4.9,
                    rating_count: 89,
                    tags: 'дети,няня,присмотр'
                },
                {
                    name: 'Помощь с маникюром',
                    description: 'Сделаю аккуратный маникюр с покрытием гель-лаком или укреплением ногтей.',
                    category: 'beauty_and_health',
                    subcategories: 'Маникюр',
                    price_one_time: 1800,
                    price_hourly: null,
                    duration: 90,
                    is_active: 1,
                    is_popular: 1,
                    rating_average: 4.7,
                    rating_count: 234,
                    tags: 'маникюр,уход,красота'
                },
                {
                    name: 'Помощь с английским',
                    description: 'Помогу с домашним заданием, подготовкой к экзаменам или разговорной практикой.',
                    category: 'courses_and_education',
                    subcategories: 'Репетитор',
                    price_one_time: 1000,
                    price_hourly: 1500,
                    duration: 60,
                    is_active: 1,
                    is_popular: 0,
                    rating_average: 4.9,
                    rating_count: 156,
                    tags: 'английский,обучение,репетитор'
                },
                {
                    name: 'Помощь с питомцем',
                    description: 'Выгуляю собаку, покормлю кошку, посижу с животным пока вас нет дома.',
                    category: 'pets',
                    subcategories: 'Выгул,Передержка',
                    price_one_time: 800,
                    price_hourly: 300,
                    duration: 60,
                    is_active: 1,
                    is_popular: 0,
                    rating_average: 4.8,
                    rating_count: 78,
                    tags: 'питомцы,выгул,уход'
                }
            ];

            for (const service of services) {
                await db.run(
                    `INSERT INTO services (name, description, category, subcategories, price_one_time, price_hourly, 
                     duration, is_active, is_popular, rating_average, rating_count, tags) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [service.name, service.description, service.category, service.subcategories, 
                     service.price_one_time, service.price_hourly, service.duration, service.is_active, 
                     service.is_popular, service.rating_average, service.rating_count, service.tags]
                );
            }

            console.log(`✅ Создано ${services.length} тестовых услуг`);

            // Создаем тестовые задачи
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            
            const nextWeek = new Date();
            nextWeek.setDate(nextWeek.getDate() + 7);
            
            const tasks = [
                {
                    title: 'Помогите с генеральной уборкой после ремонта',
                    description: 'Нужно помыть окна, протереть пыль везде, помыть полы, разобрать коробки после переезда.',
                    client_id: 3, // Мария
                    performer_id: 5, // Елена
                    category: 'home_and_household',
                    subcategory: 'Уборка',
                    status: 'completed',
                    priority: 'high',
                    deadline: new Date(Date.now() - 86400000).toISOString(), // Вчера
                    price: 3500,
                    address: 'Москва, ул. Примерная, д. 1',
                    rating: 5,
                    feedback_text: 'Елена прекрасно справилась! Квартира сияет, все разложено по местам. Очень рекомендую!'
                },
                {
                    title: 'Нужна няня на субботу',
                    description: 'Ребенку 4 года, нужно посидеть с ним с 10 до 18, погулять, покормить, поиграть.',
                    client_id: 4, // Екатерина
                    category: 'family_and_children',
                    subcategory: 'Няня',
                    status: 'in_progress',
                    priority: 'medium',
                    deadline: tomorrow.toISOString(),
                    price: 2800,
                    address: 'Москва, ул. Тестовая, д. 5'
                },
                {
                    title: 'Сделать маникюр к празднику',
                    description: 'Нужен классический маникюр с покрытием гель-лаком нежного розового цвета.',
                    client_id: 3, // Мария
                    performer_id: 6, // Анна
                    category: 'beauty_and_health',
                    subcategory: 'Маникюр',
                    status: 'assigned',
                    priority: 'low',
                    deadline: nextWeek.toISOString(),
                    price: 1800,
                    address: 'Москва, ул. Примерная, д. 1'
                }
            ];

            for (const task of tasks) {
                // Генерируем номер задачи
                const date = new Date();
                const year = date.getFullYear().toString().slice(-2);
                const month = (date.getMonth() + 1).toString().padStart(2, '0');
                const day = date.getDate().toString().padStart(2, '0');
                
                const count = await db.get(
                    'SELECT COUNT(*) as count FROM tasks WHERE DATE(created_at) = DATE(?)',
                    [date.toISOString()]
                );
                
                const taskNumber = `TASK-${year}${month}${day}-${(count.count + 1).toString().padStart(4, '0')}`;
                
                await db.run(
                    `INSERT INTO tasks (task_number, title, description, client_id, performer_id, category, subcategory, 
                     status, priority, deadline, price, address, rating, feedback_text) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [taskNumber, task.title, task.description, task.client_id, task.performer_id, 
                     task.category, task.subcategory, task.status, task.priority, task.deadline, 
                     task.price, task.address, task.rating, task.feedback_text]
                );
            }

            console.log(`✅ Создано ${tasks.length} тестовых задач`);
            console.log('🎉 Тестовые данные успешно созданы!');
            
            console.log('\n🔑 Тестовые аккаунты для входа:');
            console.log('👑 Суперадмин: superadmin@concierge.com / admin123');
            console.log('👩‍💼 Админ: admin@concierge.com / admin123');
            console.log('👩 Клиент: maria@example.com / client123');
            console.log('👨‍🏫 Исполнитель: elena@performer.com / performer123');
        }
    } catch (error) {
        console.error('❌ Ошибка создания тестовых данных:', error);
    }
};

// ==================== API МАРШРУТЫ ====================

// Главная страница
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: '🎀 Добро пожаловать в Женский Консьерж Сервис',
        version: '4.2.0',
        status: '🟢 Работает',
        description: 'Система помощи и заботы для женщин',
        database: 'SQLite (встроенная)',
        endpoints: {
            health: '/health',
            services: '/api/services',
            categories: '/api/services/categories',
            register: 'POST /api/auth/register',
            login: 'POST /api/auth/login',
            tasks: 'GET /api/tasks',
            create_task: 'POST /api/tasks',
            admin_stats: 'GET /api/admin/stats',
            admin_panel: '/admin'
        }
    });
});

// Health check
app.get('/health', async (req, res) => {
    try {
        await db.get('SELECT 1 as status');
        res.json({
            success: true,
            status: 'OK',
            service: 'concierge-service',
            version: '4.2.0',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            database: 'connected',
            memory: process.memoryUsage()
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
        const now = new Date().toISOString();
        
        // Создаем пользователя
        const result = await db.run(
            `INSERT INTO users (email, password, firstName, lastName, phone, role, created_at, updated_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [email, hashedPassword, firstName, lastName, phone, role, now, now]
        );
        
        // Получаем созданного пользователя
        const user = await db.get('SELECT * FROM users WHERE id = ?', [result.lastID]);
        
        // Генерируем токен
        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                role: user.role,
                firstName: user.firstName,
                subscription: user.subscription_plan
            },
            process.env.JWT_SECRET || 'concierge-secret-key',
            { expiresIn: '30d' }
        );
        
        // Не возвращаем пароль
        delete user.password;
        
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
        
        // Обновляем последний вход
        await db.run('UPDATE users SET last_login = ? WHERE id = ?', [new Date().toISOString(), user.id]);
        
        // Генерируем токен
        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                role: user.role,
                firstName: user.firstName,
                subscription: user.subscription_plan
            },
            process.env.JWT_SECRET || 'concierge-secret-key',
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
        
        // Получаем статистику пользователя
        const stats = await db.get(`
            SELECT 
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_tasks,
                COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as active_tasks,
                SUM(CASE WHEN status = 'completed' THEN price ELSE 0 END) as total_spent
            FROM tasks 
            WHERE client_id = ?
        `, [req.user.id]);
        
        user.stats = stats || { completed_tasks: 0, active_tasks: 0, total_spent: 0 };
        
        res.json({
            success: true,
            data: { user }
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
        const { category, limit = 10, popular } = req.query;
        
        let query = 'SELECT * FROM services WHERE is_active = 1';
        const params = [];
        
        if (category && category !== 'all') {
            query += ' AND category = ?';
            params.push(category);
        }
        
        if (popular === 'true') {
            query += ' AND is_popular = 1';
        }
        
        query += ' ORDER BY display_order ASC, created_at DESC LIMIT ?';
        params.push(parseInt(limit));
        
        const services = await db.all(query, params);
        
        // Преобразуем строки в массивы
        const formattedServices = services.map(service => ({
            ...service,
            subcategories: service.subcategories ? service.subcategories.split(',') : [],
            tags: service.tags ? service.tags.split(',') : [],
            priceOptions: {
                oneTime: service.price_one_time,
                hourly: service.price_hourly
            },
            rating: {
                average: service.rating_average,
                count: service.rating_count
            }
        }));
        
        res.json({
            success: true,
            data: {
                services: formattedServices,
                count: formattedServices.length
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
app.get('/api/services/categories', (req, res) => {
    const categories = [
        { 
            id: 'home_and_household', 
            name: 'Дом и быт', 
            icon: '🏠',
            description: 'Уборка, ремонт, организация пространства'
        },
        { 
            id: 'family_and_children', 
            name: 'Дети и семья', 
            icon: '👨‍👩‍👧‍👦',
            description: 'Няни, репетиторы, семейные мероприятия'
        },
        { 
            id: 'beauty_and_health', 
            name: 'Красота и здоровье', 
            icon: '💅',
            description: 'Маникюр, косметология, фитнес-тренеры'
        },
        { 
            id: 'courses_and_education', 
            name: 'Курсы и образование', 
            icon: '🎓',
            description: 'Обучение, тренинги, мастер-классы'
        },
        { 
            id: 'pets', 
            name: 'Питомцы', 
            icon: '🐶',
            description: 'Выгул, груминг, передержка'
        },
        { 
            id: 'events_and_entertainment', 
            name: 'Мероприятия', 
            icon: '🎉',
            description: 'Организация праздников, ивенты'
        }
    ];
    
    res.json({
        success: true,
        data: categories
    });
});

// ==================== ЗАДАЧИ ====================

// Создание задачи
app.post('/api/tasks', authMiddleware(['client', 'admin', 'superadmin']), async (req, res) => {
    try {
        const { title, description, category, subcategory, deadline, price, priority, address, tags } = req.body;
        
        // Генерируем номер задачи
        const date = new Date();
        const year = date.getFullYear().toString().slice(-2);
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        
        const count = await db.get(
            'SELECT COUNT(*) as count FROM tasks WHERE DATE(created_at) = DATE(?)',
            [date.toISOString()]
        );
        
        const taskNumber = `TASK-${year}${month}${day}-${(count.count + 1).toString().padStart(4, '0')}`;
        
        // Создаем задачу
        const result = await db.run(
            `INSERT INTO tasks (task_number, title, description, client_id, category, subcategory, 
             deadline, price, priority, address, tags, created_at, updated_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [taskNumber, title, description, req.user.id, category, subcategory, 
             deadline, price, priority || 'medium', address, tags, 
             new Date().toISOString(), new Date().toISOString()]
        );
        
        // Получаем созданную задачу
        const task = await db.get('SELECT * FROM tasks WHERE id = ?', [result.lastID]);
        
        // Добавляем уведомление
        await db.run(
            `INSERT INTO notifications (user_id, type, title, message, task_id) 
             VALUES (?, ?, ?, ?, ?)`,
            [req.user.id, 'task_update', 'Задача создана', `Задача "${title}" успешно создана`, task.id]
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
        const { status, limit = 10, page = 1 } = req.query;
        const userId = req.user.id;
        const userRole = req.user.role;
        
        let query = '';
        let params = [];
        
        if (userRole === 'client') {
            query = 'SELECT * FROM tasks WHERE client_id = ?';
            params.push(userId);
        } else if (userRole === 'performer') {
            query = 'SELECT * FROM tasks WHERE performer_id = ?';
            params.push(userId);
        } else {
            // Админы видят все задачи
            query = 'SELECT * FROM tasks WHERE 1=1';
        }
        
        if (status && status !== 'all') {
            query += ' AND status = ?';
            params.push(status);
        }
        
        const offset = (parseInt(page) - 1) * parseInt(limit);
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), offset);
        
        const tasks = await db.all(query, params);
        
        // Получаем информацию о пользователях для задач
        for (let task of tasks) {
            if (task.client_id) {
                const client = await db.get('SELECT id, firstName, lastName, email, phone FROM users WHERE id = ?', [task.client_id]);
                task.client = client;
            }
            if (task.performer_id) {
                const performer = await db.get('SELECT id, firstName, lastName, email, phone, rating FROM users WHERE id = ?', [task.performer_id]);
                task.performer = performer;
            }
        }
        
        // Получаем общее количество
        const countQuery = query.split('ORDER BY')[0].replace('SELECT *', 'SELECT COUNT(*) as count');
        const countResult = await db.get(countQuery, params.slice(0, -2)); // Убираем LIMIT и OFFSET
        
        res.json({
            success: true,
            data: {
                tasks,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: countResult.count,
                    pages: Math.ceil(countResult.count / parseInt(limit))
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
        const task = await db.get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        // Проверяем доступ к задаче
        if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
            if (task.client_id !== req.user.id && 
                (!task.performer_id || task.performer_id !== req.user.id)) {
                return res.status(403).json({
                    success: false,
                    error: 'Нет доступа к этой задаче'
                });
            }
        }
        
        // Получаем информацию о пользователях
        if (task.client_id) {
            const client = await db.get('SELECT id, firstName, lastName, email, phone FROM users WHERE id = ?', [task.client_id]);
            task.client = client;
        }
        if (task.performer_id) {
            const performer = await db.get('SELECT id, firstName, lastName, email, phone, rating FROM users WHERE id = ?', [task.performer_id]);
            task.performer = performer;
        }
        
        res.json({
            success: true,
            data: { task }
        });
        
    } catch (error) {
        console.error('Ошибка получения задачи:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения задачи'
        });
    }
});

// Отмена задачи
app.post('/api/tasks/:id/cancel', authMiddleware(['client', 'admin', 'superadmin']), async (req, res) => {
    try {
        const task = await db.get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        // Проверяем что задача принадлежит пользователю
        if (task.client_id !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'superadmin') {
            return res.status(403).json({
                success: false,
                error: 'Нет прав на отмену этой задачи'
            });
        }
        
        await db.run(
            'UPDATE tasks SET status = ?, cancellation_reason = ?, updated_at = ? WHERE id = ?',
            ['cancelled', req.body.reason || 'Отменено клиентом', new Date().toISOString(), req.params.id]
        );
        
        res.json({
            success: true,
            message: 'Задача отменена',
            data: { task }
        });
        
    } catch (error) {
        console.error('Ошибка отмены задачи:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка отмены задачи'
        });
    }
});

// Возобновление задачи
app.post('/api/tasks/:id/reopen', authMiddleware(['client', 'admin', 'superadmin']), async (req, res) => {
    try {
        const task = await db.get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        if (task.client_id !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'superadmin') {
            return res.status(403).json({
                success: false,
                error: 'Нет прав на возобновление этой задачи'
            });
        }
        
        await db.run(
            'UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?',
            ['new', new Date().toISOString(), req.params.id]
        );
        
        res.json({
            success: true,
            message: 'Задача возобновлена',
            data: { task }
        });
        
    } catch (error) {
        console.error('Ошибка возобновления задачи:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка возобновления задачи'
        });
    }
});

// Завершение задачи с отзывом
app.post('/api/tasks/:id/complete', authMiddleware(['client', 'admin', 'superadmin']), async (req, res) => {
    try {
        const { rating, feedback } = req.body;
        const task = await db.get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        if (task.client_id !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'superadmin') {
            return res.status(403).json({
                success: false,
                error: 'Нет прав на завершение этой задачи'
            });
        }
        
        await db.run(
            'UPDATE tasks SET status = ?, rating = ?, feedback_text = ?, updated_at = ? WHERE id = ?',
            ['completed', rating, feedback, new Date().toISOString(), req.params.id]
        );
        
        // Обновляем рейтинг исполнителя если есть
        if (task.performer_id && rating) {
            await updatePerformerRating(task.performer_id);
        }
        
        res.json({
            success: true,
            message: 'Задача завершена',
            data: { task }
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

// Получение уведомлений
app.get('/api/notifications', authMiddleware(), async (req, res) => {
    try {
        const notifications = await db.all(
            'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
            [req.user.id]
        );
        
        const unreadCount = await db.get(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
            [req.user.id]
        );
        
        res.json({
            success: true,
            data: {
                notifications,
                unreadCount: unreadCount.count
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

// Отметка уведомлений как прочитанных
app.post('/api/notifications/read', authMiddleware(), async (req, res) => {
    try {
        const { notificationIds } = req.body;
        
        if (notificationIds && notificationIds.length > 0) {
            await db.run(
                'UPDATE notifications SET is_read = 1 WHERE id IN (?)',
                [notificationIds.join(',')]
            );
        } else {
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
        // Получаем статистику
        const [
            totalUsers,
            totalClients,
            totalPerformers,
            totalTasks,
            completedTasks,
            totalRevenue,
            newUsersThisMonth,
            newTasksThisMonth,
            categoryStats
        ] = await Promise.all([
            db.get('SELECT COUNT(*) as count FROM users'),
            db.get('SELECT COUNT(*) as count FROM users WHERE role = "client"'),
            db.get('SELECT COUNT(*) as count FROM users WHERE role = "performer"'),
            db.get('SELECT COUNT(*) as count FROM tasks'),
            db.get('SELECT COUNT(*) as count FROM tasks WHERE status = "completed"'),
            db.get('SELECT SUM(price) as total FROM tasks WHERE status = "completed"'),
            db.get('SELECT COUNT(*) as count FROM users WHERE created_at >= DATE("now", "-30 days")'),
            db.get('SELECT COUNT(*) as count FROM tasks WHERE created_at >= DATE("now", "-30 days")'),
            db.all(`
                SELECT category, COUNT(*) as count, SUM(price) as revenue 
                FROM tasks 
                GROUP BY category 
                ORDER BY count DESC
            `)
        ]);
        
        // Последние задачи
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
                    totalUsers: totalUsers.count,
                    totalClients: totalClients.count,
                    totalPerformers: totalPerformers.count,
                    totalTasks: totalTasks.count,
                    completedTasks: completedTasks.count,
                    totalRevenue: totalRevenue.total || 0,
                    newUsersThisMonth: newUsersThisMonth.count,
                    newTasksThisMonth: newTasksThisMonth.count
                },
                categories: categoryStats.map(stat => ({
                    category: stat.category,
                    name: getCategoryName(stat.category),
                    count: stat.count,
                    revenue: stat.revenue || 0
                })),
                recentTasks
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
        const { role, search, page = 1, limit = 20 } = req.query;
        
        let query = 'SELECT * FROM users WHERE 1=1';
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
        
        const offset = (parseInt(page) - 1) * parseInt(limit);
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), offset);
        
        const users = await db.all(query, params);
        
        // Не возвращаем пароли
        users.forEach(user => delete user.password);
        
        // Получаем общее количество
        const countQuery = query.split('ORDER BY')[0].replace('SELECT *', 'SELECT COUNT(*) as count');
        const countResult = await db.get(countQuery, params.slice(0, -2));
        
        res.json({
            success: true,
            data: {
                users,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: countResult.count,
                    pages: Math.ceil(countResult.count / parseInt(limit))
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
        const { status, category, page = 1, limit = 20 } = req.query;
        
        let query = 'SELECT * FROM tasks WHERE 1=1';
        const params = [];
        
        if (status && status !== 'all') {
            query += ' AND status = ?';
            params.push(status);
        }
        
        if (category && category !== 'all') {
            query += ' AND category = ?';
            params.push(category);
        }
        
        const offset = (parseInt(page) - 1) * parseInt(limit);
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), offset);
        
        const tasks = await db.all(query, params);
        
        // Получаем информацию о пользователях
        for (let task of tasks) {
            if (task.client_id) {
                const client = await db.get('SELECT id, firstName, lastName, email FROM users WHERE id = ?', [task.client_id]);
                task.client = client;
            }
            if (task.performer_id) {
                const performer = await db.get('SELECT id, firstName, lastName, email FROM users WHERE id = ?', [task.performer_id]);
                task.performer = performer;
            }
        }
        
        // Получаем общее количество
        const countQuery = query.split('ORDER BY')[0].replace('SELECT *', 'SELECT COUNT(*) as count');
        const countResult = await db.get(countQuery, params.slice(0, -2));
        
        res.json({
            success: true,
            data: {
                tasks,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: countResult.count,
                    pages: Math.ceil(countResult.count / parseInt(limit))
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

// HTML админ-панель
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/admin.html'));
});

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

async function updatePerformerRating(performerId) {
    try {
        const tasks = await db.all(
            'SELECT rating FROM tasks WHERE performer_id = ? AND rating IS NOT NULL AND rating > 0',
            [performerId]
        );
        
        if (tasks.length > 0) {
            const averageRating = tasks.reduce((sum, task) => sum + task.rating, 0) / tasks.length;
            
            await db.run(
                'UPDATE users SET rating = ? WHERE id = ?',
                [Math.round(averageRating * 10) / 10, performerId]
            );
        }
    } catch (error) {
        console.error('Ошибка обновления рейтинга исполнителя:', error);
    }
}

function getCategoryName(categoryId) {
    const categories = {
        'home_and_household': 'Дом и быт',
        'family_and_children': 'Дети и семья',
        'beauty_and_health': 'Красота и здоровье',
        'courses_and_education': 'Курсы и образование',
        'pets': 'Питомцы',
        'events_and_entertainment': 'Мероприятия',
        'other': 'Другое'
    };
    return categories[categoryId] || categoryId;
}

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎀 ЗАПУСК ЖЕНСКОГО КОНСЬЕРЖ СЕРВИСА v4.2.0');
        console.log('='.repeat(80));
        console.log(`🔧 Режим: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🌐 PORT: ${process.env.PORT || 3000}`);
        console.log(`🗄️  База данных: SQLite (встроенная)`);
        
        // Инициализируем базу данных
        await initDatabase();
        console.log('✅ База данных готова');
        
        const PORT = process.env.PORT || 3000;
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`✅ Сервер запущен на порту ${PORT}`);
            console.log(`🌐 http://localhost:${PORT}`);
            console.log(`🎛️  Админ-панель: http://localhost:${PORT}/admin`);
            console.log(`📊 Health: http://localhost:${PORT}/health`);
            console.log(`📋 Услуги: http://localhost:${PORT}/api/services`);
            console.log('='.repeat(80));
            console.log('🎀 ПРИЛОЖЕНИЕ ГОТОВО К РАБОТЕ!');
            console.log('='.repeat(80));
            
            console.log('\n🔑 Тестовые аккаунты для входа:');
            console.log('👑 Суперадмин: superadmin@concierge.com / admin123');
            console.log('👩‍💼 Админ: admin@concierge.com / admin123');
            console.log('👩 Клиент: maria@example.com / client123');
            console.log('👨‍🏫 Исполнитель: elena@performer.com / performer123');
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error);
        process.exit(1);
    }
};

// Обработка сигналов
process.on('SIGTERM', () => {
    console.log('Получен SIGTERM, завершение работы...');
    if (db) db.close();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('Получен SIGINT, завершение работы...');
    if (db) db.close();
    process.exit(0);
});

// Запуск
startServer();
