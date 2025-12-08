require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const { createLogger, format, transports } = require('winston');
const TelegramBot = require('node-telegram-bot-api');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const ExcelJS = require('exceljs');
const moment = require('moment');

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Создаем директории если их нет
['logs', 'uploads', 'exports', 'public'].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`✅ Создана директория: ${dir}`);
    }
});

// Настройка логгера
const logger = createLogger({
    level: 'info',
    format: format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.errors({ stack: true }),
        format.splat(),
        format.json()
    ),
    transports: [
        new transports.File({ filename: 'logs/error.log', level: 'error' }),
        new transports.File({ filename: 'logs/combined.log' })
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

// Middleware
app.use(cors({
    origin: process.env.FRONTEND_URL || "*",
    credentials: true
}));
app.use(helmet({
    contentSecurityPolicy: false
}));
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// Настройка загрузки файлов
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// ==================== MONGODB ПОДКЛЮЧЕНИЕ ====================
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
        
        // В режиме разработки можно продолжать без БД
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
            default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // +30 дней
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
        const date = moment();
        const year = date.format('YY');
        const month = date.format('MM');
        const day = date.format('DD');
        
        // Ищем последнюю задачу за сегодня
        const lastTask = await mongoose.models.Task?.findOne({
            createdAt: {
                $gte: moment().startOf('day').toDate(),
                $lte: moment().endOf('day').toDate()
            }
        }).sort({ taskNumber: -1 });
        
        let sequence = 1;
        if (lastTask && lastTask.taskNumber) {
            const lastSeq = parseInt(lastTask.taskNumber.split('-')[2]) || 0;
            sequence = lastSeq + 1;
        }
        
        this.taskNumber = `TASK-${year}${month}${day}-${sequence.toString().padStart(4, '0')}`;
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

// ==================== TELEGRAM BOT ====================
let telegramBot = null;

const initializeTelegramBot = async () => {
    try {
        const token = process.env.BOT_TOKEN;
        
        if (!token || token.includes('your_telegram_bot_token')) {
            logger.info('Telegram бот отключен (токен не указан)');
            return null;
        }
        
        telegramBot = new TelegramBot(token, { 
            polling: {
                interval: 300,
                autoStart: true,
                params: {
                    timeout: 10
                }
            }
        });
        
        // Команды бота
        telegramBot.onText(/\/start/, async (msg) => {
            const chatId = msg.chat.id;
            const username = msg.from.username || msg.from.first_name;
            
            const user = await User.findOne({ telegramId: chatId.toString() });
            
            if (user) {
                await telegramBot.sendMessage(chatId,
                    `👋 С возвращением, ${user.firstName}!\n\n` +
                    `Ваша роль: ${user.role}\n` +
                    `Подписка: ${user.subscription.plan}\n\n` +
                    `Доступные команды:\n` +
                    `/services - Наши услуги\n` +
                    `/newtask - Создать заявку\n` +
                    `/mytasks - Мои заявки\n` +
                    `/profile - Мой профиль\n` +
                    `/balance - Мой баланс\n` +
                    `/help - Помощь`
                );
            } else {
                await telegramBot.sendMessage(chatId,
                    `🎀 Добро пожаловать в Женский Консьерж Сервис!\n\n` +
                    `Я помогу вам:\n` +
                    `🏠 С домом и бытом\n` +
                    `👨‍👩‍👧‍👦 С детьми и семьей\n` +
                    `💅 С красотой и здоровьем\n` +
                    `🎓 С обучением\n` +
                    `🐶 С питомцами\n` +
                    `🎉 И со многим другим!\n\n` +
                    `Для начала работы:\n` +
                    `/register - Регистрация\n` +
                    `/services - Услуги\n` +
                    `/help - Помощь`
                );
            }
        });
        
        // Регистрация через бота
        telegramBot.onText(/\/register/, async (msg) => {
            const chatId = msg.chat.id;
            
            const existingUser = await User.findOne({ telegramId: chatId.toString() });
            if (existingUser) {
                await telegramBot.sendMessage(chatId, '✅ Вы уже зарегистрированы! Используйте /profile');
                return;
            }
            
            await telegramBot.sendMessage(chatId,
                '📝 *Регистрация*\n\n' +
                'Отправьте в одном сообщении:\n\n' +
                'Имя Фамилия\n' +
                'Email\n' +
                'Телефон\n\n' +
                '*Пример:*\n' +
                'Анна Иванова\n' +
                'anna@example.com\n' +
                '+79991234567',
                { parse_mode: 'Markdown' }
            );
            
            telegramBot.once('message', async (responseMsg) => {
                if (responseMsg.chat.id === chatId) {
                    const lines = responseMsg.text.split('\n').map(l => l.trim());
                    if (lines.length >= 2) {
                        const [fullName, email, phone] = lines;
                        const [firstName, lastName] = fullName.split(' ');
                        
                        try {
                            const tempPassword = Math.random().toString(36).slice(-8);
                            const hashedPassword = await bcrypt.hash(tempPassword, 10);
                            
                            const newUser = new User({
                                firstName,
                                lastName,
                                email,
                                phone: phone || '',
                                password: hashedPassword,
                                telegramId: chatId.toString(),
                                role: 'client'
                            });
                            
                            await newUser.save();
                            
                            await telegramBot.sendMessage(chatId,
                                `✅ *Регистрация успешна!*\n\n` +
                                `👤 ${firstName} ${lastName}\n` +
                                `📧 ${email}\n` +
                                `🔐 Пароль: ||${tempPassword}||\n\n` +
                                `⚠️ Сохраните пароль!\n` +
                                `Теперь можете войти на сайте.`,
                                { parse_mode: 'Markdown' }
                            );
                        } catch (error) {
                            await telegramBot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
                        }
                    }
                }
            });
        });
        
        // Создание задачи через бота
        telegramBot.onText(/\/newtask/, async (msg) => {
            const chatId = msg.chat.id;
            
            const user = await User.findOne({ telegramId: chatId.toString() });
            if (!user) {
                await telegramBot.sendMessage(chatId, '❌ Сначала зарегистрируйтесь: /register');
                return;
            }
            
            // Получаем список услуг
            const services = await Service.find({ isActive: true }).limit(5);
            let servicesText = '🎀 *Выберите категорию:*\n\n';
            services.forEach((service, index) => {
                servicesText += `${index + 1}. ${service.name}\n`;
            });
            servicesText += '\nИли отправьте свою задачу в формате:\n';
            servicesText += 'Название\nОписание\nКатегория\nЦена\nСрок (ДД.ММ.ГГГГ)';
            
            await telegramBot.sendMessage(chatId, servicesText, { parse_mode: 'Markdown' });
        });
        
        logger.info('✅ Telegram бот запущен');
        return telegramBot;
        
    } catch (error) {
        logger.error(`❌ Ошибка Telegram бота: ${error.message}`);
        return null;
    }
};

// ==================== МИДЛВЕЙРЫ АУТЕНТИФИКАЦИИ ====================
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ success: false, error: 'Требуется авторизация' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.id;
        req.userRole = decoded.role;
        next();
    } catch (error) {
        return res.status(403).json({ success: false, error: 'Неверный токен' });
    }
};

