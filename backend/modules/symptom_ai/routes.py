import re
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
    match_doctor_to_department,
)

symptom_ai_bp = Blueprint("symptom_ai_rag", __name__)

MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # 15MB


@symptom_ai_bp.get("/api/symptom-ai/documents")
@require_permissions("symptom_ai.use")
def symptom_ai_documents_list():
    rows = list_symptom_ai_documents(
        current_hospital_id(), g.current_user.get("username")
    )
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
@require_permissions("symptom_ai.documents.write")
def symptom_ai_documents_upload():
    if not rag_provider.is_configured():
        return jsonify({"error": "AI provider is not configured on the server."}), 503

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
        return (
            jsonify(
                {"error": str(exc), "supported_types": sorted(SUPPORTED_EXTENSIONS)}
            ),
            400,
        )
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 502

    hospital_id = current_hospital_id()
    username = g.current_user.get("username")

    document_id = create_symptom_ai_document(
        hospital_id, username, filename, "USER_UPLOAD", extracted_text
    )

    try:
        key = rag_provider.workspace_key(hospital_id, username)
        rag_provider.insert_text_into_graph(
            key, f"--- Document: {filename} ---\n{extracted_text}"
        )
        graph_updated = True
        graph_error = None
    except Exception as exc:
        # The document is still saved and visible in the vault even if the knowledge-graph
        # insert fails (e.g. transient vLLM error) -- the user can see what happened and
        # doesn't lose the extracted text.
        graph_updated = False
        graph_error = str(exc)

    log_audit_event(
        "create", "symptom_ai_documents", str(document_id), {"filename": filename}
    )

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
@require_permissions("symptom_ai.documents.write")
def symptom_ai_documents_delete(document_id):
    hospital_id = current_hospital_id()
    username = g.current_user.get("username")
    document = get_symptom_ai_document(document_id, hospital_id, username)
    if not document:
        return jsonify({"error": "Document not found"}), 404
    delete_symptom_ai_document(document_id, hospital_id, username, actor=username)
    log_audit_event(
        "delete",
        "symptom_ai_documents",
        str(document_id),
        {"filename": document["filename"]},
    )
    return jsonify({"status": "ok"})


# --- Symptom AI Model Endpoints ---


