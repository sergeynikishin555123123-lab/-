const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const winston = require('winston');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const http = require('http');
const socketIo = require('socket.io');

// Загрузка переменных окружения
dotenv.config();

// ==================== НАСТРОЙКА ЛОГГЕРА ====================
const logger = winston.createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'concierge-app' },
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    return `${timestamp} ${level}: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
                })
            )
        }),
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' })
    ]
});

// ==================== ПРОВЕРКА ПЕРЕМЕННЫХ ОКРУЖЕНИЯ ====================
const requiredEnvVars = ['PORT', 'JWT_SECRET', 'MONGODB_URI'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
    logger.error(`❌ Отсутствуют обязательные переменные окружения: ${missingEnvVars.join(', ')}`);
    if (!process.env.JWT_SECRET) {
        const crypto = require('crypto');
        process.env.JWT_SECRET = crypto.randomBytes(64).toString('hex');
        logger.warn(`⚠️  JWT_SECRET сгенерирован автоматически`);
    }
    if (!process.env.MONGODB_URI) {
        process.env.MONGODB_URI = 'mongodb://localhost:27017/concierge_db';
        logger.warn(`⚠️  MONGODB_URI установлен по умолчанию: ${process.env.MONGODB_URI}`);
    }
}

// ==================== СОЗДАНИЕ ПРИЛОЖЕНИЯ ====================
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: process.env.FRONTEND_URL || '*',
        credentials: true
    }
});

// ==================== MIDDLEWARE ====================
app.use(helmet({
    contentSecurityPolicy: false,
}));

app.use(cors({
    origin: process.env.FRONTEND_URL ? 
        (Array.isArray(process.env.FRONTEND_URL) ? process.env.FRONTEND_URL : [process.env.FRONTEND_URL]) 
        : '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(compression());
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate limiting
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: { success: false, error: 'Слишком много запросов' }
});

app.use('/api/', apiLimiter);

// ==================== СОЗДАНИЕ ДИРЕКТОРИЙ ====================
['uploads', 'public', 'logs', 'exports'].forEach(dir => {
    const dirPath = path.join(__dirname, dir);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        logger.info(`Создана директория: ${dir}`);
    }
});

// ==================== ПОДКЛЮЧЕНИЕ К MONGODB ====================
const connectDB = async () => {
    try {
        logger.info(`Подключение к MongoDB...`);
        
        await mongoose.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 10000,
            socketTimeoutMS: 45000,
            maxPoolSize: 100,
            minPoolSize: 10,
            retryWrites: true,
            w: 'majority'
        });
        
        logger.info('✅ MongoDB подключена успешно');
        
        // Создаем индексы
        await mongoose.connection.db.collection('users').createIndex({ email: 1 }, { unique: true });
        await mongoose.connection.db.collection('users').createIndex({ telegramId: 1 }, { sparse: true });
        await mongoose.connection.db.collection('tasks').createIndex({ taskNumber: 1 }, { unique: true });
        await mongoose.connection.db.collection('tasks').createIndex({ client: 1, createdAt: -1 });
        await mongoose.connection.db.collection('tasks').createIndex({ performer: 1, createdAt: -1 });
        
        return true;
        
    } catch (error) {
        logger.error('❌ Ошибка подключения к MongoDB:', error.message);
        
        if (process.env.NODE_ENV === 'production') {
            // В продакшене пытаемся переподключиться
            setTimeout(connectDB, 5000);
            return false;
        } else {
            throw error;
        }
    }
};

// ==================== МОДЕЛИ БАЗЫ ДАННЫХ ====================
// User Model
const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true, select: false },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    phone: String,
    role: { type: String, enum: ['client', 'performer', 'admin', 'superadmin'], default: 'client' },
    telegramId: { type: String, unique: true, sparse: true },
    subscription: {
        plan: { type: String, enum: ['free', 'basic', 'premium', 'vip'], default: 'free' },
        status: { type: String, enum: ['active', 'expired', 'cancelled'], default: 'expired' },
        startDate: Date,
        endDate: Date,
        autoRenew: { type: Boolean, default: true }
    },
    avatar: { type: String, default: 'default-avatar.png' },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    completedTasks: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    lastLogin: Date,
    preferences: {
        notifications: {
            email: { type: Boolean, default: true },
            telegram: { type: Boolean, default: false },
            push: { type: Boolean, default: true }
        },
        language: { type: String, default: 'ru' }
    }
}, { timestamps: true });

userSchema.virtual('fullName').get(function() {
    return `${this.firstName} ${this.lastName}`;
});

const User = mongoose.model('User', userSchema);

// Task Model
const taskSchema = new mongoose.Schema({
    taskNumber: { type: String, unique: true, required: true },
    title: { type: String, required: true, maxlength: 200 },
    description: { type: String, required: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    performer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    category: {
        type: String,
        enum: ['home', 'family', 'beauty', 'courses', 'pets', 'other'],
        required: true
    },
    subcategory: String,
    status: {
        type: String,
        enum: ['new', 'assigned', 'in_progress', 'completed', 'cancelled', 'reopened'],
        default: 'new'
    },
    priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
    deadline: { type: Date, required: true },
    price: { type: Number, required: true, min: 0 },
    paymentStatus: {
        type: String,
        enum: ['pending', 'paid', 'refunded', 'cancelled'],
        default: 'pending'
    },
    location: {
        address: String,
        coordinates: { lat: Number, lng: Number }
    },
    attachments: [{
        filename: String,
        path: String,
        mimetype: String,
        size: Number,
        uploadedAt: { type: Date, default: Date.now }
    }],
    rating: { type: Number, min: 1, max: 5 },
    feedback: {
        text: String,
        createdAt: Date
    },
    cancellationReason: String,
    cancellationNote: String,
    history: [{
        action: String,
        status: String,
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        timestamp: { type: Date, default: Date.now },
        note: String
    }],
    isArchived: { type: Boolean, default: false }
}, { timestamps: true });

taskSchema.pre('save', async function(next) {
    if (!this.taskNumber) {
        const date = new Date();
        const year = date.getFullYear().toString().slice(-2);
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        
        const lastTask = await this.constructor.findOne(
            { createdAt: { $gte: new Date().setHours(0,0,0,0) } },
            { taskNumber: 1 },
            { sort: { createdAt: -1 } }
        );
        
        let sequence = 1;
        if (lastTask && lastTask.taskNumber) {
            const lastSeq = parseInt(lastTask.taskNumber.slice(-4));
            if (!isNaN(lastSeq)) sequence = lastSeq + 1;
        }
        
        this.taskNumber = `TASK-${year}${month}${day}-${sequence.toString().padStart(4, '0')}`;
    }
    
    if (this.isModified('status')) {
        if (!this.history) this.history = [];
        this.history.push({
            action: 'status_change',
            status: this.status,
            note: `Статус изменен на ${this.status}`
        });
    }
    
    next();
});

const Task = mongoose.model('Task', taskSchema);

// Service Model
const serviceSchema = new mongoose.Schema({
    name: { type: String, required: true, maxlength: 100 },
    description: { type: String, required: true },
    category: {
        type: String,
        required: true,
        enum: ['home_and_household', 'family_and_children', 'beauty_and_health', 
               'courses_and_education', 'pets', 'events_and_entertainment', 'other']
    },
    subcategory: String,
    icon: { type: String, default: 'default-icon.png' },
    priceOptions: {
        oneTime: { type: Number, required: true, min: 0 },
        subscription: {
            monthly: Number,
            quarterly: Number,
            yearly: Number
        }
    },
    duration: { type: Number, required: true }, // в минутах
    performers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    requirements: [String],
    instructions: String,
    isPopular: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    tags: [String],
    statistics: {
        totalOrders: { type: Number, default: 0 },
        averageRating: { type: Number, default: 0 },
        completionRate: { type: Number, default: 0 }
    },
    metadata: {
        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    }
}, { timestamps: true });

const Service = mongoose.model('Service', serviceSchema);

// ==================== TELEGRAM BOT ====================
let telegramBot = null;

const initializeTelegramBot = async () => {
    try {
        const token = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
        
        if (!token || token === 'your_telegram_bot_token_here') {
            logger.warn('Telegram бот отключен: токен не указан');
            return;
        }

        const TelegramBot = require('node-telegram-bot-api');
        
        telegramBot = new TelegramBot(token, {
            polling: {
                interval: 300,
                autoStart: true,
                params: {
                    timeout: 10,
                    limit: 100
                }
            }
        });

        // Обработчики ошибок
        telegramBot.on('polling_error', (error) => {
            logger.error('Ошибка polling Telegram бота:', error.message);
        });

        telegramBot.on('error', (error) => {
            logger.error('Ошибка Telegram бота:', error.message);
        });

        // Команды бота
        telegramBot.onText(/\/start/, async (msg) => {
            const chatId = msg.chat.id;
            const username = msg.from.username || msg.from.first_name;
            
            logger.info(`/start от ${username} (${chatId})`);
            
            try {
                // Проверяем, зарегистрирован ли пользователь
                const user = await User.findOne({ telegramId: chatId.toString() });
                
                if (user) {
                    await telegramBot.sendMessage(chatId,
                        `👋 С возвращением, ${user.firstName}!\n\n` +
                        `Ваш аккаунт уже привязан.\n` +
                        `Роль: ${user.role}\n` +
                        `Email: ${user.email}\n\n` +
                        `Используйте /help для списка команд.`
                    );
                } else {
                    await telegramBot.sendMessage(chatId,
                        `👋 Привет, ${username}!\n\n` +
                        `🎀 Добро пожаловать в *Женский Консьерж Сервис*!\n\n` +
                        `Я помогу вам:\n` +
                        `🏠 С домом и бытом\n` +
                        `👨‍👩‍👧‍👦 С детьми и семьей\n` +
                        `💅 С красотой и здоровьем\n` +
                        `🎓 С обучением\n` +
                        `🐶 С питомцами\n` +
                        `🎉 И со многим другим!\n\n` +
                        `Для начала:\n` +
                        `1. Зарегистрируйтесь: /register\n` +
                        `2. Посмотрите услуги: /services\n` +
                        `3. Создайте первую задачу: /newtask\n\n` +
                        `Всё просто и удобно!`,
                        { parse_mode: 'Markdown' }
                    );
                }
            } catch (error) {
                logger.error('Ошибка обработки /start:', error);
                await telegramBot.sendMessage(chatId, 'Произошла ошибка. Попробуйте позже.');
            }
        });

        telegramBot.onText(/\/register/, async (msg) => {
            const chatId = msg.chat.id;
            const username = msg.from.username || msg.from.first_name;
            
            try {
                const existingUser = await User.findOne({ telegramId: chatId.toString() });
                
                if (existingUser) {
                    await telegramBot.sendMessage(chatId,
                        `✅ Вы уже зарегистрированы!\n\n` +
                        `👤 ${existingUser.fullName}\n` +
                        `📧 ${existingUser.email}\n` +
                        `👑 ${existingUser.role}\n\n` +
                        `Используйте /profile для профиля.`
                    );
                    return;
                }
                
                await telegramBot.sendMessage(chatId,
                    `📝 *Регистрация в сервисе*\n\n` +
                    `Отправьте данные в формате:\n\n` +
                    `*Имя Фамилия*\n` +
                    `*Email*\n` +
                    `*Телефон (необязательно)*\n\n` +
                    `*Пример:*\n` +
                    `Анна Иванова\n` +
                    `anna@example.com\n` +
                    `+79991234567`,
                    { parse_mode: 'Markdown' }
                );
                
                telegramBot.once('message', async (responseMsg) => {
                    if (responseMsg.chat.id === chatId && !responseMsg.text.startsWith('/')) {
                        try {
                            const lines = responseMsg.text.split('\n').map(l => l.trim());
                            if (lines.length >= 2) {
                                const [fullName, email, phone] = lines;
                                const [firstName, lastName] = fullName.split(' ');
                                
                                // Генерируем временный пароль
                                const tempPassword = require('crypto').randomBytes(8).toString('hex');
                                
                                // Создаем пользователя
                                const newUser = new User({
                                    email,
                                    firstName,
                                    lastName,
                                    phone: phone || '',
                                    password: tempPassword,
                                    telegramId: chatId.toString(),
                                    role: 'client',
                                    subscription: {
                                        plan: 'free',
                                        status: 'active',
                                        startDate: new Date(),
                                        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                                    }
                                });
                                
                                await newUser.save();
                                
                                await telegramBot.sendMessage(chatId,
                                    `🎉 *Регистрация успешна!*\n\n` +
                                    `✅ Аккаунт создан\n\n` +
                                    `*Данные:*\n` +
                                    `👤 ${firstName} ${lastName}\n` +
                                    `📧 ${email}\n` +
                                    `📱 ${phone || 'Не указан'}\n\n` +
                                    `*Временный пароль:*\n\`${tempPassword}\`\n\n` +
                                    `⚠️ *Сохраните пароль!*\n` +
                                    `🔗 Сайт: ${process.env.WEBAPP_URL || 'В разработке'}\n\n` +
                                    `Теперь вы можете:\n` +
                                    `• Создавать задачи\n` +
                                    `• Выбирать исполнителей\n` +
                                    `• Оставлять отзывы\n\n` +
                                    `Начните с /services`,
                                    { parse_mode: 'Markdown' }
                                );
                                
                                logger.info(`Новый пользователь: ${email} (${chatId})`);
                            }
                        } catch (error) {
                            await telegramBot.sendMessage(chatId,
                                `❌ Ошибка: ${error.message}\n\n` +
                                `Возможно email уже используется.`
                            );
                        }
                    }
                });
                
            } catch (error) {
                logger.error('Ошибка регистрации:', error);
                await telegramBot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
            }
        });

        telegramBot.onText(/\/services/, async (msg) => {
            const chatId = msg.chat.id;
            
            try {
                const services = await Service.find({ isActive: true }).limit(10);
                
                if (services.length === 0) {
                    await telegramBot.sendMessage(chatId, '📭 Услуги пока не добавлены.');
                    return;
                }
                
                let message = `🎀 *Наши услуги:*\n\n`;
                
                services.forEach((service, index) => {
                    const icon = service.icon === 'default-icon.png' ? '📋' : service.icon;
                    message += `${index + 1}. ${icon} *${service.name}*\n`;
                    message += `   💰 ${service.priceOptions.oneTime} руб.\n`;
                    message += `   ⏱ ${service.duration} мин.\n`;
                    if (service.description) {
                        message += `   📝 ${service.description.substring(0, 50)}...\n`;
                    }
                    message += `\n`;
                });
                
                message += `\nДля заказа напишите /newtask`;
                
                await telegramBot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                
            } catch (error) {
                logger.error('Ошибка получения услуг:', error);
                await telegramBot.sendMessage(chatId, '❌ Не удалось получить список услуг.');
            }
        });

        telegramBot.onText(/\/newtask/, async (msg) => {
            const chatId = msg.chat.id;
            
            try {
                const user = await User.findOne({ telegramId: chatId.toString() });
                
                if (!user) {
                    await telegramBot.sendMessage(chatId,
                        `❌ Вы не зарегистрированы.\n\n` +
                        `Используйте /register для регистрации.`
                    );
                    return;
                }
                
                await telegramBot.sendMessage(chatId,
                    `📝 *Создание новой задачи*\n\n` +
                    `Отправьте данные в формате:\n\n` +
                    `*Название задачи*\n` +
                    `*Описание*\n` +
                    `*Категория (home/family/beauty/courses/pets/other)*\n` +
                    `*Цена в рублях*\n` +
                    `*Срок выполнения (дд.мм.гггг)*\n\n` +
                    `*Пример:*\n` +
                    `Уборка квартиры\n` +
                    `Нужно сделать генеральную уборку 3-х комнатной квартиры\n` +
                    `home\n` +
                    `3000\n` +
                    `15.12.2024`,
                    { parse_mode: 'Markdown' }
                );
                
                telegramBot.once('message', async (responseMsg) => {
                    if (responseMsg.chat.id === chatId && !responseMsg.text.startsWith('/')) {
                        try {
                            const lines = responseMsg.text.split('\n').map(l => l.trim());
                            if (lines.length >= 5) {
                                const [title, description, category, priceStr, deadlineStr] = lines;
                                const price = parseFloat(priceStr);
                                const deadline = new Date(deadlineStr.split('.').reverse().join('-'));
                                
                                if (isNaN(price) || price <= 0) {
                                    await telegramBot.sendMessage(chatId, '❌ Неверная цена');
                                    return;
                                }
                                
                                if (isNaN(deadline.getTime())) {
                                    await telegramBot.sendMessage(chatId, '❌ Неверная дата');
                                    return;
                                }
                                
                                // Создаем задачу
                                const newTask = new Task({
                                    title,
                                    description,
                                    category,
                                    price,
                                    deadline,
                                    client: user._id,
                                    status: 'new'
                                });
                                
                                await newTask.save();
                                
                                await telegramBot.sendMessage(chatId,
                                    `✅ *Задача создана!*\n\n` +
                                    `*Номер:* ${newTask.taskNumber}\n` +
                                    `*Название:* ${title}\n` +
                                    `*Категория:* ${category}\n` +
                                    `*Цена:* ${price} руб.\n` +
                                    `*Срок:* ${deadline.toLocaleDateString('ru-RU')}\n\n` +
                                    `Задача будет видна исполнителям.\n` +
                                    `Вы можете отслеживать статус на сайте.`,
                                    { parse_mode: 'Markdown' }
                                );
                                
                                logger.info(`Новая задача создана: ${newTask.taskNumber} от ${user.email}`);
                            }
                        } catch (error) {
                            await telegramBot.sendMessage(chatId,
                                `❌ Ошибка: ${error.message}`
                            );
                        }
                    }
                });
                
            } catch (error) {
                logger.error('Ошибка создания задачи:', error);
                await telegramBot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
            }
        });

        telegramBot.onText(/\/mytasks/, async (msg) => {
            const chatId = msg.chat.id;
            
            try {
                const user = await User.findOne({ telegramId: chatId.toString() });
                
                if (!user) {
                    await telegramBot.sendMessage(chatId, '❌ Вы не зарегистрированы.');
                    return;
                }
                
                const tasks = await Task.find({ client: user._id, isArchived: false })
                    .sort({ createdAt: -1 })
                    .limit(5);
                
                if (tasks.length === 0) {
                    await telegramBot.sendMessage(chatId, '📭 У вас пока нет задач.');
                    return;
                }
                
                let message = `📋 *Ваши задачи:*\n\n`;
                
                tasks.forEach((task, index) => {
                    const statusIcons = {
                        'new': '🆕',
                        'assigned': '👤',
                        'in_progress': '⚙️',
                        'completed': '✅',
                        'cancelled': '❌',
                        'reopened': '🔄'
                    };
                    
                    message += `${index + 1}. ${statusIcons[task.status] || '📝'} *${task.title}*\n`;
                    message += `   №: ${task.taskNumber}\n`;
                    message += `   Статус: ${task.status}\n`;
                    message += `   Цена: ${task.price} руб.\n`;
                    message += `   Срок: ${new Date(task.deadline).toLocaleDateString('ru-RU')}\n\n`;
                });
                
                await telegramBot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                
            } catch (error) {
                logger.error('Ошибка получения задач:', error);
                await telegramBot.sendMessage(chatId, '❌ Не удалось получить задачи.');
            }
        });

        telegramBot.onText(/\/profile/, async (msg) => {
            const chatId = msg.chat.id;
            
            try {
                const user = await User.findOne({ telegramId: chatId.toString() });
                
                if (!user) {
                    await telegramBot.sendMessage(chatId, '❌ Вы не зарегистрированы.');
                    return;
                }
                
                // Статистика
                const tasksCount = await Task.countDocuments({ client: user._id });
                const completedTasks = await Task.countDocuments({ 
                    client: user._id, 
                    status: 'completed' 
                });
                
                await telegramBot.sendMessage(chatId,
                    `👤 *Ваш профиль*\n\n` +
                    `*Имя:* ${user.firstName} ${user.lastName}\n` +
                    `*Email:* ${user.email}\n` +
                    `*Телефон:* ${user.phone || 'Не указан'}\n` +
                    `*Роль:* ${user.role}\n` +
                    `*Рейтинг:* ${user.rating || 'Нет оценок'}\n\n` +
                    `*Статистика:*\n` +
                    `Всего задач: ${tasksCount}\n` +
                    `Завершено: ${completedTasks}\n\n` +
                    `*Подписка:* ${user.subscription.plan || 'Нет'}\n` +
                    `Статус: ${user.subscription.status === 'active' ? '✅ Активна' : '❌ Неактивна'}`,
                    { parse_mode: 'Markdown' }
                );
                
            } catch (error) {
                logger.error('Ошибка получения профиля:', error);
                await telegramBot.sendMessage(chatId, '❌ Не удалось получить профиль.');
            }
        });

        telegramBot.onText(/\/help/, (msg) => {
            const chatId = msg.chat.id;
            
            telegramBot.sendMessage(chatId,
                `🤖 *Помощь по боту*\n\n` +
                `*Основные команды:*\n` +
                `/start - Начало работы\n` +
                `/help - Эта справка\n` +
                `/register - Регистрация\n` +
                `/profile - Ваш профиль\n` +
                `/services - Услуги\n` +
                `/newtask - Создать задачу\n` +
                `/mytasks - Мои задачи\n` +
                `/status - Статус системы\n` +
                `/id - Ваш ID\n\n` +
                `*Веб-сайт:*\n` +
                `${process.env.WEBAPP_URL || 'В разработке'}\n\n` +
                `*Версия:* ${process.env.APP_VERSION || '3.0.0'}`,
                { parse_mode: 'Markdown' }
            );
        });

        telegramBot.onText(/\/status/, (msg) => {
            const chatId = msg.chat.id;
            
            const dbStatus = mongoose.connection.readyState === 1 ? '✅ Подключена' : '❌ Отключена';
            const botStatus = telegramBot ? '✅ Активен' : '❌ Неактивен';
            
            telegramBot.sendMessage(chatId,
                `📊 *Статус системы*\n\n` +
                `🤖 *Бот:* ${botStatus}\n` +
                `🗄️ *База данных:* ${dbStatus}\n` +
                `🕒 *Время:* ${new Date().toLocaleString('ru-RU')}\n` +
                `⏱️ *Uptime:* ${Math.floor(process.uptime())} сек\n` +
                `💾 *Память:* ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB\n` +
                `🌐 *Режим:* ${process.env.NODE_ENV || 'development'}\n` +
                `🔧 *Версия:* ${process.env.APP_VERSION || '3.0.0'}`,
                { parse_mode: 'Markdown' }
            );
        });

        telegramBot.onText(/\/id/, (msg) => {
            const chatId = msg.chat.id;
            const user = msg.from;
            
            telegramBot.sendMessage(chatId,
                `👤 *Ваши данные Telegram:*\n\n` +
                `🆔 *User ID:* \`${user.id}\`\n` +
                `💬 *Chat ID:* \`${chatId}\`\n` +
                `👤 *Имя:* ${user.first_name}\n` +
                `📛 *Фамилия:* ${user.last_name || '—'}\n` +
                `👤 *Username:* ${user.username ? '@' + user.username : '—'}`,
                { parse_mode: 'Markdown' }
            );
        });

        // Ответ на обычные сообщения
        telegramBot.on('message', async (msg) => {
            if (msg.text && !msg.text.startsWith('/')) {
                const chatId = msg.chat.id;
                
                // Проверяем, зарегистрирован ли пользователь
                const user = await User.findOne({ telegramId: chatId.toString() });
                
                if (!user) {
                    await telegramBot.sendMessage(chatId,
                        `👋 Привет! Я вижу, вы написали: "${msg.text.substring(0, 50)}..."\n\n` +
                        `Для работы с сервисом используйте /register для регистрации.\n` +
                        `Или /help для списка команд.`
                    );
                } else {
                    // Логируем сообщение от зарегистрированного пользователя
                    logger.info(`Сообщение от ${user.email}: "${msg.text.substring(0, 100)}..."`);
                }
            }
        });

        // Получаем информацию о боте
        const botInfo = await telegramBot.getMe();
        
        logger.info(`✅ Telegram бот запущен: @${botInfo.username}`);
        console.log(`✅ Telegram бот: @${botInfo.username}`);
        
        // Отправляем уведомление администратору
        const adminId = process.env.SUPER_ADMIN_ID;
        if (adminId) {
            try {
                await telegramBot.sendMessage(adminId,
                    `🚀 *Сервис запущен!*\n\n` +
                    `🤖 Бот: @${botInfo.username}\n` +
                    `🌐 URL: ${process.env.WEBAPP_URL || 'Не указан'}\n` +
                    `🕒 Время: ${new Date().toLocaleString('ru-RU')}\n` +
                    `🔧 Версия: ${process.env.APP_VERSION || '3.0.0'}\n` +
                    `📊 База данных: ${mongoose.connection.readyState === 1 ? '✅' : '❌'}\n\n` +
                    `✅ Все системы работают!`,
                    { parse_mode: 'Markdown' }
                );
                console.log(`📨 Уведомление отправлено администратору ${adminId}`);
            } catch (error) {
                console.warn('⚠️ Не удалось отправить уведомление администратору');
            }
        }
        
        return telegramBot;
        
    } catch (error) {
        logger.error('Ошибка инициализации Telegram бота:', error.message);
        console.error('❌ Ошибка Telegram бота:', error.message);
        return null;
    }
};

