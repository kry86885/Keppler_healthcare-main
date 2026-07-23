from __future__ import annotations

from pathlib import Path
from dotenv import dotenv_values
from google import genai
from google.genai import types

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "site" / "public" / "images" / "generated"
OUT_DIR.mkdir(parents=True, exist_ok=True)

ASSETS = [
    {
        "name": "hero-reception",
        "aspect": "16:9",
        "prompt": "Photorealistic modern hospital reception area, diverse smiling staff helping patients, natural daylight, clean architecture, no text, no watermark",
    },
    {
        "name": "operations-command-center",
        "aspect": "16:9",
        "prompt": "Photorealistic hospital operations command center with large analytics screens, team collaborating, clean clinical environment, no text",
    },
    {
        "name": "patient-doctor-tablet",
        "aspect": "4:3",
        "prompt": "Photorealistic doctor showing a tablet to a patient in a hospital consultation room, friendly and trustworthy, no text",
    },
    {
        "name": "pharmacy-inventory",
        "aspect": "4:3",
        "prompt": "Photorealistic hospital pharmacy with organized medicine shelves, pharmacist checking inventory on computer, bright and clean, no text",
    },
    {
        "name": "diagnostics-lab",
        "aspect": "4:3",
        "prompt": "Photorealistic hospital diagnostics laboratory with technician processing samples, modern equipment, clean and bright, no text",
    },
    {
        "name": "billing-desk",
        "aspect": "4:3",
        "prompt": "Photorealistic hospital billing desk with staff assisting family at counter, professional and friendly mood, no text",
    },
    {
        "name": "nursing-station",
        "aspect": "16:9",
        "prompt": "Photorealistic nursing station in hospital ward, nurses coordinating care, warm lighting, no text",
    },
    {
        "name": "leadership-meeting",
        "aspect": "16:9",
        "prompt": "Photorealistic hospital leadership team reviewing performance dashboard in meeting room, professional environment, no text",
    },
    {
        "name": "customer-support-team",
        "aspect": "16:9",
        "prompt": "Photorealistic healthcare software support team on video call assisting hospital client, friendly and professional, no text",
    },
]


def get_client() -> genai.Client:
    env = dotenv_values(ROOT / ".env")
    api_key = (env.get("GEMINI_API_KEY") or env.get("GOOGLE_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("Missing GEMINI_API_KEY or GOOGLE_API_KEY in root .env")
    return genai.Client(api_key=api_key)


def generate() -> None:
    client = get_client()
    for asset in ASSETS:
        name = asset["name"]
        out = OUT_DIR / f"{name}.png"
        print(f"Generating {name} ({asset['aspect']})...")
        response = client.models.generate_images(
            model="imagen-4.0-fast-generate-001",
            prompt=asset["prompt"],
            config=types.GenerateImagesConfig(number_of_images=1, aspect_ratio=asset["aspect"]),
        )
        generated = response.generated_images or []
        if not generated:
            raise RuntimeError(f"No image returned for {name}")
        out.write_bytes(generated[0].image.image_bytes)
        print(f"Saved {out}")


if __name__ == "__main__":
    generate()
