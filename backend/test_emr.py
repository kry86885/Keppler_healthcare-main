import sys; sys.path.insert(0,'.')
from app import app
from flask import g

with app.test_request_context('/api/emr/PAT-100003'):
    g.current_user = {"id": 1, "username": "admin", "role": "staff", "hospital_id": 1, "user_type": "admin"}
    from modules.emr.routes import get_emr
    try:
        res = get_emr.__wrapped__("PAT-100003")
        print("Success!", len(res.json))
    except Exception as e:
        import traceback
        traceback.print_exc()
