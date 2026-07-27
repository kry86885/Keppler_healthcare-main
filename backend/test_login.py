import sys
import os

# Mock bucket URL for local execution
os.environ["BUCKET_URL"] = "s3://test/test"
os.environ["TESTING"] = "True"

try:
    import app as app_module
    client = app_module.app.test_client()
    response = client.post("/api/auth/login", json={"username": "employee", "password": "employee123"})
    print("STATUS:", response.status_code)
    print("DATA:", response.data.decode("utf-8"))
except Exception as e:
    import traceback
    traceback.print_exc()
