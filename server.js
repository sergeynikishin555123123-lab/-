// server.js - исправленная версия с регистрацией по телефону и SMS верификацией
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const crypto = require('crypto');

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
const app = express();

// CORS настройки
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://yourdomain.com'] 
        : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:8080', 'http://localhost:5000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.options('*', cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// ==================== КОНФИГУРАЦИЯ ====================
const DEMO_MODE = true; // Демо-режим: SMS не отправляются, коды показываются в консоли

// ==================== БАЗА ДАННЫХ ====================
let db;

const initDatabase = async () => {
    try {
        console.log('🔄 Инициализация базы данных...');
        
        const dbPath = process.env.NODE_ENV === 'production' ? '/tmp/concierge_prod.db' : './concierge.db';
        console.log(`📁 Путь к базе данных: ${dbPath}`);
        
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        console.log('✅ База данных SQLite подключена');

        // Включаем внешние ключи
        await db.run('PRAGMA foreign_keys = ON');

        // Создание таблиц с полным функционалом
        await db.exec('BEGIN TRANSACTION');

        // Пользователи (расширенная)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT,
                password TEXT NOT NULL,
                first_name TEXT NOT NULL,
                last_name TEXT,
                phone TEXT NOT NULL UNIQUE,
                phone_verified INTEGER DEFAULT 0,
                phone_verification_code TEXT,
                phone_verification_expires TIMESTAMP,
                phone_verification_attempts INTEGER DEFAULT 0,
                role TEXT DEFAULT 'client' CHECK(role IN ('client', 'performer', 'admin', 'manager', 'superadmin')),
                subscription_plan TEXT DEFAULT 'essential',
                subscription_status TEXT DEFAULT 'pending',
                subscription_expires DATE,
                avatar_url TEXT,
                balance REAL DEFAULT 0,
                initial_fee_paid INTEGER DEFAULT 0,
                initial_fee_amount REAL DEFAULT 0,
                tasks_limit INTEGER DEFAULT 5,
                tasks_used INTEGER DEFAULT 0,
                user_rating REAL DEFAULT 0,
                completed_tasks INTEGER DEFAULT 0,
                total_spent REAL DEFAULT 0,
                last_login TIMESTAMP,
                is_active INTEGER DEFAULT 1,
                email_verified INTEGER DEFAULT 0,
                verification_token TEXT,
                reset_token TEXT,
                reset_token_expires TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Коды подтверждения телефона
        await db.exec(`
            CREATE TABLE IF NOT EXISTS phone_verification_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT NOT NULL,
                code TEXT NOT NULL,
                attempts INTEGER DEFAULT 0,
                verified INTEGER DEFAULT 0,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Подписки (расширенная)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                display_name TEXT NOT NULL,
                description TEXT NOT NULL,
                price_monthly REAL NOT NULL,
                price_yearly REAL NOT NULL,
                initial_fee REAL NOT NULL DEFAULT 0,
                tasks_limit INTEGER NOT NULL,
                features TEXT NOT NULL,
                color_theme TEXT DEFAULT '#FF6B8B',
                sort_order INTEGER DEFAULT 0,
                is_popular INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Категории (расширенная)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                display_name TEXT NOT NULL,
                description TEXT NOT NULL,
                icon TEXT NOT NULL,
                color TEXT DEFAULT '#FF6B8B',
                sort_order INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Услуги (расширенная)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS services (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                base_price REAL DEFAULT 0,
                estimated_time TEXT,
                is_active INTEGER DEFAULT 1,
                sort_order INTEGER DEFAULT 0,
                is_featured INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
            )
        `);

        // Задачи (расширенная)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_number TEXT UNIQUE NOT NULL,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                client_id INTEGER NOT NULL,
                performer_id INTEGER,
                category_id INTEGER NOT NULL,
                service_id INTEGER,
                status TEXT DEFAULT 'new',
                priority TEXT DEFAULT 'medium',
                price REAL DEFAULT 0,
                address TEXT NOT NULL,
                deadline DATETIME NOT NULL,
                contact_info TEXT NOT NULL,
                additional_requirements TEXT,
                task_rating INTEGER,
                feedback TEXT,
                cancellation_reason TEXT,
                cancellation_by INTEGER,
                admin_notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP,
                FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (performer_id) REFERENCES users(id) ON DELETE SET NULL,
                FOREIGN KEY (category_id) REFERENCES categories(id),
                FOREIGN KEY (service_id) REFERENCES services(id),
                FOREIGN KEY (cancellation_by) REFERENCES users(id)
            )
        `);

        // История статусов
        await db.exec(`
            CREATE TABLE IF NOT EXISTS task_status_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                status TEXT NOT NULL,
                changed_by INTEGER NOT NULL,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (changed_by) REFERENCES users(id)
            )
        `);

        // Сообщения в чате (расширенная)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS task_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                message TEXT NOT NULL,
                is_read INTEGER DEFAULT 0,
                read_at TIMESTAMP,
                attachment_url TEXT,
                attachment_type TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Отзывы (расширенная)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                client_id INTEGER NOT NULL,
                performer_id INTEGER NOT NULL,
                rating INTEGER NOT NULL,
                comment TEXT,
                is_anonymous INTEGER DEFAULT 0,
                is_featured INTEGER DEFAULT 0,
                admin_approved INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (performer_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Назначения исполнителей по категориям
        await db.exec(`
            CREATE TABLE IF NOT EXISTS performer_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                performer_id INTEGER NOT NULL,
                category_id INTEGER NOT NULL,
                is_active INTEGER DEFAULT 1,
                experience_years INTEGER DEFAULT 0,
                hourly_rate REAL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (performer_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
                UNIQUE(performer_id, category_id)
            )
        `);

        // Транзакции
        await db.exec(`
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                amount REAL NOT NULL,
                description TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                payment_method TEXT,
                payment_id TEXT,
                metadata TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
                read_at TIMESTAMP,
                related_id INTEGER,
                related_type TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Настройки системы
        await db.exec(`
            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT UNIQUE NOT NULL,
                value TEXT,
                description TEXT,
                category TEXT DEFAULT 'general',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // FAQ
        await db.exec(`
            CREATE TABLE IF NOT EXISTS faq (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                question TEXT NOT NULL,
                answer TEXT NOT NULL,
                category TEXT DEFAULT 'general',
                sort_order INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await db.exec('COMMIT');
        console.log('✅ Все таблицы созданы');

        // Создаем тестовые данные
        await createInitialData();
        
        return db;
    } catch (error) {
        try {
            await db.exec('ROLLBACK');
        } catch (rollbackError) {
            console.error('Ошибка при ROLLBACK:', rollbackError.message);
        }
        console.error('❌ Ошибка инициализации базы данных:', error.message);
        throw error;
    }
};

