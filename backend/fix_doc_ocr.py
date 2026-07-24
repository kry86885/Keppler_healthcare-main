import os

filepath = r"d:\HOSP AI\Keppler_healthcare-main\backend\modules\documents\routes.py"
with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

content = "from ai.service import extract_text_from_image\n" + content

with open(filepath, "w", encoding="utf-8") as f:
    f.write(content)

filepath = r"d:\HOSP AI\Keppler_healthcare-main\backend\tests\test_exports.py"
with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

content = content.replace("monkeypatch.setattr(\"modules.ai_exports.routes.extract_text_from_image\", lambda *_args, **_kwargs: \"Persisted OCR\")", "monkeypatch.setattr(\"modules.documents.routes.extract_text_from_image\", lambda *_args, **_kwargs: \"Persisted OCR\")")

with open(filepath, "w", encoding="utf-8") as f:
    f.write(content)
