FROM node:18-alpine

WORKDIR /app

# Устанавливаем системные утилиты
RUN apk add --no-cache curl

# Копируем package.json
COPY package*.json ./

# Устанавливаем зависимости с кешем
RUN npm config set registry https://registry.npmjs.org/ && \
    npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000

# Создаем package-lock.json если его нет
RUN if [ ! -f package-lock.json ]; then \
        npm install --package-lock-only --no-audit --no-save; \
    fi

# Устанавливаем зависимости
RUN npm ci --only=production --no-audit --prefer-offline

# Копируем исходный код
COPY . .

# Создаем public директорию (только ее)
RUN mkdir -p public

# Открываем порт
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Запуск
CMD ["node", "server.js"]