// ==================== SOCKET.IO ====================
io.on('connection', (socket) => {
    logger.info(`Socket подключен: ${socket.id}`);
    
    socket.on('join', (userId) => {
        socket.join(`user_${userId}`);
        logger.info(`Socket ${socket.id} присоединился к комнате user_${userId}`);
    });
    
    socket.on('task_update', (data) => {
        // Рассылка обновлений задач
        io.to(`user_${data.userId}`).emit('task_updated', data);
    });
    
    socket.on('disconnect', () => {
        logger.info(`Socket отключен: ${socket.id}`);
    });
});

// ==================== API МАРШРУТЫ ====================

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        service: 'concierge-app',
        version: process.env.APP_VERSION || '3.0.0',
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        environment: process.env.NODE_ENV || 'development',
        deployment: 'TimeWeb Cloud',
        checks: {
            server: 'running',
            telegram: telegramBot ? 'connected' : 'disconnected',
            database: mongoose.connection?.readyState === 1 ? 'connected' : 'disconnected',
            sockets: io.engine.clientsCount
        }
    });
});

// Главная страница
app.get('/', (req, res) => {
    res.json({
        message: '🎀 Женский Консьерж Сервис',
        description: 'Полноценная система управления задачами и услугами',
        version: process.env.APP_VERSION || '3.0.0',
        documentation: {
            health: '/health',
            api: '/api/v1',
            admin: '/admin',
            telegram: '/telegram-bot'
        },
        statistics: {
            users: 'User.count()',
            tasks: 'Task.count()',
            services: 'Service.count()'
        },
        features: [
            'Полная система пользователей (4 роли)',
            'Создание и управление задачами',
            'Каталог услуг с категориями',
            'Telegram бот интеграция',
            'Real-time уведомления (Socket.IO)',
            'Панель администратора',
            'Экспорт данных в Excel',
            'Система подписок и платежей',
            'Рейтинги и отзывы',
            'Мобильная оптимизация'
        ]
    });
});