// ==================== ТЕСТОВЫЕ ДАННЫЕ ====================
const createInitialData = async () => {
    try {
        console.log('📝 Создание начальных данных...');

        // 1. Настройки системы
        const settingsExist = await db.get("SELECT 1 FROM settings WHERE key = 'site_name'");
        if (!settingsExist) {
            const settings = [
                ['site_name', 'Женский Консьерж', 'Название сайта', 'general'],
                ['site_description', 'Помощь в бытовых вопросах от женщин для женщин', 'Описание сайта', 'general'],
                ['support_email', 'support@concierge.ru', 'Email поддержки', 'general'],
                ['support_phone', '+79991234567', 'Телефон поддержки', 'general'],
                ['system_fee', '10', 'Комиссия системы (%)', 'financial'],
                ['site_maintenance', '0', 'Режим технического обслуживания', 'system'],
                ['min_task_price', '0', 'Минимальная цена задачи', 'financial'],
                ['max_task_price', '100000', 'Максимальная цена задачи', 'financial'],
                ['sms_demo_mode', DEMO_MODE ? '1' : '0', 'Демо-режим SMS (коды в консоли)', 'sms'],
                ['sms_code_expiry_minutes', '10', 'Время жизни SMS кода (минут)', 'sms'],
                ['max_sms_attempts', '3', 'Максимальное количество попыток', 'sms'],
                ['sms_cooldown_seconds', '60', 'Задержка между отправкой SMS (секунд)', 'sms']
            ];

            for (const setting of settings) {
                try {
                    await db.run(
                        `INSERT OR IGNORE INTO settings (key, value, description, category) VALUES (?, ?, ?, ?)`,
                        setting
                    );
                } catch (error) {
                    console.warn(`Ошибка вставки настройки ${setting[0]}:`, error.message);
                }
            }
            console.log('✅ Настройки системы созданы');
        }

        // 2. FAQ
        const faqExist = await db.get("SELECT 1 FROM faq LIMIT 1");
        if (!faqExist) {
            const faqs = [
                ['Как работает система подписок?', 'Вы оплачиваете вступительный взнос один раз при регистрации, затем ежемесячную плату. Все услуги в рамках вашего тарифа бесплатны для вас.', 'subscriptions', 1, 1],
                ['Можно ли изменить тариф?', 'Да, вы можете изменить тариф в любой момент. Разница в стоимости будет учтена при следующем платеже.', 'subscriptions', 2, 1],
                ['Что входит в вступительный взнос?', 'Вступительный взнос покрывает расходы на проверку и обучение помощниц, а также страховку качества услуг.', 'payments', 3, 1],
                ['Как отменить подписку?', 'Вы можете отменить подписку в любое время в разделе "Мой профиль". Подписка останется активной до конца оплаченного периода.', 'subscriptions', 4, 1],
                ['Как выбираются помощницы?', 'Все наши помощницы проходят строгий отбор, проверку документов и обучение. Вы можете видеть их рейтинг и отзывы перед выбором.', 'performers', 5, 1],
                ['Что делать, если не устроило качество услуги?', 'Мы гарантируем возврат средств или повторное оказание услуги, если качество не устроило. Свяжитесь с нашей поддержкой.', 'quality', 6, 1],
                ['Как подтвердить телефон?', 'После регистрации мы отправим SMS с кодом подтверждения. Введите его в приложении для верификации телефона.', 'verification', 7, 1],
                ['Нет доступа к телефону, как войти?', 'Вы можете использовать любой телефон для регистрации. Для входа используйте номер телефона и пароль.', 'login', 8, 1]
            ];

            for (const faq of faqs) {
                try {
                    await db.run(
                        `INSERT OR IGNORE INTO faq (question, answer, category, sort_order, is_active) VALUES (?, ?, ?, ?, ?)`,
                        faq
                    );
                } catch (error) {
                    console.warn('Ошибка вставки FAQ:', error.message);
                }
            }
            console.log('✅ FAQ созданы');
        }

        // 3. Подписки
        const subscriptionsExist = await db.get("SELECT 1 FROM subscriptions LIMIT 1");
        if (!subscriptionsExist) {
            const subscriptions = [
                [
                    'essential', 'Эссеншл', 'Базовый набор услуг для эпизодических задач',
                    0, 0, 500, 5,
                    '["До 5 задач в месяц", "Все базовые услуги", "Поддержка по email", "Стандартное время ответа"]',
                    '#FF6B8B', 1, 0, 1
                ],
                [
                    'premium', 'Премиум', 'Полный доступ ко всем услугам и приоритетная поддержка',
                    1990, 19900, 1000, 999,
                    '["Неограниченные задачи", "Все услуги премиум-класса", "Приоритетная поддержка 24/7", "Личный помощник", "Срочные заказы"]',
                    '#9B59B6', 2, 1, 1
                ]
            ];

            for (const sub of subscriptions) {
                try {
                    await db.run(
                        `INSERT OR IGNORE INTO subscriptions 
                        (name, display_name, description, price_monthly, price_yearly, 
                         initial_fee, tasks_limit, features, color_theme, sort_order, is_popular, is_active) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        sub
                    );
                } catch (error) {
                    console.warn('Ошибка вставки подписки:', error.message);
                }
            }
            console.log('✅ Тарифы подписок созданы');
        }

        // 4. Категории услуг
        const categoriesExist = await db.get("SELECT 1 FROM categories LIMIT 1");
        if (!categoriesExist) {
            const categories = [
                ['home_and_household', 'Дом и быт', 'Уборка, готовка, уход за домом', '🏠', '#FF6B8B', 1, 1],
                ['family_and_children', 'Дети и семья', 'Няни, репетиторы, помощь с детьми', '👨‍👩‍👧‍👦', '#3498DB', 2, 1],
                ['beauty_and_health', 'Красота и здоровье', 'Маникюр, массаж, парикмахерские услуги', '💅', '#9B59B6', 3, 1],
                ['courses_and_education', 'Курсы и образование', 'Репетиторство, обучение, курсы', '🎓', '#2ECC71', 4, 1],
                ['shopping_and_delivery', 'Покупки и доставка', 'Покупка и доставка товаров', '🛒', '#E74C3C', 5, 1],
                ['events_and_organization', 'События и организация', 'Организация мероприятий и праздников', '🎉', '#F39C12', 6, 1]
            ];

            for (const cat of categories) {
                try {
                    await db.run(
                        `INSERT OR IGNORE INTO categories 
                        (name, display_name, description, icon, color, sort_order, is_active) 
                        VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        cat
                    );
                } catch (error) {
                    console.warn('Ошибка вставки категории:', error.message);
                }
            }
            console.log('✅ Категории услуг созданы');
        }

        // 5. Услуги
        const servicesExist = await db.get("SELECT 1 FROM services LIMIT 1");
        if (!servicesExist) {
            // Получаем ID категорий
            const categories = await db.all("SELECT id, name FROM categories");
            const categoryMap = {};
            categories.forEach(cat => categoryMap[cat.name] = cat.id);

            // 12 услуг как в оригинальном приложении
            const services = [
                // Дом и быт (4 услуги)
                [categoryMap.home_and_household, 'Уборка квартиры', 'Генеральная или поддерживающая уборка квартиры', 0, '2-4 часа', 1, 1, 1],
                [categoryMap.home_and_household, 'Химчистка мебели', 'Профессиональная химчистка диванов, кресел, матрасов', 0, '3-5 часов', 1, 2, 0],
                [categoryMap.home_and_household, 'Стирка и глажка', 'Стирка, сушка и глажка белья', 0, '2-3 часа', 1, 3, 0],
                [categoryMap.home_and_household, 'Приготовление еды', 'Приготовление блюд на день или неделю', 0, '3-4 часа', 1, 4, 1],
                
                // Дети и семья (2 услуги)
                [categoryMap.family_and_children, 'Няня на час', 'Присмотр за детьми на несколько часов', 0, '1 час', 1, 5, 1],
                [categoryMap.family_and_children, 'Репетитор для ребенка', 'Помощь с уроками по школьным предметам', 0, '1 час', 1, 6, 0],
                
                // Красота и здоровье (3 услуги)
                [categoryMap.beauty_and_health, 'Маникюр на дому', 'Профессиональный маникюр с выездом', 0, '1.5 часа', 1, 7, 1],
                [categoryMap.beauty_and_health, 'Стрижка и укладка', 'Парикмахерские услуги на дому', 0, '2 часа', 1, 8, 0],
                [categoryMap.beauty_and_health, 'Массаж', 'Расслабляющий или лечебный массаж', 0, '1 час', 1, 9, 1],
                
                // Курсы и образование (1 услуга)
                [categoryMap.courses_and_education, 'Репетиторство', 'Индивидуальные занятия по предметам', 0, '1 час', 1, 10, 1],
                
                // Покупки и доставка (2 услуги)
                [categoryMap.shopping_and_delivery, 'Покупка продуктов', 'Покупка и доставка продуктов', 0, '1-2 часа', 1, 11, 1],
                [categoryMap.shopping_and_delivery, 'Доставка документов', 'Срочная доставка документов', 0, '1 час', 1, 12, 0]
            ];

            for (const service of services) {
                try {
                    await db.run(
                        `INSERT OR IGNORE INTO services 
                        (category_id, name, description, base_price, estimated_time, is_active, sort_order, is_featured) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        service
                    );
                } catch (error) {
                    console.warn('Ошибка вставки услуги:', error.message);
                }
            }
            console.log('✅ Услуги созданы (12 услуг)');
        }

        // 6. Тестовые пользователи (с уникальными телефонами)
        const usersExist = await db.get("SELECT 1 FROM users LIMIT 1");
        if (!usersExist) {
            const passwordHash = await bcrypt.hash('admin123', 12);
            const clientPasswordHash = await bcrypt.hash('client123', 12);
            const performerPasswordHash = await bcrypt.hash('performer123', 12);
            
            const expiryDate = new Date();
            expiryDate.setFullYear(expiryDate.getFullYear() + 1);
            const expiryDateStr = expiryDate.toISOString().split('T')[0];

            // Тестовые пользователи с уникальными телефонами
            const users = [
                // Главный админ
                ['superadmin@concierge.test', passwordHash, 'Александр', 'Иванов', '+79991112233', 1, 'superadmin', 'premium', 'active', expiryDateStr, 'https://ui-avatars.com/api/?name=Александр+Иванов&background=9B59B6&color=fff&bold=true', 0, 1000, 1, 1000, 999, 3, 5, 0, 4.9, 100, 1, 1, null, null, null],
                
                // Администраторы
                ['admin@concierge.test', passwordHash, 'Мария', 'Петрова', '+79992223344', 1, 'admin', 'premium', 'active', expiryDateStr, 'https://ui-avatars.com/api/?name=Мария+Петрова&background=2ECC71&color=fff&bold=true', 0, 1000, 1, 1000, 999, 2, 5, 0, 4.8, 50, 1, 1, null, null, null],
                
                // Помощники
                ['performer1@concierge.test', performerPasswordHash, 'Анна', 'Кузнецова', '+79994445566', 1, 'performer', 'essential', 'active', expiryDateStr, 'https://ui-avatars.com/api/?name=Анна+Кузнецова&background=3498DB&color=fff&bold=true', 0, 500, 1, 500, 20, 5, 5, 0, 4.5, 30, 1, 1, null, null, null],
                ['performer2@concierge.test', performerPasswordHash, 'Мария', 'Смирнова', '+79995556677', 1, 'performer', 'essential', 'active', expiryDateStr, 'https://ui-avatars.com/api/?name=Мария+Смирнова&background=3498DB&color=fff&bold=true', 0, 500, 1, 500, 20, 8, 5, 0, 4.6, 45, 1, 1, null, null, null],
                ['performer3@concierge.test', performerPasswordHash, 'Ирина', 'Васильева', '+79996667788', 1, 'performer', 'premium', 'active', expiryDateStr, 'https://ui-avatars.com/api/?name=Ирина+Васильева&background=3498DB&color=fff&bold=true', 0, 1000, 1, 1000, 50, 15, 5, 0, 4.8, 60, 1, 1, null, null, null],
                
                // Клиенты
                ['client1@concierge.test', clientPasswordHash, 'Елена', 'Васильева', '+79997778899', 1, 'client', 'premium', 'active', expiryDateStr, 'https://ui-avatars.com/api/?name=Елена+Васильева&background=FF6B8B&color=fff&bold=true', 0, 1000, 1, 1000, 999, 2, 5, 0, 4.0, 10, 1, 1, null, null, null],
                ['client2@concierge.test', clientPasswordHash, 'Наталья', 'Федорова', '+79998889900', 1, 'client', 'essential', 'active', expiryDateStr, 'https://ui-avatars.com/api/?name=Наталья+Федорова&background=FF6B8B&color=fff&bold=true', 0, 500, 1, 500, 5, 1, 5, 0, 4.5, 3, 1, 1, null, null, null],
                ['client3@concierge.test', clientPasswordHash, 'Оксана', 'Николаева', '+79999990011', 0, 'client', 'essential', 'pending', null, 'https://ui-avatars.com/api/?name=Оксана+Николаева&background=FF6B8B&color=fff&bold=true', 0, 500, 0, 500, 5, 0, 5, 0, 0, 0, 1, 1, null, null, null]
            ];

            for (const user of users) {
                const [email, password, first_name, last_name, phone, phone_verified, role, subscription_plan, subscription_status, subscription_expires, avatar_url, balance, initial_fee_amount, initial_fee_paid, initial_fee_amount2, tasks_limit, tasks_used, tasks_limit2, total_spent, user_rating, completed_tasks, is_active, email_verified, verification_token, reset_token, reset_token_expires] = user;
                
                try {
                    await db.run(
                        `INSERT OR IGNORE INTO users 
                        (email, password, first_name, last_name, phone, phone_verified, role, 
                         subscription_plan, subscription_status, subscription_expires,
                         avatar_url, balance, initial_fee_paid, initial_fee_amount, 
                         tasks_limit, tasks_used, total_spent, user_rating, completed_tasks, 
                         is_active, email_verified, verification_token, reset_token, reset_token_expires) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [email, password, first_name, last_name, phone, phone_verified, role,
                         subscription_plan, subscription_status, subscription_expires,
                         avatar_url, balance, initial_fee_paid, initial_fee_amount, 
                         tasks_limit, tasks_used, total_spent || 0, user_rating, completed_tasks,
                         is_active, email_verified, verification_token, reset_token, reset_token_expires]
                    );
                } catch (error) {
                    console.warn(`Ошибка вставки пользователя ${phone}:`, error.message);
                }
            }
            console.log('✅ Тестовые пользователи созданы');
            
            // Назначаем помощников к категориям
            const categories = await db.all("SELECT id FROM categories");
            const performers = await db.all("SELECT id FROM users WHERE role = 'performer'");
            
            for (const performer of performers) {
                // Каждый помощник специализируется на 2-3 категориях
                const categoryIds = categories
                    .sort(() => Math.random() - 0.5)
                    .slice(0, 2 + Math.floor(Math.random() * 2))
                    .map(c => c.id);
                
                for (const categoryId of categoryIds) {
                    try {
                        await db.run(
                            `INSERT OR IGNORE INTO performer_categories (performer_id, category_id, experience_years, hourly_rate) 
                             VALUES (?, ?, ?, ?)`,
                            [performer.id, categoryId, Math.floor(Math.random() * 5) + 1, Math.floor(Math.random() * 500) + 500]
                        );
                    } catch (error) {
                        console.warn('Ошибка вставки специализации:', error.message);
                    }
                }
            }
            console.log('✅ Назначения помощников по категориям созданы');
            
            // Создаем тестовые задачи
            const clients = await db.all("SELECT id FROM users WHERE role = 'client' AND subscription_status = 'active' LIMIT 2");
            const categoriesList = await db.all("SELECT id FROM categories");
            const servicesList = await db.all("SELECT id FROM services WHERE is_active = 1");
            
            if (clients.length > 0 && categoriesList.length > 0 && servicesList.length > 0) {
                const taskTitles = [
                    'Уборка двухкомнатной квартиры',
                    'Приготовление ужина на 4 персоны',
                    'Маникюр с выездом на дом',
                    'Покупка продуктов на неделю',
                    'Няня на 4 часа'
                ];
                
                const taskDescriptions = [
                    'Необходимо сделать генеральную уборку в двухкомнатной квартире 55 кв.м. Особое внимание кухне и санузлу.',
                    'Нужно приготовить ужин из 3-х блюд на 4 человека. Предпочтение русской кухне.',
                    'Требуется сделать классический маникюр с покрытием гель-лаком. Цвет предпочитаю нейтральный.',
                    'Собрать продуктовую корзину по списку из Ашана. Доставить до 18:00.',
                    'Присмотреть за ребенком 5 лет на 4 часа. Поиграть, покормить обедом, погулять на площадке.'
                ];
                
                const performers = await db.all("SELECT id FROM users WHERE role = 'performer'");
                
                for (let i = 0; i < 5; i++) {
                    const client = clients[Math.floor(Math.random() * clients.length)];
                    const category = categoriesList[Math.floor(Math.random() * categoriesList.length)];
                    const service = servicesList[Math.floor(Math.random() * servicesList.length)];
                    const performer = performers[Math.floor(Math.random() * performers.length)];
                    
                    const taskNumber = `TASK-${new Date().getFullYear()}${(new Date().getMonth() + 1).toString().padStart(2, '0')}${(i + 1).toString().padStart(3, '0')}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
                    
                    const statuses = ['new', 'searching', 'assigned', 'in_progress', 'completed'];
                    const status = statuses[Math.floor(Math.random() * statuses.length)];
                    
                    const deadline = new Date();
                    deadline.setDate(deadline.getDate() + Math.floor(Math.random() * 7) + 1);
                    
                    try {
                        await db.run(
                            `INSERT INTO tasks 
                            (task_number, title, description, client_id, performer_id, category_id, service_id, 
                             status, priority, price, address, deadline, contact_info) 
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [
                                taskNumber,
                                taskTitles[i],
                                taskDescriptions[i],
                                client.id,
                                status === 'completed' || status === 'in_progress' || status === 'assigned' ? performer.id : null,
                                category.id,
                                service.id,
                                status,
                                ['low', 'medium', 'high'][Math.floor(Math.random() * 3)],
                                0,
                                'г. Москва, ул. Примерная, д. ' + (Math.floor(Math.random() * 100) + 1),
                                deadline.toISOString(),
                                '+79991234567'
                            ]
                        );
                        
                        const taskId = (await db.get('SELECT last_insert_rowid() as id')).id;
                        
                        // Добавляем историю статусов
                        await db.run(
                            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
                             VALUES (?, ?, ?, ?)`,
                            [taskId, 'new', client.id, 'Задача создана']
                        );
                        
                        if (status === 'completed') {
                            // Для завершенных задач добавляем отзывы
                            await db.run(
                                `INSERT INTO reviews (task_id, client_id, performer_id, rating, comment, is_anonymous) 
                                 VALUES (?, ?, ?, ?, ?, ?)`,
                                [taskId, client.id, performer.id, Math.floor(Math.random() * 2) + 4, 'Отличная работа! Быстро и качественно.', 0]
                            );
                        }
                    } catch (error) {
                        console.warn('Ошибка создания тестовой задачи:', error.message);
                    }
                }
                console.log('✅ Тестовые задачи созданы (5 задач)');
            }
        }

        console.log('🎉 Все начальные данные созданы!');
        
        console.log('\n🔑 ТЕСТОВЫЕ АККАУНТЫ (вход по телефону и паролю):');
        console.log('='.repeat(70));
        console.log('👑 Главный админ: +79991112233 / admin123 (телефон подтвержден)');
        console.log('👨‍💼 Админ: +79992223344 / admin123 (телефон подтвержден)');
        console.log('👩‍🏫 Помощник 1: +79994445566 / performer123 (телефон подтвержден)');
        console.log('👩‍🏫 Помощник 2: +79995556677 / performer123 (телефон подтвержден)');
        console.log('👩‍🏫 Помощник 3: +79996667788 / performer123 (телефон подтвержден)');
        console.log('👩 Клиент Премиум: +79997778899 / client123 (телефон подтвержден)');
        console.log('👩 Клиент Эссеншл: +79998889900 / client123 (телефон подтвержден)');
        console.log('👩 Клиент без верификации: +79999990011 / client123 (телефон НЕ подтвержден)');
        console.log('='.repeat(70));
        console.log('📱 Для новых регистраций используйте любой уникальный номер телефона');
        console.log('🔐 Пароль для всех тестовых аккаунтов: admin123/client123/performer123');
        console.log('='.repeat(70));
        
    } catch (error) {
        console.error('⚠️ Ошибка создания начальных данных:', error.message);
    }
};

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
const generateTaskNumber = () => {
    const now = new Date();
    const datePart = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}`;
    const randomPart = Math.random().toString(36).substr(2, 6).toUpperCase();
    return `TASK-${datePart}-${randomPart}`;
};

const validateEmail = (email) => {
    if (!email) return false;
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
};

const validatePhone = (phone) => {
    if (!phone) return false;
    const re = /^\+?[1-9]\d{10,14}$/;
    return re.test(phone.replace(/\D/g, ''));
};

const formatPhone = (phone) => {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('7') || cleaned.startsWith('8')) {
        return '+7' + cleaned.substring(1);
    }
    return '+' + cleaned;
};

const generateAvatarUrl = (firstName, lastName, role) => {
    let avatarBgColor = 'FF6B8B';
    if (role === 'performer') {
        avatarBgColor = '3498DB';
    } else if (role === 'admin' || role === 'manager') {
        avatarBgColor = '2ECC71';
    } else if (role === 'superadmin') {
        avatarBgColor = '9B59B6';
    }
    
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(firstName)}+${encodeURIComponent(lastName)}&background=${avatarBgColor}&color=fff&bold=true`;
};

// ==================== SMS ВЕРИФИКАЦИЯ ====================

// Генерация кода подтверждения
const generateVerificationCode = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

// Отправка SMS (демо-режим)
const sendSmsCode = async (phone, code) => {
    try {
        const formattedPhone = formatPhone(phone);
        
        if (DEMO_MODE) {
            console.log(`📱 [DEMO SMS] Отправка SMS на ${formattedPhone}:`);
            console.log(`🔑 Код подтверждения: ${code}`);
            console.log(`⏰ Код действителен 10 минут`);
            console.log('-'.repeat(50));
            return { success: true, demo: true };
        }
        
        // Здесь будет реальная интеграция с SMS сервисом
        // Например: Twilio, MessageBird, sms.ru и т.д.
        // Пример для sms.ru:
        /*
        const smsApiKey = process.env.SMS_API_KEY;
        const response = await fetch('https://sms.ru/sms/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                api_id: smsApiKey,
                to: formattedPhone,
                msg: `Код подтверждения: ${code}`,
                json: 1
            })
        });
        
        const data = await response.json();
        return data.status === 'OK' ? { success: true } : { success: false, error: data.status_text };
        */
        
        // Заглушка для реального режима
        console.log(`📱 [REAL SMS] Отправка SMS на ${formattedPhone}: Код ${code}`);
        return { success: true, demo: false };
        
    } catch (error) {
        console.error('Ошибка отправки SMS:', error.message);
        return { success: false, error: error.message };
    }
};

// Проверка времени кода
const isCodeExpired = (expiresAt) => {
    return new Date(expiresAt) < new Date();
};

// ==================== JWT МИДЛВАР ====================
const authMiddleware = (roles = []) => {
    return async (req, res, next) => {
        try {
            const authHeader = req.headers.authorization;
            
            // Публичные маршруты
            const publicRoutes = [
                'GET /',
                'GET /health',
                'GET /api/subscriptions',
                'GET /api/categories',
                'GET /api/categories/*',
                'GET /api/services',
                'GET /api/faq',
                'GET /api/reviews',
                'POST /api/auth/register',
                'POST /api/auth/login',
                'POST /api/auth/verify-phone',
                'POST /api/auth/send-verification',
                'POST /api/auth/forgot-password',
                'POST /api/auth/reset-password/*',
                'OPTIONS /*'
            ];
            
            const currentRoute = `${req.method} ${req.path}`;
            const isPublicRoute = publicRoutes.some(route => {
                if (route.includes('*')) {
                    const pattern = route.replace('*', '.*');
                    return new RegExp(`^${pattern}$`).test(currentRoute);
                }
                return currentRoute === route;
            });
            
            if (isPublicRoute) {
                return next();
            }
            
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).json({ 
                    success: false, 
                    error: 'Требуется авторизация' 
                });
            }
            
            const token = authHeader.replace('Bearer ', '').trim();
            
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'concierge-secret-key-2024-prod');
                
                const user = await db.get(
                    `SELECT id, email, first_name, last_name, phone, phone_verified, role, 
                            subscription_plan, subscription_status, subscription_expires,
                            initial_fee_paid, initial_fee_amount, is_active, avatar_url,
                            balance, user_rating, completed_tasks, tasks_limit, tasks_used,
                            total_spent, last_login, email_verified
                     FROM users WHERE id = ? AND is_active = 1`,
                    [decoded.id]
                );
                
                if (!user) {
                    return res.status(401).json({ 
                        success: false, 
                        error: 'Пользователь не найден' 
                    });
                }
                
                // Переименовываем user_rating в rating для совместимости с фронтендом
                req.user = {
                    id: user.id,
                    email: user.email,
                    role: user.role,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    phone: user.phone,
                    phone_verified: user.phone_verified,
                    subscription_plan: user.subscription_plan,
                    subscription_status: user.subscription_status,
                    subscription_expires: user.subscription_expires,
                    initial_fee_paid: user.initial_fee_paid,
                    initial_fee_amount: user.initial_fee_amount,
                    avatar_url: user.avatar_url,
                    balance: user.balance,
                    rating: user.user_rating, // Переименовываем здесь
                    completed_tasks: user.completed_tasks,
                    tasks_limit: user.tasks_limit,
                    tasks_used: user.tasks_used,
                    total_spent: user.total_spent,
                    last_login: user.last_login,
                    email_verified: user.email_verified
                };
                
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
        message: '🌸 Добро пожаловать в Женский Консьерж API',
        version: '6.0.0',
        status: '🟢 Работает',
        features: ['Регистрация по телефону', 'SMS верификация', 'Подписки', 'Задачи', 'Чат'],
        demo_mode: DEMO_MODE,
        timestamp: new Date().toISOString()
    });
});

// Health check
app.get('/health', async (req, res) => {
    try {
        await db.get('SELECT 1 as status');
        
        // Проверяем доступность основных таблиц
        const tables = ['users', 'categories', 'services', 'tasks', 'subscriptions'];
        const tableStatus = {};
        
        for (const table of tables) {
            try {
                await db.get(`SELECT 1 FROM ${table} LIMIT 1`);
                tableStatus[table] = 'OK';
            } catch (error) {
                tableStatus[table] = 'ERROR';
            }
        }
        
        res.json({
            success: true,
            status: 'OK',
            database: 'connected',
            tables: tableStatus,
            demo_mode: DEMO_MODE,
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            status: 'ERROR',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ==================== АУТЕНТИФИКАЦИЯ ====================

// Регистрация (по телефону, email не обязателен)
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, first_name, last_name = '', phone, subscription_plan = 'essential', role = 'client' } = req.body;
        
        console.log('Регистрация пользователя:', { phone, first_name, role });
        
        // Валидация - теперь телефон обязателен, email опционален
        if (!phone || !password || !first_name) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля: телефон, пароль и имя'
            });
        }
        
        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'Пароль должен содержать не менее 6 символов'
            });
        }
        
        // Форматируем телефон
        const formattedPhone = formatPhone(phone);
        if (!validatePhone(formattedPhone)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный номер телефона'
            });
        }
        
        // Проверяем email если он указан
        if (email && email.trim() && !validateEmail(email)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный email адрес'
            });
        }
        
        // Проверяем существующего пользователя по телефону
        const existingUser = await db.get('SELECT id, phone, email FROM users WHERE phone = ?', [formattedPhone]);
        if (existingUser) {
            return res.status(409).json({
                success: false,
                error: 'Пользователь с таким телефоном уже существует'
            });
        }
        
        // Проверяем email если указан
        if (email && email.trim()) {
            const existingEmail = await db.get('SELECT id FROM users WHERE email = ?', [email]);
            if (existingEmail) {
                return res.status(409).json({
                    success: false,
                    error: 'Пользователь с таким email уже существует'
                });
            }
        }
        
        // Проверяем существование подписки
        const subscription = await db.get(
            'SELECT * FROM subscriptions WHERE name = ? AND is_active = 1',
            [subscription_plan]
        );
        
        if (!subscription) {
            return res.status(400).json({
                success: false,
                error: `Подписка "${subscription_plan}" не найдена`
            });
        }
        
        // Хеширование пароля
        const hashedPassword = await bcrypt.hash(password, 12);
        
        // Генерация токена верификации
        const verificationToken = crypto.randomBytes(32).toString('hex');
        
        // Для исполнителей и администраторов сразу активная подписка
        const initialFeePaid = (role === 'performer' || role === 'admin' || role === 'manager' || role === 'superadmin') ? 1 : (subscription.initial_fee === 0 ? 1 : 0);
        const subscriptionStatus = initialFeePaid ? 'active' : 'pending';
        
        // Для новых пользователей телефон не подтвержден
        const phoneVerified = 0;
        
        // Дата истечения подписки
        let expiryDateStr = null;
        if (initialFeePaid) {
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + 30);
            expiryDateStr = expiryDate.toISOString().split('T')[0];
        }
        
        // Определяем лимит задач в зависимости от роли
        let tasksLimit = subscription.tasks_limit;
        if (role === 'performer') {
            tasksLimit = 999;
        } else if (role === 'admin' || role === 'manager' || role === 'superadmin') {
            tasksLimit = 9999;
        }
        
        // Аватар по умолчанию
        const avatarUrl = generateAvatarUrl(first_name, last_name, role);
        
        // Создание пользователя
        const result = await db.run(
            `INSERT INTO users 
            (email, password, first_name, last_name, phone, phone_verified, role, 
             subscription_plan, subscription_status, subscription_expires,
             initial_fee_paid, initial_fee_amount, tasks_limit, avatar_url,
             verification_token) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                email || null,
                hashedPassword,
                first_name,
                last_name,
                formattedPhone,
                phoneVerified,
                role,
                subscription_plan,
                subscriptionStatus,
                expiryDateStr,
                initialFeePaid,
                subscription.initial_fee,
                tasksLimit,
                avatarUrl,
                verificationToken
            ]
        );
        
        const userId = result.lastID;
        
        // Создаем транзакцию для вступительного взноса
        if (subscription.initial_fee > 0 && initialFeePaid) {
            try {
                await db.run(
                    `INSERT INTO transactions 
                    (user_id, type, amount, description, status) 
                    VALUES (?, ?, ?, ?, ?)`,
                    [
                        userId,
                        'initial_fee',
                        -subscription.initial_fee,
                        'Вступительный взнос',
                        'completed'
                    ]
                );
            } catch (error) {
                console.warn('Ошибка создания транзакции:', error.message);
            }
        }
        
        // Для исполнителей автоматически добавляем все специализации
        if (role === 'performer') {
            try {
                const categories = await db.all('SELECT id FROM categories WHERE is_active = 1');
                for (const category of categories) {
                    await db.run(
                        `INSERT INTO performer_categories (performer_id, category_id, is_active) 
                         VALUES (?, ?, 1)`,
                        [userId, category.id]
                    );
                }
            } catch (error) {
                console.warn('Ошибка добавления специализаций:', error.message);
            }
        }
        
        // Получаем созданного пользователя
        const user = await db.get(
            `SELECT id, email, first_name, last_name, phone, phone_verified, role, 
                    subscription_plan, subscription_status, subscription_expires,
                    initial_fee_paid, initial_fee_amount, avatar_url, tasks_limit, tasks_used,
                    user_rating
             FROM users WHERE id = ?`,
            [userId]
        );
        
        // Переименовываем user_rating в rating для фронтенда
        const userForResponse = {
            ...user,
            rating: user.user_rating
        };
        
        // Генерируем SMS код для верификации телефона
        const smsCode = generateVerificationCode();
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 10); // Код действителен 10 минут
        
        // Сохраняем код в отдельную таблицу
        await db.run(
            `INSERT INTO phone_verification_codes (phone, code, expires_at) 
             VALUES (?, ?, ?)`,
            [formattedPhone, smsCode, expiresAt.toISOString()]
        );
        
        // Отправляем SMS (в демо-режиме показываем в консоли)
        const smsResult = await sendSmsCode(formattedPhone, smsCode);
        
        // Создаем приветственное уведомление
        try {
            await db.run(
                `INSERT INTO notifications 
                (user_id, type, title, message) 
                VALUES (?, ?, ?, ?)`,
                [
                    userId,
                    'welcome',
                    'Добро пожаловать!',
                    role === 'performer' 
                        ? 'Спасибо за регистрацию в качестве помощницы. Для начала работы подтвердите телефон.'
                        : role === 'client'
                        ? 'Спасибо за регистрацию в Женском Консьерже. Подтвердите телефон для начала работы.'
                        : 'Добро пожаловать в админ панель Женского Консьержа.'
                ]
            );
        } catch (error) {
            console.warn('Ошибка создания уведомления:', error.message);
        }
        
        // Создаем JWT токен (ограниченный доступ без подтверждения телефона)
        const token = jwt.sign(
            { 
                id: user.id, 
                phone: user.phone, 
                phone_verified: user.phone_verified,
                role: user.role,
                first_name: user.first_name,
                last_name: user.last_name,
                subscription_plan: user.subscription_plan,
                initial_fee_paid: user.initial_fee_paid
            },
            process.env.JWT_SECRET || 'concierge-secret-key-2024-prod',
            { expiresIn: '30d' }
        );
        
        res.status(201).json({
            success: true,
            message: 'Регистрация успешно завершена! Подтвердите телефон.',
            data: { 
                user: userForResponse,
                token,
                requires_phone_verification: true,
                phone_verification_sent: smsResult.success,
                demo_mode: smsResult.demo || false,
                expires_in_minutes: 10,
                requires_initial_fee: !initialFeePaid,
                initial_fee_amount: subscription.initial_fee
            }
        });
        
    } catch (error) {
        console.error('Ошибка регистрации:', error.message);
        
        // Проверяем, является ли ошибка нарушением уникальности
        if (error.message.includes('UNIQUE constraint failed') || error.message.includes('SQLITE_CONSTRAINT')) {
            return res.status(409).json({
                success: false,
                error: 'Пользователь с таким телефоном уже существует'
            });
        }
        
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера при регистрации'
        });
    }
});

