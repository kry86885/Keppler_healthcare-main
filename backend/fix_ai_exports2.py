import os

filepath = r"d:\HOSP AI\Keppler_healthcare-main\backend\modules\ai_exports\routes.py"
with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

content = content.replace("from core.ai import extract_text_from_pdf, search_patient_history_internal", "from ai.service import extract_text_from_image, patient_history_search")

with open(filepath, "w", encoding="utf-8") as f:
    f.write(content)
