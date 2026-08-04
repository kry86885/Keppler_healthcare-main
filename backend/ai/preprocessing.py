"""CPU-only image preprocessing for the OCR pipeline: deskew, denoise, contrast normalization.

This is the realistically implementable slice of the "CRAFT/PaddleOCR/TrOCR" preprocessing
stage in this environment (no GPU) -- genuinely improves OCR input quality via classic
computer-vision techniques (OpenCV), not a stub. Runs before the image reaches the OCR
provider. Any failure (corrupt image, unsupported format, decode error) falls back to
returning the original bytes unchanged -- preprocessing must never break document upload.
"""

import cv2
import numpy as np

MAX_DESKEW_ANGLE_DEGREES = 15.0


def _decode(file_bytes: bytes):
    array = np.frombuffer(file_bytes, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    return image


def _denoise(image):
    return cv2.fastNlMeansDenoisingColored(image, None, 10, 10, 7, 21)


def _normalize_contrast(image):
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_channel = clahe.apply(l_channel)
    merged = cv2.merge((l_channel, a_channel, b_channel))
    return cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)


def _deskew(image):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.bitwise_not(gray)
    thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]
    coords = np.column_stack(np.where(thresh > 0))
    if coords.shape[0] < 50:
        # Not enough foreground pixels to estimate a reliable skew angle.
        return image
    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle
    if abs(angle) < 0.1 or abs(angle) > MAX_DESKEW_ANGLE_DEGREES:
        # Skip near-zero (no-op) and implausibly large (likely a misdetection) corrections.
        return image
    h, w = image.shape[:2]
    center = (w // 2, h // 2)
    rotation_matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
    return cv2.warpAffine(
        image,
        rotation_matrix,
        (w, h),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )


def preprocess_image_bytes(file_bytes: bytes, mime_type: str = None) -> bytes:
    """Deskew, denoise, and contrast-normalize an image before OCR.

    Only applies to actual raster images -- PDFs and unrecognized/undecodable content
    pass through unchanged. Always returns valid bytes; never raises.
    """
    if not file_bytes:
        return file_bytes
    if mime_type == "application/pdf":
        return file_bytes
    try:
        image = _decode(file_bytes)
        if image is None:
            return file_bytes
        image = _denoise(image)
        image = _deskew(image)
        image = _normalize_contrast(image)
        success, encoded = cv2.imencode(".png", image)
        if not success:
            return file_bytes
        return encoded.tobytes()
    except Exception:
        return file_bytes
