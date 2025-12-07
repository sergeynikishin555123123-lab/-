const Task = require('../models/Task');
const User = require('../models/User');
const Helpers = require('../utils/helpers');
const { telegramBot } = require('../utils/telegramBot');
const winston = require('winston');

class TaskController {
    // Создание новой задачи
    static async createTask(req, res) {
        try {
            const { 
                title, 
                description, 
                category, 
                subcategory,
                deadline, 
                price, 
                priority, 
                location 
            } = req.body;
            
            // Проверяем подписку пользователя
            const user = await User.findById(req.user._id);
            
            if (user.role === 'client' && !user.hasActiveSubscription()) {
                return res.status(403).json({
                    success: false,
                    error: 'Для создания задач необходима активная подписка'
                });
            }
            
            // Создаем задачу
            const task = new Task({
                title,
                description,
                category,
                subcategory,
                client: req.user._id,
                deadline: new Date(deadline),
                price: parseFloat(price),
                priority: priority || 'medium',
                location,
                status: 'new'
            });
            
            await task.save();
            
            // Логируем действие
            Helpers.logAction(req.user, 'task_created', { 
                taskId: task._id,
                taskNumber: task.taskNumber 
            });
            
            // Отправляем уведомление администраторам
            await this.notifyAdminsAboutNewTask(task);
            
            res.status(201).json({
                success: true,
                message: 'Задача успешно создана',
                data: { task }
            });
        } catch (error) {
            winston.error('Ошибка создания задачи:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при создании задачи');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Получение списка задач
    static async getTasks(req, res) {
        try {
            const { 
                status, 
                category, 
                page = 1, 
                limit = 20,
                sortBy = 'createdAt',
                sortOrder = 'desc'
            } = req.query;
            
            // Строим фильтр
            const filter = {};
            
            // Фильтр по роли пользователя
            if (req.user.role === 'client') {
                filter.client = req.user._id;
            } else if (req.user.role === 'performer') {
                filter.performer = req.user._id;
            }
            
            // Дополнительные фильтры
            if (status) filter.status = status;
            if (category) filter.category = category;
            filter.isArchived = false;
            
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
            
            res.json({
                success: true,
                data: {
                    tasks,
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
    
    // Получение задачи по ID
    static async getTaskById(req, res) {
        try {
            const { id } = req.params;
            
            const task = await Task.findById(id)
                .populate('client', 'firstName lastName email phone avatar rating')
                .populate('performer', 'firstName lastName email phone avatar rating completedTasks')
                .populate('history.changedBy', 'firstName lastName email');
            
            if (!task) {
                return res.status(404).json({
                    success: false,
                    error: 'Задача не найдена'
                });
            }
            
            // Проверяем права доступа
            const hasAccess = this.checkTaskAccess(req.user, task);
            if (!hasAccess) {
                return res.status(403).json({
                    success: false,
                    error: 'У вас нет доступа к этой задаче'
                });
            }
            
            res.json({
                success: true,
                data: { task }
            });
        } catch (error) {
            winston.error('Ошибка получения задачи:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при получении задачи');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Обновление задачи
    static async updateTask(req, res) {
        try {
            const { id } = req.params;
            const updates = req.body;
            
            // Находим задачу
            const task = await Task.findById(id);
            
            if (!task) {
                return res.status(404).json({
                    success: false,
                    error: 'Задача не найдена'
                });
            }
            
            // Проверяем права
            const canUpdate = this.canUpdateTask(req.user, task, updates);
            if (!canUpdate.allowed) {
                return res.status(403).json({
                    success: false,
                    error: canUpdate.reason
                });
            }
            
            // Сохраняем старый статус для уведомления
            const oldStatus = task.status;
            
            // Определяем какие поля можно обновлять
            const allowedUpdates = [
                'title', 'description', 'deadline', 'priority', 
                'location', 'attachments', 'status', 'performer',
                'cancellationReason', 'cancellationNote'
            ];
            
            // Фильтруем обновления
            const filteredUpdates = {};
            allowedUpdates.forEach(field => {
                if (updates[field] !== undefined) {
                    filteredUpdates[field] = updates[field];
                }
            });
            
            // Обновляем задачу
            Object.assign(task, filteredUpdates);
            await task.save();
            
            // Отправляем уведомления об изменении статуса
            if (oldStatus !== task.status) {
                await this.notifyStatusChange(task, oldStatus, req.user);
            }
            
            // Логируем действие
            Helpers.logAction(req.user, 'task_updated', { 
                taskId: task._id,
                changes: Object.keys(filteredUpdates),
                oldStatus,
                newStatus: task.status
            });
            
            res.json({
                success: true,
                message: 'Задача успешно обновлена',
                data: { task }
            });
        } catch (error) {
            winston.error('Ошибка обновления задачи:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при обновлении задачи');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Удаление задачи (архивация)
    static async deleteTask(req, res) {
        try {
            const { id } = req.params;
            
            const task = await Task.findById(id);
            
            if (!task) {
                return res.status(404).json({
                    success: false,
                    error: 'Задача не найдена'
                });
            }
            
            // Проверяем права
            if (task.client.toString() !== req.user._id.toString() && 
                !['admin', 'superadmin'].includes(req.user.role)) {
                return res.status(403).json({
                    success: false,
                    error: 'Вы не можете удалить эту задачу'
                });
            }
            
            // Архивируем вместо удаления
            task.isArchived = true;
            await task.save();
            
            // Логируем действие
            Helpers.logAction(req.user, 'task_deleted', { 
                taskId: task._id,
                taskNumber: task.taskNumber 
            });
            
            res.json({
                success: true,
                message: 'Задача перемещена в архив'
            });
        } catch (error) {
            winston.error('Ошибка удаления задачи:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при удалении задачи');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Назначение исполнителя
    static async assignPerformer(req, res) {
        try {
            const { id } = req.params;
            const { performerId } = req.body;
            
            // Находим задачу
            const task = await Task.findById(id);
            
            if (!task) {
                return res.status(404).json({
                    success: false,
                    error: 'Задача не найдена'
                });
            }
            
            // Проверяем права (только админы или владелец задачи)
            if (task.client.toString() !== req.user._id.toString() && 
                !['admin', 'superadmin'].includes(req.user.role)) {
                return res.status(403).json({
                    success: false,
                    error: 'Вы не можете назначать исполнителя'
                });
            }
            
            // Находим исполнителя
            const performer = await User.findById(performerId);
            
            if (!performer || performer.role !== 'performer') {
                return res.status(400).json({
                    success: false,
                    error: 'Исполнитель не найден или не имеет соответствующей роли'
                });
            }
            
            // Назначаем исполнителя
            const oldStatus = task.status;
            task.performer = performerId;
            task.status = 'assigned';
            
            await task.save();
            
            // Отправляем уведомление исполнителю
            if (performer.telegramId && telegramBot) {
                await telegramBot.sendTaskNotification(task, performer);
            }
            
            // Логируем действие
            Helpers.logAction(req.user, 'performer_assigned', { 
                taskId: task._id,
                performerId,
                oldStatus,
                newStatus: task.status
            });
            
            res.json({
                success: true,
                message: 'Исполнитель успешно назначен',
                data: { task }
            });
        } catch (error) {
            winston.error('Ошибка назначения исполнителя:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при назначении исполнителя');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Принятие задачи исполнителем
    static async acceptTask(req, res) {
        try {
            const { id } = req.params;
            
            const task = await Task.findById(id);
            
            if (!task) {
                return res.status(404).json({
                    success: false,
                    error: 'Задача не найдена'
                });
            }
            
            // Проверяем, что пользователь - назначенный исполнитель
            if (task.performer.toString() !== req.user._id.toString()) {
                return res.status(403).json({
                    success: false,
                    error: 'Вы не являетесь назначенным исполнителем'
                });
            }
            
            // Меняем статус
            const oldStatus = task.status;
            task.status = 'in_progress';
            await task.save();
            
            // Отправляем уведомление клиенту
            await this.notifyClientAboutStatusChange(task, oldStatus, task.status);
            
            // Логируем действие
            Helpers.logAction(req.user, 'task_accepted', { 
                taskId: task._id,
                oldStatus,
                newStatus: task.status
            });
            
            res.json({
                success: true,
                message: 'Задача принята в работу',
                data: { task }
            });
        } catch (error) {
            winston.error('Ошибка принятия задачи:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при принятии задачи');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Завершение задачи
    static async completeTask(req, res) {
        try {
            const { id } = req.params;
            
            const task = await Task.findById(id);
            
            if (!task) {
                return res.status(404).json({
                    success: false,
                    error: 'Задача не найдена'
                });
            }
            
            // Проверяем права
            if (task.performer.toString() !== req.user._id.toString() && 
                !['admin', 'superadmin'].includes(req.user.role)) {
                return res.status(403).json({
                    success: false,
                    error: 'Вы не можете завершить эту задачу'
                });
            }
            
            // Меняем статус
            const oldStatus = task.status;
            task.status = 'completed';
            task.paymentStatus = 'paid';
            await task.save();
            
            // Обновляем статистику исполнителя
            await User.findByIdAndUpdate(task.performer, {
                $inc: { completedTasks: 1 }
            });
            
            // Отправляем уведомление клиенту с запросом отзыва
            await this.requestFeedbackFromClient(task);
            
            // Логируем действие
            Helpers.logAction(req.user, 'task_completed', { 
                taskId: task._id,
                oldStatus,
                newStatus: task.status
            });
            
            res.json({
                success: true,
                message: 'Задача успешно завершена',
                data: { task }
            });
        } catch (error) {
            winston.error('Ошибка завершения задачи:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при завершении задачи');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Отмена задачи
    static async cancelTask(req, res) {
        try {
            const { id } = req.params;
            const { reason, note } = req.body;
            
            const task = await Task.findById(id);
            
            if (!task) {
                return res.status(404).json({
                    success: false,
                    error: 'Задача не найдена'
                });
            }
            
            // Проверяем права
            const canCancel = this.canCancelTask(req.user, task);
            if (!canCancel.allowed) {
                return res.status(403).json({
                    success: false,
                    error: canCancel.reason
                });
            }
            
            // Отменяем задачу
            const oldStatus = task.status;
            task.status = 'cancelled';
            task.cancellationReason = reason;
            task.cancellationNote = note;
            task.paymentStatus = 'cancelled';
            
            await task.save();
            
            // Отправляем уведомления
            await this.notifyCancellation(task, req.user, reason);
            
            // Логируем действие
            Helpers.logAction(req.user, 'task_cancelled', { 
                taskId: task._id,
                reason,
                oldStatus,
                newStatus: task.status
            });
            
            res.json({
                success: true,
                message: 'Задача успешно отменена',
                data: { task }
            });
        } catch (error) {
            winston.error('Ошибка отмены задачи:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при отмене задачи');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Переоткрытие задачи
    static async reopenTask(req, res) {
        try {
            const { id } = req.params;
            const { reason } = req.body;
            
            const task = await Task.findById(id);
            
            if (!task) {
                return res.status(404).json({
                    success: false,
                    error: 'Задача не найдена'
                });
            }
            
            // Проверяем, что задача завершена или отменена
            if (task.status !== 'completed' && task.status !== 'cancelled') {
                return res.status(400).json({
                    success: false,
                    error: 'Можно переоткрыть только завершенные или отмененные задачи'
                });
            }
            
            // Проверяем права
            if (task.client.toString() !== req.user._id.toString() && 
                !['admin', 'superadmin'].includes(req.user.role)) {
                return res.status(403).json({
                    success: false,
                    error: 'Вы не можете переоткрыть эту задачу'
                });
            }
            
            // Переоткрываем задачу
            const oldStatus = task.status;
            task.status = 'reopened';
            task.history.push({
                action: 'reopen',
                status: 'reopened',
                changedBy: req.user._id,
                note: reason || 'Задача переоткрыта клиентом'
            });
            
            await task.save();
            
            // Отправляем уведомление исполнителю (если был)
            if (task.performer) {
                await this.notifyPerformerAboutReopening(task, req.user, reason);
            }
            
            // Логируем действие
            Helpers.logAction(req.user, 'task_reopened', { 
                taskId: task._id,
                reason,
                oldStatus,
                newStatus: task.status
            });
            
            res.json({
                success: true,
                message: 'Задача успешно переоткрыта',
                data: { task }
            });
        } catch (error) {
            winston.error('Ошибка переоткрытия задачи:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при переоткрытии задачи');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Добавление отзыва и оценки
    static async addReview(req, res) {
        try {
            const { id } = req.params;
            const { rating, feedback } = req.body;
            
            const task = await Task.findById(id);
            
            if (!task) {
                return res.status(404).json({
                    success: false,
                    error: 'Задача не найдена'
                });
            }
            
            // Проверяем, что задача завершена
            if (task.status !== 'completed') {
                return res.status(400).json({
                    success: false,
                    error: 'Можно оставить отзыв только для завершенных задач'
                });
            }
            
            // Проверяем, что пользователь - клиент
            if (task.client.toString() !== req.user._id.toString()) {
                return res.status(403).json({
                    success: false,
                    error: 'Только клиент может оставить отзыв'
                });
            }
            
            // Проверяем, что отзыв еще не оставлен
            if (task.rating) {
                return res.status(400).json({
                    success: false,
                    error: 'Отзыв уже оставлен'
                });
            }
            
            // Добавляем отзыв
            task.rating = rating;
            task.feedback = {
                text: feedback,
                createdAt: new Date()
            };
            
            await task.save();
            
            // Обновляем рейтинг исполнителя
            await this.updatePerformerRating(task.performer);
            
            // Отправляем уведомление исполнителю
            await this.notifyPerformerAboutReview(task);
            
            // Логируем действие
            Helpers.logAction(req.user, 'review_added', { 
                taskId: task._id,
                rating,
                performerId: task.performer
            });
            
            res.json({
                success: true,
                message: 'Отзыв успешно добавлен',
                data: { task }
            });
        } catch (error) {
            winston.error('Ошибка добавления отзыва:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при добавлении отзыва');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Получение доступных задач для исполнителей
    static async getAvailableTasks(req, res) {
        try {
            const { category, page = 1, limit = 20 } = req.query;
            
            // Фильтр для доступных задач
            const filter = {
                status: 'new',
                isArchived: false
            };
            
            if (category) filter.category = category;
            
            // Пагинация
            const skip = (page - 1) * limit;
            
            // Получаем задачи
            const tasks = await Task.find(filter)
                .populate('client', 'firstName lastName avatar rating')
                .sort({ createdAt: -1, priority: -1 })
                .skip(skip)
                .limit(parseInt(limit));
            
            // Общее количество
            const total = await Task.countDocuments(filter);
            
            res.json({
                success: true,
                data: {
                    tasks,
                    pagination: {
                        total,
                        page: parseInt(page),
                        pages: Math.ceil(total / limit),
                        limit: parseInt(limit)
                    }
                }
            });
        } catch (error) {
            winston.error('Ошибка получения доступных задач:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при получении доступных задач');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Вспомогательные методы
    
    // Проверка доступа к задаче
    static checkTaskAccess(user, task) {
        // Админы имеют доступ ко всему
        if (['admin', 'superadmin'].includes(user.role)) {
            return true;
        }
        
        // Клиент имеет доступ к своим задачам
        if (user.role === 'client' && task.client.toString() === user._id.toString()) {
            return true;
        }
        
        // Исполнитель имеет доступ к назначенным задачам
        if (user.role === 'performer' && task.performer && 
            task.performer.toString() === user._id.toString()) {
            return true;
        }
        
        return false;
    }
    
    // Проверка возможности обновления задачи
    static canUpdateTask(user, task, updates) {
        // Админы могут все
        if (['admin', 'superadmin'].includes(user.role)) {
            return { allowed: true };
        }
        
        // Клиент может обновлять свои задачи только в статусе 'new'
        if (user.role === 'client' && task.client.toString() === user._id.toString()) {
            if (task.status === 'new') {
                // Клиент не может менять статус (кроме отмены)
                if (updates.status && updates.status !== 'cancelled') {
                    return { 
                        allowed: false, 
                        reason: 'Клиент может только отменять задачи' 
                    };
                }
                return { allowed: true };
            }
            return { 
                allowed: false, 
                reason: 'Вы можете редактировать только новые задачи' 
            };
        }
        
        // Исполнитель может обновлять только назначенные ему задачи
        if (user.role === 'performer' && task.performer && 
            task.performer.toString() === user._id.toString()) {
            
            // Исполнитель может менять статус только на in_progress или completed
            if (updates.status) {
                const allowedStatuses = ['in_progress', 'completed'];
                if (!allowedStatuses.includes(updates.status)) {
                    return { 
                        allowed: false, 
                        reason: 'Исполнитель может менять статус только на "В работе" или "Завершено"' 
                    };
                }
            }
            
            return { allowed: true };
        }
        
        return { 
            allowed: false, 
            reason: 'У вас нет прав для обновления этой задачи' 
        };
    }
    
    // Проверка возможности отмены задачи
    static canCancelTask(user, task) {
        // Админы могут все
        if (['admin', 'superadmin'].includes(user.role)) {
            return { allowed: true };
        }
        
        // Клиент может отменять только свои задачи
        if (user.role === 'client' && task.client.toString() === user._id.toString()) {
            // Клиент может отменять только задачи в статусе 'new' или 'assigned'
            if (['new', 'assigned'].includes(task.status)) {
                return { allowed: true };
            }
            return { 
                allowed: false, 
                reason: 'Вы можете отменять только новые или назначенные задачи' 
            };
        }
        
        // Исполнитель может отменять только назначенные ему задачи
        if (user.role === 'performer' && task.performer && 
            task.performer.toString() === user._id.toString()) {
            
            // Исполнитель может отменять только задачи в статусе 'assigned' или 'in_progress'
            if (['assigned', 'in_progress'].includes(task.status)) {
                return { allowed: true };
            }
            return { 
                allowed: false, 
                reason: 'Вы можете отменять только назначенные вам задачи' 
            };
        }
        
        return { 
            allowed: false, 
            reason: 'У вас нет прав для отмены этой задачи' 
        };
    }
    
    // Уведомление администраторов о новой задаче
    static async notifyAdminsAboutNewTask(task) {
        try {
            const admins = await User.find({ 
                role: { $in: ['admin', 'superadmin'] },
                'preferences.notifications.telegram': true,
                telegramId: { $exists: true, $ne: null }
            });
            
            for (const admin of admins) {
                if (telegramBot) {
                    await telegramBot.sendMessage(
                        admin.telegramId,
                        `🆕 Новая задача создана!\n\n` +
                        `Название: ${task.title}\n` +
                        `Категория: ${Helpers.getCategoryIcon(task.category)} ${task.category}\n` +
                        `Клиент: ${task.client}\n` +
                        `Дедлайн: ${Helpers.formatDate(task.deadline)}\n` +
                        `Цена: ${Helpers.formatPrice(task.price)}\n\n` +
                        `ID задачи: ${task.taskNumber}`
                    );
                }
            }
        } catch (error) {
            winston.error('Ошибка уведомления администраторов:', error);
        }
    }
    
    // Уведомление об изменении статуса
    static async notifyStatusChange(task, oldStatus, changedBy) {
        try {
            // Уведомляем клиента
            if (task.client && task.client.toString() !== changedBy._id.toString()) {
                const client = await User.findById(task.client);
                if (client && client.telegramId && telegramBot) {
                    await telegramBot.sendStatusUpdate(task, oldStatus, task.status, client._id);
                }
            }
            
            // Уведомляем исполнителя
            if (task.performer && task.performer.toString() !== changedBy._id.toString()) {
                const performer = await User.findById(task.performer);
                if (performer && performer.telegramId && telegramBot) {
                    await telegramBot.sendStatusUpdate(task, oldStatus, task.status, performer._id);
                }
            }
        } catch (error) {
            winston.error('Ошибка уведомления об изменении статуса:', error);
        }
    }
    
    // Уведомление клиента об изменении статуса
    static async notifyClientAboutStatusChange(task, oldStatus, newStatus) {
        try {
            const client = await User.findById(task.client);
            
            if (client && client.telegramId && telegramBot) {
                await telegramBot.sendMessage(
                    client.telegramId,
                    `🔄 Статус вашей задачи изменен\n\n` +
                    `Задача: ${task.title}\n` +
                    `№: ${task.taskNumber}\n` +
                    `Статус: ${newStatus}\n\n` +
                    `Ссылка: https://ваш-сайт.com/tasks/${task._id}`
                );
            }
        } catch (error) {
            winston.error('Ошибка уведомления клиента:', error);
        }
    }
    
    // Запрос отзыва у клиента
    static async requestFeedbackFromClient(task) {
        try {
            const client = await User.findById(task.client);
            
            if (client && client.telegramId && telegramBot) {
                await telegramBot.sendMessage(
                    client.telegramId,
                    `✅ Задача завершена!\n\n` +
                    `Задача: ${task.title}\n` +
                    `Исполнитель: ${task.performer?.firstName || 'Не указан'}\n` +
                    `№: ${task.taskNumber}\n\n` +
                    `Пожалуйста, оцените выполнение задачи и оставьте отзыв.\n` +
                    `Ссылка для оценки: https://ваш-сайт.com/tasks/${task._id}/review`
                );
            }
        } catch (error) {
            winston.error('Ошибка запроса отзыва:', error);
        }
    }
    
    // Уведомление об отмене
    static async notifyCancellation(task, cancelledBy, reason) {
        try {
            // Уведомляем клиента (если отмена не им)
            if (task.client.toString() !== cancelledBy._id.toString()) {
                const client = await User.findById(task.client);
                if (client && client.telegramId && telegramBot) {
                    await telegramBot.sendMessage(
                        client.telegramId,
                        `❌ Задача отменена\n\n` +
                        `Задача: ${task.title}\n` +
                        `№: ${task.taskNumber}\n` +
                        `Причина: ${reason || 'Не указана'}\n` +
                        `Отменена: ${cancelledBy.firstName} ${cancelledBy.lastName}\n\n` +
                        `Ссылка: https://ваш-сайт.com/tasks/${task._id}`
                    );
                }
            }
            
            // Уведомляем исполнителя (если был и если отмена не им)
            if (task.performer && task.performer.toString() !== cancelledBy._id.toString()) {
                const performer = await User.findById(task.performer);
                if (performer && performer.telegramId && telegramBot) {
                    await telegramBot.sendMessage(
                        performer.telegramId,
                        `❌ Задача отменена\n\n` +
                        `Задача: ${task.title}\n` +
                        `№: ${task.taskNumber}\n` +
                        `Причина: ${reason || 'Не указана'}\n` +
                        `Отменена: ${cancelledBy.firstName} ${cancelledBy.lastName}`
                    );
                }
            }
        } catch (error) {
            winston.error('Ошибка уведомления об отмене:', error);
        }
    }
    
    // Уведомление исполнителя о переоткрытии
    static async notifyPerformerAboutReopening(task, reopenedBy, reason) {
        try {
            const performer = await User.findById(task.performer);
            
            if (performer && performer.telegramId && telegramBot) {
                await telegramBot.sendMessage(
                    performer.telegramId,
                    `🔄 Задача переоткрыта\n\n` +
                    `Задача: ${task.title}\n` +
                    `№: ${task.taskNumber}\n` +
                    `Причина: ${reason || 'Не указана'}\n` +
                    `Переоткрыта: ${reopenedBy.firstName} ${reopenedBy.lastName}\n\n` +
                    `Задача снова доступна для работы.`
                );
            }
        } catch (error) {
            winston.error('Ошибка уведомления о переоткрытии:', error);
        }
    }
    
    // Обновление рейтинга исполнителя
    static async updatePerformerRating(performerId) {
        try {
            const tasks = await Task.find({
                performer: performerId,
                rating: { $exists: true, $gt: 0 }
            });
            
            if (tasks.length > 0) {
                const totalRating = tasks.reduce((sum, task) => sum + task.rating, 0);
                const averageRating = totalRating / tasks.length;
                
                await User.findByIdAndUpdate(performerId, {
                    rating: parseFloat(averageRating.toFixed(1))
                });
            }
        } catch (error) {
            winston.error('Ошибка обновления рейтинга исполнителя:', error);
        }
    }
    
    // Уведомление исполнителя об отзыве
    static async notifyPerformerAboutReview(task) {
        try {
            const performer = await User.findById(task.performer);
            
            if (performer && performer.telegramId && telegramBot) {
                const stars = '⭐'.repeat(task.rating) + '☆'.repeat(5 - task.rating);
                
                await telegramBot.sendMessage(
                    performer.telegramId,
                    `🌟 Новый отзыв!\n\n` +
                    `Задача: ${task.title}\n` +
                    `Оценка: ${stars} (${task.rating}/5)\n` +
                    `Отзыв: ${task.feedback?.text || 'Без комментария'}\n\n` +
                    `Спасибо за вашу работу!`
                );
            }
        } catch (error) {
            winston.error('Ошибка уведомления об отзыве:', error);
        }
    }
}

module.exports = TaskController;
