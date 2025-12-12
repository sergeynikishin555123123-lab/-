// server.js - УПРОЩЕННАЯ ВЕРСИЯ ДЛЯ 50-100 ПОЛЬЗОВАТЕЛЕЙ
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs').promises;
const axios = require('axios');

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
const app = express();

// CORS
app.use(cors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.options('*', cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// ==================== SMS СЕРВИС ====================
const sendSMS = async (phone, message) => {
    try {
        const cleanPhone = phone.replace(/\D/g, '');
        
        // Для тестирования - выводим в консоль
        if (process.env.NODE_ENV !== 'production') {
            console.log(`📱 SMS для ${phone}: ${message}`);
            return { status: 'OK', test_mode: true };
        }
        
        // Реальная интеграция с sms.ru
        if (process.env.SMS_API_ID) {
            const response = await axios.post('https://sms.ru/sms/send', {
                api_id: process.env.SMS_API_ID,
                to: cleanPhone,
                msg: message,
                json: 1
            });
            
            return response.data;
        }
        
        return { status: 'NO_API_KEY' };
    } catch (error) {
        console.error('Ошибка отправки SMS:', error.message);
        return { status: 'ERROR', error: error.message };
    }
};

// ==================== БАЗА ДАННЫХ ====================
let db;

const initDatabase = async () => {
    try {
        console.log('🔄 Инициализация базы данных...');
        
        const dbPath = './concierge_simple.db';
        console.log(`📁 Путь к базе данных: ${dbPath}`);
        
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        console.log('✅ База данных SQLite подключена');
        await db.run('PRAGMA foreign_keys = ON');

        // ==================== УПРОЩЕННЫЕ ТАБЛИЦЫ ====================
        await db.exec('BEGIN TRANSACTION');

        // Пользователи (упрощенная)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT UNIQUE NOT NULL,
                first_name TEXT NOT NULL,
                last_name TEXT NOT NULL,
                password TEXT,
                email TEXT,
                role TEXT DEFAULT 'client' CHECK(role IN ('client', 'performer', 'admin')),
                
                subscription_plan TEXT DEFAULT 'essential',
                subscription_status TEXT DEFAULT 'pending' CHECK(subscription_status IN ('pending', 'active', 'suspended', 'cancelled')),
                subscription_expires DATE,
                
                balance REAL DEFAULT 0,
                initial_fee_paid INTEGER DEFAULT 0,
                initial_fee_amount REAL DEFAULT 0,
                
                tasks_limit INTEGER DEFAULT 5,
                tasks_used INTEGER DEFAULT 0,
                
                phone_verified INTEGER DEFAULT 0,
                verification_code TEXT,
                verification_code_expires TIMESTAMP,
                
                payment_method TEXT DEFAULT 'sms',
                auto_renewal INTEGER DEFAULT 1,
                last_payment_date DATE,
                payment_failures INTEGER DEFAULT 0,
                grace_period_until DATE,
                
                sms_notifications INTEGER DEFAULT 1,
                privacy_accepted INTEGER DEFAULT 0,
                agreement_accepted INTEGER DEFAULT 0,
                
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Подписки (упрощенная)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                display_name TEXT NOT NULL,
                description TEXT NOT NULL,
                price_monthly REAL NOT NULL,
                tasks_limit INTEGER NOT NULL,
                features TEXT NOT NULL,
                is_popular INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Услуги (виртуальные)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS services (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                icon TEXT NOT NULL,
                is_active INTEGER DEFAULT 1,
                sort_order INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Задачи (упрощенная)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_number TEXT UNIQUE NOT NULL,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                client_id INTEGER NOT NULL,
                performer_id INTEGER,
                service_id INTEGER,
                status TEXT DEFAULT 'new' CHECK(status IN ('new', 'searching', 'assigned', 'in_progress', 'completed', 'cancelled')),
                priority TEXT DEFAULT 'medium',
                deadline DATETIME,
                contact_info TEXT,
                address TEXT,
                admin_notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP,
                FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (performer_id) REFERENCES users(id) ON DELETE SET NULL,
                FOREIGN KEY (service_id) REFERENCES services(id)
            )
        `);

        // Сообщения в чате
        await db.exec(`
            CREATE TABLE IF NOT EXISTS task_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                message TEXT NOT NULL,
                is_read INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Внутренние чаты (между исполнителями и админами)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS internal_chats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender_id INTEGER NOT NULL,
                receiver_id INTEGER NOT NULL,
                message TEXT NOT NULL,
                is_read INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Платежи
        await db.exec(`
            CREATE TABLE IF NOT EXISTS payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                subscription_id INTEGER,
                amount REAL NOT NULL,
                description TEXT NOT NULL,
                status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'failed', 'refunded')),
                payment_method TEXT DEFAULT 'sms',
                payment_data TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
            )
        `);

        // Уведомления
        await db.exec(`
            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                is_read INTEGER DEFAULT 0,
                related_id INTEGER,
                related_type TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Юридические соглашения
        await db.exec(`
            CREATE TABLE IF NOT EXISTS agreements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                agreement_type TEXT NOT NULL,
                version TEXT NOT NULL,
                accepted INTEGER DEFAULT 0,
                accepted_at TIMESTAMP,
                ip_address TEXT,
                user_agent TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        await db.exec('COMMIT');
        console.log('✅ Все таблицы созданы');

        // Создаем тестовые данные
        await createInitialData();
        
        return db;
    } catch (error) {
        await db.exec('ROLLBACK');
        console.error('❌ Ошибка инициализации базы данных:', error.message);
        throw error;
    }
};

// ==================== ТЕСТОВЫЕ ДАННЫЕ ====================
const createInitialData = async () => {
    try {
        console.log('📝 Создание начальных данных...');

        // Подписки
        const subscriptionsExist = await db.get("SELECT 1 FROM subscriptions WHERE name = 'essential'");
        if (!subscriptionsExist) {
            const subscriptions = [
                ['essential', 'Эссеншл', 'Базовые виртуальные услуги', 990, 5, 
                 '["5 задач в месяц", "Виртуальная помощь", "Чат с исполнителем", "Поддержка по SMS"]', 0, 1],
                ['premium', 'Премиум', 'Полный доступ ко всем услугам', 1990, 20,
                 '["20 задач в месяц", "Приоритетная поддержка", "Личный помощник", "Экспресс-задачи"]', 1, 1]
            ];

            for (const sub of subscriptions) {
                await db.run(
                    `INSERT INTO subscriptions 
                    (name, display_name, description, price_monthly, tasks_limit, features, is_popular, is_active) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    sub
                );
            }
            console.log('✅ Тарифы подписок созданы');
        }

        // Виртуальные услуги
        const servicesExist = await db.get("SELECT 1 FROM services WHERE name = 'Подбор товаров онлайн'");
        if (!servicesExist) {
            const virtualServices = [
                ['shopping', 'Подбор товаров онлайн', 'Найдем лучшие варианты товаров по вашим критериям, сравним цены, поможем с заказом', '🛍️', 1, 1],
                ['delivery', 'Организация доставки', 'Подберем службу доставки, оформим заказ, отследим доставку', '🚚', 1, 2],
                ['events', 'Планирование мероприятий', 'Поможем спланировать праздник, подобрать локации, организовать онлайн-трансляцию', '🎉', 1, 3],
                ['beauty', 'Консультация по уходу', 'Подберем косметику, составим ритуалы ухода, найдем онлайн-специалистов', '💅', 1, 4],
                ['education', 'Подбор курсов', 'Найдем подходящие онлайн-курсы, поможем с записью, составим план обучения', '🎓', 1, 5],
                ['booking', 'Бронирование услуг', 'Забронируем столик в ресторане, запишем к специалисту, организуем онлайн-консультацию', '📅', 1, 6],
                ['research', 'Исследование и анализ', 'Проведем исследование по вашей теме, проанализируем информацию, подготовим отчет', '🔍', 1, 7]
            ];

            for (const service of virtualServices) {
                await db.run(
                    `INSERT INTO services 
                    (category, name, description, icon, is_active, sort_order) 
                    VALUES (?, ?, ?, ?, ?, ?)`,
                    service
                );
            }
            console.log('✅ Виртуальные услуги созданы');
        }

        // Тестовые пользователи
        const usersExist = await db.get("SELECT 1 FROM users WHERE phone = '+79991112233'");
        if (!usersExist) {
            const passwordHash = await bcrypt.hash('admin123', 12);
            const clientPasswordHash = await bcrypt.hash('client123', 12);
            const performerPasswordHash = await bcrypt.hash('performer123', 12);
            
            const expiryDate = new Date();
            expiryDate.setFullYear(expiryDate.getFullYear() + 1);
            const expiryDateStr = expiryDate.toISOString().split('T')[0];

            // Главный админ
            await db.run(
                `INSERT INTO users 
                (phone, first_name, last_name, password, role, 
                 subscription_plan, subscription_status, subscription_expires,
                 initial_fee_paid, initial_fee_amount, tasks_limit, balance,
                 phone_verified, privacy_accepted, agreement_accepted) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    '+79991112233', 'Админ', 'Главный', passwordHash, 'admin',
                    'premium', 'active', expiryDateStr,
                    1, 0, 999, 10000,
                    1, 1, 1
                ]
            );
            
            // Клиенты
            const clients = [
                ['+79992223344', 'Елена', 'Васильева', clientPasswordHash, 'client', 'premium', 'active', expiryDateStr, 1, 1000, 20, 5000, 1, 1, 1],
                ['+79993334455', 'Наталья', 'Федорова', clientPasswordHash, 'client', 'essential', 'active', expiryDateStr, 1, 500, 5, 2000, 1, 1, 1],
                ['+79994445566', 'Оксана', 'Николаева', clientPasswordHash, 'client', 'essential', 'pending', null, 0, 500, 5, 0, 1, 1, 1]
            ];
            
            for (const client of clients) {
                await db.run(
                    `INSERT INTO users 
                    (phone, first_name, last_name, password, role, 
                     subscription_plan, subscription_status, subscription_expires,
                     initial_fee_paid, initial_fee_amount, tasks_limit, balance,
                     phone_verified, privacy_accepted, agreement_accepted) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    client
                );
            }
            
            // Исполнители
            const performers = [
                ['+79995556677', 'Анна', 'Кузнецова', performerPasswordHash, 'performer'],
                ['+79996667788', 'Мария', 'Смирнова', performerPasswordHash, 'performer'],
                ['+79997778899', 'Ирина', 'Васильева', performerPasswordHash, 'performer']
            ];
            
            for (const performer of performers) {
                await db.run(
                    `INSERT INTO users 
                    (phone, first_name, last_name, password, role,
                     subscription_plan, subscription_status,
                     initial_fee_paid, tasks_limit, balance,
                     phone_verified, privacy_accepted, agreement_accepted) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        ...performer,
                        'essential', 'active',
                        1, 999, 0,
                        1, 1, 1
                    ]
                );
            }
            console.log('✅ Тестовые пользователи созданы');
        }

        console.log('🎉 Все начальные данные созданы!');
        
        console.log('\n🔑 ТЕСТОВЫЕ АККАУНТЫ:');
        console.log('='.repeat(60));
        console.log('👑 Главный админ: +79991112233 / admin123');
        console.log('👩 Клиент Премиум: +79992223344 / client123');
        console.log('👩 Клиент Эссеншл: +79993334455 / client123');
        console.log('👩 Клиент без оплаты: +79994445566 / client123');
        console.log('👩‍🏫 Исполнитель 1: +79995556677 / performer123');
        console.log('👩‍🏫 Исполнитель 2: +79996667788 / performer123');
        console.log('👩‍🏫 Исполнитель 3: +79997778899 / performer123');
        console.log('='.repeat(60));
        
    } catch (error) {
        console.error('⚠️ Ошибка создания начальных данных:', error.message);
    }
};

// ==================== ЮРИДИЧЕСКИЕ ТЕКСТЫ ====================
const legalTexts = {
    privacyPolicy: `
    ПОЛИТИКА КОНФИДЕНЦИАЛЬНОСТИ
    Женский Консьерж
    
    1. СБОР ИНФОРМАЦИИ
    Мы собираем следующую информацию:
    - Персональные данные: имя, фамилия, номер телефона
    - Данные подписки: выбранный тариф, срок действия
    - Данные задач: описание заказов, контактные данные
    - Финансовые данные: история платежей, баланс
    
    2. ИСПОЛЬЗОВАНИЕ ИНФОРМАЦИИ
    Ваши данные используются для:
    - Предоставления услуг консьерж-сервиса
    - Обработки платежей и управления подписками
    - Улучшения качества сервиса
    - Связи с вами по вопросам выполнения задач
    
    3. ХРАНЕНИЕ ДАННЫХ
    Данные хранятся на защищенных серверах в течение 5 лет с момента последней активности.
    
    4. ПЕРЕДАЧА ТРЕТЬИМ ЛИЦАМ
    Мы не передаем ваши персональные данные третьим лицам, за исключением:
    - Исполнителей задач (только необходимый минимум информации)
    - Платежных систем (для обработки транзакций)
    - По требованию законодательства РФ
    
    5. БЕЗОПАСНОСТЬ
    Мы используем SSL-шифрование для защиты данных при передаче.
    
    Дата вступления в силу: ${new Date().toLocaleDateString('ru-RU')}
    `,
    
    userAgreement: `
    ПОЛЬЗОВАТЕЛЬСКОЕ СОГЛАШЕНИЕ
    Женский Консьерж
    
    1. ОБЩИЕ ПОЛОЖЕНИЯ
    Сервис предоставляет виртуальные услуги консьерж-помощи для женщин.
    Все услуги оказываются удаленно, физического выезда не предусмотрено.
    
    2. УСЛУГИ
    2.1. Сервис включает:
    - Подбор товаров и услуг
    - Организация мероприятий онлайн
    - Консультации по различным вопросам
    - Помощь в решении бытовых задач удаленно
    
    2.2. Сервис НЕ включает:
    - Физический выезд специалистов
    - Выполнение работ, требующих личного присутствия
    - Медицинские и юридические консультации
    
    3. ПОДПИСКИ И ОПЛАТА
    3.1. Доступ к услугам предоставляется по подписке
    3.2. Ежемесячное списание происходит автоматически через SMS
    3.3. Для отмены подписки отправьте SMS с текстом "СТОП"
    
    4. ГАРАНТИИ
    4.1. Мы гарантируем конфиденциальность ваших данных
    4.2. Возврат средств возможен в течение 14 дней
    
    5. ОГРАНИЧЕНИЕ ОТВЕТСТВЕННОСТИ
    5.1. Мы не несем ответственность за:
    - Решения, принятые на основе наших рекомендаций
    - Качество услуг, оказанных третьими лицами
    `,
    
    consentForDataProcessing: `
    СОГЛАСИЕ НА ОБРАБОТКУ ПЕРСОНАЛЬНЫХ ДАННЫХ
    
    Я, [ФИО пользователя], даю согласие на обработку моих персональных данных:
    
    1. Цели обработки:
    - Оказание услуг консьерж-сервиса
    - Заключение и исполнение договора оказания услуг
    - Информирование о новых услугах
    
    2. Перечень данных:
    - Фамилия, имя
    - Номер телефона
    - Данные о подписках и платежах
    
    3. Срок действия:
    Согласие действует с момента регистрации до отзыва.
    
    4. Права:
    Я подтверждаю, что ознакомлен(а) со своими правами:
    - На доступ к данным
    - На уничтожение данных
    - На отзыв согласия
    
    Дата: ${new Date().toLocaleDateString('ru-RU')}
    `
};

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
const generateTaskNumber = () => {
    const now = new Date();
    const datePart = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}`;
    const randomPart = Math.random().toString(36).substr(2, 6).toUpperCase();
    return `TASK-${datePart}-${randomPart}`;
};

const validatePhone = (phone) => {
    const re = /^\+?[1-9]\d{10,14}$/;
    return re.test(phone.replace(/\D/g, ''));
};

// Генерация кода подтверждения
const generateVerificationCode = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

// ==================== АВТОМАТИЧЕСКОЕ СПИСАНИЕ ====================
const scheduleAutoPayments = () => {
    // Проверяем каждые 6 часов
    setInterval(async () => {
        try {
            const today = new Date().toISOString().split('T')[0];
            
            // Находим подписки, которые нужно продлить
            const subscriptionsToRenew = await db.all(`
                SELECT u.id, u.phone, u.first_name, u.subscription_plan, 
                       s.price_monthly, u.balance, u.auto_renewal
                FROM users u
                JOIN subscriptions s ON u.subscription_plan = s.name
                WHERE u.subscription_status = 'active'
                AND u.subscription_expires <= DATE('now', '+3 days')
                AND u.auto_renewal = 1
                AND u.is_active = 1
            `);
            
            for (const user of subscriptionsToRenew) {
                if (user.balance >= user.price_monthly) {
                    // Списание с баланса
                    await db.run(
                        'UPDATE users SET balance = balance - ?, subscription_expires = DATE("now", "+30 days") WHERE id = ?',
                        [user.price_monthly, user.id]
                    );
                    
                    // Запись платежа
                    await db.run(`
                        INSERT INTO payments (user_id, amount, description, status, payment_method)
                        VALUES (?, ?, ?, 'completed', 'auto')
                    `, [user.id, user.price_monthly, 'Автопродление подписки']);
                    
                    // Уведомление в системе
                    await db.run(`
                        INSERT INTO notifications (user_id, type, title, message)
                        VALUES (?, 'payment', 'Подписка продлена', ?)
                    `, [user.id, `Списано ${user.price_monthly}₽ за продление подписки`]);
                    
                    // SMS уведомление
                    if (user.sms_notifications) {
                        await sendSMS(user.phone, 
                            `Подписка продлена. Списано ${user.price_monthly}₽. Баланс: ${user.balance - user.price_monthly}₽`
                        );
                    }
                    
                    console.log(`✅ Автопродление для ${user.phone}: ${user.price_monthly}₽`);
                } else {
                    // Недостаточно средств
                    await db.run(
                        "UPDATE users SET subscription_status = 'suspended', grace_period_until = DATE('now', '+7 days') WHERE id = ?",
                        [user.id]
                    );
                    
                    // SMS о недостатке средств
                    await sendSMS(user.phone,
                        `Недостаточно средств для продления подписки. Пополните баланс на ${user.price_monthly}₽ в течение 7 дней.`
                    );
                    
                    console.log(`❌ Недостаточно средств для ${user.phone}`);
                }
            }
        } catch (error) {
            console.error('Ошибка автопродления:', error);
        }
    }, 6 * 60 * 60 * 1000); // Каждые 6 часов
};

// ==================== JWT МИДЛВАР ====================
const authMiddleware = (roles = []) => {
    return async (req, res, next) => {
        try {
            const authHeader = req.headers.authorization;
            
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).json({ 
                    success: false, 
                    error: 'Требуется авторизация' 
                });
            }
            
            const token = authHeader.replace('Bearer ', '').trim();
            
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'concierge-simple-2024');
                
                const user = await db.get(
                    `SELECT id, phone, first_name, last_name, role, 
                            subscription_plan, subscription_status, subscription_expires,
                            initial_fee_paid, balance, tasks_limit, tasks_used,
                            phone_verified, is_active
                     FROM users WHERE id = ? AND is_active = 1`,
                    [decoded.id]
                );
                
                if (!user) {
                    return res.status(401).json({ 
                        success: false, 
                        error: 'Пользователь не найден' 
                    });
                }
                
                req.user = user;
                
                if (roles.length > 0 && !roles.includes(user.role)) {
                    return res.status(403).json({ 
                        success: false, 
                        error: 'Недостаточно прав' 
                    });
                }
                
                next();
                
            } catch (jwtError) {
                return res.status(401).json({ 
                    success: false, 
                    error: 'Неверный токен' 
                });
            }
            
        } catch (error) {
            console.error('Ошибка authMiddleware:', error);
            return res.status(500).json({ 
                success: false, 
                error: 'Внутренняя ошибка сервера' 
            });
        }
    };
};

// ==================== API МАРШРУТЫ ====================

// Главная
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: '🌸 Женский Консьерж - Упрощенная версия',
        version: '1.0.0',
        status: '🟢 Работает',
        features: ['SMS регистрация', 'Виртуальные услуги', 'Автоплатежи', 'Внутренние чаты'],
        timestamp: new Date().toISOString()
    });
});

// Health check
app.get('/health', async (req, res) => {
    try {
        await db.get('SELECT 1 as status');
        res.json({
            success: true,
            status: 'OK',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Database error'
        });
    }
});

// ==================== ЮРИДИЧЕСКИЕ ТЕКСТЫ ====================
app.get('/api/legal/privacy', (req, res) => {
    res.json({
        success: true,
        data: { text: legalTexts.privacyPolicy }
    });
});

app.get('/api/legal/agreement', (req, res) => {
    res.json({
        success: true,
        data: { text: legalTexts.userAgreement }
    });
});

app.get('/api/legal/consent', (req, res) => {
    res.json({
        success: true,
        data: { text: legalTexts.consentForDataProcessing }
    });
});

// Принятие соглашений
app.post('/api/legal/accept', authMiddleware(), async (req, res) => {
    try {
        const { agreement_type } = req.body;
        
        if (!['privacy', 'agreement', 'consent'].includes(agreement_type)) {
            return res.status(400).json({
                success: false,
                error: 'Неверный тип соглашения'
            });
        }
        
        // Записываем принятие
        await db.run(
            `INSERT INTO agreements (user_id, agreement_type, version, accepted, accepted_at)
             VALUES (?, ?, '1.0', 1, CURRENT_TIMESTAMP)`,
            [req.user.id, agreement_type]
        );
        
        // Обновляем статус в профиле
        if (agreement_type === 'privacy') {
            await db.run('UPDATE users SET privacy_accepted = 1 WHERE id = ?', [req.user.id]);
        } else if (agreement_type === 'agreement') {
            await db.run('UPDATE users SET agreement_accepted = 1 WHERE id = ?', [req.user.id]);
        }
        
        res.json({
            success: true,
            message: 'Соглашение принято'
        });
    } catch (error) {
        console.error('Ошибка принятия соглашения:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка принятия соглашения'
        });
    }
});

// ==================== АУТЕНТИФИКАЦИЯ ====================

// Упрощенная регистрация через телефон
app.post('/api/auth/register-simple', async (req, res) => {
    try {
        const { phone, first_name, last_name, subscription_plan = 'essential' } = req.body;
        
        // Валидация
        if (!phone || !first_name || !last_name) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все поля'
            });
        }
        
        if (!validatePhone(phone)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный номер телефона'
            });
        }
        
        // Проверяем существующего пользователя
        const existingUser = await db.get('SELECT id FROM users WHERE phone = ?', [phone]);
        if (existingUser) {
            return res.status(409).json({
                success: false,
                error: 'Пользователь с таким телефоном уже существует'
            });
        }
        
        // Генерация временного пароля
        const tempPassword = Math.random().toString(36).slice(-6);
        const hashedPassword = await bcrypt.hash(tempPassword, 12);
        
        // Генерация кода подтверждения
        const verificationCode = generateVerificationCode();
        const codeExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 минут
        
        // Создание пользователя
        const result = await db.run(
            `INSERT INTO users 
            (phone, first_name, last_name, password, subscription_plan,
             verification_code, verification_code_expires) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [phone, first_name, last_name, hashedPassword, subscription_plan,
             verificationCode, codeExpires.toISOString()]
        );
        
        const userId = result.lastID;
        
        // Отправка SMS с паролем
        const smsResult = await sendSMS(phone, 
            `Женский Консьерж. Ваш пароль: ${tempPassword}. Код подтверждения: ${verificationCode}`
        );
        
        // Создаем JWT токен
        const token = jwt.sign(
            { 
                id: userId, 
                phone: phone,
                first_name: first_name,
                last_name: last_name
            },
            process.env.JWT_SECRET || 'concierge-simple-2024',
            { expiresIn: '30d' }
        );
        
        res.json({
            success: true,
            message: 'Регистрация успешна. Проверьте SMS.',
            data: { 
                user_id: userId,
                phone: phone,
                requires_verification: true,
                verification_code: process.env.NODE_ENV !== 'production' ? verificationCode : undefined,
                temp_password: process.env.NODE_ENV !== 'production' ? tempPassword : undefined,
                token
            }
        });
        
    } catch (error) {
        console.error('Ошибка регистрации:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка регистрации'
        });
    }
});

