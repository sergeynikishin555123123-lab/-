const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const crypto = require('crypto');
const path = require('path');

// Загрузка переменных окружения
dotenv.config();

const app = express();

// Middleware
app.use(helmet({
    contentSecurityPolicy: false, // Упрощаем для TimeWeb
}));

app.use(cors({
    origin: '*', // Для тестирования
    credentials: true,
}));

app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Статика
app.use('/public', express.static(path.join(__dirname, 'public')));

// ==================== TELEGRAM BOT SETUP ====================
class TelegramBotHandler {
    constructor() {
        this.bot = null;
        this.webhookSecret = null;
        this.commands = {};
        this.setupCommands();
    }

    setupCommands() {
        this.commands = {
            '/start': this.handleStart.bind(this),
            '/help': this.handleHelp.bind(this),
            '/test': this.handleTest.bind(this),
            '/status': this.handleStatus.bind(this),
            '/id': this.handleGetId.bind(this),
        };
    }

    async initialize() {
        const token = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
        
        if (!token || token === 'your_telegram_bot_token_here') {
            console.log('🤖 Telegram бот отключен: токен не указан');
            return false;
        }

        try {
            const TelegramBot = require('node-telegram-bot-api');
            
            // Для TimeWeb используем только webhook режим
            this.bot = new TelegramBot(token, {
                webHook: true,
                onlyFirstMatch: true
            });

            // Генерируем секрет для вебхука
            this.webhookSecret = crypto.randomBytes(16).toString('hex');
            
            const webhookUrl = `${process.env.WEBAPP_URL}/telegram-webhook/${this.webhookSecret}`;
            
            console.log(`🔗 Настраиваем вебхук: ${webhookUrl}`);
            
            // Устанавливаем вебхук
            await this.bot.setWebHook(webhookUrl, {
                drop_pending_updates: true,
                secret_token: this.webhookSecret
            });

            // Получаем информацию о боте
            const botInfo = await this.bot.getMe();
            
            console.log('✅ Telegram бот инициализирован!');
            console.log(`🤖 Имя: ${botInfo.first_name} (@${botInfo.username})`);
            console.log(`🔗 Ссылка: https://t.me/${botInfo.username}`);
            console.log(`🔐 Webhook секрет: ${this.webhookSecret}`);
            
            return true;
            
        } catch (error) {
            console.error('❌ Ошибка инициализации Telegram бота:', error.message);
            
            if (error.code === 'ETELEGRAM') {
                console.error('Проверьте правильность BOT_TOKEN');
            } else if (error.response?.body?.description) {
                console.error(`Telegram API: ${error.response.body.description}`);
            }
            
            return false;
        }
    }

    // Обработчик вебхука
    async handleWebhook(update) {
        try {
            console.log('📨 Получено обновление от Telegram:', update.update_id);
            
            if (update.message) {
                await this.handleMessage(update.message);
            } else if (update.callback_query) {
                await this.handleCallbackQuery(update.callback_query);
            }
            
            return { success: true };
            
        } catch (error) {
            console.error('Ошибка обработки вебхука:', error);
            return { success: false, error: error.message };
        }
    }

    // Обработчик сообщений
    async handleMessage(message) {
        const chatId = message.chat.id;
        const text = message.text || '';
        const firstName = message.from.first_name || 'Пользователь';
        const username = message.from.username || 'без username';

        console.log(`💬 Сообщение от ${firstName} (@${username}): ${text}`);

        // Проверяем команды
        const command = text.split(' ')[0].toLowerCase();
        
        if (this.commands[command]) {
            await this.commands[command](chatId, message);
        } else {
            await this.handleUnknownCommand(chatId, firstName);
        }
    }

    // Обработчик callback запросов
    async handleCallbackQuery(callbackQuery) {
        const chatId = callbackQuery.message.chat.id;
        const data = callbackQuery.data;
        
        console.log(`🔘 Callback от ${chatId}: ${data}`);
        
        await this.bot.answerCallbackQuery(callbackQuery.id);
    }

    // ========== КОМАНДЫ БОТА ==========

    async handleStart(chatId, message) {
        const firstName = message.from.first_name;
        const welcomeText = `
👋 *Привет, ${firstName}!*

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
/status - Статус бота
/id - Получить ваш ID

*Сайт:* ${process.env.WEBAPP_URL}

Напишите /help для полного списка команд.
        `.trim();

        await this.sendMessage(chatId, welcomeText);
    }

    async handleHelp(chatId) {
        const helpText = `
*🤖 Помощь по боту*

*Основные команды:*
/start - Начало работы
/help - Эта справка
/test - Проверка связи
/status - Статус сервиса
/id - Ваш Telegram ID

*Сервис работает на:* ${process.env.WEBAPP_URL}

*Версия:* ${process.env.APP_VERSION || '1.0.0'}

*Для администраторов:*
/admin - Панель управления
/stats - Статистика
        `.trim();

        await this.sendMessage(chatId, helpText);
    }

