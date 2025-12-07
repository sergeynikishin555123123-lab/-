const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs').promises;
const winston = require('winston');

class ExcelGenerator {
    constructor() {
        // Используем временную директорию вместо фиксированной
        this.exportDir = process.env.TMPDIR || '/tmp/exports';
        this.ensureExportDir();
    }

    async ensureExportDir() {
        try {
            await fs.access(this.exportDir);
        } catch {
            try {
                await fs.mkdir(this.exportDir, { recursive: true });
            } catch (error) {
                // Если не удалось создать, используем текущую директорию
                this.exportDir = path.join(process.cwd(), 'temp_exports');
                await fs.mkdir(this.exportDir, { recursive: true });
            }
        }
    }

    // Упрощенная генерация отчета по задачам
    async generateTasksReport(tasks, filters = {}) {
        try {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Задачи');

            // Простые заголовки
            worksheet.columns = [
                { header: '№ задачи', key: 'taskNumber', width: 15 },
                { header: 'Название', key: 'title', width: 30 },
                { header: 'Категория', key: 'category', width: 15 },
                { header: 'Статус', key: 'status', width: 12 },
                { header: 'Дата создания', key: 'createdAt', width: 15 },
                { header: 'Дедлайн', key: 'deadline', width: 15 },
                { header: 'Цена (руб)', key: 'price', width: 12 }
            ];

            // Заполняем данные
            tasks.forEach(task => {
                worksheet.addRow({
                    taskNumber: task.taskNumber,
                    title: task.title,
                    category: this.translateCategory(task.category),
                    status: this.translateStatus(task.status),
                    createdAt: new Date(task.createdAt).toLocaleDateString('ru-RU'),
                    deadline: new Date(task.deadline).toLocaleDateString('ru-RU'),
                    price: task.price || 0
                });
            });

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
            
            // Возвращаем заглушку в случае ошибки
            return {
                filename: 'error-report.txt',
                filepath: '/tmp/error.txt',
                count: 0,
                error: error.message
            };
        }
    }

    // Упрощенный отчет по пользователям
    async generateUsersReport(users) {
        try {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Пользователи');

            // Простые заголовки
            worksheet.columns = [
                { header: 'Имя', key: 'firstName', width: 15 },
                { header: 'Фамилия', key: 'lastName', width: 15 },
                { header: 'Email', key: 'email', width: 25 },
                { header: 'Роль', key: 'role', width: 15 },
                { header: 'Дата регистрации', key: 'createdAt', width: 15 },
                { header: 'Статус', key: 'status', width: 10 }
            ];

            // Данные
            users.forEach(user => {
                worksheet.addRow({
                    firstName: user.firstName,
                    lastName: user.lastName,
                    email: user.email,
                    role: this.translateRole(user.role),
                    createdAt: new Date(user.createdAt).toLocaleDateString('ru-RU'),
                    status: user.isActive ? 'Активен' : 'Неактивен'
                });
            });

            // Генерируем имя файла
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `users-report-${timestamp}.xlsx`;
            const filepath = path.join(this.exportDir, filename);

            await workbook.xlsx.writeFile(filepath);

            winston.info(`Отчет по пользователям сгенерирован: ${filename}`);
            return { filename, filepath, count: users.length };
        } catch (error) {
            winston.error('Ошибка генерации отчета по пользователям:', error);
            
            return {
                filename: 'error-report.txt',
                filepath: '/tmp/error.txt',
                count: 0,
                error: error.message
            };
        }
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

    translateRole(role) {
        const roles = {
            'client': 'Заказчик',
            'performer': 'Исполнитель',
            'admin': 'Администратор',
            'superadmin': 'Супер-админ'
        };
        return roles[role] || role;
    }
}

module.exports = new ExcelGenerator();
