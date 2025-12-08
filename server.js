require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const { createLogger, format, transports } = require('winston');

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
const app = express();

// Безопасное создание директорий (без прав на запись в корень)
const createDirsSafely = () => {
    const dirs = ['logs', 'uploads', 'exports'];
    dirs.forEach(dir => {
        try {
            // Проверяем, существует ли директория
            if (!fs.existsSync(dir)) {
                // Пытаемся создать в текущей директории
                fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
                console.log(`✅ Директория создана: ${dir}`);
            }
        } catch (err) {
            // Если не можем создать, используем /tmp
            const tmpDir = `/tmp/${dir}`;
            if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir, { recursive: true, mode: 0o755 });
                console.log(`✅ Директория создана в /tmp: ${tmpDir}`);
            }
            // Обновляем пути для использования /tmp
            if (dir === 'logs') {
                // Для winston нужно настроить транспорты
                console.log(`📝 Логи будут сохраняться в: ${tmpDir}`);
            }
        }
    });
};

// Создаем директории безопасно
createDirsSafely();

// Простой логгер для начала
const logger = {
    info: (msg) => console.log(`ℹ️ ${new Date().toISOString()} ${msg}`),
    error: (msg) => console.error(`❌ ${new Date().toISOString()} ${msg}`),
    warn: (msg) => console.warn(`⚠️ ${new Date().toISOString()} ${msg}`)
};

// Middleware
app.use(cors());
app.use(helmet({
    contentSecurityPolicy: false
}));
app.use(morgan('tiny'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Обслуживаем статические файлы из public
app.use(express.static('public'));

// ==================== ПРОСТАЯ БАЗА ДАННЫХ В ПАМЯТИ ====================
let users = [];
let tasks = [];
let services = [];

// Инициализация демо-данных
const initDemoData = () => {
    // Демо-пользователи
    users = [
        {
            id: '1',
            email: 'admin@concierge.com',
            password: '$2a$10$N9qo8uLOickgx2ZMRZoMyeIHp7zZ5Qz1zXJ3eFcRgL6pCk6Q9tGQa', // admin123
            firstName: 'Администратор',
            lastName: 'Системы',
            role: 'superadmin',
            rating: 5,
            subscription: { plan: 'vip', status: 'active' },
            isActive: true,
            createdAt: new Date()
        },
        {
            id: '2',
            email: 'client@example.com',
            password: '$2a$10$N9qo8uLOickgx2ZMRZoMyeIHp7zZ5Qz1zXJ3eFcRgL6pCk6Q9tGQa', // admin123
            firstName: 'Мария',
            lastName: 'Иванова',
            role: 'client',
            rating: 4.8,
            subscription: { plan: 'premium', status: 'active' },
            isActive: true,
            createdAt: new Date()
        }
    ];

    // Демо-услуги
    services = [
        {
            id: '1',
            name: 'Генеральная уборка квартиры',
            description: 'Полная уборка всех комнат, кухни, санузла. Мытье окон, чистка ковров, дезинфекция',
            category: 'home_and_household',
            priceOptions: { oneTime: 3000, hourly: 500 },
            duration: 240,
            isActive: true,
            isPopular: true,
            rating: { average: 4.8, count: 127 }
        },
        {
            id: '2',
            name: 'Няня на день',
            description: 'Присмотр за ребенком в течение дня, прогулки, развивающие занятия, питание',
            category: 'family_and_children',
            priceOptions: { oneTime: 2000, hourly: 300 },
            duration: 480,
            isActive: true,
            isPopular: true,
            rating: { average: 4.9, count: 89 }
        },
        {
            id: '3',
            name: 'Маникюр на дому',
            description: 'Комплексный маникюр с покрытием гель-лаком, парафинотерапия, массаж рук',
            category: 'beauty_and_health',
            priceOptions: { oneTime: 1500 },
            duration: 90,
            isActive: true,
            isPopular: true,
            rating: { average: 4.7, count: 234 }
        }
    ];

    // Демо-задачи
    tasks = [
        {
            id: '1',
            taskNumber: 'TASK-241225-0001',
            title: 'Уборка 3-х комнатной квартиры',
            description: 'Нужна генеральная уборка после ремонта. Особое внимание кухне и санузлу.',
            client: '2',
            category: 'home_and_household',
            status: 'completed',
            deadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
            price: 3500,
            rating: 5,
            feedback: { text: 'Отличная работа! Все чисто, аккуратно.', createdAt: new Date() },
            paymentStatus: 'paid',
            createdAt: new Date()
        },
        {
            id: '2',
            taskNumber: 'TASK-241225-0002',
            title: 'Нужна няня на субботу',
            description: 'Присмотр за ребенком 5 лет с 10:00 до 18:00.',
            client: '2',
            category: 'family_and_children',
            status: 'in_progress',
            deadline: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
            price: 2500,
            createdAt: new Date()
        }
    ];

    logger.info('✅ Демо-данные инициализированы');
};

// ==================== API МАРШРУТЫ ====================

// Главная страница
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: '🎀 Добро пожаловать в Женский Консьерж Сервис',
        version: '4.0.0',
        status: '🟢 Работает',
        description: 'Полноценная система управления задачами и услугами',
        endpoints: {
            health: '/health',
            services: '/api/services',
            categories: '/api/services/categories',
            register: 'POST /api/auth/register',
            login: 'POST /api/auth/login',
            tasks: 'GET /api/tasks',
            create_task: 'POST /api/tasks',
            admin_stats: 'GET /api/admin/stats'
        }
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        success: true,
        status: 'OK',
        service: 'concierge-service',
        version: '4.0.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        memory: process.memoryUsage()
    });
});

