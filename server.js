// server.js - полная версия с полным функционалом
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
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5500', 'http://127.0.0.1:5500'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.options('*', cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// ==================== БАЗА ДАННЫХ ====================
let db;

const initDatabase = async () => {
    try {
        console.log('🔄 Инициализация базы данных...');
        
        const dbPath = './concierge.db';
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

        // Пользователи (полная версия)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                first_name TEXT NOT NULL,
                last_name TEXT NOT NULL,
                phone TEXT,
                role TEXT DEFAULT 'client' CHECK(role IN ('guest', 'client', 'performer', 'admin', 'manager', 'superadmin')),
                subscription_plan TEXT DEFAULT 'free',
                subscription_status TEXT DEFAULT 'active',
                subscription_expires DATE,
                avatar_url TEXT,
                balance REAL DEFAULT 0,
                initial_fee_paid INTEGER DEFAULT 1,
                initial_fee_amount REAL DEFAULT 0,
                tasks_limit INTEGER DEFAULT 5,
                tasks_used INTEGER DEFAULT 0,
                user_rating REAL DEFAULT 0,
                completed_tasks INTEGER DEFAULT 0,
                total_spent REAL DEFAULT 0,
                bio TEXT,
                city TEXT,
                birth_date DATE,
                profession TEXT,
                education TEXT,
                experience TEXT,
                skills TEXT,
                vk_url TEXT,
                instagram_url TEXT,
                telegram_username TEXT,
                website_url TEXT,
                is_active INTEGER DEFAULT 1,
                email_verified INTEGER DEFAULT 1,
                verification_token TEXT,
                reset_token TEXT,
                reset_token_expires TIMESTAMP,
                last_login TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Подписки (4 тарифа как в index.html)
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
                is_featured INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Категории услуг (10 категорий как в index.html)
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

        // Услуги (расширенные)
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

        // Задачи (полная версия)
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
                status TEXT DEFAULT 'new' CHECK(status IN ('new', 'searching', 'assigned', 'in_progress', 'completed', 'cancelled')),
                priority TEXT DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
                budget REAL,
                address TEXT,
                deadline DATETIME,
                contact_info TEXT,
                additional_requirements TEXT,
                requirements_experience INTEGER DEFAULT 0,
                requirements_certified INTEGER DEFAULT 0,
                requirements_reviews INTEGER DEFAULT 0,
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

        // История статусов задач
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

        // Сообщения в чате (полная версия)
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

        // Отзывы (полная версия)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                client_id INTEGER NOT NULL,
                performer_id INTEGER NOT NULL,
                rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
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

        // Специализации исполнителей
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

        // Транзакции (полная версия)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL CHECK(type IN ('deposit', 'withdrawal', 'subscription', 'task_payment', 'initial_fee', 'refund', 'subscription_renewal', 'subscription_reactivation')),
                amount REAL NOT NULL,
                description TEXT NOT NULL,
                status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'failed', 'refunded')),
                payment_method TEXT,
                payment_id TEXT,
                metadata TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Уведомления (полная версия)
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
                ['system_fee_percent', '10', 'Комиссия системы (%)', 'financial'],
                ['min_task_price', '0', 'Минимальная цена задачи', 'financial'],
                ['max_task_price', '100000', 'Максимальная цена задачи', 'financial']
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
        const faqExist = await db.get("SELECT 1 FROM faq WHERE question LIKE '%Как работает система%'");
        if (!faqExist) {
            const faqs = [
                ['Как работает система подписок?', 'Вы выбираете подходящий тариф, оплачиваете его и получаете доступ ко всем услугам в рамках выбранного пакета. Можно менять тариф в любое время.', 'subscriptions', 1, 1],
                ['Можно ли отменить подписку?', 'Да, вы можете отменить подписку в любой момент в настройках профиля. Подписка останется активной до конца оплаченного периода.', 'subscriptions', 2, 1],
                ['Как выбрать исполнителя?', 'После создания задачи система автоматически подберет подходящих исполнителей. Вы можете просмотреть их профили, рейтинги и отзывы перед выбором.', 'tasks', 3, 1],
                ['Что делать, если не устроило качество услуги?', 'Мы гарантируем возврат средств или повторное оказание услуги, если качество не устроило. Свяжитесь с нашей поддержкой в течение 24 часов после выполнения задачи.', 'quality', 4, 1],
                ['Как пополнить баланс?', 'Вы можете пополнить баланс через раздел "Пополнение баланса" в вашем профиле. Доступны банковские карты, ЮMoney и СБП.', 'payments', 5, 1]
            ];

            for (const faq of faqs) {
                await db.run(
                    `INSERT INTO faq (question, answer, category, sort_order, is_active) VALUES (?, ?, ?, ?, ?)`,
                    faq
                );
            }
            console.log('✅ FAQ созданы');
        }

        // 3. Подписки (4 тарифа как в index.html)
        const subscriptionsExist = await db.get("SELECT 1 FROM subscriptions WHERE name = 'free'");
        if (!subscriptionsExist) {
            const subscriptions = [
                [
                    'free', 'Бесплатный', 'Пробный доступ к платформе',
                    0, 0, 0, 3,
                    '["До 3 задач в месяц", "Базовые категории услуг", "Обычная поддержка", "Возможность оценивать исполнителей"]',
                    '#6B7280', 1, 0, 0, 1
                ],
                [
                    'basic', 'Базовый', 'Для регулярного использования',
                    990, 9500, 0, 10,
                    '["До 10 задач в месяц", "Все категории услуг", "Приоритетная поддержка", "Подбор исполнителей", "Безопасные платежи"]',
                    '#3B82F6', 2, 0, 0, 1
                ],
                [
                    'premium', 'Премиум', 'Полный доступ ко всем возможностям',
                    2990, 28650, 0, 999,
                    '["Неограниченное количество задач", "Все категории услуг премиум-класса", "Персональный менеджер", "Экспресс-подбор исполнителей", "VIP-поддержка 24/7", "Страхование задач", "Скидки на услуги"]',
                    '#F59E0B', 3, 1, 1, 1
                ],
                [
                    'vip', 'VIP', 'Эксклюзивное обслуживание',
                    5990, 57500, 0, 9999,
                    '["Все возможности Премиум", "Персональная помощница", "Эксклюзивные исполнительницы", "Консьерж-сервис", "Бесплатные консультации", "Подарки и бонусы", "Приоритет во всем"]',
                    '#8B5CF6', 4, 0, 0, 1
                ]
            ];

            for (const sub of subscriptions) {
                await db.run(
                    `INSERT INTO subscriptions 
                    (name, display_name, description, price_monthly, price_yearly, 
                     initial_fee, tasks_limit, features, color_theme, sort_order, is_popular, is_featured, is_active) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    sub
                );
            }
            console.log('✅ Тарифы подписок созданы (4 тарифа)');
        }

        // 4. Категории услуг (10 категорий как в index.html)
        const categoriesExist = await db.get("SELECT 1 FROM categories WHERE name = 'cleaning'");
        if (!categoriesExist) {
            const categories = [
                ['cleaning', 'Уборка', 'Генеральная уборка, регулярная уборка, уборка после ремонта', 'fas fa-broom', '#FF6B8B', 1, 1],
                ['cooking', 'Готовка', 'Приготовление еды, семейные ужины, диетическое питание', 'fas fa-utensils', '#4CAF50', 2, 1],
                ['shopping', 'Покупки', 'Покупка продуктов, одежды, подарков, онлайн-шопинг', 'fas fa-shopping-bag', '#2196F3', 3, 1],
                ['beauty', 'Красота', 'Маникюр, прически, макияж, уходовые процедуры', 'fas fa-spa', '#9C27B0', 4, 1],
                ['organization', 'Организация', 'Планирование мероприятий, организация пространства', 'fas fa-calendar-alt', '#FF9800', 5, 1],
                ['education', 'Образование', 'Репетиторство, курсы, помощь с учебой', 'fas fa-graduation-cap', '#795548', 6, 1],
                ['childcare', 'Уход за детьми', 'Няни, сопровождение, помощь с детьми', 'fas fa-baby', '#00BCD4', 7, 1],
                ['petcare', 'Уход за питомцами', 'Выгул, кормление, уход за животными', 'fas fa-paw', '#FF5722', 8, 1],
                ['delivery', 'Доставка', 'Доставка еды, документов, покупок', 'fas fa-shipping-fast', '#673AB7', 9, 1],
                ['repair', 'Ремонт', 'Мелкий ремонт, сборка мебели, техническая помощь', 'fas fa-tools', '#607D8B', 10, 1]
            ];

            for (const cat of categories) {
                await db.run(
                    `INSERT INTO categories 
                    (name, display_name, description, icon, color, sort_order, is_active) 
                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    cat
                );
            }
            console.log('✅ Категории услуг созданы (10 категорий)');
        }

        // 5. Услуги (расширенные)
        const servicesExist = await db.get("SELECT 1 FROM services WHERE name = 'Уборка квартиры'");
        if (!servicesExist) {
            const categories = await db.all("SELECT id, name FROM categories");
            const categoryMap = {};
            categories.forEach(cat => categoryMap[cat.name] = cat.id);

            const services = [
                // Уборка
                [categoryMap.cleaning, 'Уборка квартиры', 'Генеральная или поддерживающая уборка квартиры любой площади', 0, '2-6 часов', 1, 1, 1],
                [categoryMap.cleaning, 'Уборка после ремонта', 'Тщательная уборка помещения после строительных работ', 0, '4-8 часов', 1, 2, 0],
                [categoryMap.cleaning, 'Еженедельная уборка', 'Регулярная уборка по заданному графику', 0, '2-3 часа', 1, 3, 0],
                
                // Готовка
                [categoryMap.cooking, 'Приготовление ужина', 'Приготовление ужина на 2-6 персон', 0, '2-3 часа', 1, 4, 1],
                [categoryMap.cooking, 'Праздничный стол', 'Организация и приготовление блюд для праздника', 0, '4-6 часов', 1, 5, 0],
                [categoryMap.cooking, 'Диетическое питание', 'Приготовление блюд по диетическому меню', 0, '2-3 часа', 1, 6, 0],
                
                // Покупки
                [categoryMap.shopping, 'Покупка продуктов', 'Закупка продуктов по списку', 0, '1-3 часа', 1, 7, 1],
                [categoryMap.shopping, 'Шопинг-сопровождение', 'Помощь в выборе одежды, обуви, аксессуаров', 0, '2-4 часа', 1, 8, 0],
                [categoryMap.shopping, 'Покупка подарков', 'Подбор и покупка подарков к празднику', 0, '1-2 часа', 1, 9, 0],
                
                // Красота
                [categoryMap.beauty, 'Маникюр на дому', 'Профессиональный маникюр с выездом', 0, '1-2 часа', 1, 10, 1],
                [categoryMap.beauty, 'Стрижка и укладка', 'Парикмахерские услуги на дому', 0, '2-3 часа', 1, 11, 0],
                [categoryMap.beauty, 'Макияж', 'Профессиональный макияж для любого случая', 0, '1-2 часа', 1, 12, 0],
                
                // Образование
                [categoryMap.education, 'Репетиторство', 'Индивидуальные занятия по школьным предметам', 0, '1-2 часа', 1, 13, 1],
                [categoryMap.education, 'Подготовка к экзаменам', 'Интенсивная подготовка к ОГЭ, ЕГЭ', 0, '1-3 часа', 1, 14, 0],
                [categoryMap.education, 'Иностранные языки', 'Обучение иностранным языкам с нуля', 0, '1-2 часа', 1, 15, 0],
                
                // Уход за детьми
                [categoryMap.childcare, 'Няня на час', 'Присмотр за детьми на несколько часов', 0, '1-4 часа', 1, 16, 1],
                [categoryMap.childcare, 'Сопровождение ребенка', 'Сопровождение в школу, кружки, поликлинику', 0, '1-2 часа', 1, 17, 0],
                [categoryMap.childcare, 'Помощь с уроками', 'Помощь в выполнении домашних заданий', 0, '1-2 часа', 1, 18, 0],
                
                // Уход за питомцами
                [categoryMap.petcare, 'Выгул собак', 'Прогулка с собакой в удобное время', 0, '30-60 минут', 1, 19, 1],
                [categoryMap.petcare, 'Присмотр за питомцем', 'Кормление и уход за животным во время вашего отсутствия', 0, '1-2 раза в день', 1, 20, 0],
                [categoryMap.petcare, 'Груминг', 'Стрижка и гигиенический уход за питомцами', 0, '1-2 часа', 1, 21, 0],
                
                // Доставка
                [categoryMap.delivery, 'Доставка документов', 'Срочная доставка документов по городу', 0, '30-90 минут', 1, 22, 1],
                [categoryMap.delivery, 'Доставка еды', 'Доставка готовой еды из ресторанов', 0, '30-60 минут', 1, 23, 0],
                [categoryMap.delivery, 'Курьерские услуги', 'Доставка покупок, посылок, корреспонденции', 0, '1-2 часа', 1, 24, 0],
                
                // Ремонт
                [categoryMap.repair, 'Мелкий бытовой ремонт', 'Ремонт мелкой бытовой техники, мебели', 0, '1-3 часа', 1, 25, 1],
                [categoryMap.repair, 'Сборка мебели', 'Сборка мебели из IKEA и других магазинов', 0, '2-5 часов', 1, 26, 0],
                [categoryMap.repair, 'Установка техники', 'Установка и подключение бытовой техники', 0, '1-2 часа', 1, 27, 0]
            ];

            for (const service of services) {
                await db.run(
                    `INSERT INTO services 
                    (category_id, name, description, base_price, estimated_time, is_active, sort_order, is_featured) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    service
                );
            }
            console.log('✅ Услуги созданы (27 услуг)');
        }

        // 6. Тестовые пользователи (все аккаунты без вступительного взноса)
        const usersExist = await db.get("SELECT 1 FROM users WHERE email = 'admin@test.com'");
        if (!usersExist) {
            const passwordHash = await bcrypt.hash('admin123', 10);
            const clientPasswordHash = await bcrypt.hash('client123', 10);
            const performerPasswordHash = await bcrypt.hash('performer123', 10);
            
            const expiryDate = new Date();
            expiryDate.setFullYear(expiryDate.getFullYear() + 1);

            const users = [
                // 👑 Администраторы
                ['admin@test.com', passwordHash, 'Александр', 'Иванов', '+79991112233', 'superadmin', 'premium', 'active', expiryDate.toISOString().split('T')[0], 'https://ui-avatars.com/api/?name=Александр+Иванов&background=9B59B6&color=fff&bold=true', 100000, 1, 0, 9999, 0, 5.0, 100, 10000, 'Главный администратор системы', 'Москва', '1985-05-15', 'Системный администратор', 'МГТУ им. Баумана', 'Опыт работы 10+ лет', '["Управление проектами", "Разработка", "Администрирование"]', 'https://vk.com/admin', 'https://instagram.com/admin', '@admin', 'https://admin-portfolio.ru', 1, 1],
                
                // 👨‍💼 Менеджер
                ['manager@test.com', passwordHash, 'Мария', 'Петрова', '+79992223344', 'manager', 'premium', 'active', expiryDate.toISOString().split('T')[0], 'https://ui-avatars.com/api/?name=Мария+Петрова&background=2ECC71&color=fff&bold=true', 50000, 1, 0, 9999, 0, 4.8, 50, 5000, 'Менеджер по работе с клиентами', 'Санкт-Петербург', '1990-08-20', 'Менеджер', 'СПбГУ', 'Опыт работы 5 лет', '["Работа с клиентами", "Управление командой", "Аналитика"]', 'https://vk.com/maria', 'https://instagram.com/maria', '@maria_manager', null, 1, 1],
                
                // 👩‍🏫 Исполнители
                ['performer@test.com', performerPasswordHash, 'Анна', 'Кузнецова', '+79994445566', 'performer', 'premium', 'active', expiryDate.toISOString().split('T')[0], 'https://ui-avatars.com/api/?name=Анна+Кузнецова&background=3498DB&color=fff&bold=true', 25000, 1, 0, 999, 42, 4.8, 42, 125400, 'Профессиональная помощница с опытом работы 5 лет. Специализируюсь на уборке, организации пространства и бытовых задачах. Ответственная, аккуратная, с рекомендациями.', 'Москва', '1988-03-10', 'Помощница по хозяйству', 'Курсы профессиональной уборки', 'Опыт работы 5+ лет', '["Уборка", "Организация", "Готовка", "Уход за детьми"]', 'https://vk.com/anna_performer', 'https://instagram.com/anna_performer', '@anna_helper', null, 1, 1],
                
                ['performer2@test.com', performerPasswordHash, 'Елена', 'Смирнова', '+79995556677', 'performer', 'premium', 'active', expiryDate.toISOString().split('T')[0], 'https://ui-avatars.com/api/?name=Елена+Смирнова&background=3498DB&color=fff&bold=true', 18000, 1, 0, 999, 67, 4.9, 67, 201000, 'Опытная няня и репетитор. Работаю с детьми всех возрастов. Помогаю с уроками, развивающими занятиями, сопровождением. Образование педагогическое.', 'Москва', '1992-11-25', 'Няня, репетитор', 'МПГУ', 'Опыт работы 7 лет', '["Уход за детьми", "Репетиторство", "Развивающие занятия"]', 'https://vk.com/elena_nanny', 'https://instagram.com/elena_nanny', '@elena_teacher', null, 1, 1],
                
                ['performer3@test.com', performerPasswordHash, 'Мария', 'Козлова', '+79996667788', 'performer', 'basic', 'active', expiryDate.toISOString().split('T')[0], 'https://ui-avatars.com/api/?name=Мария+Козлова&background=3498DB&color=fff&bold=true', 12000, 1, 0, 10, 28, 4.7, 28, 84000, 'Стилист-визажист с художественным образованием. Делаю маникюр, макияж, прически. Выезд на дом. Индивидуальный подход к каждому клиенту.', 'Москва', '1995-07-15', 'Стилист-визажист', 'Московский колледж дизайна', 'Опыт работы 3 года', '["Маникюр", "Макияж", "Прически", "Стилистика"]', 'https://vk.com/maria_beauty', 'https://instagram.com/maria_beauty', '@maria_beauty_master', 'https://maria-beauty.ru', 1, 1],
                
                // 👩 Клиенты
                ['client@test.com', clientPasswordHash, 'Елена', 'Васильева', '+79997778899', 'client', 'premium', 'active', expiryDate.toISOString().split('T')[0], 'https://ui-avatars.com/api/?name=Елена+Васильева&background=FF6B8B&color=fff&bold=true', 15000, 1, 0, 999, 12, 4.5, 12, 36000, 'Предпринимательница, мама двоих детей. Ценю свое время и качество услуг. Люблю, когда все организовано и работает как часы.', 'Москва', '1985-12-03', 'Предприниматель', 'ВШЭ', 'Собственный бизнес 8 лет', '["Организация", "Тайм-менеджмент", "Бизнес"]', 'https://vk.com/elena_client', 'https://instagram.com/elena_client', '@elena_business', 'https://mybusiness.ru', 1, 1],
                
                ['client2@test.com', clientPasswordHash, 'Ольга', 'Николаева', '+79998889900', 'client', 'basic', 'active', expiryDate.toISOString().split('T')[0], 'https://ui-avatars.com/api/?name=Ольга+Николаева&background=FF6B8B&color=fff&bold=true', 8000, 1, 0, 10, 5, 4.2, 5, 15000, 'Работаю в офисе, живу одна. Пользоваться сервисом начала недавно, очень довольна качеством услуг и вежливостью помощниц.', 'Москва', '1993-04-18', 'Менеджер', 'РЭУ им. Плеханова', 'Опыт работы 4 года', '["Маркетинг", "Аналитика", "Переговоры"]', null, 'https://instagram.com/olga_client', '@olga_work', null, 1, 1],
                
                ['client3@test.com', clientPasswordHash, 'Ирина', 'Федорова', '+79999990011', 'client', 'free', 'active', expiryDate.toISOString().split('T')[0], 'https://ui-avatars.com/api/?name=Ирина+Федорова&background=FF6B8B&color=fff&bold=true', 3000, 1, 0, 3, 0, 0, 0, 0, 'Студентка, пробую сервис впервые. Ищу помощь в бытовых вопросах, чтобы больше времени уделять учебе.', 'Москва', '2000-09-30', 'Студентка', 'МГУ', 'Учусь на 3 курсе', '["Учеба", "Иностранные языки", "Волонтерство"]', 'https://vk.com/irina_student', 'https://instagram.com/irina_student', '@irina_study', null, 1, 1]
            ];

            for (const user of users) {
                await db.run(
                    `INSERT INTO users 
                    (email, password, first_name, last_name, phone, role, 
                     subscription_plan, subscription_status, subscription_expires,
                     avatar_url, balance, initial_fee_paid, initial_fee_amount, 
                     tasks_limit, tasks_used, user_rating, completed_tasks, total_spent,
                     bio, city, birth_date, profession, education, experience, skills,
                     vk_url, instagram_url, telegram_username, website_url,
                     is_active, email_verified) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    user
                );
            }
            console.log('✅ Тестовые пользователи созданы');
            
            // Назначаем исполнителям специализации
            const categories = await db.all("SELECT id, name FROM categories");
            const performers = await db.all("SELECT id, email FROM users WHERE role = 'performer'");
            
            for (const performer of performers) {
                // Каждый исполнитель специализируется на 3-5 категориях
                const shuffledCategories = [...categories].sort(() => Math.random() - 0.5);
                const categoryCount = 3 + Math.floor(Math.random() * 3);
                
                for (let i = 0; i < Math.min(categoryCount, shuffledCategories.length); i++) {
                    const category = shuffledCategories[i];
                    const experience = Math.floor(Math.random() * 5) + 1;
                    const hourlyRate = Math.floor(Math.random() * 500) + 1000;
                    
                    await db.run(
                        `INSERT OR IGNORE INTO performer_categories 
                        (performer_id, category_id, experience_years, hourly_rate) 
                        VALUES (?, ?, ?, ?)`,
                        [performer.id, category.id, experience, hourlyRate]
                    );
                }
            }
            console.log('✅ Специализации исполнителей созданы');
            
            // Создаем тестовые задачи
            const clients = await db.all("SELECT id, email FROM users WHERE role = 'client'");
            const services = await db.all("SELECT id, category_id FROM services WHERE is_active = 1 LIMIT 20");
            
            if (clients.length > 0 && services.length > 0) {
                const taskTitles = [
                    'Генеральная уборка трехкомнатной квартиры',
                    'Приготовление романтического ужина на двоих',
                    'Покупка продуктов по списку на неделю',
                    'Маникюр с покрытием гель-лаком',
                    'Репетитор по математике для 8 класса',
                    'Няня на 5 часов в субботу',
                    'Выгул собаки (лабрадор) 2 раза в день',
                    'Доставка документов в центр города',
                    'Сборка комода из ИКЕА',
                    'Организация детского дня рождения',
                    'Уборка после ремонта в ванной',
                    'Приготовление диетических блюд на неделю',
                    'Помощь в выборе вечернего платья',
                    'Подготовка к ЕГЭ по английскому',
                    'Присмотр за ребенком 3 лет'
                ];
                
                const taskDescriptions = [
                    'Необходимо сделать генеральную уборку в трехкомнатной квартире 75 кв.м. Особое внимание кухне и санузлам. Есть домашние животные (кошка).',
                    'Нужно приготовить романтический ужин на двоих с оформлением. Предпочтение итальянской кухне. Диетические ограничения: без глютена.',
                    'Закупка продуктов по списку в супермаркете Ашан. Необходимо свежее мясо, овощи, фрукты. Доставить до 18:00.',
                    'Требуется сделать классический маникюр с покрытием гель-лаком. Цвет предпочитаю нейтральный, натуральный. Форма овальная.',
                    'Помощь с домашним заданием и подготовка к контрольной по алгебре. Ребенок 14 лет, сложности с решением уравнений.',
                    'Присмотр за ребенком 5 лет на 5 часов в субботу. Поиграть, покормить обедом, погулять на детской площадке рядом с домом.',
                    'Выгул лабрадора 2 раза в день (утром и вечером) по 40-60 минут. Собака активная, любит долгие прогулки.',
                    'Срочная доставка пакета документов в офис в центре города. Важно бережное отношение к документам.',
                    'Сборка комода Мальм из ИКЕА (4 ящика). Все детали уже доставлены, нужна только сборка.',
                    'Организация дня рождения для ребенка 7 лет. 10 гостей. Нужно помочь с украшением, играми, угощениями.',
                    'Уборка ванной комнаты после замены плитки. Много строительной пыли, нужна тщательная очистка всех поверхностей.',
                    'Приготовление комплекса диетических блюд на 7 дней по предоставленному меню. Разложить по контейнерам.',
                    'Помощь в выборе вечернего платья для корпоратива. Выезд в ТЦ. Бюджет до 15000 руб.',
                    'Интенсивная подготовка к ЕГЭ по английскому языку. Уровень Intermediate, нужна практика разговорной речи.',
                    'Присмотр за активным ребенком 3 лет на 4 часа. Требуется опыт работы с маленькими детьми.'
                ];
                
                for (let i = 0; i < 15; i++) {
                    const client = clients[i % clients.length];
                    const service = services[i % services.length];
                    const performer = performers[i % performers.length];
                    
                    const statuses = ['new', 'searching', 'assigned', 'in_progress', 'completed'];
                    const status = statuses[Math.floor(Math.random() * statuses.length)];
                    
                    const deadline = new Date();
                    deadline.setDate(deadline.getDate() + Math.floor(Math.random() * 14) + 1);
                    
                    const taskNumber = `TASK-${new Date().getFullYear()}${(new Date().getMonth() + 1).toString().padStart(2, '0')}${new Date().getDate().toString().padStart(2, '0')}-${(i + 1).toString().padStart(3, '0')}`;
                    
                    await db.run(
                        `INSERT INTO tasks 
                        (task_number, title, description, client_id, performer_id, category_id, service_id,
                         status, priority, budget, address, deadline, contact_info,
                         requirements_experience, requirements_certified, requirements_reviews) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            taskNumber,
                            taskTitles[i],
                            taskDescriptions[i],
                            client.id,
                            status === 'completed' || status === 'in_progress' || status === 'assigned' ? performer.id : null,
                            service.category_id,
                            service.id,
                            status,
                            i % 4 === 0 ? 'urgent' : i % 3 === 0 ? 'high' : i % 2 === 0 ? 'medium' : 'low',
                            Math.floor(Math.random() * 5000) + 1000,
                            'г. Москва, ' + ['ул. Тверская', 'ул. Арбат', 'пр. Мира', 'ул. Ленинградская', 'ул. Пушкинская'][i % 5] + ', д. ' + (Math.floor(Math.random() * 100) + 1),
                            deadline.toISOString(),
                            '+7999' + Math.floor(Math.random() * 1000000).toString().padStart(7, '0'),
                            i % 3 === 0 ? 1 : 0,
                            i % 4 === 0 ? 1 : 0,
                            i % 2 === 0 ? 1 : 0
                        ]
                    );
                    
                    const taskId = (await db.get('SELECT last_insert_rowid() as id')).id;
                    
                    // Добавляем историю статусов
                    const statusHistory = [
                        ['new', client.id, 'Задача создана']
                    ];
                    
                    if (status !== 'new') {
                        statusHistory.push(['searching', client.id, 'Поиск исполнителя']);
                    }
                    
                    if (status === 'assigned' || status === 'in_progress' || status === 'completed') {
                        statusHistory.push(['assigned', performer.id, 'Исполнитель назначен']);
                    }
                    
                    if (status === 'in_progress' || status === 'completed') {
                        statusHistory.push(['in_progress', performer.id, 'Исполнитель начал работу']);
                    }
                    
                    if (status === 'completed') {
                        statusHistory.push(['completed', performer.id, 'Задача выполнена']);
                        
                        // Для завершенных задач добавляем отзывы
                        const rating = Math.floor(Math.random() * 2) + 4; // 4 или 5
                        const comments = [
                            'Отличная работа! Все сделано быстро и качественно.',
                            'Исполнительница очень внимательная и аккуратная. Рекомендую!',
                            'Работой довольна, все выполнено в срок.',
                            'Профессиональный подход, буду обращаться еще.',
                            'Спасибо за помощь, все супер!'
                        ];
                        
                        await db.run(
                            `INSERT INTO reviews (task_id, client_id, performer_id, rating, comment, is_anonymous) 
                             VALUES (?, ?, ?, ?, ?, ?)`,
                            [taskId, client.id, performer.id, rating, comments[i % comments.length], 0]
                        );
                        
                        // Обновляем рейтинг в задаче
                        await db.run(
                            'UPDATE tasks SET task_rating = ?, feedback = ? WHERE id = ?',
                            [rating, comments[i % comments.length], taskId]
                        );
                        
                        // Обновляем статистику исполнителя
                        await db.run(
                            'UPDATE users SET completed_tasks = completed_tasks + 1 WHERE id = ?',
                            [performer.id]
                        );
                    }
                    
                    // Сохраняем историю статусов
                    for (const [status, changedBy, notes] of statusHistory) {
                        await db.run(
                            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
                             VALUES (?, ?, ?, ?)`,
                            [taskId, status, changedBy, notes]
                        );
                    }
                    
                    // Создаем тестовые сообщения в чате для некоторых задач
                    if (status === 'assigned' || status === 'in_progress' || status === 'completed') {
                        const messages = [
                            [taskId, client.id, 'Здравствуйте! Рада, что вы взялись за мою задачу.'],
                            [taskId, performer.id, 'Добрый день! Да, я уже изучаю детали задачи. Уточните, пожалуйста...'],
                            [taskId, client.id, 'Конечно, что именно нужно уточнить?'],
                            [taskId, performer.id, 'По адресу точно все верно указано? И есть ли у вас домашние животные?'],
                            [taskId, client.id, 'Адрес верный. Да, есть кот, но он не будет мешать.']
                        ];
                        
                        for (const [taskId, userId, message] of messages.slice(0, 2 + Math.floor(Math.random() * 3))) {
                            await db.run(
                                `INSERT INTO task_messages (task_id, user_id, message) 
                                 VALUES (?, ?, ?)`,
                                [taskId, userId, message]
                            );
                        }
                    }
                }
                console.log('✅ Тестовые задачи созданы (15 задач)');
            }
            
            // Создаем транзакции для пользователей
            const transactionTypes = ['deposit', 'subscription', 'task_payment'];
            const transactionDescriptions = [
                'Пополнение баланса',
                'Оплата подписки Премиум',
                'Оплата подписки Базовый',
                'Оплата услуги "Уборка квартиры"',
                'Оплата услуги "Маникюр"',
                'Оплата услуги "Репетиторство"'
            ];
            
            for (const user of await db.all("SELECT id, email FROM users WHERE role IN ('client', 'performer')")) {
                const transactionCount = 3 + Math.floor(Math.random() * 5);
                
                for (let i = 0; i < transactionCount; i++) {
                    const type = transactionTypes[Math.floor(Math.random() * transactionTypes.length)];
                    const amount = type === 'deposit' ? 
                        Math.floor(Math.random() * 10000) + 1000 : 
                        -Math.floor(Math.random() * 5000) + 100;
                    const description = transactionDescriptions[Math.floor(Math.random() * transactionDescriptions.length)];
                    
                    await db.run(
                        `INSERT INTO transactions 
                        (user_id, type, amount, description, status) 
                        VALUES (?, ?, ?, ?, ?)`,
                        [user.id, type, amount, description, 'completed']
                    );
                }
            }
            console.log('✅ Тестовые транзакции созданы');
            
            // Создаем уведомления
            const notificationTypes = [
                'task_created', 'task_assigned', 'task_in_progress', 'task_completed',
                'new_message', 'new_review', 'subscription_activated', 'deposit_success',
                'system_announcement', 'promotion'
            ];
            
            const notificationTitles = [
                'Новая задача создана', 'Задача назначена', 'Задача в работе', 'Задача завершена',
                'Новое сообщение', 'Новый отзыв', 'Подписка активирована', 'Баланс пополнен',
                'Системное уведомление', 'Специальное предложение'
            ];
            
            const notificationMessages = [
                'Ваша задача успешно создана и ожидает исполнителя.',
                'Вам назначена новая задача. Пожалуйста, проверьте детали.',
                'Исполнитель начал работу над вашей задачей.',
                'Ваша задача завершена. Пожалуйста, оцените работу исполнителя.',
                'У вас новое сообщение в чате задачи.',
                'Вы получили новый отзыв от клиента.',
                'Поздравляем! Ваша подписка успешно активирована.',
                'Ваш баланс успешно пополнен. Спасибо!',
                'Система была обновлена. Добавлены новые функции.',
                'Для вас действует специальное предложение!'
            ];
            
            for (const user of await db.all("SELECT id FROM users WHERE is_active = 1 LIMIT 10")) {
                const notificationCount = 2 + Math.floor(Math.random() * 8);
                
                for (let i = 0; i < notificationCount; i++) {
                    const idx = Math.floor(Math.random() * notificationTypes.length);
                    const isRead = Math.random() > 0.5 ? 1 : 0;
                    
                    await db.run(
                        `INSERT INTO notifications 
                        (user_id, type, title, message, is_read) 
                        VALUES (?, ?, ?, ?, ?)`,
                        [user.id, notificationTypes[idx], notificationTitles[idx], notificationMessages[idx], isRead]
                    );
                }
            }
            console.log('✅ Тестовые уведомления созданы');
        }

        console.log('🎉 Все начальные данные созданы!');
        
        console.log('\n🔑 ТЕСТОВЫЕ АККАУНТЫ (без вступительного взноса):');
        console.log('='.repeat(60));
        console.log('👑 Суперадмин: admin@test.com / admin123');
        console.log('👨‍💼 Менеджер: manager@test.com / admin123');
        console.log('👩‍🏫 Исполнитель 1: performer@test.com / performer123');
        console.log('👩‍🏫 Исполнитель 2: performer2@test.com / performer123');
        console.log('👩‍🏫 Исполнитель 3: performer3@test.com / performer123');
        console.log('👩 Клиент Премиум: client@test.com / client123');
        console.log('👩 Клиент Базовый: client2@test.com / client123');
        console.log('👩 Клиент Бесплатный: client3@test.com / client123');
        console.log('='.repeat(60));
        
        console.log('\n📊 СТАТИСТИКА СИСТЕМЫ:');
        console.log('='.repeat(60));
        console.log('👥 Пользователей: 8 (3 исполнителя, 3 клиента, 2 админа)');
        console.log('📋 Категорий услуг: 10');
        console.log('🛠️  Услуг: 27');
        console.log('✅ Задач: 15 (с разными статусами)');
        console.log('⭐ Отзывов: для завершенных задач');
        console.log('💰 Транзакций: по 3-8 на пользователя');
        console.log('🔔 Уведомлений: по 2-10 на пользователя');
        console.log('='.repeat(60));
        
    } catch (error) {
        console.error('⚠️ Ошибка создания начальных данных:', error.message);
        console.error('Stack trace:', error.stack);
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
    if (!phone) return true;
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
                'GET /api/health',
                'GET /api/subscriptions',
                'GET /api/categories',
                'GET /api/categories/*',
                'GET /api/services',
                'GET /api/faq',
                'GET /api/reviews',
                'GET /api/reviews/*',
                'POST /api/auth/register',
                'POST /api/auth/login',
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
                    `SELECT id, email, first_name, last_name, phone, role, 
                            subscription_plan, subscription_status, subscription_expires,
                            initial_fee_paid, initial_fee_amount, is_active, avatar_url,
                            balance, user_rating, completed_tasks, tasks_limit, tasks_used,
                            total_spent, last_login, email_verified, bio, city,
                            birth_date, profession, education, experience, skills,
                            vk_url, instagram_url, telegram_username, website_url
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
                    rating: user.user_rating,
                    completed_tasks: user.completed_tasks,
                    tasks_limit: user.tasks_limit,
                    tasks_used: user.tasks_used,
                    total_spent: user.total_spent,
                    last_login: user.last_login,
                    email_verified: user.email_verified,
                    bio: user.bio,
                    city: user.city,
                    birth_date: user.birth_date,
                    profession: user.profession,
                    education: user.education,
                    experience: user.experience,
                    skills: user.skills ? JSON.parse(user.skills) : [],
                    vk_url: user.vk_url,
                    instagram_url: user.instagram_url,
                    telegram_username: user.telegram_username,
                    website_url: user.website_url
                };
                
                if (roles.length > 0 && !roles.includes(user.role)) {
                    return res.status(403).json({ 
                        success: false, 
                        error: 'Недостаточно прав' 
                    });
                }
                
                next();
                
            } catch (jwtError) {
                console.error('JWT Error:', jwtError);
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
        features: ['Подписки', 'Задачи', 'Чат', 'Отзывы', 'Админ панель', 'Управление услугами', 'Финансы', 'Уведомления'],
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

app.get('/api/health', async (req, res) => {
    try {
        await db.get('SELECT 1 as status');
        
        const usersCount = await db.get('SELECT COUNT(*) as count FROM users');
        const tasksCount = await db.get('SELECT COUNT(*) as count FROM tasks');
        const categoriesCount = await db.get('SELECT COUNT(*) as count FROM categories');
        
        res.json({
            success: true,
            status: 'OK',
            stats: {
                users: usersCount?.count || 0,
                tasks: tasksCount?.count || 0,
                categories: categoriesCount?.count || 0
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            status: 'ERROR',
            error: error.message
        });
    }
});

// ==================== АУТЕНТИФИКАЦИЯ ====================

// Регистрация (без вступительного взноса)
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, first_name, last_name, phone, subscription_plan = 'free', role = 'client' } = req.body;
        
        // Валидация
        if (!email || !password || !first_name || !last_name) {
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
        
        if (phone && !validatePhone(phone)) {
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
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Для всех пользователей сразу активная подписка без вступительного взноса
        const subscriptionStatus = 'active';
        
        // Дата истечения подписки
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 30);
        const expiryDateStr = expiryDate.toISOString().split('T')[0];
        
        // Определяем лимит задач в зависимости от роли и подписки
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
             balance) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                email,
                hashedPassword,
                first_name,
                last_name,
                phone || null,
                role,
                subscription_plan,
                subscriptionStatus,
                expiryDateStr,
                1, // initial_fee_paid
                0, // initial_fee_amount
                tasksLimit,
                avatarUrl,
                1000 // Начальный баланс
            ]
        );
        
        const userId = result.lastID;
        
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
                    ? 'Спасибо за регистрацию в Женском Консьерже. Для начала работы создайте свою первую задачу.'
                    : 'Добро пожаловать в админ панель Женского Консьержа.'
            ]
        );
        
        // Создаем транзакцию для начального баланса
        await db.run(
            `INSERT INTO transactions 
            (user_id, type, amount, description, status) 
            VALUES (?, ?, ?, ?, ?)`,
            [
                userId,
                'deposit',
                1000,
                'Приветственный бонус',
                'completed'
            ]
        );
        
        // Получаем созданного пользователя
        const user = await db.get(
            `SELECT id, email, first_name, last_name, phone, role, 
                    subscription_plan, subscription_status, subscription_expires,
                    initial_fee_paid, initial_fee_amount, avatar_url, tasks_limit, tasks_used,
                    user_rating, balance, bio, city
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
                token
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
            email_verified: user.email_verified,
            bio: user.bio,
            city: user.city,
            birth_date: user.birth_date,
            profession: user.profession,
            education: user.education,
            experience: user.experience,
            skills: user.skills ? JSON.parse(user.skills) : [],
            vk_url: user.vk_url,
            instagram_url: user.instagram_url,
            telegram_username: user.telegram_username,
            website_url: user.website_url
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
app.get('/api/auth/me', authMiddleware(), async (req, res) => {
    try {
        const user = await db.get(
            `SELECT id, email, first_name, last_name, phone, role, 
                    subscription_plan, subscription_status, subscription_expires,
                    initial_fee_paid, initial_fee_amount, is_active, avatar_url,
                    balance, user_rating, completed_tasks, tasks_limit, tasks_used,
                    total_spent, last_login, email_verified, bio, city,
                    birth_date, profession, education, experience, skills,
                    vk_url, instagram_url, telegram_username, website_url
             FROM users WHERE id = ? AND is_active = 1`,
            [req.user.id]
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
            rating: user.user_rating,
            skills: user.skills ? JSON.parse(user.skills) : []
        };
        
        res.json({
            success: true,
            data: { user: userForResponse }
        });
        
    } catch (error) {
        console.error('Ошибка проверки токена:', error);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера'
        });
    }
});

