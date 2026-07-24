"""Public AI service API. Business routes (app.py) import from here only -- never from
utils/ocr.py or google-genai directly, and never instantiate a provider themselves.

Swapping providers (e.g. a future self-hosted vLLM/PaddleOCR stack) means changing the
two module-level singletons below; nothing else in the codebase needs to change.
"""

import json
import re

from utils.ocr import _detect_mime_type
from utils.database import search_similar_documents

from .gemini_provider import GeminiOCRProvider, GeminiLLMProvider
from .preprocessing import preprocess_image_bytes

ocr_provider = GeminiOCRProvider()
llm_provider = GeminiLLMProvider()


def extract_text_from_image(file_bytes, language="en", doc_type="document", filename=None):
    """OCR pipeline entry point: preprocess (deskew/denoise/contrast) then delegate to the
    configured OCR provider. Errors from preprocessing never block OCR -- it falls back to
    the original bytes on any failure (see ai/preprocessing.py)."""
    mime_type = _detect_mime_type(file_bytes, filename)
    processed_bytes = preprocess_image_bytes(file_bytes, mime_type=mime_type)
    return ocr_provider.extract_text(processed_bytes, language=language, doc_type=doc_type, filename=filename)


_ENTITY_EXTRACTION_PROMPT = """You are extracting structured data from a medical document's OCR text.

Document type hint: {doc_type}

Return ONLY valid JSON (no code fences, no commentary) with this exact shape:
{{
  "document_category": "prescription|lab_report|imaging_report|discharge_summary|other",
  "medications": ["<medication name + dosage as written, if any>"],
  "diagnoses": ["<diagnosis or condition mentioned, if any>"],
  "dates_mentioned": ["<any dates found, as written>"],
  "key_values": [{{"label": "<test/measurement name>", "value": "<value>"}}]
}}

If a field has no data, return an empty list for it. Do not invent data not present in the text.

OCR text:
\"\"\"
{text}
\"\"\"
"""


def classify_and_extract_entities(ocr_text: str, doc_type: str = "document"):
    """Second-pass structured extraction over already-OCR'd text. Returns a dict (possibly
    with empty lists) or None if the LLM provider is unavailable or the response wasn't
    parseable JSON -- callers should treat this as optional enrichment, not a hard
    dependency, since document upload/OCR must keep working without it."""
    text = (ocr_text or "").strip()
    if not text or not llm_provider.is_configured():
        return None
    prompt = _ENTITY_EXTRACTION_PROMPT.format(doc_type=doc_type, text=text[:8000])
    raw_response = llm_provider.generate(prompt)
    if not raw_response:
        return None
    return _parse_json_response(raw_response)


def _parse_json_response(raw_text: str):
    text = (raw_text or "").strip()
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        pass
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, re.IGNORECASE)
    if fenced:
        try:
            return json.loads(fenced.group(1).strip())
        except (TypeError, ValueError):
            return None
    return None


_HISTORY_SEARCH_PROMPT = """You are a clinical documentation assistant helping a clinician quickly
review a patient's history. Answer the question using ONLY the provided excerpts below. If the
excerpts don't contain enough information to answer, say so plainly -- do not guess or invent
clinical details.

Question: {query}

Relevant excerpts from this patient's records:
{excerpts}
"""


def patient_history_search(query: str, hospital_id, patient_id=None, k: int = 5):
    """Retrieval-augmented answer over a patient's (or hospital's) stored clinical documents.

    Returns {"answer": str|None, "sources": [...]}. `answer` is None when the LLM provider
    isn't configured or no relevant documents were found -- `sources` is still populated in
    that case so callers can show raw matches even without a synthesized answer.
    """
    matches = search_similar_documents(query, hospital_id=hospital_id, patient_id=patient_id, k=k)
    if not matches:
        return {"answer": None, "sources": []}

    excerpts = "\n\n".join(
        f"[{i + 1}] ({m['source_table']}#{m['source_id']}): {m['content_text'][:1000]}"
        for i, m in enumerate(matches)
    )
    answer = None
    if llm_provider.is_configured():
        prompt = _HISTORY_SEARCH_PROMPT.format(query=query, excerpts=excerpts)
        answer = llm_provider.generate(prompt)

    return {
        "answer": answer,
        "sources": [
            {
                "source_table": m["source_table"],
                "source_id": m["source_id"],
                "similarity": round(m["similarity"], 4),
                "excerpt": m["content_text"][:500],
            }
            for m in matches
        ],
    }
