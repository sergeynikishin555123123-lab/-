FROM node:18-alpine

WORKDIR /app

# Устанавливаем системные зависимости
RUN apk add --no-cache curl

# Копируем package.json
COPY package*.json ./

# Устанавливаем зависимости
RUN npm ci --only=production --no-audit

# Копируем остальные файлы
COPY . .

# Создаем директории
RUN mkdir -p logs uploads exports

# Открываем порт
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Запуск
CMD ["npm", "start"]
