"""Gemini-backed implementation of the OCR/LLM provider interfaces.

Wraps the existing utils/ocr.py logic (kept there since it also handles the low-level
mime-type detection / PDF-text-extraction / markdown-cleanup helpers already exercised by
the pre-existing test suite) rather than duplicating it. This is the *only* place outside
utils/ocr.py that talks to the google-genai client.
"""

from utils.ocr import extract_text_from_image as _gemini_extract_text
from utils.ocr import get_genai_model, _generate_content


class GeminiOCRProvider:
    def extract_text(self, file_bytes, language="en", doc_type="document", filename=None):
        return _gemini_extract_text(file_bytes, language, doc_type, filename=filename)


class GeminiLLMProvider:
    def is_configured(self) -> bool:
        return get_genai_model() is not None

    def generate(self, prompt: str, context: str = "", **kwargs):
        client = get_genai_model()
        if client is None:
            return None
        full_prompt = f"{context}\n\n{prompt}" if context else prompt
        try:
            return _generate_content(client, full_prompt)
        except Exception:
            return None
