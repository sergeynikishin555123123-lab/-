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

// Загрузка переменных окружения
dotenv.config();

// Настройка логгера
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    return `${timestamp} ${level}: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
                })
            )
        }),
        new winston.transports.File({ 
            filename: 'error.log', 
            level: 'error' 
        }),
        new winston.transports.File({ 
            filename: 'combined.log' 
        })
    ]
});

// Проверка обязательных переменных
const requiredEnvVars = ['PORT', 'JWT_SECRET'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
    logger.error(`❌ Отсутствуют обязательные переменные окружения: ${missingEnvVars.join(', ')}`);
    process.exit(1);
}

const app = express();

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 100,
    message: { 
        success: false,
        error: 'Слишком много запросов' 
    }
});

// Middleware
app.use(helmet());
app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true
}));
app.use(compression());
app.use(morgan('combined', { 
    stream: { 
        write: message => logger.info(message.trim()) 
    } 
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/api/', limiter);

// Статические файлы
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/public', express.static(path.join(__dirname, 'public')));

// Создаем необходимые директории
['uploads', 'public', 'logs', 'exports'].forEach(dir => {
    const dirPath = path.join(__dirname, dir);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
});

// ==================== ПОДКЛЮЧЕНИЕ К MONGODB ====================
const connectDB = async () => {
    try {
        const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/concierge_db';
        
        logger.info(`Подключение к MongoDB: ${mongoURI.includes('@') ? '***' : mongoURI}`);
        
        await mongoose.connect(mongoURI, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });
        
        logger.info('✅ MongoDB подключена успешно');
        console.log('✅ MongoDB подключена успешно');
        
    } catch (error) {
        logger.error('❌ Ошибка подключения к MongoDB:', error.message);
        console.error('❌ Ошибка подключения к MongoDB:', error.message);
        
        // Если нет MongoDB, используем in-memory базу для разработки
        if (process.env.NODE_ENV === 'development') {
            logger.warn('⚠️  Используем in-memory базу для разработки');
            console.log('⚠️  Используем in-memory базу для разработки');
        } else {
            throw error;
        }
    }
};

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
        
        // Используем polling для простоты
        telegramBot = new TelegramBot(token, {
            polling: {
                interval: 300,
                autoStart: true,
                params: {
                    timeout: 10
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

        // Команда /start
        telegramBot.onText(/\/start/, (msg) => {
            const chatId = msg.chat.id;
            const username = msg.from.username || msg.from.first_name;
            
            logger.info(`Команда /start от ${username} (${chatId})`);
            
            const welcomeText = `
👋 *Привет, ${username}!*

🎀 Добро пожаловать в *Женский Консьерж Сервис*!

Я помогу вам с повседневными делами:
🏠 Дом и быт
👨‍👩‍👧‍👦 Дети и семья
💅 Красота и здоровье
🎓 Обучение и курсы
🐶 Питомцы
🎉 И многое другое!

*Доступные команды:*
/help - Все команды
/test - Проверка связи
/status - Статус системы
/id - Ваш Telegram ID
/services - Услуги
/register - Регистрация

*Сайт:* ${process.env.WEBAPP_URL || 'В разработке'}
            `.trim();

            telegramBot.sendMessage(chatId, welcomeText, { parse_mode: 'Markdown' });
        });

        // Команда /help
        telegramBot.onText(/\/help/, (msg) => {
            const chatId = msg.chat.id;
            
            const helpText = `
*🤖 Помощь по боту*

*Основные команды:*
/start - Начало работы
/help - Эта справка
/test - Проверка связи
/status - Статус системы
/id - Ваш Telegram ID
/services - Услуги
/register - Регистрация

*Для администраторов:*
/admin - Панель управления
/stats - Статистика

