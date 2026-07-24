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
    "admin": ["/api/admin", "/api/platform"],
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

admin_routes_header = """from flask import Blueprint, request, jsonify, g
import os
from core.auth import (
    ADMIN_ROUTE_AUTH_COOKIE_NAME,
    create_admin_route_auth_token,
    verify_admin_route_auth_token,
    verify_admin_route_password,
    is_admin_route_auth_configured,
    reset_hospital_admin_password,
    create_default_users,
    ADMIN_ROUTE_AUTH_TTL_SECONDS
)
from utils.database import (
    list_hospitals,
    create_hospital,
    set_hospital_status,
    get_all_employees,
    get_employee,
    update_employee,
    validate_hospital_code,
    get_hospital_by_code,
    row_to_dict,
    rows_to_dicts,
    signup_employee,
    ASSIGNABLE_MODULES
)
from app import require_platform_admin, _session_cookie_settings, log_audit_event, require_permissions, require_admin_route_auth, request_hospital_id

admin_bp = Blueprint('admin', __name__)

"""

admin_routes_content = admin_routes_header + "\n".join(routes_to_extract["admin"])
write_file_content(os.path.join(PROJECT_ROOT, "modules", "admin", "routes.py"), admin_routes_content)

new_app_content = app_content
for block in routes_content_to_remove:
    new_app_content = new_app_content.replace(block, "")

registration_code = """
from modules.admin.routes import admin_bp
app.register_blueprint(admin_bp)
"""
new_app_content += registration_code

write_file_content(os.path.join(PROJECT_ROOT, "app.py"), new_app_content)

print(f"Extracted {len(routes_to_extract['admin'])} admin routes.")
