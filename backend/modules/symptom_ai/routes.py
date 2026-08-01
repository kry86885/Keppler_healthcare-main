import uuid

from flask import Blueprint, g, jsonify, request
from werkzeug.utils import secure_filename

from app import require_permissions, current_hospital_id, log_audit_event

from ai.document_extraction import extract_document_text, SUPPORTED_EXTENSIONS
from ai import rag_provider
from utils.database import (
    create_symptom_ai_document,
    list_symptom_ai_documents,
    get_symptom_ai_document,
    delete_symptom_ai_document,
    save_symptom_ai_chat_message,
    list_symptom_ai_chat_history,
    delete_symptom_ai_chat_history,
)

symptom_ai_bp = Blueprint("symptom_ai_rag", __name__)

MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # 15MB


@symptom_ai_bp.get("/api/symptom-ai/documents")
@require_permissions("symptom_ai.use")
def symptom_ai_documents_list():
    rows = list_symptom_ai_documents(current_hospital_id(), g.current_user.get("username"))
    return jsonify(
        {
            "documents": [
                {
                    "id": row["id"],
                    "filename": row["filename"],
                    "doc_category": row["doc_category"],
                    "created_at": row["created_at"],
                }
                for row in rows
            ]
        }
    )


@symptom_ai_bp.post("/api/symptom-ai/documents")
@require_permissions("symptom_ai.use")
def symptom_ai_documents_upload():
    if not rag_provider.is_configured():
        return jsonify({"error": "GEMINI_API_KEY is not configured on the server."}), 503

    if "file" not in request.files:
        return jsonify({"error": "Missing file"}), 400
    uploaded_file = request.files["file"]
    filename = secure_filename(uploaded_file.filename or "") or "document"

    file_bytes = uploaded_file.read()
    if not file_bytes:
        return jsonify({"error": "Uploaded file is empty."}), 400
    if len(file_bytes) > MAX_UPLOAD_BYTES:
        return jsonify({"error": "File is too large (15MB limit)."}), 400

    try:
        extracted_text = extract_document_text(file_bytes, filename)
    except ValueError as exc:
        return jsonify({"error": str(exc), "supported_types": sorted(SUPPORTED_EXTENSIONS)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 502

    hospital_id = current_hospital_id()
    username = g.current_user.get("username")

    document_id = create_symptom_ai_document(hospital_id, username, filename, "USER_UPLOAD", extracted_text)

    try:
        key = rag_provider.workspace_key(hospital_id, username)
        rag_provider.insert_text_into_graph(key, f"--- Document: {filename} ---\n{extracted_text}")
        graph_updated = True
        graph_error = None
    except Exception as exc:
        # The document is still saved and visible in the vault even if the knowledge-graph
        # insert fails (e.g. transient Gemini error) -- the user can see what happened and
        # doesn't lose the extracted text.
        graph_updated = False
        graph_error = str(exc)

    log_audit_event("create", "symptom_ai_documents", str(document_id), {"filename": filename})

    return jsonify(
        {
            "document_id": document_id,
            "filename": filename,
            "preview": extracted_text[:500],
            "graph_updated": graph_updated,
            "graph_error": graph_error,
        }
    )


@symptom_ai_bp.delete("/api/symptom-ai/documents/<int:document_id>")
@require_permissions("symptom_ai.use")
def symptom_ai_documents_delete(document_id):
    hospital_id = current_hospital_id()
    username = g.current_user.get("username")
    document = get_symptom_ai_document(document_id, hospital_id, username)
    if not document:
        return jsonify({"error": "Document not found"}), 404
    delete_symptom_ai_document(document_id, hospital_id, username, actor=username)
    log_audit_event("delete", "symptom_ai_documents", str(document_id), {"filename": document["filename"]})
    return jsonify({"status": "ok"})


@symptom_ai_bp.post("/api/symptom-ai/triage")
@require_permissions("symptom_ai.use")
def symptom_ai_triage():
    data = request.json or {}
    symptoms = data.get("symptoms")
    available_departments = data.get("available_departments", [])

    if not symptoms:
        return jsonify({"error": "Missing symptoms"}), 400

    from ai.gemini_provider import GeminiLLMProvider
    import json

    llm = GeminiLLMProvider()
    prompt = f"""
You are an AI Triage Assistant in a hospital.
The patient reports the following symptoms:
{symptoms}

Available departments: {', '.join(available_departments) if available_departments else 'Any'}

Analyze the symptoms and provide a JSON response with:
1. "department": The most appropriate department from the EXACT list of Available departments. If the symptoms do not clearly match any of the available departments, or if no available departments are provided, you MUST output "General".
2. "urgency": "Low", "Medium", "High", or "Critical".
3. "reasoning": A brief explanation of your recommendation (1-2 sentences).

Your response MUST be valid JSON only. Do not include markdown formatting or backticks.
"""
    try:
        response_text = llm.generate(prompt)
        # Clean up any potential markdown code blocks
        if response_text.startswith("```json"):
            response_text = response_text.replace("```json", "", 1)
        if response_text.endswith("```"):
            response_text = response_text[::-1].replace("```", "", 1)[::-1]
        
        result = json.loads(response_text.strip())
        
        # Enforce fallback if the model hallucinates a department
        if available_departments and result.get("department") not in available_departments:
            result["department"] = "General"
            
        return jsonify(result)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@symptom_ai_bp.post("/api/symptom-ai/chat")
@require_permissions("symptom_ai.use")
def symptom_ai_chat():
    if not rag_provider.is_configured():
        return jsonify({"error": "GEMINI_API_KEY is not configured on the server."}), 503

    payload = request.get_json(force=True) or {}
    message = (payload.get("message") or "").strip()
    if not message:
        return jsonify({"error": "message is required"}), 400
    if len(message) > 2000:
        return jsonify({"error": "Please keep the message under 2000 characters."}), 400

    session_id = payload.get("session_id") or str(uuid.uuid4())
    hospital_id = current_hospital_id()
    username = g.current_user.get("username")

    save_symptom_ai_chat_message(hospital_id, username, session_id, "user", message)

    key = rag_provider.workspace_key(hospital_id, username)
    try:
        answer = rag_provider.query_graph(key, message)
    except Exception as exc:
        return jsonify({"error": f"Unable to query your knowledge base: {exc}"}), 502

    save_symptom_ai_chat_message(hospital_id, username, session_id, "assistant", answer)

    return jsonify({"session_id": session_id, "answer": answer})


@symptom_ai_bp.get("/api/symptom-ai/chat/history")
@require_permissions("symptom_ai.use")
def symptom_ai_chat_history():
    session_id = request.args.get("session_id")
    rows = list_symptom_ai_chat_history(current_hospital_id(), g.current_user.get("username"), session_id)
    return jsonify(
        {
            "messages": [
                {"role": row["role"], "content": row["content"], "session_id": row["session_id"], "created_at": row["created_at"]}
                for row in rows
            ]
        }
    )


@symptom_ai_bp.delete("/api/symptom-ai/chat/history")
@require_permissions("symptom_ai.use")
def symptom_ai_chat_history_clear():
    delete_symptom_ai_chat_history(current_hospital_id(), g.current_user.get("username"))
    return jsonify({"status": "ok"})
