# 🚀 Руководство по деплою в интернет (бесплатно)

## 📋 Подготовка проекта

### 1. ✅ Файлы уже созданы:
- `Procfile` - для запуска приложения
- `requirements.txt` - зависимости (добавлен gunicorn)
- `runtime.txt` - версия Python
- `app.py` - настроен для продакшена

### 2. 🔑 Подготовьте Google API ключи:
- Убедитесь, что `service-account-key.json` готов
- Проверьте, что таблица доступна

## 🌐 Варианты размещения:

### 🎯 **Render.com (Рекомендую)**

#### Шаг 1: Создайте аккаунт
1. Перейдите на [render.com](https://render.com)
2. Зарегистрируйтесь через GitHub

#### Шаг 2: Создайте репозиторий на GitHub
```bash
# Инициализируйте Git (если еще не сделано)
git init
git add .
git commit -m "Initial commit"

# Создайте репозиторий на GitHub и добавьте его
git remote add origin https://github.com/ваш-username/wiper-search.git
git push -u origin main
```

#### Шаг 3: Деплой на Render
1. В Render нажмите "New +" → "Web Service"
2. Подключите ваш GitHub репозиторий
3. Настройте:
   - **Name**: `wiper-search`
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn --workers 1 --threads 4 app:app`
   - **Plan**: `Free`

#### Шаг 4: Добавьте переменные окружения
В настройках сервиса добавьте:
- `GOOGLE_SHEETS_ID`: ваш ID таблицы
- `GOOGLE_SERVICE_ACCOUNT_KEY`: полное содержимое `service-account-key.json` как секретную переменную окружения
- `SHEETS_REFRESH_SECONDS`: `180` для обновления кеша раз в три минуты

### 🚂 **Railway.app (Альтернатива)**

#### Шаг 1: Создайте аккаунт
1. Перейдите на [railway.app](https://railway.app)
2. Войдите через GitHub

#### Шаг 2: Деплой
1. Нажмите "New Project"
2. Выберите "Deploy from GitHub repo"
3. Выберите ваш репозиторий
4. Railway автоматически определит Python приложение

#### Шаг 3: Настройте переменные
Добавьте переменные окружения:
- `GOOGLE_SHEETS_ID`
- `GOOGLE_SERVICE_ACCOUNT_KEY` (содержимое JSON файла)

### 🐘 **Heroku (Классика)**

#### Шаг 1: Установите Heroku CLI
```bash
# macOS
brew install heroku/brew/heroku

# Или скачайте с heroku.com
```

#### Шаг 2: Деплой
```bash
# Войдите в Heroku
heroku login

# Создайте приложение
heroku create wiper-search-app

# Добавьте переменные окружения
heroku config:set GOOGLE_SHEETS_ID=ваш_id_таблицы

# Загрузите ключ
heroku config:set GOOGLE_SERVICE_ACCOUNT_KEY="$(cat service-account-key.json)"

# Деплой
git push heroku main
```

## 🔧 Настройка переменных окружения

### Для всех платформ добавьте:
```
GOOGLE_SHEETS_ID=1k2PVl3CFNvJQRkcB_sOMb8KLG07qLT3MLfSNBBtxagw
```

### Для service account key:
1. **Render/Railway**: Загрузите файл или вставьте содержимое
2. **Heroku**: Вставьте содержимое JSON файла

## 📱 После деплоя

### 1. Проверьте работу:
- Откройте URL вашего приложения
- Протестируйте поиск: `6R1998002`, `5E1`

### 2. Настройте домен (опционально):
- Render: бесплатный поддомен
- Railway: бесплатный поддомен
- Heroku: бесплатный поддомен

### 3. Обновите Google Sheets:
- Убедитесь, что таблица доступна для чтения
- Проверьте права доступа service account

## 🆘 Устранение проблем

### Ошибка "Service account key not found":
- Проверьте переменные окружения
- Убедитесь, что ключ загружен правильно

### Ошибка "Failed to get data":
- Проверьте ID таблицы
- Убедитесь, что service account имеет доступ

### Приложение не запускается:
- Проверьте логи в панели управления
- Убедитесь, что все зависимости установлены

## 💰 Стоимость

### Render.com:
- ✅ **Бесплатно**: 750 часов/месяц
- ✅ **SSL**: включен
- ✅ **Домен**: включен

### Railway.app:
- ✅ **Бесплатно**: $5 кредитов/месяц
- ✅ **SSL**: включен
- ✅ **Домен**: включен

### Heroku:
- ✅ **Бесплатно**: 550-1000 часов/месяц
- ✅ **SSL**: включен
- ✅ **Домен**: включен

## 🎯 Рекомендация

**Начните с Render.com** - самый простой и надежный способ для вашего приложения!
