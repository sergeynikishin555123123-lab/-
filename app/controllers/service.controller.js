const Service = require('../models/Service');
const Helpers = require('../utils/helpers');
const winston = require('winston');

class ServiceController {
    // Получение всех услуг
    static async getAllServices(req, res) {
        try {
            const { category, popular, active = 'true' } = req.query;
            
            // Строим фильтр
            const filter = {};
            
            if (category) filter.category = category;
            if (popular === 'true') filter.isPopular = true;
            if (active === 'true') filter.isActive = true;
            
            // Получаем услуги
            const services = await Service.find(filter)
                .sort({ order: 1, name: 1 })
                .populate('performers', 'firstName lastName avatar rating');
            
            // Группируем по категориям
            const groupedServices = {};
            services.forEach(service => {
                if (!groupedServices[service.category]) {
                    groupedServices[service.category] = [];
                }
                groupedServices[service.category].push(service);
            });
            
            res.json({
                success: true,
                data: {
                    services,
                    grouped: groupedServices,
                    total: services.length
                }
            });
        } catch (error) {
            winston.error('Ошибка получения услуг:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при получении услуг');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Получение услуги по ID
    static async getServiceById(req, res) {
        try {
            const { id } = req.params;
            
            const service = await Service.findById(id)
                .populate('performers', 'firstName lastName avatar rating completedTasks');
            
            if (!service) {
                return res.status(404).json({
                    success: false,
                    error: 'Услуга не найдена'
                });
            }
            
            // Проверяем активность услуги (только для клиентов)
            if (req.user.role === 'client' && !service.isActive) {
                return res.status(404).json({
                    success: false,
                    error: 'Услуга временно недоступна'
                });
            }
            
            // Увеличиваем счетчик просмотров (можно добавить в модель)
            
            res.json({
                success: true,
                data: { service }
            });
        } catch (error) {
            winston.error('Ошибка получения услуги:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при получении услуги');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Создание услуги (только для админов)
    static async createService(req, res) {
        try
