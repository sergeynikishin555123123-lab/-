FROM node:18-alpine

WORKDIR /app

# Копируем package.json и package-lock.json
COPY package*.json ./

# Создаем package-lock.json если его нет
RUN npm init -y 2>/dev/null || true && \
    if [ ! -f package-lock.json ]; then \
        npm install --package-lock-only --no-audit; \
    fi

# Устанавливаем зависимости только для production
RUN npm ci --only=production --no-audit --prefer-offline

# Копируем остальные файлы
COPY . .

# Создаем необходимые директории
RUN mkdir -p logs uploads exports

# Открываем порт
EXPOSE 3000

# Health check для TimeWeb
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Запуск приложения
CMD ["node", "server.js"]