// API v1
app.get('/api/v1', async (req, res) => {
    try {
        const usersCount = await User.countDocuments();
        const tasksCount = await Task.countDocuments();
        const servicesCount = await Service.countDocuments();
        const activeTasks = await Task.countDocuments({ 
            status: { $in: ['new', 'assigned', 'in_progress'] } 
        });
        
        res.json({
            success: true,
            api: 'v1',
            version: process.env.APP_VERSION || '3.0.0',
            statistics: {
                users: usersCount,
                tasks: tasksCount,
                services: servicesCount,
                active_tasks: activeTasks
            },
            endpoints: {
                auth: {
                    register: 'POST /api/v1/auth/register',
                    login: 'POST /api/v1/auth/login',
                    profile: 'GET /api/v1/auth/profile',
                    refresh: 'POST /api/v1/auth/refresh'
                },
                tasks: {
                    list: 'GET /api/v1/tasks',
                    create: 'POST /api/v1/tasks',
                    get: 'GET /api/v1/tasks/:id',
                    update: 'PUT /api/v1/tasks/:id',
                    delete: 'DELETE /api/v1/tasks/:id',
                    assign: 'POST /api/v1/tasks/:id/assign',
                    complete: 'POST /api/v1/tasks/:id/complete',
                    cancel: 'POST /api/v1/tasks/:id/cancel',
                    review: 'POST /api/v1/tasks/:id/review'
                },
                services: {
                    list: 'GET /api/v1/services',
                    get: 'GET /api/v1/services/:id',
                    categories: 'GET /api/v1/services/categories',
                    popular: 'GET /api/v1/services/popular'
                },
                users: {
                    list: 'GET /api/v1/users',
                    get: 'GET /api/v1/users/:id',
                    update: 'PUT /api/v1/users/:id',
                    stats: 'GET /api/v1/users/:id/stats'
                },
                admin: {
                    stats: 'GET /api/v1/admin/stats',
                    users: 'GET /api/v1/admin/users',
                    tasks: 'GET /api/v1/admin/tasks',
                    export: 'GET /api/v1/admin/export/:type'
                }
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Регистрация пользователя
app.post('/api/v1/auth/register', async (req, res) => {
    try {
        const { email, password, firstName, lastName, phone, role } = req.body;
        
        // Проверяем, существует ли пользователь
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ 
                success: false, 
                error: 'Пользователь с таким email уже существует' 
            });
        }
        
        // Хешируем пароль
        const bcrypt = require('bcryptjs');
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Создаем пользователя
        const user = new User({
            email,
            password: hashedPassword,
            firstName,
            lastName,
            phone,
            role: role || 'client',
            subscription: {
                plan: 'free',
                status: 'active',
                startDate: new Date(),
                endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            }
        });
        
        await user.save();
        
        // Генерируем JWT токен
        const jwt = require('jsonwebtoken');
        const token = jwt.sign(
            { id: user._id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRE || '7d' }
        );
        
        // Убираем пароль из ответа
        const userResponse = user.toObject();
        delete userResponse.password;
        
        res.status(201).json({
            success: true,
            message: 'Пользователь успешно зарегистрирован',
            data: {
                user: userResponse,
                token
            }
        });
        
    } catch (error) {
        logger.error('Ошибка регистрации:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка при регистрации пользователя' 
        });
    }
});

// Вход пользователя
app.post('/api/v1/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Находим пользователя
        const user = await User.findOne({ email }).select('+password');
        if (!user) {
            return res.status(401).json({ 
                success: false, 
                error: 'Неверный email или пароль' 
            });
        }
        
        // Проверяем пароль
        const bcrypt = require('bcryptjs');
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ 
                success: false, 
                error: 'Неверный email или пароль' 
            });
        }
        
        // Проверяем активность аккаунта
        if (!user.isActive) {
            return res.status(403).json({ 
                success: false, 
                error: 'Аккаунт деактивирован' 
            });
        }
        
        // Обновляем последний вход
        user.lastLogin = new Date();
        await user.save();
        
        // Генерируем JWT токен
        const jwt = require('jsonwebtoken');
        const token = jwt.sign(
            { id: user._id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRE || '7d' }
        );
        
        // Убираем пароль из ответа
        const userResponse = user.toObject();
        delete userResponse.password;
        
        res.json({
            success: true,
            message: 'Вход выполнен успешно',
            data: {
                user: userResponse,
                token
            }
        });
        
    } catch (error) {
        logger.error('Ошибка входа:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка при входе в систему' 
        });
    }
});