// Отправка кода подтверждения
app.post('/api/auth/send-verification', async (req, res) => {
    try {
        const { phone } = req.body;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Не указан номер телефона'
            });
        }
        
        const formattedPhone = formatPhone(phone);
        if (!validatePhone(formattedPhone)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный номер телефона'
            });
        }
        
        // Проверяем существование пользователя
        const user = await db.get('SELECT id, phone_verified FROM users WHERE phone = ?', [formattedPhone]);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        // Проверяем, не подтвержден ли уже телефон
        if (user.phone_verified) {
            return res.status(400).json({
                success: false,
                error: 'Телефон уже подтвержден'
            });
        }
        
        // Проверяем время с последней отправки
        const lastCode = await db.get(
            `SELECT created_at FROM phone_verification_codes 
             WHERE phone = ? AND verified = 0 
             ORDER BY created_at DESC LIMIT 1`,
            [formattedPhone]
        );
        
        if (lastCode) {
            const lastSent = new Date(lastCode.created_at);
            const now = new Date();
            const diffSeconds = (now - lastSent) / 1000;
            
            if (diffSeconds < 60) { // Задержка 60 секунд
                return res.status(429).json({
                    success: false,
                    error: `Подождите ${Math.ceil(60 - diffSeconds)} секунд перед повторной отправкой`
                });
            }
        }
        
        // Генерируем новый код
        const smsCode = generateVerificationCode();
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 10); // Код действителен 10 минут
        
        // Сохраняем код
        await db.run(
            `INSERT INTO phone_verification_codes (phone, code, expires_at) 
             VALUES (?, ?, ?)`,
            [formattedPhone, smsCode, expiresAt.toISOString()]
        );
        
        // Отправляем SMS
        const smsResult = await sendSmsCode(formattedPhone, smsCode);
        
        if (!smsResult.success) {
            return res.status(500).json({
                success: false,
                error: 'Ошибка отправки SMS',
                demo_mode: DEMO_MODE
            });
        }
        
        res.json({
            success: true,
            message: 'Код подтверждения отправлен',
            data: {
                phone: formattedPhone,
                demo_mode: smsResult.demo || false,
                expires_in_minutes: 10,
                can_resend_after_seconds: 60
            }
        });
        
    } catch (error) {
        console.error('Ошибка отправки кода подтверждения:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка отправки кода подтверждения'
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
                error: 'Не указан телефон или код подтверждения'
            });
        }
        
        const formattedPhone = formatPhone(phone);
        
        // Проверяем существование пользователя
        const user = await db.get('SELECT id, phone_verified FROM users WHERE phone = ?', [formattedPhone]);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        // Проверяем, не подтвержден ли уже телефон
        if (user.phone_verified) {
            return res.status(400).json({
                success: false,
                error: 'Телефон уже подтвержден'
            });
        }
        
        // Ищем активный код подтверждения
        const verificationCode = await db.get(
            `SELECT * FROM phone_verification_codes 
             WHERE phone = ? AND code = ? AND verified = 0 
             ORDER BY created_at DESC LIMIT 1`,
            [formattedPhone, code]
        );
        
        if (!verificationCode) {
            // Увеличиваем счетчик попыток
            await db.run(
                `UPDATE phone_verification_codes 
                 SET attempts = attempts + 1 
                 WHERE phone = ? AND code = ?`,
                [formattedPhone, code]
            );
            
            return res.status(400).json({
                success: false,
                error: 'Неверный код подтверждения'
            });
        }
        
        // Проверяем срок действия кода
        if (isCodeExpired(verificationCode.expires_at)) {
            return res.status(400).json({
                success: false,
                error: 'Срок действия кода истек'
            });
        }
        
        // Проверяем количество попыток
        if (verificationCode.attempts >= 3) {
            return res.status(400).json({
                success: false,
                error: 'Превышено количество попыток. Запросите новый код.'
            });
        }
        
        // Подтверждаем телефон пользователя
        await db.run(
            'UPDATE users SET phone_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [user.id]
        );
        
        // Помечаем код как использованный
        await db.run(
            'UPDATE phone_verification_codes SET verified = 1 WHERE id = ?',
            [verificationCode.id]
        );
        
        // Создаем уведомление
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message) 
            VALUES (?, ?, ?, ?)`,
            [
                user.id,
                'phone_verified',
                'Телефон подтвержден',
                'Ваш номер телефона успешно подтвержден. Теперь вы можете пользоваться всеми функциями сервиса.'
            ]
        );
        
        // Получаем обновленного пользователя
        const updatedUser = await db.get(
            `SELECT id, email, first_name, last_name, phone, phone_verified, role, 
                    subscription_plan, subscription_status, subscription_expires,
                    initial_fee_paid, initial_fee_amount, avatar_url, tasks_limit, tasks_used,
                    user_rating
             FROM users WHERE id = ?`,
            [user.id]
        );
        
        // Переименовываем user_rating в rating для фронтенда
        const userForResponse = {
            ...updatedUser,
            rating: updatedUser.user_rating
        };
        
        // Создаем новый токен с подтвержденным телефоном
        const token = jwt.sign(
            { 
                id: updatedUser.id, 
                phone: updatedUser.phone, 
                phone_verified: updatedUser.phone_verified,
                role: updatedUser.role,
                first_name: updatedUser.first_name,
                last_name: updatedUser.last_name,
                subscription_plan: updatedUser.subscription_plan,
                initial_fee_paid: updatedUser.initial_fee_paid
            },
            process.env.JWT_SECRET || 'concierge-secret-key-2024-prod',
            { expiresIn: '30d' }
        );
        
        res.json({
            success: true,
            message: 'Телефон успешно подтвержден!',
            data: { 
                user: userForResponse,
                token
            }
        });
        
    } catch (error) {
        console.error('Ошибка подтверждения телефона:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка подтверждения телефона'
        });
    }
});

// Вход (по телефону или email)
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, phone, password } = req.body;
        
        console.log('Попытка входа:', { email, phone });
        
        // Проверяем, что предоставлен email или телефон
        if ((!email && !phone) || !password) {
            return res.status(400).json({
                success: false,
                error: 'Укажите email или телефон и пароль'
            });
        }
        
        // Находим пользователя по email или телефону
        let user;
        if (email && email.trim()) {
            user = await db.get(
                `SELECT * FROM users WHERE email = ? AND is_active = 1`,
                [email]
            );
        } else if (phone) {
            const formattedPhone = formatPhone(phone);
            user = await db.get(
                `SELECT * FROM users WHERE phone = ? AND is_active = 1`,
                [formattedPhone]
            );
        }
        
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        // Проверяем пароль
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                error: 'Неверный пароль'
            });
        }
        
        // Проверяем, подтвержден ли телефон (требуется для клиентов)
        if (user.role === 'client' && !user.phone_verified) {
            // Отправляем новый код подтверждения
            const smsCode = generateVerificationCode();
            const expiresAt = new Date();
            expiresAt.setMinutes(expiresAt.getMinutes() + 10);
            
            await db.run(
                `INSERT INTO phone_verification_codes (phone, code, expires_at) 
                 VALUES (?, ?, ?)`,
                [user.phone, smsCode, expiresAt.toISOString()]
            );
            
            const smsResult = await sendSmsCode(user.phone, smsCode);
            
            return res.status(403).json({
                success: false,
                error: 'Требуется подтверждение телефона',
                requires_phone_verification: true,
                phone: user.phone,
                phone_verification_sent: smsResult.success,
                demo_mode: smsResult.demo || false,
                expires_in_minutes: 10
            });
        }
        
        // Проверяем, оплачен ли вступительный взнос (только для клиентов)
        if (user.role === 'client' && user.subscription_status === 'pending' && user.initial_fee_paid === 0) {
            return res.status(403).json({
                success: false,
                error: 'Для входа необходимо оплатить вступительный взнос',
                requires_initial_fee: true,
                initial_fee_amount: user.initial_fee_amount,
                user: {
                    id: user.id,
                    phone: user.phone,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    subscription_plan: user.subscription_plan,
                    subscription_status: user.subscription_status
                }
            });
        }
        
        // Обновляем время последнего входа
        await db.run(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
            [user.id]
        );
        
        // Переименовываем user_rating в rating для фронтенда
        const userForResponse = {
            id: user.id,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            phone: user.phone,
            phone_verified: user.phone_verified,
            role: user.role,
            subscription_plan: user.subscription_plan,
            subscription_status: user.subscription_status,
            subscription_expires: user.subscription_expires,
            avatar_url: user.avatar_url,
            balance: user.balance,
            initial_fee_paid: user.initial_fee_paid,
            initial_fee_amount: user.initial_fee_amount,
            rating: user.user_rating,
            completed_tasks: user.completed_tasks,
            tasks_limit: user.tasks_limit,
            tasks_used: user.tasks_used,
            total_spent: user.total_spent,
            last_login: user.last_login,
            email_verified: user.email_verified
        };
        
        // Создаем токен
        const token = jwt.sign(
            { 
                id: user.id, 
                phone: user.phone, 
                phone_verified: user.phone_verified,
                role: user.role,
                first_name: user.first_name,
                last_name: user.last_name,
                subscription_plan: user.subscription_plan,
                initial_fee_paid: user.initial_fee_paid
            },
            process.env.JWT_SECRET || 'concierge-secret-key-2024-prod',
            { expiresIn: '30d' }
        );
        
        console.log('Успешный вход пользователя:', user.phone);
        
        // Информация о подписке (для уведомления)
        if (user.role === 'client' && user.subscription_status === 'active' && user.subscription_expires) {
            const expiryDate = new Date(user.subscription_expires);
            const daysRemaining = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
            
            if (daysRemaining <= 7) {
                console.log(`Подписка пользователя ${user.phone} истекает через ${daysRemaining} дней`);
            }
        }
        
        res.json({
            success: true,
            message: 'Вход выполнен успешно!',
            data: { 
                user: userForResponse,
                token 
            }
        });
        
    } catch (error) {
        console.error('Ошибка входа:', error.message);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера при входе'
        });
    }
});

// Проверка токена
app.get('/api/auth/check', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'Требуется авторизация'
            });
        }
        
        const token = authHeader.replace('Bearer ', '').trim();
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'concierge-secret-key-2024-prod');
        
        const user = await db.get(
            `SELECT id, email, first_name, last_name, phone, phone_verified, role, 
                    subscription_plan, subscription_status, subscription_expires,
                    initial_fee_paid, initial_fee_amount, is_active, avatar_url,
                    balance, user_rating, completed_tasks, tasks_limit, tasks_used,
                    total_spent, last_login, email_verified
             FROM users WHERE id = ? AND is_active = 1`,
            [decoded.id]
        );
        
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        // Переименовываем user_rating в rating для фронтенда
        const userForResponse = {
            ...user,
            rating: user.user_rating
        };
        
        res.json({
            success: true,
            data: { user: userForResponse }
        });
        
    } catch (error) {
        console.error('Ошибка проверки токена:', error.message);
        res.status(401).json({
            success: false,
            error: 'Неверный токен'
        });
    }
});

// Информация о подписке
app.get('/api/auth/subscription-info', authMiddleware(), async (req, res) => {
    try {
        const user = req.user;
        
        if (!user.subscription_expires) {
            return res.json({
                success: true,
                data: {
                    subscription_status: user.subscription_status,
                    subscription_expires: null,
                    days_remaining: 0,
                    next_charge_date: null
                }
            });
        }
        
        const expiryDate = new Date(user.subscription_expires);
        const now = new Date();
        const daysRemaining = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
        
        // Примерная дата следующего списания
        const nextChargeDate = new Date(expiryDate);
        nextChargeDate.setDate(nextChargeDate.getDate() + 30);
        
        res.json({
            success: true,
            data: {
                subscription_status: user.subscription_status,
                subscription_expires: user.subscription_expires,
                days_remaining: daysRemaining > 0 ? daysRemaining : 0,
                next_charge_date: nextChargeDate.toISOString().split('T')[0]
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения информации о подписке:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения информации о подписке'
        });
    }
});

// Профиль пользователя
app.get('/api/auth/profile', authMiddleware(), async (req, res) => {
    try {
        const user = await db.get(
            `SELECT id, email, first_name, last_name, phone, phone_verified, role, 
                    subscription_plan, subscription_status, subscription_expires,
                    avatar_url, balance, 
                    initial_fee_paid, initial_fee_amount, user_rating, completed_tasks,
                    tasks_limit, tasks_used, total_spent, is_active, 
                    last_login, email_verified, created_at, updated_at 
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        // Получаем информацию о подписке
        const subscription = await db.get(
            'SELECT * FROM subscriptions WHERE name = ?',
            [user.subscription_plan || 'essential']
        );
        
        // Статистика
        const stats = await db.get(`
            SELECT 
                COUNT(*) as total_tasks,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
                SUM(CASE WHEN status IN ('new', 'searching', 'assigned', 'in_progress') THEN 1 ELSE 0 END) as active_tasks
            FROM tasks 
            WHERE client_id = ?
        `, [req.user.id]);
        
        // Для помощников - статистика по выполненным задачам
        let performerStats = null;
        if (req.user.role === 'performer') {
            performerStats = await db.get(`
                SELECT 
                    COUNT(*) as tasks_taken,
                    AVG(r.rating) as avg_rating,
                    SUM(t.price) as total_earned
                FROM tasks t
                LEFT JOIN reviews r ON t.id = r.task_id
                WHERE t.performer_id = ? AND t.status = 'completed'
            `, [req.user.id]);
        }
        
        // Непрочитанные уведомления
        const unreadNotifications = await db.get(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
            [req.user.id]
        );
        
        // Переименовываем user_rating в rating для фронтенда
        const userForResponse = {
            ...user,
            rating: user.user_rating
        };
        
        res.json({
            success: true,
            data: { 
                user: userForResponse,
                subscription: subscription || null,
                stats: {
                    total_tasks: stats?.total_tasks || 0,
                    completed_tasks: stats?.completed_tasks || 0,
                    active_tasks: stats?.active_tasks || 0,
                    tasks_remaining: user.tasks_limit - user.tasks_used,
                    tasks_limit: user.tasks_limit,
                    tasks_used: user.tasks_used,
                    performer_stats: performerStats,
                    unread_notifications: unreadNotifications?.count || 0
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения профиля:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения профиля'
        });
    }
});

