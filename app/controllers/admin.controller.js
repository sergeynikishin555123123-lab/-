const User = require('../models/User');
const Task = require('../models/Task');
const Service = require('../models/Service');
const Subscription = require('../models/Subscription');
const Helpers = require('../utils/helpers');
const excelGenerator = require('../utils/excelGenerator');
const winston = require('winston');

class AdminController {
    // Получение статистики системы
    static async getSystemStats(req, res) {
        try {
            const [users, tasks, services, subscriptions] = await Promise.all([
                // Статистика пользователей
                User.aggregate([
                    {
                        $group: {
                            _id: '$role',
                            count: { $sum: 1 },
                            active: {
                                $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] }
                            }
                        }
                    }
                ]),
                
                // Статистика задач
                Task.aggregate([
                    {
                        $match: {
                            createdAt: {
                                $gte: new Date(new Date().setMonth(new Date().getMonth() - 1))
                            }
                        }
                    },
                    {
                        $group: {
                            _id: '$status',
                            count: { $sum: 1 },
                            totalRevenue: {
                                $sum: {
                                    $cond: [
                                        { $eq: ['$status', 'completed'] },
                                        '$price',
                                        0
                                    ]
                                }
                            }
                        }
                    }
                ]),
                
                // Статистика услуг
                Service.aggregate([
                    {
                        $match: { isActive: true }
                    },
                    {
                        $group: {
                            _id: '$category',
                            count: { $sum: 1 },
                            totalOrders: { $sum: '$statistics.totalOrders' },
                            avgRating: { $avg: '$statistics.averageRating' }
                        }
                    }
                ]),
                
                // Статистика подписок
                Subscription.aggregate([
                    {
                        $group: {
                            _id: '$plan',
                            count: { $sum: 1 },
                            active: {
                                $sum: {
                                    $cond: [{ $eq: ['$status', 'active'] }, 1, 0]
                                }
                            },
                            totalRevenue: { $sum: '$price' }
                        }
                    }
                ])
            ]);
            