*Версия:* ${process.env.APP_VERSION || '1.0.0'}
            `.trim();

            telegramBot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
        });

        // Команда /test
        telegramBot.onText(/\/test/, (msg) => {
            const chatId = msg.chat.id;
            
            telegramBot.sendMessage(chatId, 
                `✅ Бот работает!\n` +
                `🕒 Время: ${new Date().toLocaleString('ru-RU')}\n` +
                `💻 Сервер: TimeWeb Cloud\n` +
                `🔧 Версия: ${process.env.APP_VERSION || '1.0.0'}`
            );
        });

        // Команда /status
        telegramBot.onText(/\/status/, async (msg) => {
            const chatId = msg.chat.id;
            
            const dbStatus = mongoose.connection.readyState === 1 ? '✅ Подключена' : '❌ Отключена';
            const botStatus = telegramBot ? '✅ Активен' : '❌ Неактивен';
            
            telegramBot.sendMessage(chatId,
                `*📊 Статус системы*\n\n` +
                `🤖 *Бот:* ${botStatus}\n` +
                `🗄️ *База данных:* ${dbStatus}\n` +
                `🕒 *Время сервера:* ${new Date().toLocaleString('ru-RU')}\n` +
                `⏱️ *Uptime:* ${process.uptime().toFixed(0)} сек\n` +
                `💾 *Память:* ${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)} MB\n` +
                `🌐 *Режим:* ${process.env.NODE_ENV || 'development'}`,
                { parse_mode: 'Markdown' }
            );
        });

        // Команда /id
        telegramBot.onText(/\/id/, (msg) => {
            const chatId = msg.chat.id;
            
            telegramBot.sendMessage(chatId,
                `*👤 Ваши данные:*\n\n` +
                `🆔 *User ID:* \`${msg.from.id}\`\n` +
                `💬 *Chat ID:* \`${chatId}\`\n` +
                `👤 *Имя:* ${msg.from.first_name}\n` +
                `📛 *Фамилия:* ${msg.from.last_name || 'не указана'}\n` +
                `@ *Username:* ${msg.from.username ? '@' + msg.from.username : 'не указан'}`,
                { parse_mode: 'Markdown' }
            );
        });

        // Команда /services
        telegramBot.onText(/\/services/, (msg) => {
            const chatId = msg.chat.id;
            
            telegramBot.sendMessage(chatId,
                `*🎀 Наши услуги:*\n\n` +
                `🏠 *Дом и быт*\n` +
                `• Уборка\n` +
                `• Ремонт\n` +
                `• Организация пространства\n\n` +
                `👨‍👩‍👧‍👦 *Дети и семья*\n` +
                `• Няни\n` +
                `• Репетиторы\n` +
                `• Организация праздников\n\n` +
                `💅 *Красота и здоровье*\n` +
                `• Маникюр/педикюр\n` +
                `• Стилисты\n` +
                `• Фитнес-тренеры\n\n` +
                `🎓 *Курсы и обучение*\n` +
                `• Онлайн-курсы\n` +
                `• Языки\n` +
                `• Хобби\n\n` +
                `🐶 *Питомцы*\n` +
                `• Выгул\n` +
                `• Передержка\n` +
                `• Ветеринары\n\n` +
                `*Для заказа услуг:*\n` +
                `${process.env.WEBAPP_URL || 'Сайт в разработке'}`,
                { parse_mode: 'Markdown' }
            );
        });

        // Команда /register
        telegramBot.onText(/\/register/, async (msg) => {
            const chatId = msg.chat.id;
            const username = msg.from.username || msg.from.first_name;
            
            telegramBot.sendMessage(chatId,
                `📝 *Регистрация*\n\n` +
                `Для регистрации в сервисе отправьте:\n\n` +
                `*Формат:*\n` +
                `Имя Фамилия\n` +
                `Email\n` +
                `Телефон (необязательно)\n\n` +
                `*Пример:*\n` +
                `Анна Иванова\n` +
                `anna@example.com\n` +
                `+79991234567\n\n` +
                `Я создам для вас аккаунт и отправлю пароль.`,
                { parse_mode: 'Markdown' }
            );
            
            // Ожидаем ответ с данными
            telegramBot.once('message', async (responseMsg) => {
                if (responseMsg.chat.id === chatId && !responseMsg.text.startsWith('/')) {
                    try {
                        const lines = responseMsg.text.split('\n').map(l => l.trim());
                        if (lines.length >= 2) {
                            const [fullName, email, phone] = lines;
                            const [firstName, lastName] = fullName.split(' ');
                            
                            // Здесь будет создание пользователя в базе
                            const tempPassword = Math.random().toString(36).slice(-8);
                            
                            telegramBot.sendMessage(chatId,
                                `✅ *Регистрация успешна!*\n\n` +
                                `*Данные:*\n` +
                                `👤 Имя: ${firstName} ${lastName || ''}\n` +
                                `📧 Email: ${email}\n` +
                                `📱 Телефон: ${phone || 'не указан'}\n\n` +
                                `*Временный пароль:* ${tempPassword}\n\n` +
                                `⚠️ *Сохраните пароль!*\n` +
                                `🔗 Ссылка для входа: ${process.env.WEBAPP_URL || 'Сайт в разработке'}\n\n` +
                                `Теперь вы можете создавать задачи!`,
                                { parse_mode: 'Markdown' }
                            );
                            
                            logger.info(`Новый пользователь: ${email} (${chatId})`);
                        }
                    } catch (error) {
                        telegramBot.sendMessage(chatId, '❌ Ошибка регистрации. Попробуйте позже.');
                    }
                }
            });
        });

        // Ответ на любое сообщение
        telegramBot.on('message', (msg) => {
            if (!msg.text?.startsWith('/')) {
                // Просто логируем обычные сообщения
                logger.info(`Сообщение от ${msg.chat.id}: ${msg.text?.substring(0, 50)}...`);
            }
        });

        // Получаем информацию о боте
        const botInfo = await telegramBot.getMe();
        
        logger.info(`✅ Telegram бот инициализирован: @${botInfo.username}`);
        console.log(`✅ Telegram бот: @${botInfo.username}`);
        
        // Отправляем сообщение администратору
        const adminId = process.env.SUPER_ADMIN_ID;
        if (adminId) {
            try {
                await telegramBot.sendMessage(adminId,
                    `🚀 *Сервис запущен!*\n\n` +
                    `🤖 Бот: @${botInfo.username}\n` +
                    `🌐 URL: ${process.env.WEBAPP_URL || 'Не указан'}\n` +
                    `🕒 Время: ${new Date().toLocaleString('ru-RU')}\n` +
                    `🔧 Версия: ${process.env.APP_VERSION || '1.0.0'}\n\n` +
                    `✅ Все системы работают!`,
                    { parse_mode: 'Markdown' }
                );
            } catch (error) {
                logger.warn('Не удалось отправить сообщение администратору');
            }
        }
        
    } catch (error) {
        logger.error('Ошибка инициализации Telegram бота:', error.message);
        console.error('❌ Ошибка Telegram бота:', error.message);
    }
};