// Обновление профиля
app.put('/api/profile', authMiddleware(), async (req, res) => {
    try {
        const { first_name, last_name, phone, bio, city, birth_date, 
                profession, education, experience, skills,
                vk_url, instagram_url, telegram_username, website_url } = req.body;
        
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
        
        if (phone !== undefined) {
            if (phone && !validatePhone(phone)) {
                return res.status(400).json({
                    success: false,
                    error: 'Некорректный номер телефона'
                });
            }
            updateFields.push('phone = ?');
            updateValues.push(phone || null);
        }
        
        if (bio !== undefined) {
            updateFields.push('bio = ?');
            updateValues.push(bio || null);
        }
        
        if (city !== undefined) {
            updateFields.push('city = ?');
            updateValues.push(city || null);
        }
        
        if (birth_date !== undefined) {
            updateFields.push('birth_date = ?');
            updateValues.push(birth_date || null);
        }
        
        if (profession !== undefined) {
            updateFields.push('profession = ?');
            updateValues.push(profession || null);
        }
        
        if (education !== undefined) {
            updateFields.push('education = ?');
            updateValues.push(education || null);
        }
        
        if (experience !== undefined) {
            updateFields.push('experience = ?');
            updateValues.push(experience || null);
        }
        
        if (skills !== undefined) {
            updateFields.push('skills = ?');
            updateValues.push(JSON.stringify(skills) || null);
        }
        
        if (vk_url !== undefined) {
            updateFields.push('vk_url = ?');
            updateValues.push(vk_url || null);
        }
        
        if (instagram_url !== undefined) {
            updateFields.push('instagram_url = ?');
            updateValues.push(instagram_url || null);
        }
        
        if (telegram_username !== undefined) {
            updateFields.push('telegram_username = ?');
            updateValues.push(telegram_username || null);
        }
        
        if (website_url !== undefined) {
            updateFields.push('website_url = ?');
            updateValues.push(website_url || null);
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
        const updatedUser = await db.get(
            `SELECT id, email, first_name, last_name, phone, role, 
                    subscription_plan, subscription_status, avatar_url,
                    user_rating, bio, city, birth_date, profession,
                    education, experience, skills, vk_url, instagram_url,
                    telegram_username, website_url
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        
        // Переименовываем user_rating в rating для фронтенда
        const userForResponse = {
            ...updatedUser,
            rating: updatedUser.user_rating,
            skills: updatedUser.skills ? JSON.parse(updatedUser.skills) : []
        };
        
        res.json({
            success: true,
            message: 'Профиль успешно обновлен',
            data: { user: userForResponse }
        });
        
    } catch (error) {
        console.error('Ошибка обновления профиля:', error);
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
        const hashedPassword = await bcrypt.hash(new_password, 10);
        
        // Обновляем пароль
        await db.run(
            'UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [hashedPassword, req.user.id]
        );
        
        res.json({
            success: true,
            message: 'Пароль успешно изменен'
        });
        
    } catch (error) {
        console.error('Ошибка смены пароля:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка смены пароля'
        });
    }
});

// Пополнение баланса
app.post('/api/auth/deposit', authMiddleware(), async (req, res) => {
    try {
        const { amount, payment_method = 'card' } = req.body;
        
        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Неверная сумма пополнения'
            });
        }
        
        if (amount < 100) {
            return res.status(400).json({
                success: false,
                error: 'Минимальная сумма пополнения 100 ₽'
            });
        }
        
        // Пополняем баланс
        await db.run(
            'UPDATE users SET balance = balance + ? WHERE id = ?',
            [amount, req.user.id]
        );
        
        // Создаем транзакцию
        await db.run(
            `INSERT INTO transactions 
            (user_id, type, amount, description, status, payment_method) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                req.user.id,
                'deposit',
                amount,
                `Пополнение баланса`,
                'completed',
                payment_method
            ]
        );
        
        // Обновляем статистику
        await db.run(
            'UPDATE users SET total_spent = total_spent + ? WHERE id = ?',
            [amount, req.user.id]
        );
        
        // Создаем уведомление
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message) 
            VALUES (?, ?, ?, ?)`,
            [
                req.user.id,
                'deposit_success',
                'Баланс пополнен',
                `Ваш баланс пополнен на ${amount}₽`
            ]
        );
        
        // Получаем обновленного пользователя
        const user = await db.get(
            'SELECT balance FROM users WHERE id = ?',
            [req.user.id]
        );
        
        res.json({
            success: true,
            message: 'Баланс успешно пополнен',
            data: {
                new_balance: user.balance
            }
        });
        
    } catch (error) {
        console.error('Ошибка пополнения баланса:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка пополнения баланса'
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

// Получение всех услуг
app.get('/api/services', async (req, res) => {
    try {
        const services = await db.all(
            `SELECT s.*, c.display_name as category_name, c.icon as category_icon
             FROM services s
             LEFT JOIN categories c ON s.category_id = c.id
             WHERE s.is_active = 1
             ORDER BY s.sort_order ASC, s.name ASC`
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

// ==================== FAQ ====================
app.get('/api/faq', async (req, res) => {
    try {
        const { category } = req.query;
        
        let query = 'SELECT * FROM faq WHERE is_active = 1';
        const params = [];
        
        if (category && category !== 'all') {
            query += ' AND category = ?';
            params.push(category);
        }
        
        query += ' ORDER BY sort_order ASC, category ASC';
        
        const faq = await db.all(query, params);
        
        res.json({
            success: true,
            data: { 
                faq,
                count: faq.length
            }
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
        const { featured, limit = 10, offset = 0 } = req.query;
        
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
        
        query += ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
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

// Оформление подписки
app.post('/api/subscriptions/subscribe', authMiddleware(), async (req, res) => {
    try {
        const { plan, payment_method = 'balance', auto_renewal = true } = req.body;
        
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
                error: 'Тарифный план не найден'
            });
        }
        
        // Проверяем, не выбрал ли пользователь уже этот тариф
        if (req.user.subscription_plan === plan && req.user.subscription_status === 'active') {
            return res.status(400).json({
                success: false,
                error: 'У вас уже активна эта подписка'
            });
        }
        
        // Для бесплатного тарифа просто активируем
        if (plan === 'free') {
            await db.run(
                `UPDATE users SET 
                    subscription_plan = ?,
                    subscription_status = 'active',
                    subscription_expires = DATE('now', '+30 days'),
                    tasks_limit = ?,
                    tasks_used = 0,
                    updated_at = CURRENT_TIMESTAMP
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
            
        } else {
            // Для платных тарифов проверяем баланс
            if (req.user.balance < subscription.price_monthly) {
                return res.status(400).json({
                    success: false,
                    error: 'Недостаточно средств на балансе',
                    required_amount: subscription.price_monthly,
                    current_balance: req.user.balance
                });
            }
            
            // Списываем средства
            await db.run(
                'UPDATE users SET balance = balance - ? WHERE id = ?',
                [subscription.price_monthly, req.user.id]
            );
            
            // Активируем подписку
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + 30);
            
            await db.run(
                `UPDATE users SET 
                    subscription_plan = ?,
                    subscription_status = 'active',
                    subscription_expires = ?,
                    tasks_limit = ?,
                    tasks_used = 0,
                    updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [plan, expiryDate.toISOString().split('T')[0], subscription.tasks_limit, req.user.id]
            );
            
            // Создаем транзакцию
            await db.run(
                `INSERT INTO transactions 
                (user_id, type, amount, description, status, payment_method) 
                VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    req.user.id,
                    'subscription',
                    -subscription.price_monthly,
                    `Оплата подписки: ${subscription.display_name}`,
                    'completed',
                    payment_method
                ]
            );
            
            // Обновляем статистику
            await db.run(
                'UPDATE users SET total_spent = total_spent + ? WHERE id = ?',
                [subscription.price_monthly, req.user.id]
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
                    `Поздравляем! Вы успешно активировали подписку "${subscription.display_name}". Списан ${subscription.price_monthly}₽. Подписка действует до ${expiryDate.toLocaleDateString('ru-RU')}.`
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
app.post('/api/tasks', authMiddleware(['client', 'admin', 'superadmin', 'manager']), async (req, res) => {
    try {
        const { 
            title, 
            description, 
            category_id, 
            service_id,
            priority = 'medium', 
            budget,
            deadline, 
            address,
            additional_requirements,
            requirements_experience = false,
            requirements_certified = false,
            requirements_reviews = false
        } = req.body;
        
        // Валидация
        if (!title || !description || !category_id) {
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
                'SELECT subscription_status, tasks_limit, tasks_used FROM users WHERE id = ?',
                [req.user.id]
            );
            
            if (!user || user.subscription_status !== 'active') {
                return res.status(403).json({
                    success: false,
                    error: 'Ваша подписка не активна'
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
        if (deadline) {
            const deadlineDate = new Date(deadline);
            if (deadlineDate < new Date()) {
                return res.status(400).json({
                    success: false,
                    error: 'Дата дедлайна не может быть в прошлом'
                });
            }
        }
        
        // Генерируем номер задачи
        const taskNumber = generateTaskNumber();
        
        // Создаем задачу
        const result = await db.run(
            `INSERT INTO tasks 
            (task_number, title, description, client_id, category_id, service_id, 
             priority, budget, address, deadline, additional_requirements,
             requirements_experience, requirements_certified, requirements_reviews) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                taskNumber,
                title,
                description,
                req.user.id,
                category_id,
                service_id || null,
                priority,
                budget || null,
                address || null,
                deadline || null,
                additional_requirements || null,
                requirements_experience ? 1 : 0,
                requirements_certified ? 1 : 0,
                requirements_reviews ? 1 : 0
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
            `SELECT u.id, u.first_name, u.last_name, u.avatar_url, u.user_rating as rating,
                    pc.experience_years, pc.hourly_rate
             FROM users u
             JOIN performer_categories pc ON u.id = pc.performer_id
             WHERE u.role = 'performer' 
               AND u.is_active = 1
               AND pc.category_id = ?
               AND pc.is_active = 1
             ORDER BY u.user_rating DESC`,
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
            `SELECT t.*, c.display_name as category_name, c.icon as category_icon
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
        const { status, category_id, limit = 50, offset = 0, search } = req.query;
        
        let query = `
            SELECT t.*, 
                   c.display_name as category_name,
                   c.icon as category_icon,
                   s.name as service_name,
                   u1.first_name as client_first_name, 
                   u1.last_name as client_last_name,
                   u1.avatar_url as client_avatar,
                   u2.first_name as performer_first_name,
                   u2.last_name as performer_last_name,
                   u2.avatar_url as performer_avatar,
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
        
        if (search) {
            query += ' AND (t.title LIKE ? OR t.description LIKE ? OR t.task_number LIKE ?)';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm);
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
        
        if (search) {
            countQuery += ' AND (title LIKE ? OR description LIKE ? OR task_number LIKE ?)';
            const searchTerm = `%${search}%`;
            countParams.push(searchTerm, searchTerm, searchTerm);
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
            `SELECT tsh.*, u.first_name, u.last_name, u.avatar_url
             FROM task_status_history tsh
             LEFT JOIN users u ON tsh.changed_by = u.id
             WHERE tsh.task_id = ?
             ORDER BY tsh.created_at ASC`,
            [taskId]
        );
        
        // Получаем количество непрочитанных сообщений
        const unreadMessagesCount = await db.get(
            'SELECT COUNT(*) as count FROM task_messages WHERE task_id = ? AND user_id != ? AND is_read = 0',
            [taskId, req.user.id]
        );
        
        res.json({
            success: true,
            data: {
                task: {
                    ...task,
                    status_history: statusHistory,
                    unread_messages_count: unreadMessagesCount?.count || 0
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

// Изменение статуса задачи
app.put('/api/tasks/:id/status', authMiddleware(), async (req, res) => {
    const taskId = req.params.id;
    
    try {
        const { status, notes } = req.body;
        
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
        
        // Проверяем права доступа
        const hasAccess = req.user.id === task.client_id || 
                         req.user.id === task.performer_id || 
                         ['admin', 'manager', 'superadmin'].includes(req.user.role);
        
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                error: 'Нет прав для изменения статуса задачи'
            });
        }
        
        // Проверяем допустимость перехода статуса
        const validTransitions = {
            'new': ['searching', 'cancelled'],
            'searching': ['assigned', 'cancelled'],
            'assigned': ['in_progress', 'cancelled'],
            'in_progress': ['completed', 'cancelled'],
            'completed': [],
            'cancelled': []
        };
        
        if (!validTransitions[task.status] || !validTransitions[task.status].includes(status)) {
            return res.status(400).json({
                success: false,
                error: `Невозможно изменить статус с "${task.status}" на "${status}"`
            });
        }
        
        // Обновляем статус задачи
        await db.run(
            'UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [status, taskId]
        );
        
        // Добавляем запись в историю
        await db.run(
            `INSERT INTO task_status_history (task_id, status, changed_by, notes) 
             VALUES (?, ?, ?, ?)`,
            [taskId, status, req.user.id, notes || `Статус изменен на "${status}"`]
        );
        
        // Обрабатываем специальные статусы
        if (status === 'completed') {
            await db.run(
                'UPDATE tasks SET completed_at = CURRENT_TIMESTAMP WHERE id = ?',
                [taskId]
            );
            
            // Увеличиваем счетчик завершенных задач у исполнителя
            if (task.performer_id) {
                await db.run(
                    'UPDATE users SET completed_tasks = completed_tasks + 1 WHERE id = ?',
                    [task.performer_id]
                );
            }
            
            // Создаем уведомление для клиента
            await db.run(
                `INSERT INTO notifications 
                (user_id, type, title, message, related_id, related_type) 
                VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    task.client_id,
                    'task_completed',
                    'Задача завершена',
                    `Задача "${task.title}" была завершена исполнителем.`,
                    taskId,
                    'task'
                ]
            );
            
        } else if (status === 'cancelled') {
            await db.run(
                'UPDATE tasks SET cancellation_by = ?, cancellation_reason = ? WHERE id = ?',
                [req.user.id, notes || 'Отменено пользователем', taskId]
            );
            
            // Возвращаем задачу в лимит (если отменена клиентом)
            if (req.user.id === task.client_id) {
                await db.run(
                    'UPDATE users SET tasks_used = tasks_used - 1 WHERE id = ?',
                    [task.client_id]
                );
            }
            
            // Создаем уведомление для другой стороны
            const notifyUserId = req.user.id === task.client_id ? task.performer_id : task.client_id;
            if (notifyUserId) {
                await db.run(
                    `INSERT INTO notifications 
                    (user_id, type, title, message, related_id, related_type) 
                    VALUES (?, ?, ?, ?, ?, ?)`,
                    [
                        notifyUserId,
                        'task_cancelled',
                        'Задача отменена',
                        `Задача "${task.title}" была отменена.`,
                        taskId,
                        'task'
                    ]
                );
            }
        }
        
        // Получаем обновленную задачу
        const updatedTask = await db.get(
            `SELECT t.*, c.display_name as category_name,
                    u1.first_name as client_first_name, 
                    u1.last_name as client_last_name,
                    u2.first_name as performer_first_name,
                    u2.last_name as performer_last_name
             FROM tasks t
             LEFT JOIN categories c ON t.category_id = c.id
             LEFT JOIN users u1 ON t.client_id = u1.id
             LEFT JOIN users u2 ON t.performer_id = u2.id
             WHERE t.id = ?`,
            [taskId]
        );
        
        res.json({
            success: true,
            message: `Статус задачи успешно изменен на "${status}"`,
            data: { task: updatedTask }
        });
        
    } catch (error) {
        console.error('Ошибка изменения статуса задачи:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка изменения статуса задачи'
        });
    }
});

// Исполнитель берет задачу
app.post('/api/tasks/:id/take', authMiddleware(['performer']), async (req, res) => {
    const taskId = req.params.id;
    
    try {
        // Получаем задачу
        const task = await db.get(
            `SELECT t.*, c.display_name as category_name
             FROM tasks t
             LEFT JOIN categories c ON t.category_id = c.id
             WHERE t.id = ? AND t.status = 'searching'`,
            [taskId]
        );
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена или недоступна для принятия'
            });
        }
        
        // Проверяем, специализируется ли исполнитель на этой категории
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
        
        // Проверяем требования к исполнителю
        if (task.requirements_experience || task.requirements_certified || task.requirements_reviews) {
            const performer = await db.get(
                `SELECT user_rating, completed_tasks FROM users WHERE id = ?`,
                [req.user.id]
            );
            
            if (task.requirements_experience && performer.completed_tasks < 10) {
                return res.status(403).json({
                    success: false,
                    error: 'Требуется опыт работы (не менее 10 выполненных задач)'
                });
            }
            
            if (task.requirements_reviews && performer.user_rating < 4.0) {
                return res.status(403).json({
                    success: false,
                    error: 'Требуется рейтинг выше 4.0'
                });
            }
        }
        
        // Обновляем задачу
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
            [taskId, 'assigned', req.user.id, 'Исполнитель принял задачу']
        );
        
        // Создаем уведомление для клиента
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message, related_id, related_type) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                task.client_id,
                'task_assigned',
                'Исполнитель найден!',
                `Исполнитель принял вашу задачу "${task.title}".`,
                taskId,
                'task'
            ]
        );
        
        // Получаем обновленную задачу
        const updatedTask = await db.get(
            `SELECT t.*, c.display_name as category_name,
                    u1.first_name as client_first_name, 
                    u1.last_name as client_last_name,
                    u2.first_name as performer_first_name,
                    u2.last_name as performer_last_name
             FROM tasks t
             LEFT JOIN categories c ON t.category_id = c.id
             LEFT JOIN users u1 ON t.client_id = u1.id
             LEFT JOIN users u2 ON t.performer_id = u2.id
             WHERE t.id = ?`,
            [taskId]
        );
        
        res.json({
            success: true,
            message: 'Задача успешно принята!',
            data: { task: updatedTask }
        });
        
    } catch (error) {
        console.error('Ошибка принятия задачи:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка принятия задачи'
        });
    }
});

