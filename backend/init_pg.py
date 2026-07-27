import os
import sys

# Add current directory to path
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from utils.database import init_database, IS_POSTGRES, DATABASE_URL

print(f"Connecting to database... IS_POSTGRES={IS_POSTGRES}")
if IS_POSTGRES:
    print("PostgreSQL detected! Running init_database()...")
else:
    print("WARNING: IS_POSTGRES is False. Please check your .env file!")

try:
    init_database()
    print("SUCCESS: All tables created/verified successfully!")
except Exception as e:
    print(f"ERROR initializing database: {e}")
    sys.exit(1)

print("Now running dummy data seeding...")
try:
    from seed_dummy_data import generate_dummy_data
    generate_dummy_data()
    print("SUCCESS: Dummy data seeded into PostgreSQL!")
except Exception as e:
    print(f"ERROR seeding dummy data: {e}")
    sys.exit(1)