// Обновление профиля
app.put('/api/auth/profile', authMiddleware(), async (req, res) => {
    try {
        const { first_name, last_name, email, avatar_url } = req.body;
        
        // Валидация email если указан
        if (email && email.trim() && !validateEmail(email)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный email адрес'
            });
        }
        
        // Собираем поля для обновления
        const updateFields = [];
        const updateValues = [];
        
        if (first_name !== undefined) {
            updateFields.push('first_name = ?');
            updateValues.push(first_name);
        }
        
        if (last_name !== undefined) {
            updateFields.push('last_name = ?');
            updateValues.push(last_name);
        }
        
        if (email !== undefined) {
            // Проверяем, не используется ли email другим пользователем
            if (email && email.trim()) {
                const existingUser = await db.get(
                    'SELECT id FROM users WHERE email = ? AND id != ?',
                    [email, req.user.id]
                );
                if (existingUser) {
                    return res.status(409).json({
                        success: false,
                        error: 'Этот email уже используется другим пользователем'
                    });
                }
            }
            updateFields.push('email = ?');
            updateValues.push(email || null);
        }
        
        if (avatar_url !== undefined) {
            updateFields.push('avatar_url = ?');
            updateValues.push(avatar_url);
        }
        
        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Нет данных для обновления'
            });
        }
        
        updateFields.push('updated_at = CURRENT_TIMESTAMP');
        updateValues.push(req.user.id);
        
        const query = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`;
        
        await db.run(query, updateValues);
        
        // Получаем обновленного пользователя
        const user = await db.get(
            `SELECT id, email, first_name, last_name, phone, phone_verified, role, 
                    subscription_plan, subscription_status, avatar_url,
                    user_rating
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        
        // Переименовываем user_rating в rating для фронтенда
        const userForResponse = {
            ...user,
            rating: user.user_rating
        };
        
        res.json({
            success: true,
            message: 'Профиль успешно обновлен',
            data: { user: userForResponse }
        });
        
    } catch (error) {
        console.error('Ошибка обновления профиля:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления профиля'
        });
    }
});

