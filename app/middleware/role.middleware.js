const roleMiddleware = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'Пользователь не авторизован'
            });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'У вас нет прав для выполнения этого действия',
                requiredRoles: allowedRoles,
                yourRole: req.user.role
            });
        }

        next();
    };
};

// Специальные middleware для конкретных ролей
const clientOnly = roleMiddleware('client');
const performerOnly = roleMiddleware('performer');
const adminOnly = roleMiddleware('admin', 'superadmin');
const superAdminOnly = roleMiddleware('superadmin');

// Middleware для проверки владельца задачи
const taskOwnerOrAdmin = async (req, res, next) => {
    try {
        const taskId = req.params.id || req.params.taskId;
        const Task = require('../models/Task');
        
        const task = await Task.findById(taskId);
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }

        // Разрешаем если пользователь:
        // 1. Владелец задачи (клиент)
        // 2. Исполнитель задачи
        // 3. Администратор
        // 4. Супер-администратор
        const isOwner = task.client.toString() === req.user._id.toString();
        const isPerformer = task.performer && task.performer.toString() === req.user._id.toString();
        const isAdmin = ['admin', 'superadmin'].includes(req.user.role);

        if (isOwner || isPerformer || isAdmin) {
            req.task = task;
            return next();
        }

        return res.status(403).json({
            success: false,
            error: 'У вас нет прав для работы с этой задачей'
        });
    } catch (error) {
        console.error('Ошибка проверки прав на задачу:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера при проверке прав'
        });
    }
};

module.exports = {
    roleMiddleware,
    clientOnly,
    performerOnly,
    adminOnly,
    superAdminOnly,
    taskOwnerOrAdmin
};
