"""Public AI service API. Business routes (app.py) import from here only -- never from
utils/ocr.py directly, and never instantiate a provider themselves.

Swapping providers (e.g. a future self-hosted PaddleOCR stack) means changing the two
module-level singletons below; nothing else in the codebase needs to change.
"""

import json
import re

from utils.ocr import _detect_mime_type
from utils.database import search_similar_documents

from .preprocessing import preprocess_image_bytes
from .vllm_provider import VLLMLLMProvider, VLLMOCRProvider

ocr_provider = VLLMOCRProvider()
llm_provider = VLLMLLMProvider()


def _try_generate(prompt: str, context: str = "", **kwargs):
    try:
        return llm_provider.generate(prompt, context=context, **kwargs)
    except Exception:
        return None


def extract_text_from_image(
    file_bytes, language="en", doc_type="document", filename=None
):
    """OCR pipeline entry point: preprocess (deskew/denoise/contrast) then delegate to the
    configured OCR provider. Errors from preprocessing never block OCR -- it falls back to
    the original bytes on any failure (see ai/preprocessing.py)."""
    mime_type = _detect_mime_type(file_bytes, filename)
    processed_bytes = preprocess_image_bytes(file_bytes, mime_type=mime_type)
    return ocr_provider.extract_text(
        processed_bytes, language=language, doc_type=doc_type, filename=filename
    )


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
    raw_response = _try_generate(prompt, json_mode=True)
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


_PATIENT_FILTER_PROMPT = """You are translating a hospital staff member's free-text search into a
structured filter over a patient list.

Available fields (only these may be used): {fields}

Return ONLY valid JSON (no code fences, no commentary) with this exact shape:
{{
  "conditions": [{{"field": "<one of the available fields>", "op": "eq|contains|gt|lt|gte|lte|in", "value": <string, number, or list of strings for "in">}}],
  "logic": "AND" or "OR"
}}

If the prompt doesn't map to any available field, return {{"conditions": [], "logic": "AND"}}.

Prompt: {prompt}
"""


def translate_patient_filter_prompt(prompt: str, available_fields):
    """Convert a free-text search prompt into a structured filter (field/op/value
    conditions) via a single LLM call. Returns None if the LLM provider isn't
    configured or the response wasn't parseable JSON -- callers must treat that as
    "no filter could be derived", never fall back to interpreting the raw prompt
    as SQL themselves."""
    if not prompt or not llm_provider.is_configured():
        return None
    rendered = _PATIENT_FILTER_PROMPT.format(
        fields=", ".join(available_fields), prompt=prompt
    )
    raw_response = _try_generate(rendered, json_mode=True)
    if not raw_response:
        return None
    return _parse_json_response(raw_response)


_DOCUMENT_PROMPT_TEMPLATE = """You are extracting information from an uploaded hospital document (a PDF or
Word file, already OCR'd/converted to plain text below) based on a staff member's request.

Return ONLY valid JSON (no code fences, no commentary) with this exact shape:
{{
  "entries": [{{"name": "<full name, or empty if unknown>", "phone": "<phone number, or empty if none in the document>", "area": "<area/city, or empty>", "medical_condition": "<condition/diagnosis, or empty>", "age": <number or null>, "gender": "<or empty>"}}],
  "answer": "<a short natural-language summary of what you found, or a direct answer if the request isn't about a list of people>"
}}

Only include an entry in "entries" if the document actually names a specific person -- never invent
people or details that aren't in the text. If the request doesn't relate to a list of people, return
an empty "entries" array and just answer in "answer".

Staff request: {prompt}

Document text:
\"\"\"
{document_text}
\"\"\"
"""


def answer_bulk_document_prompt(prompt: str, document_text: str):
    """Answer a free-text question against an uploaded PDF/DOCX's extracted text, optionally
    pulling out a list of named people (for the AI Mode bulk-upload document flow). Returns
    None if the LLM provider isn't configured or the response wasn't parseable JSON -- callers
    must treat that as "couldn't answer that", never fall back to interpreting the document
    themselves."""
    if not prompt or not document_text or not llm_provider.is_configured():
        return None
    rendered = _DOCUMENT_PROMPT_TEMPLATE.format(
        prompt=prompt, document_text=document_text
    )
    raw_response = _try_generate(rendered, json_mode=True)
    if not raw_response:
        return None
    return _parse_json_response(raw_response)


