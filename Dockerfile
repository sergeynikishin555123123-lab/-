FROM node:18-alpine

WORKDIR /app

# Копируем package.json
COPY package*.json ./

# Устанавливаем зависимости и чиним уязвимости
RUN npm ci --only=production --no-audit && \
    npm audit fix --force || true

# Копируем исходный код
COPY . .

# Создаем директории
RUN mkdir -p logs

# Открываем порт
EXPOSE 3000

# Пользователь для безопасности
USER node

# Health check для TimeWeb
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Запуск
CMD ["npm", "start"]
