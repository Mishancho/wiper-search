#!/usr/bin/env python3
"""
Скрипт для запуска приложения поиска аналогов щёток
"""

import os
import sys
import subprocess

def check_dependencies():
    """Проверяет наличие необходимых зависимостей"""
    try:
        import flask
        import gspread
        import dotenv
        print("✅ Все зависимости установлены")
        return True
    except ImportError as e:
        print(f"❌ Отсутствует зависимость: {e}")
        print("📦 Установите зависимости командой: pip install -r requirements.txt")
        return False

def check_config():
    """Проверяет наличие конфигурационных файлов"""
    missing_files = []
    
    if not os.path.exists('.env'):
        missing_files.append('.env')
    
    if not os.path.exists('service-account-key.json'):
        missing_files.append('service-account-key.json')
    
    if missing_files:
        print(f"⚠️  Отсутствуют файлы конфигурации: {', '.join(missing_files)}")
        print("\n📝 Для настройки:")
        print("1. Скопируйте env.example в .env и настройте GOOGLE_SHEETS_ID")
        print("2. Добавьте файл service-account-key.json из Google Cloud Console")
        print("3. Или запустите python test_data.py для создания тестовой таблицы")
        return False
    
    print("✅ Конфигурационные файлы найдены")
    return True

def main():
    """Основная функция запуска"""
    print("🔍 Запуск приложения поиска аналогов щёток")
    print("=" * 50)
    
    # Проверяем зависимости
    if not check_dependencies():
        sys.exit(1)
    
    # Проверяем конфигурацию
    if not check_config():
        print("\n💡 Для быстрой настройки запустите:")
        print("python test_data.py")
        sys.exit(1)
    
    print("\n🚀 Запуск приложения...")
    print("📱 Приложение будет доступно по адресу: http://localhost:8000")
    print("⏹️  Для остановки нажмите Ctrl+C")
    print("-" * 50)
    
            # Запускаем приложение
        try:
            from app import app
            app.run(debug=True, host='0.0.0.0', port=8000)
    except KeyboardInterrupt:
        print("\n👋 Приложение остановлено")
    except Exception as e:
        print(f"\n❌ Ошибка запуска: {e}")

if __name__ == "__main__":
    main()
