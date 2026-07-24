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
    "patients": ["/api/patients", "/api/admissions", "/api/registration", "/api/departments"],
    "appointments": ["/api/appointments"],
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
            # Check if this route is razorpay specific under appointments, maybe we handle it in appointments for now
            new_block = re.sub(r"@app\.", f"@{domain}_bp.", route_block)
            routes_to_extract[domain].append(new_block)
            routes_content_to_remove.append(route_block)
            break

# We can generate headers and write to files, but since imports are tedious, 
# we can just write the routes and we will manually fix imports via IDE/Regex later.
# For now, let's just create the scripts to pull them out.

patients_routes_header = """from flask import Blueprint, request, jsonify, g
import os
import json
from werkzeug.utils import secure_filename
from app import require_permissions, request_hospital_id, log_audit_event, validate_required_fields, save_uploaded_file, current_hospital_id, row_to_dict, rows_to_dicts

patients_bp = Blueprint('patients', __name__)

# NOTE: Add your utils.database imports here after extraction.

"""

patients_routes_content = patients_routes_header + "\n".join(routes_to_extract["patients"])
write_file_content(os.path.join(PROJECT_ROOT, "modules", "patients", "routes.py"), patients_routes_content)

appointments_routes_header = """from flask import Blueprint, request, jsonify, g
from app import require_permissions, log_audit_event, validate_required_fields, row_to_dict, rows_to_dicts, to_amount_paise, create_razorpay_order, verify_razorpay_signature, require_razorpay_configured

appointments_bp = Blueprint('appointments', __name__)

# NOTE: Add your utils.database imports here after extraction.

"""

appointments_routes_content = appointments_routes_header + "\n".join(routes_to_extract["appointments"])
write_file_content(os.path.join(PROJECT_ROOT, "modules", "appointments", "routes.py"), appointments_routes_content)


new_app_content = app_content
for block in routes_content_to_remove:
    new_app_content = new_app_content.replace(block, "")

registration_code = """
from modules.patients.routes import patients_bp
app.register_blueprint(patients_bp)

from modules.appointments.routes import appointments_bp
app.register_blueprint(appointments_bp)
"""
new_app_content += registration_code

write_file_content(os.path.join(PROJECT_ROOT, "app.py"), new_app_content)

print(f"Extracted {len(routes_to_extract['patients'])} patients routes.")
print(f"Extracted {len(routes_to_extract['appointments'])} appointments routes.")
