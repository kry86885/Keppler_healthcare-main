import os
import ast

PROJECT_ROOT = r"d:\HOSP AI\Keppler_healthcare-main\backend"
modules = ['reports', 'dashboard', 'op', 'documents', 'ai_exports', 'ot', 'accounts']

def get_db_functions():
    with open(os.path.join(PROJECT_ROOT, "utils", "database.py"), "r", encoding="utf-8") as f:
        tree = ast.parse(f.read())
    return {node.name for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)}

db_funcs = get_db_functions()

def fix_imports(domain):
    filepath = os.path.join(PROJECT_ROOT, "modules", domain, "routes.py")
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    
    # find all used names
    try:
        tree = ast.parse(content)
    except SyntaxError:
        return
        
    used_names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            used_names.add(node.id)
        elif isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name):
                used_names.add(node.func.id)

    needed_db_funcs = used_names.intersection(db_funcs)
    
    if needed_db_funcs:
        # replace the existing from utils.database import (...) with the complete list
        import_stmt = "from utils.database import (\n    " + ",\n    ".join(sorted(list(needed_db_funcs))) + "\n)\n"
        
        # very simple regex replace
        import re
        content = re.sub(r"from utils\.database import \([\s\S]*?\)", import_stmt, content)
        
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)

for mod in modules:
    fix_imports(mod)
