# TimeWeb Cloud обычно использует свою инфраструктуру
# Этот Dockerfile для локальной разработки

FROM node:18-alpine

WORKDIR /app

# Копируем package.json
COPY package*.json ./

# Устанавливаем зависимости
RUN npm ci --only=production

# Копируем исходный код
COPY . .

# Создаем необходимые директории
RUN mkdir -p uploads public

# Открываем порт
EXPOSE 3000

# Запуск
CMD ["npm", "start"]
