import os
import re

PROJECT_ROOT = r"d:\HOSP AI\Keppler_healthcare-main\backend"
modules = ['reports', 'dashboard', 'op', 'documents', 'ai_exports', 'ot', 'accounts']

for mod in modules:
    filepath = os.path.join(PROJECT_ROOT, "modules", mod, "routes.py")
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    
    # Remove bad imports from app
    content = content.replace(",\n    build_reports_export_text,\n    S3_CLIENT,\n    BUCKET_NAME,\n    IS_LOCAL", "")
    content = content.replace("build_reports_export_text,", "")
    content = content.replace("S3_CLIENT,", "")
    content = content.replace("BUCKET_NAME,", "")
    content = content.replace("IS_LOCAL", "")
    
    # Add new core imports
    content = "from core.export import generate_pdf, generate_word\nfrom core.storage import ObjectStorage\n" + content
    
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(content)

# Extract build_reports_export_text from app.py
app_path = os.path.join(PROJECT_ROOT, "app.py")
with open(app_path, "r", encoding="utf-8") as f:
    app_content = f.read()

func_match = re.search(r"(def build_reports_export_text.*?return text\n)", app_content, re.DOTALL)
if func_match:
    func_text = func_match.group(1)
    app_content = app_content.replace(func_text, "")
    with open(app_path, "w", encoding="utf-8") as f:
        f.write(app_content)
        
    reports_path = os.path.join(PROJECT_ROOT, "modules", "reports", "routes.py")
    with open(reports_path, "a", encoding="utf-8") as f:
        f.write("\n" + func_text)

