import os

from cryptography.fernet import Fernet

# Encrypts the auto-generated password stored for each hospital/user's
# provisioned account on the separate OCR service (see ai/ocr_portal_client.py)
# -- that password never leaves the server, but it's persisted so we can
# re-login after the OCR service's 24h JWT expires. Dev-only default below;
# override via env for any real deployment, same convention as
# ocr_portal/core/config.py's UPLOAD_ENCRYPTION_KEY.
OCR_SERVICE_ENCRYPTION_KEY = os.getenv(
    "OCR_SERVICE_ENCRYPTION_KEY", "sqTQy3SxfRvnUrOuMBqfF3tgJJLn6TjBVohGv8Uh_5c="
)

_fernet = Fernet(OCR_SERVICE_ENCRYPTION_KEY.encode("utf-8"))


def encrypt_secret(plaintext: str) -> str:
    return _fernet.encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_secret(ciphertext: str) -> str:
    return _fernet.decrypt(ciphertext.encode("utf-8")).decode("utf-8")
