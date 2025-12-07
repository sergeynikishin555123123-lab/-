const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const crypto = require('crypto');

// Загрузка переменных окружения
dotenv.config();

// Автоматическая генерация JWT_SECRET если не указан
if (!process.env.JWT_SECRET) {
    console.warn('⚠️  JWT_SECRET не указан, генерируем автоматически...');
    process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
    console.log(`🔐 Сгенерирован JWT_SECRET: ${process.env.JWT_SECRET.substring(0, 10)}...`);
}

const app = express();

// Базовые middleware
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ==================== TELEGRAM BOT ====================
let telegramBot = null;

const initializeTelegramBot = async () => {
    try {
        const token = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
        
        if (!token || token === 'your_telegram_bot_token_here') {
            console.log('🤖 Telegram бот отключен: токен не указан');
            console.log('ℹ️  Для включения добавьте BOT_TOKEN в настройки TimeWeb');
            return;
        }

        const TelegramBot = require('node-telegram-bot-api');
        
        // Используем polling для TimeWeb
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

        // Обработка ошибок
        telegramBot.on('polling_error', (error) => {
            console.error('❌ Ошибка Telegram polling:', error.message);
        });

        telegramBot.on('error', (error) => {
            console.error('❌ Ошибка Telegram бота:', error.message);
        });

        // Команда /start
        telegramBot.onText(/\/start/, (msg) => {
            const chatId = msg.chat.id;
            const username = msg.from.username || msg.from.first_name;
            
            console.log(`🔄 /start от ${username} (${chatId})`);
            
            const welcomeMessage = `
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
/services - Наши услуги

🌐 *Сайт:* ${process.env.WEBAPP_URL || 'В разработке'}

Начните с /help для полного списка команд.
            `.trim();

            telegramBot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' })
                .catch(err => console.error('Ошибка отправки сообщения:', err.message));
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
/services - Наши услуги

*Для заказа услуг:*
Посетите наш сайт или напишите нам.

*Версия:* ${process.env.APP_VERSION || '2.0.0'}
*Поддержка:* @concierge_support
            `.trim();

            telegramBot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
        });

        // Команда /test
        telegramBot.onText(/\/test/, (msg) => {
            const chatId = msg.chat.id;
            
            telegramBot.sendMessage(chatId, 
                `✅ *Тест связи успешен!*\n\n` +
                `🕒 Время: ${new Date().toLocaleString('ru-RU')}\n` +
                `💻 Сервер: TimeWeb Cloud\n` +
                `🔧 Версия: ${process.env.APP_VERSION || '2.0.0'}\n` +
                `🌐 URL: ${process.env.WEBAPP_URL || 'Не указан'}\n\n` +
                `👤 Ваш ID: \`${chatId}\``,
                { parse_mode: 'Markdown' }
            );
        });

        // Команда /status
        telegramBot.onText(/\/status/, (msg) => {
            const chatId = msg.chat.id;
            const dbStatus = mongoose.connection.readyState === 1 ? '✅ Подключена' : '❌ Отключена';
            
            telegramBot.sendMessage(chatId,
                `*📊 Статус системы*\n\n` +
                `🤖 *Бот:* ✅ Активен\n` +
                `🗄️ *База данных:* ${dbStatus}\n` +
                `🕒 *Время сервера:* ${new Date().toLocaleString('ru-RU')}\n` +
                `⏱️ *Uptime:* ${Math.floor(process.uptime())} сек\n` +
                `💾 *Память:* ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB\n` +
                `🌐 *Режим:* ${process.env.NODE_ENV || 'development'}\n` +
                `🔗 *URL:* ${process.env.WEBAPP_URL || 'Не указан'}`,
                { parse_mode: 'Markdown' }
            );
        });

        // Команда /id
        telegramBot.onText(/\/id/, (msg) => {
            const chatId = msg.chat.id;
            const user = msg.from;
            
            telegramBot.sendMessage(chatId,
                `*👤 Ваши данные:*\n\n` +
                `🆔 *User ID:* \`${user.id}\`\n` +
                `💬 *Chat ID:* \`${chatId}\`\n` +
                `👤 *Имя:* ${user.first_name}\n` +
                `📛 *Фамилия:* ${user.last_name || '—'}\n` +
                `👤 *Username:* ${user.username ? '@' + user.username : '—'}\n` +
                `🌐 *Язык:* ${user.language_code || '—'}\n\n` +
                `*Для администратора:*\n` +
                `Добавьте этот ID: \`${user.id}\` в ADMIN_IDS`,
                { parse_mode: 'Markdown' }
            );
        });

        // Команда /services
        telegramBot.onText(/\/services/, (msg) => {
            const chatId = msg.chat.id;
            
            telegramBot.sendMessage(chatId,
                `*🎀 Наши услуги:*\n\n` +
                `🏠 *Дом и быт*\n` +
                `• Уборка квартир/домов\n` +
                `• Организация пространства\n` +
                `• Мелкий ремонт\n\n` +
                `👨‍👩‍👧‍👦 *Дети и семья*\n` +
                `• Няни и бебиситтеры\n` +
                `• Помощь с уроками\n` +
                `• Организация детских праздников\n\n` +
                `💅 *Красота и здоровье*\n` +
                `• Маникюр/педикюр на дому\n` +
                `• Визажисты и стилисты\n` +
                `• Фитнес-тренеры\n\n` +
                `🎓 *Обучение и развитие*\n` +
                `• Репетиторы\n` +
                `• Языковые курсы\n` +
                `• Онлайн-обучение\n\n` +
                `🐶 *Питомцы*\n` +
                `• Выгул собак\n` +
                `• Передержка\n` +
                `• Груминг\n\n` +
                `🎉 *Мероприятия*\n` +
                `• Организация праздников\n` +
                `• Поиск площадок\n` +
                `• Кейтеринг\n\n` +
                `*Для заказа:*\n` +
                `${process.env.WEBAPP_URL || 'Сайт в разработке'}\n` +
                `Или напишите нам в личные сообщения.`,
                { parse_mode: 'Markdown' }
            );
        });

        // Ответ на обычные сообщения
        telegramBot.on('message', (msg) => {
            if (msg.text && !msg.text.startsWith('/')) {
                console.log(`💬 Сообщение от ${msg.chat.id}: "${msg.text.substring(0, 50)}..."`);
                
                // Автоответ на обычные сообщения
                if (msg.text.toLowerCase().includes('привет') || 
                    msg.text.toLowerCase().includes('здравствуйте')) {
                    telegramBot.sendMessage(msg.chat.id,
                        `👋 Привет! Я консьерж-бот.\n` +
                        `Используйте /help для списка команд.`
                    );
                }
            }
        });

        // Получаем информацию о боте
        const botInfo = await telegramBot.getMe();
        
        console.log(`✅ Telegram бот запущен: @${botInfo.username}`);
        console.log(`🔗 Ссылка: https://t.me/${botInfo.username}`);
        
        // Отправляем уведомление администратору
        const adminId = process.env.SUPER_ADMIN_ID;
        if (adminId) {
            try {
                await telegramBot.sendMessage(adminId,
                    `🚀 *Сервис запущен!*\n\n` +
                    `🤖 Бот: @${botInfo.username}\n` +
                    `🌐 URL: ${process.env.WEBAPP_URL || 'Не указан'}\n` +
                    `🕒 Время: ${new Date().toLocaleString('ru-RU')}\n` +
                    `🔧 Версия: ${process.env.APP_VERSION || '2.0.0'}\n\n` +
                    `✅ Все системы работают!\n` +
                    `📊 Health check: ${process.env.WEBAPP_URL}/health`,
                    { parse_mode: 'Markdown' }
                );
                console.log(`📨 Уведомление отправлено администратору ${adminId}`);
            } catch (error) {
                console.warn('⚠️ Не удалось отправить уведомление администратору');
            }
        }
        
        return telegramBot;
        
    } catch (error) {
        console.error('❌ Ошибка запуска Telegram бота:', error.message);
        
        if (error.code === 'ETELEGRAM') {
            console.error('ℹ️ Проверьте правильность BOT_TOKEN в настройках TimeWeb');
        }
        
        return null;
    }
};

