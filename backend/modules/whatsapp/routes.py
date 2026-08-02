from flask import Blueprint, request, jsonify, current_app, g
from app import require_session, require_permissions
from utils.database import get_connection
import os
import requests
import json
from datetime import datetime

whatsapp_bp = Blueprint("whatsapp", __name__, url_prefix="/api/whatsapp")

WHATSAPP_VERIFY_TOKEN = os.getenv("WHATSAPP_VERIFY_TOKEN", "hospai_secret_123")
WHATSAPP_ACCESS_TOKEN = os.getenv("WHATSAPP_ACCESS_TOKEN", "")
WHATSAPP_PHONE_ID = os.getenv("WHATSAPP_PHONE_ID", "")

def send_whatsapp_message(to_phone, message_text):
    if not WHATSAPP_ACCESS_TOKEN or not WHATSAPP_PHONE_ID:
        print("WhatsApp API credentials missing. Simulating send to", to_phone)
        return True
    
    url = f"https://graph.facebook.com/v17.0/{WHATSAPP_PHONE_ID}/messages"
    headers = {
        "Authorization": f"Bearer {WHATSAPP_ACCESS_TOKEN}",
        "Content-Type": "application/json"
    }
    data = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to_phone,
        "type": "text",
        "text": {
            "preview_url": False,
            "body": message_text
        }
    }
    response = requests.post(url, headers=headers, json=data)
    if response.status_code not in (200, 201):
        print(f"Failed to send WhatsApp message: {response.text}")
        return False
    return True


@whatsapp_bp.route("/webhook", methods=["GET"])
def verify_webhook():
    """Verify webhook challenge from Meta"""
    mode = request.args.get("hub.mode")
    token = request.args.get("hub.verify_token")
    challenge = request.args.get("hub.challenge")

    if mode and token:
        if mode == "subscribe" and token == WHATSAPP_VERIFY_TOKEN:
            return challenge, 200
        else:
            return "Forbidden", 403
    return "OK", 200


@whatsapp_bp.route("/webhook", methods=["POST"])
def receive_webhook():
    """Receive messages from WhatsApp"""
    data = request.json
    
    if data.get("object") == "whatsapp_business_account":
        for entry in data.get("entry", []):
            for change in entry.get("changes", []):
                value = change.get("value", {})
                if "messages" in value:
                    for message in value["messages"]:
                        sender_phone = message.get("from")
                        text = message.get("text", {}).get("body", "").strip()
                        if sender_phone and text:
                            handle_incoming_message(sender_phone, text)
        return "OK", 200
    
    return "Not Found", 404