@symptom_ai_bp.get("/api/symptom-ai/meta")
@require_permissions("symptom_ai.use")
def symptom_ai_meta():
    return jsonify(
        {
            "duration_options": [
                "Just started (today)",
                "A few days",
                "About a week",
                "1-2 weeks",
                "2-4 weeks",
                "More than a month",
                "Comes and goes",
                "Recurring over time",
            ],
            "context_tags": [
                "Recent stress",
                "Changed sleep pattern",
                "New exercise routine",
                "Dietary changes",
                "Weather changes",
                "Travel recently",
                "Screen time increase",
                "Sitting for long periods",
                "Physical activity",
                "Emotional changes",
                "Hydration concerns",
                "New environment",
            ],
            "regions": [
                {
                    "name": "General / Full Body",
                    "keywords": ["all over", "everywhere", "body"],
                    "color": "#8BC8B8",
                    "icon": "🧍",
                    "svg_id": "full_body",
                },
                {
                    "name": "Head",
                    "keywords": ["head", "headache", "scalp", "migraine"],
                    "color": "#A8DADC",
                    "icon": "🤕",
                    "svg_id": "head",
                },
                {
                    "name": "Eyes",
                    "keywords": ["eye", "eyes", "vision", "blur"],
                    "color": "#457B9D",
                    "icon": "👁️",
                    "svg_id": "eyes",
                },
                {
                    "name": "Ears",
                    "keywords": ["ear", "ears", "hearing", "ringing"],
                    "color": "#1D3557",
                    "icon": "👂",
                    "svg_id": "ears",
                },
                {
                    "name": "Nose / Sinus",
                    "keywords": ["nose", "sinus", "smell", "congestion"],
                    "color": "#E63946",
                    "icon": "👃",
                    "svg_id": "nose",
                },
                {
                    "name": "Mouth / Throat",
                    "keywords": ["mouth", "throat", "swallow", "teeth"],
                    "color": "#F4A261",
                    "icon": "👄",
                    "svg_id": "mouth",
                },
                {
                    "name": "Neck",
                    "keywords": ["neck", "stiff neck", "cervical"],
                    "color": "#2A9D8F",
                    "icon": "🦒",
                    "svg_id": "neck",
                },
                {
                    "name": "Chest",
                    "keywords": ["chest", "heart", "lungs", "breathing"],
                    "color": "#E76F51",
                    "icon": "🫁",
                    "svg_id": "chest",
                },
                {
                    "name": "Abdomen",
                    "keywords": ["stomach", "belly", "gut", "abdomen", "nausea"],
                    "color": "#E9C46A",
                    "icon": "🤢",
                    "svg_id": "abdomen",
                },
                {
                    "name": "Shoulders",
                    "keywords": ["shoulder", "shoulders", "rotator cuff"],
                    "color": "#264653",
                    "icon": "🤷",
                    "svg_id": "shoulders",
                },
                {
                    "name": "Arms",
                    "keywords": ["arm", "arms", "bicep", "tricep", "elbow"],
                    "color": "#F4A261",
                    "icon": "💪",
                    "svg_id": "arms",
                },
                {
                    "name": "Hands / Wrists",
                    "keywords": ["hand", "hands", "wrist", "fingers"],
                    "color": "#E76F51",
                    "icon": "🖐️",
                    "svg_id": "hands",
                },
                {
                    "name": "Upper Back",
                    "keywords": ["upper back", "spine", "shoulder blades"],
                    "color": "#2A9D8F",
                    "icon": "🔙",
                    "svg_id": "upper_back",
                },
                {
                    "name": "Lower Back",
                    "keywords": ["lower back", "lumbar", "sciatica"],
                    "color": "#E63946",
                    "icon": "⚡",
                    "svg_id": "lower_back",
                },
                {
                    "name": "Hips / Pelvis",
                    "keywords": ["hip", "hips", "pelvis", "groin"],
                    "color": "#457B9D",
                    "icon": "🦴",
                    "svg_id": "hips",
                },
                {
                    "name": "Thighs",
                    "keywords": ["thigh", "thighs", "quads", "hamstrings"],
                    "color": "#1D3557",
                    "icon": "🦵",
                    "svg_id": "thighs",
                },
                {
                    "name": "Knees",
                    "keywords": ["knee", "knees", "patella", "joint"],
                    "color": "#A8DADC",
                    "icon": "🦿",
                    "svg_id": "knees",
                },
                {
                    "name": "Lower Legs / Calves",
                    "keywords": ["calf", "calves", "shin", "shins"],
                    "color": "#E9C46A",
                    "icon": "🦵",
                    "svg_id": "lower_legs",
                },
                {
                    "name": "Feet / Ankles",
                    "keywords": ["foot", "feet", "ankle", "ankles", "toes"],
                    "color": "#8BC8B8",
                    "icon": "🦶",
                    "svg_id": "feet",
                },
            ],
        }
    )


@symptom_ai_bp.post("/api/symptom-ai/detect-region")
@require_permissions("symptom_ai.use")
def symptom_ai_detect_region():
    data = request.json or {}
    description = data.get("description", "").strip()
    if not description:
        return jsonify({"region": None})

    from ai.service import llm_provider
    import json

    prompt = f"""
Analyze the following symptom description and return ONLY a JSON object containing the most likely body region from the allowed list.
If it involves multiple regions or is unclear, return "General / Full Body".

Allowed Regions: General / Full Body, Head, Eyes, Ears, Nose / Sinus, Mouth / Throat, Neck, Chest, Abdomen, Shoulders, Arms, Hands / Wrists, Upper Back, Lower Back, Hips / Pelvis, Thighs, Knees, Lower Legs / Calves, Feet / Ankles

Description: {description}

Expected output format:
{{"region": "<Matched Region Name>"}}
"""
    try:
        raw_response = llm_provider.generate(prompt)
        if not raw_response:
            return jsonify({"region": None})

        text = raw_response.strip()
        if text.startswith("```json"):
            text = text.replace("```json", "", 1)
        if text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]

        result = json.loads(text.strip())
        return jsonify({"region": result.get("region")})
    except Exception:
        return jsonify({"region": None})