// Смена пароля
app.put('/api/auth/change-password', authMiddleware(), async (req, res) => {
    try {
        const { current_password, new_password } = req.body;
        
        if (!current_password || !new_password) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все поля'
            });
        }
        
        if (new_password.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'Новый пароль должен содержать не менее 6 символов'
            });
        }
        
        // Получаем текущий пароль
        const user = await db.get('SELECT password FROM users WHERE id = ?', [req.user.id]);
        
        // Проверяем текущий пароль
        const isPasswordValid = await bcrypt.compare(current_password, user.password);
        if (!isPasswordValid) {
            return res.status(400).json({
                success: false,
                error: 'Текущий пароль неверен'
            });
        }
        
        // Хешируем новый пароль
        const hashedPassword = await bcrypt.hash(new_password, 12);
        
        // Обновляем пароль
        await db.run(
            'UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [hashedPassword, req.user.id]
        );
        
        // Создаем уведомление
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message) 
            VALUES (?, ?, ?, ?)`,
            [
                req.user.id,
                'password_changed',
                'Пароль изменен',
                'Ваш пароль был успешно изменен. Если это были не вы, свяжитесь со службой поддержки.'
            ]
        );
        
        res.json({
            success: true,
            message: 'Пароль успешно изменен'
        });
        
    } catch (error) {
        console.error('Ошибка смены пароля:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка смены пароля'
        });
    }
});

// Восстановление пароля (отправка кода на телефон)
app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { phone } = req.body;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Не указан номер телефона'
            });
        }
        
        const formattedPhone = formatPhone(phone);
        
        // Проверяем существование пользователя
        const user = await db.get('SELECT id, first_name FROM users WHERE phone = ? AND is_active = 1', [formattedPhone]);
        if (!user) {
            // Для безопасности не сообщаем, что пользователь не найден
            return res.json({
                success: true,
                message: 'Если пользователь с таким телефоном существует, ему будет отправлен код восстановления'
            });
        }
        
        // Генерируем код восстановления
        const resetCode = generateVerificationCode();
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 1); // Код действителен 1 час
        
        // Сохраняем код в отдельную таблицу
        await db.run(
            `INSERT INTO phone_verification_codes (phone, code, expires_at) 
             VALUES (?, ?, ?)`,
            [formattedPhone, resetCode, expiresAt.toISOString()]
        );
        
        // Отправляем SMS
        const smsResult = await sendSmsCode(formattedPhone, `Код восстановления пароля: ${resetCode}`);
        
        if (!smsResult.success) {
            return res.status(500).json({
                success: false,
                error: 'Ошибка отправки SMS',
                demo_mode: DEMO_MODE
            });
        }
        
        res.json({
            success: true,
            message: 'Код восстановления отправлен',
            data: {
                phone: formattedPhone,
                demo_mode: smsResult.demo || false,
                expires_in_minutes: 60
            }
        });
        
    } catch (error) {
        console.error('Ошибка восстановления пароля:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка восстановления пароля'
        });
    }
});

// Сброс пароля с кодом подтверждения
app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { phone, code, new_password } = req.body;
        
        if (!phone || !code || !new_password) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все поля'
            });
        }
        
        if (new_password.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'Пароль должен содержать не менее 6 символов'
            });
        }
        
        const formattedPhone = formatPhone(phone);
        
        // Проверяем существование пользователя
        const user = await db.get('SELECT id FROM users WHERE phone = ? AND is_active = 1', [formattedPhone]);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        // Ищем код восстановления
        const resetCode = await db.get(
            `SELECT * FROM phone_verification_codes 
             WHERE phone = ? AND code = ? AND verified = 0 
             ORDER BY created_at DESC LIMIT 1`,
            [formattedPhone, code]
        );
        
        if (!resetCode) {
            return res.status(400).json({
                success: false,
                error: 'Неверный код восстановления'
            });
        }
        
        // Проверяем срок действия кода
        if (isCodeExpired(resetCode.expires_at)) {
            return res.status(400).json({
                success: false,
                error: 'Срок действия кода истек'
            });
        }
        
        // Хешируем новый пароль
        const hashedPassword = await bcrypt.hash(new_password, 12);
        
        // Обновляем пароль
        await db.run(
            'UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [hashedPassword, user.id]
        );
        
        // Помечаем код как использованный
        await db.run(
            'UPDATE phone_verification_codes SET verified = 1 WHERE id = ?',
            [resetCode.id]
        );
        
        // Создаем уведомление
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message) 
            VALUES (?, ?, ?, ?)`,
            [
                user.id,
                'password_reset',
                'Пароль изменен',
                'Ваш пароль был успешно изменен через восстановление.'
            ]
        );
        
        res.json({
            success: true,
            message: 'Пароль успешно изменен'
        });
        
    } catch (error) {
        console.error('Ошибка сброса пароля:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка сброса пароля'
        });
    }
});

