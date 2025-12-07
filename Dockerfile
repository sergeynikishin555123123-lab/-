# Используем официальный образ Node.js LTS
FROM node:18-alpine

# Устанавливаем рабочего пользователя для безопасности
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Создаем рабочую директорию
WORKDIR /app

# Копируем package.json и package-lock.json
COPY package*.json ./

# Устанавливаем зависимости с правами root для system папок
RUN npm ci --only=production --no-audit

# Копируем исходный код
COPY . .

# Создаем необходимые директории с правильными правами
RUN mkdir -p logs uploads exports public && \
    chown -R nodejs:nodejs /app && \
    chmod -R 755 /app

# Меняем пользователя на безопасного
USER nodejs

# Открываем порт
EXPOSE 3000

# Проверка здоровья
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error()})"

# Команда запуска
CMD ["npm", "start"]
