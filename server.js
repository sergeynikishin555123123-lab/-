require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const { createLogger, format, transports } = require('winston');

// ==================== БЕЗОПАСНОЕ СОЗДАНИЕ ДИРЕКТОРИЙ ====================
const ensureDirectories = () => {
    const dirs = ['logs', 'uploads', 'exports', 'public'];
    
    dirs.forEach(dir => {
        try {
            // Пытаемся создать в текущей директории
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`✅ Директория создана: ${dir}`);
            }
        } catch (err) {
            if (err.code === 'EACCES') {
                // Если нет прав, создаем в /tmp
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

// Создаем директории
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

// В консоль только в development
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

// ==================== ПОДКЛЮЧЕНИЕ К MONGODB ====================
const connectDB = async () => {
    try {
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
        
        // В режиме разработки продолжаем без БД
        if (process.env.NODE_ENV === 'development') {
            console.log('⚠️  Продолжаем в режиме без базы данных');
            return false;
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
    telegramId: { 
        type: String,
        unique: true,
        sparse: true
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
    metadata: mongoose.Schema.Types.Mixed,
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

// Генерация номера задачи
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
        },
        subscription: {
            monthly: Number,
            yearly: Number
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
    performerRequirements: {
        minRating: { type: Number, default: 0 },
        verified: { type: Boolean, default: false }
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
        version: '4.0.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        memory: process.memoryUsage()
    });
});

// Создание тестовых данных
const createTestData = async () => {
    try {
        const usersCount = await User.countDocuments();
        
        if (usersCount === 0) {
            console.log('📝 Создание тестовых данных...');
            
            const bcrypt = require('bcryptjs');
            
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
            
            // Клиент
            const clientPassword = await bcrypt.hash('client123', 10);
            const client = new User({
                email: 'client@example.com',
                password: clientPassword,
                firstName: 'Мария',
                lastName: 'Иванова',
                phone: '+79997776655',
                role: 'client',
                subscription: {
                    plan: 'premium',
                    status: 'active'
                }
            });
            await client.save();
            
            // Исполнитель
            const performerPassword = await bcrypt.hash('performer123', 10);
            const performer = new User({
                email: 'performer@example.com',
                password: performerPassword,
                firstName: 'Елена',
                lastName: 'Смирнова',
                phone: '+79996665544',
                role: 'performer',
                rating: 4.7,
                subscription: {
                    plan: 'basic',
                    status: 'active'
                }
            });
            await performer.save();
            
            console.log('✅ Создано 4 тестовых пользователя');
            
            // Услуги
            const services = [
                {
                    name: 'Генеральная уборка квартиры',
                    description: 'Полная уборка всех комнат, кухни, санузла. Мытье окон, чистка ковров.',
                    category: 'home_and_household',
                    subcategories: ['Уборка'],
                    priceOptions: { oneTime: 3000, hourly: 500 },
                    duration: 240,
                    isActive: true,
                    isPopular: true,
                    rating: { average: 4.8, count: 127 }
                },
                {
                    name: 'Няня на день',
                    description: 'Присмотр за ребенком в течение дня, прогулки, развивающие занятия.',
                    category: 'family_and_children',
                    subcategories: ['Няня'],
                    priceOptions: { oneTime: 2000, hourly: 300 },
                    duration: 480,
                    isActive: true,
                    isPopular: true,
                    rating: { average: 4.9, count: 89 }
                },
                {
                    name: 'Маникюр на дому',
                    description: 'Комплексный маникюр с покрытием гель-лаком, парафинотерапия.',
                    category: 'beauty_and_health',
                    subcategories: ['Маникюр'],
                    priceOptions: { oneTime: 1500 },
                    duration: 90,
                    isActive: true,
                    isPopular: true,
                    rating: { average: 4.7, count: 234 }
                }
            ];
            
            await Service.insertMany(services);
            console.log('✅ Создано тестовых услуг');
            
            // Задачи
            const task = new Task({
                title: 'Уборка 3-х комнатной квартиры',
                description: 'Генеральная уборка после ремонта',
                client: client._id,
                category: 'home_and_household',
                deadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
                price: 3500,
                status: 'completed',
                rating: 5,
                feedback: {
                    text: 'Отличная работа!',
                    createdAt: new Date()
                }
            });
            await task.save();
            
            console.log('✅ Создана тестовая задача');
            console.log('🎉 Тестовые данные успешно созданы!');
        }
    } catch (error) {
        console.error('❌ Ошибка создания тестовых данных:', error.message);
    }
};

// Простые API эндпоинты для начала
app.get('/api/services', async (req, res) => {
    try {
        const services = await Service.find({ isActive: true }).limit(10);
        res.json({ success: true, data: services });
    } catch (error) {
        logger.error('Ошибка услуг:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения услуг' });
    }
});

app.get('/api/services/categories', (req, res) => {
    const categories = [
        { id: 'home_and_household', name: 'Дом и быт', icon: '🏠' },
        { id: 'family_and_children', name: 'Дети и семья', icon: '👨‍👩‍👧‍👦' },
        { id: 'beauty_and_health', name: 'Красота и здоровье', icon: '💅' },
        { id: 'courses_and_education', name: 'Курсы и образование', icon: '🎓' },
        { id: 'pets', name: 'Питомцы', icon: '🐶' },
        { id: 'events_and_entertainment', name: 'Мероприятия', icon: '🎉' }
    ];
    res.json({ success: true, data: categories });
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🚀 ЗАПУСК ЖЕНСКОГО КОНСЬЕРЖ СЕРВИСА v4.0.0');
        console.log('='.repeat(80));
        console.log(`🔧 Режим: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🌐 PORT: ${process.env.PORT || 3000}`);
        
        // Подключаем MongoDB
        console.log('🗄️  Подключение к MongoDB...');
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