// ==================== СООБЩЕНИЯ ====================

// Получение сообщений задачи
app.get('/api/tasks/:id/messages', authMiddleware(), async (req, res) => {
    const taskId = req.params.id;
    
    try {
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
        
        const hasAccess = req.user.id === task.client_id || 
                         req.user.id === task.performer_id || 
                         ['admin', 'manager', 'superadmin'].includes(req.user.role);
        
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                error: 'Нет доступа к сообщениям этой задачи'
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
        
        // Помечаем непрочитанные сообщения как прочитанные
        await db.run(
            `UPDATE task_messages SET is_read = 1, read_at = CURRENT_TIMESTAMP 
             WHERE task_id = ? AND user_id != ? AND is_read = 0`,
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

// Отправка сообщения
app.post('/api/tasks/:id/messages', authMiddleware(), async (req, res) => {
    const taskId = req.params.id;
    
    try {
        const { message } = req.body;
        
        if (!message || message.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'Сообщение не может быть пустым'
            });
        }
        
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
        
        const hasAccess = req.user.id === task.client_id || 
                         req.user.id === task.performer_id || 
                         ['admin', 'manager', 'superadmin'].includes(req.user.role);
        
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                error: 'Нет доступа к чату этой задачи'
            });
        }
        
        // Проверяем статус задачи (можно ли отправлять сообщения)
        if (task.status === 'cancelled') {
            return res.status(400).json({
                success: false,
                error: 'Нельзя отправлять сообщения в отмененной задаче'
            });
        }
        
        // Определяем получателя
        let recipientId = null;
        if (req.user.id === task.client_id && task.performer_id) {
            recipientId = task.performer_id;
        } else if (req.user.id === task.performer_id) {
            recipientId = task.client_id;
        }
        
        // Создаем сообщение
        const result = await db.run(
            `INSERT INTO task_messages (task_id, user_id, message) 
             VALUES (?, ?, ?)`,
            [taskId, req.user.id, message.trim()]
        );
        
        const messageId = result.lastID;
        
        // Создаем уведомление для получателя
        if (recipientId) {
            await db.run(
                `INSERT INTO notifications 
                (user_id, type, title, message, related_id, related_type) 
                VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    recipientId,
                    'new_message',
                    'Новое сообщение',
                    `У вас новое сообщение в задаче "${task.title || 'Задача'}"`,
                    taskId,
                    'task'
                ]
            );
        }
        
        // Получаем созданное сообщение
        const newMessage = await db.get(
            `SELECT tm.*, u.first_name, u.last_name, u.avatar_url, u.role
             FROM task_messages tm
             LEFT JOIN users u ON tm.user_id = u.id
             WHERE tm.id = ?`,
            [messageId]
        );
        
        res.status(201).json({
            success: true,
            message: 'Сообщение отправлено',
            data: { message: newMessage }
        });
        
    } catch (error) {
        console.error('Ошибка отправки сообщения:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка отправки сообщения'
        });
    }
});

// ==================== ОЦЕНКИ И ОТЗЫВЫ ====================

// Оценка задачи
app.post('/api/tasks/:id/rate', authMiddleware(), async (req, res) => {
    const taskId = req.params.id;
    
    try {
        const { rating, comment, is_anonymous = false } = req.body;
        
        // Валидация
        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({
                success: false,
                error: 'Рейтинг должен быть от 1 до 5'
            });
        }
        
        // Проверяем задачу
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
        
        // Проверяем права (только клиент может оценивать)
        if (req.user.id !== task.client_id) {
            return res.status(403).json({
                success: false,
                error: 'Только клиент может оценить задачу'
            });
        }
        
        // Проверяем статус задачи
        if (task.status !== 'completed') {
            return res.status(400).json({
                success: false,
                error: 'Можно оценивать только завершенные задачи'
            });
        }
        
        // Проверяем, не оценена ли уже задача
        if (task.task_rating) {
            return res.status(400).json({
                success: false,
                error: 'Задача уже оценена'
            });
        }
        
        // Обновляем оценку в задаче
        await db.run(
            'UPDATE tasks SET task_rating = ?, feedback = ? WHERE id = ?',
            [rating, comment || null, taskId]
        );
        
        // Создаем отзыв
        await db.run(
            `INSERT INTO reviews (task_id, client_id, performer_id, rating, comment, is_anonymous) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [taskId, req.user.id, task.performer_id, rating, comment || null, is_anonymous ? 1 : 0]
        );
        
        // Пересчитываем рейтинг исполнителя
        const performerReviews = await db.all(
            'SELECT rating FROM reviews WHERE performer_id = ? AND admin_approved = 1',
            [task.performer_id]
        );
        
        if (performerReviews.length > 0) {
            const avgRating = performerReviews.reduce((sum, r) => sum + r.rating, 0) / performerReviews.length;
            await db.run(
                'UPDATE users SET user_rating = ? WHERE id = ?',
                [avgRating.toFixed(2), task.performer_id]
            );
        }
        
        // Создаем уведомление для исполнителя
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message, related_id, related_type) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                task.performer_id,
                'new_review',
                'Новый отзыв',
                `Вы получили новый отзыв от клиента. Оценка: ${rating}/5`,
                taskId,
                'task'
            ]
        );
        
        // Получаем обновленную задачу
        const updatedTask = await db.get(
            'SELECT * FROM tasks WHERE id = ?',
            [taskId]
        );
        
        res.json({
            success: true,
            message: 'Спасибо за вашу оценку!',
            data: { task: updatedTask }
        });
        
    } catch (error) {
        console.error('Ошибка оценки задачи:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка оценки задачи'
        });
    }
});

