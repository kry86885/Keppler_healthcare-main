import os
import re

PROJECT_ROOT = r"d:\HOSP AI\Keppler_healthcare-main\backend"

def get_file_content(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

app_content = get_file_content(os.path.join(PROJECT_ROOT, "app.py"))

routes = []
# Match a complete route block
pattern = re.compile(r"(@app\.(?:route|get|post|put|delete|patch)\(.*?\).*?(?:\n@.*)*\ndef .*?\n(?:    .*\n|\s*\n)*)", re.MULTILINE)

matches = pattern.finditer(app_content)
for m in matches:
    routes.append(m.group(1))

print(f"Found {len(routes)} routes in app.py")

domains = {
    "auth": ["/api/auth"],
    "admin": ["/api/admin", "/api/platform"],
    "patients": ["/api/patients", "/api/registration", "/api/op", "/api/admissions"],
    "appointments": ["/api/appointments"],
    "billing": ["/api/billing", "/api/payments", "/api/invoices"],
    "pharmacy": ["/api/pharmacy"],
    "lab": ["/api/lab", "/api/diagnostics"],
    "hrms": ["/api/employees", "/api/hrms", "/api/departments", "/api/attendance"],
    "dashboard": ["/api/dashboard", "/api/stats"],
    "reports": ["/api/reports"],
    "certificates": ["/api/certificates"],
    "ot": ["/api/ot"],
    "accounts": ["/api/accounts"]
}

domain_routes = {k: [] for k in domains.keys()}
domain_routes["other"] = []

for route in routes:
    path_match = re.search(r"@app\.(?:route|get|post|put|delete|patch)\([\"']([^\"']+)[\"']", route)
    if not path_match:
        continue
    path = path_match.group(1)
    
    assigned = False
    for domain, prefixes in domains.items():
        if any(path.startswith(prefix) for prefix in prefixes):
            domain_routes[domain].append(path)
            assigned = True
            break
            
    if not assigned:
        domain_routes["other"].append(path)

for domain, rts in domain_routes.items():
    print(f"{domain}: {len(rts)} routes")
