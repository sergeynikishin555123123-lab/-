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
        try {
            const {
                name,
                description,
                category,
                subcategory,
                priceOptions,
                duration,
                requirements,
                instructions,
                isPopular,
                order,
                tags
            } = req.body;
            
            // Проверяем уникальность названия
            const existingService = await Service.findOne({ 
                name: { $regex: new RegExp(`^${name}$`, 'i') },
                category 
            });
            
            if (existingService) {
                return res.status(400).json({
                    success: false,
                    error: 'Услуга с таким названием уже существует в этой категории'
                });
            }
            
            // Создаем услугу
            const service = new Service({
                name,
                description,
                category,
                subcategory,
                priceOptions,
                duration,
                requirements: requirements || [],
                instructions: instructions || '',
                isPopular: isPopular || false,
                order: order || 0,
                tags: tags || [],
                metadata: {
                    createdBy: req.user._id,
                    createdAt: new Date(),
                    updatedAt: new Date()
                }
            });
            
            await service.save();
            
            // Логируем действие
            Helpers.logAction(req.user, 'service_created', { 
                serviceId: service._id,
                category: service.category 
            });
            
            res.status(201).json({
                success: true,
                message: 'Услуга успешно создана',
                data: { service }
            });
        } catch (error) {
            winston.error('Ошибка создания услуги:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при создании услуги');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Обновление услуги (только для админов)
    static async updateService(req, res) {
        try {
            const { id } = req.params;
            const updates = req.body;
            
            // Находим услугу
            const service = await Service.findById(id);
            
            if (!service) {
                return res.status(404).json({
                    success: false,
                    error: 'Услуга не найдена'
                });
            }
            
            // Проверяем уникальность названия при изменении
            if (updates.name && updates.name !== service.name) {
                const existingService = await Service.findOne({ 
                    name: { $regex: new RegExp(`^${updates.name}$`, 'i') },
                    category: updates.category || service.category,
                    _id: { $ne: id }
                });
                
                if (existingService) {
                    return res.status(400).json({
                        success: false,
                        error: 'Услуга с таким названием уже существует в этой категории'
                    });
                }
            }
            
            // Обновляем метаданные
            updates.metadata = {
                ...service.metadata,
                updatedAt: new Date()
            };
            
            // Обновляем услугу
            Object.assign(service, updates);
            await service.save();
            
            // Логируем действие
            Helpers.logAction(req.user, 'service_updated', { 
                serviceId: service._id,
                changes: Object.keys(updates) 
            });
            
            res.json({
                success: true,
                message: 'Услуга успешно обновлена',
                data: { service }
            });
        } catch (error) {
            winston.error('Ошибка обновления услуги:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при обновлении услуги');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Удаление услуги (деактивация)
    static async deleteService(req, res) {
        try {
            const { id } = req.params;
            
            const service = await Service.findById(id);
            
            if (!service) {
                return res.status(404).json({
                    success: false,
                    error: 'Услуга не найдена'
                });
            }
            
            // Деактивируем услугу вместо удаления
            service.isActive = false;
            await service.save();
            
            // Логируем действие
            Helpers.logAction(req.user, 'service_deleted', { 
                serviceId: service._id,
                name: service.name 
            });
            
            res.json({
                success: true,
                message: 'Услуга успешно деактивирована'
            });
        } catch (error) {
            winston.error('Ошибка удаления услуги:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при удалении услуги');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Добавление исполнителя к услуге
    static async addPerformer(req, res) {
        try {
            const { id } = req.params;
            const { performerId } = req.body;
            
            const service = await Service.findById(id);
            
            if (!service) {
                return res.status(404).json({
                    success: false,
                    error: 'Услуга не найдена'
                });
            }
            
            // Проверяем, не добавлен ли уже исполнитель
            if (service.performers.includes(performerId)) {
                return res.status(400).json({
                    success: false,
                    error: 'Исполнитель уже добавлен к этой услуге'
                });
            }
            
            // Добавляем исполнителя
            service.performers.push(performerId);
            await service.save();
            
            // Логируем действие
            Helpers.logAction(req.user, 'performer_added_to_service', { 
                serviceId: service._id,
                performerId 
            });
            
            res.json({
                success: true,
                message: 'Исполнитель успешно добавлен к услуге',
                data: { service }
            });
        } catch (error) {
            winston.error('Ошибка добавления исполнителя:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при добавлении исполнителя');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Удаление исполнителя из услуги
    static async removePerformer(req, res) {
        try {
            const { id } = req.params;
            const { performerId } = req.body;
            
            const service = await Service.findById(id);
            
            if (!service) {
                return res.status(404).json({
                    success: false,
                    error: 'Услуга не найдена'
                });
            }
            
            // Проверяем, добавлен ли исполнитель
            if (!service.performers.includes(performerId)) {
                return res.status(400).json({
                    success: false,
                    error: 'Исполнитель не найден в этой услуге'
                });
            }
            
            // Удаляем исполнителя
            service.performers = service.performers.filter(
                id => id.toString() !== performerId
            );
            await service.save();
            
            // Логируем действие
            Helpers.logAction(req.user, 'performer_removed_from_service', { 
                serviceId: service._id,
                performerId 
            });
            
            res.json({
                success: true,
                message: 'Исполнитель успешно удален из услуги',
                data: { service }
            });
        } catch (error) {
            winston.error('Ошибка удаления исполнителя:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при удалении исполнителя');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Получение услуг по категории
    static async getServicesByCategory(req, res) {
        try {
            const { category } = req.params;
            
            const services = await Service.find({ 
                category,
                isActive: true 
            })
            .sort({ order: 1, name: 1 })
            .populate('performers', 'firstName lastName avatar rating');
            
            // Получаем слоган для категории
            const slogan = Helpers.getCategorySlogan(category);
            
            res.json({
                success: true,
                data: {
                    category,
                    slogan,
                    services,
                    count: services.length
                }
            });
        } catch (error) {
            winston.error('Ошибка получения услуг по категории:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при получении услуг');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Поиск услуг
    static async searchServices(req, res) {
        try {
            const { query, category } = req.query;
            
            if (!query && !category) {
                return res.status(400).json({
                    success: false,
                    error: 'Необходимо указать поисковый запрос или категорию'
                });
            }
            
            // Строим поисковый запрос
            const searchQuery = { isActive: true };
            
            if (category) {
                searchQuery.category = category;
            }
            
            if (query) {
                searchQuery.$or = [
                    { name: { $regex: query, $options: 'i' } },
                    { description: { $regex: query, $options: 'i' } },
                    { tags: { $regex: query, $options: 'i' } }
                ];
            }
            
            const services = await Service.find(searchQuery)
                .sort({ 'statistics.totalOrders': -1, name: 1 })
                .limit(50);
            
            res.json({
                success: true,
                data: {
                    query,
                    services,
                    count: services.length
                }
            });
        } catch (error) {
            winston.error('Ошибка поиска услуг:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при поиске услуг');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Получение популярных услуг
    static async getPopularServices(req, res) {
        try {
            const limit = parseInt(req.query.limit) || 10;
            
            const services = await Service.find({ 
                isPopular: true,
                isActive: true 
            })
            .sort({ order: 1, 'statistics.totalOrders': -1 })
            .limit(limit)
            .populate('performers', 'firstName lastName avatar rating');
            
            res.json({
                success: true,
                data: {
                    services,
                    count: services.length
                }
            });
        } catch (error) {
            winston.error('Ошибка получения популярных услуг:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при получении популярных услуг');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Обновление статистики услуги
    static async updateServiceStatistics(req, res) {
        try {
            const { id } = req.params;
            const { action } = req.body; // 'order', 'rating', 'completion'
            
            const service = await Service.findById(id);
            
            if (!service) {
                return res.status(404).json({
                    success: false,
                    error: 'Услуга не найдена'
                });
            }
            
            // Обновляем статистику в зависимости от действия
            switch (action) {
                case 'order':
                    service.statistics.totalOrders += 1;
                    break;
                case 'rating':
                    // Здесь можно обновить средний рейтинг
                    break;
                case 'completion':
                    // Здесь можно обновить процент завершения
                    break;
            }
            
            await service.save();
            
            res.json({
                success: true,
                message: 'Статистика обновлена',
                data: { statistics: service.statistics }
            });
        } catch (error) {
            winston.error('Ошибка обновления статистики:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при обновлении статистики');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Получение категорий услуг
    static async getCategories(req, res) {
        try {
            const categories = [
                {
                    id: 'home_and_household',
                    name: 'Дом и быт',
                    icon: '🏠',
                    description: 'Уборка, ремонт, организация пространства',
                    color: '#4CAF50',
                    serviceCount: await Service.countDocuments({ 
                        category: 'home_and_household',
                        isActive: true 
                    })
                },
                {
                    id: 'family_and_children',
                    name: 'Дети и семья',
                    icon: '👨‍👩‍👧‍👦',
                    description: 'Няни, репетиторы, семейные мероприятия',
                    color: '#2196F3',
                    serviceCount: await Service.countDocuments({ 
                        category: 'family_and_children',
                        isActive: true 
                    })
                },
                {
                    id: 'beauty_and_health',
                    name: 'Красота и здоровье',
                    icon: '💅',
                    description: 'Маникюр, стилисты, фитнес-тренеры',
                    color: '#E91E63',
                    serviceCount: await Service.countDocuments({ 
                        category: 'beauty_and_health',
                        isActive: true 
                    })
                },
                {
                    id: 'courses_and_education',
                    name: 'Курсы и образование',
                    icon: '🎓',
                    description: 'Онлайн и оффлайн курсы, обучение',
                    color: '#9C27B0',
                    serviceCount: await Service.countDocuments({ 
                        category: 'courses_and_education',
                        isActive: true 
                    })
                },
                {
                    id: 'pets',
                    name: 'Питомцы',
                    icon: '🐶',
                    description: 'Выгул, передержка, ветеринары',
                    color: '#FF9800',
                    serviceCount: await Service.countDocuments({ 
                        category: 'pets',
                        isActive: true 
                    })
                },
                {
                    id: 'events_and_entertainment',
                    name: 'Мероприятия и развлечения',
                    icon: '🎉',
                    description: 'Организация праздников, билеты',
                    color: '#00BCD4',
                    serviceCount: await Service.countDocuments({ 
                        category: 'events_and_entertainment',
                        isActive: true 
                    })
                },
                {
                    id: 'other',
                    name: 'Другое',
                    icon: '📋',
                    description: 'Все остальные услуги',
                    color: '#607D8B',
                    serviceCount: await Service.countDocuments({ 
                        category: 'other',
                        isActive: true 
                    })
                }
            ];
            
            res.json({
                success: true,
                data: { categories }
            });
        } catch (error) {
            winston.error('Ошибка получения категорий:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при получении категорий');
            res.status(apiError.statusCode).json(apiError);
        }
    }
    
    // Получение услуг с пагинацией
    static async getServicesPaginated(req, res) {
        try {
            const { page = 1, limit = 20, category, sortBy = 'order', sortOrder = 'asc' } = req.query;
            
            // Строим фильтр
            const filter = { isActive: true };
            if (category) filter.category = category;
            
            // Настройки сортировки
            const sort = {};
            sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
            
            // Пагинация
            const skip = (page - 1) * limit;
            
            // Получаем услуги
            const services = await Service.find(filter)
                .sort(sort)
                .skip(skip)
                .limit(parseInt(limit))
                .populate('performers', 'firstName lastName avatar rating');
            
            // Общее количество
            const total = await Service.countDocuments(filter);
            
            res.json({
                success: true,
                data: {
                    services,
                    pagination: {
                        total,
                        page: parseInt(page),
                        pages: Math.ceil(total / limit),
                        limit: parseInt(limit)
                    }
                }
            });
        } catch (error) {
            winston.error('Ошибка получения услуг с пагинацией:', error);
            const apiError = Helpers.handleApiError(error, 'Ошибка при получении услуг');
            res.status(apiError.statusCode).json(apiError);
        }
    }
}

module.exports = ServiceController;