// ==================== УВЕДОМЛЕНИЯ ====================

// Получение уведомлений
app.get('/api/notifications', authMiddleware(), async (req, res) => {
    try {
        const { unread_only = false, limit = 50, offset = 0 } = req.query;
        
        let query = 'SELECT * FROM notifications WHERE user_id = ?';
        const params = [req.user.id];
        
        if (unread_only === 'true') {
            query += ' AND is_read = 0';
        }
        
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const notifications = await db.all(query, params);
        
        // Получаем общее количество уведомлений
        const countQuery = 'SELECT COUNT(*) as total FROM notifications WHERE user_id = ?';
        const countResult = await db.get(countQuery, [req.user.id]);
        
        // Получаем количество непрочитанных
        const unreadQuery = 'SELECT COUNT(*) as total FROM notifications WHERE user_id = ? AND is_read = 0';
        const unreadResult = await db.get(unreadQuery, [req.user.id]);
        
        res.json({
            success: true,
            data: {
                notifications,
                stats: {
                    total: countResult?.total || 0,
                    unread: unreadResult?.total || 0
                },
                pagination: {
                    total: countResult?.total || 0,
                    limit: parseInt(limit),
                    offset: parseInt(offset)
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения уведомлений:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения уведомлений'
        });
    }
});

// Пометить уведомление как прочитанное
app.put('/api/notifications/:id/read', authMiddleware(), async (req, res) => {
    const notificationId = req.params.id;
    
    try {
        // Проверяем, принадлежит ли уведомление пользователю
        const notification = await db.get(
            'SELECT * FROM notifications WHERE id = ? AND user_id = ?',
            [notificationId, req.user.id]
        );
        
        if (!notification) {
            return res.status(404).json({
                success: false,
                error: 'Уведомление не найдено'
            });
        }
        
        // Помечаем как прочитанное
        await db.run(
            'UPDATE notifications SET is_read = 1, read_at = CURRENT_TIMESTAMP WHERE id = ?',
            [notificationId]
        );
        
        res.json({
            success: true,
            message: 'Уведомление помечено как прочитанное'
        });
        
    } catch (error) {
        console.error('Ошибка обновления уведомления:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления уведомления'
        });
    }
});

// Пометить все уведомления как прочитанные
app.put('/api/notifications/read-all', authMiddleware(), async (req, res) => {
    try {
        await db.run(
            `UPDATE notifications 
             SET is_read = 1, read_at = CURRENT_TIMESTAMP 
             WHERE user_id = ? AND is_read = 0`,
            [req.user.id]
        );
        
        res.json({
            success: true,
            message: 'Все уведомления помечены как прочитанные'
        });
        
    } catch (error) {
        console.error('Ошибка обновления уведомлений:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления уведомлений'
        });
    }
});

