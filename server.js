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

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
const app = express();

// CORS настройки
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://yourdomain.com'] 
        : ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.options('*', cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ==================== СТАТИЧЕСКИЕ ФАЙЛЫ ====================
// Обслуживание статических файлов из папки public
app.use(express.static('public', {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0
}));

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
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                first_name TEXT NOT NULL,
                last_name TEXT NOT NULL,
                phone TEXT NOT NULL,
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
        await db.exec('ROLLBACK');
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
                ['top_services_title', 'Здесь собраны самые популярные услуги', 'Заголовок для топ услуг', 'ui'],
                ['task_help_title', 'Что не забыть при формировании заказа?', 'Заголовок для помощи при создании задачи', 'ui']
            ];

            for (const setting of settings) {
                await db.run(
                    `INSERT INTO settings (key, value, description, category) VALUES (?, ?, ?, ?)`,
                    setting
                );
            }
            console.log('✅ Настройки системы созданы');
        }

        // 2. FAQ
        const faqExist = await db.get("SELECT 1 FROM faq WHERE question LIKE '%Как работает система подписок%'");
        if (!faqExist) {
            const faqs = [
                ['Как работает система подписок?', 'Вы оплачиваете вступительный взнос один раз при регистрации, затем ежемесячную плату. Все услуги в рамках вашего тарифа бесплатны для вас.', 'subscriptions', 1, 1],
                ['Можно ли изменить тариф?', 'Да, вы можете изменить тариф в любой момент. Разница в стоимости будет учтена при следующем платеже.', 'subscriptions', 2, 1],
                ['Что входит в вступительный взнос?', 'Вступительный взнос покрывает расходы на проверку и обучение помощниц, а также страховку качества услуг.', 'payments', 3, 1],
                ['Как отменить подписку?', 'Вы можете отменить подписку в любое время в разделе "Мой профиль". Подписка останется активной до конца оплаченного периода.', 'subscriptions', 4, 1],
                ['Как выбираются помощницы?', 'Все наши помощницы проходят строгий отбор, проверку документов и обучение. Вы можете видеть их рейтинг и отзывы перед выбором.', 'performers', 5, 1],
                ['Что делать, если не устроило качество услуги?', 'Мы гарантируем возврат средств или повторное оказание услуги, если качество не устроило. Свяжитесь с нашей поддержкой.', 'quality', 6, 1]
            ];

            for (const faq of faqs) {
                await db.run(
                    `INSERT INTO faq (question, answer, category, sort_order, is_active) VALUES (?, ?, ?, ?, ?)`,
                    faq
                );
            }
            console.log('✅ FAQ созданы');
        }

        // 3. Подписки
        const subscriptionsExist = await db.get("SELECT 1 FROM subscriptions WHERE name = 'essential'");
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
                await db.run(
                    `INSERT INTO subscriptions 
                    (name, display_name, description, price_monthly, price_yearly, 
                     initial_fee, tasks_limit, features, color_theme, sort_order, is_popular, is_active) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    sub
                );
            }
            console.log('✅ Тарифы подписок созданы');
        }

        // 4. Категории услуг
        const categoriesExist = await db.get("SELECT 1 FROM categories WHERE name = 'home_and_household'");
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
                await db.run(
                    `INSERT INTO categories 
                    (name, display_name, description, icon, color, sort_order, is_active) 
                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    cat
                );
            }
            console.log('✅ Категории услуг созданы');
        }

        // 5. Услуги
        const servicesExist = await db.get("SELECT 1 FROM services WHERE name = 'Уборка квартиры'");
        if (!servicesExist) {
            // Получаем ID категорий
            const categories = await db.all("SELECT id, name FROM categories");
            const categoryMap = {};
            categories.forEach(cat => categoryMap[cat.name] = cat.id);

            // Услуги
            const services = [
                // Дом и быт
                [categoryMap.home_and_household, 'Уборка квартиры', 'Генеральная или поддерживающая уборка квартиры', 0, '2-4 часа', 1, 1, 1],
                [categoryMap.home_and_household, 'Химчистка мебели', 'Профессиональная химчистка диванов, кресел, матрасов', 0, '3-5 часов', 1, 2, 0],
                [categoryMap.home_and_household, 'Стирка и глажка', 'Стирка, сушка и глажка белья', 0, '2-3 часа', 1, 3, 0],
                [categoryMap.home_and_household, 'Приготовление еды', 'Приготовление блюд на день или неделю', 0, '3-4 часа', 1, 4, 1],
                
                // Дети и семья
                [categoryMap.family_and_children, 'Няня на час', 'Присмотр за детьми на несколько часов', 0, '1 час', 1, 5, 1],
                [categoryMap.family_and_children, 'Репетитор для ребенка', 'Помощь с уроками по школьным предметам', 0, '1 час', 1, 6, 0],
                
                // Красота и здоровье
                [categoryMap.beauty_and_health, 'Маникюр на дому', 'Профессиональный маникюр с выездом', 0, '1.5 часа', 1, 7, 1],
                [categoryMap.beauty_and_health, 'Стрижка и укладка', 'Парикмахерские услуги на дому', 0, '2 часа', 1, 8, 0],
                [categoryMap.beauty_and_health, 'Массаж', 'Расслабляющий или лечебный массаж', 0, '1 час', 1, 9, 1],
                
                // Курсы и образование
                [categoryMap.courses_and_education, 'Репетиторство', 'Индивидуальные занятия по предметам', 0, '1 час', 1, 10, 1],
                
                // Покупки и доставка
                [categoryMap.shopping_and_delivery, 'Покупка продуктов', 'Покупка и доставка продуктов', 0, '1-2 часа', 1, 11, 1],
                [categoryMap.shopping_and_delivery, 'Доставка документов', 'Срочная доставка документов', 0, '1 час', 1, 12, 0]
            ];

            for (const service of services) {
                await db.run(
                    `INSERT INTO services 
                    (category_id, name, description, base_price, estimated_time, is_active, sort_order, is_featured) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    service
                );
            }
            console.log('✅ Услуги созданы (12 услуг)');
        }

        // 6. Тестовые пользователи
        const usersExist = await db.get("SELECT 1 FROM users WHERE email = 'superadmin@concierge.ru'");
        if (!usersExist) {
            const passwordHash = await bcrypt.hash('admin123', 12);
            const clientPasswordHash = await bcrypt.hash('client123', 12);
            const performerPasswordHash = await bcrypt.hash('performer123', 12);
            
            const expiryDate = new Date();
            expiryDate.setFullYear(expiryDate.getFullYear() + 1);
            const expiryDateStr = expiryDate.toISOString().split('T')[0];

            // Главный админ с ID 898508164
            const adminId = 898508164;
            
            // Пользователи с фиксированными ID для тестирования
            const users = [
                // Главный админ (ID 898508164)
                [adminId, 'superadmin@concierge.ru', passwordHash, 'Александр', 'Иванов', '+79991112233', 'superadmin', 'premium', 'active', expiryDateStr, 'https://ui-avatars.com/api/?name=Александр+Иванов&background=9B59B6&color=fff&bold=true', 0, 1000, 1, 1000, 999, 3, 5, 0, 4.9, 100, 1, 1, null, null, null],
                
                // Администраторы
                [2, 'admin@concierge.ru', passwordHash, 'Мария', 'Петрова', '+79992223344', 'admin', 'premium', 'active', expiryDateStr, 'https://ui-avatars.com/api/?name=Мария+Петрова&background=2ECC71&color=fff&bold=true', 0, 1000, 1, 1000, 999, 2, 5, 0, 4.8, 50, 1, 1, null, null, null],
                
                // Помощники
                [3, 'performer1@concierge.ru', performerPasswordHash, 'Анна', 'Кузнецова', '+79994445566', 'performer', 'essential', 'active', expiryDateStr, 'https://ui-avatars.com/api/?name=Анна+Кузнецова&background=3498DB&color=fff&bold=true', 0, 500, 1, 500, 20, 5, 5, 0, 4.5, 30, 1, 1, null, null, null],
                [4, 'performer2@concierge.ru', performerPasswordHash, 'Мария', 'Смирнова', '+79995556677', 'performer', 'essential', 'active', expiryDateStr, 'https://ui-avatars.com/api/?name=Мария+Смирнова&background=3498DB&color=fff&bold=true', 0, 500, 1, 500, 20, 8, 5, 0, 4.6, 45, 1, 1, null, null, null],
                [5, 'performer3@concierge.ru', performerPasswordHash, 'Ирина', 'Васильева', '+79996667788', 'performer', 'premium', 'active', expiryDateStr, 'https://ui-avatars.com/api/?name=Ирина+Васильева&background=3498DB&color=fff&bold=true', 0, 1000, 1, 1000, 50, 15, 5, 0, 4.8, 60, 1, 1, null, null, null],
                
                // Клиенты
                [6, 'client1@example.com', clientPasswordHash, 'Елена', 'Васильева', '+79997778899', 'client', 'premium', 'active', expiryDateStr, 'https://ui-avatars.com/api/?name=Елена+Васильева&background=FF6B8B&color=fff&bold=true', 0, 1000, 1, 1000, 999, 2, 5, 0, 4.0, 10, 1, 1, null, null, null],
                [7, 'client2@example.com', clientPasswordHash, 'Наталья', 'Федорова', '+79998889900', 'client', 'essential', 'active', expiryDateStr, 'https://ui-avatars.com/api/?name=Наталья+Федорова&background=FF6B8B&color=fff&bold=true', 0, 500, 1, 500, 5, 1, 5, 0, 4.5, 3, 1, 1, null, null, null],
                [8, 'client3@example.com', clientPasswordHash, 'Оксана', 'Николаева', '+79999990011', 'client', 'essential', 'pending', null, 'https://ui-avatars.com/api/?name=Оксана+Николаева&background=FF6B8B&color=fff&bold=true', 0, 500, 0, 500, 5, 0, 5, 0, 0, 0, 1, 1, null, null, null]
            ];

            for (const user of users) {
                const [id, email, password, first_name, last_name, phone, role, subscription_plan, subscription_status, subscription_expires, avatar_url, balance, initial_fee_amount, initial_fee_paid, initial_fee_amount2, tasks_limit, tasks_used, tasks_limit2, total_spent, user_rating, completed_tasks, is_active, email_verified, verification_token, reset_token, reset_token_expires] = user;
                
                await db.run(
                    `INSERT INTO users 
                    (id, email, password, first_name, last_name, phone, role, 
                     subscription_plan, subscription_status, subscription_expires,
                     avatar_url, balance, initial_fee_paid, initial_fee_amount, 
                     tasks_limit, tasks_used, total_spent, user_rating, completed_tasks, 
                     is_active, email_verified, verification_token, reset_token, reset_token_expires) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [id, email, password, first_name, last_name, phone, role,
                     subscription_plan, subscription_status, subscription_expires,
                     avatar_url, balance, initial_fee_paid, initial_fee_amount, 
                     tasks_limit, tasks_used, total_spent || 0, user_rating, completed_tasks,
                     is_active, email_verified, verification_token, reset_token, reset_token_expires]
                );
            }
            console.log('✅ Тестовые пользователи созданы');
            
            // Назначаем помощников к категориям
            const categories = await db.all("SELECT id FROM categories");
            const performers = await db.all("SELECT id FROM users WHERE role = 'performer' AND id >= 3 AND id <= 5");
            
            for (const performer of performers) {
                // Каждый помощник специализируется на 2-3 категориях
                const categoryIds = categories
                    .sort(() => Math.random() - 0.5)
                    .slice(0, 2 + Math.floor(Math.random() * 2))
                    .map(c => c.id);
                
                for (const categoryId of categoryIds) {
                    await db.run(
                        `INSERT OR IGNORE INTO performer_categories (performer_id, category_id, experience_years, hourly_rate) 
                         VALUES (?, ?, ?, ?)`,
                        [performer.id, categoryId, Math.floor(Math.random() * 5) + 1, Math.floor(Math.random() * 500) + 500]
                    );
                }
            }
            console.log('✅ Назначения помощников по категориям созданы');
            
            // Создаем тестовые задачи
            const clients = await db.all("SELECT id FROM users WHERE role = 'client' AND subscription_status = 'active' AND id >= 6 AND id <= 7");
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
                
                for (let i = 0; i < 5; i++) {
                    const client = clients[Math.floor(Math.random() * clients.length)];
                    const category = categoriesList[Math.floor(Math.random() * categoriesList.length)];
                    const service = servicesList[Math.floor(Math.random() * servicesList.length)];
                    const performer = performers[Math.floor(Math.random() * performers.length)];
                    
                    const taskNumber = `TASK-202412${(i + 1).toString().padStart(2, '0')}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
                    
                    const statuses = ['new', 'searching', 'assigned', 'in_progress', 'completed'];
                    const status = statuses[Math.floor(Math.random() * statuses.length)];
                    
                    const deadline = new Date();
                    deadline.setDate(deadline.getDate() + Math.floor(Math.random() * 7) + 1);
                    
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
                    
                    if (status !== 'new') {
                        await db.run(
                            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
                             VALUES (?, ?, ?, ?)`,
                            [taskId, 'searching', client.id, 'Поиск исполнителя']
                        );
                    }
                    
                    if (status === 'assigned' || status === 'in_progress' || status === 'completed') {
                        await db.run(
                            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
                             VALUES (?, ?, ?, ?)`,
                            [taskId, 'assigned', performer.id, 'Исполнитель назначен']
                        );
                    }
                    
                    if (status === 'in_progress' || status === 'completed') {
                        await db.run(
                            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
                             VALUES (?, ?, ?, ?)`,
                            [taskId, 'in_progress', performer.id, 'Исполнитель начал работу']
                        );
                    }
                    
                    if (status === 'completed') {
                        await db.run(
                            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
                             VALUES (?, ?, ?, ?)`,
                            [taskId, 'completed', performer.id, 'Задача выполнена']
                        );
                        
                        // Для завершенных задач добавляем отзывы
                        await db.run(
                            `INSERT INTO reviews (task_id, client_id, performer_id, rating, comment, is_anonymous) 
                             VALUES (?, ?, ?, ?, ?, ?)`,
                            [taskId, client.id, performer.id, Math.floor(Math.random() * 2) + 4, 'Отличная работа! Быстро и качественно.', 0]
                        );
                    }
                }
                console.log('✅ Тестовые задачи созданы (5 задач)');
            }
        }

        console.log('🎉 Все начальные данные созданы!');
        
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
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
};

const validatePhone = (phone) => {
    const re = /^\+?[1-9]\d{10,14}$/;
    return re.test(phone.replace(/\D/g, ''));
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
                'POST /api/auth/forgot-password',
                'POST /api/auth/reset-password/*',
                'OPTIONS /*',
                'GET /admin.html',
                'GET /index.html'
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
                    `SELECT id, email, first_name, last_name, phone, role, 
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

// ==================== ОСНОВНЫЕ МАРШРУТЫ ====================

// Главная страница приложения
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Админ панель
app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Главный API маршрут
app.get('/api', (req, res) => {
    res.json({
        success: true,
        message: '🌸 Добро пожаловать в Женский Консьерж API',
        version: '5.4.0',
        status: '🟢 Работает',
        endpoints: {
            auth: '/api/auth/*',
            categories: '/api/categories',
            subscriptions: '/api/subscriptions',
            tasks: '/api/tasks',
            admin: '/api/admin/*'
        },
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
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            urls: {
                app: 'http://localhost:3000',
                admin: 'http://localhost:3000/admin.html',
                api: 'http://localhost:3000/api'
            }
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

// Регистрация
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, first_name, last_name, phone, subscription_plan = 'essential', role = 'client' } = req.body;
        
        // Валидация
        if (!email || !password || !first_name || !last_name || !phone) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля'
            });
        }
        
        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'Пароль должен содержать не менее 6 символов'
            });
        }
        
        if (!validateEmail(email)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный email адрес'
            });
        }
        
        if (!validatePhone(phone)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный номер телефона'
            });
        }
        
        // Проверяем существующего пользователя
        const existingUser = await db.get('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUser) {
            return res.status(409).json({
                success: false,
                error: 'Пользователь с таким email уже существует'
            });
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
        let avatarBgColor = 'FF6B8B';
        if (role === 'performer') {
            avatarBgColor = '3498DB';
        } else if (role === 'admin' || role === 'manager') {
            avatarBgColor = '2ECC71';
        } else if (role === 'superadmin') {
            avatarBgColor = '9B59B6';
        }
        
        const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(first_name)}+${encodeURIComponent(last_name)}&background=${avatarBgColor}&color=fff&bold=true`;
        
        // Создание пользователя
        const result = await db.run(
            `INSERT INTO users 
            (email, password, first_name, last_name, phone, role, 
             subscription_plan, subscription_status, subscription_expires,
             initial_fee_paid, initial_fee_amount, tasks_limit, avatar_url,
             verification_token) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                email,
                hashedPassword,
                first_name,
                last_name,
                phone,
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
        }
        
        // Для исполнителей автоматически добавляем все специализации
        if (role === 'performer') {
            const categories = await db.all('SELECT id FROM categories WHERE is_active = 1');
            for (const category of categories) {
                await db.run(
                    `INSERT INTO performer_categories (performer_id, category_id, is_active) 
                     VALUES (?, ?, 1)`,
                    [userId, category.id]
                );
            }
        }
        
        // Создаем приветственное уведомление
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message) 
            VALUES (?, ?, ?, ?)`,
            [
                userId,
                'welcome',
                'Добро пожаловать!',
                role === 'performer' 
                    ? 'Спасибо за регистрацию в качестве помощницы. Теперь вы можете принимать задачи от клиентов.'
                    : role === 'client'
                    ? 'Спасибо за регистрацию в Женском Консьерже. Для начала работы оплатите вступительный взнос и выберите услугу.'
                    : 'Добро пожаловать в админ панель Женского Консьержа.'
            ]
        );
        
        // Получаем созданного пользователя
        const user = await db.get(
            `SELECT id, email, first_name, last_name, phone, role, 
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
        
        // Создаем JWT токен
        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
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
            message: 'Регистрация успешно завершена!',
            data: { 
                user: userForResponse,
                token,
                requires_initial_fee: !initialFeePaid,
                initial_fee_amount: subscription.initial_fee
            }
        });
        
    } catch (error) {
        console.error('Ошибка регистрации:', error);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера при регистрации'
        });
    }
});

