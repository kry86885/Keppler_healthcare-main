"""Embedding generation and vector similarity search for clinical documents.

Embeddings are generated via the Gemini embedding API (consistent with the existing
Gemini-backed OCR/AI provider decision) rather than a local model -- this avoids adding
a multi-GB PyTorch/sentence-transformers dependency to a Flask+gunicorn deployment.

Vectors are stored as JSON-encoded float arrays (portable across SQLite and Postgres)
and compared via cosine similarity in Python. This works identically on both database
engines without requiring the Postgres `vector` extension to be pre-installed; upgrading
a specific deployment to native pgvector indexing later is a storage-layer optimization,
not a change to this module's interface.
"""

import json
import math
import os

from .ocr import get_genai_model

EMBEDDING_MODEL = os.getenv("GEMINI_EMBEDDING_MODEL", "text-embedding-004")


def generate_embedding(text: str):
    """Return a float vector for the given text, or None if embeddings are unavailable."""
    text = (text or "").strip()
    if not text:
        return None
    client = get_genai_model()
    if client is None:
        return None
    try:
        response = client.models.embed_content(model=EMBEDDING_MODEL, contents=text)
        embeddings = getattr(response, "embeddings", None)
        if not embeddings:
            return None
        values = getattr(embeddings[0], "values", None)
        return list(values) if values else None
    except Exception:
        return None


def cosine_similarity(vector_a, vector_b) -> float:
    if not vector_a or not vector_b or len(vector_a) != len(vector_b):
        return 0.0
    dot = sum(a * b for a, b in zip(vector_a, vector_b))
    norm_a = math.sqrt(sum(a * a for a in vector_a))
    norm_b = math.sqrt(sum(b * b for b in vector_b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def encode_vector(vector) -> str:
    return json.dumps(vector, separators=(",", ":"))


def decode_vector(raw):
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return None