const requireRole = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.userRole)) {
            return res.status(403).json({ success: false, error: 'Доступ запрещен' });
        }
        next();
    };
};

// ==================== API МАРШРУТЫ ====================

// Главная страница
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: '🎀 Добро пожаловать в Женский Консьерж Сервис',
        version: '4.0.0',
        description: 'Полноценная система управления задачами и услугами',
        endpoints: {
            health: '/health',
            auth: {
                register: 'POST /api/auth/register',
                login: 'POST /api/auth/login',
                profile: 'GET /api/auth/profile'
            },
            services: {
                list: 'GET /api/services',
                categories: 'GET /api/services/categories'
            },
            tasks: {
                create: 'POST /api/tasks',
                list: 'GET /api/tasks',
                details: 'GET /api/tasks/:id'
            },
            admin: {
                stats: 'GET /api/admin/stats',
                export: 'GET /api/admin/export/:type'
            }
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
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        telegram: telegramBot ? 'connected' : 'disconnected',
        environment: process.env.NODE_ENV || 'development'
    });
});

// Регистрация
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, firstName, lastName, phone, role = 'client' } = req.body;
        
        // Валидация
        if (!email || !password || !firstName || !lastName) {
            return res.status(400).json({ 
                success: false, 
                error: 'Заполните все обязательные поля' 
            });
        }
        
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ 
                success: false, 
                error: 'Пользователь с таким email уже существует' 
            });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const user = new User({
            email,
            password: hashedPassword,
            firstName,
            lastName,
            phone,
            role
        });
        
        await user.save();
        
        const token = jwt.sign(
            { id: user._id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        res.status(201).json({
            success: true,
            message: 'Регистрация успешна',
            data: {
                user: {
                    id: user._id,
                    email: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    role: user.role
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
        
        const user = await User.findOne({ email }).select('+password');
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
        
        if (!user.isActive) {
            return res.status(403).json({ 
                success: false, 
                error: 'Аккаунт деактивирован' 
            });
        }
        
        user.lastLogin = new Date();
        await user.save();
        
        const token = jwt.sign(
            { id: user._id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        res.json({
            success: true,
            message: 'Вход выполнен',
            data: {
                user: {
                    id: user._id,
                    email: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    role: user.role,
                    avatar: user.avatar,
                    rating: user.rating,
                    subscription: user.subscription,
                    balance: user.balance
                },
                token
            }
        });
        
    } catch (error) {
        logger.error('Ошибка входа:', error);
        res.status(500).json({ success: false, error: 'Ошибка входа' });
    }
});

// Профиль
app.get('/api/auth/profile', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.userId).select('-password');
        if (!user) {
            return res.status(404).json({ success: false, error: 'Пользователь не найден' });
        }
        
        // Получаем статистику пользователя
        const tasksStats = await Task.aggregate([
            { $match: { client: user._id } },
            { $group: {
                _id: '$status',
                count: { $sum: 1 },
                totalPrice: { $sum: '$price' }
            }}
        ]);
        
        const statistics = {
            totalTasks: 0,
            completedTasks: 0,
            totalSpent: 0,
            averageRating: user.rating
        };
        
        tasksStats.forEach(stat => {
            statistics.totalTasks += stat.count;
            if (stat._id === 'completed') {
                statistics.completedTasks = stat.count;
                statistics.totalSpent = stat.totalPrice || 0;
            }
        });
        
        res.json({
            success: true,
            data: {
                user,
                statistics
            }
        });
        
    } catch (error) {
        logger.error('Ошибка профиля:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения профиля' });
    }
});

// Категории услуг
app.get('/api/services/categories', async (req, res) => {
    try {
        const categories = [
            {
                id: 'home_and_household',
                name: 'Дом и быт',
                icon: '🏠',
                description: 'Уборка, ремонт, организация пространства',
                color: '#4CAF50',
                subcategories: ['Уборка', 'Ремонт', 'Переезд', 'Организация']
            },
            {
                id: 'family_and_children',
                name: 'Дети и семья',
                icon: '👨‍👩‍👧‍👦',
                description: 'Няни, репетиторы, семейные мероприятия',
                color: '#2196F3',
                subcategories: ['Няня', 'Репетитор', 'Детский праздник', 'Семейный психолог']
            },
            {
                id: 'beauty_and_health',
                name: 'Красота и здоровье',
                icon: '💅',
                description: 'Маникюр, стилисты, фитнес-тренеры',
                color: '#E91E63',
                subcategories: ['Маникюр', 'Парикмахер', 'Визажист', 'Массаж', 'Фитнес-тренер']
            },
            {
                id: 'courses_and_education',
                name: 'Курсы и образование',
                icon: '🎓',
                description: 'Онлайн и оффлайн курсы, обучение',
                color: '#9C27B0',
                subcategories: ['Языки', 'Кулинария', 'Рукоделие', 'ИТ-курсы', 'Бизнес']
            },
            {
                id: 'pets',
                name: 'Питомцы',
                icon: '🐶',
                description: 'Выгул, передержка, ветеринары',
                color: '#FF9800',
                subcategories: ['Выгул', 'Передержка', 'Груминг', 'Ветеринар']
            },
            {
                id: 'events_and_entertainment',
                name: 'Мероприятия и развлечения',
                icon: '🎉',
                description: 'Организация праздников, билеты',
                color: '#00BCD4',
                subcategories: ['Организация', 'Кейтеринг', 'Аниматоры', 'Билеты']
            }
        ];
        
        res.json({
            success: true,
            data: { categories }
        });
        
    } catch (error) {
        logger.error('Ошибка категорий:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения категорий' });
    }
});

