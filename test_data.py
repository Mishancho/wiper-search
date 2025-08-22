"""
Скрипт для создания тестовых данных в Google Sheets
Используйте этот скрипт для создания демонстрационной таблицы
"""

import gspread
from google.oauth2.service_account import Credentials
import os
from dotenv import load_dotenv

# Загружаем переменные окружения
load_dotenv()

# Настройка Google Sheets API
SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive'
]

def create_test_spreadsheet():
    """Создает новую таблицу с тестовыми данными"""
    try:
        # Используем service account credentials
        credentials = Credentials.from_service_account_file(
            'service-account-key.json', 
            scopes=SCOPES
        )
        
        client = gspread.authorize(credentials)
        
        # Создаем новую таблицу
        spreadsheet = client.create('Тестовые данные щёток')
        
        # Получаем первый лист
        worksheet = spreadsheet.get_worksheet(0)
        
        # Тестовые данные
        test_data = [
            ['Главный артикул', 'Альтернативные артикулы'],
            ['6R1998002', '1S1, 5E1, 5JB, 6V1, 8X1, 1ST'],
            ['8K1955425', '2S1, 3E1, 4JB, 7V1, 9X2'],
            ['4K1955425', '1A1, 2B2, 3C3, 4D4'],
            ['7H1955425', '5E5, 6F6, 7G7, 8H8'],
            ['9K1955425', '9I9, 10J10, 11K11, 12L12'],
            ['3B1955425', '13M13, 14N14, 15O15, 16P16'],
            ['5K1955425', '17Q17, 18R18, 19S19, 20T20'],
            ['2K1955425', '21U21, 22V22, 23W23, 24X24'],
            ['6K1955425', '25Y25, 26Z26, 27A27, 28B28'],
            ['1K1955425', '29C29, 30D30, 31E31, 32F32']
        ]
        
        # Заполняем таблицу данными
        worksheet.update('A1:B' + str(len(test_data)), test_data)
        
        # Настраиваем форматирование
        worksheet.format('A1:B1', {
            'backgroundColor': {'red': 0.2, 'green': 0.6, 'blue': 0.8},
            'textFormat': {'bold': True, 'foregroundColor': {'red': 1, 'green': 1, 'blue': 1}}
        })
        
        # Делаем таблицу доступной для чтения всем
        spreadsheet.share('', perm_type='anyone', role='reader')
        
        print(f"✅ Таблица создана успешно!")
        print(f"📊 URL: {spreadsheet.url}")
        print(f"🆔 ID: {spreadsheet.id}")
        print(f"\n📝 Добавьте ID таблицы в ваш .env файл:")
        print(f"GOOGLE_SHEETS_ID={spreadsheet.id}")
        
        return spreadsheet.id
        
    except Exception as e:
        print(f"❌ Ошибка при создании таблицы: {e}")
        return None

if __name__ == "__main__":
    print("🚀 Создание тестовой таблицы с данными щёток...")
    print("⚠️  Убедитесь, что файл service-account-key.json находится в корне проекта")
    print()
    
    spreadsheet_id = create_test_spreadsheet()
    
    if spreadsheet_id:
        print(f"\n🎉 Готово! Теперь вы можете:")
        print(f"1. Добавить GOOGLE_SHEETS_ID={spreadsheet_id} в .env файл")
        print(f"2. Запустить приложение: python app.py")
        print(f"3. Протестировать поиск с артикулами: 5E1, 1S1, 2S1, 1A1")
    else:
        print("\n❌ Не удалось создать таблицу. Проверьте настройки Google API.")
