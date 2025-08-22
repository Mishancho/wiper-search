#!/usr/bin/env python3
"""
Демонстрационный скрипт для показа новых возможностей приложения
"""

import requests
import json

def demo_search():
    """Демонстрирует поиск с новыми возможностями"""
    
    print("🎯 Демонстрация обновленного приложения поиска щёток")
    print("=" * 60)
    
    # URL приложения
    base_url = "http://localhost:8000"
    
    # Тестовые запросы
    test_queries = [
        "6R1998002",  # Front Wipers
        "5E1",        # Alternative part
        "6v6955425",  # Back Wipers
        "5JA",        # Alternative part
        "8K1998002A"  # Another front wiper
    ]
    
    print("🔍 Тестирование поиска с информацией о типе щёток:")
    print()
    
    for query in test_queries:
        print(f"📋 Поиск: {query}")
        print("-" * 40)
        
        try:
            # Отправляем запрос
            response = requests.post(
                f"{base_url}/search",
                json={"part_number": query},
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code == 200:
                data = response.json()
                print(f"✅ {data['message']}")
                
                if data['results']:
                    for result in data['results']:
                        section = result.get('section', 'Unknown')
                        section_icon = "🚗" if "Front" in section else "🚙" if "Back" in section else "❓"
                        
                        print(f"   {section_icon} {section}")
                        print(f"   📦 Main Part: {result['main_part']}")
                        print(f"   🔗 All Parts: {', '.join(result['all_parts'])}")
                        print()
                else:
                    print("   ❌ Nothing found")
                    print()
            else:
                print(f"   ❌ Error: {response.status_code}")
                print()
                
        except Exception as e:
            print(f"   ❌ Connection error: {e}")
            print()
    
    print("🎉 Демонстрация завершена!")
    print("\n🌐 Откройте http://localhost:8000 для использования веб-интерфейса")

if __name__ == "__main__":
    demo_search()