// Список услуг
app.get('/api/services', async (req, res) => {
    try {
        const { category, popular, limit = 20, page = 1 } = req.query;
        
        const filter = { isActive: true };
        if (category) filter.category = category;
        if (popular === 'true') filter.isPopular = true;
        
        const skip = (page - 1) * limit;
        
        const services = await Service.find(filter)
            .sort({ order: 1, createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));
        
        const total = await Service.countDocuments(filter);
        
        res.json({
            success: true,
            data: {
                services,
                pagination: {
                    total,
                    page: parseInt(page),
                    pages: Math.ceil(total / limit),
                    limit: parseInt(limit)
                }
            }
        });
        
    } catch (error) {
        logger.error('Ошибка услуг:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения услуг' });
    }
});

// Создание задачи
app.post('/api/tasks', authenticateToken, upload.array('attachments', 5), async (req, res) => {
    try {
        const { 
            title, 
            description, 
            category, 
            subcategory,
            deadline, 
            price, 
            priority = 'medium',
            address,
            city,
            tags
        } = req.body;
        
        if (!title || !description || !category || !deadline || !price) {
            return res.status(400).json({ 
                success: false, 
                error: 'Заполните все обязательные поля' 
            });
        }
        
        const user = await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({ success: false, error: 'Пользователь не найден' });
        }
        
        // Проверяем подписку пользователя
        if (user.subscription.status !== 'active' && user.role === 'client') {
            return res.status(402).json({ 
                success: false, 
                error: 'Для создания задач требуется активная подписка' 
            });
        }
        
        const task = new Task({
            title,
            description,
            category,
            subcategory,
            client: user._id,
            deadline: new Date(deadline),
            price: parseFloat(price),
            priority,
            location: {
                address,
                city
            },
            tags: tags ? tags.split(',').map(tag => tag.trim()) : [],
            status: 'new'
        });
        
        // Добавляем вложения если есть
        if (req.files && req.files.length > 0) {
            task.attachments = req.files.map(file => ({
                filename: file.originalname,
                path: file.path,
                mimetype: file.mimetype,
                size: file.size
            }));
        }
        
        await task.save();
        
        // Отправляем уведомление через Socket.IO
        io.emit('new_task', {
            taskId: task._id,
            taskNumber: task.taskNumber,
            title: task.title,
            category: task.category,
            price: task.price,
            clientName: `${user.firstName} ${user.lastName}`
        });
        
        // Уведомляем администраторов в Telegram
        if (telegramBot) {
            const admins = await User.find({ role: { $in: ['admin', 'superadmin'] }, telegramId: { $ne: null } });
            admins.forEach(admin => {
                telegramBot.sendMessage(
                    admin.telegramId,
                    `📋 *Новая задача!*\n\n` +
                    `№: ${task.taskNumber}\n` +
                    `🎯 ${title}\n` +
                    `👤 ${user.firstName} ${user.lastName}\n` +
                    `🏷️ ${category}\n` +
                    `💰 ${price} руб.\n` +
                    `📅 ${moment(deadline).format('DD.MM.YYYY')}`,
                    { parse_mode: 'Markdown' }
                );
            });
        }
        
        logger.info(`Создана задача ${task.taskNumber} пользователем ${user.email}`);
        
        res.status(201).json({
            success: true,
            message: 'Задача успешно создана',
            data: {
                task: {
                    id: task._id,
                    taskNumber: task.taskNumber,
                    title: task.title,
                    status: task.status,
                    price: task.price,
                    deadline: task.deadline,
                    createdAt: task.createdAt
                }
            }
        });
        
    } catch (error) {
        logger.error('Ошибка создания задачи:', error);
        res.status(500).json({ success: false, error: 'Ошибка создания задачи' });
    }
});

