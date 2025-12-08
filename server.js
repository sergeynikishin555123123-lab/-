require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createLogger, format, transports } = require('winston');

// ==================== БЕЗОПАСНОЕ СОЗДАНИЕ ДИРЕКТОРИЙ ====================
const ensureDirectories = () => {
    const dirs = ['logs', 'uploads', 'exports', 'public'];
    
    dirs.forEach(dir => {
        try {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`✅ Директория создана: ${dir}`);
            }
        } catch (err) {
            if (err.code === 'EACCES') {
                const tmpDir = `/tmp/concierge-app/${dir}`;
                if (!fs.existsSync(tmpDir)) {
                    fs.mkdirSync(tmpDir, { recursive: true });
                    console.log(`✅ Директория создана в /tmp: ${tmpDir}`);
                }
            } else {
                console.warn(`⚠️  Не удалось создать директорию ${dir}: ${err.message}`);
            }
        }
    });
};

ensureDirectories();

// ==================== НАСТРОЙКА ЛОГГЕРА ====================
const logDir = fs.existsSync('logs') ? 'logs' : '/tmp/concierge-app/logs';

const logger = createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.errors({ stack: true }),
        format.splat(),
        format.json()
    ),
    transports: [
        new transports.File({ 
            filename: path.join(logDir, 'error.log'), 
            level: 'error' 
        }),
        new transports.File({ 
            filename: path.join(logDir, 'combined.log') 
        })
    ]
});

if (process.env.NODE_ENV !== 'production') {
    logger.add(new transports.Console({
        format: format.combine(
            format.colorize(),
            format.simple()
        )
    }));
}

// ==================== ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ ====================
const app = express();

