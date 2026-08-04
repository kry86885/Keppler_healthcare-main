from __future__ import annotations
import os
import sys
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
import re
import time
from pathlib import Path
from datetime import datetime, timezone
import io

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from fpdf import FPDF

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR.parent / ".env", override=False)
load_dotenv(BASE_DIR.parent / "backend" / ".env", override=False)
load_dotenv(BASE_DIR / ".env", override=False)

app = Flask(__name__)

DEFAULT_ALLOWED_ORIGINS = {
    "https://app.hospai.ai",
    "https://staging-app.hospai.ai",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:6173",
    "http://127.0.0.1:6173",
}
ENV_ALLOWED_ORIGINS = {
    origin.strip()
    for origin in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
}
ALLOWED_ORIGINS = set(DEFAULT_ALLOWED_ORIGINS)
ALLOWED_ORIGINS.update(ENV_ALLOWED_ORIGINS)


def is_allowed_origin(origin: str | None) -> bool:
    if not origin:
        return False
    if origin in ALLOWED_ORIGINS:
        return True
    # Allow all HospAI HTTPS subdomains (staging/prod/custom app surfaces).
    if re.match(r"^https://([a-z0-9-]+\.)*hospai\.ai$", origin):
        return True
    # Allow localhost dev servers on any port.
    return re.match(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$", origin) is not None


CORS(
    app,
    resources={
        r"/api/*": {
            "origins": [
                r"^https://([a-z0-9-]+\.)*hospai\.ai$",
                r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
                *sorted(ALLOWED_ORIGINS),
            ]
        }
    },
    supports_credentials=True,
    allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
    methods=["GET", "POST", "OPTIONS"],
)

CONTEXT_TAGS = [
    "Recent stress",
    "Changed sleep pattern",
    "New exercise routine",
    "Dietary changes",
    "Weather changes",
    "Travel recently",
    "Screen time increase",
    "Sitting for long periods",
    "Physical activity",
    "Emotional changes",
    "Hydration concerns",
    "New environment",
]

DURATION_OPTIONS = [
    "Just started (today)",
    "A few days",
    "About a week",
    "1-2 weeks",
    "2-4 weeks",
    "More than a month",
    "Comes and goes",
    "Recurring over time",
]

BODY_REGIONS = {
    "Head & Face": {
        "keywords": ["head", "headache", "face", "forehead", "temple", "scalp", "skull", "brain"],
        "color": "#6B8E9F",
        "icon": "🧠",
        "svg_id": "head",
    },
    "Eyes": {
        "keywords": ["eye", "eyes", "vision", "sight", "eyelid", "pupil"],
        "color": "#7BA3B8",
        "icon": "👁️",
        "svg_id": "eyes",
    },
    "Ears": {
        "keywords": ["ear", "ears", "hearing", "earlobe", "ringing"],
        "color": "#8BB8C8",
        "icon": "👂",
        "svg_id": "ears",
    },
    "Nose & Sinuses": {
        "keywords": ["nose", "nasal", "sinus", "nostril", "smell"],
        "color": "#9BCDD8",
        "icon": "👃",
        "svg_id": "nose",
    },
    "Mouth & Throat": {
        "keywords": ["mouth", "throat", "tongue", "lips", "tonsil", "swallow", "voice", "jaw"],
        "color": "#6B9F8E",
        "icon": "👄",
        "svg_id": "mouth",
    },
    "Neck": {
        "keywords": ["neck", "cervical", "throat area", "nape"],
        "color": "#7BB8A3",
        "icon": "🦒",
        "svg_id": "neck",
    },
    "Shoulders": {
        "keywords": ["shoulder", "shoulders", "deltoid", "rotator"],
        "color": "#8BC8B3",
        "icon": "💪",
        "svg_id": "shoulders",
    },
    "Upper Back": {
        "keywords": ["upper back", "thoracic", "shoulder blade", "scapula"],
        "color": "#9BD8C3",
        "icon": "🔙",
        "svg_id": "upper_back",
    },
    "Lower Back": {
        "keywords": ["lower back", "lumbar", "spine", "tailbone", "sacral"],
        "color": "#6B8F9F",
        "icon": "🔙",
        "svg_id": "lower_back",
    },
    "Chest": {
        "keywords": ["chest", "breast", "sternum", "rib", "pectoral", "heartburn"],
        "color": "#7BA8B8",
        "icon": "🫁",
        "svg_id": "chest",
    },
    "Abdomen": {
        "keywords": ["abdomen", "stomach", "belly", "gut", "abdominal", "tummy", "navel"],
        "color": "#8BB8C8",
        "icon": "🤰",
        "svg_id": "abdomen",
    },
    "Arms & Elbows": {
        "keywords": ["arm", "arms", "elbow", "bicep", "tricep", "forearm", "upper arm"],
        "color": "#9BC8D8",
        "icon": "💪",
        "svg_id": "arms",
    },
    "Hands & Wrists": {
        "keywords": ["hand", "hands", "wrist", "finger", "palm", "thumb", "knuckle"],
        "color": "#6B9F9F",
        "icon": "🤚",
        "svg_id": "hands",
    },
    "Hips & Pelvis": {
        "keywords": ["hip", "hips", "pelvis", "groin", "pelvic"],
        "color": "#7BB8B8",
        "icon": "🦴",
        "svg_id": "hips",
    },
    "Thighs & Upper Legs": {
        "keywords": ["thigh", "upper leg", "quadricep", "hamstring"],
        "color": "#8BC8C8",
        "icon": "🦵",
        "svg_id": "thighs",
    },
    "Knees": {
        "keywords": ["knee", "knees", "kneecap", "patella"],
        "color": "#9BD8D8",
        "icon": "🦵",
        "svg_id": "knees",
    },
    "Lower Legs & Calves": {
        "keywords": ["calf", "calves", "shin", "lower leg", "ankle area"],
        "color": "#6B9F8F",
        "icon": "🦵",
        "svg_id": "lower_legs",
    },
    "Feet & Ankles": {
        "keywords": ["foot", "feet", "ankle", "toe", "heel", "sole", "arch"],
        "color": "#7BB8A8",
        "icon": "🦶",
        "svg_id": "feet",
    },
    "General / Full Body": {
        "keywords": ["general", "whole body", "everywhere", "all over", "fatigue", "tired", "weak"],
        "color": "#8BC8B8",
        "icon": "🧍",
        "svg_id": "full_body",
    },
}

BANNED_MEDICAL_TERMS = {
    "cancer",
    "tumor",
    "tumour",
    "carcinoma",
    "melanoma",
    "leukemia",
    "diabetes",
    "diabetic",
    "hypertension",
    "hypotension",
    "arthritis",
    "fibromyalgia",
    "lupus",
    "sclerosis",
    "parkinson",
    "alzheimer",
    "dementia",
    "stroke",
    "heart attack",
    "myocardial infarction",
    "cardiac arrest",
    "aneurysm",
    "embolism",
    "thrombosis",
    "clot",
    "pneumonia",
    "bronchitis",
    "asthma",
    "copd",
    "emphysema",
    "hepatitis",
    "cirrhosis",
    "pancreatitis",
    "appendicitis",
    "diverticulitis",
    "colitis",
    "crohn",
    "meningitis",
    "encephalitis",
    "neuropathy",
    "infection",
    "bacterial",
    "viral",
    "fungal",
    "sepsis",
    "anemia",
    "anaemia",
    "hemophilia",
    "epilepsy",
    "hernia",
    "fracture",
    "rupture",
    "syndrome",
    "disorder",
    "disease",
    "condition",
    "pathology",
    "malignant",
    "benign",
    "chronic",
    "acute",
    "diagnosis",
    "prognosis",
    "etiology",
    "surgery",
    "surgical",
    "operation",
    "biopsy",
    "chemotherapy",
    "radiation therapy",
    "dialysis",
    "prescription",
    "medication",
    "antibiotic",
    "steroid",
    "lesion",
    "nodule",
    "cyst",
    "polyp",
    "abscess",
    "inflammation",
    "edema",
    "oedema",
    "necrosis",
    "hemorrhage",
    "haemorrhage",
    "schizophrenia",
    "bipolar",
    "psychosis",
    "ptsd",
    "depression",
    "anxiety disorder",
    "ocd",
    "adhd",
    "autism spectrum",
}

DIAGNOSTIC_PATTERNS = [
    r"you (might|may|could|probably) have",
    r"this (is|could be|might be|appears to be)",
    r"symptoms of",
    r"signs of",
    r"indicative of",
    r"consistent with",
    r"suggestive of",
    r"characteristic of",
    r"diagnosed (as|with)",
    r"diagnosis of",
]

STATS_PATTERNS = [
    r"\d+(\.\d+)?\s*%",
    r"\d+ (out of|in) \d+",
    r"\d+-\d+%",
    r"mortality rate",
    r"survival rate",
    r"probability",
    r"statistically",
]

MANDATORY_DISCLAIMER = (
    "\n\n### ⚠️ Important Reminder\n"
    "This information is for educational purposes only and is not medical advice. "
    "Every person's body is unique. If you have concerns about your wellbeing, "
    "please consult with a qualified healthcare professional."
)

SYSTEM_PROMPT = """You are a calm, educational wellness explainer for SymptoMap.ai.

CRITICAL RULES:
1. Never diagnose any disease or condition.
2. Never use medical terminology or treatment plans.
3. Never provide percentages/statistics or risk probabilities.
4. Use plain language, calm tone, and educational framing.
5. Include urgency guidance without diagnosis.
6. Always include this disclaimer: This information is for educational purposes only and is not medical advice.

Use this exact markdown structure:
### 🚦 Urgency Assessment
### 🌿 Understanding Your Sensation
### 💭 Everyday Possibilities
### 🌱 Gentle Self-Care Ideas
### ⚡ Body Region Insight
### 🚨 When to Seek Support
### ⚠️ Important Reminder
"""

_last_request = 0.0


def _rate_limit():
    global _last_request
    interval = float(os.getenv("SYMPTOM_AI_MIN_REQUEST_INTERVAL", "1.0"))
    elapsed = time.time() - _last_request
    if elapsed < interval:
        time.sleep(interval - elapsed)
    _last_request = time.time()


try:
    from google import genai
    from google.genai import types as genai_types
    _GENAI_IMPORT_ERROR = None
except Exception as exc:  # pragma: no cover - import guard for local/dev env mismatch
    genai = None
    genai_types = None
    _GENAI_IMPORT_ERROR = exc

GEMINI_MODEL = os.getenv("SYMPTOM_AI_MODEL") or os.getenv("GEMINI_MODEL") or "gemini-2.0-flash"
_gemini_client = None


def _resolve_gemini_api_key():
    # Dedicated symptom_backend key first (see SYMPTOM_AI_GEMINI_API_KEY in
    # the root .env) so this service can use its own key/quota independent
    # of the main backend's GEMINI_API_KEY (OCR, /api/symptom-ai/* RAG chat).
    return (
        os.getenv("SYMPTOM_AI_GEMINI_API_KEY")
        or os.getenv("GEMINI_API_KEY")
        or os.getenv("GOOGLE_API_KEY")
        or ""
    ).strip()


def _get_gemini_client():
    global _gemini_client
    if genai is None:
        return None
    if _gemini_client is None:
        api_key = _resolve_gemini_api_key()
        if not api_key:
            return None
        _gemini_client = genai.Client(api_key=api_key)
    return _gemini_client


def _gemini_available():
    return _get_gemini_client() is not None


def _gemini_generate(prompt: str, json_mode: bool = False, temperature: float = 0.7, max_tokens: int = 1024):
    client = _get_gemini_client()
    if client is None:
        return None, "GEMINI_API_KEY is not configured or google-genai is not installed"
    try:
        config = genai_types.GenerateContentConfig(
            temperature=temperature,
            max_output_tokens=max_tokens,
            response_mime_type="application/json" if json_mode else None,
        )
        response = client.models.generate_content(model=GEMINI_MODEL, contents=prompt, config=config)
        return (response.text or "").strip(), None
    except Exception as exc:
        return None, str(exc)


def _require_api_key():
    if _gemini_available():
        return None
    return jsonify({"error": "GEMINI_API_KEY is not configured for the Symptom AI service"}), 503


def detect_region_from_text(text: str):
    # Word-boundary matching, not substring containment — plain "in" checks match keywords
    # inside unrelated words (e.g. "near"/"heard"/"search" all contain "ear", falsely
    # matching the Ears region), which silently produced wrong detections.
    normalized = (text or "").lower()
    for region, data in BODY_REGIONS.items():
        for keyword in data["keywords"]:
            if re.search(r"\b" + re.escape(keyword) + r"\b", normalized):
                return region
    return None


def _intensity_description(intensity: int):
    if intensity <= 2:
        return "Very mild, barely noticeable"
    if intensity <= 4:
        return "Mild, present but manageable"
    if intensity <= 6:
        return "Moderate, noticeable"
    if intensity <= 8:
        return "Significant, quite noticeable"
    return "Intense, very prominent"


def _format_patient_info(patient_info):
    if not isinstance(patient_info, dict):
        return "Patient Information: Not provided"

    lines = ["Patient Information:"]
    age = patient_info.get("age")
    gender = patient_info.get("gender")
    temperature = patient_info.get("temperature")
    temp_unit = patient_info.get("temp_unit") or "°F"
    blood_pressure = patient_info.get("blood_pressure") or {}
    heart_rate = patient_info.get("heart_rate")

    if age:
        lines.append(f"- Age: {age} years")
    if gender:
        lines.append(f"- Gender: {gender}")
    if temperature is not None:
        lines.append(f"- Temperature: {temperature}{temp_unit}")
    if isinstance(blood_pressure, dict) and blood_pressure.get("systolic") and blood_pressure.get("diastolic"):
        lines.append(f"- Blood Pressure: {blood_pressure['systolic']}/{blood_pressure['diastolic']} mmHg")
    if heart_rate:
        lines.append(f"- Heart Rate: {heart_rate} BPM")

    if len(lines) == 1:
        return "Patient Information: Not provided"
    return "\n".join(lines)


def _sanitize_response(text: str):
    if not text:
        return "", []

    sanitized = text
    removed = []

    for term in BANNED_MEDICAL_TERMS:
        pattern = re.compile(r"\b" + re.escape(term) + r"\b", re.IGNORECASE)
        if pattern.search(sanitized):
            removed.append(term)
            sanitized = pattern.sub("[health consideration]", sanitized)

    for pattern_str in DIAGNOSTIC_PATTERNS:
        pattern = re.compile(pattern_str, re.IGNORECASE)
        if pattern.search(sanitized):
            removed.append(pattern_str)
            sanitized = pattern.sub("", sanitized)

    for pattern_str in STATS_PATTERNS:
        pattern = re.compile(pattern_str, re.IGNORECASE)
        if pattern.search(sanitized):
            removed.append(pattern_str)
            sanitized = pattern.sub("", sanitized)

    if "educational purposes" not in sanitized.lower() or "not medical advice" not in sanitized.lower():
        sanitized = sanitized.rstrip() + MANDATORY_DISCLAIMER

    sanitized = re.sub(r" {2,}", " ", sanitized)
    sanitized = re.sub(r"\n{3,}", "\n\n", sanitized)
    sanitized = "\n".join(line.rstrip() for line in sanitized.split("\n")).strip()

    return sanitized, removed


def _fallback_response():
    return """### 🚦 Urgency Assessment
🟢 **Routine** - This appears to be a general wellness inquiry that can start with supportive self-care.

### 🌿 Understanding Your Sensation
Thanks for sharing what you're experiencing. Body sensations can change with routine, activity, stress, hydration, and rest.

### 💭 Everyday Possibilities
- Changes in sleep or daily routine
- Stress or emotional load
- Hydration and nutrition patterns
- Posture or activity changes

### 🌱 Gentle Self-Care Ideas
- Pause for slow breathing for a few minutes
- Hydrate consistently across the day
- Use gentle stretching or light movement
- Prioritize rest and recovery

### ⚡ Body Region Insight
Your selected body region can react to posture, workload, and daily habits. Tracking patterns over time can help your awareness.

### 🚨 When to Seek Support
If this persists, worsens, or affects daily function, contact a healthcare professional.

### ⚠️ Important Reminder
This information is for educational purposes only and is not medical advice. Every person's body is unique. If you have concerns about your wellbeing, please consult with a qualified healthcare professional."""


def _build_user_prompt(payload):
    sensation = (payload.get("description") or "").strip()
    body_region = payload.get("body_region") or "General / Full Body"
    intensity = int(payload.get("intensity") or 5)
    duration = payload.get("duration") or "Not specified"
    context_tags = payload.get("context_tags") or []
    patient_info = payload.get("patient_info")

    context_text = ", ".join(context_tags) if context_tags else "Not specified"
    patient_text = _format_patient_info(patient_info)
    return f"""Please provide a calm, educational wellness explanation.

Sensation Description: {sensation}
Body Region: {body_region}
Intensity Level: {intensity}/10 ({_intensity_description(intensity)})
Duration: {duration}
Relevant Context: {context_text}

{patient_text}

Keep the exact section format and maintain a calm tone."""


def _generate_insight_pdf(payload):
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    pdf.set_title("SymptoMap AI Insight")
    pdf.set_author("HospAI SymptoMap AI")

    def setup_fonts():
        body_candidates = [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
            "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
            "/Library/Fonts/Arial Unicode.ttf",
        ]
        emoji_candidates = [
            "/usr/share/fonts/truetype/noto/NotoEmoji-Regular.ttf",
            "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf",
            "/System/Library/Fonts/Apple Color Emoji.ttc",
        ]

        selected_body = "Helvetica"
        unicode_ok = False

        for path in body_candidates:
            if not os.path.exists(path):
                continue
            try:
                pdf.add_font("Body", "", path)
                pdf.add_font("Body", "B", path)
                selected_body = "Body"
                unicode_ok = True
                break
            except Exception:
                continue

        if unicode_ok:
            for path in emoji_candidates:
                if not os.path.exists(path):
                    continue
                try:
                    pdf.add_font("Emoji", "", path)
                    pdf.set_fallback_fonts(["Emoji"])
                    break
                except Exception:
                    continue

        return selected_body, unicode_ok

    body_font, unicode_ok = setup_fonts()

    def sanitize_text(value, keep_unicode=False):
        text = "" if value is None else str(value)
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        if keep_unicode:
            return text
        return text.encode("latin-1", errors="replace").decode("latin-1")

    def heading(text):
        pdf.set_font(body_font, "B", 16)
        pdf.set_x(pdf.l_margin)
        pdf.multi_cell(pdf.w - pdf.l_margin - pdf.r_margin, 8, sanitize_text(text, keep_unicode=unicode_ok))
        pdf.ln(1)

    def subheading(text):
        pdf.set_font(body_font, "B", 11)
        pdf.set_x(pdf.l_margin)
        pdf.multi_cell(pdf.w - pdf.l_margin - pdf.r_margin, 7, sanitize_text(text, keep_unicode=unicode_ok))

    def body(text, markdown=False):
        pdf.set_font(body_font, "", 10)
        pdf.set_x(pdf.l_margin)
        pdf.multi_cell(
            pdf.w - pdf.l_margin - pdf.r_margin,
            6,
            sanitize_text(text, keep_unicode=unicode_ok),
            markdown=markdown,
        )
        pdf.ln(1)

    def render_markdown(text):
        source = sanitize_text(text, keep_unicode=unicode_ok).strip()
        if not source:
            body("No insight text provided.")
            return

        lines = source.split("\n")
        for raw in lines:
            line = raw.strip()
            if not line:
                pdf.ln(2)
                continue
            if line.startswith("### "):
                subheading(line[4:].strip())
                continue
            if line.startswith("## "):
                pdf.set_font(body_font, "B", 13)
                pdf.set_x(pdf.l_margin)
                pdf.multi_cell(pdf.w - pdf.l_margin - pdf.r_margin, 7, line[3:].strip())
                pdf.ln(1)
                continue
            if line.startswith("# "):
                pdf.set_font(body_font, "B", 15)
                pdf.set_x(pdf.l_margin)
                pdf.multi_cell(pdf.w - pdf.l_margin - pdf.r_margin, 8, line[2:].strip())
                pdf.ln(1)
                continue
            if line.startswith("- ") or line.startswith("* "):
                body(f"• {line[2:].strip()}", markdown=True)
                continue
            body(line, markdown=True)

    heading("SymptoMap AI Wellness Insight")

    generated_at = payload.get("generated_at") or datetime.now(timezone.utc).isoformat()
    description = (payload.get("description") or "").strip()
    region = payload.get("region") or "General / Full Body"
    intensity = payload.get("intensity") or ""
    duration = payload.get("duration") or ""
    response_text = (payload.get("response") or "").strip()

    subheading("Generated")
    body(str(generated_at))
    subheading("Region")
    body(str(region))
    subheading("Intensity")
    body(f"{intensity}/10" if intensity != "" else "N/A")
    subheading("Duration")
    body(str(duration or "N/A"))
    subheading("Description")
    body(description or "N/A")
    subheading("Insight")
    render_markdown(response_text or "No insight text provided.")

    binary = pdf.output(dest="S")
    if isinstance(binary, bytearray):
        binary = bytes(binary)
    elif isinstance(binary, str):
        binary = binary.encode("latin-1", errors="replace")
    return binary


def _generate_with_gemini(system_prompt: str, user_prompt: str):
    if not _gemini_available():
        return None, "GEMINI_API_KEY is not configured for the Symptom AI service"

    _rate_limit()
    text, error = _gemini_generate(
        f"{system_prompt}\n\nUser input:\n{user_prompt}", temperature=0.7, max_tokens=1024
    )
    if error:
        return None, error
    if not text:
        return None, "Empty response from model"
    return text, None


def _classify_region_with_gemini(description: str):
    # The static keyword list in BODY_REGIONS only catches descriptions that happen to
    # contain one of its exact substrings, so it misses most real phrasing. This is the
    # fallback for when that quick match comes up empty: ask the model to pick the closest
    # region from the same fixed list, constrained to an exact-match response so it can't
    # hallucinate a region name the frontend won't recognize.
    if not _gemini_available():
        return None

    region_names = list(BODY_REGIONS.keys())
    prompt = (
        "A person described a physical body sensation. Reply with ONLY the single closest "
        "matching region name, copied exactly from this list, and nothing else:\n"
        + "\n".join(region_names)
        + f'\n\nSensation description: "{description}"\n\nRegion:'
    )
    try:
        _rate_limit()
        text, error = _gemini_generate(prompt, temperature=0, max_tokens=20)
        if error or not text:
            return None
        candidate = text.strip()
        return candidate if candidate in BODY_REGIONS else None
    except Exception:
        return None


@app.after_request
def add_cors_headers(response):
    origin = request.headers.get("Origin")
    if is_allowed_origin(origin):
        response.headers.setdefault("Access-Control-Allow-Origin", origin)
        response.headers.setdefault("Access-Control-Allow-Credentials", "true")
        response.headers.setdefault("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
        response.headers.setdefault("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    return response


@app.route("/api/<path:_path>", methods=["OPTIONS"])
def preflight(_path):
    return ("", 204)


@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "service": "symptom-backend"})


@app.get("/api/symptom-ai/meta")
def symptom_meta():
    regions = [
        {
            "name": name,
            "keywords": value["keywords"],
            "color": value["color"],
            "icon": value["icon"],
            "svg_id": value["svg_id"],
        }
        for name, value in BODY_REGIONS.items()
    ]
    return jsonify(
        {
            "context_tags": CONTEXT_TAGS,
            "duration_options": DURATION_OPTIONS,
            "regions": regions,
            "about": {
                "what_is": "SymptoMap AI is a wellness education companion for understanding body sensations.",
                "does_not": [
                    "Diagnose health conditions",
                    "Provide medical treatment plans",
                    "Replace professional healthcare advice",
                ],
            },
            "safety": {
                "disclaimer": "Educational tool only. Not medical advice.",
                "emergency": "For severe or urgent concerns, contact emergency services immediately.",
            },
            "api_key_configured": _gemini_available(),
        }
    )


@app.post("/api/symptom-ai/detect-region")
def detect_region():
    payload = request.get_json(force=True) or {}
    description = payload.get("description") or ""
    region = detect_region_from_text(description) or _classify_region_with_gemini(description)
    return jsonify({"region": region})


@app.post("/api/symptom-ai/analyze")
def analyze():
    key_error = _require_api_key()
    if key_error:
        return key_error

    payload = request.get_json(force=True) or {}
    description = (payload.get("description") or "").strip()

    if len(description) < 10:
        return jsonify({"error": "Please provide at least 10 characters in the sensation description."}), 400
    if len(description) > 2000:
        return jsonify({"error": "Please keep the description under 2000 characters."}), 400

    detected = detect_region_from_text(description) or _classify_region_with_gemini(description)
    model_response, model_error = _generate_with_gemini(SYSTEM_PROMPT, _build_user_prompt(payload))

    if not model_response:
        return jsonify({"error": f"Unable to generate wellness insights: {model_error or 'unknown model error'}"}), 502

    sanitized, removed_terms = _sanitize_response(model_response)
    used_fallback = False

    return jsonify(
        {
            "response": sanitized,
            "detected_region": detected,
            "removed_terms": removed_terms,
            "used_fallback": used_fallback,
            "model_error": model_error,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
    )

@app.post("/api/symptom-ai/triage")
def triage():
    key_error = _require_api_key()
    if key_error:
        return key_error

    payload = request.get_json(force=True) or {}
    symptoms = (payload.get("symptoms") or "").strip()
    available_departments = payload.get("available_departments") or []
    available_doctors = payload.get("available_doctors") or []

    if len(symptoms) < 5:
        return jsonify({"error": "Please provide a valid symptom description."}), 400

    departments_str = ", ".join(available_departments) if available_departments else "General Medicine, Cardiology, Neurology, Orthopedics, Pediatrics, Gynecology, Dermatology, Psychiatry, Oncology"
    doctors_str = ", ".join(available_doctors) if available_doctors else "Any available doctor"

    prompt = (
        "You are a medical triage assistant. A patient at the registration desk has the following symptoms or requests:\n"
        f'"{symptoms}"\n\n'
        "Based on this, determine the most appropriate hospital department, the urgency, a brief reasoning, and the specific doctor if mentioned or clearly applicable.\n\n"
        f"Available departments: [{departments_str}]\n"
        f"Available doctors: [{doctors_str}]\n\n"
        "Important Rule for 'doctor': If you select a doctor, ONLY return their exact name. Strip out any department in parentheses (e.g. return 'Dr Srinu' instead of 'Dr Srinu (Cardiology)').\n\n"
        "Respond ONLY with a valid JSON object in this exact format:\n"
        "{\n"
        '  "department": "Must EXACTLY match one of the Available departments",\n'
        '  "urgency": "Routine | Urgent | Emergency",\n'
        '  "reasoning": "Brief explanation",\n'
        '  "doctor": "Doctor name or empty string"\n'
        "}"
    )

    try:
        _rate_limit()
        text, error = _gemini_generate(prompt, json_mode=True, temperature=0)
        if error or not text:
            raise RuntimeError(error or "Empty response from model")
        import json
        triage_result = json.loads(text)
        
        # Enforce that the selected department is valid
        dept = triage_result.get("department")
        if available_departments and dept not in available_departments:
            triage_result["department"] = "General Medicine"
            triage_result["reasoning"] += f" (Note: Directed to General Medicine as {dept} was not available.)"
            
        return jsonify(triage_result)
    except Exception as exc:
        fallback_dept = "General Medicine"
        if available_departments and fallback_dept not in available_departments:
            fallback_dept = available_departments[0]
            
        fallback_triage = {
            "department": fallback_dept,
            "urgency": "Routine",
            "reasoning": f"AI Triage fallback due to error. {str(exc)}"
        }
        return jsonify(fallback_triage), 200


@app.post("/api/symptom-ai/export/pdf")
def export_pdf():
    try:
        payload = request.get_json(force=True) or {}
        pdf_bytes = _generate_insight_pdf(payload)
        filename = f"symptomap_ai_insight_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.pdf"
        return send_file(
            io.BytesIO(pdf_bytes),
            mimetype="application/pdf",
            as_attachment=True,
            download_name=filename,
        )
    except Exception as exc:
        return jsonify({"error": f"PDF export failed: {exc}"}), 500


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5002"))
    app.run(host="0.0.0.0", port=port, debug=True)
