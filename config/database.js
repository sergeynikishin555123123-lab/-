const mongoose = require('mongoose');
const winston = require('winston');

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });
        
        winston.info(`✅ MongoDB подключена: ${conn.connection.host}`);
        console.log(`✅ MongoDB подключена: ${conn.connection.host}`);
        
        return conn;
    } catch (error) {
        winston.error(`❌ Ошибка подключения к MongoDB: ${error.message}`);
        console.error(`❌ Ошибка подключения к MongoDB: ${error.message}`);
        process.exit(1);
    }
};

module.exports = connectDB;
