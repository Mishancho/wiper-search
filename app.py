import os
import re
from flask import Flask, render_template, request, jsonify
import gspread
from google.oauth2.service_account import Credentials
from dotenv import load_dotenv

# Загружаем переменные окружения
load_dotenv()

app = Flask(__name__)

# Настройка Google Sheets API
SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive'
]

def get_google_sheets_data():
    """Получает данные из Google Sheets с информацией о типе щёток"""
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
                current_section = None
                
                # Определяем тип щёток по содержимому листа
                for row in data:
                    if len(row) > 0 and row[0].strip():
                        # Определяем секцию по заголовкам
                        if 'front wipers' in row[0].lower():
                            current_section = 'Front Wipers'
                        elif 'back wipers' in row[0].lower():
                            current_section = 'Back Wipers'
                        elif len(row) >= 2 and row[0].strip() and row[1].strip():
                            # Это данные, добавляем с информацией о секции
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

def get_brake_pads_data():
    """Получает данные из Google Sheets с информацией о тормозных колодках"""
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
                worksheet_title = worksheet.title
                
                # Определяем тип тормозных колодок по названию листа
                if 'front' in worksheet_title.lower() and ('brake' in worksheet_title.lower() or 'pad' in worksheet_title.lower()):
                    current_section = 'Front Brake Pads'
                elif ('back' in worksheet_title.lower() or 'rear' in worksheet_title.lower()) and ('brake' in worksheet_title.lower() or 'pad' in worksheet_title.lower()):
                    current_section = 'Rear Brake Pads'
                else:
                    current_section = worksheet_title  # Используем название листа как есть
                
                # Определяем тип тормозных колодок по содержимому листа
                for row in data:
                    if len(row) > 0 and row[0].strip():
                        # Определяем секцию по заголовкам (если не определили по названию листа)
                        if current_section == worksheet_title:
                            if 'front brake' in row[0].lower() or 'front pads' in row[0].lower():
                                current_section = 'Front Brake Pads'
                            elif 'back brake' in row[0].lower() or 'rear brake' in row[0].lower() or 'back pads' in row[0].lower() or 'rear pads' in row[0].lower():
                                current_section = 'Rear Brake Pads'
                        
                        if len(row) >= 3 and row[0].strip():
                            # Проверяем, что это не заголовок и есть данные в колонках
                            if (not any(keyword in row[0].lower() for keyword in ['brake', 'pads', 'front', 'back', 'rear', 'part number', 'oe analogue', 'not original']) and
                                row[0].strip() and (row[1].strip() or row[2].strip())):
                                
                                # Сохраняем отдельно OE analogue и Not Original
                                oe_analogue = row[1].strip() if len(row) > 1 else ''
                                not_original = row[2].strip() if len(row) > 2 else ''
                                
                                all_data.append({
                                    'main_part': row[0].strip(),
                                    'oe_analogue': oe_analogue,
                                    'not_original': not_original,
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
                # Улучшенная обработка разделителей для вашей таблицы
                # Поддерживаем: /, ,, (, ), пробелы
                # Обрабатываем скобки как отдельные разделители
                alt_parts_str = alt_parts_str.replace('(', '/').replace(')', '/')
                alt_parts = re.split(r'[/,\s]+', alt_parts_str)
                
                for alt_part in alt_parts:
                    alt_part = alt_part.strip()
                    if alt_part and len(alt_part) > 0:  # Пропускаем пустые строки
                        normalized_data.append({
                            'main_part': main_part,
                            'alt_part': alt_part,
                            'section': section
                        })
    
    return normalized_data

def normalize_brake_pads_data(raw_data):
    """Нормализует данные тормозных колодок для поиска"""
    normalized_data = []
    
    for item in raw_data:
        if isinstance(item, dict) and 'main_part' in item:
            main_part = item['main_part']
            oe_analogue = item.get('oe_analogue', '')
            not_original = item.get('not_original', '')
            section = item.get('section', 'Unknown')
            
            if main_part:
                # Добавляем основной артикул
                normalized_data.append({
                    'main_part': main_part,
                    'alt_part': main_part,
                    'section': section,
                    'oe_analogue': oe_analogue,
                    'not_original': not_original
                })
                
                # Добавляем OE analogue как альтернативу
                if oe_analogue:
                    normalized_data.append({
                        'main_part': main_part,
                        'alt_part': oe_analogue,
                        'section': section,
                        'oe_analogue': oe_analogue,
                        'not_original': not_original
                    })
                
                # Добавляем Not Original как альтернативу
                if not_original:
                    normalized_data.append({
                        'main_part': main_part,
                        'alt_part': not_original,
                        'section': section,
                        'oe_analogue': oe_analogue,
                        'not_original': not_original
                    })
    
    return normalized_data

def search_analogs(part_number, data):
    """Ищет аналоги для заданного артикула"""
    part_number = part_number.upper().strip()
    found_groups = {}
    
    # Ищем артикул в данных
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
    
    # Преобразуем в список для ответа
    result = []
    for main_part, group_info in found_groups.items():
        parts_list = sorted(list(group_info['parts']))
        result.append({
            'main_part': main_part,
            'all_parts': parts_list,
            'section': group_info['section']
        })
    
    return result

def search_brake_pads_analogs(part_number, data):
    """Ищет аналоги тормозных колодок для заданного артикула"""
    part_number = part_number.upper().strip()
    found_groups = {}
    
    # Ищем артикул в данных
    for item in data:
        if (item['main_part'].upper() == part_number or 
            item['alt_part'].upper() == part_number):
            
            main_part = item['main_part']
            section = item.get('section', 'Unknown')
            oe_analogue = item.get('oe_analogue', '')
            not_original = item.get('not_original', '')
            
            if main_part not in found_groups:
                found_groups[main_part] = {
                    'section': section,
                    'oe_analogue': oe_analogue,
                    'not_original': not_original
                }
    
    # Преобразуем в список для ответа
    result = []
    for main_part, group_info in found_groups.items():
        result.append({
            'main_part': main_part,
            'section': group_info['section'],
            'oe_analogue': group_info['oe_analogue'],
            'not_original': group_info['not_original']
        })
    
    return result

@app.route('/')
def index():
    """Главная страница"""
    return render_template('index.html')

@app.route('/brake-pads')
def brake_pads():
    """Страница поиска тормозных колодок"""
    return render_template('brake_pads.html')

@app.route('/search', methods=['POST'])
def search():
    """API endpoint для поиска аналогов"""
    try:
        data = request.get_json()
        part_number = data.get('part_number', '').strip()
        
        if not part_number:
            return jsonify({'error': 'Part number not specified'}), 400
        
        # Получаем данные из Google Sheets
        raw_data = get_google_sheets_data()
        if not raw_data:
            return jsonify({'error': 'Failed to get data from table'}), 500
        
        # Нормализуем данные
        normalized_data = normalize_data(raw_data)
        
        # Ищем аналоги
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

@app.route('/search-brake-pads', methods=['POST'])
def search_brake_pads():
    """API endpoint для поиска аналогов тормозных колодок"""
    try:
        data = request.get_json()
        part_number = data.get('part_number', '').strip()
        
        if not part_number:
            return jsonify({'error': 'Part number not specified'}), 400
        
        # Получаем данные из Google Sheets
        raw_data = get_brake_pads_data()
        if not raw_data:
            return jsonify({'error': 'Failed to get data from table'}), 500
        
        # Нормализуем данные
        normalized_data = normalize_brake_pads_data(raw_data)
        
        # Ищем аналоги
        results = search_brake_pads_analogs(part_number, normalized_data)
        
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
    """Проверка работоспособности приложения"""
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    app.run(debug=False, host='0.0.0.0', port=port)