// Подтверждение телефона
app.post('/api/auth/verify-phone', async (req, res) => {
    try {
        const { phone, code } = req.body;
        
        if (!phone || !code) {
            return res.status(400).json({
                success: false,
                error: 'Введите номер телефона и код'
            });
        }
        
        const user = await db.get(
            'SELECT id, verification_code, verification_code_expires FROM users WHERE phone = ?',
            [phone]
        );
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        // Проверяем код и время
        if (user.verification_code !== code) {
            return res.status(400).json({
                success: false,
                error: 'Неверный код подтверждения'
            });
        }
        
        if (new Date(user.verification_code_expires) < new Date()) {
            return res.status(400).json({
                success: false,
                error: 'Код подтверждения истек'
            });
        }
        
        // Активируем пользователя
        await db.run(
            `UPDATE users SET 
                phone_verified = 1,
                verification_code = NULL,
                verification_code_expires = NULL
             WHERE id = ?`,
            [user.id]
        );
        
        // Создаем уведомление
        await db.run(
            `INSERT INTO notifications (user_id, type, title, message)
             VALUES (?, 'system', 'Телефон подтвержден', 'Ваш номер телефона успешно подтвержден.')`,
            [user.id]
        );
        
        res.json({
            success: true,
            message: 'Телефон успешно подтвержден'
        });
        
    } catch (error) {
        console.error('Ошибка подтверждения:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка подтверждения телефона'
        });
    }
});