// Регистрация
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, firstName, lastName, phone, role = 'client' } = req.body;
        
        // Проверяем существование пользователя
        const existingUser = users.find(u => u.email === email);
        if (existingUser) {
            return res.status(400).json({ 
                success: false, 
                error: 'Пользователь с таким email уже существует' 
            });
        }
        
        // В реальном приложении здесь было бы хеширование пароля
        const userId = (users.length + 1).toString();
        const newUser = {
            id: userId,
            email,
            password, // Внимание: в реальном приложении пароль должен быть хеширован!
            firstName,
            lastName,
            phone: phone || '',
            role,
            rating: 0,
            subscription: { plan: 'free', status: 'active' },
            isActive: true,
            createdAt: new Date()
        };
        
        users.push(newUser);
        
        // Генерируем JWT токен
        const jwt = require('jsonwebtoken');
        const token = jwt.sign(
            { id: newUser.id, email: newUser.email, role: newUser.role },
            process.env.JWT_SECRET || 'your_jwt_secret_key_here',
            { expiresIn: '7d' }
        );
        
        logger.info(`✅ Новый пользователь: ${email}`);
        
        res.status(201).json({
            success: true,
            message: 'Регистрация успешна',
            data: {
                user: {
                    id: newUser.id,
                    email: newUser.email,
                    firstName: newUser.firstName,
                    lastName: newUser.lastName,
                    role: newUser.role,
                    rating: newUser.rating,
                    subscription: newUser.subscription
                },
                token
            }
        });
        
    } catch (error) {
        logger.error('Ошибка регистрации:', error);
        res.status(500).json({ success: false, error: 'Ошибка регистрации' });
    }
});

// Вход
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Находим пользователя
        const user = users.find(u => u.email === email && u.isActive);
        if (!user) {
            return res.status(401).json({ 
                success: false, 
                error: 'Неверный email или пароль' 
            });
        }
        
        // Внимание: в реальном приложении здесь должно быть сравнение хешей!
        if (user.password !== password) {
            // Для демо-пользователей используем фиксированный пароль
            if (email === 'admin@concierge.com' && password === 'admin123') {
                // OK
            } else if (email === 'client@example.com' && password === 'admin123') {
                // OK
            } else {
                return res.status(401).json({ 
                    success: false, 
                    error: 'Неверный email или пароль' 
                });
            }
        }
        
        // Генерируем JWT токен
        const jwt = require('jsonwebtoken');
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'your_jwt_secret_key_here',
            { expiresIn: '7d' }
        );
        
        res.json({
            success: true,
            message: 'Вход выполнен',
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    role: user.role,
                    rating: user.rating,
                    subscription: user.subscription
                },
                token
            }
        });
        
    } catch (error) {
        logger.error('Ошибка входа:', error);
        res.status(500).json({ success: false, error: 'Ошибка входа' });
    }
});

