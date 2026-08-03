import sys; sys.path.insert(0,'.')
from utils.database import get_connection, create_invoice, record_invoice_payment
from datetime import datetime

with get_connection() as conn:
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM appointments WHERE patient_id LIKE '%100003%'")
    appointments = [dict(r) for r in cursor.fetchall()]
    
    for apt in appointments:
        if apt.get("status") == "scheduled" or apt.get("status") == "checked_in" or apt.get("status") == "completed":
            # Check if invoice exists
            cursor.execute("SELECT id FROM invoices WHERE patient_id = %s AND doctor_name = %s", (apt["patient_id"], apt["doctor_name"]))
            if not cursor.fetchone():
                invoice_no = f"INV-OP-{datetime.now().strftime('%Y%m%d%H%M%S')}"
                fee = 1000.0 if apt["doctor_name"] == "Naresh" else 500.0
                
                # We do this directly instead of create_invoice so we can backdate it
                cursor.execute(
                    "INSERT INTO invoices (invoice_no, patient_id, module, doctor_name, total_amount, paid_amount, payment_status, hospital_id, created_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    (invoice_no, apt["patient_id"], "OP", apt["doctor_name"], fee, fee, "paid", 1, apt["appointment_date"])
                )
                conn.commit()
                print(f"Created invoice for {apt['patient_id']} - {apt['doctor_name']} - {fee}")

