# Используем официальный образ Node.js LTS
FROM node:18-alpine

# Создаем рабочую директорию
WORKDIR /app

# Копируем package.json и package-lock.json
COPY package*.json ./

# Устанавливаем зависимости
RUN npm ci --only=production --no-audit

# Копируем исходный код
COPY . .

# Создаем временные директории с правильными правами
RUN mkdir -p /tmp/exports /tmp/logs /tmp/uploads && \
    chmod -R 777 /tmp/exports /tmp/logs /tmp/uploads

# Открываем порт
EXPOSE 3000

# Проверка здоровья
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Команда запуска
CMD ["npm", "start"]
