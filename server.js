require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const winston = require('winston');

// Инициализация приложения
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// Настройка логгера
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' })
    ]
});

if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.simple()
    }));
}

// Middleware
app.use(cors());
app.use(helmet());
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Подключение к MongoDB
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        logger.info('✅ MongoDB подключена успешно');
        console.log('✅ MongoDB подключена успешно');
    } catch (error) {
        logger.error(`❌ Ошибка подключения к MongoDB: ${error.message}`);
        console.error(`❌ Ошибка подключения к MongoDB: ${error.message}`);
        process.exit(1);
    }
};

// Модели
const User = mongoose.model('User', new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    phone: String,
    role: { type: String, enum: ['client', 'performer', 'admin', 'superadmin'], default: 'client' },
    telegramId: String,
    avatar: String,
    rating: { type: Number, default: 0 },
    subscription: {
        plan: { type: String, enum: ['free', 'basic', 'premium', 'vip'], default: 'free' },
        status: { type: String, enum: ['active', 'expired', 'cancelled'], default: 'active' },
        startDate: Date,
        endDate: Date
    },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
}));

const Task = mongoose.model('Task', new mongoose.Schema({
    taskNumber: { type: String, unique: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    performer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    category: { 
        type: String, 
        enum: ['home', 'family', 'beauty', 'courses', 'pets', 'events', 'other'],
        required: true 
    },
    status: {
        type: String,
        enum: ['new', 'assigned', 'in_progress', 'completed', 'cancelled', 'reopened'],
        default: 'new'
    },
    deadline: { type: Date, required: true },
    price: { type: Number, required: true },
    location: {
        address: String,
        coordinates: { lat: Number, lng: Number }
    },
    rating: { type: Number, min: 1, max: 5 },
    feedback: String,
    cancellationReason: String,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}));

const Service = mongoose.model('Service', new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, required: true },
    category: {
        type: String,
        required: true,
        enum: ['home', 'family', 'beauty', 'courses', 'pets', 'events', 'other']
    },
    priceOptions: {
        oneTime: Number,
        subscription: Number,
        hourly: Number
    },
    duration: Number,
    isActive: { type: Boolean, default: true },
    isPopular: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    tags: [String],
    createdAt: { type: Date, default: Date.now }
}));

// Генерация номера задачи
Task.schema.pre('save', function(next) {
    if (!this.taskNumber) {
        const date = new Date();
        const year = date.getFullYear().toString().slice(-2);
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        const random = Math.floor(1000 + Math.random() * 9000);
        this.taskNumber = `TASK-${year}${month}${day}-${random}`;
    }
    this.updatedAt = new Date();
    next();
});

// Основные маршруты
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        service: 'Женский Консьерж Сервис',
        version: process.env.APP_VERSION,
        timestamp: new Date().toISOString()
    });
});