// ==================== ПОДКЛЮЧЕНИЕ К MONGODB ====================
const connectDB = async () => {
    try {
        // Если MONGODB_URI не указан, используем локальную
        const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/concierge_db';
        
        // Для TimeWeb без MongoDB продолжаем без ошибки
        if (mongoURI.includes('localhost') && process.env.TIMEWEB_DEPLOYMENT) {
            console.log('ℹ️  MONGODB_URI не указан. Продолжаем без базы данных.');
            return false;
        }
        
        console.log(`🔗 Подключение к MongoDB...`);
        
        await mongoose.connect(mongoURI, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 30000,
        });
        
        console.log('✅ MongoDB подключена успешно');
        return true;
        
    } catch (error) {
        console.error('❌ Ошибка подключения к MongoDB:', error.message);
        console.log('ℹ️  Продолжаем без базы данных. Некоторые функции будут ограничены.');
        return false;
    }
};

// ==================== API МАРШРУТЫ ====================

// Health check (ОБЯЗАТЕЛЬНО для TimeWeb!)
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        service: 'concierge-app',
        version: process.env.APP_VERSION || '2.0.0',
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        environment: process.env.NODE_ENV || 'development',
        deployment: 'TimeWeb Cloud',
        checks: {
            server: 'running',
            telegram: telegramBot ? 'connected' : 'disconnected',
            database: mongoose.connection?.readyState === 1 ? 'connected' : 'disconnected',
            port: process.env.PORT || 3000
        }
    });
});

