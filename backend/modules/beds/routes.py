from flask import Blueprint, jsonify, request
from app import require_permissions

bp = Blueprint('beds', __name__)

@bp.route('/api/beds', methods=['GET'])
@require_permissions('beds.read')
def get_beds():
    return jsonify({"message": "beds module active"})
