"""Boundary module for the separate OCR/document-intelligence service (FastAPI +
Celery + Postgres + Qdrant + a GPU vLLM model, vendored at ocr_portal/). Business
routes (modules/ocr_portal/routes.py) import from here only -- never call
`requests` against OCR_BACKEND_URL directly.

That service has its own JWT auth with no concept of hospitals -- this module
hides that entirely by auto-provisioning one OCR-service account per Hosp AI
(hospital_id, username), logging in on their behalf, and caching/refreshing
the token server-side. The browser never sees the OCR service's URL, JWTs, or
login screen; every user still ends up with their own isolated documents/jobs/
chat history there, matching how the OCR service already scopes everything by
its own user_id.
"""

import os
import re
import secrets
from datetime import datetime, timedelta, timezone

import requests

from core.ocr_crypto import decrypt_secret, encrypt_secret
from utils.database import (
    create_ocr_service_account,
    get_ocr_service_account,
    update_ocr_service_account_token,
)

OCR_BACKEND_URL = os.getenv("OCR_BACKEND_URL", "http://localhost:7620").rstrip("/")
_TOKEN_LIFETIME = timedelta(hours=23)  # real token lives 24h; refresh a bit early
_DEFAULT_TIMEOUT = 30
_UPLOAD_TIMEOUT = 120


class OcrPortalError(Exception):
    """Raised for any non-2xx response from the OCR service, so routes.py can map it
    to a clean Flask JSON error instead of leaking a stack trace or raw requests
    exception."""

    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def _safe_segment(value) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "_", str(value or "unknown"))


def _raise_for_response(resp: requests.Response):
    if resp.ok:
        return
    try:
        detail = resp.json().get("detail", resp.text)
    except Exception:
        detail = resp.text
    raise OcrPortalError(resp.status_code, str(detail) or "OCR service request failed.")


def _provision_account(hospital_id, username):
    base_username = f"h{_safe_segment(hospital_id)}_{_safe_segment(username)}"[:64]
    password = secrets.token_urlsafe(24)

    # The OCR service is a separate account store with no knowledge of our local
    # hospital/username mapping. If that mapping is ever lost (e.g. a dev DB reset)
    # while the OCR-side account still exists, registering the same derived
    # username again would 400 forever since the original password is unrecoverable.
    # Retry with a random suffix so provisioning can always self-heal.
    ocr_username = base_username
    for attempt in range(5):
        resp = requests.post(
            f"{OCR_BACKEND_URL}/api/v1/auth/register",
            json={"username": ocr_username, "password": password},
            timeout=_DEFAULT_TIMEOUT,
        )
        is_duplicate = resp.status_code == 400 and "already exists" in resp.text.lower()
        if not is_duplicate or attempt == 4:
            _raise_for_response(resp)
            break
        ocr_username = f"{base_username[:56]}_{secrets.token_hex(3)}"

    login_resp = requests.post(
        f"{OCR_BACKEND_URL}/api/v1/auth/login",
        json={"username": ocr_username, "password": password},
        timeout=_DEFAULT_TIMEOUT,
    )
    _raise_for_response(login_resp)
    login_data = login_resp.json()

    create_ocr_service_account(
        hospital_id, username, ocr_username, encrypt_secret(password), login_data["user_id"]
    )
    expires_at = (datetime.now(timezone.utc) + _TOKEN_LIFETIME).isoformat()
    update_ocr_service_account_token(hospital_id, username, login_data["access_token"], expires_at)
    return login_data["access_token"]


def _relogin(hospital_id, username, account):
    password = decrypt_secret(account["encrypted_password"])
    resp = requests.post(
        f"{OCR_BACKEND_URL}/api/v1/auth/login",
        json={"username": account["ocr_username"], "password": password},
        timeout=_DEFAULT_TIMEOUT,
    )
    _raise_for_response(resp)
    token = resp.json()["access_token"]
    expires_at = (datetime.now(timezone.utc) + _TOKEN_LIFETIME).isoformat()
    update_ocr_service_account_token(hospital_id, username, token, expires_at)
    return token


def get_bearer_token(hospital_id, username, force_refresh=False) -> str:
    account = get_ocr_service_account(hospital_id, username)
    if account is None:
        return _provision_account(hospital_id, username)

    if not force_refresh and account.get("access_token") and account.get("token_expires_at"):
        expires_at = datetime.fromisoformat(str(account["token_expires_at"]))
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at > datetime.now(timezone.utc):
            return account["access_token"]

    return _relogin(hospital_id, username, account)