// Главная страница
app.get('/', (req, res) => {
    res.json({
        message: '🎀 Женский Консьерж Сервис',
        description: 'Помощь в повседневных делах',
        version: process.env.APP_VERSION || '2.0.0',
        endpoints: {
            health: '/health',
            info: '/api/v1/info',
            services: '/api/v1/services',
            admin: '/admin/status'
        },
        telegram: {
            bot: telegramBot ? 'active' : 'inactive',
            commands: ['/start', '/help', '/test', '/status', '/id', '/services']
        }
    });
});

// API информация
app.get('/api/v1/info', (req, res) => {
    res.json({
        success: true,
        service: 'Женский Консьерж Сервис',
        description: 'Сервис помощи в повседневных делах',
        version: process.env.APP_VERSION || '2.0.0',
        features: [
            'Дом и быт',
            'Дети и семья',
            'Красота и здоровье',
            'Обучение и курсы',
            'Питомцы',
            'Мероприятия'
        ],
        contact: {
            telegram_bot: telegramBot ? 'active' : 'not_configured',
            admin_id: process.env.SUPER_ADMIN_ID || 'not_set',
            support: 'support@concierge-app.com'
        }
    });
});

// Услуги
app.get('/api/v1/services', (req, res) => {
    res.json({
        success: true,
        services: [
            {
                id: 'home',
                name: 'Дом и быт',
                icon: '🏠',
                description: 'Уборка, ремонт, организация',
                items: ['Уборка квартир', 'Организация пространства', 'Мелкий ремонт']
            },
            {
                id: 'family',
                name: 'Дети и семья',
                icon: '👨‍👩‍👧‍👦',
                description: 'Помощь с детьми и семьей',
                items: ['Няни', 'Репетиторы', 'Организация праздников']
            },
            {
                id: 'beauty',
                name: 'Красота и здоровье',
                icon: '💅',
                description: 'Уход за собой',
                items: ['Маникюр/педикюр', 'Стилисты', 'Фитнес-тренеры']
            },
            {
                id: 'education',
                name: 'Обучение',
                icon: '🎓',
                description: 'Курсы и развитие',
                items: ['Языковые курсы', 'Онлайн-обучение', 'Репетиторы']
            },
            {
                id: 'pets',
                name: 'Питомцы',
                icon: '🐶',
                description: 'Забота о животных',
                items: ['Выгул собак', 'Передержка', 'Груминг']
            },
            {
                id: 'events',
                name: 'Мероприятия',
                icon: '🎉',
                description: 'Организация событий',
                items: ['Праздники', 'Корпоративы', 'Свадьбы']
            }
        ]
    });
});

