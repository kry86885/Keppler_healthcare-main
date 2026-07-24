from flask import Blueprint, jsonify, request
from app import require_permissions

bp = Blueprint('ambulance', __name__)

@bp.route('/api/ambulance', methods=['GET'])
@require_permissions('ambulance.read')
def get_ambulance():
    return jsonify({"message": "ambulance module active"})
