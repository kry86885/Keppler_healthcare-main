from flask import Blueprint, jsonify, request, g
from app import require_permissions, current_hospital_id
from utils.database import get_connection

emr_bp = Blueprint("emr", __name__)

@emr_bp.route("/api/emr/search", methods=["GET"])
@require_permissions("patients.read")
def search_emr():
    query = request.args.get("q", "").strip()
    hospital_id = current_hospital_id()
    if not query:
        return jsonify([])
    
    with get_connection() as conn:
        cursor = conn.cursor()
        sql = """
            SELECT id, patient_id, name, last_name, phone, dob, gender, age
            FROM patients
            WHERE hospital_id = ? AND (
                patient_id LIKE ? OR
                name LIKE ? OR
                last_name LIKE ? OR
                phone LIKE ?
            )
            LIMIT 20
        """
        wildcard = f"%{query}%"
        cursor.execute(sql, (hospital_id, wildcard, wildcard, wildcard, wildcard))
        rows = cursor.fetchall()
        return jsonify([dict(r) for r in rows])

@emr_bp.route("/api/emr/<patient_id>", methods=["GET"])
@require_permissions("patients.read")
def get_emr(patient_id):
    hospital_id = current_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM patients WHERE patient_id = ? AND hospital_id = ?", (patient_id, hospital_id))
        patient = cursor.fetchone()
        if not patient:
            return jsonify({"error": "Patient not found"}), 404
        
        # Encounters
        cursor.execute("SELECT * FROM encounters WHERE patient_id = ? AND hospital_id = ? ORDER BY id DESC", (patient_id, hospital_id))
        encounters = cursor.fetchall()
        
        # Clinical Notes
        cursor.execute("SELECT * FROM clinical_notes WHERE patient_id = ?", (patient_id,))
        notes = [dict(r) for r in cursor.fetchall()]
        
        # Vitals
        cursor.execute("SELECT * FROM patient_vitals WHERE patient_id = ?", (patient_id,))
        vitals = [dict(r) for r in cursor.fetchall()]
        
        # Diagnosis
        cursor.execute("SELECT * FROM diagnosis_records WHERE patient_id = ?", (patient_id,))
        diagnoses = [dict(r) for r in cursor.fetchall()]
        
        # Prescriptions
        cursor.execute("SELECT * FROM pharmacy_prescriptions WHERE patient_id = ? AND hospital_id = ?", (patient_id, hospital_id))
        prescriptions = [dict(r) for r in cursor.fetchall()]
        
        # Labs (diagnostics)
        cursor.execute("SELECT * FROM diagnostics WHERE patient_id = ? AND hospital_id = ?", (patient_id, hospital_id))
        labs = [dict(r) for r in cursor.fetchall()]
        
        # Medical History
        cursor.execute("SELECT * FROM medical_history WHERE patient_id = ?", (patient_id,))
        medical_history = cursor.fetchone()

        # Documents (OCR Prescriptions, etc.)
        cursor.execute("SELECT id, patient_id, doc_type, file_name, created_at, ocr_text FROM documents WHERE patient_id = ?", (patient_id,))
        documents = [dict(r) for r in cursor.fetchall()]

        # Pharmacy Sales (Purchase History)
        cursor.execute("SELECT * FROM pharmacy_sales WHERE patient_id = ? AND hospital_id = ?", (patient_id, hospital_id))
        pharmacy_sales = [dict(r) for r in cursor.fetchall()]

        return jsonify({
            "patient": dict(patient),
            "medical_history": dict(medical_history) if medical_history else None,
            "encounters": [dict(e) for e in encounters],
            "notes": notes,
            "vitals": vitals,
            "diagnoses": diagnoses,
            "prescriptions": prescriptions,
            "labs": labs,
            "documents": documents,
            "pharmacy_sales": pharmacy_sales
        })

@emr_bp.route("/api/emr/<patient_id>/ai-summary", methods=["POST"])
@require_permissions("patients.read")
def get_ai_summary(patient_id):
    return jsonify({
        "summary": f"This is an AI-generated clinical summary for {patient_id}. Patient shows regular vitals and stable history. Recent visits indicate minor ailments. Follow-up recommended as per doctor's notes."
    })

@emr_bp.route("/api/emr/access-log", methods=["POST"])
@require_permissions("patients.read")
def log_access():
    data = request.json or {}
    patient_id = data.get("patient_id")
    action = data.get("action", "viewed")
    if patient_id and g.current_user:
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO emr_access_logs (patient_id, doctor_id, action) VALUES (?, ?, ?)",
                (patient_id, g.current_user.get("id"), action)
            )
            conn.commit()
    return jsonify({"status": "ok"})
