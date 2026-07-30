from flask import Blueprint, Response

from utils.database import get_whatsapp_media

whatsapp_bp = Blueprint('whatsapp', __name__)


@whatsapp_bp.get("/api/whatsapp/media/<token>")
def whatsapp_media(token):
    """Serves a previously generated file (e.g. a prescription PDF) by an
    unguessable random token. Intentionally has no auth decorator: Twilio's
    servers fetch WhatsApp media attachments directly over the open internet
    and cannot send our session cookies. Access control instead comes from
    the token being a random uuid4 that is only ever handed to Twilio, never
    exposed in any list/index endpoint."""
    content, mime_type = get_whatsapp_media(token)
    if content is None:
        return Response(status=404)
    return Response(bytes(content), mimetype=mime_type or "application/octet-stream")