// Вход через телефон
app.post('/api/auth/login-phone', async (req, res) => {
    try {
        const { phone, password } = req.body;
        
        if (!phone || !password) {
            return res.status(400).json({
                success: false,
                error: 'Введите телефон и пароль'
            });
        }
        
        const user = await db.get(
            `SELECT * FROM users WHERE phone = ? AND is_active = 1`,
            [phone]
        );
        
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Неверный телефон или пароль'
            });
        }
        
        // Проверяем пароль
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                error: 'Неверный телефон или пароль'
            });
        }
        
        // Проверяем, подтвержден ли телефон
        if (!user.phone_verified && user.role === 'client') {
            return res.status(403).json({
                success: false,
                error: 'Подтвердите номер телефона',
                requires_verification: true,
                phone: user.phone
            });
        }
        
        // Проверяем подписку для клиентов
        if (user.role === 'client' && user.subscription_status !== 'active') {
            return res.status(403).json({
                success: false,
                error: 'Активируйте подписку для начала работы',
                requires_subscription: true,
                subscription_plan: user.subscription_plan,
                initial_fee_amount: user.initial_fee_amount
            });
        }
        
        // Создаем токен
        const token = jwt.sign(
            { 
                id: user.id, 
                phone: user.phone,
                first_name: user.first_name,
                last_name: user.last_name,
                role: user.role
            },
            process.env.JWT_SECRET || 'concierge-simple-2024',
            { expiresIn: '30d' }
        );
        
        res.json({
            success: true,
            message: 'Вход выполнен',
            data: { 
                user: {
                    id: user.id,
                    phone: user.phone,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    role: user.role,
                    subscription_plan: user.subscription_plan,
                    subscription_status: user.subscription_status,
                    balance: user.balance,
                    tasks_limit: user.tasks_limit,
                    tasks_used: user.tasks_used
                },
                token 
            }
        });
        
    } catch (error) {
        console.error('Ошибка входа:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка входа'
        });
    }
});

