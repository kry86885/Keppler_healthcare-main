import importlib

import pytest


@pytest.fixture(autouse=True)
def clean_database():
    # Override backend/tests/conftest.py autouse DB cleanup for this
    # module because these tests intentionally mutate DB config/env.
    yield


@pytest.fixture(scope="session", autouse=True)
def test_db_env():
    # Override backend/tests/conftest.py session DB bootstrap.
    yield


@pytest.fixture(autouse=True)
def restore_database_module_after_each_test(monkeypatch):
    yield
    monkeypatch.delenv("DATABASE_URL", raising=False)
    db_module = importlib.import_module("utils.database")
    importlib.reload(db_module)


def _reload_database_module(monkeypatch, *, database_url=None):
    if database_url is None:
        monkeypatch.setenv("DATABASE_URL", "")
    else:
        monkeypatch.setenv("DATABASE_URL", database_url)

    module = importlib.import_module("utils.database")
    return importlib.reload(module)


def _reload_storage_module(monkeypatch, *, bucket_url=None, bucket_name=None):
    if bucket_url is None:
        monkeypatch.delenv("BUCKET_URL", raising=False)
    else:
        monkeypatch.setenv("BUCKET_URL", bucket_url)

    for key in ("BUCKET_NAME", "S3_BUCKET", "S3_BUCKET_NAME", "AWS_S3_BUCKET"):
        if bucket_name is None:
            monkeypatch.setenv(key, "")
        else:
            monkeypatch.delenv(key, raising=False)
    if bucket_name is not None:
        monkeypatch.setenv("BUCKET_NAME", bucket_name)

    module = importlib.import_module("utils.storage")
    return importlib.reload(module)


def test_database_uses_postgres_when_database_url_set(monkeypatch):
    db = _reload_database_module(
        monkeypatch,
        database_url="postgres://user:pass@localhost:5432/hospai",
    )
    assert db.IS_POSTGRES is True


def test_database_uses_postgres_when_database_url_is_set(monkeypatch):
    db = _reload_database_module(
        monkeypatch,
        database_url="postgres://user:pass@localhost:5432/hospai",
    )
    assert db.IS_POSTGRES is True


def test_database_raises_when_database_url_is_missing(monkeypatch):
    db = _reload_database_module(monkeypatch, database_url=None)
    assert db.IS_POSTGRES is False

    with pytest.raises(RuntimeError, match="DATABASE_URL is required"):
        with db.get_connection():
            pass


def test_database_raises_clear_error_when_no_postgres_driver(monkeypatch):
    db = _reload_database_module(
        monkeypatch,
        database_url="postgres://user:pass@localhost:5432/hospai",
    )
    monkeypatch.setattr(db, "psycopg2", None, raising=False)
    monkeypatch.setattr(db, "psycopg", None, raising=False)

    with pytest.raises(RuntimeError, match="PostgreSQL driver missing"):
        with db.get_connection():
            pass


def test_storage_supports_endpoint_url_with_bucket_name_env(monkeypatch):
    storage = _reload_storage_module(
        monkeypatch,
        bucket_url="https://minio.example.internal",
        bucket_name="hospai",
    )

    class _DummyBoto3:
        def client(self, *args, **kwargs):
            return {"args": args, "kwargs": kwargs}

    monkeypatch.setattr(storage, "boto3", _DummyBoto3(), raising=False)
    obj = storage.ObjectStorage()

    assert obj.bucket == "hospai"
    assert obj.prefix == ""


def test_storage_supports_path_style_bucket_url(monkeypatch):
    storage = _reload_storage_module(
        monkeypatch,
        bucket_url="https://minio.example.internal/hospai/documents",
        bucket_name=None,
    )

    class _DummyBoto3:
        def client(self, *args, **kwargs):
            return {"args": args, "kwargs": kwargs}

    monkeypatch.setattr(storage, "boto3", _DummyBoto3(), raising=False)
    obj = storage.ObjectStorage()

    assert obj.bucket == "hospai"
    assert obj.prefix == "documents"


def test_storage_raises_without_bucket_information(monkeypatch):
    storage = _reload_storage_module(
        monkeypatch,
        bucket_url="https://minio.example.internal",
        bucket_name=None,
    )

    class _DummyBoto3:
        def client(self, *args, **kwargs):
            return {"args": args, "kwargs": kwargs}

    monkeypatch.setattr(storage, "boto3", _DummyBoto3(), raising=False)

    with pytest.raises(ValueError, match="missing bucket information"):
        storage.ObjectStorage()
