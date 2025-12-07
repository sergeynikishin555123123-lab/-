const TelegramBot = require('node-telegram-bot-api');
const User = require('../models/User');
const Task = require('../models/Task');
const winston = require('winston');

class TelegramBotService {
    constructor() {
        this.bot = null;
        this.isInitialized = false;
    }

    initialize() {
        try {
            const token = process.env.TELEGRAM_BOT_TOKEN;
            
            if (!token) {
                winston.warn('Telegram bot token не настроен');
                return;
            }

            this.bot = new TelegramBot(token, { polling: true });
            this.isInitialized = true;
            
            this.setupHandlers();
            
            winston.info('✅ Telegram бот инициализирован');
            console.log('✅ Telegram бот инициализирован');
        } catch (error) {
            winston.error('❌ Ошибка инициализации Telegram бота:', error);
            console.error('❌ Ошибка инициализации Telegram бота:', error);
        }
    }

    setupHandlers() {
        // Команда /start
        this.bot.onText(/\/start/, async (msg) => {
            const chatId = msg.chat.id;
            const username = msg.from.username || msg.from.first_name;
            
            try {
                // Проверяем, зарегистрирован ли пользователь
                const user = await User.findOne({ telegramId: chatId.toString() });
                
                if (user) {
                    // Пользователь уже зарегистрирован
                    await this.bot.sendMessage(chatId, 
                        `👋 Добро пожаловать обратно, ${username}!\n\n` +
                        `Вы уже зарегистрированы в сервисе "Женский Консьерж".\n\n` +
                        `Доступные команды:\n` +
                        `/profile - Ваш профиль\n` +
                        `/tasks - Мои задачи\n` +
                        `/newtask - Создать новую задачу\n` +
                        `/services - Доступные услуги\n` +
                        `/help - Помощь`
                    );
                } else {
                    // Новый пользователь
                    await this.bot.sendMessage(chatId,
                        `👋 Привет, ${username}!\n\n` +
                        `Добро пожаловать в сервис "Женский Консьерж"!\n\n` +
                        `Я помогу вам с:\n` +
                        `🏠 Домом и бытом\n` +
                        `👨‍👩‍👧‍👦 Детьми и семьей\n` +
        `💅 Красотой и здоровьем\n` +
        `🎓 Курсами и образованием\n` +
        `🐶 Питомцами\n` +
        `🎉 И многим другим!\n\n` +
        `Для начала работы зарегистрируйтесь на нашем сайте:\n` +
        `https://ваш-сайт.com/register?telegram=${chatId}\n\n` +
        `Или используйте команду /register для регистрации через бота.`
                    );
                }
            } catch (error) {
                winston.error('Ошибка обработки команды /start:', error);
                await this.bot.sendMessage(chatId, 'Произошла ошибка. Пожалуйста, попробуйте позже.');
            }
        });

        // Команда /register
        this.bot.onText(/\/register/, async (msg) => {
            const chatId = msg.chat.id;
            
            try {
                const existingUser = await User.findOne({ telegramId: chatId.toString() });
                
                if (existingUser) {
                    await this.bot.sendMessage(chatId, 'Вы уже зарегистрированы!');
                    return;
                }
                
                await this.bot.sendMessage(chatId,
                    `📝 Регистрация\n\n` +
                    `Для регистрации отправьте:\n\n` +
                    `1. Ваш email\n` +
                    `2. Ваше имя\n` +
                    `3. Вашу фамилию\n\n` +
                    `В формате:\n` +
                    `email@example.com\n` +
                    `Имя\n` +
                    `Фамилия`
                );
                
                // Сохраняем состояние ожидания регистрации
                this.bot.once('message', async (responseMsg) => {
                    if (responseMsg.chat.id === chatId) {
                        const text = responseMsg.text;
                        const lines = text.split('\n');
                        
                        if (lines.length >= 3) {
                            const [email, firstName, lastName] = lines;
                            
                            // Генерируем временный пароль
                            const tempPassword = Math.random().toString(36).slice(-8);
                            
                            try {
                                const user = new User({
                                    email: email.trim(),
                                    firstName: firstName.trim(),
                                    lastName: lastName.trim(),
                                    password: tempPassword,
                                    telegramId: chatId.toString(),
                                    role: 'client'
                                });
                                
                                await user.save();
                                
                                await this.bot.sendMessage(chatId,
                                    `✅ Регистрация успешна!\n\n` +
                                    `Ваш временный пароль: ${tempPassword}\n\n` +
                                    `Пожалуйста, смените его при первом входе на сайте.\n\n` +
                                    `Ссылка для входа: https://ваш-сайт.com/login`
                                );
                            } catch (error) {
                                await this.bot.sendMessage(chatId,
                                    `❌ Ошибка регистрации: ${error.message}`
                                );
                            }
                        } else {
                            await this.bot.sendMessage(chatId,
                                'Неверный формат. Пожалуйста, попробуйте снова.'
                            );
                        }
                    }
                });
            } catch (error) {
                winston.error('Ошибка регистрации через бота:', error);
                await this.bot.sendMessage(chatId, 'Произошла ошибка. Пожалуйста, попробуйте позже.');
            }
        });

        // Команда /profile
        this.bot.onText(/\/profile/, async (msg) => {
            const chatId = msg.chat.id;
            
            try {
                const user = await User.findOne({ telegramId: chatId.toString() });
                
                if (!user) {
                    await this.bot.sendMessage(chatId, 'Вы не зарегистрированы. Используйте /start для начала.');
                    return;
                }
                
                const activeTasks = await Task.countDocuments({
                    client: user._id,
                    status: { $in: ['new', 'assigned', 'in_progress'] }
                });
                
                const completedTasks = await Task.countDocuments({
                    client: user._id,
                    status: 'completed'
                });
                
                await this.bot.sendMessage(chatId,
                    `👤 Ваш профиль\n\n` +
                    `Имя: ${user.firstName} ${user.lastName}\n` +
                    `Email: ${user.email}\n` +
                    `Роль: ${this.translateRole(user.role)}\n` +
                    `Рейтинг: ${user.rating || 'Нет оценок'}\n` +
                    `Активных задач: ${activeTasks}\n` +
                    `Завершено задач: ${completedTasks}\n` +
                    `Подписка: ${user.subscription.plan || 'Нет'}`
                );
            } catch (error) {
                winston.error('Ошибка получения профиля:', error);
                await this.bot.sendMessage(chatId, 'Произошла ошибка. Пожалуйста, попробуйте позже.');
            }
        });

        // Команда /tasks
        this.bot.onText(/\/tasks/, async (msg) => {
            const chatId = msg.chat.id;
            
            try {
                const user = await User.findOne({ telegramId: chatId.toString() });
                
                if (!user) {
                    await this.bot.sendMessage(chatId, 'Вы не зарегистрированы.');
                    return;
                }
                
                const tasks = await Task.find({
                    client: user._id,
                    isArchived: false
                })
                .sort({ createdAt: -1 })
                .limit(5);
                
                if (tasks.length === 0) {
                    await this.bot.sendMessage(chatId, 'У вас пока нет задач.');
                    return;
                }
                
                let message = `📋 Ваши последние задачи:\n\n`;
                
                tasks.forEach((task, index) => {
                    const statusEmoji = this.getStatusEmoji(task.status);
                    message += `${index + 1}. ${statusEmoji} ${task.title}\n`;
                    message += `   №: ${task.taskNumber}\n`;
                    message += `   Статус: ${this.translateStatus(task.status)}\n`;
                    message += `   Дедлайн: ${new Date(task.deadline).toLocaleDateString()}\n`;
                    message += `   Цена: ${task.price} руб.\n\n`;
                });
                
                await this.bot.sendMessage(chatId, message);
            } catch (error) {
                winston.error('Ошибка получения задач:', error);
                await this.bot.sendMessage(chatId, 'Произошла ошибка.');
            }
        });

        // Уведомление о новой задаче
        this.sendTaskNotification = async (task, performer) => {
            if (!this.isInitialized || !performer.telegramId) return;
            
            try {
                await this.bot.sendMessage(performer.telegramId,
                    `🎯 Новая задача для вас!\n\n` +
                    `Название: ${task.title}\n` +
                    `Категория: ${this.translateCategory(task.category)}\n` +
                    `Приоритет: ${this.translatePriority(task.priority)}\n` +
                    `Дедлайн: ${new Date(task.deadline).toLocaleDateString()}\n` +
                    `Цена: ${task.price} руб.\n\n` +
                    `Ссылка на задачу: https://ваш-сайт.com/tasks/${task._id}`
                );
            } catch (error) {
                winston.error('Ошибка отправки уведомления о задаче:', error);
            }
        };

        // Уведомление об изменении статуса
        this.sendStatusUpdate = async (task, oldStatus, newStatus, userId) => {
            if (!this.isInitialized) return;
            
            try {
                const user = await User.findById(userId);
                if (!user || !user.telegramId) return;
                
                await this.bot.sendMessage(user.telegramId,
                    `🔄 Статус задачи обновлен\n\n` +
                    `Задача: ${task.title}\n` +
                    `№: ${task.taskNumber}\n` +
                    `Старый статус: ${this.translateStatus(oldStatus)}\n` +
                    `Новый статус: ${this.translateStatus(newStatus)}\n\n` +
                    `Ссылка на задачу: https://ваш-сайт.com/tasks/${task._id}`
                );
            } catch (error) {
                winston.error('Ошибка отправки уведомления о статусе:', error);
            }
        };
    }

