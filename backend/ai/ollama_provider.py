"""Ollama-backed implementation of the LLMProvider interface -- fully local, no API key.

Talks to a local Ollama server (https://ollama.com) over HTTP. Requires `ollama serve`
running (the Windows installer runs it as a background service automatically) and the
configured model pulled ahead of time, e.g. `ollama pull qwen2.5:3b-instruct`.
"""

import os

import requests

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b-instruct")


class OllamaLLMProvider:
    def is_configured(self) -> bool:
        try:
            resp = requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=2)
            return resp.status_code == 200
        except Exception:
            return False

    def generate(self, prompt: str, context: str = "", json_mode: bool = False):
        full_prompt = f"{context}\n\n{prompt}" if context else prompt
        payload = {"model": OLLAMA_MODEL, "prompt": full_prompt, "stream": False}
        if json_mode:
            payload["format"] = "json"
        try:
            resp = requests.post(f"{OLLAMA_BASE_URL}/api/generate", json=payload, timeout=180)
            resp.raise_for_status()
            return (resp.json().get("response") or "").strip()
        except Exception:
            return None