// ==================== API МАРШРУТЫ ====================

// Health check
app.get('/api/v1/health', (req, res) => {
    res.json({
        status: 'OK',
        app: process.env.APP_NAME || 'concierge-app',
        version: process.env.APP_VERSION || '1.0.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        telegram: telegramBot ? 'connected' : 'disconnected',
        node: process.version,
        environment: process.env.NODE_ENV || 'development',
        deployment: 'TimeWeb Cloud'
    });
});

// Основная информация
app.get('/api/v1/info', (req, res) => {
    res.json({
        success: true,
        service: '🎀 Женский Консьерж Сервис',
        description: 'Помощь в повседневных делах',
        version: process.env.APP_VERSION || '1.0.0',
        features: [
            '🏠 Дом и быт',
            '👨‍👩‍👧‍👦 Дети и семья',
            '💅 Красота и здоровье',
            '🎓 Курсы и обучение',
            '🐶 Питомцы',
            '🎉 Мероприятия и развлечения'
        ],
        contact: {
            telegram_bot: telegramBot ? 'active' : 'inactive',
            admin_id: process.env.SUPER_ADMIN_ID || 'not_set'
        },
        endpoints: {
            health: '/api/v1/health',
            admin: '/admin/status',
            telegram_test: '/admin/telegram-test'
        }
    });
});

// Статус администратора
app.get('/admin/status', (req, res) => {
    const botInfo = telegramBot ? {
        username: telegramBot.options?.username,
        id: telegramBot.options?.id,
        polling: telegramBot.isPolling()
    } : null;

    res.json({
        success: true,
        system: {
            node: process.version,
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            environment: process.env.NODE_ENV
        },
        database: {
            status: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
            name: mongoose.connection.name,
            host: mongoose.connection.host
        },
        telegram: {
            status: telegramBot ? 'active' : 'inactive',
            bot: botInfo,
            webhook: process.env.WEBAPP_URL ? 'configured' : 'not_configured'
        },
        settings: {
            app_name: process.env.APP_NAME,
            app_version: process.env.APP_VERSION,
            admin_ids: process.env.ADMIN_IDS,
            webapp_url: process.env.WEBAPP_URL
        }
    });
});

