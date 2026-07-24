from flask import Blueprint, jsonify, request
from app import require_permissions

bp = Blueprint('nurse', __name__)

@bp.route('/api/nurse', methods=['GET'])
@require_permissions('nurse.read')
def get_nurse():
    return jsonify({"message": "nurse module active"})
