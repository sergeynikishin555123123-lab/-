FROM node:18-alpine

WORKDIR /app

# Копируем только package.json для установки зависимостей
COPY package*.json ./

# Устанавливаем зависимости (без лишних прав)
RUN npm ci --only=production --no-audit --prefer-offline

# Копируем остальные файлы
COPY . .

# Создаем только public директорию (она точно нужна)
RUN mkdir -p public

# Открываем порт
EXPOSE 3000

# Простой health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Запуск приложения
CMD ["node", "server.js"]