// Middleware
app.use(cors());
app.use(helmet({
    contentSecurityPolicy: false
}));
app.use(morgan('combined', { 
    stream: { 
        write: message => logger.info(message.trim()) 
    } 
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// ==================== JWT МИДЛВАР ====================
const authMiddleware = (roles = []) => {
    return (req, res, next) => {
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

// ==================== ПОДКЛЮЧЕНИЕ К MONGODB ====================
const connectDB = async () => {
    try {
        // Используем локальную MongoDB если нет URI в переменных окружения
        const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/concierge_db';
        
        await mongoose.connect(mongoURI, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            maxPoolSize: 10
        });
        
        logger.info(`✅ MongoDB подключена: ${mongoose.connection.host}`);
        console.log(`✅ MongoDB подключена: ${mongoose.connection.host}`);
        
        return true;
    } catch (error) {
        logger.error(`❌ Ошибка подключения к MongoDB: ${error.message}`);
        console.error(`❌ Ошибка подключения к MongoDB: ${error.message}`);
        
        // В режиме разработки создаем временную базу в памяти
        if (process.env.NODE_ENV === 'development') {
            console.log('⚠️  Создаем временную базу данных в памяти');
            const { MongoMemoryServer } = require('mongodb-memory-server');
            const mongod = await MongoMemoryServer.create();
            const uri = mongod.getUri();
            await mongoose.connect(uri);
            console.log('✅ Используется временная база данных в памяти');
            return true;
        }
        return false;
    }
};

// ==================== МОДЕЛИ MONGODB ====================
const UserSchema = new mongoose.Schema({
    email: { 
        type: String, 
        required: true, 
        unique: true,
        lowercase: true,
        trim: true
    },
    password: { 
        type: String, 
        required: true,
        select: false
    },
    firstName: { 
        type: String, 
        required: true,
        trim: true
    },
    lastName: { 
        type: String, 
        required: true,
        trim: true
    },
    phone: {
        type: String,
        trim: true
    },
    role: { 
        type: String, 
        enum: ['client', 'performer', 'admin', 'superadmin'], 
        default: 'client' 
    },
    avatar: {
        type: String,
        default: 'default-avatar.png'
    },
    rating: { 
        type: Number, 
        default: 0,
        min: 0,
        max: 5
    },
    subscription: {
        plan: { 
            type: String, 
            enum: ['free', 'basic', 'premium', 'vip'], 
            default: 'free' 
        },
        status: { 
            type: String, 
            enum: ['active', 'expired', 'cancelled', 'pending'], 
            default: 'active' 
        },
        startDate: { 
            type: Date, 
            default: Date.now 
        },
        endDate: { 
            type: Date,
            default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
    },
    notifications: [{
        type: { 
            type: String, 
            enum: ['task_update', 'new_message', 'system', 'payment'],
            required: true
        },
        title: { type: String, required: true },
        message: { type: String, required: true },
        taskId: mongoose.Schema.Types.ObjectId,
        read: { type: Boolean, default: false },
        createdAt: { type: Date, default: Date.now }
    }],
    balance: {
        type: Number,
        default: 0
    },
    isActive: { 
        type: Boolean, 
        default: true 
    },
    lastLogin: Date,
    createdAt: { 
        type: Date, 
        default: Date.now 
    },
    updatedAt: { 
        type: Date, 
        default: Date.now 
    }
});

UserSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

UserSchema.methods.generateAuthToken = function() {
    return jwt.sign(
        { 
            id: this._id, 
            email: this.email, 
            role: this.role,
            firstName: this.firstName,
            subscription: this.subscription
        },
        process.env.JWT_SECRET || 'concierge-secret-key',
        { expiresIn: '30d' }
    );
};

const User = mongoose.model('User', UserSchema);

const TaskSchema = new mongoose.Schema({
    taskNumber: { 
        type: String, 
        unique: true,
        index: true
    },
    title: { 
        type: String, 
        required: true,
        trim: true
    },
    description: { 
        type: String, 
        required: true,
        trim: true
    },
    client: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    performer: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User' 
    },
    category: { 
        type: String, 
        enum: ['home_and_household', 'family_and_children', 'beauty_and_health', 'courses_and_education', 'pets', 'events_and_entertainment', 'other'],
        required: true 
    },
    subcategory: {
        type: String,
        trim: true
    },
    status: {
        type: String,
        enum: ['new', 'assigned', 'in_progress', 'completed', 'cancelled', 'reopened', 'pending_payment', 'paid'],
        default: 'new'
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'urgent'],
        default: 'medium'
    },
    deadline: { 
        type: Date, 
        required: true 
    },
    price: { 
        type: Number, 
        required: true,
        min: 0
    },
    location: {
        address: String,
        city: String,
        coordinates: {
            lat: Number,
            lng: Number
        }
    },
    rating: { 
        type: Number, 
        min: 1, 
        max: 5 
    },
    feedback: {
        text: String,
        images: [String],
        createdAt: Date
    },
    cancellationReason: String,
    attachments: [{
        filename: String,
        path: String,
        mimetype: String,
        size: Number,
        uploadedAt: { type: Date, default: Date.now }
    }],
    paymentStatus: {
        type: String,
        enum: ['pending', 'paid', 'refunded', 'failed'],
        default: 'pending'
    },
    paymentMethod: {
        type: String,
        enum: ['card', 'cash', 'transfer', 'subscription']
    },
    tags: [String],
    createdAt: { 
        type: Date, 
        default: Date.now 
    },
    updatedAt: { 
        type: Date, 
        default: Date.now 
    }
});

TaskSchema.pre('save', async function(next) {
    if (!this.taskNumber) {
        const date = new Date();
        const year = date.getFullYear().toString().slice(-2);
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        
        const count = await mongoose.models.Task?.countDocuments({
            createdAt: {
                $gte: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
                $lt: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
            }
        }) || 0;
        
        this.taskNumber = `TASK-${year}${month}${day}-${(count + 1).toString().padStart(4, '0')}`;
    }
    this.updatedAt = new Date();
    next();
});

TaskSchema.post('save', async function(doc) {
    // Отправляем уведомление клиенту при изменении статуса
    try {
        if (doc.status === 'completed' || doc.status === 'cancelled') {
            const notification = {
                type: 'task_update',
                title: `Задача ${doc.taskNumber} ${doc.status === 'completed' ? 'завершена' : 'отменена'}`,
                message: `Ваша задача "${doc.title}" была ${doc.status === 'completed' ? 'успешно завершена' : 'отменена'}`,
                taskId: doc._id,
                read: false
            };
            
            await User.findByIdAndUpdate(doc.client, {
                $push: { notifications: notification }
            });
        }
    } catch (error) {
        logger.error(`Ошибка отправки уведомления: ${error.message}`);
    }
});

const Task = mongoose.model('Task', TaskSchema);

const ServiceSchema = new mongoose.Schema({
    name: { 
        type: String, 
        required: true,
        trim: true
    },
    description: { 
        type: String, 
        required: true,
        trim: true
    },
    category: {
        type: String,
        required: true,
        enum: ['home_and_household', 'family_and_children', 'beauty_and_health', 'courses_and_education', 'pets', 'events_and_entertainment', 'other']
    },
    subcategories: [String],
    priceOptions: {
        oneTime: {
            type: Number,
            min: 0
        },
        hourly: {
            type: Number,
            min: 0
        }
    },
    duration: {
        type: Number,
        min: 15,
        default: 60
    },
    requirements: [String],
    included: [String],
    images: [String],
    isActive: { 
        type: Boolean, 
        default: true 
    },
    isPopular: { 
        type: Boolean, 
        default: false 
    },
    order: { 
        type: Number, 
        default: 0 
    },
    tags: [String],
    rating: {
        average: { type: Number, default: 0, min: 0, max: 5 },
        count: { type: Number, default: 0 }
    },
    metadata: mongoose.Schema.Types.Mixed,
    createdAt: { 
        type: Date, 
        default: Date.now 
    },
    updatedAt: { 
        type: Date, 
        default: Date.now 
    }
});

ServiceSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

const Service = mongoose.model('Service', ServiceSchema);

// ==================== API МАРШРУТЫ ====================

// Главная страница
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: '🎀 Добро пожаловать в Женский Консьерж Сервис',
        version: '4.1.0',
        status: '🟢 Работает',
        description: 'Система помощи и заботы для женщин',
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
        },
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        success: true,
        status: 'OK',
        service: 'concierge-service',
        version: '4.1.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        memory: process.memoryUsage()
    });
});