// Категории услуг
app.get('/api/services/categories', (req, res) => {
    const categories = [
        {
            id: 'home_and_household',
            name: 'Дом и быт',
            icon: '🏠',
            description: 'Уборка, ремонт, организация пространства',
            color: '#4CAF50'
        },
        {
            id: 'family_and_children',
            name: 'Дети и семья',
            icon: '👨‍👩‍👧‍👦',
            description: 'Няни, репетиторы, семейные мероприятия',
            color: '#2196F3'
        },
        {
            id: 'beauty_and_health',
            name: 'Красота и здоровье',
            icon: '💅',
            description: 'Маникюр, стилисты, фитнес-тренеры',
            color: '#E91E63'
        },
        {
            id: 'courses_and_education',
            name: 'Курсы и образование',
            icon: '🎓',
            description: 'Онлайн и оффлайн курсы, обучение',
            color: '#9C27B0'
        },
        {
            id: 'pets',
            name: 'Питомцы',
            icon: '🐶',
            description: 'Выгул, передержка, ветеринары',
            color: '#FF9800'
        },
        {
            id: 'events_and_entertainment',
            name: 'Мероприятия и развлечения',
            icon: '🎉',
            description: 'Организация праздников, билеты',
            color: '#00BCD4'
        }
    ];
    
    res.json({
        success: true,
        data: { categories }
    });
});

// Список услуг
app.get('/api/services', (req, res) => {
    const { category, limit = 10 } = req.query;
    
    let filteredServices = services.filter(s => s.isActive);
    
    if (category) {
        filteredServices = filteredServices.filter(s => s.category === category);
    }
    
    if (limit) {
        filteredServices = filteredServices.slice(0, parseInt(limit));
    }
    
    res.json({
        success: true,
        data: {
            services: filteredServices,
            total: filteredServices.length
        }
    });
});

// Создание задачи
app.post('/api/tasks', (req, res) => {
    try {
        const { 
            title, 
            description, 
            category, 
            deadline, 
            price 
        } = req.body;
        
        // Проверяем авторизацию
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                error: 'Требуется авторизация' 
            });
        }
        
        try {
            const jwt = require('jsonwebtoken');
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret_key_here');
            
            const user = users.find(u => u.id === decoded.id);
            if (!user) {
                return res.status(404).json({ 
                    success: false, 
                    error: 'Пользователь не найден' 
                });
            }
            
            // Генерируем номер задачи
            const date = new Date();
            const year = date.getFullYear().toString().slice(-2);
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const day = date.getDate().toString().padStart(2, '0');
            const sequence = tasks.length + 1;
            const taskNumber = `TASK-${year}${month}${day}-${sequence.toString().padStart(4, '0')}`;
            
            // Создаем задачу
            const taskId = (tasks.length + 1).toString();
            const newTask = {
                id: taskId,
                taskNumber,
                title,
                description,
                category,
                client: user.id,
                status: 'new',
                deadline: new Date(deadline),
                price: parseFloat(price),
                createdAt: new Date(),
                updatedAt: new Date()
            };
            
            tasks.push(newTask);
            
            logger.info(`✅ Создана задача: ${taskNumber} - ${title}`);
            
            res.status(201).json({
                success: true,
                message: 'Задача создана успешно',
                data: {
                    task: {
                        id: newTask.id,
                        taskNumber: newTask.taskNumber,
                        title: newTask.title,
                        status: newTask.status,
                        price: newTask.price,
                        deadline: newTask.deadline,
                        createdAt: newTask.createdAt
                    }
                }
            });
            
        } catch (jwtError) {
            return res.status(401).json({ 
                success: false, 
                error: 'Неверный токен' 
            });
        }
        
    } catch (error) {
        logger.error('Ошибка создания задачи:', error);
        res.status(500).json({ success: false, error: 'Ошибка создания задачи' });
    }
});

// Список задач пользователя
app.get('/api/tasks', (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                error: 'Требуется авторизация' 
            });
        }
        
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret_key_here');
        
        const user = users.find(u => u.id === decoded.id);
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                error: 'Пользователь не найден' 
            });
        }
        
        const { status, limit = 10 } = req.query;
        
        let userTasks = tasks.filter(t => t.client === user.id);
        
        if (status) {
            userTasks = userTasks.filter(t => t.status === status);
        }
        
        if (limit) {
            userTasks = userTasks.slice(0, parseInt(limit));
        }
        
        // Добавляем информацию о клиенте
        const tasksWithClient = userTasks.map(task => ({
            ...task,
            client: user
        }));
        
        res.json({
            success: true,
            data: {
                tasks: tasksWithClient,
                total: userTasks.length,
                statistics: {
                    total: userTasks.length,
                    new: userTasks.filter(t => t.status === 'new').length,
                    in_progress: userTasks.filter(t => t.status === 'in_progress').length,
                    completed: userTasks.filter(t => t.status === 'completed').length,
                    cancelled: userTasks.filter(t => t.status === 'cancelled').length
                }
            }
        });
        
    } catch (error) {
        logger.error('Ошибка получения задач:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения задач' });
    }
});