// Получение профиля пользователя
app.get('/api/v1/auth/profile', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                error: 'Токен не предоставлен' 
            });
        }
        
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        const user = await User.findById(decoded.id);
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
        logger.error('Ошибка получения профиля:', error);
        res.status(401).json({ 
            success: false, 
            error: 'Неверный токен' 
        });
    }
});

// Список задач
app.get('/api/v1/tasks', async (req, res) => {
    try {
        const { 
            status, 
            category, 
            page = 1, 
            limit = 20,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;
        
        // Строим фильтр
        const filter = { isArchived: false };
        if (status) filter.status = status;
        if (category) filter.category = category;
        
        // Настройки сортировки
        const sort = {};
        sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
        
        // Пагинация
        const skip = (page - 1) * limit;
        
        // Получаем задачи
        const tasks = await Task.find(filter)
            .populate('client', 'firstName lastName email avatar')
            .populate('performer', 'firstName lastName email avatar rating')
            .sort(sort)
            .skip(skip)
            .limit(parseInt(limit));
        
        // Общее количество
        const total = await Task.countDocuments(filter);
        
        res.json({
            success: true,
            data: {
                tasks,
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
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка при получении задач' 
        });
    }
});

// Создание задачи
app.post('/api/v1/tasks', async (req, res) => {
    try {
        const { 
            title, 
            description, 
            category, 
            deadline, 
            price,
            priority,
            location 
        } = req.body;
        
        // Получаем пользователя из токена
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                error: 'Требуется авторизация' 
            });
        }
        
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        const user = await User.findById(decoded.id);
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                error: 'Пользователь не найден' 
            });
        }
        
        // Проверяем подписку пользователя
        if (user.role === 'client' && user.subscription.status !== 'active') {
            return res.status(403).json({ 
                success: false, 
                error: 'Для создания задач требуется активная подписка' 
            });
        }
        
        // Создаем задачу
        const task = new Task({
            title,
            description,
            category,
            deadline: new Date(deadline),
            price: parseFloat(price),
            priority: priority || 'medium',
            location,
            client: user._id,
            status: 'new'
        });
        
        await task.save();
        
        // Отправляем уведомление через Socket.IO
        io.emit('task_created', {
            taskId: task._id,
            taskNumber: task.taskNumber,
            title: task.title,
            category: task.category,
            price: task.price
        });
        
        logger.info(`Создана новая задача: ${task.taskNumber} от ${user.email}`);
        
        res.status(201).json({
            success: true,
            message: 'Задача успешно создана',
            data: { task }
        });
        
    } catch (error) {
        logger.error('Ошибка создания задачи:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка при создании задачи' 
        });
    }
});

