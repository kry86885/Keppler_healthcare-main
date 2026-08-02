"""EasyOCR-backed implementation of the OCRProvider interface -- fully local, no API key.

Extracts raw text via EasyOCR (CPU), then -- if the local Ollama LLM is reachable -- asks
it to clean up OCR noise and structure the text into the same markdown contract the
Gemini provider produced. Falls back to the raw extracted text if the LLM isn't available,
since document upload/OCR must keep working without it.
"""

import io
import re
import threading

from utils.ocr import _detect_mime_type, _extract_text_from_pdf_bytes

from .ollama_provider import OllamaLLMProvider


def _strip_code_fences(text):
    """Smaller local models don't reliably follow "no code fences" instructions --
    strip a leading/trailing ```(markdown)? fence if the model wrapped its answer in one."""
    text = text.strip()
    match = re.match(r"^```(?:markdown|md)?\s*\n?([\s\S]*?)\n?```$", text)
    return match.group(1).strip() if match else text

_reader = None
_reader_lock = threading.Lock()


def _get_reader():
    global _reader
    if _reader is None:
        with _reader_lock:
            if _reader is None:
                import easyocr

                _reader = easyocr.Reader(["en"], gpu=False)
    return _reader


def _document_hint(doc_type):
    type_hints = {
        "prescription": "This is a medical prescription. Focus on medication names, dosages, frequencies, and instructions.",
        "xray_mri": "This is a medical imaging report (X-Ray/MRI). Extract findings, impressions, and any measurements.",
        "test_docs": "This is a medical test report. Extract test names, values, reference ranges, and any abnormal findings.",
    }
    return type_hints.get(doc_type, "")


def _cleanup_prompt(raw_text, doc_type):
    return f"""You are given raw OCR text extracted from a medical document.

{_document_hint(doc_type)}

Task:
1. Remove OCR noise and obvious extraction artifacts, but preserve all medical details and numbers accurately
2. Structure the content with markdown headers (##) for sections like Patient Information, Medications, Diagnosis, Instructions, Test Results
3. Use **bold** for medication names, dosages, frequencies, and critical findings
4. Use bullet points for lists and markdown tables for tabular data
5. Return ONLY the cleaned-up markdown text -- no commentary, no code fences

Raw OCR text:
\"\"\"
{raw_text}
\"\"\"
"""


class EasyOCRProvider:
    def extract_text(self, file_bytes, language="en", doc_type="document", filename=None):
        mime_type = _detect_mime_type(file_bytes, filename)

        try:
            if mime_type == "application/pdf":
                raw_text = _extract_text_from_pdf_bytes(file_bytes)
            else:
                import numpy as np
                from PIL import Image

                image = Image.open(io.BytesIO(file_bytes)).convert("RGB")
                reader = _get_reader()
                lines = reader.readtext(np.array(image), detail=0, paragraph=True)
                raw_text = "\n".join(lines)
        except Exception as exc:
            return f"OCR Error: {exc}"

        raw_text = (raw_text or "").strip()
        if not raw_text:
            return "No text could be extracted from this document."

        llm = OllamaLLMProvider()
        if llm.is_configured():
            cleaned = llm.generate(_cleanup_prompt(raw_text, doc_type))
            if cleaned:
                return _strip_code_fences(cleaned)

        return raw_text
