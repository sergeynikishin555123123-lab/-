require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

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
        // Используем базу в памяти для простоты
        db = await open({
            filename: ':memory:',
            driver: sqlite3.Database
        });

        console.log('✅ База данных SQLite создана');

        // Создание таблиц
        await db.exec(`
            CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                firstName TEXT NOT NULL,
                lastName TEXT NOT NULL,
                phone TEXT,
                role TEXT DEFAULT 'client',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_number TEXT,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                client_id INTEGER NOT NULL,
                category TEXT NOT NULL,
                status TEXT DEFAULT 'new',
                price REAL NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE services (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                category TEXT NOT NULL,
                price_one_time REAL,
                is_active INTEGER DEFAULT 1,
                is_popular INTEGER DEFAULT 0
            );
        `);

        console.log('✅ Таблицы созданы');
        
        // Создаем тестовые данные
        await createTestData();
        
        return db;
    } catch (error) {
        console.error('❌ Ошибка инициализации базы данных:', error);
        throw error;
    }
};

// ==================== СОЗДАНИЕ ТЕСТОВЫХ ДАННЫХ ====================
const createTestData = async () => {
    try {
        console.log('📝 Создание тестовых данных...');
        
        // Тестовые пользователи
        const users = [
            ['superadmin@concierge.com', await bcrypt.hash('admin123', 10), 'Супер', 'Администратор', '+79999999999', 'superadmin'],
            ['admin@concierge.com', await bcrypt.hash('admin123', 10), 'Анна', 'Администратор', '+79998887766', 'admin'],
            ['maria@example.com', await bcrypt.hash('client123', 10), 'Мария', 'Иванова', '+79997776655', 'client'],
            ['elena@performer.com', await bcrypt.hash('performer123', 10), 'Елена', 'Смирнова', '+79994443322', 'performer']
        ];

        for (const user of users) {
            await db.run(
                `INSERT INTO users (email, password, firstName, lastName, phone, role) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                user
            );
        }

        console.log(`✅ Создано ${users.length} тестовых пользователей`);

        // Тестовые услуги
        const services = [
            ['Помощь с уборкой', 'Помогу навести порядок в квартире', 'home_and_household', 2500, 1, 1],
            ['Присмотр за детьми', 'Посижу с вашим ребенком', 'family_and_children', 1500, 1, 1],
            ['Помощь с маникюром', 'Сделаю аккуратный маникюр', 'beauty_and_health', 1800, 1, 1],
            ['Репетитор по английскому', 'Помогу с английским языком', 'courses_and_education', 1000, 1, 0],
            ['Выгул питомцев', 'Выгуляю собаку, покормлю кошку', 'pets', 800, 1, 0],
            ['Организация праздников', 'Помогу организовать праздник', 'events_and_entertainment', 4000, 1, 1]
        ];

        for (const service of services) {
            await db.run(
                `INSERT INTO services (name, description, category, price_one_time, is_active, is_popular) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                service
            );
        }

        console.log(`✅ Создано ${services.length} тестовых услуг`);
        
    } catch (error) {
        console.error('⚠️  Ошибка создания тестовых данных:', error.message);
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

// ==================== API МАРШРУТЫ ====================

// Главная страница
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: '🎀 Добро пожаловать в Консьерж Сервис',
        version: '4.2.2',
        status: '🟢 Работает'
    });
});

// Health check
app.get('/health', async (req, res) => {
    try {
        await db.get('SELECT 1 as status');
        res.json({
            success: true,
            status: 'OK',
            timestamp: new Date().toISOString()
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
        
        // Создаем пользователя
        const result = await db.run(
            `INSERT INTO users (email, password, firstName, lastName, phone, role) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [email, hashedPassword, firstName, lastName, phone, role]
        );
        
        // Получаем созданного пользователя
        const user = await db.get('SELECT * FROM users WHERE id = ?', [result.lastID]);
        
        // Генерируем токен
        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                role: user.role,
                firstName: user.firstName
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
        
        // Генерируем токен
        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                role: user.role,
                firstName: user.firstName
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
        const { category, limit = 10 } = req.query;
        
        let query = 'SELECT * FROM services WHERE is_active = 1';
        const params = [];
        
        if (category && category !== 'all') {
            query += ' AND category = ?';
            params.push(category);
        }
        
        query += ' LIMIT ?';
        params.push(parseInt(limit));
        
        const services = await db.all(query, params);
        
        res.json({
            success: true,
            data: {
                services,
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
        const { title, description, category, deadline, price } = req.body;
        
        // Генерируем номер задачи
        const date = new Date();
        const year = date.getFullYear().toString().slice(-2);
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        
        const taskNumber = `TASK-${year}${month}${day}-001`;
        
        // Создаем задачу
        const result = await db.run(
            `INSERT INTO tasks (task_number, title, description, client_id, category, price) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [taskNumber, title, description, req.user.id, category, price]
        );
        
        // Получаем созданную задачу
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
        const { status, limit = 10 } = req.query;
        const userId = req.user.id;
        const userRole = req.user.role;
        
        let query = 'SELECT * FROM tasks WHERE client_id = ?';
        const params = [userId];
        
        if (status && status !== 'all') {
            query += ' AND status = ?';
            params.push(status);
        }
        
        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(parseInt(limit));
        
        const tasks = await db.all(query, params);
        
        res.json({
            success: true,
            data: {
                tasks,
                count: tasks.length
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
        const [totalUsers, totalTasks, totalRevenue] = await Promise.all([
            db.get('SELECT COUNT(*) as count FROM users'),
            db.get('SELECT COUNT(*) as count FROM tasks'),
            db.get('SELECT SUM(price) as total FROM tasks WHERE status = "completed"')
        ]);

        const recentTasks = await db.all(`
            SELECT t.*, u.firstName, u.lastName 
            FROM tasks t 
            LEFT JOIN users u ON t.client_id = u.id 
            ORDER BY t.created_at DESC 
            LIMIT 5
        `);
        
        res.json({
            success: true,
            data: {
                summary: {
                    totalUsers: totalUsers.count || 0,
                    totalTasks: totalTasks.count || 0,
                    totalRevenue: totalRevenue.total || 0
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

// Получение всех пользователей (админ)
app.get('/api/admin/users', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const users = await db.all('SELECT * FROM users ORDER BY created_at DESC');
        
        // Не возвращаем пароли
        users.forEach(user => delete user.password);
        
        res.json({
            success: true,
            data: {
                users,
                count: users.length
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

// HTML админ-панель
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/admin.html'));
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎀 ЗАПУСК КОНСЬЕРЖ СЕРВИСА v4.2.2');
        console.log('='.repeat(80));
        console.log(`🌐 PORT: ${process.env.PORT || 3000}`);
        
        // Инициализируем базу данных
        await initDatabase();
        console.log('✅ База данных готова');
        
        const PORT = process.env.PORT || 3000;
        
        app.listen(PORT, () => {
            console.log(`✅ Сервер запущен на порту ${PORT}`);
            console.log(`🌐 http://localhost:${PORT}`);
            console.log(`🎛️  Админ-панель: http://localhost:${PORT}/admin`);
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

// Запуск
startServer();