// ==================== ИСПОЛНИТЕЛИ ====================

// Получение специализаций исполнителя
app.get('/api/performer/specializations', authMiddleware(['performer']), async (req, res) => {
    try {
        const specializations = await db.all(
            `SELECT pc.*, c.name, c.display_name, c.icon, c.description
             FROM performer_categories pc
             LEFT JOIN categories c ON pc.category_id = c.id
             WHERE pc.performer_id = ?
             ORDER BY c.display_name ASC`,
            [req.user.id]
        );
        
        res.json({
            success: true,
            data: { specializations }
        });
        
    } catch (error) {
        console.error('Ошибка получения специализаций:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения специализаций'
        });
    }
});

// Обновление специализаций исполнителя
app.put('/api/performer/specializations', authMiddleware(['performer']), async (req, res) => {
    try {
        const { specializations } = req.body;
        
        if (!Array.isArray(specializations)) {
            return res.status(400).json({
                success: false,
                error: 'Неверный формат данных'
            });
        }
        
        // Удаляем старые специализации
        await db.run(
            'DELETE FROM performer_categories WHERE performer_id = ?',
            [req.user.id]
        );
        
        // Добавляем новые специализации
        for (const spec of specializations) {
            if (spec.category_id && spec.is_active) {
                await db.run(
                    `INSERT INTO performer_categories 
                    (performer_id, category_id, experience_years, hourly_rate, is_active) 
                    VALUES (?, ?, ?, ?, ?)`,
                    [
                        req.user.id,
                        spec.category_id,
                        spec.experience_years || 0,
                        spec.hourly_rate || 0,
                        1
                    ]
                );
            }
        }
        
        res.json({
            success: true,
            message: 'Специализации успешно обновлены'
        });
        
    } catch (error) {
        console.error('Ошибка обновления специализаций:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления специализаций'
        });
    }
});