// Список задач (с фильтрацией)
app.get('/api/tasks', authenticateToken, async (req, res) => {
    try {
        const { 
            status, 
            category, 
            priority,
            page = 1, 
            limit = 20,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;
        
        const user = await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({ success: false, error: 'Пользователь не найден' });
        }
        
        let filter = {};
        
        // Для клиентов показываем только их задачи
        if (user.role === 'client') {
            filter.client = user._id;
        }
        // Для исполнителей показываем назначенные задачи
        else if (user.role === 'performer') {
            filter.performer = user._id;
        }
        // Админы видят все задачи
        
        if (status) filter.status = status;
        if (category) filter.category = category;
        if (priority) filter.priority = priority;
        
        const skip = (page - 1) * limit;
        const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };
        
        const tasks = await Task.find(filter)
            .populate('client', 'firstName lastName email avatar')
            .populate('performer', 'firstName lastName email avatar')
            .sort(sort)
            .skip(skip)
            .limit(parseInt(limit));
        
        const total = await Task.countDocuments(filter);
        
        // Статистика по статусам
        const statusStats = await Task.aggregate([
            { $match: filter },
            { $group: {
                _id: '$status',
                count: { $sum: 1 },
                totalPrice: { $sum: '$price' }
            }}
        ]);
        
        res.json({
            success: true,
            data: {
                tasks,
                statistics: {
                    total,
                    byStatus: statusStats.reduce((acc, stat) => {
                        acc[stat._id] = stat.count;
                        return acc;
                    }, {}),
                    totalValue: statusStats.reduce((sum, stat) => sum + (stat.totalPrice || 0), 0)
                },
                pagination: {
                    total,
                    page: parseInt(page),
                    pages: Math.ceil(total / limit),
                    limit: parseInt(limit)
                }
            }
        });
        
    } catch (error) {
        logger.error('Ошибка получения задач:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения задач' });
    }
});

// Детали задачи
app.get('/api/tasks/:id', authenticateToken, async (req, res) => {
    try {
        const task = await Task.findById(req.params.id)
            .populate('client', 'firstName lastName email phone avatar rating')
            .populate('performer', 'firstName lastName email phone avatar rating')
            .populate({
                path: 'client',
                select: '-password'
            })
            .populate({
                path: 'performer',
                select: '-password'
            });
        
        if (!task) {
            return res.status(404).json({ success: false, error: 'Задача не найдена' });
        }
        
        // Проверяем доступ
        const user = await User.findById(req.userId);
        const canView = user.role === 'admin' || 
                       user.role === 'superadmin' ||
                       task.client._id.equals(user._id) ||
                       (task.performer && task.performer._id.equals(user._id));
        
        if (!canView) {
            return res.status(403).json({ success: false, error: 'Доступ запрещен' });
        }
        
        res.json({
            success: true,
            data: { task }
        });
        
    } catch (error) {
        logger.error('Ошибка получения задачи:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения задачи' });
    }
});

