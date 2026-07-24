import os

modules = ['emergency', 'icu', 'ambulance', 'nurse', 'queue', 'beds']
base_dir = 'modules'

for mod in modules:
    mod_dir = os.path.join(base_dir, mod)
    os.makedirs(mod_dir, exist_ok=True)
    
    with open(os.path.join(mod_dir, '__init__.py'), 'w') as f:
        pass
        
    routes_content = f"""from flask import Blueprint, jsonify, request
from core.auth import require_permissions

bp = Blueprint('{mod}', __name__)

@bp.route('/api/{mod}', methods=['GET'])
@require_permissions('{mod}.read')
def get_{mod}():
    return jsonify({{"message": "{mod} module active"}})
"""
    with open(os.path.join(mod_dir, 'routes.py'), 'w') as f:
        f.write(routes_content)