// Получение доступных задач для исполнителя
app.get('/api/performer/available-tasks', authMiddleware(['performer']), async (req, res) => {
    try {
        const { category_id, limit = 50, offset = 0 } = req.query;
        
        // Получаем специализации исполнителя
        const specializations = await db.all(
            'SELECT category_id FROM performer_categories WHERE performer_id = ? AND is_active = 1',
            [req.user.id]
        );
        
        if (specializations.length === 0) {
            return res.json({
                success: true,
                data: { tasks: [], count: 0 }
            });
        }
        
        const categoryIds = specializations.map(s => s.category_id);
        
        // Запрос для получения доступных задач
        let query = `
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
              AND t.category_id IN (${categoryIds.map(() => '?').join(',')})
        `;
        
        const params = [...categoryIds];
        
        if (category_id && category_id !== 'all') {
            query += ' AND t.category_id = ?';
            params.push(category_id);
        }
        
        query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const tasks = await db.all(query, params);
        
        // Проверяем требования для каждой задачи
        for (const task of tasks) {
            let canTake = true;
            let requirements_met = true;
            let requirements_text = [];
            
            if (task.requirements_experience) {
                const performerStats = await db.get(
                    'SELECT completed_tasks FROM users WHERE id = ?',
                    [req.user.id]
                );
                
                if (!performerStats || performerStats.completed_tasks < 10) {
                    canTake = false;
                    requirements_met = false;
                    requirements_text.push('Требуется опыт работы (не менее 10 задач)');
                }
            }
            
            if (task.requirements_reviews) {
                const performerRating = await db.get(
                    'SELECT user_rating FROM users WHERE id = ?',
                    [req.user.id]
                );
                
                if (!performerRating || performerRating.user_rating < 4.0) {
                    canTake = false;
                    requirements_met = false;
                    requirements_text.push('Требуется рейтинг выше 4.0');
                }
            }
            
            task.can_take = canTake;
            task.requirements_met = requirements_met;
            task.requirements_text = requirements_text;
        }
        
        // Подсчет общего количества
        let countQuery = `
            SELECT COUNT(*) as total FROM tasks 
            WHERE status = 'searching' 
              AND category_id IN (${categoryIds.map(() => '?').join(',')})
        `;
        
        const countParams = [...categoryIds];
        
        if (category_id && category_id !== 'all') {
            countQuery += ' AND category_id = ?';
            countParams.push(category_id);
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
        console.error('Ошибка получения доступных задач:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения доступных задач'
        });
    }
});