// ==================== ПОДПИСКИ ====================

// Получение подписок
app.get('/api/subscriptions', async (req, res) => {
    try {
        const subscriptions = await db.all(
            'SELECT * FROM subscriptions WHERE is_active = 1 ORDER BY price_monthly ASC'
        );
        
        // Парсим features
        const subscriptionsWithFeatures = subscriptions.map(sub => ({
            ...sub,
            features: typeof sub.features === 'string' ? JSON.parse(sub.features) : sub.features
        }));
        
        res.json({
            success: true,
            data: { subscriptions: subscriptionsWithFeatures }
        });
        
    } catch (error) {
        console.error('Ошибка получения подписок:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения подписок'
        });
    }
});

// Оплата вступительного взноса через SMS
app.post('/api/subscriptions/pay-initial', authMiddleware(['client']), async (req, res) => {
    try {
        const { subscription_plan, payment_method = 'sms' } = req.body;
        
        // Получаем информацию о подписке
        const subscription = await db.get(
            'SELECT * FROM subscriptions WHERE name = ?',
            [subscription_plan]
        );
        
        if (!subscription) {
            return res.status(404).json({
                success: false,
                error: 'Тариф не найден'
            });
        }
        
        // Проверяем пользователя
        const user = await db.get(
            'SELECT phone, balance FROM users WHERE id = ?',
            [req.user.id]
        );
        
        // Для SMS оплаты
        if (payment_method === 'sms') {
            // Отправляем SMS для подтверждения
            const confirmCode = generateVerificationCode();
            
            // Сохраняем информацию о платеже
            const paymentId = `INIT-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
            
            await db.run(
                `INSERT INTO payments (user_id, amount, description, status, payment_method, payment_data)
                 VALUES (?, ?, ?, 'pending', 'sms', ?)`,
                [req.user.id, subscription.price_monthly, 
                 `Вступительный взнос ${subscription.display_name}`, 
                 JSON.stringify({ confirm_code: confirmCode, payment_id: paymentId })]
            );
            
            // Отправляем SMS
            await sendSMS(user.phone,
                `Для оплаты подписки ${subscription.display_name} отправьте SMS с текстом: ОПЛАТА ${confirmCode}`
            );
            
            res.json({
                success: true,
                message: 'Инструкция отправлена в SMS',
                data: {
                    payment_id: paymentId,
                    requires_sms_confirmation: true,
                    amount: subscription.price_monthly,
                    confirm_code: process.env.NODE_ENV !== 'production' ? confirmCode : undefined
                }
            });
        } else {
            // Другие методы оплаты
            res.status(400).json({
                success: false,
                error: 'Метод оплаты не поддерживается'
            });
        }
        
    } catch (error) {
        console.error('Ошибка оплаты:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка оплаты'
        });
    }
});

// Подтверждение SMS платежа
app.post('/api/payments/confirm-sms', authMiddleware(), async (req, res) => {
    try {
        const { payment_id, confirm_code } = req.body;
        
        // Находим платеж
        const payment = await db.get(
            `SELECT p.*, u.phone, u.subscription_plan
             FROM payments p
             JOIN users u ON p.user_id = u.id
             WHERE p.payment_data LIKE ? AND p.status = 'pending'`,
            [`%${payment_id}%`]
        );
        
        if (!payment) {
            return res.status(404).json({
                success: false,
                error: 'Платеж не найден'
            });
        }
        
        // Проверяем код
        const paymentData = JSON.parse(payment.payment_data);
        if (paymentData.confirm_code !== confirm_code) {
            return res.status(400).json({
                success: false,
                error: 'Неверный код подтверждения'
            });
        }
        
        // Получаем подписку
        const subscription = await db.get(
            'SELECT * FROM subscriptions WHERE name = ?',
            [paymentData.subscription_plan || 'essential']
        );
        
        // Активируем подписку
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 30);
        
        await db.run(
            `UPDATE users SET 
                subscription_status = 'active',
                subscription_expires = ?,
                initial_fee_paid = 1,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [expiryDate.toISOString().split('T')[0], req.user.id]
        );
        
        // Обновляем статус платежа
        await db.run(
            `UPDATE payments SET 
                status = 'completed',
                payment_data = ?
             WHERE id = ?`,
            [JSON.stringify({ ...paymentData, confirmed_at: new Date().toISOString() }), payment.id]
        );
        
        // Уведомление
        await db.run(
            `INSERT INTO notifications (user_id, type, title, message)
             VALUES (?, 'subscription', 'Подписка активирована', ?)`,
            [req.user.id, `Подписка "${subscription.display_name}" активирована на 30 дней`]
        );
        
        // SMS подтверждение
        await sendSMS(payment.phone,
            `Подписка "${subscription.display_name}" активирована! Стоимость: ${subscription.price_monthly}₽/мес.`
        );
        
        res.json({
            success: true,
            message: 'Платеж подтвержден, подписка активирована',
            data: {
                subscription_plan: subscription.name,
                expires: expiryDate.toISOString().split('T')[0]
            }
        });
        
    } catch (error) {
        console.error('Ошибка подтверждения платежа:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка подтверждения платежа'
        });
    }
});

