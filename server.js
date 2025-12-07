const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const winston = require('winston');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const userAgent = require('express-useragent');

// Инициализация логгера
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

// Загрузка переменных окружения
dotenv.config();

const app = express();

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 100, // лимит запросов с одного IP
    message: 'Слишком много запросов с этого IP, попробуйте позже',
    standardHeaders: true,
    legacyHeaders: false,
});

// Глобальный middleware безопасности
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
        },
    },
    crossOriginEmbedderPolicy: false,
}));

app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-telegram-id']
}));

app.use(compression());
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(mongoSanitize());
app.use(xss());
app.use(hpp());
app.use(userAgent.express());

// Применяем rate limiting только к API
app.use('/api/', limiter);

// Статические файлы
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    setHeaders: (res, path) => {
        res.set('Cache-Control', 'public, max-age=86400');
    }
}));
app.use('/public', express.static(path.join(__dirname, 'public')));

// Подключение к MongoDB с улучшенными настройками
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            maxPoolSize: 10,
        });
        
        logger.info('✅ MongoDB подключена успешно');
        console.log('✅ MongoDB подключена успешно');
    } catch (err) {
        logger.error('❌ Ошибка подключения к MongoDB:', err);
        console.error('❌ Ошибка подключения к MongoDB:', err);
        
        // Переподключение через 5 секунд
        setTimeout(connectDB, 5000);
    }
};

// Обработчики событий MongoDB
mongoose.connection.on('connected', () => {
    logger.info('Mongoose подключен к базе данных');
});

mongoose.connection.on('error', (err) => {
    logger.error(`Ошибка соединения Mongoose: ${err}`);
});

mongoose.connection.on('disconnected', () => {
    logger.warn('Mongoose отключен от базы данных');
});

// Инициализация Telegram бота
const { initializeBot } = require('./app/utils/telegramBot');
initializeBot();

// Импорт маршрутов
const authRoutes = require('./app/routes/auth.routes');
const taskRoutes = require('./app/routes/task.routes');
const serviceRoutes = require('./app/routes/service.routes');
const adminRoutes = require('./app/routes/admin.routes');
const userRoutes = require('./app/routes/user.routes');

// Основные маршруты API
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/tasks', taskRoutes);
app.use('/api/v1/services', serviceRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/users', userRoutes);

// Проверка состояния сервера
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        memory: process.memoryUsage(),
        nodeVersion: process.version
    });
});

// Основной маршрут
app.get('/', (req, res) => {
    res.json({
        message: '🚀 Добро пожаловать в API Женского Консьерж-Сервиса',
        version: '1.0.0',
        environment: process.env.NODE_ENV,
        endpoints: {
            auth: '/api/v1/auth',
            tasks: '/api/v1/tasks',
            services: '/api/v1/services',
            admin: '/api/v1/admin',
            health: '/health'
        },
        documentation: 'Документация будет доступна позже'
    });
});

// Тестовый маршрут для проверки безопасности
app.get('/api/v1/test-security', (req, res) => {
    res.json({
        message: 'Защищённый маршрут работает',
        security: {
            mongoSanitize: 'Активен',
            xssClean: 'Активен',
            rateLimit: 'Активен',
            helmet: 'Активен',
            cors: 'Активен'
        }
    });
});

// Обработка 404
app.use('*', (req, res) => {
    logger.warn(`404 Not Found: ${req.method} ${req.originalUrl}`);
    res.status(404).json({
        error: 'Маршрут не найден',
        path: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString()
    });
});

// Глобальный обработчик ошибок
app.use((err, req, res, next) => {
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Внутренняя ошибка сервера';
    
    logger.error('❌ Глобальная ошибка:', {
        error: message,
        stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
        path: req.path,
        method: req.method,
        ip: req.ip,
        userAgent: req.useragent?.source
    });
    
    res.status(statusCode).json({
        success: false,
        error: process.env.NODE_ENV === 'production' && statusCode === 500 
            ? 'Внутренняя ошибка сервера' 
            : message,
        ...(process.env.NODE_ENV !== 'production' && { 
            stack: err.stack,
            details: err.details 
        })
    });
});

// Запуск сервера только после подключения к БД
const startServer = async () => {
    try {
        await connectDB();
        
        const PORT = process.env.PORT || 3000;
        const server = app.listen(PORT, () => {
            logger.info(`🚀 Сервер запущен на порту ${PORT}`);
            console.log(`🚀 Сервер запущен на порту ${PORT}`);
            console.log(`🌐 Домен: sergeynikishin555123123-lab--86fa.twc1.net`);
            console.log(`📊 Проверка состояния: http://localhost:${PORT}/health`);
            console.log(`🔐 Режим: ${process.env.NODE_ENV || 'development'}`);
        });
        
        // Обработка graceful shutdown
        const gracefulShutdown = () => {
            logger.info('Получен сигнал завершения. Закрытие сервера...');
            
            server.close(async () => {
                logger.info('HTTP сервер закрыт');
                
                try {
                    await mongoose.connection.close();
                    logger.info('MongoDB соединение закрыто');
                    process.exit(0);
                } catch (err) {
                    logger.error('Ошибка при закрытии MongoDB:', err);
                    process.exit(1);
                }
            });
            
            // Если сервер не закрывается в течение 10 секунд
            setTimeout(() => {
                logger.error('Принудительное завершение из-за таймаута');
                process.exit(1);
            }, 10000);
        };
        
        process.on('SIGTERM', gracefulShutdown);
        process.on('SIGINT', gracefulShutdown);
        process.on('SIGUSR2', gracefulShutdown); // Для nodemon
        
        // Обработка необработанных исключений
        process.on('uncaughtException', (err) => {
            logger.error('Необработанное исключение:', err);
            gracefulShutdown();
        });
        
        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Необработанный промис:', reason);
        });
        
    } catch (error) {
        logger.error('Не удалось запустить сервер:', error);
        process.exit(1);
    }
};

startServer();

module.exports = app;