// Статистика исполнителя
app.get('/api/performer/stats', authMiddleware(['performer']), async (req, res) => {
    try {
        // Основная статистика
        const baseStats = await db.get(
            `SELECT 
                COUNT(*) as total_tasks,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
                SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_tasks,
                AVG(CASE WHEN task_rating > 0 THEN task_rating END) as average_rating,
                COALESCE(SUM(budget), 0) as total_earnings
             FROM tasks 
             WHERE performer_id = ?`,
            [req.user.id]
        );
        
        // Статистика по категориям
        const categoryStats = await db.all(
            `SELECT c.name, c.display_name, c.icon,
                    COUNT(t.id) as task_count,
                    COALESCE(SUM(t.budget), 0) as total_earnings
             FROM categories c
             LEFT JOIN tasks t ON c.id = t.category_id AND t.performer_id = ?
             WHERE c.is_active = 1
             GROUP BY c.id
             ORDER BY task_count DESC`,
            [req.user.id]
        );
        
        // Среднее время выполнения задач
        const timeStats = await db.get(
            `SELECT 
                AVG(JULIANDAY(completed_at) - JULIANDAY(created_at)) as avg_completion_days
             FROM tasks 
             WHERE performer_id = ? AND status = 'completed' AND completed_at IS NOT NULL`,
            [req.user.id]
        );
        
        // Ближайшие задачи
        const upcomingTasks = await db.all(
            `SELECT t.*, c.display_name as category_name
             FROM tasks t
             LEFT JOIN categories c ON t.category_id = c.id
             WHERE t.performer_id = ? 
               AND t.status IN ('assigned', 'in_progress')
               AND (t.deadline IS NULL OR t.deadline > CURRENT_TIMESTAMP)
             ORDER BY t.priority DESC, t.deadline ASC
             LIMIT 5`,
            [req.user.id]
        );
        
        // Недавние отзывы
        const recentReviews = await db.all(
            `SELECT r.*, t.title as task_title,
                    u.first_name as client_first_name,
                    u.last_name as client_last_name
             FROM reviews r
             LEFT JOIN tasks t ON r.task_id = t.id
             LEFT JOIN users u ON r.client_id = u.id
             WHERE r.performer_id = ? AND r.admin_approved = 1
             ORDER BY r.created_at DESC
             LIMIT 5`,
            [req.user.id]
        );
        
        res.json({
            success: true,
            data: {
                base_stats: {
                    total_tasks: baseStats?.total_tasks || 0,
                    completed_tasks: baseStats?.completed_tasks || 0,
                    in_progress_tasks: baseStats?.in_progress_tasks || 0,
                    average_rating: baseStats?.average_rating?.toFixed(2) || '0.00',
                    total_earnings: baseStats?.total_earnings || 0,
                    avg_completion_days: timeStats?.avg_completion_days?.toFixed(1) || '0.0'
                },
                category_stats: categoryStats,
                upcoming_tasks: upcomingTasks,
                recent_reviews: recentReviews
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения статистики исполнителя:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статистики исполнителя'
        });
    }
});

// ==================== ТРАНЗАКЦИИ ====================

// Получение транзакций пользователя
app.get('/api/transactions', authMiddleware(), async (req, res) => {
    try {
        const { type, limit = 50, offset = 0 } = req.query;
        
        let query = 'SELECT * FROM transactions WHERE user_id = ?';
        const params = [req.user.id];
        
        if (type && type !== 'all') {
            query += ' AND type = ?';
            params.push(type);
        }
        
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const transactions = await db.all(query, params);
        
        // Получаем общее количество
        let countQuery = 'SELECT COUNT(*) as total FROM transactions WHERE user_id = ?';
        const countParams = [req.user.id];
        
        if (type && type !== 'all') {
            countQuery += ' AND type = ?';
            countParams.push(type);
        }
        
        const countResult = await db.get(countQuery, countParams);
        
        res.json({
            success: true,
            data: {
                transactions,
                pagination: {
                    total: countResult?.total || 0,
                    limit: parseInt(limit),
                    offset: parseInt(offset)
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения транзакций:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения транзакций'
        });
    }
});

// ==================== АДМИН ПАНЕЛЬ ====================

// Получение статистики системы (только для админов)
app.get('/api/admin/stats', authMiddleware(['admin', 'manager', 'superadmin']), async (req, res) => {
    try {
        // Общая статистика
        const totalStats = await db.get(`
            SELECT 
                (SELECT COUNT(*) FROM users) as total_users,
                (SELECT COUNT(*) FROM users WHERE role = 'client') as total_clients,
                (SELECT COUNT(*) FROM users WHERE role = 'performer') as total_performers,
                (SELECT COUNT(*) FROM tasks) as total_tasks,
                (SELECT COUNT(*) FROM tasks WHERE status = 'completed') as completed_tasks,
                (SELECT COUNT(*) FROM tasks WHERE status = 'searching') as searching_tasks,
                (SELECT COALESCE(SUM(budget), 0) FROM tasks) as total_revenue,
                (SELECT COALESCE(SUM(budget), 0) FROM tasks WHERE status = 'completed') as confirmed_revenue,
                (SELECT COUNT(*) FROM transactions WHERE type = 'subscription') as subscription_transactions,
                (SELECT COUNT(*) FROM transactions WHERE type = 'deposit') as deposit_transactions
        `);
        
        // Статистика по подпискам
        const subscriptionStats = await db.all(`
            SELECT 
                subscription_plan,
                COUNT(*) as user_count
            FROM users 
            WHERE subscription_plan IS NOT NULL 
            GROUP BY subscription_plan
            ORDER BY user_count DESC
        `);
        
        // Статистика по дням (последние 7 дней)
        const dailyStats = await db.all(`
            SELECT 
                DATE(created_at) as date,
                COUNT(*) as tasks_created,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as tasks_completed
            FROM tasks 
            WHERE created_at >= DATE('now', '-7 days')
            GROUP BY DATE(created_at)
            ORDER BY date DESC
        `);
        
        // Недавняя активность
        const recentActivity = await db.all(`
            SELECT 
                'task_created' as type,
                t.title,
                u.first_name,
                u.last_name,
                t.created_at
            FROM tasks t
            JOIN users u ON t.client_id = u.id
            UNION ALL
            SELECT 
                'task_completed' as type,
                t.title,
                u.first_name,
                u.last_name,
                t.completed_at
            FROM tasks t
            JOIN users u ON t.client_id = u.id
            WHERE t.status = 'completed'
            ORDER BY created_at DESC
            LIMIT 10
        `);
        
        // Проблемные задачи (долго в работе или без исполнителя)
        const problematicTasks = await db.all(`
            SELECT 
                t.*,
                c.display_name as category_name,
                u.first_name as client_first_name,
                u.last_name as client_last_name,
                JULIANDAY('now') - JULIANDAY(t.created_at) as days_in_progress
            FROM tasks t
            LEFT JOIN categories c ON t.category_id = c.id
            LEFT JOIN users u ON t.client_id = u.id
            WHERE (t.status = 'searching' AND t.created_at < DATE('now', '-3 days'))
               OR (t.status = 'in_progress' AND t.created_at < DATE('now', '-7 days'))
            ORDER BY t.created_at ASC
            LIMIT 10
        `);
        
        res.json({
            success: true,
            data: {
                total_stats: totalStats,
                subscription_stats: subscriptionStats,
                daily_stats: dailyStats,
                recent_activity: recentActivity,
                problematic_tasks: problematicTasks
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

// Получение всех пользователей (админ)
app.get('/api/admin/users', authMiddleware(['admin', 'manager', 'superadmin']), async (req, res) => {
    try {
        const { role, is_active, limit = 50, offset = 0, search } = req.query;
        
        let query = `
            SELECT 
                id, email, first_name, last_name, phone, role, 
                subscription_plan, subscription_status, subscription_expires,
                is_active, balance, user_rating, completed_tasks,
                created_at, last_login
            FROM users 
            WHERE 1=1
        `;
        
        const params = [];
        
        if (role && role !== 'all') {
            query += ' AND role = ?';
            params.push(role);
        }
        
        if (is_active !== undefined) {
            query += ' AND is_active = ?';
            params.push(is_active === 'true' ? 1 : 0);
        }
        
        if (search) {
            query += ' AND (email LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR phone LIKE ?)';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }
        
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const users = await db.all(query, params);
        
        // Получаем общее количество
        let countQuery = 'SELECT COUNT(*) as total FROM users WHERE 1=1';
        const countParams = [];
        
        if (role && role !== 'all') {
            countQuery += ' AND role = ?';
            countParams.push(role);
        }
        
        if (is_active !== undefined) {
            countQuery += ' AND is_active = ?';
            countParams.push(is_active === 'true' ? 1 : 0);
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
                users,
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

// Изменение роли пользователя (админ)
app.put('/api/admin/users/:id/role', authMiddleware(['admin', 'superadmin']), async (req, res) => {
    const userId = req.params.id;
    
    try {
        const { role } = req.body;
        
        if (!role) {
            return res.status(400).json({
                success: false,
                error: 'Не указана новая роль'
            });
        }
        
        // Проверяем существование пользователя
        const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        // Суперадмин может изменять любые роли, обычный админ не может менять суперадмина
        if (req.user.role !== 'superadmin' && user.role === 'superadmin') {
            return res.status(403).json({
                success: false,
                error: 'Недостаточно прав для изменения роли суперадмина'
            });
        }
        
        // Обновляем роль
        await db.run(
            'UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [role, userId]
        );
        
        // Создаем уведомление для пользователя
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message) 
            VALUES (?, ?, ?, ?)`,
            [
                userId,
                'role_changed',
                'Изменение роли',
                `Ваша роль была изменена на "${role}".`
            ]
        );
        
        res.json({
            success: true,
            message: 'Роль пользователя успешно изменена'
        });
        
    } catch (error) {
        console.error('Ошибка изменения роли:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка изменения роли'
        });
    }
});

// Получение всех задач (админ)
app.get('/api/admin/tasks', authMiddleware(['admin', 'manager', 'superadmin']), async (req, res) => {
    try {
        const { status, priority, category_id, limit = 50, offset = 0, search } = req.query;
        
        let query = `
            SELECT t.*, 
                   c.display_name as category_name,
                   c.icon as category_icon,
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
        
        if (priority && priority !== 'all') {
            query += ' AND t.priority = ?';
            params.push(priority);
        }
        
        if (category_id && category_id !== 'all') {
            query += ' AND t.category_id = ?';
            params.push(category_id);
        }
        
        if (search) {
            query += ' AND (t.title LIKE ? OR t.description LIKE ? OR t.task_number LIKE ?)';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm);
        }
        
        query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const tasks = await db.all(query, params);
        
        // Получаем общее количество
        let countQuery = 'SELECT COUNT(*) as total FROM tasks WHERE 1=1';
        const countParams = [];
        
        if (status && status !== 'all') {
            countQuery += ' AND status = ?';
            countParams.push(status);
        }
        
        if (priority && priority !== 'all') {
            countQuery += ' AND priority = ?';
            countParams.push(priority);
        }
        
        if (category_id && category_id !== 'all') {
            countQuery += ' AND category_id = ?';
            countParams.push(category_id);
        }
        
        if (search) {
            countQuery += ' AND (title LIKE ? OR description LIKE ? OR task_number LIKE ?)';
            const searchTerm = `%${search}%`;
            countParams.push(searchTerm, searchTerm, searchTerm);
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
        console.error('Ошибка получения задач (админ):', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения задач (админ)'
        });
    }
});

// Получение всех транзакций (админ)
app.get('/api/admin/transactions', authMiddleware(['admin', 'manager', 'superadmin']), async (req, res) => {
    try {
        const { type, status, limit = 50, offset = 0 } = req.query;
        
        let query = `
            SELECT t.*, 
                   u.email as user_email,
                   u.first_name as user_first_name,
                   u.last_name as user_last_name
            FROM transactions t
            LEFT JOIN users u ON t.user_id = u.id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (type && type !== 'all') {
            query += ' AND t.type = ?';
            params.push(type);
        }
        
        if (status && status !== 'all') {
            query += ' AND t.status = ?';
            params.push(status);
        }
        
        query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const transactions = await db.all(query, params);
        
        // Получаем общее количество
        let countQuery = 'SELECT COUNT(*) as total FROM transactions WHERE 1=1';
        const countParams = [];
        
        if (type && type !== 'all') {
            countQuery += ' AND type = ?';
            countParams.push(type);
        }
        
        if (status && status !== 'all') {
            countQuery += ' AND status = ?';
            countParams.push(status);
        }
        
        const countResult = await db.get(countQuery, countParams);
        
        res.json({
            success: true,
            data: {
                transactions,
                pagination: {
                    total: countResult?.total || 0,
                    limit: parseInt(limit),
                    offset: parseInt(offset)
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения транзакций (админ):', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения транзакций (админ)'
        });
    }
});

// ==================== СИСТЕМНЫЕ ФУНКЦИИ ====================

// Экспорт данных пользователя (GDPR)
app.get('/api/user-data-export', authMiddleware(), async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Собираем все данные пользователя
        const userData = {
            user_info: await db.get(
                'SELECT * FROM users WHERE id = ?',
                [userId]
            ),
            tasks: await db.all(
                'SELECT * FROM tasks WHERE client_id = ? OR performer_id = ?',
                [userId, userId]
            ),
            transactions: await db.all(
                'SELECT * FROM transactions WHERE user_id = ?',
                [userId]
            ),
            messages: await db.all(
                `SELECT tm.*, t.title as task_title
                 FROM task_messages tm
                 LEFT JOIN tasks t ON tm.task_id = t.id
                 WHERE tm.user_id = ?`,
                [userId]
            ),
            notifications: await db.all(
                'SELECT * FROM notifications WHERE user_id = ?',
                [userId]
            ),
            reviews: await db.all(
                'SELECT * FROM reviews WHERE client_id = ? OR performer_id = ?',
                [userId, userId]
            )
        };
        
        // Удаляем чувствительные данные
        if (userData.user_info) {
            delete userData.user_info.password;
            delete userData.user_info.verification_token;
            delete userData.user_info.reset_token;
            delete userData.user_info.reset_token_expires;
        }
        
        res.json({
            success: true,
            data: userData
        });
        
    } catch (error) {
        console.error('Ошибка экспорта данных:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка экспорта данных'
        });
    }
});

// Удаление аккаунта пользователя
app.delete('/api/profile', authMiddleware(), async (req, res) => {
    try {
        const { password } = req.body;
        
        if (!password) {
            return res.status(400).json({
                success: false,
                error: 'Требуется подтверждение паролем'
            });
        }
        
        // Проверяем пароль
        const user = await db.get('SELECT password FROM users WHERE id = ?', [req.user.id]);
        const isPasswordValid = await bcrypt.compare(password, user.password);
        
        if (!isPasswordValid) {
            return res.status(400).json({
                success: false,
                error: 'Неверный пароль'
            });
        }
        
        // Для суперадмина нужны дополнительные проверки
        if (req.user.role === 'superadmin') {
            const superadminCount = await db.get(
                "SELECT COUNT(*) as count FROM users WHERE role = 'superadmin'"
            );
            
            if (superadminCount.count <= 1) {
                return res.status(400).json({
                    success: false,
                    error: 'Нельзя удалить последнего суперадмина'
                });
            }
        }
        
        // Мягкое удаление (деактивация аккаунта)
        await db.run(
            `UPDATE users SET 
                is_active = 0,
                email = CONCAT(email, '_deleted_', ?),
                phone = NULL,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [Date.now(), req.user.id]
        );
        
        // Создаем запись об удалении
        await db.run(
            `INSERT INTO transactions 
            (user_id, type, amount, description, status) 
            VALUES (?, ?, ?, ?, ?)`,
            [
                req.user.id,
                'account_deletion',
                0,
                'Аккаунт удален (деактивирован)',
                'completed'
            ]
        );
        
        res.json({
            success: true,
            message: 'Ваш аккаунт успешно деактивирован'
        });
        
    } catch (error) {
        console.error('Ошибка удаления аккаунта:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка удаления аккаунта'
        });
    }
});

// ==================== ОБРАБОТКА ОШИБОК ====================

// 404 - Маршрут не найден
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Маршрут не найден'
    });
});

// Обработчик ошибок
app.use((err, req, res, next) => {
    console.error('🚨 Ошибка сервера:', err.stack);
    
    res.status(err.status || 500).json({
        success: false,
        error: process.env.NODE_ENV === 'production' ? 'Внутренняя ошибка сервера' : err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

// ==================== ЗАПУСК СЕРВЕРА ====================

const PORT = process.env.PORT || 3000;

// Запуск сервера с инициализацией БД
const startServer = async () => {
    try {
        await initDatabase();
        
        app.listen(PORT, () => {
            console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🌸 Женский Консьерж API v6.0.0                         ║
║                                                            ║
║   🚀 Сервер запущен на порту ${PORT}                      ║
║   📊 Режим: ${process.env.NODE_ENV || 'development'}      ║
║   🗄️  База данных: SQLite                                ║
║                                                            ║
║   🔗 Основные маршруты:                                   ║
║   • http://localhost:${PORT}/ - Главная                   ║
║   • http://localhost:${PORT}/api/health - Проверка здоровья║
║                                                            ║
║   👤 Тестовые аккаунты (без вступительного взноса):       ║
║   • 👑 Админ: admin@test.com / admin123                  ║
║   • 👩 Клиент: client@test.com / client123                ║
║   • 👩‍🏫 Исполнитель: performer@test.com / performer123     ║
║                                                            ║
║   📁 Фронтенд: http://localhost:${PORT}/index.html       ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
            `);
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error);
        process.exit(1);
    }
};

startServer();

// Обработка завершения работы
process.on('SIGINT', async () => {
    console.log('🔄 Закрытие соединения с базой данных...');
    if (db) {
        await db.close();
    }
    console.log('👋 Сервер остановлен');
    process.exit(0);
});

// Экспорт для тестирования
if (process.env.NODE_ENV === 'test') {
    module.exports = {
        app,
        db,
        initDatabase,
        createInitialData
    };
}
