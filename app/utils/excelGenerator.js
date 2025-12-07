const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs').promises;
const winston = require('winston');

class ExcelGenerator {
    constructor() {
        this.exportDir = path.join(__dirname, '../../exports');
        this.ensureExportDir();
    }

    async ensureExportDir() {
        try {
            await fs.access(this.exportDir);
        } catch {
            await fs.mkdir(this.exportDir, { recursive: true });
        }
    }

    // Генерация отчета по задачам
    async generateTasksReport(tasks, filters = {}) {
        try {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Задачи');

            // Заголовки колонок
            worksheet.columns = [
                { header: '№ задачи', key: 'taskNumber', width: 15 },
                { header: 'Название', key: 'title', width: 30 },
                { header: 'Категория', key: 'category', width: 15 },
                { header: 'Клиент', key: 'client', width: 25 },
                { header: 'Исполнитель', key: 'performer', width: 25 },
                { header: 'Статус', key: 'status', width: 12 },
                { header: 'Приоритет', key: 'priority', width: 10 },
                { header: 'Дата создания', key: 'createdAt', width: 15 },
                { header: 'Дедлайн', key: 'deadline', width: 15 },
                { header: 'Цена (руб)', key: 'price', width: 12 },
                { header: 'Оценка', key: 'rating', width: 10 },
                { header: 'Отзыв', key: 'feedback', width: 40 }
            ];

            // Заполняем данные
            tasks.forEach(task => {
                worksheet.addRow({
                    taskNumber: task.taskNumber,
                    title: task.title,
                    category: this.translateCategory(task.category),
                    client: task.client?.fullName || task.client?.email || 'Не указан',
                    performer: task.performer?.fullName || task.performer?.email || 'Не назначен',
                    status: this.translateStatus(task.status),
                    priority: this.translatePriority(task.priority),
                    createdAt: new Date(task.createdAt).toLocaleDateString('ru-RU'),
                    deadline: new Date(task.deadline).toLocaleDateString('ru-RU'),
                    price: task.price,
                    rating: task.rating || '-',
                    feedback: task.feedback?.text || '-'
                });
            });

            // Добавляем итоги
            const totalRow = tasks.length + 3;
            worksheet.getCell(`A${totalRow}`).value = 'Итого:';
            worksheet.getCell(`J${totalRow}`).value = {
                formula: `SUM(J2:J${tasks.length + 1})`,
                result: tasks.reduce((sum, task) => sum + (task.price || 0), 0)
            };

            // Стилизация заголовков
            worksheet.getRow(1).eachCell((cell) => {
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FF4F81BD' }
                };
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
            });

            // Автофильтр
            worksheet.autoFilter = 'A1:L1';

            // Добавляем второй лист со статистикой
            this.addStatisticsSheet(workbook, tasks, filters);

            // Генерируем имя файла
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `tasks-report-${timestamp}.xlsx`;
            const filepath = path.join(this.exportDir, filename);

            // Сохраняем файл
            await workbook.xlsx.writeFile(filepath);

            winston.info(`Отчет по задачам сгенерирован: ${filename}`);
            return { filename, filepath, count: tasks.length };
        } catch (error) {
            winston.error('Ошибка генерации Excel отчета:', error);
            throw new Error('Не удалось сгенерировать отчет');
        }
    }

    // Лист со статистикой
    addStatisticsSheet(workbook, tasks, filters) {
        const statsSheet = workbook.addWorksheet('Статистика');

        // Заголовок
        statsSheet.mergeCells('A1:D1');
        statsSheet.getCell('A1').value = 'Статистика по задачам';
        statsSheet.getCell('A1').font = { size: 16, bold: true };
        statsSheet.getCell('A1').alignment = { horizontal: 'center' };

        // Фильтры
        statsSheet.getCell('A3').value = 'Период отчета:';
        statsSheet.getCell('B3').value = filters.period || 'Все время';
        
        statsSheet.getCell('A4').value = 'Категория:';
        statsSheet.getCell('B4').value = filters.category || 'Все категории';
        
        statsSheet.getCell('A5').value = 'Статус:';
        statsSheet.getCell('B5').value = filters.status || 'Все статусы';

        // Основная статистика
        const statsStartRow = 8;
        
        const statsData = [
            ['Метрика', 'Значение', 'Процент'],
            ['Всего задач', tasks.length, '100%'],
            ['Новые задачи', this.countByStatus(tasks, 'new'), this.percentByStatus(tasks, 'new')],
            ['В работе', this.countByStatus(tasks, 'in_progress'), this.percentByStatus(tasks, 'in_progress')],
            ['Завершено', this.countByStatus(tasks, 'completed'), this.percentByStatus(tasks, 'completed')],
            ['Отменено', this.countByStatus(tasks, 'cancelled'), this.percentByStatus(tasks, 'cancelled')],
            ['Средняя цена', this.averagePrice(tasks), '-'],
            ['Общий доход', this.totalRevenue(tasks), '-'],
            ['Средний рейтинг', this.averageRating(tasks), '-']
        ];

        statsSheet.addRows(statsData);

        // Стилизация
        const headerRow = statsSheet.getRow(statsStartRow);
        headerRow.eachCell((cell) => {
            cell.font = { bold: true };
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFF2F2F2' }
            };
        });

        // Статистика по категориям
        const categoryStatsStart = statsStartRow + statsData.length + 2;
        statsSheet.getCell(`A${categoryStatsStart}`).value = 'Статистика по категориям';
        statsSheet.getCell(`A${categoryStatsStart}`).font = { bold: true, size: 14 };

        const categoryStats = this.getCategoryStatistics(tasks);
        const categoryRows = [
            ['Категория', 'Количество', 'Процент', 'Средняя цена']
        ];

        categoryStats.forEach(stat => {
            categoryRows.push([
                this.translateCategory(stat.category),
                stat.count,
                stat.percentage,
                stat.averagePrice
            ]);
        });

        statsSheet.addRows(categoryRows);

        // Настройка ширины колонок
        statsSheet.columns = [
            { width: 25 },
            { width: 15 },
            { width: 12 },
            { width: 15 }
        ];
    }

    // Вспомогательные методы для статистики
    countByStatus(tasks, status) {
        return tasks.filter(task => task.status === status).length;
    }

    percentByStatus(tasks, status) {
        const count = this.countByStatus(tasks, status);
        return tasks.length > 0 ? `${((count / tasks.length) * 100).toFixed(1)}%` : '0%';
    }

    averagePrice(tasks) {
        const validTasks = tasks.filter(task => task.price && task.price > 0);
        if (validTasks.length === 0) return 0;
        const sum = validTasks.reduce((acc, task) => acc + task.price, 0);
        return Math.round(sum / validTasks.length);
    }

    totalRevenue(tasks) {
        return tasks
            .filter(task => task.status === 'completed' && task.price)
            .reduce((sum, task) => sum + task.price, 0);
    }

    averageRating(tasks) {
        const ratedTasks = tasks.filter(task => task.rating && task.rating > 0);
        if (ratedTasks.length === 0) return 'Нет оценок';
        const sum = ratedTasks.reduce((acc, task) => acc + task.rating, 0);
        return (sum / ratedTasks.length).toFixed(1);
    }

    getCategoryStatistics(tasks) {
        const categories = {};
        
        tasks.forEach(task => {
            if (!categories[task.category]) {
                categories[task.category] = {
                    count: 0,
                    totalPrice: 0
                };
            }
            categories[task.category].count++;
            categories[task.category].totalPrice += task.price || 0;
        });

        return Object.keys(categories).map(category => {
            const data = categories[category];
            return {
                category,
                count: data.count,
                percentage: `${((data.count / tasks.length) * 100).toFixed(1)}%`,
                averagePrice: Math.round(data.totalPrice / data.count)
            };
        }).sort((a, b) => b.count - a.count);
    }

    // Методы перевода
    translateCategory(category) {
        const categories = {
            'home': 'Дом и быт',
            'family': 'Дети и семья',
            'beauty': 'Красота и здоровье',
            'courses': 'Курсы',
            'pets': 'Питомцы',
            'other': 'Другое'
        };
        return categories[category] || category;
    }

    translateStatus(status) {
        const statuses = {
            'new': 'Новая',
            'assigned': 'Назначена',
            'in_progress': 'В работе',
            'completed': 'Завершена',
            'cancelled': 'Отменена',
            'reopened': 'Переоткрыта'
        };
        return statuses[status] || status;
    }

    translatePriority(priority) {
        const priorities = {
            'low': 'Низкий',
            'medium': 'Средний',
            'high': 'Высокий',
            'urgent': 'Срочный'
        };
        return priorities[priority] || priority;
    }

    // Генерация отчета по пользователям
    async generateUsersReport(users) {
        try {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Пользователи');

            // Заголовки
            worksheet.columns = [
                { header: 'ID', key: 'id', width: 10 },
                { header: 'Имя', key: 'firstName', width: 15 },
                { header: 'Фамилия', key: 'lastName', width: 15 },
                { header: 'Email', key: 'email', width: 25 },
                { header: 'Телефон', key: 'phone', width: 15 },
                { header: 'Роль', key: 'role', width: 15 },
                { header: 'Telegram ID', key: 'telegramId', width: 15 },
                { header: 'Подписка', key: 'subscription', width: 15 },
                { header: 'Рейтинг', key: 'rating', width: 10 },
                { header: 'Задач выполнено', key: 'completedTasks', width: 15 },
                { header: 'Дата регистрации', key: 'createdAt', width: 15 },
                { header: 'Последний вход', key: 'lastLogin', width: 15 },
                { header: 'Статус', key: 'status', width: 10 }
            ];

            // Данные
            users.forEach(user => {
                worksheet.addRow({
                    id: user._id.toString().slice(-6),
                    firstName: user.firstName,
                    lastName: user.lastName,
                    email: user.email,
                    phone: user.phone || '-',
                    role: this.translateRole(user.role),
                    telegramId: user.telegramId || '-',
                    subscription: user.subscription?.plan || 'Нет',
                    rating: user.rating || '-',
                    completedTasks: user.completedTasks || 0,
                    createdAt: new Date(user.createdAt).toLocaleDateString('ru-RU'),
                    lastLogin: user.lastLogin ? new Date(user.lastLogin).toLocaleDateString('ru-RU') : '-',
                    status: user.isActive ? 'Активен' : 'Неактивен'
                });
            });

            // Стилизация
            worksheet.getRow(1).eachCell((cell) => {
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FF4F81BD' }
                };
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
            });

            // Автофильтр
            worksheet.autoFilter = 'A1:M1';

            // Сохраняем
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `users-report-${timestamp}.xlsx`;
            const filepath = path.join(this.exportDir, filename);

            await workbook.xlsx.writeFile(filepath);

            winston.info(`Отчет по пользователям сгенерирован: ${filename}`);
            return { filename, filepath, count: users.length };
        } catch (error) {
            winston.error('Ошибка генерации отчета по пользователям:', error);
            throw new Error('Не удалось сгенерировать отчет');
        }
    }

    translateRole(role) {
        const roles = {
            'client': 'Заказчик',
            'performer': 'Исполнитель',
            'admin': 'Администратор',
            'superadmin': 'Супер-админ'
        };
        return roles[role] || role;
    }

    // Удаление старых файлов
    async cleanupOldFiles(maxAgeHours = 24) {
        try {
            const files = await fs.readdir(this.exportDir);
            const now = Date.now();
            const maxAge = maxAgeHours * 60 * 60 * 1000;

            for (const file of files) {
                const filepath = path.join(this.exportDir, file);
                const stats = await fs.stat(filepath);
                
                if (now - stats.mtimeMs > maxAge) {
                    await fs.unlink(filepath);
                    winston.info(`Удален старый файл отчета: ${file}`);
                }
            }
        } catch (error) {
            winston.error('Ошибка очистки старых файлов:', error);
        }
    }
}

module.exports = new ExcelGenerator();
