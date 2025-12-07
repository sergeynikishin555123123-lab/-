const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
    taskNumber: {
        type: String,
        unique: true,
        required: true
    },
    title: {
        type: String,
        required: [true, 'Название задачи обязательно'],
        trim: true,
        maxlength: [200, 'Название не должно превышать 200 символов']
    },
    description: {
        type: String,
        required: [true, 'Описание задачи обязательно'],
        trim: true
    },
    client: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    performer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    category: {
        type: String,
        enum: [
            'home',           // Дом и быт
            'family',         // Дети и семья
            'beauty',         // Красота и здоровье
            'courses',        // Курсы
            'pets',           // Питомцы
            'other'           // Другое
        ],
        required: true
    },
    subcategory: {
        type: String,
        trim: true
    },
    status: {
        type: String,
        enum: [
            'new',           // Новая
            'assigned',      // Назначена исполнителю
            'in_progress',   // В работе
            'completed',     // Выполнена
            'cancelled',     // Отменена
            'reopened'       // Переоткрыта
        ],
        default: 'new'
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'urgent'],
        default: 'medium'
    },
    deadline: {
        type: Date,
        required: true
    },
    price: {
        type: Number,
        required: true,
        min: [0, 'Цена не может быть отрицательной']
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'paid', 'refunded', 'cancelled'],
        default: 'pending'
    },
    location: {
        address: String,
        coordinates: {
            lat: Number,
            lng: Number
        }
    },
    attachments: [{
        filename: String,
        path: String,
        mimetype: String,
        size: Number,
        uploadedAt: {
            type: Date,
            default: Date.now
        }
    }],
    rating: {
        type: Number,
        min: 1,
        max: 5
    },
    feedback: {
        text: String,
        createdAt: Date
    },
    cancellationReason: {
        type: String,
        enum: [
            'client_change_mind',
            'performer_unavailable',
            'price_issue',
            'schedule_conflict',
            'other'
        ]
    },
    cancellationNote: String,
    history: [{
        action: String,
        status: String,
        changedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        timestamp: {
            type: Date,
            default: Date.now
        },
        note: String
    }],
    isArchived: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

// Генерация номера задачи перед сохранением
taskSchema.pre('save', async function(next) {
    if (!this.taskNumber) {
        const date = new Date();
        const year = date.getFullYear().toString().slice(-2);
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        
        // Находим последнюю задачу за сегодня
        const lastTask = await this.constructor.findOne(
            { createdAt: { $gte: new Date().setHours(0,0,0,0) } },
            { taskNumber: 1 },
            { sort: { createdAt: -1 } }
        );
        
        let sequence = 1;
        if (lastTask && lastTask.taskNumber) {
            const lastSeq = parseInt(lastTask.taskNumber.slice(-4));
            if (!isNaN(lastSeq)) sequence = lastSeq + 1;
        }
        
        this.taskNumber = `TASK-${year}${month}${day}-${sequence.toString().padStart(4, '0')}`;
    }
    next();
});

// Автоматическое добавление в историю при изменении статуса
taskSchema.pre('save', function(next) {
    if (this.isModified('status')) {
        if (!this.history) this.history = [];
        this.history.push({
            action: 'status_change',
            status: this.status,
            changedBy: this.performer || this.client,
            note: `Статус изменен на ${this.status}`
        });
    }
    next();
});

// Метод для повторного открытия задачи
taskSchema.methods.reopen = function(userId, reason) {
    if (this.status !== 'completed' && this.status !== 'cancelled') {
        throw new Error('Можно переоткрыть только завершенные или отмененные задачи');
    }
    
    this.status = 'reopened';
    this.history.push({
        action: 'reopen',
        status: 'reopened',
        changedBy: userId,
        note: reason || 'Задача переоткрыта'
    });
    
    return this.save();
};

// Статические методы для фильтрации
taskSchema.statics.findByClient = function(clientId) {
    return this.find({ client: clientId }).sort({ createdAt: -1 });
};

taskSchema.statics.findByPerformer = function(performerId) {
    return this.find({ performer: performerId }).sort({ createdAt: -1 });
};

taskSchema.statics.findActive = function() {
    return this.find({
        status: { $in: ['new', 'assigned', 'in_progress'] },
        isArchived: false
    });
};

// Индексы для оптимизации
taskSchema.index({ taskNumber: 1 }, { unique: true });
taskSchema.index({ client: 1, createdAt: -1 });
taskSchema.index({ performer: 1, createdAt: -1 });
taskSchema.index({ status: 1 });
taskSchema.index({ category: 1 });
taskSchema.index({ deadline: 1 });
taskSchema.index({ createdAt: -1 });

const Task = mongoose.model('Task', taskSchema);

module.exports = Task;