// ==================== АУТЕНТИФИКАЦИЯ ====================

// Регистрация
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, firstName, lastName, phone, role = 'client' } = req.body;
        
        // Проверяем существует ли пользователь
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                error: 'Пользователь с таким email уже существует'
            });
        }
        
        // Хешируем пароль
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Создаем пользователя
        const user = new User({
            email,
            password: hashedPassword,
            firstName,
            lastName,
            phone,
            role
        });
        
        await user.save();
        
        // Генерируем токен
        const token = user.generateAuthToken();
        
        // Не возвращаем пароль
        const userResponse = user.toObject();
        delete userResponse.password;
        
        res.status(201).json({
            success: true,
            message: 'Регистрация успешна!',
            data: {
                user: userResponse,
                token
            }
        });
        
    } catch (error) {
        logger.error(`Ошибка регистрации: ${error.message}`);
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
        
        // Находим пользователя с паролем
        const user = await User.findOne({ email }).select('+password');
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
        user.lastLogin = new Date();
        await user.save();
        
        // Генерируем токен
        const token = user.generateAuthToken();
        
        // Не возвращаем пароль
        const userResponse = user.toObject();
        delete userResponse.password;
        
        res.json({
            success: true,
            message: 'Вход выполнен успешно!',
            data: {
                user: userResponse,
                token
            }
        });
        
    } catch (error) {
        logger.error(`Ошибка входа: ${error.message}`);
        res.status(500).json({
            success: false,
            error: 'Ошибка входа'
        });
    }
});

// Получение профиля
app.get('/api/auth/profile', authMiddleware(), async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        res.json({
            success: true,
            data: { user }
        });
        
    } catch (error) {
        logger.error(`Ошибка получения профиля: ${error.message}`);
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
        
        let query = { isActive: true };
        
        if (category && category !== 'all') {
            query.category = category;
        }
        
        if (popular === 'true') {
            query.isPopular = true;
        }
        
        const services = await Service.find(query)
            .limit(parseInt(limit))
            .sort({ order: 1, createdAt: -1 });
        
        res.json({
            success: true,
            data: {
                services,
                count: services.length
            }
        });
        
    } catch (error) {
        logger.error(`Ошибка получения услуг: ${error.message}`);
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
        
        const task = new Task({
            title,
            description,
            category,
            subcategory,
            deadline,
            price,
            priority,
            client: req.user.id,
            location: address ? { address } : undefined,
            tags: tags ? tags.split(',').map(tag => tag.trim()) : []
        });
        
        await task.save();
        
        // Добавляем уведомление
        await User.findByIdAndUpdate(req.user.id, {
            $push: {
                notifications: {
                    type: 'task_update',
                    title: 'Задача создана',
                    message: `Задача "${title}" успешно создана`,
                    taskId: task._id
                }
            }
        });
        
        res.status(201).json({
            success: true,
            message: 'Задача успешно создана!',
            data: { task }
        });
        
    } catch (error) {
        logger.error(`Ошибка создания задачи: ${error.message}`);
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
        
        let query = {};
        
        if (userRole === 'client') {
            query.client = userId;
        } else if (userRole === 'performer') {
            query.performer = userId;
        } else {
            // Админы видят все задачи
            query = {};
        }
        
        if (status && status !== 'all') {
            query.status = status;
        }
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const tasks = await Task.find(query)
            .populate('client', 'firstName lastName email phone')
            .populate('performer', 'firstName lastName email phone rating')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));
        
        const total = await Task.countDocuments(query);
        
        res.json({
            success: true,
            data: {
                tasks,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / parseInt(limit))
                }
            }
        });
        
    } catch (error) {
        logger.error(`Ошибка получения задач: ${error.message}`);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения задач'
        });
    }
});

