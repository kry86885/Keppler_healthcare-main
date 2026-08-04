"""OpenAI-compatible vLLM provider for local text and vision models."""

import base64
import os

import requests

from utils.ocr import (
    SUPPORTED_IMAGE_MIME_TYPES,
    _detect_mime_type,
    _extract_markdown_from_llm_response,
    _extract_text_from_pdf_bytes,
    _pdf_formatting_prompt,
    _vision_prompt,
)

VLLM_BASE_URL = os.getenv(
    "VLLM_BASE_URL", "http://host.docker.internal:8700/v1"
).rstrip("/")
VLLM_MODEL = os.getenv("VLLM_MODEL", "qwen2.5-vl-7b")
VLLM_API_KEY = os.getenv("VLLM_API_KEY", "local")
VLLM_TIMEOUT_SECONDS = int(os.getenv("VLLM_TIMEOUT_SECONDS", "240"))


def _headers():
    headers = {"Content-Type": "application/json"}
    if VLLM_API_KEY:
        headers["Authorization"] = f"Bearer {VLLM_API_KEY}"
    return headers


def _chat_completion(messages, temperature=0.1, max_tokens=2048, json_mode=False):
    payload = {
        "model": VLLM_MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    response = requests.post(
        f"{VLLM_BASE_URL}/chat/completions",
        json=payload,
        headers=_headers(),
        timeout=VLLM_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    data = response.json()
    return (data["choices"][0]["message"]["content"] or "").strip()


class VLLMLLMProvider:
    def is_configured(self) -> bool:
        try:
            response = requests.get(
                f"{VLLM_BASE_URL}/models", headers=_headers(), timeout=5
            )
            return response.status_code == 200
        except Exception:
            return False

    def generate(self, prompt: str, context: str = "", json_mode: bool = False):
        full_prompt = f"{context}\n\n{prompt}" if context else prompt
        return _chat_completion(
            [{"role": "user", "content": full_prompt}],
            temperature=0.1,
            max_tokens=2048,
            json_mode=json_mode,
        )


class VLLMOCRProvider:
    def extract_text(
        self, file_bytes, language="en", doc_type="document", filename=None
    ):
        mime_type = _detect_mime_type(file_bytes, filename)
        target_language = {
            "en": "English",
            "es": "Spanish",
            "fr": "French",
            "de": "German",
        }.get(language, "English")

        try:
            if mime_type == "application/pdf":
                raw_text = _extract_text_from_pdf_bytes(file_bytes)
                if raw_text:
                    response = _chat_completion(
                        [
                            {
                                "role": "user",
                                "content": _pdf_formatting_prompt(
                                    raw_text, target_language, doc_type
                                ),
                            }
                        ],
                        temperature=0.1,
                        max_tokens=4096,
                        json_mode=True,
                    )
                    return _extract_markdown_from_llm_response(response) or raw_text
                return "OCR Error: Scanned PDF OCR requires image conversion before sending to the local vLLM model."

            if mime_type and mime_type not in SUPPORTED_IMAGE_MIME_TYPES:
                return (
                    f"OCR Error: Unsupported file type ({mime_type}). "
                    "Upload an image (JPG, PNG, WEBP, TIFF, BMP, GIF, HEIC/HEIF) or text-based PDF."
                )

            content_mime = mime_type or "image/jpeg"
            encoded = base64.b64encode(file_bytes).decode("ascii")
            prompt = _vision_prompt(target_language, doc_type)
            response = _chat_completion(
                [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:{content_mime};base64,{encoded}"
                                },
                            },
                        ],
                    }
                ],
                temperature=0.1,
                max_tokens=4096,
                json_mode=True,
            )
            return _extract_markdown_from_llm_response(response)
        except Exception as exc:
            return f"OCR Error: Local vLLM OCR failed: {exc}"
