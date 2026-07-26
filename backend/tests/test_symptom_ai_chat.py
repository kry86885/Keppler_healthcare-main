import io

from ai import rag_provider


def _mock_configured(monkeypatch, configured=True):
    monkeypatch.setattr(rag_provider, "is_configured", lambda: configured)


def test_documents_list_empty_initially(auth_client, monkeypatch):
    _mock_configured(monkeypatch)
    response = auth_client.get("/api/symptom-ai/documents")
    assert response.status_code == 200
    assert response.get_json()["documents"] == []


def test_upload_requires_gemini_configured(auth_client, monkeypatch):
    _mock_configured(monkeypatch, configured=False)
    response = auth_client.post(
        "/api/symptom-ai/documents",
        data={"file": (io.BytesIO(b"some text content"), "note.txt")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 503


def test_upload_requires_file(auth_client, monkeypatch):
    _mock_configured(monkeypatch)
    response = auth_client.post("/api/symptom-ai/documents", data={})
    assert response.status_code == 400
    assert response.get_json()["error"] == "Missing file"


def test_upload_rejects_unsupported_type(auth_client, monkeypatch):
    _mock_configured(monkeypatch)
    response = auth_client.post(
        "/api/symptom-ai/documents",
        data={"file": (io.BytesIO(b"binary junk"), "malware.exe")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 400
    assert "supported_types" in response.get_json()


def test_upload_success_stores_document_and_inserts_into_graph(auth_client, monkeypatch):
    _mock_configured(monkeypatch)
    inserted = {}
    monkeypatch.setattr(rag_provider, "workspace_key", lambda hospital_id, username: f"h{hospital_id}_u{username}")
    monkeypatch.setattr(
        rag_provider,
        "insert_text_into_graph",
        lambda key, text: inserted.update({"key": key, "text": text}),
    )

    response = auth_client.post(
        "/api/symptom-ai/documents",
        data={"file": (io.BytesIO(b"Patient reports mild seasonal allergies."), "note.txt")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["filename"] == "note.txt"
    assert payload["graph_updated"] is True
    assert "seasonal allergies" in payload["preview"]
    assert "seasonal allergies" in inserted["text"]

    listing = auth_client.get("/api/symptom-ai/documents")
    docs = listing.get_json()["documents"]
    assert len(docs) == 1
    assert docs[0]["filename"] == "note.txt"


def test_upload_still_saves_document_when_graph_insert_fails(auth_client, monkeypatch):
    _mock_configured(monkeypatch)
    monkeypatch.setattr(rag_provider, "workspace_key", lambda hospital_id, username: "key")

    def _boom(key, text):
        raise RuntimeError("Gemini is briefly unavailable")

    monkeypatch.setattr(rag_provider, "insert_text_into_graph", _boom)

    response = auth_client.post(
        "/api/symptom-ai/documents",
        data={"file": (io.BytesIO(b"Some clinical note text."), "note.txt")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["graph_updated"] is False
    assert "Gemini is briefly unavailable" in payload["graph_error"]

    # Document is still visible in the vault despite the graph failure.
    listing = auth_client.get("/api/symptom-ai/documents")
    assert len(listing.get_json()["documents"]) == 1


def test_delete_document(auth_client, monkeypatch):
    _mock_configured(monkeypatch)
    monkeypatch.setattr(rag_provider, "workspace_key", lambda hospital_id, username: "key")
    monkeypatch.setattr(rag_provider, "insert_text_into_graph", lambda key, text: None)

    upload = auth_client.post(
        "/api/symptom-ai/documents",
        data={"file": (io.BytesIO(b"Some content to delete."), "note.txt")},
        content_type="multipart/form-data",
    )
    document_id = upload.get_json()["document_id"]

    delete_response = auth_client.delete(f"/api/symptom-ai/documents/{document_id}")
    assert delete_response.status_code == 200

    listing = auth_client.get("/api/symptom-ai/documents")
    assert listing.get_json()["documents"] == []

    missing_delete = auth_client.delete(f"/api/symptom-ai/documents/{document_id}")
    assert missing_delete.status_code == 404


def test_chat_requires_message(auth_client, monkeypatch):
    _mock_configured(monkeypatch)
    response = auth_client.post("/api/symptom-ai/chat", json={"message": ""})
    assert response.status_code == 400


def test_chat_round_trip_saves_history(auth_client, monkeypatch):
    _mock_configured(monkeypatch)
    monkeypatch.setattr(rag_provider, "workspace_key", lambda hospital_id, username: "key")
    monkeypatch.setattr(
        rag_provider, "query_graph", lambda key, message, mode="hybrid": "You mentioned mild seasonal allergies."
    )

    response = auth_client.post("/api/symptom-ai/chat", json={"message": "What did I upload?"})
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["answer"] == "You mentioned mild seasonal allergies."
    session_id = payload["session_id"]

    history = auth_client.get(f"/api/symptom-ai/chat/history?session_id={session_id}")
    messages = history.get_json()["messages"]
    assert len(messages) == 2
    assert messages[0]["role"] == "user"
    assert messages[1]["role"] == "assistant"

    clear = auth_client.delete("/api/symptom-ai/chat/history")
    assert clear.status_code == 200
    history_after = auth_client.get("/api/symptom-ai/chat/history")
    assert history_after.get_json()["messages"] == []


def test_chat_handles_query_failure_gracefully(auth_client, monkeypatch):
    _mock_configured(monkeypatch)
    monkeypatch.setattr(rag_provider, "workspace_key", lambda hospital_id, username: "key")

    def _boom(key, message, mode="hybrid"):
        raise RuntimeError("knowledge graph unavailable")

    monkeypatch.setattr(rag_provider, "query_graph", _boom)

    response = auth_client.post("/api/symptom-ai/chat", json={"message": "hello"})
    assert response.status_code == 502