// Отмена задачи
app.post('/api/tasks/:id/cancel', authenticateToken, async (req, res) => {
    try {
        const { reason } = req.body;
        
        const task = await Task.findById(req.params.id);
        if (!task) {
            return res.status(404).json({ success: false, error: 'Задача не найдена' });
        }
        
        const user = await User.findById(req.userId);
        if (!task.client.equals(user._id) && user.role !== 'admin' && user.role !== 'superadmin') {
            return res.status(403).json({ success: false, error: 'Только клиент или администратор может отменить задачу' });
        }
        
        if (task.status === 'completed' || task.status === 'cancelled') {
            return res.status(400).json({ 
                success: false, 
                error: 'Нельзя отменить завершенную или уже отмененную задачу' 
            });
        }
        
        task.status = 'cancelled';
        task.cancellationReason = reason;
        task.updatedAt = new Date();
        
        await task.save();
        
        // Уведомляем исполнителя если есть
        if (task.performer) {
            const performer = await User.findById(task.performer);
            if (performer && performer.telegramId && telegramBot) {
                telegramBot.sendMessage(
                    performer.telegramId,
                    `❌ *Задача отменена*\n\n` +
                    `№: ${task.taskNumber}\n` +
                    `🎯 ${task.title}\n` +
                    `📝 Причина: ${reason || 'Не указана'}\n` +
                    `⏰ ${moment().format('DD.MM.YYYY HH:mm')}`,
                    { parse_mode: 'Markdown' }
                );
            }
        }
        
        logger.info(`Задача ${task.taskNumber} отменена пользователем ${user.email}`);
        
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

// Возобновление задачи (откат на этап присвоения номера)
app.post('/api/tasks/:id/reopen', authenticateToken, async (req, res) => {
    try {
        const task = await Task.findById(req.params.id);
        if (!task) {
            return res.status(404).json({ success: false, error: 'Задача не найдена' });
        }
        
        const user = await User.findById(req.userId);
        if (!task.client.equals(user._id) && user.role !== 'admin' && user.role !== 'superadmin') {
            return res.status(403).json({ success: false, error: 'Только клиент или администратор может возобновить задачу' });
        }
        
        if (task.status !== 'cancelled') {
            return res.status(400).json({ 
                success: false, 
                error: 'Можно возобновить только отмененные задачи' 
            });
        }
        
        // Откатываем задачу на этап "новая"
        task.status = 'new';
        task.cancellationReason = undefined;
        task.performer = undefined;
        task.updatedAt = new Date();
        
        await task.save();
        
        // Уведомляем администраторов
        if (telegramBot) {
            const admins = await User.find({ role: { $in: ['admin', 'superadmin'] }, telegramId: { $ne: null } });
            admins.forEach(admin => {
                telegramBot.sendMessage(
                    admin.telegramId,
                    `🔄 *Задача возобновлена*\n\n` +
                    `№: ${task.taskNumber}\n` +
                    `🎯 ${task.title}\n` +
                    `👤 ${user.firstName} ${user.lastName}\n` +
                    `⏰ ${moment().format('DD.MM.YYYY HH:mm')}`,
                    { parse_mode: 'Markdown' }
                );
            });
        }
        
        logger.info(`Задача ${task.taskNumber} возобновлена пользователем ${user.email}`);
        
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

// Завершение задачи с оценкой
app.post('/api/tasks/:id/complete', authenticateToken, async (req, res) => {
    try {
        const { rating, feedback, paymentMethod = 'cash' } = req.body;
        
        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({ 
                success: false, 
                error: 'Укажите оценку от 1 до 5' 
            });
        }
        
        const task = await Task.findById(req.params.id);
        if (!task) {
            return res.status(404).json({ success: false, error: 'Задача не найдена' });
        }
        
        const user = await User.findById(req.userId);
        if (!task.client.equals(user._id) && user.role !== 'admin' && user.role !== 'superadmin') {
            return res.status(403).json({ success: false, error: 'Только клиент может завершить задачу' });
        }
        
        if (task.status !== 'in_progress' && task.status !== 'assigned') {
            return res.status(400).json({ 
                success: false, 
                error: 'Задача должна быть в работе' 
            });
        }
        
        // Обновляем задачу
        task.status = 'completed';
        task.rating = rating;
        task.feedback = {
            text: feedback,
            createdAt: new Date()
        };
        task.paymentStatus = 'paid';
        task.paymentMethod = paymentMethod;
        task.updatedAt = new Date();
        
        await task.save();
        
        // Обновляем рейтинг исполнителя
        if (task.performer) {
            const performer = await User.findById(task.performer);
            if (performer) {
                // Пересчитываем средний рейтинг
                const performerTasks = await Task.find({ 
                    performer: performer._id, 
                    rating: { $exists: true } 
                });
                
                const totalRating = performerTasks.reduce((sum, t) => sum + (t.rating || 0), 0) + rating;
                const taskCount = performerTasks.length + 1;
                
                performer.rating = totalRating / taskCount;
                await performer.save();
                
                // Уведомляем исполнителя
                if (performer.telegramId && telegramBot) {
                    telegramBot.sendMessage(
                        performer.telegramId,
                        `✅ *Задача завершена!*\n\n` +
                        `№: ${task.taskNumber}\n` +
                        `🎯 ${task.title}\n` +
                        `⭐ Оценка: ${rating}/5\n` +
                        `💬 Отзыв: ${feedback ? feedback.substring(0, 100) + '...' : 'Нет отзыва'}\n` +
                        `💰 Заработано: ${task.price} руб.`,
                        { parse_mode: 'Markdown' }
                    );
                }
            }
        }
        
        // Обновляем статистику клиента
        user.rating = ((user.rating || 0) + rating) / 2;
        await user.save();
        
        logger.info(`Задача ${task.taskNumber} завершена с оценкой ${rating}`);
        
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
app.get('/api/admin/stats', authenticateToken, requireRole('admin', 'superadmin'), async (req, res) => {
    try {
        const today = new Date();
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const startOfWeek = new Date(today.setDate(today.getDate() - today.getDay()));
        
        const [
            usersStats,
            tasksStats,
            revenueStats,
            categoryStats,
            recentUsers,
            recentTasks
        ] = await Promise.all([
            // Статистика пользователей
            User.aggregate([
                { $group: { 
                    _id: '$role', 
                    count: { $sum: 1 },
                    active: { $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] } }
                }}
            ]),
            
            // Статистика задач
            Task.aggregate([
                { $group: { 
                    _id: '$status', 
                    count: { $sum: 1 },
                    totalPrice: { $sum: '$price' }
                }}
            ]),
            
            // Выручка
            Task.aggregate([
                { $match: { paymentStatus: 'paid' } },
                { $group: { 
                    _id: null, 
                    total: { $sum: '$price' },
                    thisMonth: { 
                        $sum: { 
                            $cond: [
                                { $gte: ['$createdAt', startOfMonth] },
                                '$price',
                                0
                            ]
                        }
                    },
                    thisWeek: { 
                        $sum: { 
                            $cond: [
                                { $gte: ['$createdAt', startOfWeek] },
                                '$price',
                                0
                            ]
                        }
                    }
                }}
            ]),
            
            // По категориям
            Task.aggregate([
                { $group: { 
                    _id: '$category', 
                    count: { $sum: 1 },
                    revenue: { $sum: '$price' }
                }},
                { $sort: { revenue: -1 } }
            ]),
            
            // Новые пользователи (последние 7 дней)
            User.find({ 
                createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } 
            })
            .sort({ createdAt: -1 })
            .limit(10)
            .select('firstName lastName email role createdAt'),
            
            // Последние задачи
            Task.find()
            .populate('client', 'firstName lastName')
            .populate('performer', 'firstName lastName')
            .sort({ createdAt: -1 })
            .limit(10)
            .select('taskNumber title status price createdAt')
        ]);
        
        res.json({
            success: true,
            data: {
                summary: {
                    totalUsers: await User.countDocuments(),
                    totalTasks: await Task.countDocuments(),
                    totalRevenue: revenueStats[0]?.total || 0,
                    monthlyRevenue: revenueStats[0]?.thisMonth || 0,
                    weeklyRevenue: revenueStats[0]?.thisWeek || 0,
                    activeUsers: await User.countDocuments({ isActive: true })
                },
                usersByRole: usersStats,
                tasksByStatus: tasksStats,
                categories: categoryStats,
                recentActivity: {
                    newUsers: recentUsers,
                    recentTasks: recentTasks
                },
                charts: {
                    dailyTasks: await getDailyTasksChart(30),
                    revenueByCategory: categoryStats.map(cat => ({
                        category: cat._id,
                        revenue: cat.revenue
                    }))
                }
            }
        });
        
    } catch (error) {
        logger.error('Ошибка статистики:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения статистики' });
    }
});

// Вспомогательная функция для графика задач
async function getDailyTasksChart(days = 30) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    const tasksByDay = await Task.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        { $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 },
            revenue: { $sum: "$price" }
        }},
        { $sort: { _id: 1 } }
    ]);
    
    return tasksByDay;
}

