import os
import re
import json
from flask import Flask, render_template, request, jsonify
import gspread
from google.oauth2.service_account import Credentials

app = Flask(__name__)

# Нормализация вводимого артикула
def preprocess_part_number(part_number):
    """Удаляет ведущую букву v/V из номера детали, если она есть."""
    if not isinstance(part_number, str):
        return ''
    normalized = part_number.strip()
    if normalized[:1].lower() == 'v':
        normalized = normalized[1:]
    return normalized

# Приведение строк к единообразному виду для сопоставления
def normalize_token_for_match(value):
    """Uppercase + удаление всех неалфанумерик символов (пробелы, дефисы и т.п.)."""
    if not isinstance(value, str):
        return ''
    return re.sub(r'[^A-Za-z0-9]', '', value).upper().strip()

# Настройка Google Sheets API
SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive'
]

def get_google_sheets_data():
    """Получает данные из Google Sheets с информацией о щетках стеклоочистителей"""
    try:
        # Проверяем наличие переменной окружения
        service_account_key = os.getenv("GOOGLE_SERVICE_ACCOUNT_KEY")
        if not service_account_key:
            raise ValueError("GOOGLE_SERVICE_ACCOUNT_KEY не установлен в переменной окружения")
        
        # Загружаем JSON ключ из переменной окружения
        service_account_info = json.loads(service_account_key)
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
                worksheet_title = worksheet.title.lower()
                
                # Пропускаем листы с тормозными колодками
                if any(keyword in worksheet_title for keyword in ['brake', 'pad', 'тормоз']):
                    continue
                
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
                            # Проверяем, что это не данные о тормозных колодках
                            if (not any(keyword in row[0].lower() for keyword in ['wipers', 'front', 'back', 'brake', 'pad', 'тормоз']) and
                                not any(keyword in row[1].lower() for keyword in ['brake', 'pad', 'тормоз'])):
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
        # Проверяем наличие переменной окружения
        service_account_key = os.getenv("GOOGLE_SERVICE_ACCOUNT_KEY")
        if not service_account_key:
            raise ValueError("GOOGLE_SERVICE_ACCOUNT_KEY не установлен в переменной окружения")
        
        # Загружаем JSON ключ из переменной окружения
        service_account_info = json.loads(service_account_key)
        credentials = Credentials.from_service_account_info(service_account_info, scopes=SCOPES)
        
        client = gspread.authorize(credentials)
        
        # Получаем ID таблицы из переменной окружения
        spreadsheet_id = os.getenv('GOOGLE_SHEETS_ID')
        if not spreadsheet_id:
            raise ValueError("GOOGLE_SHEETS_ID не установлен в переменной окружения")
        
        # Открываем таблицу
        spreadsheet = client.open_by_key(spreadsheet_id)
        
        # Получаем все листы
        all_data = []
        
        for worksheet in spreadsheet.worksheets():
            try:
                worksheet_title = worksheet.title.lower()
                
                # Пропускаем листы со щетками стеклоочистителей
                if any(keyword in worksheet_title for keyword in ['wiper', 'wipe', 'щетк']):
                    continue
                
                data = worksheet.get_all_values()
                current_section = None
                
                # Определяем тип тормозных колодок по названию листа
                if 'front' in worksheet_title and ('brake' in worksheet_title or 'pad' in worksheet_title):
                    current_section = 'Front Brake Pads'
                elif ('back' in worksheet_title or 'rear' in worksheet_title) and ('brake' in worksheet_title or 'pad' in worksheet_title):
                    current_section = 'Rear Brake Pads'
                else:
                    current_section = worksheet.title  # Используем название листа как есть
                
                # Определяем тип тормозных колодок по содержимому листа
                for row in data:
                    if len(row) > 0 and row[0].strip():
                        # Определяем секцию по заголовкам (если не определили по названию листа)
                        if current_section == worksheet.title:
                            if 'front brake' in row[0].lower() or 'front pads' in row[0].lower():
                                current_section = 'Front Brake Pads'
                            elif 'back brake' in row[0].lower() or 'rear brake' in row[0].lower() or 'back pads' in row[0].lower() or 'rear pads' in row[0].lower():
                                current_section = 'Rear Brake Pads'
                        
                        if len(row) >= 3 and row[0].strip():
                            # Проверяем, что это не заголовок и есть данные в колонках
                            # Исключаем данные о щетках стеклоочистителей
                            if (not any(keyword in row[0].lower() for keyword in ['brake', 'pads', 'front', 'back', 'rear', 'part number', 'oe analogue', 'not original', 'wiper', 'wipe', 'щетк']) and
                                not any(keyword in row[1].lower() for keyword in ['wiper', 'wipe', 'щетк']) and
                                not any(keyword in row[2].lower() for keyword in ['wiper', 'wipe', 'щетк']) and
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
                # 1) Удаляем любые пометки в скобках полностью: (change mounting), (note) и т.п.
                alt_parts_clean = re.sub(r"\([^)]*\)", "", alt_parts_str)
                # 2) Разделяем по '/', ',', пробелам
                raw_tokens = re.split(r'[/,\s]+', alt_parts_clean)
                
                # Добавляем сам основной артикул как альтернативу для корректной работы префиксного поиска
                normalized_data.append({
                    'main_part': main_part,
                    'alt_part': main_part,
                    'section': section
                })

                for alt_part in raw_tokens:
                    token = alt_part.strip()
                    if not token:
                        continue
                    # 3) Оставляем только артикулы: латиница/цифры без пробелов, обязательно содержит хотя бы одну цифру
                    if not re.fullmatch(r'[A-Za-z0-9]+', token):
                        continue
                    if not re.search(r'\d', token):
                        continue
                    normalized_data.append({
                        'main_part': main_part,
                        'alt_part': token,
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
    part_number_norm = normalize_token_for_match(part_number)
    found_groups = {}
    
    for item in data:
        main_norm = normalize_token_for_match(item['main_part'])
        alt_norm = normalize_token_for_match(item['alt_part'])
        if (main_norm == part_number_norm or alt_norm == part_number_norm):
            
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

def search_by_prefix(part_prefix, data):
    """Ищет группы по первым 3 символам артикула (без учета регистра)."""
    prefix = normalize_token_for_match(part_prefix)
    if len(prefix) < 3:
        return []
    prefix = prefix[:3]
    found_groups = {}
    
    for item in data:
        main = item['main_part']
        alt = item['alt_part']
        section = item.get('section', 'Unknown')
        if normalize_token_for_match(main).startswith(prefix) or normalize_token_for_match(alt).startswith(prefix):
            if main not in found_groups:
                found_groups[main] = {
                    'parts': set(),
                    'section': section
                }
            found_groups[main]['parts'].add(alt)
            found_groups[main]['parts'].add(main)
    
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
    return render_template('index.html')

@app.route('/brake-pads')
def brake_pads():
    """Страница поиска тормозных колодок"""
    return render_template('brake_pads.html')

@app.route('/search', methods=['POST'])
def search():
    try:
        data = request.get_json()
        part_number = preprocess_part_number(data.get('part_number', ''))
        
        if not part_number:
            return jsonify({'error': 'Part number not specified'}), 400
        
        raw_data = get_google_sheets_data()
        if not raw_data:
            return jsonify({'error': 'Failed to get data from table'}), 500
        
        normalized_data = normalize_data(raw_data)
        results = search_analogs(part_number, normalized_data)
        
        # Если точных совпадений нет, а длина запроса >= 3 — пробуем префиксный поиск
        if not results and len(part_number.strip()) >= 3:
            prefix_results = search_by_prefix(part_number, normalized_data)
            if prefix_results:
                return jsonify({
                    'message': f'Found results for prefix "{part_number[:3].upper()}":',
                    'results': prefix_results
                })
        
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

@app.route('/search-prefix', methods=['POST'])
def search_prefix():
    """Ищет запчасти по первым 3 символам артикула (case-insensitive)."""
    try:
        data = request.get_json()
        part_prefix = preprocess_part_number(data.get('part_prefix', ''))
        if not part_prefix or len(part_prefix.strip()) < 3:
            return jsonify({'error': 'Part prefix must be at least 3 characters'}), 400
        
        raw_data = get_google_sheets_data()
        if not raw_data:
            return jsonify({'error': 'Failed to get data from table'}), 500
        
        normalized_data = normalize_data(raw_data)
        results = search_by_prefix(part_prefix, normalized_data)
        
        if not results:
            return jsonify({
                'message': f'No results for prefix "{part_prefix[:3].upper()}"',
                'results': []
            })
        
        return jsonify({
            'message': f'Found results for prefix "{part_prefix[:3].upper()}":',
            'results': results
        })
    except Exception as e:
        return jsonify({'error': f'Search error: {str(e)}'}), 500

@app.route('/search-brake-pads', methods=['POST'])
def search_brake_pads():
    """API endpoint для поиска аналогов тормозных колодок"""
    try:
        data = request.get_json()
        part_number = preprocess_part_number(data.get('part_number', ''))
        
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
    """Проверка состояния приложения"""
    try:
        # Проверяем наличие необходимых переменных окружения
        env_status = {
            'GOOGLE_SHEETS_ID': bool(os.getenv('GOOGLE_SHEETS_ID')),
            'GOOGLE_SERVICE_ACCOUNT_KEY': bool(os.getenv('GOOGLE_SERVICE_ACCOUNT_KEY'))
        }
        
        return jsonify({
            'status': 'ok',
            'environment_variables': env_status,
            'message': 'Application is running'
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'error': str(e)
        }), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    app.run(debug=False, host='0.0.0.0', port=port)