// Вход
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Email и пароль обязательны'
            });
        }
        
        // Находим пользователя
        const user = await db.get(
            `SELECT * FROM users WHERE email = ? AND is_active = 1`,
            [email]
        );
        
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Неверный email или пароль'
            });
        }
        
        // Проверяем пароль
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                error: 'Неверный email или пароль'
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
                    email: user.email,
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
                email: user.email, 
                role: user.role,
                first_name: user.first_name,
                last_name: user.last_name,
                subscription_plan: user.subscription_plan,
                initial_fee_paid: user.initial_fee_paid
            },
            process.env.JWT_SECRET || 'concierge-secret-key-2024-prod',
            { expiresIn: '30d' }
        );
        
        res.json({
            success: true,
            message: 'Вход выполнен успешно!',
            data: { 
                user: userForResponse,
                token 
            }
        });
        
    } catch (error) {
        console.error('Ошибка входа:', error);
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
            `SELECT id, email, first_name, last_name, phone, role, 
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
        console.error('Ошибка проверки токена:', error);
        res.status(401).json({
            success: false,
            error: 'Неверный токен'
        });
    }
});

// Профиль пользователя
app.get('/api/auth/profile', authMiddleware(), async (req, res) => {
    try {
        const user = await db.get(
            `SELECT id, email, first_name, last_name, phone, role, 
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
        console.error('Ошибка получения профиля:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения профиля'
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
        console.error('Ошибка получения категорий:', error);
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
        console.error('Ошибка получения услуг категории:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения услуг категории'
        });
    }
});