// ==================== УСЛУГИ ====================

// Получение виртуальных услуг
app.get('/api/services', async (req, res) => {
    try {
        const services = await db.all(
            'SELECT * FROM services WHERE is_active = 1 ORDER BY sort_order ASC'
        );
        
        // Группируем по категориям
        const groupedServices = services.reduce((acc, service) => {
            if (!acc[service.category]) {
                acc[service.category] = [];
            }
            acc[service.category].push(service);
            return acc;
        }, {});
        
        res.json({
            success: true,
            data: {
                services: groupedServices,
                categories: Object.keys(groupedServices)
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения услуг:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения услуг'
        });
    }
});

// ==================== ЗАДАЧИ ====================

// Создание задачи
app.post('/api/tasks', authMiddleware(['client']), async (req, res) => {
    try {
        const { 
            title, 
            description, 
            service_id,
            deadline,
            contact_info 
        } = req.body;
        
        // Валидация
        if (!title || !description || !service_id) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все поля'
            });
        }
        
        // Проверяем подписку
        if (req.user.subscription_status !== 'active') {
            return res.status(403).json({
                success: false,
                error: 'Активируйте подписку для создания задач'
            });
        }
        
        // Проверяем лимит задач
        if (req.user.tasks_used >= req.user.tasks_limit) {
            return res.status(403).json({
                success: false,
                error: 'Лимит задач исчерпан',
                tasks_limit: req.user.tasks_limit,
                tasks_used: req.user.tasks_used
            });
        }
        
        // Проверяем услугу
        const service = await db.get(
            'SELECT * FROM services WHERE id = ? AND is_active = 1',
            [service_id]
        );
        
        if (!service) {
            return res.status(404).json({
                success: false,
                error: 'Услуга не найдена'
            });
        }
        
        // Создаем задачу
        const taskNumber = generateTaskNumber();
        const result = await db.run(
            `INSERT INTO tasks 
            (task_number, title, description, client_id, service_id, deadline, contact_info) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                taskNumber,
                title,
                description,
                req.user.id,
                service_id,
                deadline || null,
                contact_info || req.user.phone
            ]
        );
        
        const taskId = result.lastID;
        
        // Увеличиваем счетчик задач
        await db.run(
            'UPDATE users SET tasks_used = tasks_used + 1 WHERE id = ?',
            [req.user.id]
        );
        
        // Уведомление
        await db.run(
            `INSERT INTO notifications (user_id, type, title, message, related_id, related_type)
             VALUES (?, 'task', 'Задача создана', ?, ?, 'task')`,
            [req.user.id, `Задача "${title}" создана`, taskId]
        );
        
        // Находим исполнителей для этой категории услуг
        const performers = await db.all(
            `SELECT id, phone, first_name, last_name 
             FROM users 
             WHERE role = 'performer' AND is_active = 1`
        );
        
        // Уведомляем исполнителей
        for (const performer of performers) {
            await db.run(
                `INSERT INTO notifications (user_id, type, title, message, related_id, related_type)
                 VALUES (?, 'task', 'Новая задача', ?, ?, 'task')`,
                [performer.id, `Новая задача: "${title}"`, taskId]
            );
            
            // SMS исполнителям (если включены уведомления)
            await sendSMS(performer.phone,
                `Новая задача: "${title}". Проверьте приложение.`
            );
        }
        
        res.json({
            success: true,
            message: 'Задача создана',
            data: {
                task_id: taskId,
                task_number: taskNumber,
                tasks_used: req.user.tasks_used + 1,
                tasks_remaining: req.user.tasks_limit - (req.user.tasks_used + 1)
            }
        });
        
    } catch (error) {
        console.error('Ошибка создания задачи:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания задачи'
        });
    }
});

// Мои задачи
app.get('/api/tasks/my', authMiddleware(), async (req, res) => {
    try {
        let query = `
            SELECT t.*, s.name as service_name, s.icon as service_icon
            FROM tasks t
            LEFT JOIN services s ON t.service_id = s.id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (req.user.role === 'client') {
            query += ' AND t.client_id = ?';
            params.push(req.user.id);
        } else if (req.user.role === 'performer') {
            query += ' AND t.performer_id = ?';
            params.push(req.user.id);
        }
        
        query += ' ORDER BY t.created_at DESC';
        
        const tasks = await db.all(query, params);
        
        res.json({
            success: true,
            data: { tasks }
        });
        
    } catch (error) {
        console.error('Ошибка получения задач:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения задач'
        });
    }
});

