FROM node:18-alpine

WORKDIR /app

# Устанавливаем системные зависимости
RUN apk add --no-cache curl wget python3 make g++

# Копируем package.json и package-lock.json
COPY package*.json ./

# Устанавливаем зависимости (используем cache)
RUN npm config set registry https://registry.npmjs.org/ && \
    npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000

# Создаем package-lock.json если его нет (для TimeWeb)
RUN if [ ! -f package-lock.json ]; then \
        npm install --package-lock-only --no-audit --no-save; \
    fi

# Устанавливаем зависимости для production
RUN npm ci --only=production --no-audit --prefer-offline

# Копируем исходный код
COPY . .

# Создаем необходимые директории
RUN mkdir -p logs uploads exports public && \
    chmod -R 755 logs uploads exports

# Открываем порт
EXPOSE 3000

# Health check для TimeWeb
HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Запуск приложения
CMD ["node", "server.js"]