// Получение всех услуг
app.get('/api/services', async (req, res) => {
    try {
        const services = await db.all(
            `SELECT s.*, c.display_name as category_name
             FROM services s
             LEFT JOIN categories c ON s.category_id = c.id
             WHERE s.is_active = 1
             ORDER BY s.is_featured DESC, s.sort_order ASC, s.name ASC`
        );
        
        res.json({
            success: true,
            data: {
                services,
                count: services.length
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
        console.error('Ошибка получения FAQ:', error);
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
        console.error('Ошибка получения отзывов:', error);
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
        console.error('Ошибка получения подписок:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения подписок'
        });
    }
});

// Оплата вступительного взноса и активация подписки
app.post('/api/subscriptions/subscribe', authMiddleware(['client']), async (req, res) => {
    try {
        const { plan, initial_fee_paid } = req.body;
        
        if (!plan) {
            return res.status(400).json({
                success: false,
                error: 'Не указан тарифный план'
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
                error: 'Тарифный план не найдена'
            });
        }
        
        // Проверяем, нужно ли оплатить вступительный взнос
        if (!initial_fee_paid && subscription.initial_fee > 0) {
            // Проверяем баланс
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
            
            // Создаем уведомление
            await db.run(
                `INSERT INTO notifications 
                (user_id, type, title, message) 
                VALUES (?, ?, ?, ?)`,
                [
                    req.user.id,
                    'subscription_changed',
                    'Тариф изменен',
                    `Ваш тариф изменен на "${subscription.display_name}".`
                ]
            );
        }
        
        // Получаем обновленного пользователя
        const updatedUser = await db.get(
            `SELECT id, email, first_name, last_name, role, 
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
        console.error('Ошибка активации подписки:', error);
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
                'SELECT subscription_status, initial_fee_paid, tasks_limit, tasks_used FROM users WHERE id = ?',
                [req.user.id]
            );
            
            if (!user || user.subscription_status !== 'active') {
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
        console.error('Ошибка создания задачи:', error);
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
        console.error('Ошибка получения задач:', error);
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
        console.error('Ошибка получения задачи:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения задачи'
        });
    }
});

// Принятие задачи исполнителем
app.post('/api/tasks/:id/take', authMiddleware(['performer']), async (req, res) => {
    const taskId = req.params.id;
    
    try {
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
        console.error('Ошибка принятия задачи:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка принятия задачи'
        });
    }
});

// ==================== НАСТРОЙКИ СИСТЕМЫ ====================

// Получение настроек системы
app.get('/api/settings', async (req, res) => {
    try {
        const settings = await db.all('SELECT * FROM settings');
        
        // Преобразуем в объект
        const settingsObj = {};
        settings.forEach(setting => {
            settingsObj[setting.key] = setting.value;
        });
        
        res.json({
            success: true,
            data: settingsObj
        });
        
    } catch (error) {
        console.error('Ошибка получения настроек:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения настроек'
        });
    }
});

// ==================== АДМИН ПАНЕЛЬ ====================

// Статистика админ панели
app.get('/api/admin/stats', authMiddleware(['admin', 'manager', 'superadmin']), async (req, res) => {
    try {
        // Общая статистика
        const totalUsers = await db.get('SELECT COUNT(*) as count FROM users WHERE is_active = 1');
        const totalTasks = await db.get('SELECT COUNT(*) as count FROM tasks');
        const totalIncome = await db.get('SELECT SUM(amount) as total FROM transactions WHERE amount < 0 AND status = "completed"');
        const activeSubscriptions = await db.get('SELECT COUNT(*) as count FROM users WHERE subscription_status = "active" AND is_active = 1');
        
        // Статистика по задачам
        const taskStats = await db.all(`
            SELECT 
                status,
                COUNT(*) as count
            FROM tasks 
            GROUP BY status
        `);
        
        // Доход по месяцам
        const monthlyIncome = await db.all(`
            SELECT 
                strftime('%Y-%m', created_at) as month,
                SUM(amount) as total
            FROM transactions 
            WHERE amount < 0 AND status = 'completed'
            GROUP BY strftime('%Y-%m', created_at)
            ORDER BY month DESC
            LIMIT 6
        `);
        
        res.json({
            success: true,
            data: {
                total_users: totalUsers?.count || 0,
                total_tasks: totalTasks?.count || 0,
                total_income: Math.abs(totalIncome?.total || 0),
                active_subscriptions: activeSubscriptions?.count || 0,
                task_stats: taskStats,
                monthly_income: monthlyIncome
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

// Управление категориями (админ)
app.get('/api/admin/categories', authMiddleware(['admin', 'manager', 'superadmin']), async (req, res) => {
    try {
        const categories = await db.all('SELECT * FROM categories ORDER BY sort_order ASC');
        
        res.json({
            success: true,
            data: { categories }
        });
    } catch (error) {
        console.error('Ошибка получения категорий:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения категорий'
        });
    }
});

// Добавление/обновление категории (админ)
app.post('/api/admin/categories', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const { id, name, display_name, description, icon, color, sort_order, is_active } = req.body;
        
        if (!name || !display_name || !description || !icon) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля'
            });
        }
        
        if (id) {
            // Обновление существующей категории
            await db.run(
                `UPDATE categories SET 
                    name = ?, display_name = ?, description = ?, icon = ?, 
                    color = ?, sort_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP 
                 WHERE id = ?`,
                [name, display_name, description, icon, color || '#FF6B8B', sort_order || 0, is_active || 1, id]
            );
            
            res.json({
                success: true,
                message: 'Категория обновлена'
            });
        } else {
            // Создание новой категории
            await db.run(
                `INSERT INTO categories 
                (name, display_name, description, icon, color, sort_order, is_active) 
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [name, display_name, description, icon, color || '#FF6B8B', sort_order || 0, is_active || 1]
            );
            
            res.json({
                success: true,
                message: 'Категория создана'
            });
        }
    } catch (error) {
        console.error('Ошибка сохранения категории:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сохранения категории'
        });
    }
});

