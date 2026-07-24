import os
import re

PROJECT_ROOT = r"d:\HOSP AI\Keppler_healthcare-main\backend"

def get_file_content(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def write_file_content(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

app_content = get_file_content(os.path.join(PROJECT_ROOT, "app.py"))

domains = {
    "billing": ["/api/billing"],
    "pharmacy": ["/api/pharmacy", "/api/inventory"],
    "diagnostics": ["/api/lab", "/api/diagnostics"],
    "hr": ["/api/hr", "/api/employees", "/api/audit"], # putting audit in hr or a separate module. Let's put audit in admin, but wait! We can just put it in a separate audit module, or admin. For now let's leave audit in hr or move to admin. The user's phase says hr & audit permissions. Let's put audit in admin.
    "audit": ["/api/audit"]
}

pattern = re.compile(r"(@app\.(?:route|get|post|put|delete|patch)\(.*?\).*?(?:\n@.*)*\ndef .*?\n(?:    .*\n|\s*\n)*)", re.MULTILINE)
matches = pattern.finditer(app_content)

routes_to_extract = {k: [] for k in domains.keys()}
routes_content_to_remove = []

for m in matches:
    route_block = m.group(1)
    path_match = re.search(r"@app\.(?:route|get|post|put|delete|patch)\([\"']([^\"']+)[\"']", route_block)
    if not path_match:
        continue
    path = path_match.group(1)
    
    for domain, prefixes in domains.items():
        if any(path.startswith(prefix) for prefix in prefixes):
            new_block = re.sub(r"@app\.", f"@{domain}_bp.", route_block)
            routes_to_extract[domain].append(new_block)
            routes_content_to_remove.append(route_block)
            break

def create_module_file(domain, imports):
    header = f"from flask import Blueprint, request, jsonify, g\n{imports}\n\n{domain}_bp = Blueprint('{domain}', __name__)\n\n"
    content = header + "\n".join(routes_to_extract[domain])
    write_file_content(os.path.join(PROJECT_ROOT, "modules", domain, "routes.py"), content)

# Billing
billing_imports = """
from app import require_permissions, log_audit_event, row_to_dict, rows_to_dicts, to_amount_paise, create_razorpay_order, require_razorpay_configured, current_hospital_id, normalize_payment_mode
import app
from utils.database import (
    create_invoice, update_invoice, get_invoice, list_invoices, get_patient,
    add_invoice_item, list_invoice_items, record_invoice_payment,
    list_pharmacy_sales, list_lab_tests_by_patient
)
"""
create_module_file("billing", billing_imports)

# Pharmacy
pharmacy_imports = """
from app import require_permissions, log_audit_event, row_to_dict, rows_to_dicts, current_hospital_id
from utils.database import (
    list_inventory, add_inventory, update_inventory, delete_inventory,
    list_pharmacy_sales, record_pharmacy_sale
)
"""
create_module_file("pharmacy", pharmacy_imports)

# Diagnostics
diagnostics_imports = """
from app import require_permissions, log_audit_event, row_to_dict, rows_to_dicts, current_hospital_id
from utils.database import (
    list_lab_tests, record_lab_test, update_lab_test, delete_lab_test
)
"""
create_module_file("diagnostics", diagnostics_imports)

# HR
hr_imports = """
from app import require_permissions, log_audit_event, row_to_dict, rows_to_dicts, current_hospital_id, request_hospital_id
from core.auth import signup_employee, resolve_user_permissions, ASSIGNABLE_MODULES
from utils.database import (
    list_hospitals, get_all_employees, get_employee, update_employee,
    list_attendance, mark_attendance,
    list_leave_requests, create_leave_request, update_leave_request, delete_leave_request
)
"""
create_module_file("hr", hr_imports)

# Audit
audit_imports = """
from app import require_permissions, log_audit_event, row_to_dict, rows_to_dicts, current_hospital_id
from utils.database import (
    get_audit_logs
)
"""
create_module_file("audit", audit_imports)

# Update app.py
new_app_content = app_content
for block in routes_content_to_remove:
    new_app_content = new_app_content.replace(block, "")

registration_code = """
from modules.billing.routes import billing_bp
app.register_blueprint(billing_bp)

from modules.pharmacy.routes import pharmacy_bp
app.register_blueprint(pharmacy_bp)

from modules.diagnostics.routes import diagnostics_bp
app.register_blueprint(diagnostics_bp)

from modules.hr.routes import hr_bp
app.register_blueprint(hr_bp)

from modules.audit.routes import audit_bp
app.register_blueprint(audit_bp)
"""
new_app_content += registration_code

write_file_content(os.path.join(PROJECT_ROOT, "app.py"), new_app_content)

for domain in domains:
    print(f"Extracted {len(routes_to_extract[domain])} {domain} routes.")
