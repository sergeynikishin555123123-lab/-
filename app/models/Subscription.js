const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    plan: {
        type: String,
        enum: ['basic', 'premium', 'vip'],
        required: true
    },
    period: {
        type: String,
        enum: ['monthly', 'quarterly', 'yearly'],
        required: true
    },
    price: {
        type: Number,
        required: true,
        min: [0, 'Цена не может быть отрицательной']
    },
    status: {
        type: String,
        enum: ['active', 'pending', 'cancelled', 'expired'],
        default: 'pending'
    },
    startDate: {
        type: Date,
        required: true
    },
    endDate: {
        type: Date,
        required: true
    },
    autoRenew: {
        type: Boolean,
        default: true
    },
    paymentMethod: {
        type: String,
        enum: ['card', 'paypal', 'bank_transfer', 'other'],
        required: true
    },
    transactionId: {
        type: String,
        required: true
    },
    features: {
        maxTasksPerMonth: Number,
        prioritySupport: Boolean,
        discountPercent: Number,
        freeCancellations: Number,
        advancedAnalytics: Boolean
    },
    cancellation: {
        requestedAt: Date,
        reason: String,
        effectiveDate: Date
    },
    history: [{
        action: String,
        timestamp: {
            type: Date,
            default: Date.now
        },
        details: String,
        changedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }
    }]
}, {
    timestamps: true
});

// Проверка активной подписки
subscriptionSchema.methods.isActive = function() {
    const now = new Date();
    return this.status === 'active' && 
           this.startDate <= now && 
           this.endDate >= now;
};

// Автоматическое продление
subscriptionSchema.methods.autoRenewSubscription = function() {
    if (this.autoRenew && this.isActive() && this.endDate - Date.now() < 7 * 24 * 60 * 60 * 1000) {
        // За 7 дней до окончания инициировать продление
        return true;
    }
    return false;
};

// Отмена подписки
subscriptionSchema.methods.cancel = function(reason, userId) {
    this.status = 'cancelled';
    this.cancellation = {
        requestedAt: new Date(),
        reason: reason,
        effectiveDate: this.endDate // Отмена действует с даты окончания
    };
    
    this.history.push({
        action: 'cancellation_requested',
        details: reason || 'Без указания причины',
        changedBy: userId
    });
    
    return this.save();
};

// Статический метод для поиска активных подписок
subscriptionSchema.statics.findActiveSubscriptions = function() {
    const now = new Date();
    return this.find({
        status: 'active',
        startDate: { $lte: now },
        endDate: { $gte: now }
    });
};

// Статический метод для поиска подписок, требующих продления
subscriptionSchema.statics.findDueForRenewal = function(daysBefore = 7) {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() + daysBefore);
    
    return this.find({
        status: 'active',
        autoRenew: true,
        endDate: { 
            $lte: thresholdDate,
            $gte: new Date()
        }
    });
};

// Индексы для оптимизации
subscriptionSchema.index({ user: 1 });
subscriptionSchema.index({ status: 1 });
subscriptionSchema.index({ endDate: 1 });
subscriptionSchema.index({ plan: 1, period: 1 });
subscriptionSchema.index({ 'cancellation.requestedAt': 1 });

const Subscription = mongoose.model('Subscription', subscriptionSchema);

module.exports = Subscription;
