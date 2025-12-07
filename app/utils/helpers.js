const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const winston = require('winston');

class Helpers {
    // Генерация JWT токена
    static generateToken(userId) {
        return jwt.sign(
            { id: userId },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRE || '7d' }
        );
    }

    // Генерация случайной строки
    static generateRandomString(length = 8) {
        return crypto
            .randomBytes(Math.ceil(length / 2))
            .toString('hex')
            .slice(0, length);
    }

    // Генерация номера заказа/задачи
    static generateOrderNumber(prefix = 'ORD') {
        const date = new Date();
        const year = date.getFullYear().toString().slice(-2);
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        const random = Math.floor(1000 + Math.random() * 9000);
        
        return `${prefix}-${year}${month}${day}-${random}`;
    }

    // Форматирование даты
    static formatDate(date, format = 'ru-RU') {
        if (!date) return '';
        
        const d = new Date(date);
        
        if (format === 'ru-RU') {
            return d.toLocaleDateString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
        
        if (format === 'ISO') {
            return d.toISOString();
        }
        
        return d.toString();
    }

    // Форматирование цены
    static formatPrice(price, currency = '₽') {
        if (!price && price !== 0) return '';
        
        return new Intl.NumberFormat('ru-RU', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }).format(price) + (currency ? ` ${currency}` : '');
    }

    // Валидация email
    static isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    // Валидация телефона
    static isValidPhone(phone) {
        const phoneRegex = /^\+?[1-9]\d{1,14}$/;
        return phoneRegex.test(phone);
    }

    // Очистка объекта от undefined/null полей
    static cleanObject(obj) {
        const cleaned = {};
        
        for (const [key, value] of Object.entries(obj)) {
            if (value !== undefined && value !== null) {
                cleaned[key] = value;
            }
        }
        
        return cleaned;
    }

    // Пагинация
    static paginate(array, page = 1, limit = 10) {
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        
        const results = {};
        results.total = array.length;
        results.pages = Math.ceil(array.length / limit);
        results.currentPage = page;
        results.perPage = limit;
        
        if (endIndex < array.length) {
            results.next = page + 1;
        }
        
        if (startIndex > 0) {
            results.prev = page - 1;
        }
        
        results.data = array.slice(startIndex, endIndex);
        
        return results;
    }

    // Генерация слогана для категории
    static getCategorySlogan(category) {
        const slogans = {
            'home': 'Уютный дом - счастливая жизнь!',
            'family': 'Семья - это самое главное!',
            'beauty': 'Красота требует внимания!',
            'courses': 'Знания - это сила!',
            'pets': 'Любимые питомцы в надежных руках!',
            'other': 'Мы поможем с любым вопросом!'
        };
        
        return slogans[category] || 'Мы всегда готовы помочь!';
    }

    // Расчет времени выполнения
    static calculateETA(startTime, progressPercent) {
        if (!startTime || !progressPercent || progressPercent <= 0) {
            return 'Рассчитывается...';
        }
        
        const elapsed = Date.now() - new Date(startTime).getTime();
        const estimatedTotal = (elapsed / progressPercent) * 100;
        const remaining = estimatedTotal - elapsed;
        
        if (remaining <= 0) return 'Завершено';
        
        const hours = Math.floor(remaining / (1000 * 60 * 60));
        const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
        
        if (hours > 0) {
            return `${hours}ч ${minutes}м`;
        }
        
        return `${minutes} минут`;
    }

    // Генерация цветов для статусов
    static getStatusColor(status) {
        const colors = {
            'new': '#3498db',        // Синий
            'assigned': '#f39c12',   // Оранжевый
            'in_progress': '#9b59b6',// Фиолетовый
            'completed': '#2ecc71',  // Зеленый
            'cancelled': '#e74c3c',  // Красный
            'reopened': '#1abc9c'    // Бирюзовый
        };
        
        return colors[status] || '#95a5a6'; // Серый по умолчанию
    }

    // Генерация иконки для категории
    static getCategoryIcon(category) {
        const icons = {
            'home': '🏠',
            'family': '👨‍👩‍👧‍👦',
            'beauty': '💅',
            'courses': '🎓',
            'pets': '🐶',
            'other': '📋'
        };
        
        return icons[category] || '❓';
    }

    // Проверка сложности пароля
    static checkPasswordStrength(password) {
        if (!password) return { score: 0, message: 'Пароль отсутствует' };
        
        let score = 0;
        let messages = [];
        
        // Длина
        if (password.length >= 8) score += 1;
        else messages.push('Добавьте еще символов (минимум 8)');
        
        // Цифры
        if (/\d/.test(password)) score += 1;
        else messages.push('Добавьте цифры');
        
        // Заглавные буквы
        if (/[A-Z]/.test(password)) score += 1;
        else messages.push('Добавьте заглавные буквы');
        
        // Строчные буквы
        if (/[a-z]/.test(password)) score += 1;
        else messages.push('Добавьте строчные буквы');
        
        // Специальные символы
        if (/[^A-Za-z0-9]/.test(password)) score += 1;
        else messages.push('Добавьте специальные символы');
        
        const strength = {
            score,
            maxScore: 5,
            percentage: (score / 5) * 100,
            level: score <= 2 ? 'weak' : score <= 3 ? 'medium' : score <= 4 ? 'strong' : 'very strong',
            message: messages.length > 0 ? messages.join(', ') : 'Отличный пароль!'
        };
        
        return strength;
    }

    // Генерация ссылки для сброса пароля
    static generateResetToken(userId) {
        const token = crypto.randomBytes(32).toString('hex');
        const expires = Date.now() + 3600000; // 1 час
        
        // В реальном приложении здесь нужно сохранить токен в БД
        return {
            token,
            expires,
            url: `${process.env.FRONTEND_URL}/reset-password?token=${token}&id=${userId}`
        };
    }

    // Логирование действий
    static logAction(user, action, details = {}) {
        winston.info('Действие пользователя', {
            userId: user._id,
            userEmail: user.email,
            action,
            details,
            timestamp: new Date().toISOString()
        });
    }

    // Обработка ошибок API
    static handleApiError(error, defaultMessage = 'Произошла ошибка') {
        console.error('API Error:', error);
        
        let message = defaultMessage;
        let statusCode = 500;
        
        if (error.name === 'ValidationError') {
            message = 'Ошибка валидации данных';
            statusCode = 400;
        } else if (error.name === 'CastError') {
            message = 'Некорректный ID';
            statusCode = 400;
        } else if (error.code === 11000) {
            message = 'Дубликат данных';
            statusCode = 409;
        } else if (error.statusCode) {
            statusCode = error.statusCode;
            message = error.message;
        }
        
        return {
            success: false,
            error: message,
            details: process.env.NODE_ENV === 'development' ? error.message : undefined,
            statusCode
        };
    }
}

module.exports = Helpers;
