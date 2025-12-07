const express = require('express');
const router = express.Router();
const TaskController = require('../controllers/task.controller');
const { 
    validateTask, 
    validateIdParam, 
    validateReview,
    handleValidationErrors 
} = require('../middleware/validation.middleware');
const { authMiddleware } = require('../middleware/auth.middleware');
const { 
    clientOnly, 
    performerOnly, 
    taskOwnerOrAdmin 
} = require('../middleware/role.middleware');

// Создание задачи (только клиенты)
router.post(
    '/',
    authMiddleware,
    clientOnly,
    validateTask,
    handleValidationErrors,
    TaskController.createTask
);

// Получение списка задач (с фильтрацией)
router.get('/', authMiddleware, TaskController.getTasks);

// Получение доступных задач для исполнителей
router.get('/available', authMiddleware, performerOnly, TaskController.getAvailableTasks);

// Получение задачи по ID
router.get(
    '/:id',
    authMiddleware,
    validateIdParam,
    handleValidationErrors,
    taskOwnerOrAdmin,
    TaskController.getTaskById
);

// Обновление задачи
router.put(
    '/:id',
    authMiddleware,
    validateIdParam,
    handleValidationErrors,
    taskOwnerOrAdmin,
    TaskController.updateTask
);

// Удаление задачи (архивация)
router.delete(
    '/:id',
    authMiddleware,
    validateIdParam,
    handleValidationErrors,
    taskOwnerOrAdmin,
    TaskController.deleteTask
);

// Назначение исполнителя (клиент или админ)
router.post(
    '/:id/assign',
    authMiddleware,
    validateIdParam,
    handleValidationErrors,
    taskOwnerOrAdmin,
    TaskController.assignPerformer
);

// Принятие задачи исполнителем
router.post(
    '/:id/accept',
    authMiddleware,
    performerOnly,
    validateIdParam,
    handleValidationErrors,
    TaskController.acceptTask
);

// Завершение задачи
router.post(
    '/:id/complete',
    authMiddleware,
    validateIdParam,
    handleValidationErrors,
    TaskController.completeTask
);

// Отмена задачи
router.post(
    '/:id/cancel',
    authMiddleware,
    validateIdParam,
    handleValidationErrors,
    TaskController.cancelTask
);

// Переоткрытие задачи
router.post(
    '/:id/reopen',
    authMiddleware,
    validateIdParam,
    handleValidationErrors,
    TaskController.reopenTask
);

// Добавление отзыва и оценки
router.post(
    '/:id/review',
    authMiddleware,
    clientOnly,
    validateIdParam,
    validateReview,
    handleValidationErrors,
    TaskController.addReview
);

module.exports = router;
