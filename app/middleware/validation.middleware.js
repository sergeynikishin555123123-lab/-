const { body, param, query, validationResult } = require('express-validator');
const User = require('../models/User');

// Валидация регистрации
const validateRegister = [
    body('email')
        .isEmail()
        .withMessage('Введите корректный email')
        .normalizeEmail()
        .custom(async (email) => {
            const existingUser = await User.findOne({ email });
            if (existingUser) {
                throw new Error('Пользователь с таким email уже существует');
            }
            return true;
        }),
    body('password')
        .isLength({ min: 6 })
        .withMessage('Пароль должен быть не менее 6 символов')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .withMessage('Пароль должен содержать хотя бы одну заглавную букву, одну строчную букву и одну цифру'),
    body('firstName')
        .trim()
        .notEmpty()
        .withMessage('Имя обязательно')
        .isLength({ min: 2, max: 50 })
        .withMessage('Имя должно быть от 2 до 50 символов'),
    body('lastName')
        .trim()
        .notEmpty()
        .withMessage('Фамилия обязательна')
        .isLength({ min: 2, max: 50 })
        .withMessage('Фамилия должна быть от 2 до 50 символов'),
    body('phone')
        .optional()
        .matches(/^\+?[1-9]\d{1,14}$/)
        .withMessage('Введите корректный номер телефона'),
    body('role')
        .optional()
        .isIn(['client', 'performer', 'admin', 'superadmin'])
        .withMessage('Некорректная роль')
];

// Валидация входа
const validateLogin = [
    body('email')
        .isEmail()
        .withMessage('Введите корректный email')
        .normalizeEmail(),
    body('password')
        .notEmpty()
        .withMessage('Пароль обязателен')
];

// Валидация создания задачи
const validateTask = [
    body('title')
        .trim()
        .notEmpty()
        .withMessage('Название задачи обязательно')
        .isLength({ max: 200 })
        .withMessage('Название не должно превышать 200 символов'),
    body('description')
        .trim()
        .notEmpty()
        .withMessage('Описание задачи обязательно'),
    body('category')
        .isIn(['home', 'family', 'beauty', 'courses', 'pets', 'other'])
        .withMessage('Некорректная категория'),
    body('deadline')
        .isISO8601()
        .withMessage('Некорректная дата дедлайна')
        .custom((value) => {
            const deadline = new Date(value);
            const now = new Date();
            if (deadline <= now) {
                throw new Error('Дедлайн должен быть в будущем');
            }
            return true;
        }),
    body('price')
        .isFloat({ min: 0 })
        .withMessage('Цена должна быть положительным числом'),
    body('priority')
        .optional()
        .isIn(['low', 'medium', 'high', 'urgent'])
        .withMessage('Некорректный приоритет'),
    body('location.address')
        .optional()
        .trim()
        .isLength({ max: 500 })
        .withMessage('Адрес не должен превышать 500 символов')
];

// Валидация ID параметра
const validateIdParam = [
    param('id')
        .isMongoId()
        .withMessage('Некорректный ID формата')
];

// Валидация отзыва
const validateReview = [
    body('rating')
        .isInt({ min: 1, max: 5 })
        .withMessage('Рейтинг должен быть от 1 до 5'),
    body('feedback')
        .optional()
        .trim()
        .isLength({ max: 1000 })
        .withMessage('Отзыв не должен превышать 1000 символов')
];

// Обработчик ошибок валидации
const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            errors: errors.array().map(err => ({
                field: err.param,
                message: err.msg
            }))
        });
    }
    next();
};

module.exports = {
    validateRegister,
    validateLogin,
    validateTask,
    validateIdParam,
    validateReview,
    handleValidationErrors
};
