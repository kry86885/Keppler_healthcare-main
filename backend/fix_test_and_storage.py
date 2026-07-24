import os

filepath = r"d:\HOSP AI\Keppler_healthcare-main\backend\modules\documents\routes.py"
with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

content = "from app import STORAGE\n" + content

with open(filepath, "w", encoding="utf-8") as f:
    f.write(content)

filepath = r"d:\HOSP AI\Keppler_healthcare-main\backend\tests\test_exports.py"
with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

content = content.replace("app_module, \"extract_text_from_image\"", "\"modules.ai_exports.routes.extract_text_from_image\"")
content = content.replace("monkeypatch.setattr(app_module,", "monkeypatch.setattr(")

with open(filepath, "w", encoding="utf-8") as f:
    f.write(content)
