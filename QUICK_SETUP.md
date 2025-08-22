# ⚡ Быстрая настройка для вашей таблицы

## 🎯 Ваша таблица уже настроена!

Приложение настроено для работы с таблицей: [Wipers](https://docs.google.com/spreadsheets/d/1k2PVl3CFNvJQRkcB_sOMb8KLG07qLT3MLfSNBBtxagw/edit)

## 📋 Что нужно сделать:

### 1. ✅ Установить зависимости
```bash
pip install -r requirements.txt
```

### 2. ✅ Настроить приложение
```bash
python setup_real_table.py
```

### 3. 🔑 Получить Google API ключ

1. Перейдите на [Google Cloud Console](https://console.cloud.google.com/)
2. Создайте новый проект
3. Включите Google Sheets API
4. Создайте Service Account
5. Скачайте JSON ключ
6. Переименуйте в `service-account-key.json`
7. Поместите в корень проекта

### 4. 🔗 Дать доступ к таблице

1. Откройте вашу таблицу
2. Нажмите "Share" (Поделиться)
3. Добавьте email из service account (в JSON файле)
4. Дайте права "Viewer" (Просмотр)

### 5. ✅ Протестировать
```bash
python test_connection.py
```

### 6. 🚀 Запустить
```bash
python run.py
```

## 📊 Структура вашей таблицы:

- **Front Wipers** - передние щётки
- **Back Wipers** - задние щётки
- Формат: Главный артикул | Альтернативные артикулы
- Разделители: /, (, ), запятые

## 🔍 Примеры поиска:

- `6R1998002` - главный артикул
- `5E1` - альтернативный артикул
- `6v6955425` - задние щётки
- `5JA` - альтернативный артикул

## 🆘 Если что-то не работает:

1. Проверьте наличие `service-account-key.json`
2. Убедитесь, что service account имеет доступ к таблице
3. Проверьте, что Google Sheets API включен
4. Запустите `python test_connection.py` для диагностики

## 📞 Поддержка:

Подробные инструкции см. в `SETUP_GUIDE.md`