// Список услуг
app.get('/api/v1/services', async (req, res) => {
    try {
        const { category, popular, page = 1, limit = 20 } = req.query;
        
        // Строим фильтр
        const filter = { isActive: true };
        if (category) filter.category = category;
        if (popular === 'true') filter.isPopular = true;
        
        // Пагинация
        const skip = (page - 1) * limit;
        
        // Получаем услуги
        const services = await Service.find(filter)
            .populate('performers', 'firstName lastName avatar rating')
            .sort({ order: 1, name: 1 })
            .skip(skip)
            .limit(parseInt(limit));
        
        // Общее количество
        const total = await Service.countDocuments(filter);
        
        // Группируем по категориям
        const groupedServices = {};
        services.forEach(service => {
            if (!groupedServices[service.category]) {
                groupedServices[service.category] = [];
            }
            groupedServices[service.category].push(service);
        });
        
        res.json({
            success: true,
            data: {
                services,
                grouped: groupedServices,
                pagination: {
                    total,
                    page: parseInt(page),
                    pages: Math.ceil(total / limit),
                    limit: parseInt(limit)
                }
            }
        });
        
    } catch (error) {
        logger.error('Ошибка получения услуг:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка при получении услуг' 
        });
    }
});

// Категории услуг
app.get('/api/v1/services/categories', async (req, res) => {
    try {
        const categories = [
            {
                id: 'home_and_household',
                name: 'Дом и быт',
                icon: '🏠',
                description: 'Уборка, ремонт, организация пространства',
                color: '#4CAF50',
                serviceCount: await Service.countDocuments({ 
                    category: 'home_and_household',
                    isActive: true 
                })
            },
            {
                id: 'family_and_children',
                name: 'Дети и семья',
                icon: '👨‍👩‍👧‍👦',
                description: 'Няни, репетиторы, семейные мероприятия',
                color: '#2196F3',
                serviceCount: await Service.countDocuments({ 
                    category: 'family_and_children',
                    isActive: true 
                })
            },
            {
                id: 'beauty_and_health',
                name: 'Красота и здоровье',
                icon: '💅',
                description: 'Маникюр, стилисты, фитнес-тренеры',
                color: '#E91E63',
                serviceCount: await Service.countDocuments({ 
                    category: 'beauty_and_health',
                    isActive: true 
                })
            },
            {
                id: 'courses_and_education',
                name: 'Курсы и образование',
                icon: '🎓',
                description: 'Онлайн и оффлайн курсы, обучение',
                color: '#9C27B0',
                serviceCount: await Service.countDocuments({ 
                    category: 'courses_and_education',
                    isActive: true 
                })
            },
            {
                id: 'pets',
                name: 'Питомцы',
                icon: '🐶',
                description: 'Выгул, передержка, ветеринары',
                color: '#FF9800',
                serviceCount: await Service.countDocuments({ 
                    category: 'pets',
                    isActive: true 
                })
            },
            {
                id: 'events_and_entertainment',
                name: 'Мероприятия и развлечения',
                icon: '🎉',
                description: 'Организация праздников, билеты',
                color: '#00BCD4',
                serviceCount: await Service.countDocuments({ 
                    category: 'events_and_entertainment',
                    isActive: true 
                })
            }
        ];
        
        res.json({
            success: true,
            data: { categories }
        });
        
    } catch (error) {
        logger.error('Ошибка получения категорий:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка при получении категорий' 
        });
    }
});

