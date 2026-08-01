import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()
database_url = os.getenv("DATABASE_URL")
if not database_url:
    raise ValueError("DATABASE_URL is not set in the environment or .env file")

if database_url.startswith("postgres://"):
    database_url = "postgresql://" + database_url[len("postgres://"):]

conn = psycopg2.connect(database_url)
cur = conn.cursor()
cur.execute("UPDATE patients SET symptoms='Fever and mild cough since 2 days' WHERE name = 'tom'")
conn.commit()
print("Updated successfully")
