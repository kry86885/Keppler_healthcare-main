"""Compatibility shim.

The canonical database implementation lives in backend/utils/database.py.
This module re-exports it to avoid duplicate logic and stale divergence.
"""

from backend.utils.database import *  # noqa: F401,F403
