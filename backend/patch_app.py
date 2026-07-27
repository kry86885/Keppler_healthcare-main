import re

filepath = r"d:\HOSP AI\Keppler_healthcare-main\backend\app.py"
with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

# Find where the blueprint imports start
start_marker = "from modules.reports.routes import reports_bp"
if start_marker in content and "try:" not in content.split(start_marker)[0][-20:]:
    parts = content.split(start_marker)
    top = parts[0]
    rest = start_marker + parts[1]
    
    # The blueprint registrations go up to if __name__ == "__main__":
    if "if __name__ == \"__main__\":" in rest:
        bp_part, main_part = rest.split("if __name__ == \"__main__\":")
        
        # indent bp_part
        indented_bp = "\n".join("    " + line if line.strip() else line for line in bp_part.split("\n"))
        
        new_bp_part = "try:\n" + indented_bp + """except ImportError as e:
    if "partially initialized module" not in str(e) and "circular import" not in str(e):
        raise\n\n"""
        
        new_content = top + new_bp_part + "if __name__ == \"__main__\":\n" + main_part
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(new_content)
        print("Patched app.py")
    else:
        print("Could not find __main__")
else:
    print("Already patched or marker not found")
