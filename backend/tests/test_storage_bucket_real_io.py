import os
import time
import uuid

import pytest
from dotenv import load_dotenv


@pytest.fixture(scope="session", autouse=True)
def test_db_env():
    # Override global backend DB bootstrap for isolated storage tests.
    yield


@pytest.fixture(autouse=True)
def clean_database():
    # Override global DB cleanup fixture; this module doesn't use DB.
    yield


@pytest.mark.skipif(
    os.getenv("RUN_REAL_BUCKET_TESTS", "").lower() not in {"1", "true", "yes"},
    reason="Set RUN_REAL_BUCKET_TESTS=1 to run against real bucket",
)
def test_real_bucket_store_and_read():
    load_dotenv("/Users/subigyalamichhane/kalpra/Keppler_healthcare/backend/.env", override=False)
    from utils.storage import ObjectStorage

    payload = f"hospai-real-bucket-test-{int(time.time())}-{uuid.uuid4().hex}".encode("utf-8")
    filename = f"real-test-{uuid.uuid4().hex}.txt"

    storage = ObjectStorage()
    stored_path = storage.store("integration", filename, payload, "text/plain")
    read_back = storage.read(stored_path)

    assert stored_path.startswith("s3://")
    assert read_back == payload
