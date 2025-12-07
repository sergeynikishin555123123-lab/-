const express = require('express');
const router = express.Router();
const AdminController = require('../controllers/admin.controller');
const { authMiddleware } = require('../middleware/auth.middleware');
const { adminOnly, superAdminOnly } = require('../middleware/role.middleware');

// Статистика системы
router.get('/stats', authMiddleware, adminOnly, AdminController.getSystemStats);

// Управление пользователями
router.get('/users', authMiddleware, adminOnly, AdminController.getAllUsers);
router.get('/users/:id', authMiddleware, adminOnly, AdminController.getUserById);
router.put('/users/:id', authMiddleware, adminOnly, AdminController.updateUser);
router.patch('/users/:id/status', authMiddleware, adminOnly, AdminController.toggleUserStatus);

// Управление задачами
router.get('/tasks', authMiddleware, adminOnly, AdminController.getAllTasks);
router.get('/tasks/export', authMiddleware, adminOnly, AdminController.exportTasksToExcel);

// Управление подписками
router.get('/subscriptions', authMiddleware, adminOnly, AdminController.getAllSubscriptions);
router.post('/subscriptions/manage', authMiddleware, adminOnly, AdminController.manageSubscriptions);

// Экспорт пользователей
router.get('/users/export', authMiddleware, adminOnly, AdminController.exportUsersToExcel);

// Логи системы
router.get('/logs', authMiddleware, superAdminOnly, AdminController.getSystemLogs);

module.exports = router;
