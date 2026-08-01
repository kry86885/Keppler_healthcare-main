import os
from flask import request
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

REDIS_URL = os.getenv("REDIS_URL", "memory://")

limiter = Limiter(
    key_func=get_remote_address,
    storage_uri=REDIS_URL,
    default_limits=["200 per minute"],
)


@limiter.request_filter
def _exempt_cors_preflight():
    # Browser CORS preflights hit the same rate-limited routes as the real
    # request (e.g. login's OPTIONS + POST), so counting them here means 2-3
    # real attempts exhausts the budget and the *next preflight* itself gets
    # a 429 -- which browsers treat as a failed CORS check (they require a 2xx
    # preflight regardless of headers), surfacing as a confusing "blocked by
    # CORS policy" error instead of the intended "too many attempts" message.
    return request.method == "OPTIONS"