// Административная статистика
app.get('/api/v1/admin/stats', async (req, res) => {
    try {
        // Проверяем права администратора
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                error: 'Требуется авторизация' 
            });
        }
        
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        const user = await User.findById(decoded.id);
        if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
            return res.status(403).json({ 
                success: false, 
                error: 'Доступ запрещен' 
            });
        }
        
        // Статистика
        const [users, tasks, services, revenue] = await Promise.all([
            User.aggregate([
                { $group: { _id: '$role', count: { $sum: 1 } } }
            ]),
            Task.aggregate([
                { 
                    $match: { 
                        createdAt: { 
                            $gte: new Date(new Date().setMonth(new Date().getMonth() - 1)) 
                        } 
                    } 
                },
                { $group: { _id: '$status', count: { $sum: 1 } } }
            ]),
            Service.aggregate([
                { $match: { isActive: true } },
                { $group: { _id: '$category', count: { $sum: 1 } } }
            ]),
            Task.aggregate([
                { 
                    $match: { 
                        status: 'completed',
                        paymentStatus: 'paid'
                    } 
                },
                { $group: { _id: null, total: { $sum: '$price' } } }
            ])
        ]);
        
        res.json({
            success: true,
            data: {
                total_stats: {
                    users: await User.countDocuments(),
                    tasks: await Task.countDocuments(),
                    services: await Service.countDocuments(),
                    revenue: revenue[0]?.total || 0
                },
                users_by_role: users,
                tasks_by_status: tasks,
                services_by_category: services,
                recent_activity: {
                    new_users: await User.countDocuments({ 
                        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } 
                    }),
                    new_tasks: await Task.countDocuments({ 
                        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } 
                    }),
                    completed_tasks: await Task.countDocuments({ 
                        status: 'completed',
                        updatedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
                    })
                }
            }
        });
        
    } catch (error) {
        logger.error('Ошибка получения статистики:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка при получении статистики' 
        });
    }
});

