import os

PATIENTS_ROUTES = r"d:\HOSP AI\Keppler_healthcare-main\backend\modules\patients\routes.py"
APPOINTMENTS_ROUTES = r"d:\HOSP AI\Keppler_healthcare-main\backend\modules\appointments\routes.py"

def read_file(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def write_file(path, content):
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

patients_code = read_file(PATIENTS_ROUTES)
patients_new_header = """from flask import Blueprint, request, jsonify, g
import os
import json
from werkzeug.utils import secure_filename
from werkzeug.exceptions import BadRequest
from datetime import datetime

from app import (
    require_permissions, 
    request_hospital_id, 
    log_audit_event, 
    validate_required_fields, 
    save_uploaded_file, 
    current_hospital_id, 
    row_to_dict, 
    rows_to_dicts,
    normalize_department_name
)

from utils.database import (
    search_patients,
    get_all_patients,
    list_departments,
    create_department,
    list_patient_consents,
    create_patient_consent,
    update_patient_consent,
    list_insurance_verifications,
    create_insurance_verification,
    update_insurance_verification,
    generate_patient_id,
    check_duplicate_patient,
    add_patient,
    add_admission,
    get_patient,
    update_patient,
    delete_patient,
    get_admissions,
    get_documents,
    add_document,
    list_encounters,
    create_encounter,
    list_bed_allocations,
    assign_bed,
    list_medication_schedules,
    add_medication_schedule,
    current_ist_datetime,
    list_observation_notes,
    add_observation_note,
    list_certificates,
    create_certificate,
    list_patient_movements,
    add_patient_movement
)

"""

# Replace up to patients_bp = Blueprint(...)
idx = patients_code.find("patients_bp = Blueprint('patients', __name__)")
if idx != -1:
    patients_code = patients_new_header + patients_code[idx:]
    write_file(PATIENTS_ROUTES, patients_code)


appointments_code = read_file(APPOINTMENTS_ROUTES)
appointments_new_header = """from flask import Blueprint, request, jsonify, g
from datetime import datetime

from app import (
    require_permissions, 
    log_audit_event, 
    validate_required_fields, 
    row_to_dict, 
    rows_to_dicts, 
    to_amount_paise, 
    create_razorpay_order, 
    verify_razorpay_signature, 
    require_razorpay_configured,
    current_hospital_id,
    RAZORPAY_KEY_ID,
    normalize_payment_mode
)

from utils.database import (
    list_appointments,
    create_appointment,
    update_appointment,
    create_invoice,
    record_invoice_payment
)

"""

idx = appointments_code.find("appointments_bp = Blueprint('appointments', __name__)")
if idx != -1:
    appointments_code = appointments_new_header + appointments_code[idx:]
    write_file(APPOINTMENTS_ROUTES, appointments_code)
