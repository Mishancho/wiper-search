#!/usr/bin/env python3
"""
Скрипт для настройки приложения с реальной таблицей пользователя
"""

import os
import re

def setup_real_table():
    """Настраивает приложение для работы с реальной таблицей"""
    
    # ID таблицы из URL пользователя
    spreadsheet_id = "1k2PVl3CFNvJQRkcB_sOMb8KLG07qLT3MLfSNBBtxagw"
    
    print("🔧 Настройка приложения для работы с вашей таблицей")
    print("=" * 60)
    
    # Создаем .env файл
    env_content = f"""# ID вашей Google Sheets таблицы
GOOGLE_SHEETS_ID={spreadsheet_id}

# Опционально: путь к файлу service account key
# По умолчанию используется service-account-key.json в корне проекта
GOOGLE_SERVICE_ACCOUNT_FILE=service-account-key.json
"""
    
    try:
        with open('.env', 'w') as f:
            f.write(env_content)
        print("✅ Файл .env создан с ID вашей таблицы")
    except Exception as e:
        print(f"❌ Ошибка создания .env файла: {e}")
        return False
    
    # Проверяем наличие service account key
    if not os.path.exists('service-account-key.json'):
        print("\n⚠️  Файл service-account-key.json не найден!")
        print("📝 Для продолжения вам нужно:")
        print("1. Создать проект в Google Cloud Console")
        print("2. Включить Google Sheets API")
        print("3. Создать Service Account и скачать JSON ключ")
        print("4. Переименовать файл в service-account-key.json")
        print("5. Поместить его в корень проекта")
        print("\n📖 Подробные инструкции см. в SETUP_GUIDE.md")
        return False
    
    print("✅ Файл service-account-key.json найден")
    
    # Анализируем структуру таблицы
    print("\n📊 Анализ структуры вашей таблицы:")
    print("- Таблица содержит данные о щётках стеклоочистителей")
    print("- Разделена на секции: Front Wipers и Back Wipers")
    print("- Формат данных: Главный артикул | Альтернативные артикулы")
    print("- Разделители: /, (, ), запятые")
    
    # Адаптируем код для работы с вашей структурой
    print("\n🔧 Адаптация кода для вашей таблицы...")
    
    # Обновляем функцию получения данных
    update_app_code()
    
    print("\n✅ Настройка завершена!")
    print("\n🚀 Теперь вы можете:")
    print("1. Запустить приложение: python run.py")
    print("2. Открыть http://localhost:5000")
    print("3. Протестировать поиск с артикулами из вашей таблицы")
    print("\n📝 Примеры артикулов для тестирования:")
    print("- 6R1998002 (Front Wipers)")
    print("- 5E1 (альтернативный артикул)")
    print("- 6v6955425 (Back Wipers)")
    
    return True

def update_app_code():
    """Обновляет код приложения для работы с реальной таблицей"""
    
    # Читаем текущий app.py
    try:
        with open('app.py', 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Обновляем функцию получения данных для работы с несколькими листами
        updated_content = update_get_google_sheets_data_function(content)
        
        # Записываем обновленный код
        with open('app.py', 'w', encoding='utf-8') as f:
            f.write(updated_content)
        
        print("✅ Код приложения обновлен для работы с вашей таблицей")
        
    except Exception as e:
        print(f"❌ Ошибка обновления кода: {e}")

def update_get_google_sheets_data_function(content):
    """Обновляет функцию получения данных для работы с несколькими листами"""
    
    # Новая версия функции
    new_function = '''def get_google_sheets_data():
    """Получает данные из Google Sheets"""
    try:
        # Используем service account credentials
        credentials = Credentials.from_service_account_file(
            'service-account-key.json', 
            scopes=SCOPES
        )
        
        client = gspread.authorize(credentials)
        
        # Получаем ID таблицы из переменной окружения
        spreadsheet_id = os.getenv('GOOGLE_SHEETS_ID')
        if not spreadsheet_id:
            raise ValueError("GOOGLE_SHEETS_ID не установлен в .env файле")
        
        # Открываем таблицу
        spreadsheet = client.open_by_key(spreadsheet_id)
        
        # Получаем все листы
        all_data = []
        
        for worksheet in spreadsheet.worksheets():
            try:
                data = worksheet.get_all_values()
                
                # Пропускаем пустые строки и заголовки
                for row in data:
                    if len(row) >= 2 and row[0].strip() and row[1].strip():
                        # Пропускаем строки с заголовками типа "Front Wipers", "Back Wipers"
                        if not any(keyword in row[0].lower() for keyword in ['wipers', 'front', 'back']):
                            all_data.append(row)
                            
            except Exception as e:
                print(f"Ошибка при чтении листа {worksheet.title}: {e}")
                continue
        
        return all_data
        
    except Exception as e:
        print(f"Ошибка при получении данных из Google Sheets: {e}")
        return []'''
    
    # Заменяем старую функцию на новую
    pattern = r'def get_google_sheets_data\(\):.*?return \[\]'
    updated_content = re.sub(pattern, new_function, content, flags=re.DOTALL)
    
    return updated_content

if __name__ == "__main__":
    setup_real_table()