// Получение конкретной задачи
app.get('/api/tasks/:id', authMiddleware(), async (req, res) => {
    try {
        const task = await Task.findById(req.params.id)
            .populate('client', 'firstName lastName email phone')
            .populate('performer', 'firstName lastName email phone rating');
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        // Проверяем доступ к задаче
        const userId = req.user.id;
        const userRole = req.user.role;
        
        if (userRole !== 'admin' && userRole !== 'superadmin') {
            if (task.client._id.toString() !== userId && 
                (!task.performer || task.performer._id.toString() !== userId)) {
                return res.status(403).json({
                    success: false,
                    error: 'Нет доступа к этой задаче'
                });
            }
        }
        
        res.json({
            success: true,
            data: { task }
        });
        
    } catch (error) {
        logger.error(`Ошибка получения задачи: ${error.message}`);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения задачи'
        });
    }
});

// Отмена задачи
app.post('/api/tasks/:id/cancel', authMiddleware(['client', 'admin', 'superadmin']), async (req, res) => {
    try {
        const task = await Task.findById(req.params.id);
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        // Проверяем что задача принадлежит пользователю
        if (task.client.toString() !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'superadmin') {
            return res.status(403).json({
                success: false,
                error: 'Нет прав на отмену этой задачи'
            });
        }
        
        task.status = 'cancelled';
        task.cancellationReason = req.body.reason || 'Отменено клиентом';
        await task.save();
        
        res.json({
            success: true,
            message: 'Задача отменена',
            data: { task }
        });
        
    } catch (error) {
        logger.error(`Ошибка отмены задачи: ${error.message}`);
        res.status(500).json({
            success: false,
            error: 'Ошибка отмены задачи'
        });
    }
});

