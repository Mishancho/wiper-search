#!/usr/bin/env python3
"""
Демонстрация мобильных возможностей приложения
"""

import requests
import json

def test_mobile_features():
    """Тестирует мобильные возможности приложения"""
    
    print("📱 Демонстрация мобильных возможностей")
    print("=" * 50)
    
    # URL приложения
    base_url = "http://localhost:8000"
    
    print("✅ PWA (Progressive Web App) функции:")
    print("   • Манифест для установки на главный экран")
    print("   • Service Worker для офлайн работы")
    print("   • Адаптивный дизайн для всех устройств")
    print("   • Touch-friendly интерфейс")
    print()
    
    print("📐 Адаптивные брейкпоинты:")
    print("   • Desktop: > 768px")
    print("   • Tablet: 768px - 480px")
    print("   • Mobile: < 480px")
    print("   • Small Mobile: < 360px")
    print()
    
    print("🎯 Мобильные улучшения:")
    print("   • Предотвращение зума на iOS (font-size: 16px)")
    print("   • Touch-таргеты минимум 44px")
    print("   • Плавная прокрутка")
    print("   • Touch feedback для кнопок")
    print("   • Автофокус только на десктопе")
    print()
    
    print("🔧 Технические особенности:")
    print("   • viewport-fit=cover для iPhone X+")
    print("   • user-scalable=no для предотвращения зума")
    print("   • webkitOverflowScrolling: touch")
    print("   • Автоматическая прокрутка к полю ввода")
    print()
    
    # Тестируем API
    print("🔍 Тестирование API для мобильных запросов:")
    
    test_queries = ["6R1998002", "5E1"]
    
    for query in test_queries:
        try:
            response = requests.post(
                f"{base_url}/search",
                json={"part_number": query},
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15"
                }
            )
            
            if response.status_code == 200:
                data = response.json()
                print(f"   ✅ {query}: {len(data.get('results', []))} results")
            else:
                print(f"   ❌ {query}: Error {response.status_code}")
                
        except Exception as e:
            print(f"   ❌ {query}: Connection error")
    
    print()
    print("🌐 Для тестирования мобильной версии:")
    print("   1. Откройте http://localhost:8000 на мобильном устройстве")
    print("   2. Или используйте DevTools в браузере (F12 → Mobile view)")
    print("   3. Добавьте на главный экран для PWA опыта")
    print()
    print("📱 Рекомендуемые устройства для тестирования:")
    print("   • iPhone (iOS Safari)")
    print("   • Android (Chrome)")
    print("   • iPad (Safari)")
    print("   • Планшеты")

if __name__ == "__main__":
    test_mobile_features()
