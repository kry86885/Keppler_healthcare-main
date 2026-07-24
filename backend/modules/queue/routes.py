from flask import Blueprint, jsonify, request
from app import require_permissions

bp = Blueprint('queue', __name__)

@bp.route('/api/queue', methods=['GET'])
@require_permissions('queue.read')
def get_queue():
    return jsonify({"message": "queue module active"})
