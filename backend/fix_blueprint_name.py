import os
PROJECT_ROOT = r"d:\HOSP AI\Keppler_healthcare-main\backend"
modules = ['reports', 'dashboard', 'op', 'documents', 'ai_exports', 'ot', 'accounts']

for mod in modules:
    filepath = os.path.join(PROJECT_ROOT, "modules", mod, "routes.py")
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    
    content = content.replace(f"bp = Blueprint('{mod}', __name__)", f"{mod}_bp = Blueprint('{mod}', __name__)")
    
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(content)