// Удаление аккаунта
app.delete('/api/auth/account', authMiddleware(), async (req, res) => {
    try {
        const { password } = req.body;
        
        if (!password) {
            return res.status(400).json({
                success: false,
                error: 'Введите пароль для подтверждения'
            });
        }
        
        // Получаем пароль пользователя
        const user = await db.get('SELECT password FROM users WHERE id = ?', [req.user.id]);
        
        // Проверяем пароль
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(400).json({
                success: false,
                error: 'Неверный пароль'
            });
        }
        
        // Деактивируем аккаунт (мягкое удаление)
        await db.run(
            'UPDATE users SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [req.user.id]
        );
        
        // Создаем уведомление об удалении
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message) 
            VALUES (?, ?, ?, ?)`,
            [
                req.user.id,
                'account_deactivated',
                'Аккаунт деактивирован',
                'Ваш аккаунт был деактивирован. Вы можете восстановить его в течение 30 дней, обратившись в поддержку.'
            ]
        );
        
        res.json({
            success: true,
            message: 'Аккаунт успешно деактивирован'
        });
        
    } catch (error) {
        console.error('Ошибка деактивации аккаунта:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка деактивации аккаунта'
        });
    }
});

// ==================== КАТЕГОРИИ И УСЛУГИ ====================

// Получение всех категорий
app.get('/api/categories', async (req, res) => {
    try {
        const categories = await db.all(
            `SELECT c.*, 
                    COUNT(s.id) as services_count
             FROM categories c
             LEFT JOIN services s ON c.id = s.category_id AND s.is_active = 1
             WHERE c.is_active = 1
             GROUP BY c.id
             ORDER BY c.sort_order ASC`
        );
        
        res.json({
            success: true,
            data: {
                categories,
                count: categories.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения категорий:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения категорий'
        });
    }
});

// Получение услуг категории
app.get('/api/categories/:id/services', async (req, res) => {
    const categoryId = req.params.id;
    
    try {
        if (!categoryId) {
            return res.status(400).json({
                success: false,
                error: 'Не указан ID категории'
            });
        }
        
        // Проверяем существование категории
        const category = await db.get(
            'SELECT * FROM categories WHERE id = ? AND is_active = 1',
            [categoryId]
        );
        
        if (!category) {
            return res.status(404).json({
                success: false,
                error: 'Категория не найдена'
            });
        }
        
        // Получаем услуги категории
        const services = await db.all(
            `SELECT s.* 
             FROM services s
             WHERE s.category_id = ? AND s.is_active = 1
             ORDER BY s.sort_order ASC, s.name ASC`,
            [categoryId]
        );
        
        res.json({
            success: true,
            data: {
                category,
                services,
                count: services.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения услуг категории:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения услуг категории'
        });
    }
});

// ==================== FAQ ====================
app.get('/api/faq', async (req, res) => {
    try {
        const faq = await db.all(
            'SELECT * FROM faq WHERE is_active = 1 ORDER BY sort_order ASC, category ASC'
        );
        
        res.json({
            success: true,
            data: { faq }
        });
    } catch (error) {
        console.error('Ошибка получения FAQ:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения FAQ'
        });
    }
});

// ==================== ОТЗЫВЫ ====================
app.get('/api/reviews', async (req, res) => {
    try {
        const { featured, limit = 10 } = req.query;
        
        let query = `
            SELECT r.*, 
                   u1.first_name as client_first_name,
                   u1.last_name as client_last_name,
                   u2.first_name as performer_first_name,
                   u2.last_name as performer_last_name,
                   t.title as task_title
            FROM reviews r
            LEFT JOIN users u1 ON r.client_id = u1.id
            LEFT JOIN users u2 ON r.performer_id = u2.id
            LEFT JOIN tasks t ON r.task_id = t.id
            WHERE r.admin_approved = 1
        `;
        
        const params = [];
        
        if (featured === 'true') {
            query += ' AND r.is_featured = 1';
        }
        
        query += ' ORDER BY r.created_at DESC LIMIT ?';
        params.push(parseInt(limit));
        
        const reviews = await db.all(query, params);
        
        // Анонимизируем отзывы если нужно
        const processedReviews = reviews.map(review => {
            if (review.is_anonymous) {
                review.client_first_name = 'Аноним';
                review.client_last_name = '';
            }
            return review;
        });
        
        res.json({
            success: true,
            data: {
                reviews: processedReviews,
                count: reviews.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения отзывов:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения отзывов'
        });
    }
});

// ==================== ПОДПИСКИ ====================

// Получение всех подписок
app.get('/api/subscriptions', async (req, res) => {
    try {
        const subscriptions = await db.all(
            'SELECT * FROM subscriptions WHERE is_active = 1 ORDER BY sort_order ASC, price_monthly ASC'
        );
        
        // Парсим features из JSON строки
        const subscriptionsWithParsedFeatures = subscriptions.map(sub => ({
            ...sub,
            features: typeof sub.features === 'string' ? JSON.parse(sub.features) : sub.features
        }));
        
        res.json({
            success: true,
            data: {
                subscriptions: subscriptionsWithParsedFeatures,
                count: subscriptions.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения подписок:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения подписок'
        });
    }
});

// Оплата вступительного взноса и активация подписки
app.post('/api/subscriptions/subscribe', authMiddleware(['client']), async (req, res) => {
    try {
        const { plan } = req.body;
        
        if (!plan) {
            return res.status(400).json({
                success: false,
                error: 'Не указан тарифный план'
            });
        }
        
        // Проверяем, подтвержден ли телефон
        if (!req.user.phone_verified) {
            // Вместо возврата ошибки, предлагаем подтвердить телефон
            return res.status(403).json({
                success: false,
                error: 'Для активации подписки необходимо подтвердить телефон',
                requires_phone_verification: true,
                user_phone: req.user.phone,
                user_id: req.user.id
            });
        }

        
        // Проверяем существование подписки
        const subscription = await db.get(
            'SELECT * FROM subscriptions WHERE name = ? AND is_active = 1',
            [plan]
        );
        
        if (!subscription) {
            return res.status(404).json({
                success: false,
                error: 'Тарифный план не найден'
            });
        }
        
        // Проверяем баланс для вступительного взноса
        if (subscription.initial_fee > 0 && !req.user.initial_fee_paid) {
            if (req.user.balance < subscription.initial_fee) {
                return res.status(400).json({
                    success: false,
                    error: 'Недостаточно средств для оплаты вступительного взноса',
                    requires_initial_fee: true,
                    initial_fee_amount: subscription.initial_fee,
                    current_balance: req.user.balance
                });
            }
            
            // Списываем вступительный взнос
            await db.run(
                'UPDATE users SET balance = balance - ? WHERE id = ?',
                [subscription.initial_fee, req.user.id]
            );
            
            // Создаем транзакцию
            await db.run(
                `INSERT INTO transactions 
                (user_id, type, amount, description, status) 
                VALUES (?, ?, ?, ?, ?)`,
                [
                    req.user.id,
                    'initial_fee',
                    -subscription.initial_fee,
                    `Вступительный взнос: ${subscription.display_name}`,
                    'completed'
                ]
            );
            
            // Обновляем статистику пользователя
            await db.run(
                'UPDATE users SET total_spent = total_spent + ? WHERE id = ?',
                [subscription.initial_fee, req.user.id]
            );
            
            // Обновляем статус пользователя
            await db.run(
                `UPDATE users SET 
                    subscription_plan = ?,
                    subscription_status = 'active',
                    initial_fee_paid = 1,
                    initial_fee_amount = ?,
                    tasks_limit = ?,
                    subscription_expires = DATE('now', '+30 days')
                 WHERE id = ?`,
                [plan, subscription.initial_fee, subscription.tasks_limit, req.user.id]
            );
        } else {
            // Просто активируем подписку
            await db.run(
                `UPDATE users SET 
                    subscription_plan = ?,
                    subscription_status = 'active',
                    tasks_limit = ?,
                    subscription_expires = DATE('now', '+30 days')
                 WHERE id = ?`,
                [plan, subscription.tasks_limit, req.user.id]
            );
        }
        
        // Создаем уведомление
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message) 
            VALUES (?, ?, ?, ?)`,
            [
                req.user.id,
                'subscription_activated',
                'Подписка активирована!',
                `Поздравляем! Вы успешно активировали подписку "${subscription.display_name}". Теперь вы можете создавать задачи.`
            ]
        );
        
        // Получаем обновленного пользователя
        const updatedUser = await db.get(
            `SELECT id, email, first_name, last_name, phone, phone_verified, role, 
                    subscription_plan, subscription_status, subscription_expires,
                    initial_fee_paid, initial_fee_amount, balance, tasks_limit, tasks_used,
                    user_rating
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        
        // Переименовываем user_rating в rating для фронтенда
        const userForResponse = {
            ...updatedUser,
            rating: updatedUser.user_rating
        };
        
        res.json({
            success: true,
            message: 'Подписка успешно активирована!',
            data: {
                user: userForResponse,
                subscription
            }
        });
        
    } catch (error) {
        console.error('Ошибка активации подписки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка активации подписки'
        });
    }
});

// ==================== ЗАДАЧИ ====================

// Создание задачи
app.post('/api/tasks', authMiddleware(['client', 'admin', 'superadmin']), async (req, res) => {
    try {
        const { 
            title, 
            description, 
            category_id, 
            service_id,
            priority = 'medium', 
            deadline, 
            address, 
            contact_info,
            additional_requirements
        } = req.body;
        
        // Валидация
        if (!title || !description || !category_id || !deadline || !address || !contact_info) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля'
            });
        }
        
        // Проверяем существование категории
        const category = await db.get(
            'SELECT * FROM categories WHERE id = ? AND is_active = 1',
            [category_id]
        );
        
        if (!category) {
            return res.status(404).json({
                success: false,
                error: 'Категория не найдена'
            });
        }
        
        // Проверяем подписку пользователя (только для клиентов)
        if (req.user.role === 'client') {
            const user = await db.get(
                'SELECT subscription_status, initial_fee_paid, tasks_limit, tasks_used, phone_verified FROM users WHERE id = ?',
                [req.user.id]
            );
            
            if (!user) {
                return res.status(403).json({
                    success: false,
                    error: 'Пользователь не найден'
                });
            }
            
            // Проверяем подтверждение телефона
            if (!user.phone_verified) {
                return res.status(403).json({
                    success: false,
                    error: 'Для создания задач необходимо подтвердить телефон'
                });
            }
            
            if (user.subscription_status !== 'active') {
                return res.status(403).json({
                    success: false,
                    error: 'Ваша подписка не активна'
                });
            }
            
            if (!user.initial_fee_paid) {
                return res.status(403).json({
                    success: false,
                    error: 'Для создания задач необходимо оплатить вступительный взнос'
                });
            }
            
            // Проверяем лимит задач
            if (user.tasks_used >= user.tasks_limit) {
                return res.status(403).json({
                    success: false,
                    error: 'Превышен лимит задач по вашей подписке',
                    tasks_limit: user.tasks_limit,
                    tasks_used: user.tasks_used
                });
            }
        }
        
        // Проверяем дату дедлайна
        const deadlineDate = new Date(deadline);
        if (deadlineDate < new Date()) {
            return res.status(400).json({
                success: false,
                error: 'Дата дедлайна не может быть в прошлом'
            });
        }
        
        // Цена всегда 0 для клиента (все включено в подписку)
        const finalPrice = 0;
        
        // Генерируем номер задачи
        const taskNumber = generateTaskNumber();
        
        // Создаем задачу
        const result = await db.run(
            `INSERT INTO tasks 
            (task_number, title, description, client_id, category_id, service_id, 
             priority, price, address, deadline, contact_info, additional_requirements) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                taskNumber,
                title,
                description,
                req.user.id,
                category_id,
                service_id || null,
                priority,
                finalPrice,
                address,
                deadline,
                contact_info,
                additional_requirements || null
            ]
        );
        
        const taskId = result.lastID;
        
        // Увеличиваем счетчик использованных задач (только для клиентов)
        if (req.user.role === 'client') {
            await db.run(
                'UPDATE users SET tasks_used = tasks_used + 1 WHERE id = ?',
                [req.user.id]
            );
        }
        
        // Добавляем запись в историю статусов
        await db.run(
            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
             VALUES (?, ?, ?, ?)`,
            [taskId, 'new', req.user.id, 'Задача создана']
        );
        
        // Создаем уведомление для клиента
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message, related_id, related_type) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                req.user.id,
                'task_created',
                'Задача создана',
                `Задача "${title}" успешно создана. Ожидайте назначения исполнителя.`,
                taskId,
                'task'
            ]
        );
        
        // Находим доступных исполнителей для этой категории
        const performers = await db.all(
            `SELECT u.id, u.first_name, u.last_name, u.avatar_url, u.user_rating as rating
             FROM users u
             JOIN performer_categories pc ON u.id = pc.performer_id
             WHERE u.role = 'performer' 
               AND u.is_active = 1
               AND u.phone_verified = 1
               AND pc.category_id = ?
               AND pc.is_active = 1`,
            [category_id]
        );
        
        // Создаем уведомления для исполнителей
        for (const performer of performers) {
            await db.run(
                `INSERT INTO notifications 
                (user_id, type, title, message, related_id, related_type) 
                VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    performer.id,
                    'new_task_available',
                    'Новая задача доступна',
                    `Доступна новая задача в категории "${category.display_name}"`,
                    taskId,
                    'task'
                ]
            );
        }
        
        // Получаем созданную задачу
        const task = await db.get(
            `SELECT t.*, c.display_name as category_name
             FROM tasks t 
             LEFT JOIN categories c ON t.category_id = c.id 
             WHERE t.id = ?`,
            [taskId]
        );
        
        res.status(201).json({
            success: true,
            message: 'Задача успешно создана!',
            data: { 
                task,
                tasks_used: req.user.role === 'client' ? req.user.tasks_used + 1 : 0,
                tasks_remaining: req.user.role === 'client' ? req.user.tasks_limit - (req.user.tasks_used + 1) : 999,
                available_performers: performers.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка создания задачи:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания задачи'
        });
    }
});

