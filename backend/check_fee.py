import sys; sys.path.insert(0,'.')
from utils.database import get_connection

with get_connection() as conn:
    c = conn.cursor()
    # Check invoices for patient
    c.execute("SELECT id, patient_id, invoice_no, doctor_name, total_amount, paid_amount, due_amount, payment_status FROM invoices WHERE patient_id LIKE '%100003%' LIMIT 10")
    print('invoices for 100003:', [dict(r) for r in c.fetchall()])
    
    # Check doctors with 'naresh'
    c.execute("SELECT id, doctor_name, consultation_fee FROM doctors WHERE LOWER(doctor_name) LIKE '%naresh%'")
    print('naresh doctor:', [dict(r) for r in c.fetchall()])
    
    # Check invoice_payments
    c.execute("SELECT * FROM invoice_payments LIMIT 3")
    print('invoice_payments sample:', [dict(r) for r in c.fetchall()])
