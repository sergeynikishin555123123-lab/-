const express = require('express');
const router = express.Router();
const AuthController = require('../controllers/auth.controller');
const { 
    validateRegister, 
    validateLogin, 
    handleValidationErrors 
} = require('../middleware/validation.middleware');
const { authMiddleware } = require('../middleware/auth.middleware');

// Регистрация
router.post(
    '/register',
    validateRegister,
    handleValidationErrors,
    AuthController.register
);

// Вход
router.post(
    '/login',
    validateLogin,
    handleValidationErrors,
    AuthController.login
);

// Вход через Telegram
router.post('/telegram-login', AuthController.telegramLogin);

// Получение текущего пользователя
router.get('/me', authMiddleware, AuthController.getCurrentUser);

// Обновление профиля
router.put('/profile', authMiddleware, AuthController.updateProfile);

// Смена пароля
router.put('/change-password', authMiddleware, AuthController.changePassword);

// Запрос сброса пароля
router.post('/forgot-password', AuthController.forgotPassword);

// Сброс пароля
router.post('/reset-password', AuthController.resetPassword);

// Выход
router.post('/logout', authMiddleware, AuthController.logout);

// Проверка email
router.get('/check-email', AuthController.checkEmail);

// Привязка Telegram
router.post('/link-telegram', authMiddleware, AuthController.linkTelegram);

module.exports = router;