    async handleTest(chatId) {
        const testText = `
✅ *Тест связи успешен!*

*Информация:*
🕒 Время сервера: ${new Date().toLocaleString('ru-RU')}
📡 Статус: Онлайн
🌐 Сервер: TimeWeb Cloud
🔧 Версия: ${process.env.APP_VERSION || '1.0.0'}

*Ваши данные:*
👤 Chat ID: \`${chatId}\`
📱 Для администратора: ${process.env.SUPER_ADMIN_ID || 'не указан'}
        `.trim();

        await this.sendMessage(chatId, testText);
    }

    async handleStatus(chatId) {
        const status = {
            bot: this.bot ? '✅ Онлайн' : '❌ Оффлайн',
            server: '✅ Работает',
            time: new Date().toLocaleString('ru-RU'),
            uptime: process.uptime().toFixed(0) + ' сек',
            memory: `${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)} MB`,
            url: process.env.WEBAPP_URL || 'не указан'
        };

        const statusText = `
*📊 Статус системы*

🤖 *Бот:* ${status.bot}
🖥️ *Сервер:* ${status.server}
🕒 *Время:* ${status.time}
⏱️ *Uptime:* ${status.uptime}
💾 *Память:* ${status.memory}
🌐 *URL:* ${status.url}

*Администраторы:*
${process.env.ADMIN_IDS || 'не указаны'}
        `.trim();

        await this.sendMessage(chatId, statusText);
    }

    async handleGetId(chatId, message) {
        const userInfo = `
*👤 Ваш профиль Telegram*

*ID:* \`${message.from.id}\`
*Имя:* ${message.from.first_name}
*Фамилия:* ${message.from.last_name || 'не указана'}
*Username:* @${message.from.username || 'не указан'}
*Язык:* ${message.from.language_code || 'не указан'}

*Chat ID:* \`${chatId}\`

*Для администратора:*
Этот ID можно добавить в ADMIN_IDS в настройках.
        `.trim();

        await this.sendMessage(chatId, userInfo);
    }

    async handleUnknownCommand(chatId, firstName) {
        const unknownText = `
🤔 *Неизвестная команда, ${firstName}!*

Используйте одну из доступных команд:

/start - Начало работы
/help - Все команды
/test - Проверка связи
/status - Статус системы
/id - Ваш Telegram ID

Или посетите наш сайт: ${process.env.WEBAPP_URL}
        `.trim();

        await this.sendMessage(chatId, unknownText);
    }

    // Утилитарный метод для отправки сообщений
    async sendMessage(chatId, text, options = {}) {
        try {
            if (!this.bot) {
                console.error('Бот не инициализирован');
                return false;
            }

            const messageOptions = {
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
                ...options
            };

            await this.bot.sendMessage(chatId, text, messageOptions);
            return true;
            
        } catch (error) {
            console.error('Ошибка отправки сообщения:', error.message);
            
            // Логируем специфические ошибки
            if (error.response?.body?.description) {
                console.error(`Telegram API: ${error.response.body.description}`);
            }
            
            return false;
        }
    }
}

// Создаем экземпляр бота
const telegramBot = new TelegramBotHandler();

// ==================== EXPRESS ROUTES ====================

// Health check для TimeWeb
app.get('/api/v1/health', (req, res) => {
    res.json({
        status: 'OK',
        app: process.env.APP_NAME || 'concierge-app',
        version: process.env.APP_VERSION || '1.0.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        telegram: telegramBot.bot ? 'connected' : 'disconnected',
        environment: process.env.NODE_ENV || 'development',
        deployment: 'TimeWeb Cloud'
    });
});

// Главная страница
app.get('/', (req, res) => {
    res.json({
        message: '🎀 Женский Консьерж Сервис',
        description: 'Помощь в повседневных делах',
        version: process.env.APP_VERSION || '1.0.0',
        endpoints: {
            home: '/',
            health: '/api/v1/health',
            telegram_webhook: `/telegram-webhook/:secret`,
            info: '/api/v1/info'
        },
        telegram: {
            bot: telegramBot.bot ? 'active' : 'inactive',
            webhook_setup: 'required'
        }
    });
});

// Информация о сервисе
app.get('/api/v1/info', (req, res) => {
    res.json({
        success: true,
        service: 'Женский Консьерж Сервис',
        description: 'Сервис помощи в повседневных делах для женщин',
        features: [
            'Дом и быт',
            'Дети и семья', 
            'Красота и здоровье',
            'Курсы и обучение',
            'Питомцы',
            'Мероприятия'
        ],
        contact: {
            telegram_bot: process.env.BOT_TOKEN ? 'configured' : 'not_configured',
            admin_ids: process.env.ADMIN_IDS || 'not_set'
        }
    });
});

