const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Название услуги обязательно'],
        trim: true,
        maxlength: [100, 'Название не должно превышать 100 символов']
    },
    description: {
        type: String,
        required: [true, 'Описание услуги обязательно'],
        trim: true
    },
    category: {
        type: String,
        required: true,
        enum: [
            'home_and_household',      // Дом и быт
            'family_and_children',     // Дети и семья
            'beauty_and_health',       // Красота и здоровье
            'courses_and_education',   // Курсы и образование
            'pets',                    // Питомцы
            'events_and_entertainment',// Мероприятия и развлечения
            'other'                    // Другое
        ]
    },
    subcategory: {
        type: String,
        trim: true
    },
    icon: {
        type: String,
        default: 'default-icon.png'
    },
    priceOptions: {
        oneTime: {
            type: Number,
            required: [true, 'Цена за разовую услугу обязательна'],
            min: [0, 'Цена не может быть отрицательной']
        },
        subscription: {
            monthly: Number,
            quarterly: Number,
            yearly: Number
        }
    },
    duration: {
        type: Number, // в минутах
        required: true
    },
    performers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    requirements: [{
        type: String,
        trim: true
    }],
    instructions: {
        type: String,
        trim: true
    },
    isPopular: {
        type: Boolean,
        default: false
    },
    isActive: {
        type: Boolean,
        default: true
    },
    order: {
        type: Number,
        default: 0
    },
    tags: [{
        type: String,
        trim: true
    }],
    statistics: {
        totalOrders: {
            type: Number,
            default: 0
        },
        averageRating: {
            type: Number,
            default: 0
        },
        completionRate: {
            type: Number,
            default: 0
        }
    },
    metadata: {
        createdAt: {
            type: Date,
            default: Date.now
        },
        updatedAt: {
            type: Date,
            default: Date.now
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }
    }
}, {
    timestamps: true
});

// Обновление updatedAt перед сохранением
serviceSchema.pre('save', function(next) {
    this.metadata.updatedAt = new Date();
    next();
});

// Метод для увеличения счетчика заказов
serviceSchema.methods.incrementOrders = function() {
    this.statistics.totalOrders += 1;
    return this.save();
};

// Статический метод для поиска по категории
serviceSchema.statics.findByCategory = function(category) {
    return this.find({ 
        category,
        isActive: true 
    }).sort({ order: 1, name: 1 });
};

// Статический метод для популярных услуг
serviceSchema.statics.findPopular = function(limit = 10) {
    return this.find({ 
        isPopular: true,
        isActive: true 
    }).limit(limit).sort({ 'statistics.totalOrders': -1 });
};

// Индексы для оптимизации
serviceSchema.index({ category: 1, isActive: 1 });
serviceSchema.index({ isPopular: 1 });
serviceSchema.index({ 'priceOptions.oneTime': 1 });
serviceSchema.index({ tags: 1 });
serviceSchema.index({ 'statistics.totalOrders': -1 });

const Service = mongoose.model('Service', serviceSchema);

module.exports = Service;
