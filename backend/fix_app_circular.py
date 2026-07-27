import os

filepath = r"d:\HOSP AI\Keppler_healthcare-main\backend\app.py"
with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

prefix = """import os
import sys

if __name__ == "__main__":
    import app
    port = int(os.getenv("PORT", "5001"))
    app.app.run(host="0.0.0.0", port=port, debug=True)
    sys.exit(0)

"""

if "if __name__ == \"__main__\":" not in content[:100]:
    content = prefix + content
    
    # Remove the old if __name__ == "__main__": block at the bottom
    content = content.split("if __name__ == \"__main__\":")[0]
    
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(content)
