# Используем официальный образ Node.js
FROM node:22-slim

# Устанавливаем рабочую директорию
WORKDIR /app

# Устанавливаем системные зависимости для сборки native модулей
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    sqlite3 \
    libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

# Копируем файлы зависимостей
COPY package*.json ./
COPY pnpm-lock.yaml ./

# Если используется pnpm, устанавливаем его
RUN if [ -f pnpm-lock.yaml ]; then \
      echo "Detected pnpm workspace"; \
      npm install -g pnpm; \
    fi

# Устанавливаем зависимости
RUN if [ -f pnpm-lock.yaml ]; then \
      pnpm install --frozen-lockfile --prod; \
    elif [ -f package-lock.json ]; then \
      echo "Detected npm project"; \
      npm ci --only=production; \
    else \
      echo "No lockfile, fallback to basic install"; \
      npm install --only=production; \
    fi

# Копируем остальные файлы приложения
COPY . .

# Создаем необходимые директории для загрузки файлов
RUN mkdir -p public/uploads/categories \
    public/uploads/users \
    public/uploads/services \
    public/uploads/tasks \
    public/uploads/logo

# Открываем порт
EXPOSE 3000

# Запускаем приложение
CMD ["node", "server.js"]
