const User = require('../models/User');
const Helpers = require('../utils/helpers');
const { telegramBot } = require('../utils/telegramBot');
const winston = require('winston');

class AuthController {
    // Регистрация пользователя
    static async register(req, res) {
        try {
            const { email, password, firstName, lastName, phone, role, telegramId } = req.body;
            
            // Проверяем, существует ли пользователь
            const existingUser = await User.findOne({ 
                $or: [
                    { email },
                    ...(telegramId ? [{ telegramId }] : [])
                ]
            });
            
            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    error: existingUser.email === email 
                        ? 'Пользователь с таким email уже существует' 
                        : 'Пользователь с таким Telegram ID уже существует'
                });
            }
            
            // Создаем пользователя
            const user = new User({
                email,
                password,
                firstName,
                lastName,
                phone,
                role: role || 'client',
                telegramId,
                subscription: {
                    plan: 'free',
                    status: 'active',
                    startDate: new Date(),
                    endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 дней
                }
            });
            
            await user.save();
            
            // Генерируем токен
            const token = Helpers.generateToken(user._id);
            
            // Обновляем последний вход
            user.lastLogin = new Date();
            await user.save();
            
            // Отправляем приветственное сообщение в Telegram
            if (telegramId && telegramBot) {
                await telegramBot.sendMessage(
                    telegramId,
                    `🎉 Добро пожаловать в "Женский Консьерж", ${firstName}!\n\n` +
                    `Ваша регистрация прошла успешно.\n` +
                    `Теперь вы можете создавать задачи и пользоваться нашим сервисом.\n\n` +
                    `Для быстрого доступа используйте команды:\n` +
                    `/profile - Ваш профиль\n` +
                    `/newtask - Создать задачу\n` +
                    `/help - Помощь`
                );
            }
            
            // Логируем действие
            Helpers.logAction(user, 'registration', { method: 'email' });
            
            res.status(201).json({
                success: true,
                message: 'Регистрация прошла успешно',
                data: {
                    token,
                    user: {
                        id: user._id,
                        email: user.email,
                        firstName: user.firstName,
                        lastName: user.lastName,
                        role: user.role,
                        telegramId: user.telegramId,
                        subscription: user.subscription
                    }
                }
            });
        } catch (error) {
            winston.error('Ошибка регистрации:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при регистрации');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Вход пользователя
    static async login(req, res) {
        try {
            const { email, password } = req.body;
            
            // Находим пользователя
            const user = await User.findOne({ email }).select('+password');
            
            if (!user) {
                return res.status(401).json({
                    success: false,
                    error: 'Неверный email или пароль'
                });
            }
            
            // Проверяем активность аккаунта
            if (!user.isActive) {
                return res.status(403).json({
                    success: false,
                    error: 'Аккаунт деактивирован. Свяжитесь с администратором'
                });
            }
            
            // Проверяем пароль
            const isPasswordValid = await user.comparePassword(password);
            
            if (!isPasswordValid) {
                return res.status(401).json({
                    success: false,
                    error: 'Неверный email или пароль'
                });
            }
            
            // Генерируем токен
            const token = Helpers.generateToken(user._id);
            
            // Обновляем последний вход
            user.lastLogin = new Date();
            await user.save();
            
            // Логируем действие
            Helpers.logAction(user, 'login', { method: 'email' });
            
            res.json({
                success: true,
                message: 'Вход выполнен успешно',
                data: {
                    token,
                    user: {
                        id: user._id,
                        email: user.email,
                        firstName: user.firstName,
                        lastName: user.lastName,
                        role: user.role,
                        telegramId: user.telegramId,
                        subscription: user.subscription,
                        rating: user.rating,
                        completedTasks: user.completedTasks
                    }
                }
            });
        } catch (error) {
            winston.error('Ошибка входа:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при входе');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Вход через Telegram
    static async telegramLogin(req, res) {
        try {
            const { telegramId } = req.body;
            
            if (!telegramId) {
                return res.status(400).json({
                    success: false,
                    error: 'Telegram ID обязателен'
                });
            }
            
            // Находим пользователя
            const user = await User.findOne({ telegramId });
            
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'Пользователь не найден. Пожалуйста, зарегистрируйтесь'
                });
            }
            
            // Проверяем активность аккаунта
            if (!user.isActive) {
                return res.status(403).json({
                    success: false,
                    error: 'Аккаунт деактивирован'
                });
            }
            
            // Генерируем токен
            const token = Helpers.generateToken(user._id);
            
            // Обновляем последний вход
            user.lastLogin = new Date();
            await user.save();
            
            // Логируем действие
            Helpers.logAction(user, 'login', { method: 'telegram' });
            
            res.json({
                success: true,
                message: 'Вход через Telegram выполнен',
                data: {
                    token,
                    user: {
                        id: user._id,
                        email: user.email,
                        firstName: user.firstName,
                        lastName: user.lastName,
                        role: user.role,
                        telegramId: user.telegramId,
                        subscription: user.subscription
                    }
                }
            });
        } catch (error) {
            winston.error('Ошибка входа через Telegram:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при входе через Telegram');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Получение текущего пользователя
    static async getCurrentUser(req, res) {
        try {
            const user = await User.findById(req.user._id)
                .select('-password')
                .populate('subscription');
            
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'Пользователь не найден'
                });
            }
            
            res.json({
                success: true,
                data: { user }
            });
        } catch (error) {
            winston.error('Ошибка получения пользователя:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при получении данных пользователя');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Обновление профиля
    static async updateProfile(req, res) {
        try {
            const updates = req.body;
            const allowedUpdates = ['firstName', 'lastName', 'phone', 'avatar', 'preferences'];
            
            // Фильтруем только разрешенные поля
            const filteredUpdates = {};
            allowedUpdates.forEach(field => {
                if (updates[field] !== undefined) {
                    filteredUpdates[field] = updates[field];
                }
            });
            
            // Обновляем пользователя
            const user = await User.findByIdAndUpdate(
                req.user._id,
                filteredUpdates,
                { new: true, runValidators: true }
            ).select('-password');
            
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'Пользователь не найден'
                });
            }
            
            // Логируем действие
            Helpers.logAction(user, 'profile_update', { fields: Object.keys(filteredUpdates) });
            
            res.json({
                success: true,
                message: 'Профиль успешно обновлен',
                data: { user }
            });
        } catch (error) {
            winston.error('Ошибка обновления профиля:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при обновлении профиля');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Смена пароля
    static async changePassword(req, res) {
        try {
            const { currentPassword, newPassword } = req.body;
            
            // Находим пользователя с паролем
            const user = await User.findById(req.user._id).select('+password');
            
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'Пользователь не найден'
                });
            }
            
            // Проверяем текущий пароль
            const isPasswordValid = await user.comparePassword(currentPassword);
            
            if (!isPasswordValid) {
                return res.status(401).json({
                    success: false,
                    error: 'Текущий пароль неверен'
                });
            }
            
            // Проверяем сложность нового пароля
            const strength = Helpers.checkPasswordStrength(newPassword);
            if (strength.score < 3) {
                return res.status(400).json({
                    success: false,
                    error: 'Пароль слишком слабый. ' + strength.message
                });
            }
            
            // Обновляем пароль
            user.password = newPassword;
            await user.save();
            
            // Отправляем уведомление в Telegram
            if (user.telegramId && telegramBot) {
                await telegramBot.sendMessage(
                    user.telegramId,
                    '🔐 Ваш пароль был успешно изменен.\n' +
                    'Если это были не вы, немедленно свяжитесь с поддержкой.'
                );
            }
            
            // Логируем действие
            Helpers.logAction(user, 'password_change');
            
            res.json({
                success: true,
                message: 'Пароль успешно изменен'
            });
        } catch (error) {
            winston.error('Ошибка смены пароля:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при смене пароля');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Запрос сброса пароля
    static async forgotPassword(req, res) {
        try {
            const { email } = req.body;
            
            const user = await User.findOne({ email });
            
            if (!user) {
                // Для безопасности не сообщаем, что пользователь не найден
                return res.json({
                    success: true,
                    message: 'Если пользователь с таким email существует, инструкции по сбросу пароля будут отправлены'
                });
            }
            
            // Генерируем токен сброса
            const resetToken = Helpers.generateResetToken(user._id);
            
            // В реальном приложении здесь нужно:
            // 1. Сохранить resetToken в БД
            // 2. Отправить email с ссылкой
            
            // Пока просто возвращаем токен (для тестирования)
            res.json({
                success: true,
                message: 'Инструкции по сбросу пароля отправлены на email',
                data: {
                    resetUrl: resetToken.url,
                    expiresIn: '1 час'
                }
            });
        } catch (error) {
            winston.error('Ошибка запроса сброса пароля:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при запросе сброса пароля');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Сброс пароля
    static async resetPassword(req, res) {
        try {
            const { token, newPassword } = req.body;
            
            // В реальном приложении здесь нужно:
            // 1. Проверить токен в БД
            // 2. Проверить срок действия
            // 3. Обновить пароль
            
            // Для демонстрации просто возвращаем успех
            res.json({
                success: true,
                message: 'Пароль успешно сброшен'
            });
        } catch (error) {
            winston.error('Ошибка сброса пароля:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при сбросе пароля');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Выход пользователя (на клиенте просто удаляем токен)
    static async logout(req, res) {
        try {
            // В JWT нет состояния, так что просто возвращаем успех
            // В реальном приложении можно добавить токен в черный список
            
            Helpers.logAction(req.user, 'logout');
            
            res.json({
                success: true,
                message: 'Выход выполнен успешно'
            });
        } catch (error) {
            winston.error('Ошибка выхода:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при выходе');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Проверка доступности email
    static async checkEmail(req, res) {
        try {
            const { email } = req.query;
            
            if (!email) {
                return res.status(400).json({
                    success: false,
                    error: 'Email обязателен'
                });
            }
            
            const existingUser = await User.findOne({ email });
            
            res.json({
                success: true,
                data: {
                    email,
                    available: !existingUser
                }
            });
        } catch (error) {
            winston.error('Ошибка проверки email:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при проверке email');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Связывание Telegram аккаунта
    static async linkTelegram(req, res) {
        try {
            const { telegramId } = req.body;
            
            if (!telegramId) {
                return res.status(400).json({
                    success: false,
                    error: 'Telegram ID обязателен'
                });
            }
            
            // Проверяем, не привязан ли уже этот Telegram ID
            const existingUser = await User.findOne({ telegramId });
            
            if (existingUser && existingUser._id.toString() !== req.user._id.toString()) {
                return res.status(400).json({
                    success: false,
                    error: 'Этот Telegram ID уже привязан к другому аккаунту'
                });
            }
            
            // Обновляем пользователя
            const user = await User.findByIdAndUpdate(
                req.user._id,
                { telegramId },
                { new: true }
            ).select('-password');
            
            // Отправляем приветственное сообщение в Telegram
            if (telegramBot) {
                await telegramBot.sendMessage(
                    telegramId,
                    `✅ Ваш Telegram успешно привязан к аккаунту ${user.email}!\n\n` +
                    `Теперь вы можете:\n` +
                    `• Получать уведомления о задачах\n` +
                    `• Использовать команды бота\n` +
                    `• Быстро создавать задачи\n\n` +
                    `Напишите /start для начала работы!`
                );
            }
            
            // Логируем действие
            Helpers.logAction(user, 'telegram_linked');
            
            res.json({
                success: true,
                message: 'Telegram успешно привязан',
                data: { user }
            });
        } catch (error) {
            winston.error('Ошибка привязки Telegram:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при привязке Telegram');
            res.status(apiError.statusCode).json(apiError);
        }
    }
}

module.exports = AuthController;
