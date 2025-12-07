const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

// Загрузка переменных окружения
dotenv.config();

// Проверка обязательных переменных
const requiredEnvVars = ['PORT', 'JWT_SECRET'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
    console.error(`❌ Отсутствуют обязательные переменные окружения: ${missingEnvVars.join(', ')}`);
    console.error('Пожалуйста, проверьте файл .env или настройки TimeWeb');
    process.exit(1);
}

const app = express();

// Базовые middleware для TimeWeb
app.use(helmet({
    contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
}));

app.use(cors({
    origin: process.env.FRONTEND_URL || process.env.WEBAPP_URL || '*',
    credentials: true,
}));

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: process.env.FILE_MAX_SIZE || '10mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.FILE_MAX_SIZE || '10mb' }));

// Статические файлы (для TimeWeb)
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Простое подключение к MongoDB для TimeWeb
const connectDB = async () => {
    try {
        const mongoURI = process.env.MONGODB_URI;
        
        if (!mongoURI) {
            console.warn('⚠️  MONGODB_URI не указан. Используем in-memory режим');
            return false;
        }
        
        console.log(`🔗 Подключение к MongoDB: ${mongoURI.split('@')[1] || mongoURI}`);
        
        await mongoose.connect(mongoURI, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            maxPoolSize: 10,
        });
        
        console.log('✅ MongoDB подключена успешно');
        return true;
        
    } catch (error) {
        console.error('❌ Ошибка подключения к MongoDB:', error.message);
        
        // Для TimeWeb: если нет MongoDB, продолжаем без неё
        if (process.env.TIMEWEB_DEPLOYMENT) {
            console.warn('⚠️  TimeWeb: Продолжаем без MongoDB. Некоторые функции будут недоступны.');
            return false;
        }
        
        throw error;
    }
};

// Простые маршруты API для TimeWeb
app.get('/api/v1/health', (req, res) => {
    const health = {
        status: 'OK',
        app: process.env.APP_NAME || 'concierge-app',
        version: process.env.APP_VERSION || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: mongoose.connection?.readyState === 1 ? 'connected' : 'disconnected',
        node: process.version,
        deployment: 'TimeWeb Cloud',
    };
    
    res.json(health);
});

app.get('/api/v1/info', (req, res) => {
    res.json({
        success: true,
        message: '🎀 Женский Консьерж Сервис',
        description: 'Помощь в повседневных делах',
        features: [
            '🏠 Дом и быт',
            '👨‍👩‍👧‍👦 Дети и семья',
            '💅 Красота и здоровье',
            '🎓 Курсы и образование',
            '🐶 Питомцы',
            '🎉 Мероприятия и развлечения'
        ],
        contact: {
            telegram: '@your_support_bot',
            email: 'support@concierge-app.com'
        }
    });
});

// Главная страница
app.get('/', (req, res) => {
    res.json({
        message: '🚀 Добро пожаловать в Женский Консьерж Сервис!',
        version: process.env.APP_VERSION || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        deployment: 'TimeWeb Cloud',
        endpoints: {
            health: '/api/v1/health',
            info: '/api/v1/info',
            api: '/api/v1',
            admin: '/admin (coming soon)'
        },
        documentation: 'Документация будет доступна позже'
    });
});

// Простые заглушки для основных маршрутов
app.get('/api/v1/auth/check', (req, res) => {
    res.json({ success: true, message: 'Auth API работает' });
});

app.get('/api/v1/tasks/test', (req, res) => {
    res.json({ 
        success: true, 
        message: 'Tasks API работает',
        sampleTask: {
            id: 'sample-001',
            title: 'Пример задачи',
            category: 'home',
            status: 'new',
            createdAt: new Date().toISOString()
        }
    });
});

// Telegram webhook для TimeWeb
app.post(`/telegram-webhook/${process.env.BOT_TOKEN}`, (req, res) => {
    console.log('📨 Telegram webhook получен');
    
    // Здесь будет обработка webhook
    res.json({ 
        success: true, 
        message: 'Webhook получен',
        timestamp: new Date().toISOString()
    });
});

// Настройка Telegram bot для TimeWeb
const setupTelegramBot = async () => {
    const token = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    
    if (!token || token === 'your_telegram_bot_token_here') {
        console.log('🤖 Telegram бот отключен (токен не указан)');
        return null;
    }
    
    try {
        const TelegramBot = require('node-telegram-bot-api');
        const bot = new TelegramBot(token);
        
        // Для TimeWeb используем webhook вместо polling
        const webhookUrl = `${process.env.WEBAPP_URL}/telegram-webhook/${token}`;
        
        await bot.setWebHook(webhookUrl);
        console.log(`✅ Telegram webhook установлен: ${webhookUrl}`);
        
        return bot;
    } catch (error) {
        console.error('❌ Ошибка настройки Telegram бота:', error.message);
        return null;
    }
};

// 404 обработчик
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Маршрут не найден',
        path: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString()
    });
});

// Обработчик ошибок
app.use((err, req, res, next) => {
    console.error('❌ Ошибка:', err.message);
    
    res.status(err.status || 500).json({
        success: false,
        error: process.env.NODE_ENV === 'production' 
            ? 'Внутренняя ошибка сервера' 
            : err.message,
        timestamp: new Date().toISOString()
    });
});

// Запуск сервера для TimeWeb
const startServer = async () => {
    try {
        console.log('='.repeat(50));
        console.log('🚀 Запуск Concierge App на TimeWeb Cloud');
        console.log(`📌 App: ${process.env.APP_NAME || 'concierge-app'}`);
        console.log(`📌 Version: ${process.env.APP_VERSION || '1.0.0'}`);
        console.log(`📌 Port: ${process.env.PORT || 3000}`);
        console.log(`📌 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log('='.repeat(50));
        
        // Подключаемся к MongoDB
        const dbConnected = await connectDB();
        
        if (!dbConnected) {
            console.log('⚠️  Работаем без базы данных');
        }
        
        // Настраиваем Telegram бота
        await setupTelegramBot();
        
        const PORT = process.env.PORT || 3000;
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`✅ Сервер запущен на порту ${PORT}`);
            console.log(`🌐 Health check: http://localhost:${PORT}/api/v1/health`);
            console.log(`🌐 API Info: http://localhost:${PORT}/api/v1/info`);
            console.log('='.repeat(50));
            
            if (process.env.WEBAPP_URL) {
                console.log(`🌍 Внешний URL: ${process.env.WEBAPP_URL}`);
            }
            
            if (process.env.BOT_TOKEN && process.env.BOT_TOKEN !== 'your_telegram_bot_token_here') {
                console.log(`🤖 Telegram бот настроен`);
                console.log(`🔗 Webhook: ${process.env.WEBAPP_URL}/telegram-webhook/${process.env.BOT_TOKEN}`);
            }
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        process.exit(1);
    }
};

// Запускаем сервер
startServer();

module.exports = app;
