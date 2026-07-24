import os
import re

filepath = r"d:\HOSP AI\Keppler_healthcare-main\frontend\src\types.ts"
with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

# Add phase_h_summary to ReportsOverview interface
replacement = """
  alos_summary: {
    average_los_days: number;
    admission_count: number;
  };
  phase_h_summary: {
    total_beds: number;
    occupied_beds: number;
    bed_occupancy_rate: number;
    icu_critical_patients: number;
    active_emergencies: number;
    active_ambulances: number;
  };
}"""

content = content.replace("  alos_summary: {\n    average_los_days: number;\n    admission_count: number;\n  };\n}", replacement)

with open(filepath, "w", encoding="utf-8") as f:
    f.write(content)
