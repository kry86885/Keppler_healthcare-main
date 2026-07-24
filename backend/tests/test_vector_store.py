import pytest

import utils.database as db
from utils.embeddings import cosine_similarity, encode_vector, decode_vector


def _fake_embed(text):
    """Deterministic bag-of-words 'embedding' so ranking logic can be verified without a real API key."""
    words = set((text or "").lower().split())
    vocab = ["diabetes", "fracture", "covid", "insulin", "xray", "blood", "pressure", "cardiac"]
    return [1.0 if w in words else 0.0 for w in vocab]


def test_cosine_similarity_and_vector_encoding_round_trip():
    identical = [1.0, 0.5, 0.0]
    assert cosine_similarity(identical, identical) == pytest.approx(1.0)
    assert cosine_similarity([1.0, 0.0], [0.0, 1.0]) == 0.0
    assert cosine_similarity([], [1.0]) == 0.0

    encoded = encode_vector(identical)
    assert decode_vector(encoded) == identical
    assert decode_vector(None) is None
    assert decode_vector("not-json") is None


def test_store_and_search_returns_none_without_embedding_provider():
    # No GEMINI_API_KEY is configured in the test environment, so both must soft-fail
    # rather than raise -- document/certificate creation must never break because of this.
    assert db.store_document_embedding("documents", 1, "some text", hospital_id=1) is None
    assert db.search_similar_documents("query", hospital_id=1) == []


def test_search_ranks_by_similarity_and_respects_hospital_isolation(monkeypatch):
    monkeypatch.setattr(db, "generate_embedding", _fake_embed)
    with db.get_connection() as conn:
        conn.execute("DELETE FROM clinical_document_embeddings")
        conn.commit()

    db.store_document_embedding(
        "documents", 101, "Patient has diabetes and needs insulin dosage review", hospital_id=1, patient_id="PAT-1"
    )
    db.store_document_embedding(
        "documents", 102, "Fracture of the left arm, xray requested", hospital_id=1, patient_id="PAT-1"
    )
    db.store_document_embedding(
        "documents", 103, "Unrelated covid screening note", hospital_id=2, patient_id="PAT-2"
    )

    results = db.search_similar_documents("insulin diabetes treatment plan", hospital_id=1, k=5)

    assert results[0]["source_id"] == 101
    assert results[0]["similarity"] > results[1]["similarity"]
    assert all(r["source_id"] != 103 for r in results)


def test_search_respects_patient_filter(monkeypatch):
    monkeypatch.setattr(db, "generate_embedding", _fake_embed)
    with db.get_connection() as conn:
        conn.execute("DELETE FROM clinical_document_embeddings")
        conn.commit()

    db.store_document_embedding(
        "documents", 201, "cardiac blood pressure note", hospital_id=1, patient_id="PAT-A"
    )
    db.store_document_embedding(
        "documents", 202, "cardiac blood pressure note for another patient", hospital_id=1, patient_id="PAT-B"
    )

    results = db.search_similar_documents("cardiac blood pressure", hospital_id=1, patient_id="PAT-A", k=5)

    assert all(r["patient_id"] == "PAT-A" for r in results)
    assert any(r["source_id"] == 201 for r in results)
