const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const winston = require('winston');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const userAgent = require('express-useragent');

// Проверяем и создаем директории для логов с правильными правами
const ensureLogsDirectory = () => {
    const logDir = path.join(__dirname, 'logs');
    try {
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true, mode: 0o755 });
            console.log('✅ Директория logs создана');
        }
        
        // Проверяем права на запись
        fs.accessSync(logDir, fs.constants.W_OK);
        return true;
    } catch (error) {
        console.warn(`⚠️ Не удалось создать/проверить директорию logs: ${error.message}`);
        console.warn('⚠️ Логи будут выводиться только в консоль');
        return false;
    }
};

const canWriteLogs = ensureLogsDirectory();

// Инициализация логгера
const logger = winston.createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'concierge-app' },
    transports: [
        // Всегда выводим в консоль
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    return `${timestamp} ${level}: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
                })
            )
        })
    ]
});

// Добавляем файловые транспорты только если есть права на запись
if (canWriteLogs) {
    logger.add(new winston.transports.File({ 
        filename: 'logs/error.log', 
        level: 'error',
        maxsize: 5242880, // 5MB
        maxFiles: 5,
        tailable: true
    }));
    
    logger.add(new winston.transports.File({ 
        filename: 'logs/combined.log',
        maxsize: 5242880, // 5MB
        maxFiles: 10,
        tailable: true
    }));
    
    // Лог для HTTP запросов
    logger.add(new winston.transports.File({ 
        filename: 'logs/http.log',
        level: 'http',
        maxsize: 5242880,
        maxFiles: 5,
        tailable: true
    }));
}

// Кастомный формат для morgan
const morganStream = {
    write: (message) => {
        logger.http(message.trim());
    }
};

// Загрузка переменных окружения
dotenv.config();

const app = express();

// Проверяем необходимые переменные окружения
const requiredEnvVars = ['MONGODB_URI', 'JWT_SECRET'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
    logger.error(`❌ Отсутствуют обязательные переменные окружения: ${missingEnvVars.join(', ')}`);
    console.error(`❌ Отсутствуют обязательные переменные окружения: ${missingEnvVars.join(', ')}`);
    console.error('Пожалуйста, проверьте файл .env');
    process.exit(1);
}

// Rate limiting
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 минут по умолчанию
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // лимит запросов
    message: { 
        success: false,
        error: 'Слишком много запросов с этого IP, попробуйте позже' 
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        // Пропускаем health check из мониторинга
        return req.path === '/health';
    }
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
    origin: process.env.FRONTEND_URL ? 
        (Array.isArray(process.env.FRONTEND_URL) ? process.env.FRONTEND_URL : [process.env.FRONTEND_URL]) 
        : 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-telegram-id']
}));

app.use(compression());
app.use(morgan('combined', { stream: morganStream }));
app.use(express.json({ limit: process.env.FILE_MAX_SIZE || '10kb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.FILE_MAX_SIZE || '10kb' }));
app.use(mongoSanitize());
app.use(xss());
app.use(hpp());
app.use(userAgent.express());

// Применяем rate limiting только к API
app.use('/api/', limiter);

// Создаем необходимые директории при запуске
const ensureDirectories = () => {
    const directories = ['uploads', 'exports', 'public'];
    
    directories.forEach(dir => {
        const dirPath = path.join(__dirname, dir);
        try {
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true, mode: 0o755 });
                logger.info(`Директория ${dir} создана`);
            }
        } catch (error) {
            logger.warn(`Не удалось создать директорию ${dir}: ${error.message}`);
        }
    });
};

ensureDirectories();

// Статические файлы с безопасными заголовками
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    setHeaders: (res, filePath) => {
        // Безопасные заголовки для загруженных файлов
        res.set('Cache-Control', 'public, max-age=86400');
        res.set('X-Content-Type-Options', 'nosniff');
        
        // Запрещаем выполнение файлов
        if (filePath.match(/\.(js|php|exe|sh)$/)) {
            res.set('Content-Type', 'text/plain');
            res.set('Content-Disposition', 'attachment');
        }
    }
}));

app.use('/public', express.static(path.join(__dirname, 'public'), {
    setHeaders: (res) => {
        res.set('Cache-Control', 'public, max-age=31536000'); // 1 год для статики
    }
}));

// Подключение к MongoDB с улучшенными настройками
const connectDB = async () => {
    const maxRetries = 5;
    let retryCount = 0;
    
    const connectWithRetry = async () => {
        try {
            logger.info(`Попытка подключения к MongoDB (попытка ${retryCount + 1}/${maxRetries})...`);
            
            await mongoose.connect(process.env.MONGODB_URI, {
                useNewUrlParser: true,
                useUnifiedTopology: true,
                serverSelectionTimeoutMS: 10000,
                socketTimeoutMS: 45000,
                maxPoolSize: 50,
                minPoolSize: 5,
                retryWrites: true,
                w: 'majority'
            });
            
            logger.info('✅ MongoDB подключена успешно');
            console.log('✅ MongoDB подключена успешно');
            return true;
            
        } catch (err) {
            retryCount++;
            logger.error(`❌ Ошибка подключения к MongoDB (попытка ${retryCount}):`, err.message);
            
            if (retryCount >= maxRetries) {
                logger.error('❌ Превышено максимальное количество попыток подключения');
                throw err;
            }
            
            // Ждем с экспоненциальной задержкой
            const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
            logger.info(`Повторная попытка через ${delay}ms...`);
            
            await new Promise(resolve => setTimeout(resolve, delay));
            return connectWithRetry();
        }
    };
    
    return connectWithRetry();
};

// Обработчики событий MongoDB
mongoose.connection.on('connected', () => {
    logger.info('Mongoose подключен к базе данных');
});

mongoose.connection.on('error', (err) => {
    logger.error(`Ошибка соединения Mongoose: ${err.message}`);
});

mongoose.connection.on('disconnected', () => {
    logger.warn('Mongoose отключен от базы данных');
});

// Обработчик SIGTERM для graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('Получен SIGTERM, завершение работы...');
    
    try {
        await mongoose.connection.close();
        logger.info('MongoDB соединение закрыто');
        process.exit(0);
    } catch (err) {
        logger.error('Ошибка при закрытии MongoDB:', err);
        process.exit(1);
    }
});

// Инициализация Telegram бота (с обработкой ошибок)
const initializeTelegramBot = () => {
    try {
        const { initializeBot } = require('./app/utils/telegramBot');
        initializeBot();
        logger.info('Telegram бот инициализирован');
    } catch (error) {
        logger.warn('Не удалось инициализировать Telegram бота:', error.message);
    }
};

// Импорт маршрутов
try {
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
    
    logger.info('Маршруты API загружены');
} catch (error) {
    logger.error('Ошибка загрузки маршрутов:', error);
    process.exit(1);
}

// Проверка состояния сервера
app.get('/health', (req, res) => {
    const health = {
        status: 'UP',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        memory: {
            rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
            heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
            heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
            external: `${Math.round(process.memoryUsage().external / 1024 / 1024)}MB`
        },
        node: {
            version: process.version,
            pid: process.pid,
            platform: process.platform,
            arch: process.arch
        },
        env: process.env.NODE_ENV
    };
    
    // Если БД не подключена, возвращаем 503
    if (mongoose.connection.readyState !== 1) {
        health.status = 'DOWN';
        health.database = 'disconnected';
        return res.status(503).json(health);
    }
    
    res.json(health);
});

// Основной маршрут
app.get('/', (req, res) => {
    res.json({
        message: '🚀 Добро пожаловать в API Женского Консьерж-Сервиса',
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        documentation: '/api-docs (будет доступна позже)',
        health: '/health',
        timestamp: new Date().toISOString()
    });
});

// Обработка 404
app.use('*', (req, res) => {
    logger.warn(`404 Not Found: ${req.method} ${req.originalUrl} from ${req.ip}`);
    
    res.status(404).json({
        success: false,
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
    
    // Логируем ошибку
    logger.error('Ошибка API:', {
        error: message,
        statusCode,
        path: req.path,
        method: req.method,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        userId: req.user?._id,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
    
    // Формируем ответ
    const response = {
        success: false,
        error: message,
        timestamp: new Date().toISOString()
    };
    
    // Добавляем дополнительную информацию в development
    if (process.env.NODE_ENV === 'development') {
        response.stack = err.stack;
        response.details = err.details;
    }
    
    res.status(statusCode).json(response);
});

// Запуск сервера
const startServer = async () => {
    try {
        logger.info('Запуск сервера...');
        
        // Подключаемся к БД
        await connectDB();
        
        // Инициализируем Telegram бота
        initializeTelegramBot();
        
        const PORT = process.env.PORT || 3000;
        const server = app.listen(PORT, '0.0.0.0', () => {
            logger.info(`🚀 Сервер запущен на порту ${PORT}`);
            console.log('='.repeat(50));
            console.log('🚀 Сервер успешно запущен!');
            console.log(`📌 Порт: ${PORT}`);
            console.log(`🌐 Режим: ${process.env.NODE_ENV || 'development'}`);
            console.log(`📊 Health check: http://localhost:${PORT}/health`);
            console.log('='.repeat(50));
        });
        
        // Обработка ошибок сервера
        server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                logger.error(`Порт ${PORT} уже используется`);
                console.error(`❌ Порт ${PORT} уже используется!`);
            } else {
                logger.error('Ошибка сервера:', error);
            }
            process.exit(1);
        });
        
        // Graceful shutdown
        const shutdown = async (signal) => {
            logger.info(`Получен сигнал ${signal}, завершение работы...`);
            
            server.close(async () => {
                logger.info('HTTP сервер закрыт');
                
                try {
                    await mongoose.connection.close();
                    logger.info('MongoDB соединение закрыто');
                    logger.info('Работа завершена');
                    process.exit(0);
                } catch (err) {
                    logger.error('Ошибка при закрытии MongoDB:', err);
                    process.exit(1);
                }
            });
            
            // Таймаут для принудительного завершения
            setTimeout(() => {
                logger.error('Принудительное завершение из-за таймаута');
                process.exit(1);
            }, 10000);
        };
        
        // Обработчики сигналов
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
        
        // Обработка необработанных исключений
        process.on('uncaughtException', (error) => {
            logger.error('Необработанное исключение:', error);
            shutdown('uncaughtException');
        });
        
        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Необработанный промис:', reason);
        });
        
    } catch (error) {
        logger.error('Не удалось запустить сервер:', error);
        console.error('❌ Не удалось запустить сервер:', error.message);
        process.exit(1);
    }
};

// Запускаем сервер
startServer();

module.exports = app;