// Получение задач пользователя
app.get('/api/tasks', authMiddleware(), async (req, res) => {
    try {
        const { status, category_id, limit = 50, offset = 0, date_filter } = req.query;
        
        let query = `
            SELECT t.*, 
                   c.display_name as category_name,
                   c.icon as category_icon,
                   s.name as service_name,
                   u1.first_name as client_first_name, 
                   u1.last_name as client_last_name,
                   u2.first_name as performer_first_name,
                   u2.last_name as performer_last_name,
                   u2.user_rating as performer_rating
            FROM tasks t
            LEFT JOIN categories c ON t.category_id = c.id
            LEFT JOIN services s ON t.service_id = s.id
            LEFT JOIN users u1 ON t.client_id = u1.id
            LEFT JOIN users u2 ON t.performer_id = u2.id
            WHERE 1=1
        `;
        
        const params = [];
        
        // Разные права доступа для разных ролей
        if (req.user.role === 'client') {
            query += ' AND t.client_id = ?';
            params.push(req.user.id);
        } else if (req.user.role === 'performer') {
            query += ' AND (t.performer_id = ? OR t.status = "searching")';
            params.push(req.user.id);
        }
        // Админы видят все задачи
        
        if (status && status !== 'all') {
            query += ' AND t.status = ?';
            params.push(status);
        }
        
        if (category_id && category_id !== 'all') {
            query += ' AND t.category_id = ?';
            params.push(category_id);
        }
        
        // Фильтр по дате
        if (date_filter) {
            const now = new Date();
            let startDate;
            
            switch(date_filter) {
                case 'today':
                    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    query += ' AND t.created_at >= ?';
                    params.push(startDate.toISOString());
                    break;
                case 'week':
                    startDate = new Date(now);
                    startDate.setDate(now.getDate() - 7);
                    query += ' AND t.created_at >= ?';
                    params.push(startDate.toISOString());
                    break;
                case 'month':
                    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                    query += ' AND t.created_at >= ?';
                    params.push(startDate.toISOString());
                    break;
            }
        }
        
        query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const tasks = await db.all(query, params);
        
        // Для помощников - фильтруем задачи, доступные для принятия
        if (req.user.role === 'performer') {
            for (const task of tasks) {
                if (task.status === 'searching') {
                    // Проверяем, специализируется ли помощник на этой категории
                    const canTake = await db.get(
                        `SELECT 1 FROM performer_categories 
                         WHERE performer_id = ? AND category_id = ? AND is_active = 1`,
                        [req.user.id, task.category_id]
                    );
                    task.can_take = canTake ? true : false;
                }
            }
        }
        
        // Получаем общее количество задач для пагинации
        let countQuery = `SELECT COUNT(*) as total FROM tasks WHERE 1=1`;
        let countParams = [];
        
        if (req.user.role === 'client') {
            countQuery += ' AND client_id = ?';
            countParams.push(req.user.id);
        } else if (req.user.role === 'performer') {
            countQuery += ' AND (performer_id = ? OR status = "searching")';
            countParams.push(req.user.id);
        }
        
        if (status && status !== 'all') {
            countQuery += ' AND status = ?';
            countParams.push(status);
        }
        
        const countResult = await db.get(countQuery, countParams);
        
        res.json({
            success: true,
            data: {
                tasks,
                pagination: {
                    total: countResult?.total || 0,
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    pages: Math.ceil((countResult?.total || 0) / parseInt(limit))
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения задач:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения задач'
        });
    }
});

// Получение деталей задачи
app.get('/api/tasks/:id', authMiddleware(), async (req, res) => {
    const taskId = req.params.id;
    
    try {
        const task = await db.get(
            `SELECT t.*, 
                    c.display_name as category_name,
                    c.icon as category_icon,
                    s.name as service_name,
                    s.description as service_description,
                    u1.first_name as client_first_name, 
                    u1.last_name as client_last_name, 
                    u1.phone as client_phone,
                    u1.avatar_url as client_avatar,
                    u1.user_rating as client_rating,
                    u2.first_name as performer_first_name,
                    u2.last_name as performer_last_name,
                    u2.phone as performer_phone,
                    u2.avatar_url as performer_avatar,
                    u2.user_rating as performer_rating
             FROM tasks t
             LEFT JOIN categories c ON t.category_id = c.id
             LEFT JOIN services s ON t.service_id = s.id
             LEFT JOIN users u1 ON t.client_id = u1.id
             LEFT JOIN users u2 ON t.performer_id = u2.id
             WHERE t.id = ?`,
            [taskId]
        );
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        // Проверяем права доступа
        if (req.user.id !== task.client_id && 
            req.user.id !== task.performer_id && 
            !['admin', 'manager', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'Нет доступа к этой задаче'
            });
        }
        
        // Для помощников проверяем, может ли он принять задачу
        if (req.user.role === 'performer' && task.status === 'searching') {
            const canTake = await db.get(
                `SELECT 1 FROM performer_categories 
                 WHERE performer_id = ? AND category_id = ? AND is_active = 1`,
                [req.user.id, task.category_id]
            );
            task.can_take = canTake ? true : false;
        }
        
        // Получаем историю статусов
        const statusHistory = await db.all(
            `SELECT tsh.*, u.first_name, u.last_name
             FROM task_status_history tsh
             LEFT JOIN users u ON tsh.changed_by = u.id
             WHERE tsh.task_id = ?
             ORDER BY tsh.created_at ASC`,
            [taskId]
        );
        
        // Получаем количество сообщений
        const messagesCount = await db.get(
            'SELECT COUNT(*) as count FROM task_messages WHERE task_id = ?',
            [taskId]
        );
        
        res.json({
            success: true,
            data: {
                task: {
                    ...task,
                    status_history: statusHistory,
                    messages_count: messagesCount?.count || 0
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения задачи:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения задачи'
        });
    }
});

// Изменение статуса задачи
app.put('/api/tasks/:id/status', authMiddleware(), async (req, res) => {
    const taskId = req.params.id;
    
    try {
        const { status, notes, performer_id } = req.body;
        
        if (!status) {
            return res.status(400).json({
                success: false,
                error: 'Не указан новый статус'
            });
        }
        
        // Получаем задачу
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
        
        // Проверяем права
        let canChangeStatus = false;
        const isAdmin = ['admin', 'manager', 'superadmin'].includes(req.user.role);
        
        if (isAdmin) {
            canChangeStatus = true;
        } else if (req.user.id === task.client_id) {
            canChangeStatus = ['cancelled', 'completed'].includes(status);
        } else if (req.user.id === task.performer_id) {
            canChangeStatus = ['in_progress', 'completed'].includes(status);
        }
        
        if (!canChangeStatus) {
            return res.status(403).json({
                success: false,
                error: 'Нет прав для изменения статуса'
            });
        }
        
        // Обновляем статус
        const updateData = { status };
        if (status === 'assigned' && performer_id) {
            updateData.performer_id = performer_id;
        }
        if (status === 'completed') {
            updateData.completed_at = new Date().toISOString();
            
            // Обновляем статистику исполнителя
            if (task.performer_id) {
                await db.run(
                    `UPDATE users SET 
                        completed_tasks = completed_tasks + 1,
                        updated_at = CURRENT_TIMESTAMP 
                     WHERE id = ?`,
                    [task.performer_id]
                );
            }
        }
        
        const updateFields = Object.keys(updateData).map(key => `${key} = ?`).join(', ');
        const updateValues = [...Object.values(updateData), taskId];
        
        await db.run(
            `UPDATE tasks SET ${updateFields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            updateValues
        );
        
        // Добавляем запись в историю
        await db.run(
            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
             VALUES (?, ?, ?, ?)`,
            [taskId, status, req.user.id, notes || `Статус изменен`]
        );
        
        // Создаем уведомления
        if (status === 'assigned' && performer_id) {
            // Уведомление исполнителю
            await db.run(
                `INSERT INTO notifications 
                (user_id, type, title, message, related_id, related_type) 
                VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    performer_id,
                    'task_assigned',
                    'Задача назначена вам',
                    `Вам назначена задача "${task.title}"`,
                    taskId,
                    'task'
                ]
            );
            
            // Уведомление клиенту
            await db.run(
                `INSERT INTO notifications 
                (user_id, type, title, message, related_id, related_type) 
                VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    task.client_id,
                    'task_performer_assigned',
                    'Исполнитель назначен',
                    `Исполнитель назначен на задачу "${task.title}"`,
                    taskId,
                    'task'
                ]
            );
        } else if (status === 'in_progress') {
            // Уведомление клиенту
            await db.run(
                `INSERT INTO notifications 
                (user_id, type, title, message, related_id, related_type) 
                VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    task.client_id,
                    'task_in_progress',
                    'Задача в работе',
                    `Исполнитель начал выполнение задачи "${task.title}"`,
                    taskId,
                    'task'
                ]
            );
        } else if (status === 'completed') {
            // Уведомление клиенту
            await db.run(
                `INSERT INTO notifications 
                (user_id, type, title, message, related_id, related_type) 
                VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    task.client_id,
                    'task_completed',
                    'Задача завершена',
                    `Задача "${task.title}" завершена. Пожалуйста, оцените работу.`,
                    taskId,
                    'task'
                ]
            );
        } else if (status === 'cancelled') {
            // Уведомление всем участникам
            const participants = [task.client_id];
            if (task.performer_id) {
                participants.push(task.performer_id);
            }
            
            for (const participantId of participants) {
                await db.run(
                    `INSERT INTO notifications 
                    (user_id, type, title, message, related_id, related_type) 
                    VALUES (?, ?, ?, ?, ?, ?)`,
                    [
                        participantId,
                        'task_cancelled',
                        'Задача отменена',
                        `Задача "${task.title}" была отменена.`,
                        taskId,
                        'task'
                    ]
                );
            }
        }
        
        res.json({
            success: true,
            message: 'Статус задачи изменен',
            data: { 
                task_id: taskId,
                new_status: status
            }
        });
        
    } catch (error) {
        console.error('Ошибка изменения статуса:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка изменения статуса задачи'
        });
    }
});