def _authed_request(method, path, hospital_id, username, **kwargs) -> requests.Response:
    token = get_bearer_token(hospital_id, username)
    headers = kwargs.pop("headers", None) or {}
    headers["Authorization"] = f"Bearer {token}"
    resp = requests.request(method, f"{OCR_BACKEND_URL}{path}", headers=headers, **kwargs)

    if resp.status_code == 401:
        token = get_bearer_token(hospital_id, username, force_refresh=True)
        headers["Authorization"] = f"Bearer {token}"
        resp = requests.request(method, f"{OCR_BACKEND_URL}{path}", headers=headers, **kwargs)

    _raise_for_response(resp)
    return resp


# ---- OCR (upload / job status / result / export) --------------------------

def list_ocr_blueprints(hospital_id, username):
    resp = _authed_request("GET", "/api/v1/ocr/blueprints", hospital_id, username, timeout=_DEFAULT_TIMEOUT)
    return resp.json()["blueprints"]


def upload_ocr_document(hospital_id, username, filename, file_bytes, mimetype, blueprint):
    resp = _authed_request(
        "POST",
        "/api/v1/ocr/upload",
        hospital_id,
        username,
        files={"file": (filename, file_bytes, mimetype or "application/octet-stream")},
        data={"client_blueprint": blueprint},
        timeout=_UPLOAD_TIMEOUT,
    )
    return resp.json()


def get_ocr_job(hospital_id, username, job_id):
    resp = _authed_request("GET", f"/api/v1/ocr/job/{job_id}", hospital_id, username, timeout=_DEFAULT_TIMEOUT)
    return resp.json()


def get_ocr_job_result(hospital_id, username, job_id):
    resp = _authed_request(
        "GET", f"/api/v1/ocr/job/{job_id}/result", hospital_id, username, timeout=_DEFAULT_TIMEOUT
    )
    return resp.json()


def export_ocr_job(hospital_id, username, job_id, fmt):
    resp = _authed_request(
        "GET",
        f"/api/v1/ocr/job/{job_id}/export",
        hospital_id,
        username,
        params={"format": fmt},
        timeout=_DEFAULT_TIMEOUT,
    )
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


# ---- Vault ------------------------------------------------------------------

def list_vault_documents(hospital_id, username):
    resp = _authed_request("GET", "/api/v1/vault", hospital_id, username, timeout=_DEFAULT_TIMEOUT)
    return resp.json()


def get_vault_document(hospital_id, username, doc_id):
    resp = _authed_request("GET", f"/api/v1/vault/{doc_id}", hospital_id, username, timeout=_DEFAULT_TIMEOUT)
    return resp.json()


def delete_vault_document(hospital_id, username, doc_id):
    _authed_request("DELETE", f"/api/v1/vault/{doc_id}", hospital_id, username, timeout=_DEFAULT_TIMEOUT)


def export_vault_document(hospital_id, username, doc_id, fmt):
    resp = _authed_request(
        "GET", f"/api/v1/vault/{doc_id}/export/{fmt}", hospital_id, username, timeout=_DEFAULT_TIMEOUT
    )
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


# ---- Assistant (RAG chat) ----------------------------------------------------

def ingest_vault_docs(hospital_id, username, doc_ids):
    resp = _authed_request(
        "POST",
        "/api/v1/assistant/ingest/vault",
        hospital_id,
        username,
        json={"doc_ids": doc_ids},
        timeout=_DEFAULT_TIMEOUT,
    )
    return resp.json()


def list_kb_documents(hospital_id, username):
    resp = _authed_request("GET", "/api/v1/assistant/kb", hospital_id, username, timeout=_DEFAULT_TIMEOUT)
    return resp.json()


def remove_kb_document(hospital_id, username, doc_id):
    _authed_request("DELETE", f"/api/v1/assistant/kb/{doc_id}", hospital_id, username, timeout=_DEFAULT_TIMEOUT)


def send_chat_message(hospital_id, username, message, session_id="default", doc_ids=None):
    resp = _authed_request(
        "POST",
        "/api/v1/assistant/chat",
        hospital_id,
        username,
        json={"message": message, "session_id": session_id, "doc_ids": doc_ids},
        timeout=_DEFAULT_TIMEOUT,
    )
    return resp.json()


def get_chat_history(hospital_id, username, session_id="default"):
    resp = _authed_request(
        "GET",
        "/api/v1/assistant/history",
        hospital_id,
        username,
        params={"session_id": session_id},
        timeout=_DEFAULT_TIMEOUT,
    )
    return resp.json()


def clear_chat_history(hospital_id, username, session_id="default"):
    _authed_request(
        "DELETE",
        "/api/v1/assistant/history",
        hospital_id,
        username,
        params={"session_id": session_id},
        timeout=_DEFAULT_TIMEOUT,
    )
