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
    "auth": ["/api/auth"],
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
    
    # Check if the path matches the domains but ignore admin auth routes so they go to admin script
    if path.startswith("/api/admin/auth"):
        continue
    
    for domain, prefixes in domains.items():
        if any(path.startswith(prefix) for prefix in prefixes):
            new_block = re.sub(r"@app\.", f"@{domain}_bp.", route_block)
            routes_to_extract[domain].append(new_block)
            routes_content_to_remove.append(route_block)
            break

auth_routes_header = """from flask import Blueprint, request, jsonify, g
from core.auth import (
    authenticate, create_session, check_username_exists,
    signup_hospital_admin, SESSION_COOKIE_NAME,
    get_session_user, delete_session, ADMIN_ROUTE_AUTH_COOKIE_NAME
)
from app import request_hospital_id, require_platform_admin, _session_cookie_settings

auth_bp = Blueprint('auth', __name__)

"""

auth_routes_content = auth_routes_header + "\n".join(routes_to_extract["auth"])
write_file_content(os.path.join(PROJECT_ROOT, "modules", "auth", "routes.py"), auth_routes_content)

new_app_content = app_content
for block in routes_content_to_remove:
    new_app_content = new_app_content.replace(block, "")

registration_code = """
from modules.auth.routes import auth_bp
app.register_blueprint(auth_bp)
"""
new_app_content += registration_code

write_file_content(os.path.join(PROJECT_ROOT, "app.py"), new_app_content)

print(f"Extracted {len(routes_to_extract['auth'])} auth routes.")