@symptom_ai_bp.post("/api/symptom-ai/analyze")
@require_permissions("symptom_ai.use")
def symptom_ai_analyze():
    data = request.json or {}
    description = data.get("description", "").strip()
    body_region = data.get("body_region", "General / Full Body")
    intensity = data.get("intensity", 5)
    duration = data.get("duration", "Unknown")
    context_tags = data.get("context_tags", [])
    patient_info = data.get("patient_info", {})

    if not description:
        return jsonify({"error": "Missing symptom description."}), 400

    from ai.service import llm_provider
    from utils.database import list_doctors
    import json

    hospital_id = current_hospital_id()
    doctors = list_doctors(hospital_id=hospital_id)
    available_departments = list(
        set([doc["department"] for doc in doctors if doc.get("department")])
    )
    available_doctors = [
        doc["doctor_name"] for doc in doctors if doc.get("doctor_name")
    ]

    prompt = f"""
You are a highly advanced AI Medical Assistant (Symptom AI) providing clinical decision support.
Analyze the following patient data and return a detailed response formatted EXACTLY as a JSON object containing a Markdown string.

Patient Data:
- Symptoms: {description}
- Primary Region: {body_region}
- Intensity: {intensity}/10
- Duration: {duration}
- Context/Triggers: {', '.join(context_tags) if context_tags else 'None'}
- Age: {patient_info.get('age', 'Unknown')}
- Gender: {patient_info.get('gender', 'Unknown')}
- Temperature: {patient_info.get('temperature', 'Unknown')} {patient_info.get('temp_unit', '')}
- Heart Rate: {patient_info.get('heart_rate', 'Unknown')}
- Blood Pressure: {patient_info.get('blood_pressure', {}).get('systolic', 'Unknown')}/{patient_info.get('blood_pressure', {}).get('diastolic', 'Unknown')}

Available Departments in Hospital: {', '.join(available_departments) if available_departments else 'Any'}
Available Doctors in Hospital: {', '.join(available_doctors) if available_doctors else 'Any'}

You MUST output ONLY a valid JSON object with the following structure:
{{
  "response": "<Your comprehensive Markdown response>",
  "detected_region": "{body_region}",
  "used_fallback": false,
  "model_error": null
}}

The Markdown response MUST include these exact sections:
### 🩺 Possible Conditions
(List 2-4 possible conditions based on the symptoms. Include a Confidence Score [High/Medium/Low] for each condition.)

### 👨‍⚕️ Recommended Specialist
(List the most appropriate medical department or specialist to see for this issue. You MUST recommend from the Available Departments or Available Doctors listed above if they are a match.)

### 🚨 Urgency Level
(Provide a clear urgency level: Routine, Urgent, or Emergency, and a brief explanation why.)

### ⚠️ Medical Disclaimer
(Add an appropriate disclaimer stating that this is an AI decision support tool and not a confirmed medical diagnosis. The patient should consult a healthcare professional.)
"""
    try:
        raw_response = llm_provider.generate(prompt)
        if not raw_response:
            return jsonify(
                {
                    "response": "### ⚠️ Medical Disclaimer\nSymptom AI is temporarily unavailable. Please consult a healthcare professional directly.",
                    "detected_region": body_region,
                    "used_fallback": True,
                    "model_error": "LLM provider returned empty response",
                }
            )

        text = raw_response.strip()
        if text.startswith("```json"):
            text = text.replace("```json", "", 1)
        if text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]

        result = json.loads(text.strip())
        return jsonify(result)
    except json.JSONDecodeError:
        # Fallback if the model didn't return valid JSON (just raw markdown)
        return jsonify(
            {
                "response": raw_response.strip(),
                "detected_region": body_region,
                "used_fallback": False,
                "model_error": "JSON parse error, falling back to raw text",
            }
        )
    except Exception as e:
        return jsonify(
            {
                "response": f"### ⚠️ Medical Disclaimer\nAn error occurred while generating insights. Please consult a healthcare professional.\n\nError: {str(e)}",
                "detected_region": body_region,
                "used_fallback": True,
                "model_error": str(e),
            }
        )


