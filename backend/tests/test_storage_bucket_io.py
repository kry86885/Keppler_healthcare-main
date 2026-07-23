import importlib
import io

import pytest


@pytest.fixture(scope="session", autouse=True)
def test_db_env():
    # Override global backend DB bootstrap for isolated storage tests.
    yield


@pytest.fixture(autouse=True)
def clean_database():
    # Override global DB cleanup fixture; this module doesn't use DB.
    yield


class _FakeBody:
    def __init__(self, payload: bytes):
        self._payload = payload

    def read(self):
        return self._payload


class _FakeS3Client:
    def __init__(self):
        self.objects = {}

    def put_object(self, Bucket, Key, Body, **_kwargs):
        self.objects[(Bucket, Key)] = Body

    def get_object(self, Bucket, Key):
        payload = self.objects[(Bucket, Key)]
        return {"Body": _FakeBody(payload)}

    def delete_object(self, Bucket, Key):
        self.objects.pop((Bucket, Key), None)


class _FakeBoto3:
    def __init__(self, client):
        self._client = client

    def client(self, *_args, **_kwargs):
        return self._client


def _reload_storage_module(monkeypatch):
    monkeypatch.setenv("BUCKET_URL", "https://minio.example.internal")
    monkeypatch.setenv("BUCKET_NAME", "hospai")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "minio-user")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "minio-secret")
    monkeypatch.setenv("AWS_REGION", "us-east-1")
    module = importlib.import_module("utils.storage")
    return importlib.reload(module)


def test_store_then_read_from_bucket(monkeypatch):
    storage = _reload_storage_module(monkeypatch)
    fake_client = _FakeS3Client()
    monkeypatch.setattr(storage, "boto3", _FakeBoto3(fake_client), raising=False)

    obj = storage.ObjectStorage()
    data = b"bucket-payload-123"
    stored_path = obj.store("test_docs", "sample.txt", data, "text/plain")

    assert stored_path.startswith("s3://hospai/")
    read_back = obj.read(stored_path)
    assert read_back == data


def test_second_store_persists_in_bucket(monkeypatch):
    storage = _reload_storage_module(monkeypatch)
    fake_client = _FakeS3Client()
    monkeypatch.setattr(storage, "boto3", _FakeBoto3(fake_client), raising=False)

    obj = storage.ObjectStorage()
    stored_path = obj.store("test_docs", "delete-me.txt", b"temp", "text/plain")
    assert obj.read(stored_path) == b"temp"