// API маршруты
app.get('/api/services', async (req, res) => {
    try {
        const services = await Service.find({ isActive: true }).sort({ order: 1 });
        res.json({ success: true, data: services });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/tasks', async (req, res) => {
    try {
        const { title, description, category, deadline, price } = req.body;
        
        const task = new Task({
            title,
            description,
            category,
            deadline: new Date(deadline),
            price,
            status: 'new'
        });

        await task.save();
        
        // Отправляем уведомление через Socket.IO
        io.emit('new_task', { taskNumber: task.taskNumber, title });
        
        res.json({ 
            success: true, 
            message: 'Задача создана успешно', 
            data: { taskNumber: task.taskNumber } 
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/tasks/:id/cancel', async (req, res) => {
    try {
        const task = await Task.findOne({ taskNumber: req.params.id });
        if (!task) {
            return res.status(404).json({ success: false, error: 'Задача не найдена' });
        }
        
        task.status = 'cancelled';
        task.cancellationReason = req.body.reason;
        await task.save();
        
        res.json({ success: true, message: 'Задача отменена' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/tasks/:id/reopen', async (req, res) => {
    try {
        const task = await Task.findOne({ taskNumber: req.params.id });
        if (!task) {
            return res.status(404).json({ success: false, error: 'Задача не найдена' });
        }
        
        task.status = 'reopened';
        await task.save();
        
        res.json({ success: true, message: 'Задача возобновлена' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/tasks/:id/complete', async (req, res) => {
    try {
        const task = await Task.findOne({ taskNumber: req.params.id });
        if (!task) {
            return res.status(404).json({ success: false, error: 'Задача не найдена' });
        }
        
        task.status = 'completed';
        task.rating = req.body.rating;
        task.feedback = req.body.feedback;
        await task.save();
        
        res.json({ success: true, message: 'Задача завершена' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/admin/stats', async (req, res) => {
    try {
        const stats = {
            totalUsers: await User.countDocuments(),
            totalTasks: await Task.countDocuments(),
            completedTasks: await Task.countDocuments({ status: 'completed' }),
            cancelledTasks: await Task.countDocuments({ status: 'cancelled' }),
            totalRevenue: await Task.aggregate([
                { $match: { status: 'completed' } },
                { $group: { _id: null, total: { $sum: '$price' } } }
            ])
        };
        
        res.json({ success: true, data: stats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/admin/export/tasks', async (req, res) => {
    try {
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Tasks');
        
        const tasks = await Task.find().populate('client', 'firstName lastName email');
        
        worksheet.columns = [
            { header: 'Номер', key: 'taskNumber', width: 20 },
            { header: 'Название', key: 'title', width: 30 },
            { header: 'Клиент', key: 'clientName', width: 25 },
            { header: 'Статус', key: 'status', width: 15 },
            { header: 'Цена', key: 'price', width: 15 },
            { header: 'Дата создания', key: 'createdAt', width: 20 }
        ];
        
        tasks.forEach(task => {
            worksheet.addRow({
                taskNumber: task.taskNumber,
                title: task.title,
                clientName: task.client ? `${task.client.firstName} ${task.client.lastName}` : 'Не указан',
                status: task.status,
                price: task.price,
                createdAt: task.createdAt.toLocaleDateString('ru-RU')
            });
        });
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=tasks_export.xlsx');
        
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Telegram бот
const initializeTelegramBot = async () => {
    try {
        const TelegramBot = require('node-telegram-bot-api');
        const token = process.env.BOT_TOKEN;
        
        if (!token || token.includes('your_telegram_bot_token')) {
            logger.info('Telegram бот отключен (токен не указан)');
            return null;
        }
        
        const bot = new TelegramBot(token, { polling: true });
        
        bot.onText(/\/start/, (msg) => {
            const chatId = msg.chat.id;
            bot.sendMessage(chatId, '👋 Добро пожаловать в Женский Консьерж Сервис!');
        });
        
        bot.onText(/\/services/, async (msg) => {
            const chatId = msg.chat.id;
            const services = await Service.find({ isActive: true }).limit(5);
            
            let message = '🎀 *Наши услуги:*\n\n';
            services.forEach(service => {
                message += `• ${service.name}\n`;
                message += `  💰 от ${service.priceOptions.oneTime || service.priceOptions.hourly} руб.\n\n`;
            });
            message += 'Для заказа услуги посетите наш сайт!';
            
            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        });
        
        logger.info('✅ Telegram бот запущен');
        return bot;
    } catch (error) {
        logger.error(`❌ Ошибка Telegram бота: ${error.message}`);
        return null;
    }
};

// Socket.IO для real-time уведомлений
io.on('connection', (socket) => {
    logger.info('Новое подключение Socket.IO');
    
    socket.on('join_task', (taskId) => {
        socket.join(`task_${taskId}`);
    });
    
    socket.on('disconnect', () => {
        logger.info('Отключение Socket.IO');
    });
});

// Запуск сервера
const startServer = async () => {
    try {
        await connectDB();
        
        // Создание тестовых данных если база пустая
        const usersCount = await User.countDocuments();
        if (usersCount === 0) {
            const bcrypt = require('bcryptjs');
            const adminPassword = await bcrypt.hash('admin123', 10);
            
            const adminUser = new User({
                email: 'admin@concierge-app.com',
                password: adminPassword,
                firstName: 'Администратор',
                lastName: 'Системы',
                role: 'superadmin'
            });
            
            await adminUser.save();
            logger.info('Создан тестовый администратор');
        }
        
        await initializeTelegramBot();
        
        const PORT = process.env.PORT || 3000;
        http.listen(PORT, () => {
            logger.info(`✅ Сервер запущен на порту ${PORT}`);
            console.log(`🎀 Женский Консьерж Сервис запущен!`);
            console.log(`🌐 http://localhost:${PORT}`);
            console.log(`📊 Health check: http://localhost:${PORT}/health`);
            console.log(`🔧 Версия: ${process.env.APP_VERSION}`);
        });
    } catch (error) {
        logger.error(`Не удалось запустить сервер: ${error.message}`);
        process.exit(1);
    }
};

startServer();

module.exports = { app, http };
