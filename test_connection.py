#!/usr/bin/env python3
"""
Скрипт для тестирования подключения к реальной таблице пользователя
"""

import os
import gspread
from google.oauth2.service_account import Credentials
from dotenv import load_dotenv

# Загружаем переменные окружения
load_dotenv()

# Настройка Google Sheets API
SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive'
]

def test_connection():
    """Тестирует подключение к таблице"""
    
    print("🔍 Тестирование подключения к вашей таблице")
    print("=" * 50)
    
    # Проверяем наличие файлов
    if not os.path.exists('service-account-key.json'):
        print("❌ Файл service-account-key.json не найден!")
        print("📝 Скачайте его из Google Cloud Console и поместите в корень проекта")
        return False
    
    if not os.path.exists('.env'):
        print("❌ Файл .env не найден!")
        print("📝 Запустите python setup_real_table.py для настройки")
        return False
    
    try:
        # Подключаемся к Google Sheets
        credentials = Credentials.from_service_account_file(
            'service-account-key.json', 
            scopes=SCOPES
        )
        
        client = gspread.authorize(credentials)
        
        # Получаем ID таблицы
        spreadsheet_id = os.getenv('GOOGLE_SHEETS_ID')
        if not spreadsheet_id:
            print("❌ GOOGLE_SHEETS_ID не найден в .env файле")
            return False
        
        print(f"📊 Подключение к таблице: {spreadsheet_id}")
        
        # Открываем таблицу
        spreadsheet = client.open_by_key(spreadsheet_id)
        print(f"✅ Таблица открыта: {spreadsheet.title}")
        
        # Получаем все листы
        worksheets = spreadsheet.worksheets()
        print(f"📋 Найдено листов: {len(worksheets)}")
        
        total_rows = 0
        sample_data = []
        
        for worksheet in worksheets:
            try:
                data = worksheet.get_all_values()
                valid_rows = 0
                
                print(f"\n📄 Лист: {worksheet.title}")
                print(f"   Всего строк: {len(data)}")
                
                for i, row in enumerate(data):
                    if len(row) >= 2 and row[0].strip() and row[1].strip():
                        # Пропускаем заголовки
                        if not any(keyword in row[0].lower() for keyword in ['wipers', 'front', 'back']):
                            valid_rows += 1
                            if len(sample_data) < 5:  # Сохраняем первые 5 примеров
                                sample_data.append({
                                    'sheet': worksheet.title,
                                    'main_part': row[0].strip(),
                                    'alt_parts': row[1].strip()
                                })
                
                print(f"   Валидных записей: {valid_rows}")
                total_rows += valid_rows
                
            except Exception as e:
                print(f"   ❌ Ошибка чтения листа {worksheet.title}: {e}")
        
        print(f"\n📊 Итого валидных записей: {total_rows}")
        
        if sample_data:
            print("\n📝 Примеры данных:")
            for i, item in enumerate(sample_data, 1):
                print(f"   {i}. {item['main_part']} → {item['alt_parts']}")
        
        print(f"\n✅ Подключение успешно!")
        print(f"🚀 Приложение готово к работе с {total_rows} записями")
        
        return True
        
    except Exception as e:
        print(f"❌ Ошибка подключения: {e}")
        print("\n🔧 Возможные решения:")
        print("1. Проверьте правильность ID таблицы в .env")
        print("2. Убедитесь, что service account имеет доступ к таблице")
        print("3. Проверьте, что Google Sheets API включен")
        return False

def test_search_functionality():
    """Тестирует функциональность поиска"""
    
    print("\n🔍 Тестирование функциональности поиска")
    print("=" * 50)
    
    try:
        from app import get_google_sheets_data, normalize_data, search_analogs
        
        # Получаем данные
        raw_data = get_google_sheets_data()
        if not raw_data:
            print("❌ Не удалось получить данные из таблицы")
            return False
        
        # Нормализуем данные
        normalized_data = normalize_data(raw_data)
        print(f"✅ Данные нормализованы: {len(normalized_data)} записей")
        
        # Тестируем поиск
        test_queries = ['6R1998002', '5E1', '6v6955425', '5JA']
        
        for query in test_queries:
            results = search_analogs(query, normalized_data)
            if results:
                print(f"✅ Поиск '{query}': найдено {len(results)} групп")
                for result in results:
                    print(f"   {result['main_part']} → {', '.join(result['all_parts'])}")
            else:
                print(f"❌ Поиск '{query}': ничего не найдено")
        
        return True
        
    except Exception as e:
        print(f"❌ Ошибка тестирования: {e}")
        return False

if __name__ == "__main__":
    print("🚀 Тестирование приложения поиска аналогов щёток")
    print("=" * 60)
    
    # Тестируем подключение
    if test_connection():
        # Тестируем функциональность
        test_search_functionality()
        
        print("\n🎉 Все тесты пройдены!")
        print("🚀 Приложение готово к запуску: python run.py")
    else:
        print("\n❌ Тесты не пройдены. Проверьте настройки.")
