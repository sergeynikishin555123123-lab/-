const express = require('express');
const router = express.Router();
const ServiceController = require('../controllers/service.controller');
const { 
    validateIdParam, 
    handleValidationErrors 
} = require('../middleware/validation.middleware');
const { authMiddleware } = require('../middleware/auth.middleware');
const { adminOnly } = require('../middleware/role.middleware');

// Получение всех услуг
router.get('/', ServiceController.getAllServices);

// Получение услуг с пагинацией
router.get('/paginated', ServiceController.getServicesPaginated);

// Получение услуг по категории
router.get('/category/:category', ServiceController.getServicesByCategory);

// Получение категорий услуг
router.get('/categories', ServiceController.getCategories);

// Получение популярных услуг
router.get('/popular', ServiceController.getPopularServices);

// Поиск услуг
router.get('/search', ServiceController.searchServices);

// Получение услуги по ID
router.get(
    '/:id',
    validateIdParam,
    handleValidationErrors,
    ServiceController.getServiceById
);

// Создание услуги (только админы)
router.post(
    '/',
    authMiddleware,
    adminOnly,
    ServiceController.createService
);

// Обновление услуги (только админы)
router.put(
    '/:id',
    authMiddleware,
    adminOnly,
    validateIdParam,
    handleValidationErrors,
    ServiceController.updateService
);

// Удаление услуги (только админы)
router.delete(
    '/:id',
    authMiddleware,
    adminOnly,
    validateIdParam,
    handleValidationErrors,
    ServiceController.deleteService
);

// Добавление исполнителя к услуге (только админы)
router.post(
    '/:id/performers',
    authMiddleware,
    adminOnly,
    validateIdParam,
    handleValidationErrors,
    ServiceController.addPerformer
);

// Удаление исполнителя из услуги (только админы)
router.delete(
    '/:id/performers',
    authMiddleware,
    adminOnly,
    validateIdParam,
    handleValidationErrors,
    ServiceController.removePerformer
);

// Обновление статистики услуги
router.post(
    '/:id/statistics',
    authMiddleware,
    adminOnly,
    validateIdParam,
    handleValidationErrors,
    ServiceController.updateServiceStatistics
);

module.exports = router;
