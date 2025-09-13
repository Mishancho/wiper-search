# Настройка переменных окружения на Render

## Необходимые переменные окружения

Для работы приложения на Render необходимо настроить следующие переменные окружения:

### 1. GOOGLE_SHEETS_ID
ID вашей Google Sheets таблицы. Получите его из URL таблицы:
```
https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
```

### 2. GOOGLE_SERVICE_ACCOUNT_KEY
JSON содержимое файла service account key. 

**Как получить:**
1. Перейдите в [Google Cloud Console](https://console.cloud.google.com/)
2. Создайте новый проект или выберите существующий
3. Включите Google Sheets API и Google Drive API
4. Создайте Service Account:
   - Перейдите в "IAM & Admin" → "Service Accounts"
   - Нажмите "Create Service Account"
   - Заполните название и описание
   - Нажмите "Create and Continue"
5. Создайте ключ:
   - Выберите созданный Service Account
   - Перейдите на вкладку "Keys"
   - Нажмите "Add Key" → "Create new key"
   - Выберите тип "JSON"
   - Скачайте файл

**Как настроить на Render:**
1. Откройте скачанный JSON файл
2. Скопируйте всё содержимое файла
3. В настройках Render Web Service перейдите в "Environment"
4. Добавьте переменную `GOOGLE_SERVICE_ACCOUNT_KEY` со значением - скопированным JSON содержимым

### 3. Предоставление доступа к таблице
1. Откройте вашу Google Sheets таблицу
2. Нажмите "Share" (Поделиться)
3. Добавьте email адрес Service Account (находится в JSON файле в поле "client_email")
4. Дайте права "Editor" или "Viewer"

## Пример настройки на Render

```
GOOGLE_SHEETS_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"your-project",...}
```

## Проверка работы

После настройки переменных окружения:
1. Перезапустите сервис на Render
2. Проверьте логи на наличие ошибок
3. Протестируйте поиск тормозных колодок
