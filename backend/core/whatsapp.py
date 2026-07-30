"""Twilio WhatsApp messaging helpers.

Best-effort integration: every public function here swallows and logs its own
errors so a failed/unconfigured WhatsApp send never breaks the request that
triggered it (an appointment status update, a prescription save, etc).

Required env vars (see .env.example):
    TWILIO_ACCOUNT_SID
    TWILIO_AUTH_TOKEN
    TWILIO_WHATSAPP_FROM        e.g. +14155238886 (no "whatsapp:" prefix)
    PUBLIC_BASE_URL             publicly reachable HTTPS origin of this backend,
                                 required only for messages that attach a PDF
                                 (Twilio's servers fetch media over the open
                                 internet, so this can't be localhost).
    WHATSAPP_DEFAULT_COUNTRY_CODE  optional, defaults to +91

Note: WhatsApp Business API only allows freeform, business-initiated
messages within an active 24-hour customer service session. Outside that
window (the common case for "doctor is ready for you" / "here is your
prescription" notifications), Twilio requires the message to use a
pre-approved Content Template rather than a raw body string. Get templates
approved in the Twilio console before relying on this in production; until
then, sends outside a session window will fail and are logged, not raised.
"""
import logging
import os
import re

logger = logging.getLogger(__name__)

_client = None
_client_checked = False


def _get_client():
    global _client, _client_checked
    if _client_checked:
        return _client
    _client_checked = True
    account_sid = os.getenv("TWILIO_ACCOUNT_SID")
    auth_token = os.getenv("TWILIO_AUTH_TOKEN")
    if not account_sid or not auth_token:
        return None
    try:
        from twilio.rest import Client
        _client = Client(account_sid, auth_token)
    except Exception:
        logger.exception("Failed to initialize Twilio client")
        _client = None
    return _client


def is_configured() -> bool:
    return _get_client() is not None and bool(os.getenv("TWILIO_WHATSAPP_FROM"))


def _normalize_number(raw_phone: str):
    if not raw_phone:
        return None
    digits = re.sub(r"[^\d+]", "", raw_phone)
    if not digits:
        return None
    if digits.startswith("+"):
        return digits
    default_country_code = os.getenv("WHATSAPP_DEFAULT_COUNTRY_CODE", "+91")
    if len(digits) == 10:
        return f"{default_country_code}{digits}"
    return f"+{digits}"


def send_whatsapp_message(to_phone: str, body: str, media_url: str = None) -> bool:
    """Send a WhatsApp message; returns True only on a confirmed Twilio accept."""
    client = _get_client()
    if not client:
        logger.info("WhatsApp not configured (missing Twilio credentials); skipping send.")
        return False

    from_number = os.getenv("TWILIO_WHATSAPP_FROM")
    if not from_number:
        logger.info("TWILIO_WHATSAPP_FROM not set; skipping WhatsApp send.")
        return False

    normalized_to = _normalize_number(to_phone)
    if not normalized_to:
        logger.warning("No usable phone number for WhatsApp message; skipping send.")
        return False

    try:
        kwargs = {
            "from_": f"whatsapp:{from_number}",
            "to": f"whatsapp:{normalized_to}",
            "body": body,
        }
        if media_url:
            kwargs["media_url"] = [media_url]
        client.messages.create(**kwargs)
        return True
    except Exception:
        logger.exception("Failed to send WhatsApp message to %s", to_phone)
        return False
