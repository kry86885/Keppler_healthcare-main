import os
import re

filepath = r"d:\HOSP AI\Keppler_healthcare-main\backend\modules\ai_exports\routes.py"
with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

content = "import io\nimport csv\nfrom core.ai import extract_text_from_pdf, search_patient_history_internal\n" + content

with open(filepath, "w", encoding="utf-8") as f:
    f.write(content)