// Экспорт данных в Excel
app.get('/api/admin/export/:type', authenticateToken, requireRole('admin', 'superadmin'), async (req, res) => {
    try {
        const { type } = req.params;
        const { startDate, endDate, format = 'excel' } = req.query;
        
        let data;
        let filename;
        
        const filter = {};
        if (startDate && endDate) {
            filter.createdAt = {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            };
        }
        
        switch (type) {
            case 'users':
                data = await User.find(filter).select('-password');
                filename = `users_export_${moment().format('YYYY-MM-DD')}`;
                break;
                
            case 'tasks':
                data = await Task.find(filter)
                    .populate('client', 'firstName lastName email')
                    .populate('performer', 'firstName lastName email');
                filename = `tasks_export_${moment().format('YYYY-MM-DD')}`;
                break;
                
            case 'services':
                data = await Service.find(filter);
                filename = `services_export_${moment().format('YYYY-MM-DD')}`;
                break;
                
            default:
                return res.status(400).json({ 
                    success: false, 
                    error: 'Неверный тип экспорта' 
                });
        }
        
        if (format === 'excel') {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet(type);
            
            // Добавляем заголовки в зависимости от типа
            if (type === 'users') {
                worksheet.columns = [
                    { header: 'ID', key: 'id', width: 30 },
                    { header: 'Имя', key: 'firstName', width: 15 },
                    { header: 'Фамилия', key: 'lastName', width: 15 },
                    { header: 'Email', key: 'email', width: 25 },
                    { header: 'Роль', key: 'role', width: 10 },
                    { header: 'Телефон', key: 'phone', width: 15 },
                    { header: 'Telegram ID', key: 'telegramId', width: 15 },
                    { header: 'Рейтинг', key: 'rating', width: 10 },
                    { header: 'Подписка', key: 'subscriptionPlan', width: 10 },
                    { header: 'Статус', key: 'status', width: 10 },
                    { header: 'Дата регистрации', key: 'createdAt', width: 20 }
                ];
                
                data.forEach(user => {
                    worksheet.addRow({
                        id: user._id.toString(),
                        firstName: user.firstName,
                        lastName: user.lastName,
                        email: user.email,
                        role: user.role,
                        phone: user.phone || '',
                        telegramId: user.telegramId || '',
                        rating: user.rating || 0,
                        subscriptionPlan: user.subscription?.plan || 'free',
                        status: user.isActive ? 'Активен' : 'Неактивен',
                        createdAt: moment(user.createdAt).format('DD.MM.YYYY HH:mm')
                    });
                });
            } else if (type === 'tasks') {
                worksheet.columns = [
                    { header: 'Номер задачи', key: 'taskNumber', width: 20 },
                    { header: 'Название', key: 'title', width: 30 },
                    { header: 'Описание', key: 'description', width: 40 },
                    { header: 'Клиент', key: 'clientName', width: 25 },
                    { header: 'Исполнитель', key: 'performerName', width: 25 },
                    { header: 'Категория', key: 'category', width: 15 },
                    { header: 'Статус', key: 'status', width: 15 },
                    { header: 'Приоритет', key: 'priority', width: 10 },
                    { header: 'Цена', key: 'price', width: 15 },
                    { header: 'Срок', key: 'deadline', width: 15 },
                    { header: 'Оценка', key: 'rating', width: 10 },
                    { header: 'Дата создания', key: 'createdAt', width: 20 }
                ];
                
                data.forEach(task => {
                    worksheet.addRow({
                        taskNumber: task.taskNumber,
                        title: task.title,
                        description: task.description,
                        clientName: task.client ? `${task.client.firstName} ${task.client.lastName}` : 'Не указан',
                        performerName: task.performer ? `${task.performer.firstName} ${task.performer.lastName}` : 'Не назначен',
                        category: task.category,
                        status: task.status,
                        priority: task.priority,
                        price: task.price,
                        deadline: moment(task.deadline).format('DD.MM.YYYY'),
                        rating: task.rating || 'Нет',
                        createdAt: moment(task.createdAt).format('DD.MM.YYYY HH:mm')
                    });
                });
            }
            
            // Сохраняем файл
            const filePath = `exports/${filename}.xlsx`;
            await workbook.xlsx.writeFile(filePath);
            
            res.download(filePath, `${filename}.xlsx`, (err) => {
                if (err) {
                    logger.error('Ошибка отправки файла:', err);
                }
                // Удаляем файл после отправки
                fs.unlink(filePath, () => {});
            });
            
        } else {
            // JSON экспорт
            res.json({
                success: true,
                data,
                count: data.length,
                exported_at: new Date().toISOString(),
                format: 'json'
            });
        }
        
    } catch (error) {
        logger.error('Ошибка экспорта:', error);
        res.status(500).json({ success: false, error: 'Ошибка экспорта данных' });
    }
});

