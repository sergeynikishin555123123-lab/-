const User = require('../models/User');
const Task = require('../models/Task');
const Subscription = require('../models/Subscription');
const Helpers = require('../utils/helpers');
const winston = require('winston');

class UserController {
    // Получение профиля пользователя
    static async getProfile(req, res) {
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
            winston.error('Ошибка получения профиля:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при получении профиля');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Обновление профиля
    static async updateProfile(req, res) {
        try {
            const updates = req.body;
            
            // Поля, которые можно обновлять
            const allowedUpdates = [
                'firstName', 
                'lastName', 
                'phone', 
                'avatar',
                'preferences'
            ];
            
            // Фильтруем обновления
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
            
            // Логируем действие
            Helpers.logAction(user, 'profile_updated', { 
                fields: Object.keys(filteredUpdates) 
            });
            
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
    
    // Получение статистики пользователя
    static async getUserStats(req, res) {
        try {
            const userId = req.user._id;
            
            // Статистика зависит от роли пользователя
            let stats = {};
            
            if (req.user.role === 'client') {
                stats = await this.getClientStats(userId);
            } else if (req.user.role === 'performer') {
                stats = await this.getPerformerStats(userId);
            } else if (['admin', 'superadmin'].includes(req.user.role)) {
                stats = await this.getAdminStats();
            }
            
            res.json({
                success: true,
                data: { stats }
            });
        } catch (error) {
            winston.error('Ошибка получения статистики:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при получении статистики');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Получение истории действий пользователя
    static async getActivityHistory(req, res) {
        try {
            const { page = 1, limit = 20 } = req.query;
            
            // В реальном приложении здесь нужно получать логи из БД
            // Для демонстрации возвращаем заглушку
            
            const activities = [
                {
                    id: 1,
                    action: 'task_created',
                    description: 'Создана новая задача "Уборка квартиры"',
                    timestamp: new Date(Date.now() - 3600000).toISOString(),
                    details: { taskId: '123', price: 2000 }
                },
                {
                    id: 2,
                    action: 'task_completed',
                    description: 'Задача "Репетитор по математике" завершена',
                    timestamp: new Date(Date.now() - 7200000).toISOString(),
                    details: { taskId: '124', rating: 5 }
                },
                {
                    id: 3,
                    action: 'profile_updated',
                    description: 'Обновлен номер телефона',
                    timestamp: new Date(Date.now() - 86400000).toISOString(),
                    details: { field: 'phone' }
                }
            ];
            
            // Пагинация
            const startIndex = (page - 1) * limit;
            const endIndex = page * limit;
            
            const paginatedActivities = activities.slice(startIndex, endIndex);
            
            res.json({
                success: true,
                data: {
                    activities: paginatedActivities,
                    pagination: {
                        total: activities.length,
                        page: parseInt(page),
                        pages: Math.ceil(activities.length / limit),
                        limit: parseInt(limit)
                    }
                }
            });
        } catch (error) {
            winston.error('Ошибка получения истории действий:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при получении истории действий');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Получение подписки пользователя
    static async getSubscription(req, res) {
        try {
            // Получаем активную подписку пользователя
            const subscription = await Subscription.findOne({
                user: req.user._id,
                status: 'active',
                endDate: { $gte: new Date() }
            }).sort({ endDate: -1 });
            
            // Если нет активной подписки, проверяем есть ли вообще подписки
            let userSubscription = subscription;
            
            if (!userSubscription) {
                userSubscription = await Subscription.findOne({
                    user: req.user._id
                }).sort({ endDate: -1 });
            }
            
            // Получаем историю подписок
            const subscriptionHistory = await Subscription.find({
                user: req.user._id
            }).sort({ startDate: -1 });
            
            // Получаем информацию о планах
            const subscriptionPlans = this.getSubscriptionPlans();
            
            res.json({
                success: true,
                data: {
                    current: userSubscription,
                    history: subscriptionHistory,
                    plans: subscriptionPlans
                }
            });
        } catch (error) {
            winston.error('Ошибка получения подписки:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при получении подписки');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Обновление настроек уведомлений
    static async updateNotificationSettings(req, res) {
        try {
            const { notifications } = req.body;
            
            if (!notifications) {
                return res.status(400).json({
                    success: false,
                    error: 'Настройки уведомлений обязательны'
                });
            }
            
            // Обновляем настройки
            const user = await User.findByIdAndUpdate(
                req.user._id,
                { 'preferences.notifications': notifications },
                { new: true }
            ).select('-password');
            
            // Логируем действие
            Helpers.logAction(user, 'notification_settings_updated', { 
                settings: notifications 
            });
            
            res.json({
                success: true,
                message: 'Настройки уведомлений обновлены',
                data: { user }
            });
        } catch (error) {
            winston.error('Ошибка обновления настроек уведомлений:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при обновлении настроек уведомлений');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Загрузка аватара
    static async uploadAvatar(req, res) {
        try {
            // Проверяем, что файл загружен
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    error: 'Файл не загружен'
                });
            }
            
            // Проверяем тип файла
            const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
            if (!allowedTypes.includes(req.file.mimetype)) {
                return res.status(400).json({
                    success: false,
                    error: 'Разрешены только изображения JPEG, PNG или GIF'
                });
            }
            
            // Проверяем размер файла (макс 5MB)
            if (req.file.size > 5 * 1024 * 1024) {
                return res.status(400).json({
                    success: false,
                    error: 'Размер файла не должен превышать 5MB'
                });
            }
            
            // Сохраняем путь к файлу
            const avatarPath = `/uploads/avatars/${req.file.filename}`;
            
            // Обновляем аватар пользователя
            const user = await User.findByIdAndUpdate(
                req.user._id,
                { avatar: avatarPath },
                { new: true }
            ).select('-password');
            
            // Логируем действие
            Helpers.logAction(user, 'avatar_uploaded', { 
                filename: req.file.filename,
                size: req.file.size 
            });
            
            res.json({
                success: true,
                message: 'Аватар успешно загружен',
                data: { 
                    user,
                    avatarUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}${avatarPath}`
                }
            });
        } catch (error) {
            winston.error('Ошибка загрузки аватара:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при загрузке аватара');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Удаление аккаунта (запрос)
    static async deleteAccountRequest(req, res) {
        try {
            const { reason } = req.body;
            
            // В реальном приложении здесь нужно:
            // 1. Создать запрос на удаление
            // 2. Отправить подтверждение на email
            // 3. Дать возможность отменить в течение 14 дней
            
            // Пока просто возвращаем информацию
            res.json({
                success: true,
                message: 'Запрос на удаление аккаунта получен',
                data: {
                    note: 'Ваш аккаунт будет полностью удален через 14 дней. В течение этого времени вы можете отменить удаление.',
                    cancellationDeadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
                    reason: reason || 'Не указана'
                }
            });
            
            // Логируем действие
            Helpers.logAction(req.user, 'account_deletion_requested', { reason });
        } catch (error) {
            winston.error('Ошибка запроса удаления аккаунта:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при запросе удаления аккаунта');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Получение реферальной ссылки
    static async getReferralInfo(req, res) {
        try {
            // Генерируем реферальный код
            const referralCode = Helpers.generateRandomString(8).toUpperCase();
            
            // В реальном приложении нужно сохранить в БД
            
            const referralInfo = {
                code: referralCode,
                link: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/register?ref=${referralCode}`,
                earned: 0, // Заработанные бонусы
                referrals: 0, // Количество приглашенных
                benefits: [
                    '500 бонусов за каждого приглашенного',
                    '10% скидка на первую задачу приглашенного',
                    'Специальный бейдж в профиле'
                ]
            };
            
            res.json({
                success: true,
                data: referralInfo
            });
        } catch (error) {
            winston.error('Ошибка получения реферальной информации:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при получении реферальной информации');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Получение уведомлений пользователя
    static async getNotifications(req, res) {
        try {
            const { unreadOnly = 'false', page = 1, limit = 20 } = req.query;
            
            // В реальном приложении здесь нужно получать уведомления из БД
            // Для демонстрации возвращаем заглушку
            
            const notifications = [
                {
                    id: 1,
                    type: 'task_update',
                    title: 'Статус задачи изменен',
                    message: 'Задача "Уборка квартиры" теперь в работе',
                    timestamp: new Date().toISOString(),
                    read: false,
                    data: { taskId: '123' }
                },
                {
                    id: 2,
                    type: 'system',
                    title: 'Обновление системы',
                    message: 'Завтра с 02:00 до 04:00 планируются технические работы',
                    timestamp: new Date(Date.now() - 86400000).toISOString(),
                    read: true,
                    data: {}
                },
                {
                    id: 3,
                    type: 'promotion',
                    title: 'Специальное предложение',
                    message: 'Скидка 20% на все услуги по уборке до конца месяца',
                    timestamp: new Date(Date.now() - 172800000).toISOString(),
                    read: true,
                    data: { promoCode: 'CLEAN20' }
                }
            ];
            
            // Фильтрация по прочитанным
            let filteredNotifications = notifications;
            if (unreadOnly === 'true') {
                filteredNotifications = notifications.filter(n => !n.read);
            }
            
            // Пагинация
            const startIndex = (page - 1) * limit;
            const endIndex = page * limit;
            
            const paginatedNotifications = filteredNotifications.slice(startIndex, endIndex);
            
            // Помечаем как прочитанные
            if (unreadOnly === 'true') {
                // В реальном приложении обновляем статус в БД
            }
            
            res.json({
                success: true,
                data: {
                    notifications: paginatedNotifications,
                    unreadCount: notifications.filter(n => !n.read).length,
                    pagination: {
                        total: filteredNotifications.length,
                        page: parseInt(page),
                        pages: Math.ceil(filteredNotifications.length / limit),
                        limit: parseInt(limit)
                    }
                }
            });
        } catch (error) {
            winston.error('Ошибка получения уведомлений:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при получении уведомлений');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Пометить уведомления как прочитанные
    static async markNotificationsAsRead(req, res) {
        try {
            const { notificationIds } = req.body;
            
            if (!notificationIds || !Array.isArray(notificationIds)) {
                return res.status(400).json({
                    success: false,
                    error: 'Необходим массив ID уведомлений'
                });
            }
            
            // В реальном приложении обновляем статус в БД
            
            res.json({
                success: true,
                message: `${notificationIds.length} уведомлений помечено как прочитанные`
            });
        } catch (error) {
            winston.error('Ошибка пометки уведомлений как прочитанных:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при пометке уведомлений как прочитанных');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Вспомогательные методы
    
    static async getClientStats(userId) {
        const [
            totalTasks,
            activeTasks,
            completedTasks,
            cancelledTasks,
            totalSpent,
            avgRatingGiven
        ] = await Promise.all([
            Task.countDocuments({ client: userId }),
            Task.countDocuments({ 
                client: userId,
                status: { $in: ['new', 'assigned', 'in_progress'] }
            }),
            Task.countDocuments({ 
                client: userId,
                status: 'completed'
            }),
            Task.countDocuments({ 
                client: userId,
                status: 'cancelled'
            }),
            Task.aggregate([
                {
                    $match: { 
                        client: userId,
                        status: 'completed',
                        paymentStatus: 'paid'
                    }
                },
                {
                    $group: {
                        _id: null,
                        total: { $sum: '$price' }
                    }
                }
            ]).then(result => result[0]?.total || 0),
            Task.aggregate([
                {
                    $match: { 
                        client: userId,
                        rating: { $exists: true, $gt: 0 }
                    }
                },
                {
                    $group: {
                        _id: null,
                        avg: { $avg: '$rating' }
                    }
                }
            ]).then(result => result[0]?.avg?.toFixed(1) || 'Нет оценок')
        ]);
        
        return {
            role: 'client',
            totalTasks,
            activeTasks,
            completedTasks,
            cancelledTasks,
            totalSpent,
            avgRatingGiven,
            completionRate: totalTasks > 0 ? ((completedTasks / totalTasks) * 100).toFixed(1) : 0
        };
    }
    
    static async getPerformerStats(userId) {
        const [
            totalTasks,
            activeTasks,
            completedTasks,
            cancelledTasks,
            totalEarned,
            avgRating,
            responseTime
        ] = await Promise.all([
            Task.countDocuments({ performer: userId }),
            Task.countDocuments({ 
                performer: userId,
                status: { $in: ['assigned', 'in_progress'] }
            }),
            Task.countDocuments({ 
                performer: userId,
                status: 'completed'
            }),
            Task.countDocuments({ 
                performer: userId,
                status: 'cancelled'
            }),
            Task.aggregate([
                {
                    $match: { 
                        performer: userId,
                        status: 'completed',
                        paymentStatus: 'paid'
                    }
                },
                {
                    $group: {
                        _id: null,
                        total: { $sum: '$price' }
                    }
                }
            ]).then(result => result[0]?.total || 0),
            Task.aggregate([
                {
                    $match: { 
                        performer: userId,
                        rating: { $exists: true, $gt: 0 }
                    }
                },
                {
                    $group: {
                        _id: null,
                        avg: { $avg: '$rating' }
                    }
                }
            ]).then(result => result[0]?.avg?.toFixed(1) || 'Нет оценок'),
            // В реальном приложении рассчитываем среднее время отклика
            Promise.resolve('2.5 часа')
        ]);
        
        return {
            role: 'performer',
            totalTasks,
            activeTasks,
            completedTasks,
            cancelledTasks,
            totalEarned,
            avgRating,
            responseTime,
            completionRate: totalTasks > 0 ? ((completedTasks / totalTasks) * 100).toFixed(1) : 0,
            satisfactionRate: avgRating === 'Нет оценок' ? 'Нет данных' : `${(parseFloat(avgRating) / 5 * 100).toFixed(1)}%`
        };
    }
    
    static async getAdminStats() {
        // Для админов показываем общую статистику системы
        return {
            role: 'admin',
            note: 'Администраторам доступна полная статистика системы в админ-панели',
            link: '/admin/stats'
        };
    }
    
    static getSubscriptionPlans() {
        return [
            {
                id: 'basic',
                name: 'Базовый',
                price: {
                    monthly: 500,
                    quarterly: 1350,
                    yearly: 4800
                },
                features: [
                    'До 5 задач в месяц',
                    'Базовая поддержка',
                    '1 бесплатная отмена',
                    'Отчеты по задачам'
                ],
                color: '#4CAF50',
                popular: false
            },
            {
                id: 'premium',
                name: 'Премиум',
                price: {
                    monthly: 1000,
                    quarterly: 2700,
                    yearly: 9600
                },
                features: [
                    'До 20 задач в месяц',
                    'Приоритетная поддержка',
                    '3 бесплатные отмены',
                    'Скидка 10% на все услуги',
                    'Расширенная аналитика'
                ],
                color: '#2196F3',
                popular: true
            },
            {
                id: 'vip',
                name: 'VIP',
                price: {
                    monthly: 2000,
                    quarterly: 5400,
                    yearly: 19200
                },
                features: [
                    'До 100 задач в месяц',
                    'Персональный менеджер',
                    '10 бесплатных отмен',
                    'Скидка 20% на все услуги',
                    'Экспорт данных в Excel',
                    'Ранний доступ к новым функциям'
                ],
                color: '#9C27B0',
                popular: false
            }
        ];
    }
}

module.exports = UserController;
