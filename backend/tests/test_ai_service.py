import cv2
import numpy as np

from ai.preprocessing import preprocess_image_bytes
from ai import service as ai_service


def _synthetic_image_bytes(rotated=False):
    img = np.full((200, 400, 3), 255, dtype=np.uint8)
    cv2.rectangle(img, (50, 80), (350, 100), (0, 0, 0), -1)
    if rotated:
        matrix = cv2.getRotationMatrix2D((200, 100), 8, 1.0)
        img = cv2.warpAffine(img, matrix, (400, 200), borderValue=(255, 255, 255))
    success, encoded = cv2.imencode(".png", img)
    assert success
    return encoded.tobytes()


def test_preprocess_image_bytes_returns_valid_decodable_image():
    original = _synthetic_image_bytes(rotated=True)
    result = preprocess_image_bytes(original, mime_type="image/png")
    decoded = cv2.imdecode(np.frombuffer(result, dtype=np.uint8), cv2.IMREAD_COLOR)
    assert decoded is not None
    assert decoded.shape[2] == 3


def test_preprocess_image_bytes_falls_back_on_garbage_input():
    garbage = b"not an image"
    assert preprocess_image_bytes(garbage, mime_type="image/png") == garbage


def test_preprocess_image_bytes_passes_through_pdf_unchanged():
    pdf_bytes = b"%PDF-1.4 fake"
    assert preprocess_image_bytes(pdf_bytes, mime_type="application/pdf") == pdf_bytes


def test_preprocess_image_bytes_handles_empty_input():
    assert preprocess_image_bytes(b"", mime_type="image/png") == b""


def test_parse_json_response_handles_plain_and_fenced_json():
    assert ai_service._parse_json_response('{"a": 1}') == {"a": 1}
    assert ai_service._parse_json_response('```json\n{"a": 1}\n```') == {"a": 1}
    assert ai_service._parse_json_response("not json at all") is None


def test_classify_and_extract_entities_returns_none_without_llm_provider():
    assert ai_service.classify_and_extract_entities("some ocr text", "prescription") is None
    assert ai_service.classify_and_extract_entities("", "prescription") is None


def test_classify_and_extract_entities_parses_llm_response(monkeypatch):
    monkeypatch.setattr(ai_service.llm_provider, "is_configured", lambda: True)
    monkeypatch.setattr(
        ai_service.llm_provider,
        "generate",
        lambda prompt, context="": '{"document_category": "prescription", "medications": ["Metformin 500mg"], "diagnoses": [], "dates_mentioned": [], "key_values": []}',
    )
    result = ai_service.classify_and_extract_entities("Metformin 500mg twice daily", "prescription")
    assert result["document_category"] == "prescription"
    assert result["medications"] == ["Metformin 500mg"]


def test_patient_history_search_returns_empty_when_no_matches(monkeypatch):
    monkeypatch.setattr(ai_service, "search_similar_documents", lambda *a, **k: [])
    result = ai_service.patient_history_search("any query", hospital_id=1)
    assert result == {"answer": None, "sources": []}


def test_patient_history_search_synthesizes_answer_from_matches(monkeypatch):
    fake_matches = [
        {"source_table": "documents", "source_id": 1, "content_text": "Patient has diabetes", "similarity": 0.9},
        {"source_table": "certificates", "source_id": 2, "content_text": "Discharge summary text", "similarity": 0.7},
    ]
    monkeypatch.setattr(ai_service, "search_similar_documents", lambda *a, **k: fake_matches)
    monkeypatch.setattr(ai_service.llm_provider, "is_configured", lambda: True)
    monkeypatch.setattr(ai_service.llm_provider, "generate", lambda prompt, context="": "Patient has a diabetes diagnosis on record.")

    result = ai_service.patient_history_search("does this patient have diabetes?", hospital_id=1, patient_id="PAT-1")

    assert result["answer"] == "Patient has a diabetes diagnosis on record."
    assert len(result["sources"]) == 2
    assert result["sources"][0]["source_id"] == 1


def test_patient_history_search_returns_sources_without_llm_configured(monkeypatch):
    fake_matches = [{"source_table": "documents", "source_id": 1, "content_text": "text", "similarity": 0.5}]
    monkeypatch.setattr(ai_service, "search_similar_documents", lambda *a, **k: fake_matches)
    monkeypatch.setattr(ai_service.llm_provider, "is_configured", lambda: False)

    result = ai_service.patient_history_search("query", hospital_id=1)

    assert result["answer"] is None
    assert len(result["sources"]) == 1


def test_patient_history_search_route_requires_query(auth_client):
    response = auth_client.post("/api/ai/patient-history-search", json={})
    assert response.status_code == 400


def test_patient_history_search_route_returns_result(auth_client, monkeypatch):
    import app as app_module

    monkeypatch.setattr(
        app_module,
        "patient_history_search",
        lambda query, hospital_id, patient_id=None, k=5: {
            "answer": "Patient has a diabetes diagnosis on record.",
            "sources": [{"source_table": "documents", "source_id": 1, "similarity": 0.9, "excerpt": "..."}],
        },
    )
    response = auth_client.post(
        "/api/ai/patient-history-search", json={"query": "does this patient have diabetes?", "patient_id": "PAT-1"}
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["answer"] == "Patient has a diabetes diagnosis on record."
    assert len(payload["sources"]) == 1