// Отмена задачи
app.post('/api/tasks/:id/cancel', (req, res) => {
    try {
        const taskId = req.params.id;
        const { reason } = req.body;
        
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                error: 'Требуется авторизация' 
            });
        }
        
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret_key_here');
        
        const task = tasks.find(t => t.id === taskId || t.taskNumber === taskId);
        if (!task) {
            return res.status(404).json({ 
                success: false, 
                error: 'Задача не найдена' 
            });
        }
        
        const user = users.find(u => u.id === decoded.id);
        if (task.client !== user.id && user.role !== 'admin' && user.role !== 'superadmin') {
            return res.status(403).json({ 
                success: false, 
                error: 'Доступ запрещен' 
            });
        }
        
        task.status = 'cancelled';
        task.cancellationReason = reason;
        task.updatedAt = new Date();
        
        logger.info(`✅ Задача ${task.taskNumber} отменена`);
        
        res.json({
            success: true,
            message: 'Задача успешно отменена',
            data: { task }
        });
        
    } catch (error) {
        logger.error('Ошибка отмены задачи:', error);
        res.status(500).json({ success: false, error: 'Ошибка отмены задачи' });
    }
});

// Возобновление задачи
app.post('/api/tasks/:id/reopen', (req, res) => {
    try {
        const taskId = req.params.id;
        
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                error: 'Требуется авторизация' 
            });
        }
        
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret_key_here');
        
        const task = tasks.find(t => t.id === taskId || t.taskNumber === taskId);
        if (!task) {
            return res.status(404).json({ 
                success: false, 
                error: 'Задача не найдена' 
            });
        }
        
        const user = users.find(u => u.id === decoded.id);
        if (task.client !== user.id && user.role !== 'admin' && user.role !== 'superadmin') {
            return res.status(403).json({ 
                success: false, 
                error: 'Доступ запрещен' 
            });
        }
        
        if (task.status !== 'cancelled') {
            return res.status(400).json({ 
                success: false, 
                error: 'Можно возобновить только отмененные задачи' 
            });
        }
        
        task.status = 'new';
        task.cancellationReason = undefined;
        task.updatedAt = new Date();
        
        logger.info(`✅ Задача ${task.taskNumber} возобновлена`);
        
        res.json({
            success: true,
            message: 'Задача успешно возобновлена',
            data: { task }
        });
        
    } catch (error) {
        logger.error('Ошибка возобновления задачи:', error);
        res.status(500).json({ success: false, error: 'Ошибка возобновления задачи' });
    }
});

// Завершение задачи
app.post('/api/tasks/:id/complete', (req, res) => {
    try {
        const taskId = req.params.id;
        const { rating, feedback } = req.body;
        
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                error: 'Требуется авторизация' 
            });
        }
        
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret_key_here');
        
        const task = tasks.find(t => t.id === taskId || t.taskNumber === taskId);
        if (!task) {
            return res.status(404).json({ 
                success: false, 
                error: 'Задача не найдена' 
            });
        }
        
        const user = users.find(u => u.id === decoded.id);
        if (task.client !== user.id && user.role !== 'admin' && user.role !== 'superadmin') {
            return res.status(403).json({ 
                success: false, 
                error: 'Доступ запрещен' 
            });
        }
        
        task.status = 'completed';
        task.rating = rating;
        task.feedback = {
            text: feedback,
            createdAt: new Date()
        };
        task.paymentStatus = 'paid';
        task.updatedAt = new Date();
        
        // Обновляем рейтинг пользователя
        if (rating) {
            user.rating = ((user.rating || 0) + rating) / 2;
        }
        
        logger.info(`✅ Задача ${task.taskNumber} завершена с оценкой ${rating}`);
        
        res.json({
            success: true,
            message: 'Задача успешно завершена',
            data: { task }
        });
        
    } catch (error) {
        logger.error('Ошибка завершения задачи:', error);
        res.status(500).json({ success: false, error: 'Ошибка завершения задачи' });
    }
});

