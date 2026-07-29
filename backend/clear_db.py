from utils.database import get_connection
import os
from dotenv import load_dotenv

load_dotenv()

engine = os.getenv("DB_ENGINE", "sqlite")

with get_connection() as conn:
    cursor = conn.cursor()
    
    if engine == "postgres":
        cursor.execute("TRUNCATE TABLE patients, doctors, department_master, appointments, invoices, invoice_payments, doctor_schedules CASCADE;")
    else:
        tables = [
            "patients", "doctors", "department_master", 
            "appointments", "invoices", "invoice_payments", "doctor_schedules"
        ]
        for table in tables:
            try:
                cursor.execute(f"DELETE FROM {table};")
            except Exception as e:
                print(f"Failed to delete {table}: {e}")
            
    conn.commit()
    print("Database cleared successfully!")