@symptom_ai_bp.post("/api/symptom-ai/triage")
@require_permissions("symptom_ai.use")
def symptom_ai_triage():
    data = request.json or {}
    symptoms = data.get("symptoms")
    available_departments = data.get("available_departments", [])
    available_doctors = data.get("available_doctors", [])

    if not symptoms:
        return jsonify({"error": "Missing symptoms"}), 400

    from ai.service import llm_provider
    import json

    def fallback_triage(reason: str):
        department = next(
            (d for d in available_departments if "general" in d.strip().lower()),
            available_departments[0] if available_departments else "General",
        )
        return jsonify(
            {
                "department": department,
                "urgency": "Medium",
                "reasoning": (
                    "AI triage is temporarily unavailable, so this was routed to "
                    f"{department} for staff review. {reason}"
                ),
                "doctor": "",
                "fallback": True,
            }
        )

    prompt = f"""
You are an AI Triage Assistant in a hospital.
The patient reports the following symptoms or requests:
{symptoms}

Available departments: {', '.join(available_departments) if available_departments else 'Any'}
Available doctors: {', '.join(available_doctors) if available_doctors else 'Any'}

Analyze the symptoms and provide a JSON response with:
1. "department": The most appropriate department from the EXACT list of Available departments. If the symptoms do not clearly match any of the available departments, you MUST output the best match from the list.
2. "urgency": "Low", "Medium", "High", or "Critical".
3. "reasoning": A brief explanation of your recommendation (1-2 sentences).
4. "doctor": Pick one name from the Available doctors list whose department (shown in parentheses) matches the "department" you chose above -- prefer a doctor explicitly named in the symptoms if one is mentioned, otherwise pick any doctor from that department. Only return an empty string if no doctor in the Available doctors list belongs to the chosen department.

Your response MUST be valid JSON only. Do not include markdown formatting or backticks.
"""
    try:
        response_text = llm_provider.generate(prompt)

        # Guard: if the AI returned None (API key invalid / no internet / model error)
        if not response_text:
            return fallback_triage(
                "Please check the configured AI provider and model server connectivity."
            )

        # Clean up any potential markdown code blocks
        response_text = response_text.strip()
        if response_text.startswith("```json"):
            response_text = response_text.replace("```json", "", 1)
        if response_text.startswith("```"):
            response_text = response_text[3:]
        if response_text.endswith("```"):
            response_text = response_text[:-3]

        result = json.loads(response_text.strip())

        # Enforce fallback if the model hallucinates a department
        if available_departments:
            dept_lower = result.get("department", "").strip().lower()
            match = None
            # 1. Try exact case-insensitive match
            match = next(
                (d for d in available_departments if d.strip().lower() == dept_lower),
                None,
            )

            # 2. Try prefix/substring/common root matching
            if not match:
                for d in available_departments:
                    d_clean = d.strip().lower()
                    if (
                        d_clean in dept_lower
                        or dept_lower in d_clean
                        or (
                            len(d_clean) > 4
                            and len(dept_lower) > 4
                            and d_clean[:5] == dept_lower[:5]
                        )
                    ):
                        match = d
                        break

            if match:
                result["department"] = match
            else:
                gen_med = next(
                    (d for d in available_departments if "general" in d.lower()), None
                )
                result["department"] = (
                    gen_med
                    if gen_med
                    else (
                        available_departments[0] if available_departments else "General"
                    )
                )

        # Enforce the same hallucination guard on "doctor" that already exists
        # for "department" above: the model sometimes returns a doctor name
        # verbatim instead of leaving it blank, and nothing was previously
        # checking that name was real before it got written into a patient's
        # record downstream (ER assign-doctor trusts a non-empty doctor_name
        # as-is). Strip any "(Department)" suffix from both sides so this
        # works whichever format the caller's available_doctors list uses.
        def _bare_name(entry: str) -> str:
            m = re.match(r"^(.*)\(([^()]*)\)\s*$", entry.strip())
            return (m.group(1).strip() if m else entry.strip())

        def _normalize(name: str) -> str:
            # Tolerant of "Dr. Naresh" vs "dr.naresh"-style spacing/
            # punctuation differences between what the model says and how a
            # name is stored -- only letters/digits count for comparison.
            return re.sub(r"[^a-z0-9]", "", name.lower())

        raw_doctor = (result.get("doctor") or "").strip()
        if raw_doctor and available_doctors:
            # Keyed by the full "Name (Department)" entry, not just the bare
            # name -- a name existing in the roster at all isn't enough proof
            # it's a valid pick; the model can name a REAL doctor from the
            # WRONG specialty (e.g. picking a cardiologist for a urology case
            # just because a name starting with the same letter is nearby in
            # the prompt), which the name-only check below would've let
            # through unchecked.
            bare_available = {_normalize(_bare_name(d)): d for d in available_doctors}
            candidate_entry = bare_available.get(_normalize(_bare_name(raw_doctor)))
            if candidate_entry:
                dept_match = re.match(r"^(.*)\(([^()]*)\)\s*$", candidate_entry.strip())
                candidate_dept = dept_match.group(2).strip().lower() if dept_match else ""
                target_dept = (result.get("department") or "").strip().lower()
                if candidate_dept and target_dept and candidate_dept != target_dept:
                    # Wrong specialty -- fall through to empty so the
                    # deterministic match_doctor_to_department backstop below
                    # picks someone actually in the right department instead.
                    result["doctor"] = ""
                else:
                    result["doctor"] = _bare_name(candidate_entry)
            else:
                result["doctor"] = ""
        elif raw_doctor and not available_doctors:
            # No roster to validate against -- don't fabricate confidence
            # either way; keep the model's answer as the caller has nothing
            # to cross-check it with.
            result["doctor"] = raw_doctor

        # The local model doesn't reliably pick a doctor even when one is available for
        # the chosen department, so backstop it deterministically here (mirrors the
        # department hallucination guard above). Shared with ER doctor assignment --
        # see match_doctor_to_department in utils/database.py.
        if not (result.get("doctor") or "").strip() and available_doctors:
            result["doctor"] = match_doctor_to_department(
                available_doctors, result.get("department", "")
            )

        return jsonify(result)
    except json.JSONDecodeError:
        return fallback_triage("The AI response was not valid JSON.")
    except Exception as exc:
        message = str(exc)
        if (
            "RESOURCE_EXHAUSTED" in message
            or "quota" in message.lower()
            or "429" in message
        ):
            return fallback_triage("The configured AI provider quota is exhausted.")
        return fallback_triage("Please check the AI provider configuration.")


@symptom_ai_bp.post("/api/symptom-ai/chat")
@require_permissions("symptom_ai.use")
def symptom_ai_chat():
    if not rag_provider.is_configured():
        return jsonify({"error": "AI provider is not configured on the server."}), 503

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
    rows = list_symptom_ai_chat_history(
        current_hospital_id(), g.current_user.get("username"), session_id
    )
    return jsonify(
        {
            "messages": [
                {
                    "role": row["role"],
                    "content": row["content"],
                    "session_id": row["session_id"],
                    "created_at": row["created_at"],
                }
                for row in rows
            ]
        }
    )


@symptom_ai_bp.delete("/api/symptom-ai/chat/history")
@require_permissions("symptom_ai.use")
def symptom_ai_chat_history_clear():
    delete_symptom_ai_chat_history(
        current_hospital_id(), g.current_user.get("username")
    )
    return jsonify({"status": "ok"})