// Тест Telegram бота
app.get('/admin/telegram-test', async (req, res) => {
    try {
        if (!telegramBot) {
            return res.json({ error: 'Telegram бот не инициализирован' });
        }

        const adminId = process.env.SUPER_ADMIN_ID;
        if (!adminId) {
            return res.json({ error: 'SUPER_ADMIN_ID не указан' });
        }

        await telegramBot.sendMessage(adminId,
            `🔔 *Тестовое сообщение*\n\n` +
            `Это тестовое сообщение от административной панели.\n` +
            `🕒 Время: ${new Date().toLocaleString('ru-RU')}\n` +
            `✅ Система работает нормально.`,
            { parse_mode: 'Markdown' }
        );

        res.json({
            success: true,
            message: 'Тестовое сообщение отправлено администратору',
            admin_id: adminId,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        res.status(500).json({
            error: error.message,
            details: 'Не удалось отправить тестовое сообщение'
        });
    }
});

// Главная страница
app.get('/', (req, res) => {
    res.json({
        message: '🎀 Добро пожаловать в Женский Консьерж Сервис!',
        description: 'Помощь в повседневных делах',
        version: process.env.APP_VERSION || '1.0.0',
        documentation: {
            health: '/api/v1/health',
            info: '/api/v1/info',
            admin: '/admin/status',
            telegram_test: '/admin/telegram-test'
        },
        quick_start: [
            '1. Напишите боту в Telegram команду /start',
            '2. Используйте /services для просмотра услуг',
            '3. Используйте /register для регистрации',
            '4. Создавайте задачи через бота или сайт'
        ]
    });
});

// Простые API маршруты (заглушки для полной функциональности)
app.get('/api/v1/services', (req, res) => {
    res.json({
        success: true,
        services: [
            { id: 'home', name: 'Дом и быт', icon: '🏠', count: 15 },
            { id: 'family', name: 'Дети и семья', icon: '👨‍👩‍👧‍👦', count: 12 },
            { id: 'beauty', name: 'Красота и здоровье', icon: '💅', count: 20 },
            { id: 'education', name: 'Обучение', icon: '🎓', count: 18 },
            { id: 'pets', name: 'Питомцы', icon: '🐶', count: 10 },
            { id: 'events', name: 'Мероприятия', icon: '🎉', count: 8 }
        ]
    });
});

app.get('/api/v1/tasks', (req, res) => {
    res.json({
        success: true,
        tasks: [],
        total: 0,
        message: 'API задач готово к работе'
    });
});

// 404 обработчик
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Маршрут не найден',
        path: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString(),
        available_routes: ['/', '/api/v1/health', '/api/v1/info', '/admin/status']
    });
});

// Обработчик ошибок
app.use((err, req, res, next) => {
    logger.error('Ошибка:', {
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method
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
        console.log('='.repeat(60));
        console.log('🚀 ЗАПУСК ЖЕНСКОГО КОНСЬЕРЖ СЕРВИСА');
        console.log('='.repeat(60));
        console.log(`📌 Порт: ${process.env.PORT || 3000}`);
        console.log(`🌐 Режим: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🏷️ Версия: ${process.env.APP_VERSION || '1.0.0'}`);
        console.log(`🔗 WEBAPP_URL: ${process.env.WEBAPP_URL || 'не указан'}`);
        console.log('='.repeat(60));

        // Подключаем базу данных
        await connectDB();
        
        // Инициализируем Telegram бота
        console.log('🤖 Инициализация Telegram бота...');
        await initializeTelegramBot();

        const PORT = process.env.PORT || 3000;
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`✅ Сервер запущен на порту ${PORT}`);
            console.log(`📊 Health check: http://localhost:${PORT}/api/v1/health`);
            console.log(`📱 API Info: http://localhost:${PORT}/api/v1/info`);
            
            if (process.env.WEBAPP_URL) {
                console.log(`🌍 Публичный URL: ${process.env.WEBAPP_URL}`);
            }
            
            if (telegramBot) {
                console.log(`🤖 Telegram бот активен`);
            }
            
            console.log('='.repeat(60));
            console.log('✨ Приложение готово к работе!');
            console.log('='.repeat(60));
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
