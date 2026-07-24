import os

modules = ['reports', 'dashboard', 'op', 'documents', 'ai_exports', 'ot', 'accounts']
for mod in modules:
    os.makedirs(f'modules/{mod}', exist_ok=True)
    with open(f'modules/{mod}/__init__.py', 'w') as f: pass
    with open(f'modules/{mod}/routes.py', 'w') as f:
        f.write(f"""from flask import Blueprint, jsonify, request, g, send_file
from werkzeug.exceptions import BadRequest
import os
import uuid
import time
from datetime import datetime
from io import BytesIO

from app import (
    require_permissions, 
    log_audit_event, 
    validate_required_fields,
    current_hospital_id,
    row_to_dict,
    rows_to_dicts,
    build_reports_export_text,
    S3_CLIENT,
    BUCKET_NAME,
    IS_LOCAL
)

from utils.database import (
    get_reports_overview,
    get_hospital_dashboard_summary,
    get_dashboard_analytics,
    get_employee_stats,
    get_connection,
    soft_delete_row
)

bp = Blueprint('{mod}', __name__)
""")
