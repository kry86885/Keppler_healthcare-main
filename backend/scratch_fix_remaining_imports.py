import os

PROJECT_ROOT = r"d:\HOSP AI\Keppler_healthcare-main\backend"

def read_file(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def write_file(path, content):
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

# Billing
path = os.path.join(PROJECT_ROOT, "modules", "billing", "routes.py")
code = read_file(path)
header = """from flask import Blueprint, request, jsonify, g
from datetime import datetime
import app

from app import (
    require_permissions, log_audit_event, row_to_dict, rows_to_dicts, to_amount_paise, 
    create_razorpay_order, require_razorpay_configured, current_hospital_id, normalize_payment_mode,
    validate_required_fields, RAZORPAY_KEY_ID
)
from utils.database import (
    create_invoice, update_invoice, get_invoice, list_invoices, get_patient,
    add_invoice_item, list_invoice_items, record_invoice_payment,
    list_pharmacy_sales, list_lab_tests_by_patient, delete_invoice, get_invoice_by_id,
    get_revenue_summary, list_insurance_claims, create_insurance_claim, update_insurance_claim, delete_insurance_claim
)

"""
idx = code.find("billing_bp = Blueprint('billing', __name__)")
write_file(path, header + code[idx:])
# Also fix verify_razorpay_signature -> app.verify_razorpay_signature
code = read_file(path)
code = code.replace("if not verify_razorpay_signature(", "if not app.verify_razorpay_signature(")
write_file(path, code)

# Pharmacy
path = os.path.join(PROJECT_ROOT, "modules", "pharmacy", "routes.py")
code = read_file(path)
header = """from flask import Blueprint, request, jsonify, g
from app import (
    require_permissions, log_audit_event, row_to_dict, rows_to_dicts, current_hospital_id,
    validate_required_fields
)
from utils.database import (
    list_inventory, add_inventory, update_inventory, delete_inventory,
    list_pharmacy_sales, record_pharmacy_sale, list_inventory_items, upsert_inventory_item,
    delete_inventory_item, create_pharmacy_sale, list_pharmacy_suppliers, create_pharmacy_supplier,
    update_pharmacy_supplier, delete_pharmacy_supplier, list_pharmacy_purchases, create_pharmacy_purchase,
    update_pharmacy_purchase, delete_pharmacy_purchase, get_pharmacy_summary
)

"""
idx = code.find("pharmacy_bp = Blueprint('pharmacy', __name__)")
write_file(path, header + code[idx:])

# Diagnostics
path = os.path.join(PROJECT_ROOT, "modules", "diagnostics", "routes.py")
code = read_file(path)
header = """from flask import Blueprint, request, jsonify, g
from app import (
    require_permissions, log_audit_event, row_to_dict, rows_to_dicts, current_hospital_id,
    validate_required_fields
)
from utils.database import (
    list_lab_tests, record_lab_test, update_lab_test, delete_lab_test, list_lab_vendors,
    create_lab_vendor, update_lab_vendor, delete_lab_vendor, list_diagnostics, create_diagnostic_record,
    update_diagnostic_record, delete_diagnostic_record, get_diagnostic_summary
)

"""
idx = code.find("diagnostics_bp = Blueprint('diagnostics', __name__)")
write_file(path, header + code[idx:])

# HR
path = os.path.join(PROJECT_ROOT, "modules", "hr", "routes.py")
code = read_file(path)
header = """from flask import Blueprint, request, jsonify, g
from werkzeug.exceptions import BadRequest
from app import (
    require_permissions, log_audit_event, row_to_dict, rows_to_dicts, current_hospital_id, 
    request_hospital_id, normalize_department_name, validate_required_fields
)
from core.auth import signup_employee, resolve_user_permissions, ASSIGNABLE_MODULES
from utils.database import (
    list_hospitals, get_all_employees, get_employee, update_employee,
    list_attendance, mark_attendance, get_employee_stats, search_employees, delete_employee,
    activate_employee, deactivate_employee, list_departments, create_department, update_department,
    delete_department, create_attendance, update_attendance_record, delete_attendance_record,
    list_payroll, create_payroll_record, update_payroll_record, delete_payroll_record,
    list_leave_requests, create_leave_request, update_leave_request, delete_leave_request,
    update_leave_status, get_audit_logs
)

"""
idx = code.find("hr_bp = Blueprint('hr', __name__)")
write_file(path, header + code[idx:])

# Clean up audit blueprint in app.py
app_path = os.path.join(PROJECT_ROOT, "app.py")
app_code = read_file(app_path)
app_code = app_code.replace("from modules.audit.routes import audit_bp\napp.register_blueprint(audit_bp)\n", "")
write_file(app_path, app_code)
