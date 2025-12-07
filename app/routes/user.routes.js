const express = require('express');
const router = express.Router();
const UserController = require('../controllers/user.controller');
const { authMiddleware } = require('../middleware/auth.middleware');
const multer = require('multer');
const path = require('path');

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/avatars/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: function (req, file, cb) {
        const allowedTypes = /jpeg|jpg|png|gif/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Разрешены только изображения'));
        }
    }
});

// Профиль пользователя
router.get('/profile', authMiddleware, UserController.getProfile);
router.put('/profile', authMiddleware, UserController.updateProfile);

// Статистика пользователя
router.get('/stats', authMiddleware, UserController.getUserStats);

// История действий
router.get('/activity', authMiddleware, UserController.getActivityHistory);

// Подписки
router.get('/subscription', authMiddleware, UserController.getSubscription);

// Настройки уведомлений
router.put('/notifications', authMiddleware, UserController.updateNotificationSettings);

// Загрузка аватара
router.post(
    '/avatar',
    authMiddleware,
    upload.single('avatar'),
    UserController.uploadAvatar
);

// Удаление аккаунта
router.post('/delete-account', authMiddleware, UserController.deleteAccountRequest);

// Реферальная система
router.get('/referral', authMiddleware, UserController.getReferralInfo);

// Уведомления
router.get('/notifications', authMiddleware, UserController.getNotifications);
router.post('/notifications/read', authMiddleware, UserController.markNotificationsAsRead);

module.exports = router;
