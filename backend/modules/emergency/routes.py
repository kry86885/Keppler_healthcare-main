from flask import Blueprint, jsonify, request
from app import require_permissions

bp = Blueprint('emergency', __name__)

@bp.route('/api/emergency', methods=['GET'])
@require_permissions('emergency.read')
def get_emergency():
    return jsonify({"message": "emergency module active"})