// Вебхук для Telegram (ОЧЕНЬ ВАЖНО!)
app.post('/telegram-webhook/:secret', async (req, res) => {
    try {
        const secret = req.params.secret;
        
        // Проверяем секрет
        if (secret !== telegramBot.webhookSecret) {
            console.warn('❌ Неверный секрет вебхука:', secret);
            return res.status(403).json({ error: 'Invalid webhook secret' });
        }
        
        const update = req.body;
        
        console.log('📨 Webhook получен:', {
            update_id: update.update_id,
            message: update.message ? 'yes' : 'no',
            callback: update.callback_query ? 'yes' : 'no'
        });
        
        // Обрабатываем обновление
        const result = await telegramBot.handleWebhook(update);
        
        if (result.success) {
            res.json({ ok: true });
        } else {
            res.status(500).json({ error: result.error });
        }
        
    } catch (error) {
        console.error('❌ Ошибка в вебхуке:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Ручная проверка бота (для админов)
app.get('/admin/telegram-test', async (req, res) => {
    try {
        if (!telegramBot.bot) {
            return res.json({ error: 'Бот не инициализирован' });
        }
        
        const botInfo = await telegramBot.bot.getMe();
        const webhookInfo = await telegramBot.bot.getWebHookInfo();
        
        res.json({
            success: true,
            bot: {
                id: botInfo.id,
                name: botInfo.first_name,
                username: botInfo.username,
                is_bot: botInfo.is_bot
            },
            webhook: {
                url: webhookInfo.url,
                has_custom_certificate: webhookInfo.has_custom_certificate,
                pending_update_count: webhookInfo.pending_update_count,
                last_error_date: webhookInfo.last_error_date,
                last_error_message: webhookInfo.last_error_message
            },
            environment: {
                webapp_url: process.env.WEBAPP_URL,
                bot_token_set: !!process.env.BOT_TOKEN,
                admin_ids: process.env.ADMIN_IDS
            }
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Настройка вебхука вручную
app.post('/admin/set-webhook', async (req, res) => {
    try {
        if (!telegramBot.bot) {
            return res.json({ error: 'Бот не инициализирован' });
        }
        
        const webhookUrl = `${process.env.WEBAPP_URL}/telegram-webhook/${telegramBot.webhookSecret}`;
        const result = await telegramBot.bot.setWebHook(webhookUrl, {
            drop_pending_updates: true,
            secret_token: telegramBot.webhookSecret
        });
        
        res.json({
            success: true,
            message: 'Webhook установлен',
            url: webhookUrl,
            secret: telegramBot.webhookSecret,
            result: result
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 404
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Route not found',
        path: req.originalUrl
    });
});

// ==================== SERVER START ====================
const startServer = async () => {
    try {
        const PORT = process.env.PORT || 3000;
        
        console.log('='.repeat(60));
        console.log('🚀 ЗАПУСК ЖЕНСКОГО КОНСЬЕРЖ СЕРВИСА');
        console.log('='.repeat(60));
        console.log(`📌 Порт: ${PORT}`);
        console.log(`🌐 Режим: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🏷️ Версия: ${process.env.APP_VERSION || '1.0.0'}`);
        console.log(`🔗 WEBAPP_URL: ${process.env.WEBAPP_URL || 'не указан'}`);
        console.log('='.repeat(60));
        
        // Инициализируем бота
        console.log('🤖 Инициализация Telegram бота...');
        const botInitialized = await telegramBot.initialize();
        
        if (botInitialized) {
            console.log('✅ Telegram бот готов к работе!');
            
            // Отправляем тестовое сообщение администратору
            const adminId = process.env.SUPER_ADMIN_ID;
            if (adminId && telegramBot.bot) {
                try {
                    await telegramBot.sendMessage(adminId, 
                        `🚀 Сервис запущен!\n\n` +
                        `🌐 URL: ${process.env.WEBAPP_URL || 'не указан'}\n` +
                        `🕒 Время: ${new Date().toLocaleString('ru-RU')}\n` +
                        `🔧 Версия: ${process.env.APP_VERSION || '1.0.0'}\n\n` +
                        `Бот готов принимать команды.`
                    );
                    console.log(`📨 Тестовое сообщение отправлено администратору ${adminId}`);
                } catch (error) {
                    console.warn('Не удалось отправить тестовое сообщение администратору:', error.message);
                }
            }
        } else {
            console.log('⚠️ Telegram бот не инициализирован. Проверьте BOT_TOKEN в настройках.');
        }
        
        // Запускаем сервер
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`✅ Сервер запущен: http://localhost:${PORT}`);
            console.log(`📊 Health check: http://localhost:${PORT}/api/v1/health`);
            console.log(`🛠️  Admin test: http://localhost:${PORT}/admin/telegram-test`);
            
            if (process.env.WEBAPP_URL) {
                console.log(`🌍 Публичный URL: ${process.env.WEBAPP_URL}`);
            }
            
            if (botInitialized && telegramBot.webhookSecret) {
                console.log(`🔗 Webhook URL: ${process.env.WEBAPP_URL}/telegram-webhook/${telegramBot.webhookSecret}`);
            }
            
            console.log('='.repeat(60));
        });
        
    } catch (error) {
        console.error('❌ Ошибка запуска сервера:', error);
        process.exit(1);
    }
};

// Запускаем сервер
startServer();

module.exports = app;