def patient_history_search(query: str, hospital_id, patient_id=None, k: int = 5):
    """Retrieval-augmented answer over a patient's (or hospital's) stored clinical documents.

    Returns {"answer": str|None, "sources": [...]}. `answer` is None when the LLM provider
    isn't configured or no relevant documents were found -- `sources` is still populated in
    that case so callers can show raw matches even without a synthesized answer.
    """
    matches = search_similar_documents(
        query, hospital_id=hospital_id, patient_id=patient_id, k=k
    )
    if not matches:
        return {"answer": None, "sources": []}

    excerpts = "\n\n".join(
        f"[{i + 1}] ({m['source_table']}#{m['source_id']}): {m['content_text'][:1000]}"
        for i, m in enumerate(matches)
    )
    answer = None
    if llm_provider.is_configured():
        prompt = _HISTORY_SEARCH_PROMPT.format(query=query, excerpts=excerpts)
        answer = _try_generate(prompt)

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


_PATIENT_SUMMARY_PROMPT = """You are a hospital clinical documentation assistant. Write a {kind} for the
patient below, using ONLY the information given -- never invent a diagnosis, medication,
finding, or instruction that isn't present in the data provided.

Patient: {patient_name}, {age} yrs, {gender}
{admission_line}

Encounters:
{encounters_block}

Diagnoses:
{diagnoses_block}

Medications:
{medications_block}

Lab / diagnostic tests ordered:
{labs_block}

Clinical notes:
{notes_block}

Write the {kind} in exactly this structure, with each heading on its own line:
**Chief Complaint / Reason for Visit**
**Hospital Course / Summary**
**Diagnosis**
**Medications{discharge_meds_hint}**
**Follow-up Instructions**
**Condition at {condition_label}**

Keep it concise and clinically accurate to only what's given above. If a section has
nothing to go on, write "Not documented" for that section instead of guessing.
"""


def _summary_block(items, formatter, empty="None documented."):
    if not items:
        return empty
    lines = []
    for item in items[:20]:
        try:
            text = formatter(item)
        except Exception:
            continue
        if text:
            lines.append(f"- {text}")
    return "\n".join(lines) if lines else empty


def generate_patient_summary(
    patient, admissions, encounters, diagnoses, prescriptions, labs, notes, is_discharge=False
):
    """Generates a discharge summary (is_discharge=True) or a mid-stay clinical
    progress summary (is_discharge=False) from a patient's aggregated EMR
    data, following the same _try_generate -> None-on-failure pattern as
    every other generator in this module. Callers must treat None as "AI
    isn't available right now", not a real summary."""
    if not llm_provider.is_configured():
        return None

    patient_name = (
        f"{patient.get('name') or ''} {patient.get('last_name') or ''}".strip()
        or "Unknown"
    )

    admission_line = "No admission on record."
    if admissions:
        latest = admissions[0]
        parts = [f"Admitted: {latest.get('admission_date') or '—'}"]
        if latest.get("discharge_date"):
            parts.append(f"Discharged: {latest['discharge_date']}")
        if latest.get("notes"):
            parts.append(f"Admission notes: {latest['notes']}")
        admission_line = " | ".join(parts)

    prompt = _PATIENT_SUMMARY_PROMPT.format(
        kind="discharge summary" if is_discharge else "clinical progress summary",
        patient_name=patient_name,
        age=patient.get("age") or "—",
        gender=patient.get("gender") or "—",
        admission_line=admission_line,
        encounters_block=_summary_block(
            encounters,
            lambda e: f"{e.get('encounter_type') or 'Encounter'} on {e.get('arrival_at') or e.get('created_at') or '—'} (status: {e.get('status') or '—'})",
        ),
        diagnoses_block=_summary_block(
            diagnoses, lambda d: d.get("diagnosis_name") or "—"
        ),
        medications_block=_summary_block(
            prescriptions,
            lambda p: f"{p.get('medicine_name')}"
            + (f" {p['dosage']}" if p.get("dosage") else "")
            + (f" (qty {p['quantity']})" if p.get("quantity") else ""),
        ),
        labs_block=_summary_block(
            labs, lambda l: f"{l.get('test_name')} (status: {l.get('status') or '—'})"
        ),
        notes_block=_summary_block(
            notes,
            lambda n: n.get("notes") or n.get("note") or n.get("chief_complaint") or "",
        ),
        discharge_meds_hint=" to Take Home" if is_discharge else "",
        condition_label="Discharge" if is_discharge else "Today",
    )
    return _try_generate(prompt)