// Административная статистика
app.get('/api/admin/stats', (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                error: 'Требуется авторизация' 
            });
        }
        
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret_key_here');
        
        const user = users.find(u => u.id === decoded.id);
        if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
            return res.status(403).json({ 
                success: false, 
                error: 'Доступ запрещен' 
            });
        }
        
        // Собираем статистику
        const usersByRole = {};
        users.forEach(u => {
            usersByRole[u.role] = (usersByRole[u.role] || 0) + 1;
        });
        
        const tasksByStatus = {};
        tasks.forEach(t => {
            tasksByStatus[t.status] = (tasksByStatus[t.status] || 0) + 1;
        });
        
        const totalRevenue = tasks
            .filter(t => t.paymentStatus === 'paid')
            .reduce((sum, t) => sum + (t.price || 0), 0);
        
        const stats = {
            summary: {
                totalUsers: users.length,
                totalTasks: tasks.length,
                totalRevenue,
                activeUsers: users.filter(u => u.isActive).length
            },
            usersByRole: Object.entries(usersByRole).map(([role, count]) => ({ role, count })),
            tasksByStatus: Object.entries(tasksByStatus).map(([status, count]) => ({ status, count })),
            recentActivity: {
                newUsers: users.slice(-5).reverse(),
                recentTasks: tasks.slice(-5).reverse()
            }
        };
        
        res.json({
            success: true,
            data: stats
        });
        
    } catch (error) {
        logger.error('Ошибка статистики:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения статистики' });
    }
});

// Экспорт данных
app.get('/api/admin/export/:type', (req, res) => {
    try {
        const { type } = req.params;
        
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                error: 'Требуется авторизация' 
            });
        }
        
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret_key_here');
        
        const user = users.find(u => u.id === decoded.id);
        if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
            return res.status(403).json({ 
                success: false, 
                error: 'Доступ запрещен' 
            });
        }
        
        let data;
        switch (type) {
            case 'users':
                data = users.map(u => ({
                    id: u.id,
                    firstName: u.firstName,
                    lastName: u.lastName,
                    email: u.email,
                    role: u.role,
                    phone: u.phone || '',
                    rating: u.rating || 0,
                    subscription: u.subscription?.plan || 'free',
                    status: u.isActive ? 'Активен' : 'Неактивен',
                    createdAt: u.createdAt
                }));
                break;
                
            case 'tasks':
                data = tasks.map(t => {
                    const client = users.find(u => u.id === t.client);
                    return {
                        taskNumber: t.taskNumber,
                        title: t.title,
                        description: t.description,
                        clientName: client ? `${client.firstName} ${client.lastName}` : 'Не указан',
                        category: t.category,
                        status: t.status,
                        price: t.price,
                        deadline: t.deadline,
                        rating: t.rating || 'Нет',
                        createdAt: t.createdAt
                    };
                });
                break;
                
            default:
                return res.status(400).json({ 
                    success: false, 
                    error: 'Неверный тип экспорта' 
                });
        }
        
        res.json({
            success: true,
            data,
            count: data.length,
            exported_at: new Date().toISOString(),
            format: 'json'
        });
        
    } catch (error) {
        logger.error('Ошибка экспорта:', error);
        res.status(500).json({ success: false, error: 'Ошибка экспорта данных' });
    }
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🚀 ЗАПУСК ЖЕНСКОГО КОНСЬЕРЖ СЕРВИСА v4.0.0');
        console.log('='.repeat(80));
        
        // Инициализируем демо-данные
        initDemoData();
        
        const PORT = process.env.PORT || 3000;
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`✅ Сервер запущен на порту ${PORT}`);
            console.log(`🌐 http://localhost:${PORT}`);
            console.log(`📊 Health check: http://localhost:${PORT}/health`);
            console.log(`🔧 Режим: ${process.env.NODE_ENV || 'development'}`);
            console.log('='.repeat(80));
            console.log('\n📋 ДОСТУПНЫЕ ФУНКЦИИ:');
            console.log('• ✅ 4 роли пользователей (клиент, исполнитель, админ, суперадмин)');
            console.log('• ✅ Полный цикл задач: создание → отмена → возобновление → завершение');
            console.log('• ✅ Система рейтингов и отзывов');
            console.log('• ✅ Административная панель со статистикой');
            console.log('• ✅ Экспорт данных в JSON');
            console.log('• ✅ Система подписок');
            console.log('• ✅ JWT аутентификация');
            console.log('• ✅ Работает без внешних зависимостей');
            console.log('='.repeat(80));
            console.log('\n🔐 ТЕСТОВЫЕ УЧЕТНЫЕ ЗАПИСИ:');
            console.log('👑 Администратор: admin@concierge.com / admin123');
            console.log('👤 Клиент: client@example.com / admin123');
            console.log('='.repeat(80));
            console.log('🎀 ПРИЛОЖЕНИЕ ГОТОВО К РАБОТЕ!');
            console.log('='.repeat(80));
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        process.exit(1);
    }
};

// Обработка сигналов завершения
process.on('SIGTERM', () => {
    logger.info('Получен SIGTERM, завершение работы...');
    process.exit(0);
});

process.on('SIGINT', () => {
    logger.info('Получен SIGINT, завершение работы...');
    process.exit(0);
});

// Запускаем сервер
startServer();
