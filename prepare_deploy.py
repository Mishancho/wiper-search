#!/usr/bin/env python3
"""
Скрипт для подготовки проекта к деплою
"""

import os
import json
import base64

def prepare_for_deploy():
    """Подготавливает проект для деплоя"""
    
    print("🚀 Подготовка проекта к деплою")
    print("=" * 50)
    
    # Проверяем наличие необходимых файлов
    required_files = [
        'app.py',
        'requirements.txt',
        'Procfile',
        'runtime.txt',
        'service-account-key.json',
        '.env'
    ]
    
    print("📋 Проверка файлов:")
    for file in required_files:
        if os.path.exists(file):
            print(f"   ✅ {file}")
        else:
            print(f"   ❌ {file} - НЕ НАЙДЕН!")
    
    print()
    
    # Проверяем .env файл
    if os.path.exists('.env'):
        print("🔧 Переменные окружения:")
        with open('.env', 'r') as f:
            for line in f:
                if line.strip() and not line.startswith('#'):
                    key = line.split('=')[0]
                    print(f"   ✅ {key}")
    
    print()
    
    # Создаем инструкции для деплоя
    print("📝 Инструкции для деплоя:")
    print()
    
    print("1. 🌐 Создайте репозиторий на GitHub:")
    print("   git init")
    print("   git add .")
    print("   git commit -m 'Initial commit'")
    print("   git remote add origin https://github.com/ваш-username/wiper-search.git")
    print("   git push -u origin main")
    print()
    
    print("2. 🎯 Деплой на Render.com:")
    print("   - Перейдите на render.com")
    print("   - Создайте новый Web Service")
    print("   - Подключите GitHub репозиторий")
    print("   - Build Command: pip install -r requirements.txt")
    print("   - Start Command: gunicorn app:app")
    print()
    
    print("3. 🔑 Добавьте переменные окружения:")
    print("   GOOGLE_SHEETS_ID=1k2PVl3CFNvJQRkcB_sOMb8KLG07qLT3MLfSNBBtxagw")
    print()
    
    print("4. 📄 Для service account key:")
    print("   - В Render: Environment → Add Environment Variable")
    print("   - Имя: GOOGLE_SERVICE_ACCOUNT_KEY")
    print("   - Значение: содержимое service-account-key.json")
    print()
    
    # Показываем содержимое service account key для копирования
    if os.path.exists('service-account-key.json'):
        print("📋 Содержимое service-account-key.json для копирования:")
        print("-" * 50)
        with open('service-account-key.json', 'r') as f:
            content = f.read()
            print(content)
        print("-" * 50)
    
    print()
    print("✅ Проект готов к деплою!")
    print("📖 Подробные инструкции см. в DEPLOY_GUIDE.md")

if __name__ == "__main__":
    prepare_for_deploy()
