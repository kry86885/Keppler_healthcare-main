import os
import sys
import sqlite3
import random
import uuid
import bcrypt
from datetime import datetime, timedelta

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DB_PATH = os.path.join(PROJECT_ROOT, "healthcare.db")

def generate_dummy_data():
    if not os.path.exists(DB_PATH):
        print(f"Database not found at {DB_PATH}")
        sys.exit(1)
        
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    print("Starting Dummy Data Seeding...")
    
    first_names = ["John", "Jane", "Alice", "Bob", "Charlie", "Diana", "Eve", "Frank", "Grace", "Henry"]
    last_names = ["Doe", "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez"]
    
    # Generate Users / Employees
    roles = ["Doctor", "Nurse", "Pharmacist", "Lab Technician"]
    user_ids = []
    
    for i in range(15):
        emp_id = f"EMP-2026-{random.randint(1000, 9999)}"
        name = f"{random.choice(first_names)}"
        lname = f"{random.choice(last_names)}"
        username = f"{name.lower()}.{lname.lower()}{random.randint(1,999)}"
        role = random.choice(roles)
        dept = "Cardiology" if role == "Doctor" else ("Nursing" if role == "Nurse" else "Operations")
        pwd_hash = bcrypt.hashpw(b"password123", bcrypt.gensalt()).decode('utf-8')
        
        cursor.execute("""
            INSERT INTO users (username, password_hash, role, access_role, user_type, job_role, full_name, email, phone, department, employee_id)
            VALUES (?, ?, 'staff', 'clinician', 'normal', ?, ?, ?, ?, ?, ?)
        """, (username, pwd_hash, role, f"{name} {lname}", f"{username}@hospital.com", f"555-{random.randint(1000,9999)}", dept, emp_id))
        
        user_ids.append(username)
        
    # Generate Patients
    patient_ids = []
    
    for i in range(20):
        pid = f"PAT-2026-{random.randint(1000, 9999)}"
        patient_ids.append(pid)
        fname = random.choice(first_names)
        lname = random.choice(last_names)
        age = random.randint(5, 85)
        gender = random.choice(["Male", "Female"])
        phone = f"+1-555-{random.randint(1000, 9999)}"
        
        cursor.execute("""
            INSERT INTO patients (patient_id, name, last_name, age, gender, phone, uuid) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (pid, fname, lname, age, gender, phone, str(uuid.uuid4())))
        
        # 30% chance of admission
        if random.random() < 0.3:
            ward = random.choice(["General Ward", "ICU", "Private Room", "Maternity"])
            admit_date = (datetime.now() - timedelta(days=random.randint(0, 10))).isoformat()
            cursor.execute("""
                INSERT INTO admissions (patient_id, admission_date, notes, uuid)
                VALUES (?, ?, ?, ?)
            """, (pid, admit_date, f"Admitted to {ward}", str(uuid.uuid4())))
            
    
    # Billing & Invoices
    for i in range(15):
        inv_no = f"INV-2026-{random.randint(1000, 9999)}"
        pid = random.choice(patient_ids)
        total = round(random.uniform(500, 5000), 2)
        paid = total if random.random() > 0.3 else 0
        due = total - paid
        status = "paid" if paid == total else "due"
        date = (datetime.now() - timedelta(days=random.randint(0, 10))).isoformat()
        
        cursor.execute("""
            INSERT INTO invoices (invoice_no, patient_id, module, total_amount, paid_amount, due_amount, payment_status, created_at, uuid)
            VALUES (?, ?, 'OP', ?, ?, ?, ?, ?, ?)
        """, (inv_no, pid, total, paid, due, status, date, str(uuid.uuid4())))
        
        if paid > 0:
            cursor.execute("""
                INSERT INTO invoice_payments (invoice_id, amount, payment_mode, created_at, uuid)
                VALUES ((SELECT id FROM invoices WHERE invoice_no = ?), ?, 'card', ?, ?)
            """, (inv_no, paid, date, str(uuid.uuid4())))
            
    # Pharmacy Inventory
    medicines = ["Paracetamol 500mg", "Amoxicillin 250mg", "Ibuprofen 400mg", "Omeprazole 20mg", "Aspirin 75mg"]
    for med in medicines:
        stock = random.randint(10, 500)
        price = round(random.uniform(2, 50), 2)
        exp = (datetime.now() + timedelta(days=random.randint(100, 1000))).strftime("%Y-%m-%d")
        cursor.execute("""
            INSERT INTO pharmacy_inventory (medicine_name, quantity, unit_price, expiry_date, stock_condition, uuid)
            VALUES (?, ?, ?, ?, 'proper', ?)
        """, (med, stock, price, exp, str(uuid.uuid4())))
        
    # Lab Diagnostics
    for i in range(10):
        test_name = random.choice(["Complete Blood Count (CBC)", "Lipid Profile", "Liver Function Test", "Thyroid Profile"])
        pid = random.choice(patient_ids)
        status = random.choice(["due", "paid"])
        amount = round(random.uniform(50, 500), 2)
        cursor.execute("""
            INSERT INTO diagnostics (patient_id, test_name, amount, due_amount, status, created_at, uuid)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (pid, test_name, amount, amount if status == "due" else 0, status, datetime.now().isoformat(), str(uuid.uuid4())))
        
    # Accounts Ledger
    for i in range(15):
        entry_type = random.choice(["income", "expense"])
        cat = "Patient Fee" if entry_type == "income" else "Vendor Payment"
        amt = round(random.uniform(100, 2000), 2)
        date = (datetime.now() - timedelta(days=random.randint(0, 10))).strftime("%Y-%m-%d")
        cursor.execute("""
            INSERT INTO accounts_ledger (entry_date, entry_type, category, amount, uuid)
            VALUES (?, ?, ?, ?, ?)
        """, (date, entry_type, cat, amt, str(uuid.uuid4())))
        
    # Operations: Appointments
    doctors = [u for u in user_ids]
    if doctors:
        for i in range(10):
            pid = random.choice(patient_ids)
            doc_id = random.choice(doctors)
            date = (datetime.now() + timedelta(days=random.randint(-2, 5))).strftime("%Y-%m-%d %H:00:00")
            status = random.choice(["scheduled", "completed", "cancelled"])
            cursor.execute("""
                INSERT INTO appointments (patient_id, patient_name, visit_type, doctor_name, appointment_date, token_no, status, uuid)
                VALUES (?, ?, 'OP', ?, ?, ?, ?, ?)
            """, (pid, "Patient Name", doc_id, date, random.randint(1,50), status, str(uuid.uuid4())))
            
    conn.commit()
    conn.close()
    
    print("Dummy Data Seeded Successfully!")

if __name__ == "__main__":
    generate_dummy_data()
