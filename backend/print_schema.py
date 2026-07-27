import sqlite3
import sys

try:
    conn = sqlite3.connect("d:/HOSP AI/Keppler_healthcare-main/healthcare.db")
    cursor = conn.cursor()
    cursor.execute("SELECT name, sql FROM sqlite_master WHERE type='table';")
    tables = cursor.fetchall()
    for name, sql in tables:
        print(f"--- {name} ---")
        print(sql)
except Exception as e:
    print(f"Error: {e}")
