import psycopg2
conn = psycopg2.connect('postgresql://postgres:rahul%40123@localhost:5432/HospAI_DB')
cur = conn.cursor()
cur.execute("UPDATE users SET access_role='clinician', module_access='[\"patients\"]' WHERE username='doctor'")
conn.commit()
print("Updated successfully")