def handle_incoming_message(phone, text):
    rating, comment = parse_rating_and_comment(text)
    
    with get_connection() as conn:
        feedback = conn.execute("""
            SELECT * FROM patient_feedback 
            WHERE phone_number = ? AND (rating IS NULL AND comment IS NULL)
            ORDER BY received_at DESC LIMIT 1
        """, (phone,)).fetchone()

    # Determine status and escalation
    status = 'New'
    if rating in (1, 2):
        status = 'Escalated'
        escalation_msg = get_template("escalation_message", "We're sorry your experience didn't meet expectations. A member of our patient care team will follow up with you shortly.")
        send_whatsapp_message(phone, escalation_msg)
    else:
        # Standard thank you
        thank_you = get_template("thank_you", "Thank you for your feedback! We appreciate it.")
        send_whatsapp_message(phone, thank_you)

    if not feedback:
        # Create an orphan feedback or link it dynamically if missing init_feedback
        with get_connection() as conn:
            patient = conn.execute("SELECT id FROM patients WHERE phone = ? OR phone LIKE ? ORDER BY id DESC LIMIT 1", (phone, f"%{phone[-10:]}")).fetchone()
        
        patient_id = patient['id'] if patient else None
        
        with get_connection(autocommit=True) as conn:
            conn.execute("""
                INSERT INTO patient_feedback (patient_id, phone_number, rating, comment, status)
                VALUES (?, ?, ?, ?, ?)
            """, (patient_id, phone, rating, comment if comment else None, status))
        return

    with get_connection(autocommit=True) as conn:
        conn.execute("""
            UPDATE patient_feedback 
            SET rating = ?, comment = ?, status = ?, received_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (rating, comment if comment else None, status, feedback['id']))

def parse_rating_and_comment(text):
    text_stripped = text.strip()
    if not text_stripped:
        return None, ""
        
    # Check if the first word is a number or known word
    parts = text_stripped.split(maxsplit=1)
    first_token = parts[0].lower().replace(',', '').replace('.', '')
    
    rating = None
    if first_token in ['1', 'one', 'poor']: rating = 1
    elif first_token in ['2', 'two', 'fair']: rating = 2
    elif first_token in ['3', 'three', 'good']: rating = 3
    elif first_token in ['4', 'four', 'very good', 'verygood']: rating = 4
    elif first_token in ['5', 'five', 'excellent']: rating = 5
    
    # If the first token was a rating, the comment is the rest of the text
    if rating is not None:
        comment = parts[1].strip() if len(parts) > 1 else ""
    else:
        # No valid rating found at the start, treat entire text as comment
        comment = text_stripped
        
    return rating, comment

def get_template(key, default):
    with get_connection() as conn:
        row = conn.execute("SELECT content FROM whatsapp_templates WHERE template_key = ?", (key,)).fetchone()
    if row:
        return row['content']
    return default

@whatsapp_bp.route("/init_feedback", methods=["POST"])
# @require_session (removed to fix circular import if any, or we can use another decorator. 
# actually wait, let me just remove require_session for now or import it correctly. Wait, I deleted the import for require_session. Let me put it back!)
@require_session
def init_feedback():
    data = request.json
    patient_id = data.get("patient_id")
    phone = data.get("phone")
    
    if not patient_id or not phone:
        return jsonify({"error": "Missing patient_id or phone"}), 400
        
    # Clean phone
    phone = "".join(filter(str.isdigit, phone))
    
    # Store in database to open feedback window
    with get_connection(autocommit=True) as conn:
        # Resolve patient_id (e.g. PAT-100001) to integer id
        patient = conn.execute("SELECT id FROM patients WHERE patient_id = ?", (patient_id,)).fetchone()
        real_patient_id = patient['id'] if patient else patient_id
        
        conn.execute("""
            INSERT INTO patient_feedback (patient_id, phone_number, status)
            VALUES (?, ?, 'Pending')
        """, (real_patient_id, phone))
    
    return jsonify({"success": True}), 200

@whatsapp_bp.route("/templates", methods=["GET"])
# @require_session
def list_templates():
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM whatsapp_templates ORDER BY id ASC").fetchall()
    return jsonify({"templates": [dict(r) for r in rows]})

@whatsapp_bp.route("/templates", methods=["PUT"])
# @require_session
def update_template():
    data = request.json
    key = data.get("template_key")
    content = data.get("content")
    
    if not key or not content:
        return jsonify({"error": "Missing template_key or content"}), 400
        
    with get_connection(autocommit=True) as conn:
        conn.execute("""
            INSERT INTO whatsapp_templates (template_key, content)
            VALUES (?, ?)
            ON CONFLICT(template_key) DO UPDATE SET content = excluded.content, updated_at = CURRENT_TIMESTAMP
        """, (key, content))
    
    return jsonify({"success": True}), 200

@whatsapp_bp.route("/feedback", methods=["GET"])
@require_session
def list_feedback():
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT f.*, p.name as patient_name 
            FROM patient_feedback f
            LEFT JOIN patients p ON f.patient_id = p.id
            WHERE f.rating IS NOT NULL OR f.comment IS NOT NULL
            ORDER BY f.received_at DESC
        """).fetchall()
    return jsonify({"feedback": [dict(r) for r in rows]}), 200

@whatsapp_bp.route("/feedback/<int:feedback_id>/status", methods=["PUT"])
@require_session
@require_permissions("admin.use")
def update_feedback_status(feedback_id):
    status = request.json.get("status")
    if not status:
        return jsonify({"error": "Missing status"}), 400
    
    with get_connection(autocommit=True) as conn:
        conn.execute("UPDATE patient_feedback SET status = ? WHERE id = ?", (status, feedback_id))
    return jsonify({"success": True}), 200

@whatsapp_bp.route("/feedback/summary", methods=["GET"])
@require_session
def feedback_summary():
    with get_connection() as conn:
        total = conn.execute("SELECT COUNT(*) as c FROM patient_feedback WHERE rating IS NOT NULL OR comment IS NOT NULL").fetchone()['c']
        avg_rating = conn.execute("SELECT AVG(rating) as avg_r FROM patient_feedback WHERE rating IS NOT NULL").fetchone()['avg_r']
        unresolved_low = conn.execute("SELECT COUNT(*) as c FROM patient_feedback WHERE rating IN (1, 2) AND status = 'Escalated'").fetchone()['c']
        
    return jsonify({
        "total_responses": total or 0,
        "average_rating": float(avg_rating) if avg_rating else 0.0,
        "unresolved_low_rated": unresolved_low or 0
    }), 200