// Возобновление задачи
app.post('/api/tasks/:id/reopen', authMiddleware(['client', 'admin', 'superadmin']), async (req, res) => {
    try {
        const task = await Task.findById(req.params.id);
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        if (task.client.toString() !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'superadmin') {
            return res.status(403).json({
                success: false,
                error: 'Нет прав на возобновление этой задачи'
            });
        }
        
        task.status = 'new';
        await task.save();
        
        res.json({
            success: true,
            message: 'Задача возобновлена',
            data: { task }
        });
        
    } catch (error) {
        logger.error(`Ошибка возобновления задачи: ${error.message}`);
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
        const task = await Task.findById(req.params.id);
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        if (task.client.toString() !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'superadmin') {
            return res.status(403).json({
                success: false,
                error: 'Нет прав на завершение этой задачи'
            });
        }
        
        task.status = 'completed';
        task.rating = rating;
        task.feedback = {
            text: feedback,
            createdAt: new Date()
        };
        await task.save();
        
        // Обновляем рейтинг исполнителя если есть
        if (task.performer && rating) {
            await updatePerformerRating(task.performer);
        }
        
        res.json({
            success: true,
            message: 'Задача завершена',
            data: { task }
        });
        
    } catch (error) {
        logger.error(`Ошибка завершения задачи: ${error.message}`);
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
        const user = await User.findById(req.user.id);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        const unreadCount = user.notifications.filter(n => !n.read).length;
        
        res.json({
            success: true,
            data: {
                notifications: user.notifications.slice(0, 20), // Последние 20
                unreadCount
            }
        });
        
    } catch (error) {
        logger.error(`Ошибка получения уведомлений: ${error.message}`);
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
        
        await User.findByIdAndUpdate(req.user.id, {
            $set: {
                'notifications.$[elem].read': true
            }
        }, {
            arrayFilters: [{ 'elem._id': { $in: notificationIds } }],
            multi: true
        });
        
        res.json({
            success: true,
            message: 'Уведомления отмечены как прочитанные'
        });
        
    } catch (error) {
        logger.error(`Ошибка отметки уведомлений: ${error.message}`);
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
        // Получаем статистику за последние 30 дней
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const [
            totalUsers,
            totalClients,
            totalPerformers,
            totalTasks,
            completedTasks,
            totalRevenue,
            monthlyRevenue,
            newUsersThisMonth,
            newTasksThisMonth
        ] = await Promise.all([
            User.countDocuments(),
            User.countDocuments({ role: 'client' }),
            User.countDocuments({ role: 'performer' }),
            Task.countDocuments(),
            Task.countDocuments({ status: 'completed' }),
            Task.aggregate([
                { $match: { status: 'completed' } },
                { $group: { _id: null, total: { $sum: '$price' } } }
            ]),
            Task.aggregate([
                { $match: { status: 'completed', createdAt: { $gte: thirtyDaysAgo } } },
                { $group: { _id: null, total: { $sum: '$price' } } }
            ]),
            User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
            Task.countDocuments({ createdAt: { $gte: thirtyDaysAgo } })
        ]);
        
        // Статистика по категориям
        const categoryStats = await Task.aggregate([
            { $group: { 
                _id: '$category', 
                count: { $sum: 1 },
                revenue: { $sum: '$price' }
            }},
            { $sort: { count: -1 } }
        ]);
        
        res.json({
            success: true,
            data: {
                summary: {
                    totalUsers,
                    totalClients,
                    totalPerformers,
                    totalTasks,
                    completedTasks,
                    totalRevenue: totalRevenue[0]?.total || 0,
                    monthlyRevenue: monthlyRevenue[0]?.total || 0,
                    newUsersThisMonth,
                    newTasksThisMonth
                },
                categories: categoryStats.map(stat => ({
                    category: stat._id,
                    name: getCategoryName(stat._id),
                    count: stat.count,
                    revenue: stat.revenue
                })),
                recentTasks: await Task.find()
                    .populate('client', 'firstName lastName')
                    .sort({ createdAt: -1 })
                    .limit(10)
            }
        });
        
    } catch (error) {
        logger.error(`Ошибка получения статистики: ${error.message}`);
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
        
        let query = {};
        
        if (role && role !== 'all') {
            query.role = role;
        }
        
        if (search) {
            query.$or = [
                { email: { $regex: search, $options: 'i' } },
                { firstName: { $regex: search, $options: 'i' } },
                { lastName: { $regex: search, $options: 'i' } }
            ];
        }
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const users = await User.find(query)
            .select('-password')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));
        
        const total = await User.countDocuments(query);
        
        res.json({
            success: true,
            data: {
                users,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / parseInt(limit))
                }
            }
        });
        
    } catch (error) {
        logger.error(`Ошибка получения пользователей: ${error.message}`);
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
        
        let query = {};
        
        if (status && status !== 'all') {
            query.status = status;
        }
        
        if (category && category !== 'all') {
            query.category = category;
        }
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const tasks = await Task.find(query)
            .populate('client', 'firstName lastName email')
            .populate('performer', 'firstName lastName email')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));
        
        const total = await Task.countDocuments(query);
        
        res.json({
            success: true,
            data: {
                tasks,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / parseInt(limit))
                }
            }
        });
        
    } catch (error) {
        logger.error(`Ошибка получения задач: ${error.message}`);
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
        const tasks = await Task.find({ 
            performer: performerId, 
            rating: { $exists: true, $gt: 0 } 
        });
        
        if (tasks.length > 0) {
            const averageRating = tasks.reduce((sum, task) => sum + task.rating, 0) / tasks.length;
            
            await User.findByIdAndUpdate(performerId, {
                rating: Math.round(averageRating * 10) / 10
            });
        }
    } catch (error) {
        logger.error(`Ошибка обновления рейтинга исполнителя: ${error.message}`);
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

// ==================== СОЗДАНИЕ ТЕСТОВЫХ ДАННЫХ ====================

const createTestData = async () => {
    try {
        const usersCount = await User.countDocuments();
        
        if (usersCount === 0) {
            console.log('📝 Создание тестовых данных...');
            
            // Суперадминистратор
            const superAdminPassword = await bcrypt.hash('admin123', 10);
            const superAdmin = new User({
                email: 'superadmin@concierge.com',
                password: superAdminPassword,
                firstName: 'Супер',
                lastName: 'Администратор',
                phone: '+79999999999',
                role: 'superadmin',
                subscription: {
                    plan: 'vip',
                    status: 'active'
                }
            });
            await superAdmin.save();
            
            // Администратор
            const adminPassword = await bcrypt.hash('admin123', 10);
            const admin = new User({
                email: 'admin@concierge.com',
                password: adminPassword,
                firstName: 'Анна',
                lastName: 'Администратор',
                phone: '+79998887766',
                role: 'admin',
                subscription: {
                    plan: 'vip',
                    status: 'active'
                }
            });
            await admin.save();
            
            // Клиенты
            const clients = [
                {
                    email: 'maria@example.com',
                    firstName: 'Мария',
                    lastName: 'Иванова',
                    phone: '+79997776655',
                    role: 'client',
                    subscription: { plan: 'premium', status: 'active' }
                },
                {
                    email: 'ekaterina@example.com',
                    firstName: 'Екатерина',
                    lastName: 'Петрова',
                    phone: '+79996665544',
                    role: 'client',
                    subscription: { plan: 'basic', status: 'active' }
                },
                {
                    email: 'olga@example.com',
                    firstName: 'Ольга',
                    lastName: 'Сидорова',
                    phone: '+79995554433',
                    role: 'client',
                    subscription: { plan: 'free', status: 'active' }
                }
            ];
            
            for (const clientData of clients) {
                const password = await bcrypt.hash('client123', 10);
                const client = new User({
                    ...clientData,
                    password
                });
                await client.save();
            }
            
            // Исполнители
            const performers = [
                {
                    email: 'elena@performer.com',
                    firstName: 'Елена',
                    lastName: 'Смирнова',
                    phone: '+79994443322',
                    role: 'performer',
                    rating: 4.7,
                    subscription: { plan: 'basic', status: 'active' }
                },
                {
                    email: 'anna@performer.com',
                    firstName: 'Анна',
                    lastName: 'Кузнецова',
                    phone: '+79993332211',
                    role: 'performer',
                    rating: 4.9,
                    subscription: { plan: 'premium', status: 'active' }
                }
            ];
            
            for (const performerData of performers) {
                const password = await bcrypt.hash('performer123', 10);
                const performer = new User({
                    ...performerData,
                    password
                });
                await performer.save();
            }
            
            console.log('✅ Создано тестовых пользователей');
            
            // Услуги
            const services = [
                {
                    name: 'Помощь с уборкой',
                    description: 'Помогу навести порядок в квартире, разобрать гардероб, организовать пространство.',
                    category: 'home_and_household',
                    subcategories: ['Уборка', 'Организация'],
                    priceOptions: { oneTime: 2500, hourly: 500 },
                    duration: 180,
                    isActive: true,
                    isPopular: true,
                    rating: { average: 4.8, count: 127 },
                    tags: ['уборка', 'помощь', 'организация']
                },
                {
                    name: 'Присмотр за детьми',
                    description: 'Посижу с вашим ребенком, погуляю, помогу с уроками, организую досуг.',
                    category: 'family_and_children',
                    subcategories: ['Няня', 'Репетитор'],
                    priceOptions: { oneTime: 1500, hourly: 350 },
                    duration: 240,
                    isActive: true,
                    isPopular: true,
                    rating: { average: 4.9, count: 89 },
                    tags: ['дети', 'няня', 'присмотр']
                },
                {
                    name: 'Помощь с маникюром',
                    description: 'Сделаю аккуратный маникюр с покрытием гель-лаком или укреплением ногтей.',
                    category: 'beauty_and_health',
                    subcategories: ['Маникюр'],
                    priceOptions: { oneTime: 1800 },
                    duration: 90,
                    isActive: true,
                    isPopular: true,
                    rating: { average: 4.7, count: 234 },
                    tags: ['маникюр', 'уход', 'красота']
                },
                {
                    name: 'Помощь с питомцем',
                    description: 'Выгуляю собаку, покормлю кошку, посижу с животным пока вас нет дома.',
                    category: 'pets',
                    subcategories: ['Выгул', 'Передержка'],
                    priceOptions: { oneTime: 800, hourly: 300 },
                    duration: 60,
                    isActive: true,
                    isPopular: false,
                    rating: { average: 4.8, count: 56 },
                    tags: ['питомцы', 'выгул', 'уход']
                },
                {
                    name: 'Помощь в организации праздника',
                    description: 'Помогу организовать день рождения, детский праздник или семейное торжество.',
                    category: 'events_and_entertainment',
                    subcategories: ['Организация'],
                    priceOptions: { oneTime: 4000 },
                    duration: 300,
                    isActive: true,
                    isPopular: true,
                    rating: { average: 4.9, count: 45 },
                    tags: ['праздник', 'организация', 'ивент']
                }
            ];
            
            await Service.insertMany(services);
            console.log('✅ Создано тестовых услуг');
            
            // Задачи
            const clientsList = await User.find({ role: 'client' });
            const performersList = await User.find({ role: 'performer' });
            
            const tasks = [
                {
                    title: 'Помогите с генеральной уборкой после ремонта',
                    description: 'Нужно помыть окна, протереть пыль везде, помыть полы, разобрать коробки после переезда.',
                    client: clientsList[0]._id,
                    performer: performersList[0]._id,
                    category: 'home_and_household',
                    subcategory: 'Уборка',
                    status: 'completed',
                    priority: 'high',
                    deadline: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                    price: 3500,
                    rating: 5,
                    feedback: {
                        text: 'Елена прекрасно справилась! Квартира сияет, все разложено по местам. Очень рекомендую!',
                        createdAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)
                    }
                },
                {
                    title: 'Нужна няня на субботу',
                    description: 'Ребенку 4 года, нужно посидеть с ним с 10 до 18, погулять, покормить, поиграть.',
                    client: clientsList[1]._id,
                    category: 'family_and_children',
                    subcategory: 'Няня',
                    status: 'in_progress',
                    priority: 'medium',
                    deadline: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
                    price: 2800
                },
                {
                    title: 'Сделать маникюр к празднику',
                    description: 'Нужен классический маникюр с покрытием гель-лаком нежного розового цвета.',
                    client: clientsList[2]._id,
                    performer: performersList[1]._id,
                    category: 'beauty_and_health',
                    subcategory: 'Маникюр',
                    status: 'assigned',
                    priority: 'low',
                    deadline: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
                    price: 1800
                },
                {
                    title: 'Выгулять собаку утром и вечером',
                    description: 'Собака лабрадор, 3 года, активная. Нужно гулять по 40-60 минут утром и вечером.',
                    client: clientsList[0]._id,
                    category: 'pets',
                    subcategory: 'Выгул',
                    status: 'new',
                    priority: 'medium',
                    deadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
                    price: 1200
                }
            ];
            
            for (const taskData of tasks) {
                const task = new Task(taskData);
                await task.save();
            }
            
            console.log('✅ Создано тестовых задач');
            console.log('🎉 Тестовые данные успешно созданы!');
            
            console.log('\n🔑 Тестовые аккаунты:');
            console.log('👑 Суперадмин: superadmin@concierge.com / admin123');
            console.log('👩‍💼 Админ: admin@concierge.com / admin123');
            console.log('👩 Клиент: maria@example.com / client123');
            console.log('👨‍🏫 Исполнитель: elena@performer.com / performer123');
        }
    } catch (error) {
        console.error('❌ Ошибка создания тестовых данных:', error.message);
    }
};

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎀 ЗАПУСК ЖЕНСКОГО КОНСЬЕРЖ СЕРВИСА v4.1.0');
        console.log('='.repeat(80));
        console.log(`🔧 Режим: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🌐 PORT: ${process.env.PORT || 3000}`);
        
        console.log('🗄️  Подключение к базе данных...');
        const dbConnected = await connectDB();
        
        if (dbConnected) {
            console.log('✅ База данных подключена');
            await createTestData();
        } else {
            console.log('⚠️  База данных не подключена');
        }
        
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
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        process.exit(1);
    }
};

// Обработка сигналов
process.on('SIGTERM', () => {
    console.log('Получен SIGTERM, завершение работы...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('Получен SIGINT, завершение работы...');
    process.exit(0);
});

// Запуск
startServer();
