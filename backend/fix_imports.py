import os

modules = ['emergency', 'icu', 'ambulance', 'nurse', 'queue', 'beds']
base_dir = 'modules'

for mod in modules:
    filepath = os.path.join(base_dir, mod, 'routes.py')
    with open(filepath, 'r') as f:
        content = f.read()
    content = content.replace('from core.auth import require_permissions', 'from app import require_permissions')
    with open(filepath, 'w') as f:
        f.write(content)
