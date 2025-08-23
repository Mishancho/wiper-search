import os
import re
import json
from flask import Flask, render_template, request, jsonify
import gspread
from google.oauth2.service_account import Credentials

app = Flask(__name__)

# Настройка Google Sheets API
SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive'
]

def get_google_sheets_data():
    """Получает данные из Google Sheets с информацией о типе щёток"""
    try:
        # Загружаем JSON ключ из переменной окружения
        service_account_info = json.loads(os.getenv("GOOGLE_SERVICE_ACCOUNT_KEY"))
        credentials = Credentials.from_service_account_info(service_account_info, scopes=SCOPES)
        
        client = gspread.authorize(credentials)
        
        # Получаем ID таблицы из переменной окружения
        spreadsheet_id = os.getenv('GOOGLE_SHEETS_ID')
        if not spreadsheet_id:
            raise ValueError("GOOGLE_SHEETS_ID не установлен в переменной окружения")
        
        # Открываем таблицу
        spreadsheet = client.open_by_key(spreadsheet_id)
        
        all_data = []
        
        for worksheet in spreadsheet.worksheets():
            try:
                data = worksheet.get_all_values()
                current_section = None
                
                for row in data:
                    if len(row) > 0 and row[0].strip():
                        # Определяем секцию по заголовкам
                        if 'front wipers' in row[0].lower():
                            current_section = 'Front Wipers'
                        elif 'back wipers' in row[0].lower():
                            current_section = 'Back Wipers'
                        elif len(row) >= 2 and row[0].strip() and row[1].strip():
                            if not any(keyword in row[0].lower() for keyword in ['wipers', 'front', 'back']):
                                all_data.append({
                                    'main_part': row[0].strip(),
                                    'alt_parts': row[1].strip(),
                                    'section': current_section
                                })
            except Exception as e:
                print(f"Ошибка при чтении листа {worksheet.title}: {e}")
                continue
        
        return all_data
        
    except Exception as e:
        print(f"Ошибка при получении данных из Google Sheets: {e}")
        return []

def normalize_data(raw_data):
    """Нормализует данные из таблицы в формат main_part | alt_part с информацией о типе щёток"""
    normalized_data = []
    
    for item in raw_data:
        if isinstance(item, dict) and 'main_part' in item and 'alt_parts' in item:
            main_part = item['main_part']
            alt_parts_str = item['alt_parts']
            section = item.get('section', 'Unknown')
            
            if main_part and alt_parts_str:
                alt_parts_str = alt_parts_str.replace('(', '/').replace(')', '/')
                alt_parts = re.split(r'[/,\s]+', alt_parts_str)
                
                for alt_part in alt_parts:
                    alt_part = alt_part.strip()
                    if alt_part:
                        normalized_data.append({
                            'main_part': main_part,
                            'alt_part': alt_part,
                            'section': section
                        })
    
    return normalized_data

def search_analogs(part_number, data):
    """Ищет аналоги для заданного артикула"""
    part_number = part_number.upper().strip()
    found_groups = {}
    
    for item in data:
        if (item['main_part'].upper() == part_number or 
            item['alt_part'].upper() == part_number):
            
            main_part = item['main_part']
            section = item.get('section', 'Unknown')
            
            if main_part not in found_groups:
                found_groups[main_part] = {
                    'parts': set(),
                    'section': section
                }
            
            found_groups[main_part]['parts'].add(item['alt_part'])
            found_groups[main_part]['parts'].add(item['main_part'])
    
    result = []
    for main_part, group_info in found_groups.items():
        parts_list = sorted(list(group_info['parts']))
        result.append({
            'main_part': main_part,
            'all_parts': parts_list,
            'section': group_info['section']
        })
    
    return result

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/search', methods=['POST'])
def search():
    try:
        data = request.get_json()
        part_number = data.get('part_number', '').strip()
        
        if not part_number:
            return jsonify({'error': 'Part number not specified'}), 400
        
        raw_data = get_google_sheets_data()
        if not raw_data:
            return jsonify({'error': 'Failed to get data from table'}), 500
        
        normalized_data = normalize_data(raw_data)
        results = search_analogs(part_number, normalized_data)
        
        if not results:
            return jsonify({
                'message': f'Part number "{part_number}" not found in database',
                'results': []
            })
        
        return jsonify({
            'message': f'Found analogs for part number "{part_number}":',
            'results': results
        })
        
    except Exception as e:
        return jsonify({'error': f'Search error: {str(e)}'}), 500

@app.route('/health')
def health():
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    app.run(debug=False, host='0.0.0.0', port=port)