// Управление услугами (админ)
app.get('/api/admin/services', authMiddleware(['admin', 'manager', 'superadmin']), async (req, res) => {
    try {
        const services = await db.all(`
            SELECT s.*, c.display_name as category_name 
            FROM services s
            LEFT JOIN categories c ON s.category_id = c.id
            ORDER BY s.sort_order ASC
        `);
        
        res.json({
            success: true,
            data: { services }
        });
    } catch (error) {
        console.error('Ошибка получения услуг:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения услуг'
        });
    }
});

// Добавление/обновление услуги (админ)
app.post('/api/admin/services', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const { id, category_id, name, description, base_price, estimated_time, sort_order, is_active, is_featured } = req.body;
        
        if (!category_id || !name || !description) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля'
            });
        }
        
        if (id) {
            // Обновление существующей услуги
            await db.run(
                `UPDATE services SET 
                    category_id = ?, name = ?, description = ?, base_price = ?, 
                    estimated_time = ?, sort_order = ?, is_active = ?, is_featured = ?, 
                    updated_at = CURRENT_TIMESTAMP 
                 WHERE id = ?`,
                [category_id, name, description, base_price || 0, estimated_time || null, 
                 sort_order || 0, is_active || 1, is_featured || 0, id]
            );
            
            res.json({
                success: true,
                message: 'Услуга обновлена'
            });
        } else {
            // Создание новой услуги
            await db.run(
                `INSERT INTO services 
                (category_id, name, description, base_price, estimated_time, 
                 sort_order, is_active, is_featured) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [category_id, name, description, base_price || 0, estimated_time || null,
                 sort_order || 0, is_active || 1, is_featured || 0]
            );
            
            res.json({
                success: true,
                message: 'Услуга создана'
            });
        }
    } catch (error) {
        console.error('Ошибка сохранения услуги:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сохранения услуги'
        });
    }
});

// Управление подписками (админ)
app.get('/api/admin/subscriptions', authMiddleware(['admin', 'manager', 'superadmin']), async (req, res) => {
    try {
        const subscriptions = await db.all('SELECT * FROM subscriptions ORDER BY sort_order ASC');
        
        // Парсим features из JSON строки
        const subscriptionsWithParsedFeatures = subscriptions.map(sub => ({
            ...sub,
            features: typeof sub.features === 'string' ? JSON.parse(sub.features) : sub.features
        }));
        
        res.json({
            success: true,
            data: { subscriptions: subscriptionsWithParsedFeatures }
        });
    } catch (error) {
        console.error('Ошибка получения подписок:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения подписок'
        });
    }
});

// Добавление/обновление подписки (админ)
app.post('/api/admin/subscriptions', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    try {
        const { id, name, display_name, description, price_monthly, price_yearly, 
                initial_fee, tasks_limit, features, color_theme, sort_order, is_popular, is_active } = req.body;
        
        if (!name || !display_name || !description || price_monthly === undefined || 
            price_yearly === undefined || tasks_limit === undefined) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля'
            });
        }
        
        // Преобразуем features в JSON строку если это массив
        let featuresJson = features;
        if (Array.isArray(features)) {
            featuresJson = JSON.stringify(features);
        }
        
        if (id) {
            // Обновление существующей подписки
            await db.run(
                `UPDATE subscriptions SET 
                    name = ?, display_name = ?, description = ?, price_monthly = ?, 
                    price_yearly = ?, initial_fee = ?, tasks_limit = ?, features = ?,
                    color_theme = ?, sort_order = ?, is_popular = ?, is_active = ?, 
                    updated_at = CURRENT_TIMESTAMP 
                 WHERE id = ?`,
                [name, display_name, description, price_monthly, price_yearly, 
                 initial_fee || 0, tasks_limit, featuresJson, color_theme || '#FF6B8B',
                 sort_order || 0, is_popular || 0, is_active || 1, id]
            );
            
            res.json({
                success: true,
                message: 'Подписка обновлена'
            });
        } else {
            // Создание новой подписки
            await db.run(
                `INSERT INTO subscriptions 
                (name, display_name, description, price_monthly, price_yearly, 
                 initial_fee, tasks_limit, features, color_theme, sort_order, is_popular, is_active) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [name, display_name, description, price_monthly, price_yearly, 
                 initial_fee || 0, tasks_limit, featuresJson, color_theme || '#FF6B8B',
                 sort_order || 0, is_popular || 0, is_active || 1]
            );
            
            res.json({
                success: true,
                message: 'Подписка создана'
            });
        }
    } catch (error) {
        console.error('Ошибка сохранения подписки:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сохранения подписки'
        });
    }
});

