const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const validator = require('validator');

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: [true, 'Email обязателен'],
        unique: true,
        lowercase: true,
        validate: [validator.isEmail, 'Некорректный email']
    },
    password: {
        type: String,
        required: [true, 'Пароль обязателен'],
        minlength: [6, 'Пароль должен быть не менее 6 символов'],
        select: false
    },
    firstName: {
        type: String,
        required: [true, 'Имя обязательно'],
        trim: true
    },
    lastName: {
        type: String,
        required: [true, 'Фамилия обязательна'],
        trim: true
    },
    phone: {
        type: String,
        validate: {
            validator: function(v) {
                return /^\+?[1-9]\d{1,14}$/.test(v);
            },
            message: 'Некорректный номер телефона'
        }
    },
    role: {
        type: String,
        enum: ['client', 'performer', 'admin', 'superadmin'],
        default: 'client'
    },
    telegramId: {
        type: String,
        unique: true,
        sparse: true
    },
    subscription: {
        type: {
            plan: {
                type: String,
                enum: ['free', 'basic', 'premium', 'vip'],
                default: 'free'
            },
            status: {
                type: String,
                enum: ['active', 'expired', 'cancelled'],
                default: 'expired'
            },
            startDate: Date,
            endDate: Date,
            autoRenew: {
                type: Boolean,
                default: true
            }
        },
        default: {}
    },
    avatar: {
        type: String,
        default: 'default-avatar.jpg'
    },
    rating: {
        type: Number,
        default: 0,
        min: 0,
        max: 5
    },
    completedTasks: {
        type: Number,
        default: 0
    },
    isActive: {
        type: Boolean,
        default: true
    },
    lastLogin: Date,
    preferences: {
        notifications: {
            email: { type: Boolean, default: true },
            telegram: { type: Boolean, default: false },
            push: { type: Boolean, default: true }
        },
        language: {
            type: String,
            default: 'ru'
        }
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Виртуальное поле для полного имени
userSchema.virtual('fullName').get(function() {
    return `${this.firstName} ${this.lastName}`;
});

// Хеширование пароля перед сохранением
userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    
    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

// Метод сравнения паролей
userSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

// Метод проверки подписки
userSchema.methods.hasActiveSubscription = function() {
    if (!this.subscription || !this.subscription.endDate) return false;
    return this.subscription.status === 'active' && 
           this.subscription.endDate > new Date();
};

// Статический метод для поиска по telegramId
userSchema.statics.findByTelegramId = function(telegramId) {
    return this.findOne({ telegramId });
};

// Индексы для оптимизации
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ telegramId: 1 }, { sparse: true });
userSchema.index({ role: 1 });
userSchema.index({ 'subscription.status': 1 });
userSchema.index({ rating: -1 });

const User = mongoose.model('User', userSchema);

module.exports = User;