// Админ статус
app.get('/admin/status', (req, res) => {
    res.json({
        success: true,
        system: {
            node: process.version,
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            environment: process.env.NODE_ENV,
            port: process.env.PORT || 3000
        },
        services: {
            telegram: telegramBot ? {
                username: telegramBot.options?.username,
                id: telegramBot.options?.id,
                status: 'active'
            } : { status: 'inactive' },
            database: {
                status: mongoose.connection?.readyState === 1 ? 'connected' : 'disconnected',
                host: mongoose.connection?.host || 'not_connected'
            }
        },
        settings: {
            app_name: process.env.APP_NAME || 'concierge-app',
            app_version: process.env.APP_VERSION || '2.0.0',
            webapp_url: process.env.WEBAPP_URL || 'not_set',
            super_admin_id: process.env.SUPER_ADMIN_ID || 'not_set',
            admin_ids: process.env.ADMIN_IDS || 'not_set'
        }
    });
});

// Тест Telegram API
app.get('/admin/telegram-test', async (req, res) => {
    try {
        if (!telegramBot) {
            return res.status(400).json({ error: 'Telegram бот не инициализирован' });
        }
        
        const adminId = process.env.SUPER_ADMIN_ID;
        if (!adminId) {
            return res.status(400).json({ error: 'SUPER_ADMIN_ID не указан' });
        }
        
        await telegramBot.sendMessage(adminId,
            `🔔 *Тест из админ-панели*\n\n` +
            `✅ Система работает нормально\n` +
            `🕒 ${new Date().toLocaleString('ru-RU')}\n` +
            `🌐 ${process.env.WEBAPP_URL || 'URL не указан'}`,
            { parse_mode: 'Markdown' }
        );
        
        res.json({
            success: true,
            message: 'Тестовое сообщение отправлено',
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

// 404 обработчик
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Маршрут не найден',
        path: req.originalUrl,
        available_routes: ['/', '/health', '/api/v1/info', '/api/v1/services', '/admin/status']
    });
});

// Обработчик ошибок
app.use((err, req, res, next) => {
    console.error('❌ Ошибка:', err.message);
    
    res.status(err.status || 500).json({
        success: false,
        error: 'Внутренняя ошибка сервера',
        timestamp: new Date().toISOString()
    });
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('='.repeat(60));
        console.log('🚀 ЗАПУСК ЖЕНСКОГО КОНСЬЕРЖ СЕРВИСА v2.0.0');
        console.log('='.repeat(60));
        console.log(`📌 Порт: ${process.env.PORT || 3000}`);
        console.log(`🌐 Режим: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🏷️ Версия: ${process.env.APP_VERSION || '2.0.0'}`);
        console.log(`🔗 WEBAPP_URL: ${process.env.WEBAPP_URL || 'не указан'}`);
        console.log(`🔐 JWT_SECRET: ${process.env.JWT_SECRET ? 'установлен' : 'сгенерирован'}`);
        console.log(`🤖 BOT_TOKEN: ${process.env.BOT_TOKEN ? 'установлен' : 'не указан'}`);
        console.log('='.repeat(60));
        
        // Подключаем базу данных (опционально)
        console.log('🗄️  Подключение к базе данных...');
        await connectDB();
        
        // Запускаем Telegram бота
        console.log('🤖 Инициализация Telegram бота...');
        await initializeTelegramBot();
        
        const PORT = process.env.PORT || 3000;
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`✅ Сервер запущен на порту ${PORT}`);
            console.log(`📊 Health check: http://localhost:${PORT}/health`);
            console.log(`📱 API Info: http://localhost:${PORT}/api/v1/info`);
            console.log(`🛠️  Admin: http://localhost:${PORT}/admin/status`);
            
            if (process.env.WEBAPP_URL) {
                console.log(`🌍 Публичный URL: ${process.env.WEBAPP_URL}`);
                console.log(`🌍 Health check: ${process.env.WEBAPP_URL}/health`);
            }
            
            console.log('='.repeat(60));
            console.log('✨ Приложение готово к работе!');
            console.log('='.repeat(60));
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        process.exit(1);
    }
};

// Запускаем сервер
startServer();