// Socket.IO соединения
io.on('connection', (socket) => {
    logger.info('Новое подключение Socket.IO:', socket.id);
    
    socket.on('join_task', (taskId) => {
        socket.join(`task_${taskId}`);
    });
    
    socket.on('task_update', async (data) => {
        const { taskId, status, message } = data;
        io.to(`task_${taskId}`).emit('task_updated', {
            taskId,
            status,
            message,
            timestamp: new Date().toISOString()
        });
    });
    
    socket.on('disconnect', () => {
        logger.info('Отключение Socket.IO:', socket.id);
    });
});

// 404 обработчик
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Маршрут не найден',
        path: req.originalUrl,
        method: req.method
    });
});

// Обработчик ошибок
app.use((err, req, res, next) => {
    logger.error('Глобальная ошибка:', {
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method,
        ip: req.ip
    });
    
    res.status(err.status || 500).json({
        success: false,
        error: process.env.NODE_ENV === 'production' 
            ? 'Внутренняя ошибка сервера' 
            : err.message
    });
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🚀 ЗАПУСК ЖЕНСКОГО КОНСЬЕРЖ СЕРВИСА v4.0.0');
        console.log('='.repeat(80));
        
        // Подключаем базу данных
        console.log('🗄️  Подключение к MongoDB...');
        const dbConnected = await connectDB();
        
        if (dbConnected) {
            console.log('✅ База данных подключена');
            
            // Создаем тестовые данные если база пуста
            await createTestData();
        } else {
            console.log('⚠️  База данных не подключена. Работаем в режиме заглушки');
        }
        
        // Инициализируем Telegram бота
        console.log('🤖 Инициализация Telegram бота...');
        await initializeTelegramBot();
        
        const PORT = process.env.PORT || 3000;
        
        http.listen(PORT, '0.0.0.0', () => {
            console.log(`✅ Сервер запущен на порту ${PORT}`);
            console.log(`✅ Socket.IO доступен на порту ${PORT}`);
            console.log('📋 ДОСТУПНЫЕ ЭНДПОИНТЫ:');
            console.log(`🌐 http://localhost:${PORT}/`);
            console.log(`📊 http://localhost:${PORT}/health`);
            console.log(`🔐 http://localhost:${PORT}/api/auth/register`);
            console.log(`🔐 http://localhost:${PORT}/api/auth/login`);
            console.log(`📋 http://localhost:${PORT}/api/services`);
            console.log(`📝 http://localhost:${PORT}/api/tasks`);
            console.log(`👑 http://localhost:${PORT}/api/admin/stats`);
            console.log('='.repeat(80));
            console.log('🎀 ПРИЛОЖЕНИЕ ГОТОВО К РАБОТЕ!');
            console.log('='.repeat(80));
            console.log('\n📋 РЕАЛИЗОВАННЫЙ ФУНКЦИОНАЛ:');
            console.log('• ✅ 4 роли пользователей (клиент, исполнитель, админ, суперадмин)');
            console.log('• ✅ Полный цикл задач: создание → отмена → возобновление → завершение');
            console.log('• ✅ Система рейтингов и отзывов (как в Яндекс)');
            console.log('• ✅ Telegram бот интеграция с регистрацией через бота');
            console.log('• ✅ Real-time уведомления через Socket.IO');
            console.log('• ✅ Административная панель со статистикой');
            console.log('• ✅ Экспорт данных в Excel (CSV для администраторов)');
            console.log('• ✅ Система подписок для клиентов');
            console.log('• ✅ JWT аутентификация и авторизация');
            console.log('• ✅ Загрузка файлов и вложений');
            console.log('• ✅ Полноценная MongoDB база с индексами');
            console.log('• ✅ Генерация номеров задач по шаблону TASK-ГГММДД-XXXX');
            console.log('• ✅ Фильтрация и пагинация для всех списков');
            console.log('='.repeat(80));
        });
        
    } catch (error) {
        logger.error('Не удалось запустить сервер:', error);
        console.error('❌ Не удалось запустить сервер:', error.message);
        process.exit(1);
    }
};