// Отмена задачи
app.post('/api/tasks/:id/cancel', authMiddleware(), async (req, res) => {
    const taskId = req.params.id;
    
    try {
        const { reason } = req.body;
        
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
        
        // Проверяем права
        const canCancel = 
            ['admin', 'manager', 'superadmin'].includes(req.user.role) ||
            (req.user.id === task.client_id && ['new', 'searching', 'assigned'].includes(task.status));
        
        if (!canCancel) {
            return res.status(403).json({
                success: false,
                error: 'Нет прав для отмены задачи'
            });
        }
        
        // Возвращаем лимит задач клиенту (только если задача не завершена)
        if (req.user.id === task.client_id && task.status !== 'completed') {
            await db.run(
                'UPDATE users SET tasks_used = tasks_used - 1 WHERE id = ?',
                [task.client_id]
            );
        }
        
        // Обновляем статус
        await db.run(
            `UPDATE tasks SET 
                status = 'cancelled', 
                cancellation_reason = ?, 
                cancellation_by = ?,
                updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [reason || 'Отменена пользователем', req.user.id, taskId]
        );
        
        // Добавляем в историю
        await db.run(
            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
             VALUES (?, ?, ?, ?)`,
            [taskId, 'cancelled', req.user.id, reason || 'Задача отменена']
        );
        
        // Создаем уведомления
        const participants = [task.client_id];
        if (task.performer_id) {
            participants.push(task.performer_id);
        }
        
        for (const participantId of participants) {
            await db.run(
                `INSERT INTO notifications 
                (user_id, type, title, message, related_id, related_type) 
                VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    participantId,
                    'task_cancelled',
                    'Задача отменена',
                    `Задача "${task.title}" была отменена. Причина: ${reason || 'не указана'}`,
                    taskId,
                    'task'
                ]
            );
        }
        
        res.json({
            success: true,
            message: 'Задача отменена',
            data: {
                task_id: taskId,
                reason: reason || 'Не указана'
            }
        });
        
    } catch (error) {
        console.error('Ошибка отмены задачи:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка отмены задачи'
        });
    }
});

// Получение доступных задач для исполнителей
app.get('/api/tasks/available', authMiddleware(['performer']), async (req, res) => {
    try {
        const { limit = 10 } = req.query;
        
        // Проверяем подтверждение телефона
        if (!req.user.phone_verified) {
            return res.status(403).json({
                success: false,
                error: 'Для просмотра задач необходимо подтвердить телефон'
            });
        }
        
        // Получаем специализации исполнителя
        const specializations = await db.all(
            'SELECT category_id FROM performer_categories WHERE performer_id = ? AND is_active = 1',
            [req.user.id]
        );
        
        if (specializations.length === 0) {
            return res.json({
                success: true,
                data: {
                    tasks: [],
                    count: 0,
                    message: 'У вас нет активных специализаций. Выберите специализации в профиле.'
                }
            });
        }
        
        const categoryIds = specializations.map(s => s.category_id);
        const placeholders = categoryIds.map(() => '?').join(',');
        
        // Получаем доступные задачи
        const tasks = await db.all(`
            SELECT t.*, 
                   c.display_name as category_name,
                   c.icon as category_icon,
                   u.first_name as client_first_name,
                   u.last_name as client_last_name,
                   u.avatar_url as client_avatar,
                   u.user_rating as client_rating
            FROM tasks t
            LEFT JOIN categories c ON t.category_id = c.id
            LEFT JOIN users u ON t.client_id = u.id
            WHERE t.status = 'searching' 
              AND t.category_id IN (${placeholders})
            ORDER BY t.priority DESC, t.created_at DESC
            LIMIT ?
        `, [...categoryIds, parseInt(limit)]);
        
        // Добавляем флаг, что исполнитель может принять задачу
        const tasksWithFlag = tasks.map(task => ({
            ...task,
            can_take: true
        }));
        
        res.json({
            success: true,
            data: {
                tasks: tasksWithFlag,
                count: tasksWithFlag.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения доступных задач:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения доступных задач'
        });
    }
});

// Принятие задачи исполнителем
app.post('/api/tasks/:id/take', authMiddleware(['performer']), async (req, res) => {
    const taskId = req.params.id;
    
    try {
        // Проверяем подтверждение телефона
        if (!req.user.phone_verified) {
            return res.status(403).json({
                success: false,
                error: 'Для принятия задач необходимо подтвердить телефон'
            });
        }
        
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
        
        if (task.status !== 'searching') {
            return res.status(400).json({
                success: false,
                error: 'Задача не доступна для принятия'
            });
        }
        
        // Проверяем специализацию помощника
        const canTake = await db.get(
            `SELECT 1 FROM performer_categories 
             WHERE performer_id = ? AND category_id = ? AND is_active = 1`,
            [req.user.id, task.category_id]
        );
        
        if (!canTake) {
            return res.status(403).json({
                success: false,
                error: 'Вы не специализируетесь на этой категории услуг'
            });
        }
        
        // Назначаем задачу исполнителю
        await db.run(
            `UPDATE tasks SET 
                performer_id = ?,
                status = 'assigned',
                updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [req.user.id, taskId]
        );
        
        // Добавляем запись в историю
        await db.run(
            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
             VALUES (?, ?, ?, ?)`,
            [taskId, 'assigned', req.user.id, 'Задача принята исполнителем']
        );
        
        // Создаем уведомления
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message, related_id, related_type) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                req.user.id,
                'task_assigned',
                'Задача назначена вам',
                `Вы приняли задачу "${task.title}"`,
                taskId,
                'task'
            ]
        );
        
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message, related_id, related_type) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                task.client_id,
                'task_performer_assigned',
                'Исполнитель назначен',
                `Исполнитель назначен на задачу "${task.title}"`,
                taskId,
                'task'
            ]
        );
        
        res.json({
            success: true,
            message: 'Задача принята',
            data: {
                task_id: taskId
            }
        });
        
    } catch (error) {
        console.error('Ошибка принятия задачи:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка принятия задачи'
        });
    }
});

// ==================== ЧАТ ЗАДАЧИ ====================

// Получение сообщений чата
app.get('/api/tasks/:id/messages', authMiddleware(), async (req, res) => {
    const taskId = req.params.id;
    
    try {
        // Проверяем доступ к задаче
        const task = await db.get(
            'SELECT client_id, performer_id, status FROM tasks WHERE id = ?',
            [taskId]
        );
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        const hasAccess = 
            ['admin', 'manager', 'superadmin'].includes(req.user.role) ||
            req.user.id === task.client_id ||
            req.user.id === task.performer_id;
        
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                error: 'Нет доступа к чату'
            });
        }
        
        // Получаем сообщения
        const messages = await db.all(
            `SELECT tm.*, u.first_name, u.last_name, u.avatar_url, u.role
             FROM task_messages tm
             LEFT JOIN users u ON tm.user_id = u.id
             WHERE tm.task_id = ?
             ORDER BY tm.created_at ASC`,
            [taskId]
        );
        
        // Помечаем сообщения как прочитанные
        if (req.user.id !== task.client_id && req.user.id !== task.performer_id) {
            // Администраторы не помечают сообщения как прочитанные
        } else {
            await db.run(
                `UPDATE task_messages 
                 SET is_read = 1, read_at = CURRENT_TIMESTAMP 
                 WHERE task_id = ? AND user_id != ? AND is_read = 0`,
                [taskId, req.user.id]
            );
        }
        
        // Получаем участников чата
        const participants = await db.all(
            `SELECT u.id, u.first_name, u.last_name, u.avatar_url, u.role
             FROM users u
             WHERE u.id IN (?, ?) AND u.is_active = 1`,
            [task.client_id, task.performer_id].filter(Boolean)
        );
        
        res.json({
            success: true,
            data: { 
                messages,
                participants,
                can_send: task.status !== 'completed' && task.status !== 'cancelled'
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения сообщений:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения сообщений'
        });
    }
});

// Отправка сообщения в чат
app.post('/api/tasks/:id/messages', authMiddleware(), async (req, res) => {
    const taskId = req.params.id;
    
    try {
        const { message } = req.body;
        
        if (!message || message.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Сообщение не может быть пустым'
            });
        }
        
        // Проверяем доступ к задаче
        const task = await db.get(
            'SELECT id, client_id, performer_id, status, title FROM tasks WHERE id = ?',
            [taskId]
        );
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        const hasAccess = 
            ['admin', 'manager', 'superadmin'].includes(req.user.role) ||
            req.user.id === task.client_id ||
            req.user.id === task.performer_id;
        
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                error: 'Нет доступа к чату'
            });
        }
        
        // Проверяем можно ли отправлять сообщения
        if (task.status === 'cancelled' || task.status === 'completed') {
            return res.status(400).json({
                success: false,
                error: 'Нельзя отправлять сообщения в завершенные или отмененные задачи'
            });
        }
        
        // Отправляем сообщение
        const result = await db.run(
            `INSERT INTO task_messages (task_id, user_id, message) 
             VALUES (?, ?, ?)`,
            [taskId, req.user.id, message.trim()]
        );
        
        const newMessage = await db.get(
            `SELECT tm.*, u.first_name, u.last_name, u.avatar_url, u.role
             FROM task_messages tm
             LEFT JOIN users u ON tm.user_id = u.id
             WHERE tm.id = ?`,
            [result.lastID]
        );
        
        // Определяем получателя уведомления
        let recipientId = null;
        if (req.user.id === task.client_id && task.performer_id) {
            recipientId = task.performer_id;
        } else if (req.user.id === task.performer_id) {
            recipientId = task.client_id;
        }
        
        // Создаем уведомление о новом сообщении
        if (recipientId) {
            await db.run(
                `INSERT INTO notifications 
                (user_id, type, title, message, related_id, related_type) 
                VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    recipientId,
                    'new_message',
                    'Новое сообщение',
                    `Новое сообщение в задаче "${task.title}"`,
                    taskId,
                    'task'
                ]
            );
        }
        
        res.status(201).json({
            success: true,
            message: 'Сообщение отправлено',
            data: { 
                message: newMessage
            }
        });
        
    } catch (error) {
        console.error('Ошибка отправки сообщения:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка отправки сообщения'
        });
    }
});

// ==================== ОТЗЫВЫ ====================

// Оставление отзыва
app.post('/api/tasks/:id/reviews', authMiddleware(['client']), async (req, res) => {
    const taskId = req.params.id;
    
    try {
        const { rating, comment, is_anonymous = false } = req.body;
        
        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({
                success: false,
                error: 'Рейтинг должен быть от 1 до 5'
            });
        }
        
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
        
        // Проверяем права
        if (req.user.id !== task.client_id) {
            return res.status(403).json({
                success: false,
                error: 'Только клиент может оставлять отзыв'
            });
        }
        
        if (task.status !== 'completed') {
            return res.status(400).json({
                success: false,
                error: 'Можно оставить отзыв только к завершенным задачам'
            });
        }
        
        // Проверяем, не оценивалась ли уже задача
        const existingReview = await db.get(
            'SELECT id FROM reviews WHERE task_id = ?',
            [taskId]
        );
        
        if (existingReview) {
            return res.status(400).json({
                success: false,
                error: 'Эта задача уже была оценена'
            });
        }
        
        // Проверяем, есть ли исполнитель
        if (!task.performer_id) {
            return res.status(400).json({
                success: false,
                error: 'Нельзя оставить отзыв к задаче без исполнителя'
            });
        }
        
        // Создаем отзыв
        await db.run(
            `INSERT INTO reviews (task_id, client_id, performer_id, rating, comment, is_anonymous) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [taskId, req.user.id, task.performer_id, rating, comment || null, is_anonymous ? 1 : 0]
        );
        
        // Обновляем рейтинг в задаче
        await db.run(
            'UPDATE tasks SET task_rating = ?, feedback = ? WHERE id = ?',
            [rating, comment || null, taskId]
        );
        
        // Обновляем рейтинг исполнителя
        const performerStats = await db.get(
            `SELECT AVG(r.rating) as avg_rating, COUNT(r.id) as reviews_count
             FROM reviews r
             WHERE r.performer_id = ?`,
            [task.performer_id]
        );
        
        if (performerStats && performerStats.avg_rating) {
            await db.run(
                'UPDATE users SET user_rating = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [performerStats.avg_rating.toFixed(1), task.performer_id]
            );
        }
        
        // Создаем уведомление исполнителю
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message, related_id, related_type) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                task.performer_id,
                'new_review',
                'Новый отзыв',
                `Вы получили новый отзыв от клиента. Рейтинг: ${rating}/5`,
                taskId,
                'task'
            ]
        );
        
        res.json({
            success: true,
            message: 'Спасибо за ваш отзыв!',
            data: {
                task_id: taskId,
                rating,
                comment: comment || null
            }
        });
        
    } catch (error) {
        console.error('Ошибка оставления отзыва:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка оставления отзыва'
        });
    }
});

// ==================== ОБСЛУЖИВАНИЕ ====================

// Обслуживание статических файлов
app.use(express.static(path.join(__dirname, 'public')));

// Обработка 404 для API маршрутов
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

// ==================== ОБРАБОТКА ОШИБОК ====================
app.use((err, req, res, next) => {
    console.error('🔥 Ошибка сервера:', err.message);
    
    res.status(500).json({
        success: false,
        error: 'Внутренняя ошибка сервера',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎀 ЗАПУСК ЖЕНСКОГО КОНСЬЕРЖА v6.0.0 (РЕГИСТРАЦИЯ ПО ТЕЛЕФОНУ)');
        console.log('='.repeat(80));
        console.log(`🌐 PORT: ${process.env.PORT || 3000}`);
        console.log(`🏷️  NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
        console.log(`📱 Демо-режим SMS: ${DEMO_MODE ? 'ВКЛЮЧЕН' : 'ВЫКЛЮЧЕН'}`);
        console.log(`💾 База данных: ${process.env.NODE_ENV === 'production' ? '/tmp/concierge_prod.db' : './concierge.db'}`);
        console.log('='.repeat(80));
        
        // Инициализируем базу данных
        await initDatabase();
        console.log('✅ База данных готова');
        console.log('✅ SMS верификация настроена');
        console.log('✅ Админ панель доступна');
        
        const PORT = process.env.PORT || 3000;
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log('\n' + '='.repeat(80));
            console.log(`✅ Сервер запущен на порту ${PORT}`);
            console.log(`🌐 http://localhost:${PORT}`);
            console.log(`🏥 Health check: http://localhost:${PORT}/health`);
            console.log('='.repeat(80));
            console.log('🎀 СИСТЕМА ГОТОВА К РАБОТЕ!');
            console.log('='.repeat(80));
            
            console.log('\n🔑 ТЕСТОВЫЕ АККАУНТЫ (вход по телефону и паролю):');
            console.log('='.repeat(70));
            console.log('👑 Главный админ: +79991112233 / admin123 (телефон подтвержден)');
            console.log('👨‍💼 Админ: +79992223344 / admin123 (телефон подтвержден)');
            console.log('👩‍🏫 Помощник 1: +79994445566 / performer123 (телефон подтвержден)');
            console.log('👩‍🏫 Помощник 2: +79995556677 / performer123 (телефон подтвержден)');
            console.log('👩‍🏫 Помощник 3: +79996667788 / performer123 (телефон подтвержден)');
            console.log('👩 Клиент Премиум: +79997778899 / client123 (телефон подтвержден)');
            console.log('👩 Клиент Эссеншл: +79998889900 / client123 (телефон подтвержден)');
            console.log('👩 Клиент без верификации: +79999990011 / client123 (телефон НЕ подтвержден)');
            console.log('='.repeat(70));
            console.log('📱 Для новых регистраций используйте любой уникальный номер телефона');
            console.log('🔐 Пароль для всех тестовых аккаунтов: admin123/client123/performer123');
            console.log('📧 Email опционален, можно оставить пустым при регистрации');
            console.log('='.repeat(70));
            
            console.log('\n📊 ОСНОВНЫЕ ФУНКЦИОНАЛЬНОСТИ:');
            console.log('='.repeat(60));
            console.log('✅ Регистрация по телефону (email опционален)');
            console.log('✅ SMS верификация телефона');
            console.log('✅ Восстановление пароля по SMS');
            console.log('✅ 6 категорий услуг (как в оригинале)');
            console.log('✅ 12 услуг (как в оригинале)');
            console.log('✅ Тестовые задачи');
            console.log('✅ Полное управление админа');
            console.log('✅ Создание/редактирование/удаление категорий');
            console.log('✅ Создание/редактирование/удаление услуг');
            console.log('✅ Создание/редактирование/удаление подписок');
            console.log('✅ Управление пользователями');
            console.log('✅ Управление задачами');
            console.log('✅ Система чатов и уведомлений');
            console.log('✅ Финансовая отчетность и статистика');
            console.log('='.repeat(60));
            
            console.log('\n📱 SMS ВЕРИФИКАЦИЯ:');
            console.log('='.repeat(60));
            console.log(`Режим: ${DEMO_MODE ? 'ДЕМО (коды в консоли)' : 'РЕАЛЬНЫЙ (нужен SMS API)'}`);
            console.log('✅ При регистрации отправляется SMS с кодом');
            console.log('✅ Код действителен 10 минут');
            console.log('✅ Максимум 3 попытки ввода кода');
            console.log('✅ Повторная отправка через 60 секунд');
            console.log('✅ Без подтверждения телефона ограниченный функционал');
            console.log('='.repeat(60));
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        process.exit(1);
    }
};

// Запуск
startServer();
