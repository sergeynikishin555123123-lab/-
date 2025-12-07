const TelegramBot = require('node-telegram-bot-api');
const User = require('../models/User');
const Task = require('../models/Task');
const winston = require('winston');

class TelegramBotService {
    constructor() {
        this.bot = null;
        this.isInitialized = false;
        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            ),
            transports: [
                new winston.transports.Console({
                    format: winston.format.combine(
                        winston.format.colorize(),
                        winston.format.simple()
                    )
                })
            ]
        });
    }

    initialize() {
        try {
            const token = process.env.TELEGRAM_BOT_TOKEN;
            
            if (!token || token === 'your_telegram_bot_token_here') {
                this.logger.warn('Telegram bot token не настроен или установлен по умолчанию');
                console.log('⚠️  Telegram бот отключен. Установите TELEGRAM_BOT_TOKEN в .env');
                return null;
            }

            // Проверяем форток токена
            if (!token.includes(':')) {
                this.logger.error('Неверный формат Telegram токена');
                console.error('❌ Неверный формат Telegram токена. Должен быть в формате "1234567890:ABCdefGhIjKlmNoPQRsTUVwxyZ"');
                return null;
            }

            // Используем webhook вместо polling для стабильности
            this.bot = new TelegramBot(token, { 
                polling: {
                    interval: 300,
                    autoStart: true,
                    params: {
                        timeout: 10
                    }
                }
            });
            
            this.isInitialized = true;
            
            this.setupHandlers();
            
            this.logger.info('✅ Telegram бот инициализирован');
            console.log('✅ Telegram бот инициализирован');
            console.log(`🤖 Имя бота: @${this.bot.options.username || 'не определено'}`);
            
            // Тестовая команда для проверки
            this.bot.getMe().then((botInfo) => {
                console.log(`🤖 Бот @${botInfo.username} готов к работе!`);
                console.log(`🔗 Ссылка: https://t.me/${botInfo.username}`);
            }).catch(err => {
                console.error('❌ Не удалось получить информацию о боте:', err.message);
            });
            
            return this.bot;
        } catch (error) {
            this.logger.error('❌ Ошибка инициализации Telegram бота:', error);
            console.error('❌ Ошибка инициализации Telegram бота:', error.message);
            
            // Подробная диагностика
            if (error.code === 'ETELEGRAM') {
                console.error('Проверьте правильность TELEGRAM_BOT_TOKEN');
            } else if (error.code === 'ENOTFOUND') {
                console.error('Проблемы с сетью. Проверьте интернет-соединение');
            }
            
            return null;
        }
    }

    setupHandlers() {
        if (!this.bot) return;
        
        // Обработчик ошибок бота
        this.bot.on('error', (error) => {
            this.logger.error('Ошибка Telegram бота:', error);
            console.error('❌ Ошибка Telegram бота:', error.message);
        });
        
        // Обработчик polling ошибок
        this.bot.on('polling_error', (error) => {
            this.logger.error('Ошибка polling Telegram бота:', error);
            console.error('❌ Ошибка polling Telegram бота:', error.message);
            
            // Пытаемся перезапустить polling через 5 секунд
            setTimeout(() => {
                console.log('🔄 Попытка перезапуска polling...');
                this.bot.startPolling();
            }, 5000);
        });
        
        // Команда /start
        this.bot.onText(/\/start/, async (msg) => {
            const chatId = msg.chat.id;
            const username = msg.from.username || msg.from.first_name;
            
            console.log(`🔄 Команда /start от ${username} (${chatId})`);
            
            try {
                const welcomeMessage = 
                    `👋 Привет, ${username}!\n\n` +
                    `Добро пожаловать в *Женский Консьерж Сервис*! 🎀\n\n` +
                    `Я помогу вам:\n` +
                    `🏠 С домом и бытом\n` +
                    `👨‍👩‍👧‍👦 С детьми и семьей\n` +
                    `💅 С красотой и здоровьем\n` +
                    `🎓 С курсами и образованием\n` +
                    `🐶 С питомцами\n` +
                    `🎉 И многим другим!\n\n` +
                    `*Доступные команды:*\n` +
                    `/help - Помощь и список команд\n` +
                    `/register - Регистрация в сервисе\n` +
                    `/profile - Ваш профиль\n` +
                    `/tasks - Ваши задачи\n` +
                    `/newtask - Создать новую задачу\n` +
                    `/services - Доступные услуги\n\n` +
                    `Для начала работы зарегистрируйтесь через команду /register`;
                
                await this.bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
                
            } catch (error) {
                console.error('Ошибка обработки /start:', error);
                await this.bot.sendMessage(chatId, 'Произошла ошибка. Пожалуйста, попробуйте позже.');
            }
        });
        
        // Команда /help
        this.bot.onText(/\/help/, async (msg) => {
            const chatId = msg.chat.id;
            
            const helpMessage = 
                `*Помощь по боту* 🤖\n\n` +
                `*Основные команды:*\n` +
                `/start - Начало работы\n` +
                `/help - Эта справка\n` +
                `/register - Регистрация в сервисе\n` +
                `/profile - Ваш профиль\n\n` +
                `*Работа с задачами:*\n` +
                `/tasks - Список ваших задач\n` +
                `/newtask - Создать новую задачу\n` +
                `/activetasks - Активные задачи\n` +
                `/completedtasks - Завершенные задачи\n\n` +
                `*Услуги:*\n` +
                `/services - Все услуги\n` +
                `/services_home - Дом и быт\n` +
                `/services_family - Дети и семья\n` +
                `/services_beauty - Красота и здоровье\n\n` +
                `*Связь:*\n` +
                `/support - Связаться с поддержкой\n` +
                `/feedback - Оставить отзыв\n\n` +
                `Для регистрации используйте /register`;
            
            await this.bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
        });
        
        // Команда /register
        this.bot.onText(/\/register/, async (msg) => {
            const chatId = msg.chat.id;
            const username = msg.from.username || msg.from.first_name;
            
            console.log(`📝 Регистрация от ${username} (${chatId})`);
            
            try {
                // Проверяем, не зарегистрирован ли уже пользователь
                const existingUser = await User.findOne({ telegramId: chatId.toString() });
                
                if (existingUser) {
                    await this.bot.sendMessage(chatId, 
                        `✅ Вы уже зарегистрированы!\n\n` +
                        `Имя: ${existingUser.firstName} ${existingUser.lastName}\n` +
                        `Email: ${existingUser.email}\n` +
                        `Роль: ${this.translateRole(existingUser.role)}\n\n` +
                        `Используйте /profile для просмотра профиля`
                    );
                    return;
                }
                
                // Отправляем инструкцию по регистрации
                const registerMessage = 
                    `📝 *Регистрация в сервисе*\n\n` +
                    `Для регистрации отправьте следующие данные в одном сообщении:\n\n` +
                    `*Формат:*\n` +
                    `Имя\n` +
                    `Фамилия\n` +
                    `Email\n` +
                    `Телефон (необязательно)\n\n` +
                    `*Пример:*\n` +
                    `Анна\n` +
                    `Иванова\n` +
                    `anna@example.com\n` +
                    `+79991234567\n\n` +
                    `После регистрации вы получите временный пароль для входа на сайт.`;
                
                await this.bot.sendMessage(chatId, registerMessage, { parse_mode: 'Markdown' });
                
                // Ожидаем ответ с данными
                this.bot.once('message', async (responseMsg) => {
                    if (responseMsg.chat.id === chatId && !responseMsg.text.startsWith('/')) {
                        await this.processRegistration(chatId, responseMsg.text, username);
                    }
                });
                
            } catch (error) {
                console.error('Ошибка регистрации:', error);
                await this.bot.sendMessage(chatId, 
                    '❌ Произошла ошибка при регистрации. Пожалуйста, попробуйте позже.'
                );
            }
        });
        
        // Команда /profile
        this.bot.onText(/\/profile/, async (msg) => {
            const chatId = msg.chat.id;
            
            try {
                const user = await User.findOne({ telegramId: chatId.toString() });
                
                if (!user) {
                    await this.bot.sendMessage(chatId, 
                        '❌ Вы не зарегистрированы.\n\n' +
                        'Используйте /register для регистрации в сервисе.'
                    );
                    return;
                }
                
                // Получаем статистику
                const [activeTasks, completedTasks, totalTasks] = await Promise.all([
                    Task.countDocuments({ 
                        client: user._id,
                        status: { $in: ['new', 'assigned', 'in_progress'] }
                    }),
                    Task.countDocuments({ 
                        client: user._id,
                        status: 'completed'
                    }),
                    Task.countDocuments({ client: user._id })
                ]);
                
                const profileMessage = 
                    `👤 *Ваш профиль*\n\n` +
                    `*Имя:* ${user.firstName} ${user.lastName}\n` +
                    `*Email:* ${user.email}\n` +
                    `*Роль:* ${this.translateRole(user.role)}\n` +
                    `*Рейтинг:* ${user.rating || 'Нет оценок'}\n\n` +
                    `*Статистика:*\n` +
                    `Всего задач: ${totalTasks}\n` +
                    `Активных: ${activeTasks}\n` +
                    `Завершено: ${completedTasks}\n\n` +
                    `*Подписка:* ${user.subscription?.plan ? this.translatePlan(user.subscription.plan) : 'Нет'}\n` +
                    `Статус: ${user.subscription?.status === 'active' ? 'Активна' : 'Неактивна'}`;
                
                await this.bot.sendMessage(chatId, profileMessage, { parse_mode: 'Markdown' });
                
            } catch (error) {
                console.error('Ошибка получения профиля:', error);
                await this.bot.sendMessage(chatId, 'Произошла ошибка. Пожалуйста, попробуйте позже.');
            }
        });
        
        // Команда /test - для проверки работы бота
        this.bot.onText(/\/test/, async (msg) => {
            const chatId = msg.chat.id;
            const time = new Date().toLocaleTimeString();
            
            await this.bot.sendMessage(chatId, 
                `✅ Бот работает!\n` +
                `Время сервера: ${time}\n` +
                `Chat ID: ${chatId}`
            );
        });
        
        // Команда /status - статус бота
        this.bot.onText(/\/status/, async (msg) => {
            const chatId = msg.chat.id;
            
            const statusMessage = 
                `📊 *Статус бота*\n\n` +
                `✅ Бот активен и работает\n` +
                `🤖 Имя: @${this.bot.options.username || 'не определено'}\n` +
                `🔄 Polling: ${this.isInitialized ? 'Активно' : 'Неактивно'}\n` +
                `📅 Серверное время: ${new Date().toLocaleString()}\n\n` +
                `Для проверки связи используйте /test`;
            
            await this.bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
        });
        
        console.log('✅ Обработчики команд Telegram бота настроены');
    }
    
    async processRegistration(chatId, userData, username) {
        try {
            const lines = userData.split('\n').map(line => line.trim());
            
            if (lines.length < 3) {
                await this.bot.sendMessage(chatId,
                    '❌ Недостаточно данных. Пожалуйста, отправьте данные в указанном формате:\n' +
                    'Имя\nФамилия\nEmail\nТелефон (необязательно)'
                );
                return;
            }
            
            const [firstName, lastName, email, phone] = lines;
            
            // Валидация email
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                await this.bot.sendMessage(chatId, '❌ Неверный формат email. Попробуйте снова.');
                return;
            }
            
            // Проверяем, не занят ли email
            const existingUserByEmail = await User.findOne({ email });
            if (existingUserByEmail) {
                await this.bot.sendMessage(chatId, 
                    '❌ Пользователь с таким email уже зарегистрирован.'
                );
                return;
            }
            
            // Генерируем временный пароль
            const tempPassword = Math.random().toString(36).slice(-8);
            
            // Создаем пользователя
            const user = new User({
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
            
            await user.save();
            
            // Отправляем приветственное сообщение
            const welcomeMessage = 
                `🎉 *Регистрация успешна!*\n\n` +
                `Добро пожаловать в Женский Консьерж Сервис, ${firstName}!\n\n` +
                `*Ваши данные:*\n` +
                `👤 Имя: ${firstName} ${lastName}\n` +
                `📧 Email: ${email}\n` +
                `📱 Telegram: @${username || 'не указан'}\n\n` +
                `*Временный пароль:* ${tempPassword}\n\n` +
                `⚠️ *Важно:*\n` +
                `1. Сохраните этот пароль\n` +
                `2. Смените его при первом входе на сайте\n` +
                `3. Не сообщайте пароль никому\n\n` +
                `*Ссылка для входа:*\n` +
                `${process.env.FRONTEND_URL || 'https://ваш-сайт.com'}/login\n\n` +
                `Теперь вы можете:\n` +
                `• Создавать задачи (/newtask)\n` +
                `• Просматривать услуги (/services)\n` +
                `• Смотреть свой профиль (/profile)\n\n` +
                `Для помощи используйте /help`;
            
            await this.bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
            
            console.log(`✅ Новый пользователь зарегистрирован: ${email} (${chatId})`);
            
        } catch (error) {
            console.error('Ошибка обработки регистрации:', error);
            
            let errorMessage = '❌ Произошла ошибка при регистрации. ';
            
            if (error.code === 11000) {
                errorMessage += 'Пользователь с таким Telegram ID уже зарегистрирован.';
            } else if (error.name === 'ValidationError') {
                errorMessage += 'Некорректные данные. Пожалуйста, проверьте введенные данные.';
            } else {
                errorMessage += 'Пожалуйста, попробуйте позже.';
            }
            
            await this.bot.sendMessage(chatId, errorMessage);
        }
    }
    
    // Вспомогательные методы для перевода
    translateRole(role) {
        const roles = {
            'client': '👤 Заказчик',
            'performer': '👷 Исполнитель',
            'admin': '👑 Администратор',
            'superadmin': '👑 Супер-администратор'
        };
        return roles[role] || role;
    }
    
    translatePlan(plan) {
        const plans = {
            'free': '🆓 Бесплатный',
            'basic': '✨ Базовый',
            'premium': '💎 Премиум',
            'vip': '👑 VIP'
        };
        return plans[plan] || plan;
    }
    
    // Отправка сообщения пользователю
    async sendMessage(telegramId, message) {
        if (!this.isInitialized || !telegramId) {
            console.log('Бот не инициализирован или отсутствует telegramId');
            return false;
        }
        
        try {
            await this.bot.sendMessage(telegramId, message, { parse_mode: 'Markdown' });
            return true;
        } catch (error) {
            console.error('Ошибка отправки сообщения через бота:', error.message);
            return false;
        }
    }
}

// Создаем и экспортируем экземпляр бота
const telegramBot = new TelegramBotService();

// Функция инициализации для использования в server.js
const initializeBot = () => {
    return telegramBot.initialize();
};

module.exports = {
    telegramBot,
    initializeBot
};