// Управление пользователями (админ)
app.get('/api/admin/users', authMiddleware(['admin', 'manager', 'superadmin']), async (req, res) => {
    try {
        const { limit = 50, offset = 0, role, search } = req.query;
        
        let query = `
            SELECT id, email, first_name, last_name, phone, role, 
                   subscription_plan, subscription_status, subscription_expires,
                   avatar_url, balance, initial_fee_paid, is_active, 
                   user_rating, completed_tasks, created_at
            FROM users
            WHERE 1=1
        `;
        
        const params = [];
        
        if (role && role !== 'all') {
            query += ' AND role = ?';
            params.push(role);
        }
        
        if (search) {
            query += ' AND (email LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR phone LIKE ?)';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }
        
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const users = await db.all(query, params);
        
        // Переименовываем user_rating в rating для фронтенда
        const usersWithRating = users.map(user => ({
            ...user,
            rating: user.user_rating
        }));
        
        // Получаем общее количество
        let countQuery = 'SELECT COUNT(*) as total FROM users WHERE 1=1';
        let countParams = [];
        
        if (role && role !== 'all') {
            countQuery += ' AND role = ?';
            countParams.push(role);
        }
        
        if (search) {
            countQuery += ' AND (email LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR phone LIKE ?)';
            const searchTerm = `%${search}%`;
            countParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }
        
        const countResult = await db.get(countQuery, countParams);
        
        res.json({
            success: true,
            data: {
                users: usersWithRating,
                pagination: {
                    total: countResult?.total || 0,
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    pages: Math.ceil((countResult?.total || 0) / parseInt(limit))
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения пользователей:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения пользователей'
        });
    }
});

// Управление задачами (админ)
app.get('/api/admin/tasks', authMiddleware(['admin', 'manager', 'superadmin']), async (req, res) => {
    try {
        const { limit = 50, offset = 0, status, search } = req.query;
        
        let query = `
            SELECT t.*, 
                   c.display_name as category_name,
                   u1.first_name as client_first_name,
                   u1.last_name as client_last_name,
                   u2.first_name as performer_first_name,
                   u2.last_name as performer_last_name
            FROM tasks t
            LEFT JOIN categories c ON t.category_id = c.id
            LEFT JOIN users u1 ON t.client_id = u1.id
            LEFT JOIN users u2 ON t.performer_id = u2.id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (status && status !== 'all') {
            query += ' AND t.status = ?';
            params.push(status);
        }
        
        if (search) {
            query += ' AND (t.title LIKE ? OR t.task_number LIKE ? OR t.description LIKE ?)';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm);
        }
        
        query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const tasks = await db.all(query, params);
        
        res.json({
            success: true,
            data: {
                tasks,
                pagination: {
                    limit: parseInt(limit),
                    offset: parseInt(offset)
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения задач:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения задач'
        });
    }
});

// ==================== ОБСЛУЖИВАНИЕ СТАТИЧЕСКИХ ФАЙЛОВ ====================

// SPA маршрутизация для приложения
app.get('*', (req, res) => {
    // Если это API маршрут - возвращаем 404
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({
            success: false,
            error: 'API маршрут не найден'
        });
    }
    
    // Для всех остальных маршрутов отдаем index.html
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== ОБРАБОТКА ОШИБОК ====================
app.use((err, req, res, next) => {
    console.error('🔥 Ошибка сервера:', err.message);
    console.error('Stack:', err.stack);
    
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
        console.log('🎀 ЗАПУСК ЖЕНСКОГО КОНСЬЕРЖА v5.4.0 (ПОЛНАЯ ВЕРСИЯ)');
        console.log('='.repeat(80));
        console.log(`🌐 PORT: ${process.env.PORT || 3000}`);
        console.log(`🏷️  NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
        console.log(`💾 База данных: ${process.env.NODE_ENV === 'production' ? '/tmp/concierge_prod.db' : './concierge.db'}`);
        console.log('='.repeat(80));
        
        // Инициализируем базу данных
        await initDatabase();
        console.log('✅ База данных готова');
        
        const PORT = process.env.PORT || 3000;
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log('\n' + '='.repeat(80));
            console.log(`✅ Сервер запущен на порту ${PORT}`);
            console.log('='.repeat(80));
            console.log('\n🌐 ДОСТУПНЫЕ ССЫЛКИ:');
            console.log('='.repeat(60));
            console.log(`🏠 Основное приложение:`);
            console.log(`   👉 http://localhost:${PORT}`);
            console.log(`\n👑 Админ-панель:`);
            console.log(`   👉 http://localhost:${PORT}/admin.html`);
            console.log(`\n📊 API и здоровье системы:`);
            console.log(`   👉 http://localhost:${PORT}/api`);
            console.log(`   👉 http://localhost:${PORT}/health`);
            console.log('='.repeat(60));
            
            console.log('\n🔑 ТЕСТОВЫЕ АККАУНТЫ:');
            console.log('='.repeat(60));
            console.log('👑 Главный админ (ID 898508164): superadmin@concierge.ru / admin123');
            console.log('👨‍💼 Админ: admin@concierge.ru / admin123');
            console.log('👩‍🏫 Помощник 1: performer1@concierge.ru / performer123');
            console.log('👩‍🏫 Помощник 2: performer2@concierge.ru / performer123');
            console.log('👩‍🏫 Помощник 3: performer3@concierge.ru / performer123');
            console.log('👩 Клиент Премиум: client1@example.com / client123');
            console.log('👩 Клиент Эссеншл: client2@example.com / client123');
            console.log('👩 Клиент без оплаты: client3@example.com / client123');
            console.log('='.repeat(60));
            
            console.log('\n⚡ ОСНОВНЫЕ ФУНКЦИОНАЛЬНОСТИ:');
            console.log('='.repeat(60));
            console.log('✅ Полнофункциональное приложение');
            console.log('✅ Полная админ-панель');
            console.log('✅ 6 категорий услуг');
            console.log('✅ 12 услуг');
            console.log('✅ Система подписок');
            console.log('✅ Создание и управление задачами');
            console.log('✅ Чат в реальном времени');
            console.log('✅ Система отзывов и рейтингов');
            console.log('✅ Управление пользователями');
            console.log('✅ Финансовая отчетность');
            console.log('✅ FAQ и поддержка');
            console.log('='.repeat(60));
            
            console.log('\n📊 АДМИН ВОЗМОЖНОСТИ:');
            console.log('='.repeat(60));
            console.log('👥 Управление пользователями');
            console.log('📋 Управление задачами');
            console.log('💰 Финансовая отчетность');
            console.log('⚙️  Настройки системы');
            console.log('📊 Статистика');
            console.log('💾 Управление категориями и услугами');
            console.log('='.repeat(60));
            
            console.log('\n🚀 СИСТЕМА ГОТОВА К РАБОТЕ!');
            console.log('='.repeat(60));
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
};

// Запуск
startServer();
