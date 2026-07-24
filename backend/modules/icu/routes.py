from flask import Blueprint, jsonify, request
from app import require_permissions

bp = Blueprint('icu', __name__)

@bp.route('/api/icu', methods=['GET'])
@require_permissions('icu.read')
def get_icu():
    return jsonify({"message": "icu module active"})
