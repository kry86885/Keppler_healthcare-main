import sys

file_path = 'backend/utils/database.py'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add ensure_patient_columns
func_code = '''def ensure_patient_columns(conn):
    _ensure_column(conn, "patients", "address", "TEXT")
    _ensure_column(conn, "patients", "blood_group", "TEXT")
    _ensure_column(conn, "patients", "emergency_contact", "TEXT")

def ensure_user_columns(conn):'''
content = content.replace('def ensure_user_columns(conn):', func_code)

# 2. Call it in init_database
content = content.replace('ensure_hospital_columns(conn)', 'ensure_hospital_columns(conn)\n        ensure_patient_columns(conn)')

# 3. Update add_patient SQL
old_sql = 'INSERT INTO patients (hospital_id, patient_id, name, middle_name, last_name, dob, age, weight, height, gender, pregnant, allergies, symptoms, phone)'
new_sql = 'INSERT INTO patients (hospital_id, patient_id, name, middle_name, last_name, dob, age, weight, height, gender, pregnant, allergies, symptoms, phone, address, blood_group, emergency_contact)'
content = content.replace(old_sql, new_sql)

old_vals = 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
new_vals = 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
content = content.replace(old_vals, new_vals)

old_params = '''data.get("phone", ""),
            ),
        )'''
new_params = '''data.get("phone", ""),
                data.get("address", ""),
                data.get("blood_group", ""),
                data.get("emergency_contact", ""),
            ),
        )'''
content = content.replace(old_params, new_params)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print('Patch applied successfully!')