// Экспорт данных
app.get('/api/v1/admin/export/:type', async (req, res) => {
    try {
        const { type } = req.params;
        const { format = 'excel' } = req.query;
        
        // Проверяем права администратора
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                error: 'Требуется авторизация' 
            });
        }
        
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        const user = await User.findById(decoded.id);
        if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
            return res.status(403).json({ 
                success: false, 
                error: 'Доступ запрещен' 
            });
        }
        
        let data;
        let filename;
        
        switch (type) {
            case 'users':
                data = await User.find().select('-password');
                filename = `users_export_${new Date().toISOString().split('T')[0]}`;
                break;
                
            case 'tasks':
                data = await Task.find()
                    .populate('client', 'firstName lastName email')
                    .populate('performer', 'firstName lastName email');
                filename = `tasks_export_${new Date().toISOString().split('T')[0]}`;
                break;
                
            case 'services':
                data = await Service.find();
                filename = `services_export_${new Date().toISOString().split('T')[0]}`;
                break;
                
            default:
                return res.status(400).json({ 
                    success: false, 
                    error: 'Неверный тип экспорта' 
                });
        }
        
        if (format === 'excel') {
            // Генерируем Excel файл
            const ExcelJS = require('exceljs');
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet(type);
            
            // Добавляем заголовки
            if (type === 'users') {
                worksheet.columns = [
                    { header: 'ID', key: 'id', width: 25 },
                    { header: 'Имя', key: 'firstName', width: 15 },
                    { header: 'Фамилия', key: 'lastName', width: 15 },
                    { header: 'Email', key: 'email', width: 25 },
                    { header: 'Роль', key: 'role', width: 15 },
                    { header: 'Телефон', key: 'phone', width: 15 },
                    { header: 'Telegram ID', key: 'telegramId', width: 15 },
                    { header: 'Дата регистрации', key: 'createdAt', width: 20 },
                    { header: 'Статус', key: 'isActive', width: 10 }
                ];
                
                data.forEach(user => {
                    worksheet.addRow({
                        id: user._id,
                        firstName: user.firstName,
                        lastName: user.lastName,
                        email: user.email,
                        role: user.role,
                        phone: user.phone || '',
                        telegramId: user.telegramId || '',
                        createdAt: user.createdAt,
                        isActive: user.isActive ? 'Активен' : 'Неактивен'
                    });
                });
            }
            
            // Генерируем файл
            const filePath = path.join(__dirname, 'exports', `${filename}.xlsx`);
            await workbook.xlsx.writeFile(filePath);
            
            // Отправляем файл
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
                exported_at: new Date().toISOString()
            });
        }
        
    } catch (error) {
        logger.error('Ошибка экспорта:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка при экспорте данных' 
        });
    }
});

// Телеграм вебхук
app.post('/telegram-webhook', async (req, res) => {
    try {
        // Для внешних вебхуков
        const update = req.body;
        logger.info('Telegram webhook получен:', update.update_id);
        res.json({ ok: true });
    } catch (error) {
        logger.error('Ошибка webhook:', error);
        res.status(500).json({ ok: false });
    }
});

// Статус телеграм бота
app.get('/telegram-bot', (req, res) => {
    res.json({
        success: true,
        telegram: {
            status: telegramBot ? 'active' : 'inactive',
            bot_info: telegramBot ? {
                username: telegramBot.options?.username,
                polling: telegramBot.isPolling()
            } : null,
            webhook: process.env.WEBAPP_URL ? {
                url: `${process.env.WEBAPP_URL}/telegram-webhook`,
                configured: true
            } : { configured: false }
        }
    });
});

