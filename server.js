const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');

// Загрузка переменных окружения
dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Подключение к БД
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('✅ MongoDB connected'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// Основные маршруты
app.use('/api/auth', require('./app/routes/auth.routes'));
app.use('/api/tasks', require('./app/routes/task.routes'));
app.use('/api/services', require('./app/routes/service.routes'));
app.use('/api/admin', require('./app/routes/admin.routes'));

// Проверка состояния сервера
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'Server is running' });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Domain: sergeynikishin555123123-lab--86fa.twc1.net`);
});
