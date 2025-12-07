const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const winston = require('winston');

// Инициализация логгера
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' })
    ]
});

if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.simple()
    }));
}

// Загрузка переменных окружения
dotenv.config();

const app = express();

// Middleware безопасности
app.use(helmet());
app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true
}));
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Статические файлы
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/public', express.static(path.join(__dirname, 'public')));

// Подключение к MongoDB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
        logger.info('✅ MongoDB подключена успешно');
        console.log('✅ MongoDB подключена успешно');
    })
    .catch((err) => {
        logger.error('❌ Ошибка подключения к MongoDB:', err);
        console.error('❌ Ошибка подключения к MongoDB:', err);
        process.exit(1);
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
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});

// Основной маршрут
app.get('/', (req, res) => {
    res.json({
        message: '🚀 Добро пожаловать в API Женского Консьерж-Сервиса',
        version: '1.0.0',
        endpoints: {
            auth: '/api/v1/auth',
            tasks: '/api/v1/tasks',
            services: '/api/v1/services',
            admin: '/api/v1/admin',
            health: '/health'
        }
    });
});

// Обработка 404
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Маршрут не найден',
        path: req.originalUrl,
        method: req.method
    });
});

// Глобальный обработчик ошибок
app.use((err, req, res, next) => {
    logger.error('❌ Глобальная ошибка:', {
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method
    });
    
    res.status(err.status || 500).json({
        error: process.env.NODE_ENV === 'production' ? 'Внутренняя ошибка сервера' : err.message,
        ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
    });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    logger.info(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`🌐 Домен: sergeynikishin555123123-lab--86fa.twc1.net`);
    console.log(`📊 Проверка состояния: http://localhost:${PORT}/health`);
});

// Обработка graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM получен. Закрытие сервера...');
    server.close(() => {
        mongoose.connection.close(false, () => {
            logger.info('MongoDB соединение закрыто');
            process.exit(0);
        });
    });
});

module.exports = app;
