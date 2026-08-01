import sys

content = open('backend/utils/database.py', encoding='utf-8').read()

if 'def ensure_whatsapp_feedback_tables' not in content:
    new_func = '''
def ensure_whatsapp_feedback_tables(cursor, IS_POSTGRES):
    if IS_POSTGRES:
        cursor.execute(\"\"\"
        CREATE TABLE IF NOT EXISTS patient_feedback (
            id SERIAL PRIMARY KEY,
            patient_id INTEGER,
            emr_id INTEGER,
            rating INTEGER,
            comment TEXT,
            status TEXT DEFAULT 'New',
            received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            whatsapp_message_id TEXT,
            phone_number TEXT
        )
        \"\"\")
    else:
        cursor.execute(\"\"\"
        CREATE TABLE IF NOT EXISTS patient_feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER,
            emr_id INTEGER,
            rating INTEGER,
            comment TEXT,
            status TEXT DEFAULT 'New',
            received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            whatsapp_message_id TEXT,
            phone_number TEXT
        )
        \"\"\")
'''
    
    content += '\n' + new_func + '\n'
    
    idx = content.find('def init_database():')
    if idx != -1:
        if 'ensure_emr_tables(cursor, IS_POSTGRES)' in content[idx:]:
            content = content.replace('ensure_emr_tables(cursor, IS_POSTGRES)', 'ensure_emr_tables(cursor, IS_POSTGRES)\n        ensure_whatsapp_feedback_tables(cursor, IS_POSTGRES)')
        elif 'ensure_symptom_ai_tables(cursor, IS_POSTGRES)' in content[idx:]:
            content = content.replace('ensure_symptom_ai_tables(cursor, IS_POSTGRES)', 'ensure_symptom_ai_tables(cursor, IS_POSTGRES)\n        ensure_whatsapp_feedback_tables(cursor, IS_POSTGRES)')
        else:
            print('Could not find where to insert call')
            sys.exit(1)
            
        open('backend/utils/database.py', 'w', encoding='utf-8').write(content)
        print('Patched database.py')
    else:
        print('Could not find init_database')
else:
    print('Already patched')