// Создание тестовых данных
async function createTestData() {
    try {
        const usersCount = await User.countDocuments();
        
        if (usersCount === 0) {
            console.log('📝 Создание тестовых данных...');
            
            // Создаем суперадминистратора
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
            
            // Создаем администратора
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
            
            // Создаем тестового клиента
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
            
            // Создаем тестового исполнителя
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
            
            console.log(`✅ Создано 4 тестовых пользователя`);
            
            // Создаем тестовые услуги
            const services = [
                {
                    name: 'Генеральная уборка квартиры',
                    description: 'Полная уборка всех комнат, кухни, санузла. Мытье окон, чистка ковров, дезинфекция',
                    category: 'home_and_household',
                    subcategories: ['Уборка', 'Генеральная уборка'],
                    priceOptions: {
                        oneTime: 3000,
                        hourly: 500
                    },
                    duration: 240,
                    isActive: true,
                    isPopular: true,
                    order: 1,
                    tags: ['уборка', 'чистота', 'дом'],
                    rating: {
                        average: 4.8,
                        count: 127
                    }
                },
                {
                    name: 'Няня на день',
                    description: 'Присмотр за ребенком в течение дня, прогулки, развивающие занятия, питание',
                    category: 'family_and_children',
                    subcategories: ['Няня', 'Присмотр'],
                    priceOptions: {
                        oneTime: 2000,
                        hourly: 300
                    },
                    duration: 480,
                    isActive: true,
                    isPopular: true,
                    order: 2,
                    tags: ['дети', 'няня', 'семья'],
                    rating: {
                        average: 4.9,
                        count: 89
                    }
                },
                {
                    name: 'Маникюр на дому',
                    description: 'Комплексный маникюр с покрытием гель-лаком, парафинотерапия, массаж рук',
                    category: 'beauty_and_health',
                    subcategories: ['Маникюр', 'Уход'],
                    priceOptions: {
                        oneTime: 1500,
                        subscription: {
                            monthly: 5000,
                            yearly: 50000
                        }
                    },
                    duration: 90,
                    isActive: true,
                    isPopular: true,
                    order: 3,
                    tags: ['красота', 'маникюр', 'уход'],
                    rating: {
                        average: 4.7,
                        count: 234
                    }
                },
                {
                    name: 'Репетитор по английскому языку',
                    description: 'Индивидуальные занятия английским языком для детей и взрослых, подготовка к экзаменам',
                    category: 'courses_and_education',
                    subcategories: ['Репетитор', 'Языки'],
                    priceOptions: {
                        oneTime: 1000,
                        hourly: 1500,
                        subscription: {
                            monthly: 8000,
                            yearly: 80000
                        }
                    },
                    duration: 60,
                    isActive: true,
                    isPopular: true,
                    order: 4,
                    tags: ['образование', 'английский', 'репетитор'],
                    rating: {
                        average: 4.9,
                        count: 156
                    }
                },
                {
                    name: 'Выгул собаки',
                    description: 'Прогулка с собакой, игры, выполнение команд, фотоотчет для владельца',
                    category: 'pets',
                    subcategories: ['Выгул', 'Питомцы'],
                    priceOptions: {
                        oneTime: 500,
                        hourly: 800,
                        subscription: {
                            monthly: 4000,
                            yearly: 40000
                        }
                    },
                    duration: 60,
                    isActive: true,
                    isPopular: true,
                    order: 5,
                    tags: ['питомцы', 'собака', 'выгул'],
                    rating: {
                        average: 4.8,
                        count: 78
                    }
                }
            ];
            
            await Service.insertMany(services);
            console.log(`✅ Создано ${services.length} тестовых услуг`);
            
            // Создаем тестовые задачи
            const tasks = [
                {
                    title: 'Уборка 3-х комнатной квартиры',
                    description: 'Нужна генеральная уборка после ремонта. Особое внимание кухне и санузлу.',
                    client: client._id,
                    category: 'home_and_household',
                    subcategory: 'Уборка',
                    deadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // +3 дня
                    price: 3500,
                    priority: 'high',
                    status: 'completed',
                    rating: 5,
                    feedback: {
                        text: 'Отличная работа! Все чисто, аккуратно. Обязательно обращусь еще.',
                        createdAt: new Date()
                    },
                    paymentStatus: 'paid',
                    paymentMethod: 'card'
                },
                {
                    title: 'Нужна няня на субботу',
                    description: 'Присмотр за ребенком 5 лет с 10:00 до 18:00. Нужно погулять, покормить, поиграть.',
                    client: client._id,
                    performer: performer._id,
                    category: 'family_and_children',
                    subcategory: 'Няня',
                    deadline: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // +2 дня
                    price: 2500,
                    priority: 'medium',
                    status: 'in_progress',
                    paymentStatus: 'pending'
                },
                {
                    title: 'Маникюр с дизайном',
                    description: 'Хочу маникюр с покрытием и простым дизайном на ногтях. Цвет пастельный.',
                    client: client._id,
                    category: 'beauty_and_health',
                    subcategory: 'Маникюр',
                    deadline: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // +5 дней
                    price: 1800,
                    priority: 'low',
                    status: 'new'
                }
            ];
            
            for (const taskData of tasks) {
                const task = new Task(taskData);
                await task.save();
            }
            
            console.log(`✅ Создано ${tasks.length} тестовых задач`);
            console.log('🎉 Тестовые данные успешно созданы!');
        } else {
            console.log(`📊 В базе уже есть ${usersCount} пользователей`);
        }
        
    } catch (error) {
        console.error('❌ Ошибка создания тестовых данных:', error.message);
    }
}

// Обработка сигналов завершения
process.on('SIGTERM', async () => {
    logger.info('Получен SIGTERM, завершение работы...');
    
    try {
        await mongoose.connection.close();
        logger.info('MongoDB соединение закрыто');
        
        if (telegramBot) {
            telegramBot.stopPolling();
            logger.info('Telegram бот остановлен');
        }
        
        http.close(() => {
            logger.info('HTTP сервер закрыт');
            process.exit(0);
        });
    } catch (error) {
        logger.error('Ошибка при завершении работы:', error);
        process.exit(1);
    }
});

process.on('SIGINT', async () => {
    logger.info('Получен SIGINT, завершение работы...');
    
    try {
        await mongoose.connection.close();
        logger.info('MongoDB соединение закрыто');
        
        if (telegramBot) {
            telegramBot.stopPolling();
            logger.info('Telegram бот остановлен');
        }
        
        process.exit(0);
    } catch (error) {
        logger.error('Ошибка при завершении работы:', error);
        process.exit(1);
    }
});

// Запускаем сервер
startServer();

module.exports = { app, http };