    // Вспомогательные методы для перевода
    translateRole(role) {
        const roles = {
            'client': 'Заказчик',
            'performer': 'Исполнитель',
            'admin': 'Администратор',
            'superadmin': 'Супер-администратор'
        };
        return roles[role] || role;
    }

    translateStatus(status) {
        const statuses = {
            'new': 'Новая',
            'assigned': 'Назначена',
            'in_progress': 'В работе',
            'completed': 'Завершена',
            'cancelled': 'Отменена',
            'reopened': 'Переоткрыта'
        };
        return statuses[status] || status;
    }

    translateCategory(category) {
        const categories = {
            'home': 'Дом и быт',
            'family': 'Дети и семья',
            'beauty': 'Красота и здоровье',
            'courses': 'Курсы',
            'pets': 'Питомцы',
            'other': 'Другое'
        };
        return categories[category] || category;
    }

    translatePriority(priority) {
        const priorities = {
            'low': 'Низкий',
            'medium': 'Средний',
            'high': 'Высокий',
            'urgent': 'Срочный'
        };
        return priorities[priority] || priority;
    }

    getStatusEmoji(status) {
        const emojis = {
            'new': '🆕',
            'assigned': '👤',
            'in_progress': '⚙️',
            'completed': '✅',
            'cancelled': '❌',
            'reopened': '🔄'
        };
        return emojis[status] || '📝';
    }

    // Отправка сообщения пользователю
    async sendMessage(telegramId, message) {
        if (!this.isInitialized || !telegramId) return false;
        
        try {
            await this.bot.sendMessage(telegramId, message);
            return true;
        } catch (error) {
            winston.error('Ошибка отправки сообщения через бота:', error);
            return false;
        }
    }
}

// Создаем и экспортируем экземпляр бота
const telegramBot = new TelegramBotService();

// Функция инициализации для использования в server.js
const initializeBot = () => {
    telegramBot.initialize();
};

module.exports = {
    telegramBot,
    initializeBot
};
