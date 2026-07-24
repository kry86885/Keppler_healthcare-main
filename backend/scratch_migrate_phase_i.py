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
    "reports": ["/api/reports"],
    "dashboard": ["/api/dashboard", "/api/stats"],
    "op": ["/api/op"],
    "documents": ["/api/documents", "/api/certificates"],
    "ai_exports": ["/api/ai", "/api/ocr", "/api/export"],
    "ot": ["/api/ot"],
    "accounts": ["/api/accounts"]
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

def create_module_file(domain):
    # we already have the __init__.py and routes.py scaffolded, we just need to append to routes.py
    filepath = os.path.join(PROJECT_ROOT, "modules", domain, "routes.py")
    if len(routes_to_extract[domain]) > 0:
        content = get_file_content(filepath)
        content += "\n".join(routes_to_extract[domain])
        write_file_content(filepath, content)

for block in routes_content_to_remove:
    app_content = app_content.replace(block, "")

registration_code = ""
for domain in domains:
    create_module_file(domain)
    registration_code += f"from modules.{domain}.routes import {domain}_bp\napp.register_blueprint({domain}_bp)\n"
    print(f"Extracted {len(routes_to_extract[domain])} {domain} routes.")

# remove the if __name__ == "__main__": block from the end of app_content to append registration code properly.
# Actually let's just replace if __name__ == "__main__": with the registrations and then append it back.
if "if __name__ == \"__main__\":" in app_content:
    parts = app_content.split("if __name__ == \"__main__\":")
    new_app_content = parts[0] + registration_code + "\nif __name__ == \"__main__\":" + parts[1]
else:
    new_app_content = app_content + "\n" + registration_code

write_file_content(os.path.join(PROJECT_ROOT, "app.py"), new_app_content)