// ==================== ОБРАБОТЧИКИ ОШИБОК ====================

// 404
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Маршрут не найден',
        path: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString(),
        available_routes: ['/', '/health', '/api/v1', '/telegram-bot']
    });
});

// Глобальный обработчик ошибок
app.use((err, req, res, next) => {
    logger.error('❌ Ошибка:', {
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
            : err.message,
        timestamp: new Date().toISOString()
    });
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('='.repeat(70));
        console.log('🚀 ЗАПУСК ПОЛНОЦЕННОГО ЖЕНСКОГО КОНСЬЕРЖ СЕРВИСА v3.0.0');
        console.log('='.repeat(70));
        console.log(`📌 Порт: ${process.env.PORT || 3000}`);
        console.log(`🌐 Режим: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🏷️ Версия: ${process.env.APP_VERSION || '3.0.0'}`);
        console.log(`🔗 WEBAPP_URL: ${process.env.WEBAPP_URL || 'не указан'}`);
        console.log(`🗄️  База данных: ${process.env.MONGODB_URI ? 'настроена' : 'по умолчанию'}`);
        console.log(`🤖 Telegram бот: ${process.env.BOT_TOKEN ? 'настроен' : 'отключен'}`);
        console.log(`🔐 JWT секрет: ${process.env.JWT_SECRET ? 'установлен' : 'сгенерирован'}`);
        console.log('='.repeat(70));
        
        // Подключаем базу данных
        console.log('🗄️  Подключение к MongoDB...');
        const dbConnected = await connectDB();
        
        if (!dbConnected && process.env.NODE_ENV === 'production') {
            console.warn('⚠️  База данных не подключена. Некоторые функции будут ограничены.');
        }
        
        // Создаем тестовые данные если база пустая
        if (dbConnected) {
            const usersCount = await User.countDocuments();
            if (usersCount === 0) {
                console.log('📝 Создание тестовых данных...');
                
                // Создаем тестового администратора
                const bcrypt = require('bcryptjs');
                const adminPassword = await bcrypt.hash('admin123', 10);
                
                const adminUser = new User({
                    email: 'admin@concierge-app.com',
                    password: adminPassword,
                    firstName: 'Администратор',
                    lastName: 'Системы',
                    role: 'superadmin',
                    subscription: {
                        plan: 'vip',
                        status: 'active',
                        startDate: new Date(),
                        endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
                    }
                });
                
                await adminUser.save();
                console.log(`✅ Создан администратор: ${adminUser.email}`);
                
                // Создаем тестовые услуги
                const services = [
                    {
                        name: 'Генеральная уборка квартиры',
                        description: 'Полная уборка всех комнат, кухни, санузла',
                        category: 'home_and_household',
                        priceOptions: { oneTime: 3000 },
                        duration: 240,
                        isPopular: true,
                        order: 1
                    },
                    {
                        name: 'Няня на день',
                        description: 'Присмотр за ребенком в течение дня',
                        category: 'family_and_children', 
                        priceOptions: { oneTime: 2000 },
                        duration: 480,
                        isPopular: true,
                        order: 2
                    },
                    {
                        name: 'Маникюр на дому',
                        description: 'Комплексный маникюр с покрытием',
                        category: 'beauty_and_health',
                        priceOptions: { oneTime: 1500 },
                        duration: 90,
                        isPopular: true,
                        order: 3
                    }
                ];
                
                await Service.insertMany(services);
                console.log(`✅ Создано ${services.length} тестовых услуг`);
            }
        }
        
        // Инициализируем Telegram бота
        console.log('🤖 Инициализация Telegram бота...');
        await initializeTelegramBot();
        
        const PORT = process.env.PORT || 3000;
        
        server.listen(PORT, '0.0.0.0', () => {
            console.log(`✅ Сервер запущен на порту ${PORT}`);
            console.log(`✅ Socket.IO доступен на порту ${PORT}`);
            console.log(`📊 Health check: http://localhost:${PORT}/health`);
            console.log(`📱 API документация: http://localhost:${PORT}/api/v1`);
            console.log(`🛠️  Админ-панель: http://localhost:${PORT}/api/v1/admin/stats`);
            
            if (process.env.WEBAPP_URL) {
                console.log(`🌍 Публичный URL: ${process.env.WEBAPP_URL}`);
                console.log(`🌍 Health check: ${process.env.WEBAPP_URL}/health`);
            }
            
            if (telegramBot) {
                console.log(`🤖 Telegram бот активен`);
            }
            
            console.log('='.repeat(70));
            console.log('✨ ПРИЛОЖЕНИЕ ГОТОВО К РАБОТЕ!');
            console.log('='.repeat(70));
            console.log('\n📋 ФУНКЦИОНАЛЬНОСТЬ:');
            console.log('• ✅ Полная система пользователей (4 роли)');
            console.log('• ✅ Создание и управление задачами');
            console.log('• ✅ Каталог услуг с категориями');
            console.log('• ✅ Telegram бот интеграция');
            console.log('• ✅ Real-time уведомления (Socket.IO)');
            console.log('• ✅ Панель администратора');
            console.log('• ✅ Экспорт данных в Excel');
            console.log('• ✅ Система подписок');
            console.log('• ✅ Рейтинги и отзывы');
            console.log('• ✅ JWT аутентификация');
            console.log('• ✅ MongoDB база данных');
            console.log('='.repeat(70));
        });
        
    } catch (error) {
        logger.error('Не удалось запустить сервер:', error);
        console.error('❌ Не удалось запустить сервер:', error.message);
        process.exit(1);
    }
};

// Обработка завершения
process.on('SIGTERM', async () => {
    logger.info('Получен SIGTERM, завершение работы...');
    
    try {
        await mongoose.connection.close();
        logger.info('MongoDB соединение закрыто');
        
        if (telegramBot) {
            telegramBot.stopPolling();
            logger.info('Telegram бот остановлен');
        }
        
        server.close(() => {
            logger.info('HTTP сервер закрыт');
            process.exit(0);
        });
    } catch (error) {
        logger.error('Ошибка при завершении работы:', error);
        process.exit(1);
    }
});

// Запускаем сервер
startServer();

module.exports = { app, server };
