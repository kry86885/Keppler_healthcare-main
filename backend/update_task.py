import os

filepath = r"C:\Users\Admin\.gemini\antigravity-ide\brain\aca33840-977d-4ae1-af2a-fc148b516121\task.md"
with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

content = content.replace("- [/] Fix broken tests due to import/module issues in the newly moved outes.py files", "- [x] Fix broken tests due to import/module issues in the newly moved outes.py files")
content = content.replace("- [ ] Verify the backend test suite completes with no regressions", "- [x] Verify the backend test suite completes with no regressions")
content = content.replace("- [ ] Update ReportsPage.tsx to render the Phase H metrics", "- [x] Update ReportsPage.tsx to render the Phase H metrics")

with open(filepath, "w", encoding="utf-8") as f:
    f.write(content)
