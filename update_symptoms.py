import psycopg2
conn = psycopg2.connect('postgresql://postgres:rahul%40123@localhost:5432/HospAI_DB')
cur = conn.cursor()
cur.execute("UPDATE patients SET symptoms='Fever and mild cough since 2 days' WHERE name = 'tom'")
conn.commit()
print("Updated successfully")