// Доступные задачи для исполнителей
app.get('/api/tasks/available', authMiddleware(['performer']), async (req, res) => {
    try {
        const tasks = await db.all(`
            SELECT t.*, s.name as service_name, s.icon as service_icon,
                   u.first_name as client_first_name, u.last_name as client_last_name
            FROM tasks t
            LEFT JOIN services s ON t.service_id = s.id
            LEFT JOIN users u ON t.client_id = u.id
            WHERE t.status = 'new' OR t.status = 'searching'
            ORDER BY t.created_at DESC
        `);
        
        res.json({
            success: true,
            data: { tasks }
        });
        
    } catch (error) {
        console.error('Ошибка получения доступных задач:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения доступных задач'
        });
    }
});

// Принять задачу
app.post('/api/tasks/:id/take', authMiddleware(['performer']), async (req, res) => {
    try {
        const taskId = req.params.id;
        
        const task = await db.get(
            'SELECT * FROM tasks WHERE id = ?',
            [taskId]
        );
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        if (task.status !== 'new' && task.status !== 'searching') {
            return res.status(400).json({
                success: false,
                error: 'Задача уже назначена'
            });
        }
        
        // Назначаем задачу
        await db.run(
            `UPDATE tasks SET 
                performer_id = ?,
                status = 'assigned',
                updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [req.user.id, taskId]
        );
        
        // Уведомление клиенту
        await db.run(
            `INSERT INTO notifications (user_id, type, title, message, related_id, related_type)
             VALUES (?, 'task', 'Исполнитель назначен', ?, ?, 'task')`,
            [task.client_id, `Исполнитель назначен на задачу "${task.title}"`, taskId]
        );
        
        // SMS клиенту
        const client = await db.get('SELECT phone FROM users WHERE id = ?', [task.client_id]);
        await sendSMS(client.phone,
            `Исполнитель назначен на задачу "${task.title}". Свяжитесь в чате задачи.`
        );
        
        res.json({
            success: true,
            message: 'Задача принята'
        });
        
    } catch (error) {
        console.error('Ошибка принятия задачи:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка принятия задачи'
        });
    }
});

// ==================== ЧАТЫ ====================

// Сообщения задачи
app.get('/api/tasks/:id/messages', authMiddleware(), async (req, res) => {
    try {
        const taskId = req.params.id;
        
        // Проверяем доступ к задаче
        const task = await db.get(
            'SELECT client_id, performer_id FROM tasks WHERE id = ?',
            [taskId]
        );
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        const hasAccess = 
            req.user.role === 'admin' ||
            req.user.id === task.client_id ||
            req.user.id === task.performer_id;
        
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                error: 'Нет доступа к чату'
            });
        }
        
        const messages = await db.all(`
            SELECT tm.*, u.first_name, u.last_name
            FROM task_messages tm
            LEFT JOIN users u ON tm.user_id = u.id
            WHERE tm.task_id = ?
            ORDER BY tm.created_at ASC
        `, [taskId]);
        
        // Помечаем как прочитанные
        await db.run(
            'UPDATE task_messages SET is_read = 1 WHERE task_id = ? AND user_id != ?',
            [taskId, req.user.id]
        );
        
        res.json({
            success: true,
            data: { messages }
        });
        
    } catch (error) {
        console.error('Ошибка получения сообщений:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения сообщений'
        });
    }
});

// Отправить сообщение в задачу
app.post('/api/tasks/:id/messages', authMiddleware(), async (req, res) => {
    try {
        const taskId = req.params.id;
        const { message } = req.body;
        
        if (!message || message.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Сообщение не может быть пустым'
            });
        }
        
        // Проверяем доступ к задаче
        const task = await db.get(
            'SELECT id, client_id, performer_id, title FROM tasks WHERE id = ?',
            [taskId]
        );
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        const hasAccess = 
            req.user.role === 'admin' ||
            req.user.id === task.client_id ||
            req.user.id === task.performer_id;
        
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                error: 'Нет доступа к чату'
            });
        }
        
        // Отправляем сообщение
        const result = await db.run(
            `INSERT INTO task_messages (task_id, user_id, message)
             VALUES (?, ?, ?)`,
            [taskId, req.user.id, message.trim()]
        );
        
        // Определяем получателя
        let recipientId = null;
        if (req.user.id === task.client_id && task.performer_id) {
            recipientId = task.performer_id;
        } else if (req.user.id === task.performer_id) {
            recipientId = task.client_id;
        }
        
        // Уведомление получателю
        if (recipientId) {
            await db.run(
                `INSERT INTO notifications (user_id, type, title, message, related_id, related_type)
                 VALUES (?, 'message', 'Новое сообщение', ?, ?, 'task')`,
                [recipientId, `Новое сообщение в задаче "${task.title}"`, taskId]
            );
            
            // SMS уведомление
            const recipient = await db.get('SELECT phone FROM users WHERE id = ?', [recipientId]);
            await sendSMS(recipient.phone,
                `Новое сообщение в задаче "${task.title}". Проверьте приложение.`
            );
        }
        
        res.json({
            success: true,
            message: 'Сообщение отправлено'
        });
        
    } catch (error) {
        console.error('Ошибка отправки сообщения:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка отправки сообщения'
        });
    }
});

// Внутренние чаты (для исполнителей и админов)
app.get('/api/chats/internal', authMiddleware(['performer', 'admin']), async (req, res) => {
    try {
        const { with_user_id } = req.query;
        
        if (with_user_id) {
            // Получаем переписку с конкретным пользователем
            const messages = await db.all(`
                SELECT ic.*, u.first_name, u.last_name
                FROM internal_chats ic
                LEFT JOIN users u ON ic.sender_id = u.id
                WHERE (ic.sender_id = ? AND ic.receiver_id = ?)
                   OR (ic.sender_id = ? AND ic.receiver_id = ?)
                ORDER BY ic.created_at ASC
                LIMIT 100
            `, [req.user.id, with_user_id, with_user_id, req.user.id]);
            
            // Помечаем как прочитанные
            await db.run(
                'UPDATE internal_chats SET is_read = 1 WHERE receiver_id = ? AND sender_id = ?',
                [req.user.id, with_user_id]
            );
            
            res.json({
                success: true,
                data: { messages }
            });
        } else {
            // Список чатов
            const chats = await db.all(`
                SELECT DISTINCT
                    CASE 
                        WHEN ic.sender_id = ? THEN ic.receiver_id
                        ELSE ic.sender_id
                    END as partner_id,
                    u.first_name,
                    u.last_name,
                    u.phone,
                    MAX(ic.created_at) as last_message,
                    SUM(CASE WHEN ic.receiver_id = ? AND ic.is_read = 0 THEN 1 ELSE 0 END) as unread
                FROM internal_chats ic
                JOIN users u ON (u.id = CASE 
                    WHEN ic.sender_id = ? THEN ic.receiver_id
                    ELSE ic.sender_id
                END)
                WHERE ic.sender_id = ? OR ic.receiver_id = ?
                GROUP BY partner_id
                ORDER BY last_message DESC
            `, [req.user.id, req.user.id, req.user.id, req.user.id, req.user.id]);
            
            res.json({
                success: true,
                data: { chats }
            });
        }
        
    } catch (error) {
        console.error('Ошибка получения чатов:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения чатов'
        });
    }
});

// Отправить сообщение во внутренний чат
app.post('/api/chats/internal', authMiddleware(['performer', 'admin']), async (req, res) => {
    try {
        const { receiver_id, message } = req.body;
        
        if (!receiver_id || !message) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все поля'
            });
        }
        
        // Проверяем, что получатель - исполнитель или админ
        const receiver = await db.get(
            'SELECT id, role FROM users WHERE id = ? AND (role = "performer" OR role = "admin")',
            [receiver_id]
        );
        
        if (!receiver) {
            return res.status(404).json({
                success: false,
                error: 'Получатель не найден'
            });
        }
        
        // Отправляем сообщение
        await db.run(
            `INSERT INTO internal_chats (sender_id, receiver_id, message)
             VALUES (?, ?, ?)`,
            [req.user.id, receiver_id, message.trim()]
        );
        
        // Уведомление получателю
        const sender = await db.get(
            'SELECT first_name, last_name FROM users WHERE id = ?',
            [req.user.id]
        );
        
        await db.run(
            `INSERT INTO notifications (user_id, type, title, message)
             VALUES (?, 'message', 'Новое сообщение', ?)`,
            [receiver_id, `Новое сообщение от ${sender.first_name} ${sender.last_name}`]
        );
        
        res.json({
            success: true,
            message: 'Сообщение отправлено'
        });
        
    } catch (error) {
        console.error('Ошибка отправки сообщения:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка отправки сообщения'
        });
    }
});

// ==================== ПРОФИЛЬ ====================

// Получить профиль
app.get('/api/profile', authMiddleware(), async (req, res) => {
    try {
        const user = await db.get(`
            SELECT id, phone, first_name, last_name, email, role,
                   subscription_plan, subscription_status, subscription_expires,
                   balance, tasks_limit, tasks_used,
                   phone_verified, auto_renewal, sms_notifications,
                   privacy_accepted, agreement_accepted,
                   created_at
            FROM users WHERE id = ?
        `, [req.user.id]);
        
        // Статистика
        const stats = await db.get(`
            SELECT 
                COUNT(*) as total_tasks,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_tasks
            FROM tasks 
            WHERE client_id = ?
        `, [req.user.id]);
        
        res.json({
            success: true,
            data: {
                user,
                stats: stats || { total_tasks: 0, completed_tasks: 0 }
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения профиля:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения профиля'
        });
    }
});

// Обновить профиль
app.put('/api/profile', authMiddleware(), async (req, res) => {
    try {
        const { first_name, last_name, email, sms_notifications, auto_renewal } = req.body;
        
        const updates = [];
        const params = [];
        
        if (first_name !== undefined) {
            updates.push('first_name = ?');
            params.push(first_name);
        }
        
        if (last_name !== undefined) {
            updates.push('last_name = ?');
            params.push(last_name);
        }
        
        if (email !== undefined) {
            updates.push('email = ?');
            params.push(email);
        }
        
        if (sms_notifications !== undefined) {
            updates.push('sms_notifications = ?');
            params.push(sms_notifications ? 1 : 0);
        }
        
        if (auto_renewal !== undefined) {
            updates.push('auto_renewal = ?');
            params.push(auto_renewal ? 1 : 0);
        }
        
        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Нет данных для обновления'
            });
        }
        
        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push(req.user.id);
        
        const query = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
        
        await db.run(query, params);
        
        res.json({
            success: true,
            message: 'Профиль обновлен'
        });
        
    } catch (error) {
        console.error('Ошибка обновления профиля:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления профиля'
        });
    }
});

// ==================== УВЕДОМЛЕНИЯ ====================

app.get('/api/notifications', authMiddleware(), async (req, res) => {
    try {
        const notifications = await db.all(`
            SELECT * FROM notifications 
            WHERE user_id = ? 
            ORDER BY created_at DESC
            LIMIT 50
        `, [req.user.id]);
        
        // Помечаем как прочитанные
        await db.run(
            'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0',
            [req.user.id]
        );
        
        res.json({
            success: true,
            data: { notifications }
        });
        
    } catch (error) {
        console.error('Ошибка получения уведомлений:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения уведомлений'
        });
    }
});

// ==================== АДМИН ПАНЕЛЬ ====================

// Статистика
app.get('/api/admin/stats', authMiddleware(['admin']), async (req, res) => {
    try {
        const totalUsers = await db.get('SELECT COUNT(*) as count FROM users WHERE is_active = 1');
        const totalTasks = await db.get('SELECT COUNT(*) as count FROM tasks');
        const activeSubscriptions = await db.get('SELECT COUNT(*) as count FROM users WHERE subscription_status = "active"');
        const totalIncome = await db.get('SELECT SUM(amount) as total FROM payments WHERE status = "completed"');
        
        // Статистика по задачам
        const taskStats = await db.all(`
            SELECT status, COUNT(*) as count
            FROM tasks 
            GROUP BY status
        `);
        
        res.json({
            success: true,
            data: {
                total_users: totalUsers?.count || 0,
                total_tasks: totalTasks?.count || 0,
                active_subscriptions: activeSubscriptions?.count || 0,
                total_income: Math.abs(totalIncome?.total || 0),
                task_stats: taskStats
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения статистики:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статистики'
        });
    }
});

// Все пользователи
app.get('/api/admin/users', authMiddleware(['admin']), async (req, res) => {
    try {
        const users = await db.all(`
            SELECT id, phone, first_name, last_name, role,
                   subscription_plan, subscription_status, subscription_expires,
                   balance, tasks_used, tasks_limit,
                   phone_verified, is_active, created_at
            FROM users
            ORDER BY created_at DESC
        `);
        
        res.json({
            success: true,
            data: { users }
        });
        
    } catch (error) {
        console.error('Ошибка получения пользователей:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения пользователей'
        });
    }
});

// Все задачи
app.get('/api/admin/tasks', authMiddleware(['admin']), async (req, res) => {
    try {
        const tasks = await db.all(`
            SELECT t.*, 
                   s.name as service_name,
                   u1.first_name as client_first_name,
                   u1.last_name as client_last_name,
                   u2.first_name as performer_first_name,
                   u2.last_name as performer_last_name
            FROM tasks t
            LEFT JOIN services s ON t.service_id = s.id
            LEFT JOIN users u1 ON t.client_id = u1.id
            LEFT JOIN users u2 ON t.performer_id = u2.id
            ORDER BY t.created_at DESC
        `);
        
        res.json({
            success: true,
            data: { tasks }
        });
        
    } catch (error) {
        console.error('Ошибка получения задач:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения задач'
        });
    }
});

// ==================== ОБСЛУЖИВАНИЕ ====================

// Обработка 404
app.use('/api/*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'API маршрут не найден'
    });
});

// SPA маршрутизация
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Обработка ошибок
app.use((err, req, res, next) => {
    console.error('🔥 Ошибка сервера:', err.message);
    
    res.status(500).json({
        success: false,
        error: 'Внутренняя ошибка сервера'
    });
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎀 ЗАПУСК ЖЕНСКОГО КОНСЬЕРЖА (УПРОЩЕННАЯ ВЕРСИЯ)');
        console.log('='.repeat(80));
        
        // Инициализируем базу данных
        await initDatabase();
        
        // Запускаем автоматическое списание
        scheduleAutoPayments();
        
        const PORT = process.env.PORT || 3000;
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`✅ Сервер запущен на порту ${PORT}`);
            console.log(`🌐 http://localhost:${PORT}`);
            console.log('='.repeat(80));
            console.log('\n🔑 ТЕСТОВЫЕ АККАУНТЫ:');
            console.log('='.repeat(60));
            console.log('👑 Админ: +79991112233 / admin123');
            console.log('👩 Клиенты: +79992223344 / client123');
            console.log('👩‍🏫 Исполнители: +79995556677 / performer123');
            console.log('='.repeat(60));
            
            console.log('\n⚡ ОСНОВНЫЕ ФУНКЦИОНАЛЬНОСТИ:');
            console.log('='.repeat(60));
            console.log('✅ Упрощенная регистрация через телефон');
            console.log('✅ Автоматическое списание через SMS');
            console.log('✅ Виртуальные услуги (без выезда)');
            console.log('✅ Внутренние чаты для исполнителей');
            console.log('✅ Полная легализация (соглашения)');
            console.log('✅ Упрощенный интерфейс');
            console.log('✅ Автопродление подписок');
            console.log('✅ SMS-уведомления');
            console.log('='.repeat(60));
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        process.exit(1);
    }
};

// Запуск
startServer();