            // Общая статистика
            const totalStats = {
                totalUsers: await User.countDocuments(),
                totalTasks: await Task.countDocuments(),
                activeTasks: await Task.countDocuments({ 
                    status: { $in: ['new', 'assigned', 'in_progress'] } 
                }),
                completedTasks: await Task.countDocuments({ status: 'completed' }),
                totalRevenue: await Task.aggregate([
                    {
                        $match: { 
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
                activeSubscriptions: await Subscription.countDocuments({ 
                    status: 'active',
                    endDate: { $gte: new Date() }
                })
            };
            
            // Статистика за последние 7 дней
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            
            const recentStats = {
                newUsers: await User.countDocuments({ 
                    createdAt: { $gte: sevenDaysAgo } 
                }),
                newTasks: await Task.countDocuments({ 
                    createdAt: { $gte: sevenDaysAgo } 
                }),
                completedTasks: await Task.countDocuments({ 
                    status: 'completed',
                    updatedAt: { $gte: sevenDaysAgo }
                }),
                revenue: await Task.aggregate([
                    {
                        $match: { 
                            status: 'completed',
                            paymentStatus: 'paid',
                            updatedAt: { $gte: sevenDaysAgo }
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            total: { $sum: '$price' }
                        }
                    }
                ]).then(result => result[0]?.total || 0)
            };
            
            res.json({
                success: true,
                data: {
                    totalStats,
                    recentStats,
                    usersByRole: users,
                    tasksByStatus: tasks,
                    servicesByCategory: services,
                    subscriptionsByPlan: subscriptions,
                    timestamp: new Date().toISOString()
                }
            });
        } catch (error) {
            winston.error('Ошибка получения статистики:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при получении статистики');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Получение всех пользователей
    static async getAllUsers(req, res) {
        try {
            const { 
                role, 
                isActive, 
                page = 1, 
                limit = 50,
                search,
                sortBy = 'createdAt',
                sortOrder = 'desc'
            } = req.query;
            
            // Строим фильтр
            const filter = {};
            
            if (role) filter.role = role;
            if (isActive !== undefined) filter.isActive = isActive === 'true';
            
            // Поиск по имени, email или телефону
            if (search) {
                filter.$or = [
                    { firstName: { $regex: search, $options: 'i' } },
                    { lastName: { $regex: search, $options: 'i' } },
                    { email: { $regex: search, $options: 'i' } },
                    { phone: { $regex: search, $options: 'i' } }
                ];
            }
            
            // Настройки сортировки
            const sort = {};
            sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
            
            // Пагинация
            const skip = (page - 1) * limit;
            
            // Получаем пользователей
            const users = await User.find(filter)
                .select('-password')
                .sort(sort)
                .skip(skip)
                .limit(parseInt(limit))
                .populate('subscription');
            
            // Общее количество
            const total = await User.countDocuments(filter);
            
            res.json({
                success: true,
                data: {
                    users,
                    pagination: {
                        total,
                        page: parseInt(page),
                        pages: Math.ceil(total / limit),
                        limit: parseInt(limit)
                    }
                }
            });
        } catch (error) {
            winston.error('Ошибка получения пользователей:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при получении пользователей');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Получение пользователя по ID
    static async getUserById(req, res) {
        try {
            const { id } = req.params;
            
            const user = await User.findById(id)
                .select('-password')
                .populate('subscription');
            
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'Пользователь не найден'
                });
            }
            
            // Получаем статистику пользователя
            const [createdTasks, assignedTasks, completedTasks] = await Promise.all([
                Task.countDocuments({ client: id }),
                Task.countDocuments({ performer: id }),
                Task.countDocuments({ performer: id, status: 'completed' })
            ]);
            
            const userStats = {
                createdTasks,
                assignedTasks,
                completedTasks,
                completionRate: assignedTasks > 0 ? (completedTasks / assignedTasks * 100).toFixed(1) : 0
            };
            
            res.json({
                success: true,
                data: {
                    user,
                    stats: userStats
                }
            });
        } catch (error) {
            winston.error('Ошибка получения пользователя:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при получении пользователя');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Обновление пользователя
    static async updateUser(req, res) {
        try {
            const { id } = req.params;
            const updates = req.body;
            
            // Запрещаем некоторые обновления
            const forbiddenUpdates = ['password', '_id', 'createdAt'];
            forbiddenUpdates.forEach(field => {
                delete updates[field];
            });
            
            // Если обновляется роль, проверяем права
            if (updates.role && !['superadmin'].includes(req.user.role)) {
                return res.status(403).json({
                    success: false,
                    error: 'Только супер-администратор может изменять роли пользователей'
                });
            }
            
            // Обновляем пользователя
            const user = await User.findByIdAndUpdate(
                id,
                updates,
                { new: true, runValidators: true }
            ).select('-password');
            
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'Пользователь не найден'
                });
            }
            
            // Логируем действие
            Helpers.logAction(req.user, 'user_updated', { 
                userId: id,
                changes: Object.keys(updates),
                updatedBy: req.user._id 
            });
            
            res.json({
                success: true,
                message: 'Пользователь успешно обновлен',
                data: { user }
            });
        } catch (error) {
            winston.error('Ошибка обновления пользователя:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при обновлении пользователя');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Деактивация/активация пользователя
    static async toggleUserStatus(req, res) {
        try {
            const { id } = req.params;
            const { isActive, reason } = req.body;
            
            const user = await User.findById(id);
            
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'Пользователь не найден'
                });
            }
            
            // Нельзя деактивировать себя
            if (id === req.user._id.toString()) {
                return res.status(400).json({
                    success: false,
                    error: 'Нельзя деактивировать собственный аккаунт'
                });
            }
            
            // Обновляем статус
            user.isActive = isActive !== undefined ? isActive : !user.isActive;
            await user.save();
            
            // Логируем действие
            Helpers.logAction(req.user, 'user_status_changed', { 
                userId: id,
                newStatus: user.isActive ? 'active' : 'inactive',
                reason,
                changedBy: req.user._id 
            });
            
            res.json({
                success: true,
                message: `Пользователь успешно ${user.isActive ? 'активирован' : 'деактивирован'}`,
                data: { user }
            });
        } catch (error) {
            winston.error('Ошибка изменения статуса пользователя:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при изменении статуса пользователя');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Получение всех задач (админская панель)
    static async getAllTasks(req, res) {
        try {
            const { 
                status, 
                category, 
                clientId, 
                performerId,
                dateFrom, 
                dateTo,
                page = 1, 
                limit = 50,
                sortBy = 'createdAt',
                sortOrder = 'desc'
            } = req.query;
            
            // Строим фильтр
            const filter = { isArchived: false };
            
            if (status) filter.status = status;
            if (category) filter.category = category;
            if (clientId) filter.client = clientId;
            if (performerId) filter.performer = performerId;
            
            // Фильтр по дате
            if (dateFrom || dateTo) {
                filter.createdAt = {};
                if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
                if (dateTo) filter.createdAt.$lte = new Date(dateTo);
            }
            
            // Настройки сортировки
            const sort = {};
            sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
            
            // Пагинация
            const skip = (page - 1) * limit;
            
            // Получаем задачи
            const tasks = await Task.find(filter)
                .populate('client', 'firstName lastName email avatar')
                .populate('performer', 'firstName lastName email avatar rating')
                .sort(sort)
                .skip(skip)
                .limit(parseInt(limit));
            
            // Общее количество
            const total = await Task.countDocuments(filter);
            
            // Статистика по фильтру
            const stats = {
                total,
                byStatus: await Task.aggregate([
                    { $match: filter },
                    { $group: { _id: '$status', count: { $sum: 1 } } }
                ]),
                byCategory: await Task.aggregate([
                    { $match: filter },
                    { $group: { _id: '$category', count: { $sum: 1 } } }
                ]),
                totalRevenue: await Task.aggregate([
                    { 
                        $match: { 
                            ...filter,
                            status: 'completed',
                            paymentStatus: 'paid'
                        } 
                    },
                    { $group: { _id: null, total: { $sum: '$price' } } }
                ]).then(result => result[0]?.total || 0)
            };
            
            res.json({
                success: true,
                data: {
                    tasks,
                    stats,
                    pagination: {
                        total,
                        page: parseInt(page),
                        pages: Math.ceil(total / limit),
                        limit: parseInt(limit)
                    }
                }
            });
        } catch (error) {
            winston.error('Ошибка получения задач:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при получении задач');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Экспорт задач в Excel
    static async exportTasksToExcel(req, res) {
        try {
            const { 
                status, 
                category, 
                dateFrom, 
                dateTo,
                format = 'excel'
            } = req.query;
            
            // Строим фильтр
            const filter = { isArchived: false };
            
            if (status) filter.status = status;
            if (category) filter.category = category;
            
            if (dateFrom || dateTo) {
                filter.createdAt = {};
                if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
                if (dateTo) filter.createdAt.$lte = new Date(dateTo);
            }
            
            // Получаем задачи с дополнительной информацией
            const tasks = await Task.find(filter)
                .populate('client', 'firstName lastName email')
                .populate('performer', 'firstName lastName email')
                .sort({ createdAt: -1 });
            
            if (tasks.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Нет задач для экспорта'
                });
            }
            
            // Генерируем отчет
            const filters = {
                period: dateFrom && dateTo 
                    ? `${dateFrom} - ${dateTo}` 
                    : 'Все время',
                category: category || 'Все категории',
                status: status || 'Все статусы'
            };
            
            const report = await excelGenerator.generateTasksReport(tasks, filters);
            
            // Отправляем файл
            res.download(report.filepath, report.filename, (err) => {
                if (err) {
                    winston.error('Ошибка отправки файла:', err);
                }
                
                // Очищаем старые файлы (в фоне)
                excelGenerator.cleanupOldFiles().catch(cleanupErr => {
                    winston.error('Ошибка очистки старых файлов:', cleanupErr);
                });
            });
        } catch (error) {
            winston.error('Ошибка экспорта задач:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при экспорте задач');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Экспорт пользователей в Excel
    static async exportUsersToExcel(req, res) {
        try {
            const { role, isActive } = req.query;
            
            // Строим фильтр
            const filter = {};
            
            if (role) filter.role = role;
            if (isActive !== undefined) filter.isActive = isActive === 'true';
            
            // Получаем пользователей
            const users = await User.find(filter)
                .select('-password')
                .sort({ createdAt: -1 });
            
            if (users.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Нет пользователей для экспорта'
                });
            }
            
            // Генерируем отчет
            const report = await excelGenerator.generateUsersReport(users);
            
            // Отправляем файл
            res.download(report.filepath, report.filename, (err) => {
                if (err) {
                    winston.error('Ошибка отправки файла:', err);
                }
            });
        } catch (error) {
            winston.error('Ошибка экспорта пользователей:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при экспорте пользователей');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Управление подписками
    static async manageSubscriptions(req, res) {
        try {
            const { 
                userId, 
                plan, 
                period, 
                action,
                subscriptionId 
            } = req.body;
            
            let result;
            
            switch (action) {
                case 'create':
                    result = await this.createSubscription(userId, plan, period, req.user);
                    break;
                    
                case 'update':
                    result = await this.updateSubscription(subscriptionId, req.body, req.user);
                    break;
                    
                case 'cancel':
                    result = await this.cancelSubscription(subscriptionId, req.body.reason, req.user);
                    break;
                    
                case 'extend':
                    result = await this.extendSubscription(subscriptionId, req.body.months, req.user);
                    break;
                    
                default:
                    return res.status(400).json({
                        success: false,
                        error: 'Неизвестное действие'
                    });
            }
            
            res.json(result);
        } catch (error) {
            winston.error('Ошибка управления подписками:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при управлении подписками');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Получение всех подписок
    static async getAllSubscriptions(req, res) {
        try {
            const { 
                status, 
                plan, 
                page = 1, 
                limit = 50,
                sortBy = 'endDate',
                sortOrder = 'asc'
            } = req.query;
            
            // Строим фильтр
            const filter = {};
            
            if (status) filter.status = status;
            if (plan) filter.plan = plan;
            
            // Настройки сортировки
            const sort = {};
            sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
            
            // Пагинация
            const skip = (page - 1) * limit;
            
            // Получаем подписки
            const subscriptions = await Subscription.find(filter)
                .populate('user', 'firstName lastName email')
                .sort(sort)
                .skip(skip)
                .limit(parseInt(limit));
            
            // Общее количество
            const total = await Subscription.countDocuments(filter);
            
            // Статистика
            const stats = {
                total,
                active: await Subscription.countDocuments({ 
                    status: 'active',
                    endDate: { $gte: new Date() }
                }),
                expiringSoon: await Subscription.countDocuments({
                    status: 'active',
                    endDate: { 
                        $gte: new Date(),
                        $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                    }
                }),
                totalRevenue: await Subscription.aggregate([
                    { $group: { _id: null, total: { $sum: '$price' } } }
                ]).then(result => result[0]?.total || 0)
            };
            
            res.json({
                success: true,
                data: {
                    subscriptions,
                    stats,
                    pagination: {
                        total,
                        page: parseInt(page),
                        pages: Math.ceil(total / limit),
                        limit: parseInt(limit)
                    }
                }
            });
        } catch (error) {
            winston.error('Ошибка получения подписок:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при получении подписок');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Получение логов системы
    static async getSystemLogs(req, res) {
        try {
            // В реальном приложении здесь нужно получать логи из файла или БД
            // Для демонстрации возвращаем заглушку
            
            const logs = {
                info: 'Функциональность логов будет реализована в следующей версии',
                features: [
                    'Логирование всех действий пользователей',
                    'Отслеживание ошибок системы',
                    'Аудит безопасности',
                    'Мониторинг производительности'
                ]
            };
            
            res.json({
                success: true,
                data: { logs }
            });
        } catch (error) {
            winston.error('Ошибка получения логов:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при получении логов');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Вспомогательные методы для управления подписками
    
    static async createSubscription(userId, plan, period, adminUser) {
        try {
            // Находим пользователя
            const user = await User.findById(userId);
            
            if (!user) {
                throw new Error('Пользователь не найден');
            }
            
            // Определяем цену в зависимости от плана и периода
            const prices = {
                basic: { monthly: 500, quarterly: 1350, yearly: 4800 },
                premium: { monthly: 1000, quarterly: 2700, yearly: 9600 },
                vip: { monthly: 2000, quarterly: 5400, yearly: 19200 }
            };
            
            const price = prices[plan]?.[period];
            
            if (!price) {
                throw new Error('Неверная комбинация плана и периода');
            }
            
            // Определяем даты
            const startDate = new Date();
            let endDate = new Date();
            
            switch (period) {
                case 'monthly':
                    endDate.setMonth(endDate.getMonth() + 1);
                    break;
                case 'quarterly':
                    endDate.setMonth(endDate.getMonth() + 3);
                    break;
                case 'yearly':
                    endDate.setFullYear(endDate.getFullYear() + 1);
                    break;
            }
            
            // Создаем подписку
            const subscription = new Subscription({
                user: userId,
                plan,
                period,
                price,
                status: 'active',
                startDate,
                endDate,
                autoRenew: true,
                paymentMethod: 'admin',
                transactionId: `ADMIN-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                features: this.getPlanFeatures(plan)
            });
            
            await subscription.save();
            
            // Обновляем подписку пользователя
            user.subscription = {
                plan,
                status: 'active',
                startDate,
                endDate,
                autoRenew: true
            };
            
            await user.save();
            
            // Логируем действие
            Helpers.logAction(adminUser, 'subscription_created', { 
                userId,
                subscriptionId: subscription._id,
                plan,
                period,
                price 
            });
            
            return {
                success: true,
                message: 'Подписка успешно создана',
                data: { subscription }
            };
        } catch (error) {
            winston.error('Ошибка создания подписки:', error);
            throw error;
        }
    }
    
    static async updateSubscription(subscriptionId, updates, adminUser) {
        try {
            const subscription = await Subscription.findById(subscriptionId);
            
            if (!subscription) {
                throw new Error('Подписка не найдена');
            }
            
            // Сохраняем старые значения для лога
            const oldValues = {
                plan: subscription.plan,
                status: subscription.status,
                endDate: subscription.endDate,
                autoRenew: subscription.autoRenew
            };
            
            // Обновляем подписку
            Object.assign(subscription, updates);
            await subscription.save();
            
            // Если изменилась подписка, обновляем пользователя
            if (updates.plan || updates.status || updates.endDate) {
                const user = await User.findById(subscription.user);
                
                if (user) {
                    user.subscription = {
                        plan: subscription.plan,
                        status: subscription.status,
                        startDate: subscription.startDate,
                        endDate: subscription.endDate,
                        autoRenew: subscription.autoRenew
                    };
                    
                    await user.save();
                }
            }
            
            // Логируем действие
            Helpers.logAction(adminUser, 'subscription_updated', { 
                subscriptionId,
                oldValues,
                newValues: updates,
                changedBy: adminUser._id 
            });
            
            return {
                success: true,
                message: 'Подписка успешно обновлена',
                data: { subscription }
            };
        } catch (error) {
            winston.error('Ошибка обновления подписки:', error);
            throw error;
        }
    }
    
    static async cancelSubscription(subscriptionId, reason, adminUser) {
        try {
            const subscription = await Subscription.findById(subscriptionId);
            
            if (!subscription) {
                throw new Error('Подписка не найдена');
            }
            
            // Отменяем подписку
            await subscription.cancel(reason, adminUser._id);
            
            // Обновляем пользователя
            const user = await User.findById(subscription.user);
            
            if (user) {
                user.subscription.status = 'cancelled';
                await user.save();
            }
            
            // Логируем действие
            Helpers.logAction(adminUser, 'subscription_cancelled', { 
                subscriptionId,
                reason,
                userId: subscription.user 
            });
            
            return {
                success: true,
                message: 'Подписка успешно отменена',
                data: { subscription }
            };
        } catch (error) {
            winston.error('Ошибка отмены подписки:', error);
            throw error;
        }
    }
    
    static async extendSubscription(subscriptionId, months, adminUser) {
        try {
            const subscription = await Subscription.findById(subscriptionId);
            
            if (!subscription) {
                throw new Error('Подписка не найдена');
            }
            
            // Продлеваем подписку
            const oldEndDate = subscription.endDate;
            subscription.endDate = new Date(oldEndDate);
            subscription.endDate.setMonth(subscription.endDate.getMonth() + months);
            
            // Обновляем цену (можно добавить логику расчета)
            const pricePerMonth = subscription.price / this.getMonthsInPeriod(subscription.period);
            subscription.price += pricePerMonth * months;
            
            await subscription.save();
            
            // Обновляем пользователя
            const user = await User.findById(subscription.user);
            
            if (user) {
                user.subscription.endDate = subscription.endDate;
                await user.save();
            }
            
            // Логируем действие
            Helpers.logAction(adminUser, 'subscription_extended', { 
                subscriptionId,
                months,
                oldEndDate,
                newEndDate: subscription.endDate,
                userId: subscription.user 
            });
            
            return {
                success: true,
                message: `Подписка продлена на ${months} месяцев`,
                data: { subscription }
            };
        } catch (error) {
            winston.error('Ошибка продления подписки:', error);
            throw error;
        }
    }
    
    static getPlanFeatures(plan) {
        const features = {
            basic: {
                maxTasksPerMonth: 5,
                prioritySupport: false,
                discountPercent: 0,
                freeCancellations: 1,
                advancedAnalytics: false
            },
            premium: {
                maxTasksPerMonth: 20,
                prioritySupport: true,
                discountPercent: 10,
                freeCancellations: 3,
                advancedAnalytics: true
            },
            vip: {
                maxTasksPerMonth: 100,
                prioritySupport: true,
                discountPercent: 20,
                freeCancellations: 10,
                advancedAnalytics: true
            }
        };
        
        return features[plan] || features.basic;
    }
    
    static getMonthsInPeriod(period) {
        const months = {
            monthly: 1,
            quarterly: 3,
            yearly: 12
        };
        
        return months[period] || 1;
    }
}

module.exports = AdminController;
