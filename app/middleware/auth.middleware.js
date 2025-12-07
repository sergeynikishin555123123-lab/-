const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authMiddleware = async (req, res, next) => {
    try {
        // Получаем токен из заголовка
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'Токен авторизации не предоставлен'
            });
        }

        const token = authHeader.split(' ')[1];

        // Проверяем токен
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Находим пользователя
        const user = await User.findById(decoded.id).select('-password');
        
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }

        // Проверяем активность пользователя
        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                error: 'Аккаунт деактивирован'
            });
        }

        // Добавляем пользователя в запрос
        req.user = user;
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                error: 'Неверный токен авторизации'
            });
        }
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                error: 'Токен авторизации истек'
            });
        }

        console.error('Ошибка авторизации:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера при авторизации'
        });
    }
};

// Middleware для проверки Telegram авторизации
const telegramAuthMiddleware = async (req, res, next) => {
    try {
        const telegramId = req.headers['x-telegram-id'];
        
        if (!telegramId) {
            return res.status(401).json({
                success: false,
                error: 'Telegram ID не предоставлен'
            });
        }

        // Находим пользователя по Telegram ID
        const user = await User.findOne({ telegramId }).select('-password');
        
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Пользователь с таким Telegram ID не найден'
            });
        }

        // Проверяем активность пользователя
        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                error: 'Аккаунт деактивирован'
            });
        }

        req.user = user;
        next();
    } catch (error) {
        console.error('Ошибка Telegram авторизации:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера при авторизации через Telegram'
        });
    }
};

module.exports = { authMiddleware, telegramAuthMiddleware };
