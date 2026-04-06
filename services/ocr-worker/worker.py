import os
import re
import time
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple

import pytesseract
try:
    import fitz  # PyMuPDF
except ModuleNotFoundError:
    import pymupdf as fitz  # Alternative import
from PIL import Image, ImageEnhance, ImageFilter
import requests
from dotenv import load_dotenv

load_dotenv()

API_BASE = os.environ.get("PROCESSING_API_BASE", "http://localhost:3000/api")
WORKER_TOKEN = os.environ.get("PROCESSING_WORKER_TOKEN", "dev-worker-token")
POLL_INTERVAL = float(os.environ.get("PROCESSING_POLL_INTERVAL", "5"))
TESSERACT_CMD = os.environ.get("TESSERACT_CMD")
DOCUMENT_NAME_FIELD = "DocumentName"

if TESSERACT_CMD:
  pytesseract.pytesseract.tesseract_cmd = TESSERACT_CMD

SESSION = requests.Session()
SESSION.headers.update({"x-worker-token": WORKER_TOKEN})


def fetch_job() -> Optional[dict]:
  response = SESSION.post(f"{API_BASE}/processing/jobs/next")
  response.raise_for_status()
  payload = response.json()
  return payload.get("job")


def complete_job(job_id: str, result: dict, confidence: float = 0.5):
  response = SESSION.post(
    f"{API_BASE}/processing/jobs/{job_id}",
    json={"status": "completed", "result": result, "confidence": confidence},
  )
  response.raise_for_status()


def fail_job(job_id: str, error: str):
  response = SESSION.post(
    f"{API_BASE}/processing/jobs/{job_id}",
    json={"status": "failed", "error": error},
  )
  response.raise_for_status()


def preprocess_image(image: Image.Image) -> Image.Image:
  """
  Preprocess image to improve OCR accuracy.
  Applies: grayscale conversion, contrast enhancement, sharpening, and noise reduction.
  """
  # Convert to grayscale
  if image.mode != 'L':
    image = image.convert('L')

  # Increase resolution if image is small (improves OCR accuracy)
  width, height = image.size
  if width < 2000 or height < 2000:
    scale_factor = max(2000 / width, 2000 / height)
    new_size = (int(width * scale_factor), int(height * scale_factor))
    image = image.resize(new_size, Image.Resampling.LANCZOS)

  # Enhance contrast
  enhancer = ImageEnhance.Contrast(image)
  image = enhancer.enhance(1.5)

  # Enhance sharpness
  enhancer = ImageEnhance.Sharpness(image)
  image = enhancer.enhance(1.3)

  # Apply slight denoising
  image = image.filter(ImageFilter.MedianFilter(size=3))

  return image


def extract_text(file_path: str) -> str:
  """
  Extract text from image or PDF with preprocessing for better accuracy.
  Uses enhanced Tesseract config: PSM 3 (auto page segmentation) and OEM 3 (LSTM neural net).
  """
  # Tesseract config for better accuracy
  custom_config = r'--oem 3 --psm 3'

  suffix = Path(file_path).suffix.lower()
  if suffix in [".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".gif"]:
    image = Image.open(file_path)
    image = preprocess_image(image)
    return pytesseract.image_to_string(image, config=custom_config)

  if suffix == ".pdf":
    doc = fitz.open(file_path)
    text = []
    for page in doc:
      # Render at higher DPI for better quality (default is 72, using 300)
      pix = page.get_pixmap(dpi=300)
      img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
      img = preprocess_image(img)
      text.append(pytesseract.image_to_string(img, config=custom_config))
    doc.close()
    return "\n".join(text)

  try:
    image = Image.open(file_path)
    image = preprocess_image(image)
    return pytesseract.image_to_string(image, config=custom_config)
  except Exception:
    with open(file_path, "rb") as f:
      data = f.read()
    return data.decode("utf-8", errors="ignore")


def normalize(value: str) -> str:
  return re.sub(r"[^a-z0-9]", "", value.lower())


def extract_value_by_label(text: str, label: str) -> Tuple[str, float]:
  if not label:
    return "", 0.0

  pattern = re.compile(rf"{re.escape(label)}[:\-]?\s*(.+)", re.IGNORECASE)
  for line in text.splitlines():
    match = pattern.search(line)
    if match:
      return match.group(1).strip(), 0.95

  return "", 0.0


FIELD_HINTS = {
  "total": re.compile(r"total[^0-9]*([\d.,]+)", re.IGNORECASE),
  "amount": re.compile(r"amount[^0-9]*([\d.,]+)", re.IGNORECASE),
  "invoice": re.compile(r"invoice(?:\s*#|\s*no\.?)?\s*([A-Za-z0-9\-]+)", re.IGNORECASE),
  "company": re.compile(r"company[:\s\-]+([A-Za-z0-9 &]+)", re.IGNORECASE),
  "name": re.compile(r"name[:\s\-]+([A-Za-z0-9 &]+)", re.IGNORECASE),
}


def infer_by_field_name(text: str, field_name: str) -> Tuple[str, float]:
  normalized = normalize(field_name)
  for key, pattern in FIELD_HINTS.items():
    if key in normalized:
      match = pattern.search(text)
      if match:
        return match.group(1).strip(), 0.7
  return "", 0.0


def build_field_entry(value: str, confidence: float) -> Dict[str, Any]:
  return {
    "value": value,
    "confidence": confidence,
  }


def infer_fields(text: str, target_table: Optional[dict], document_name: str) -> Dict[str, Any]:
  fields: Dict[str, Any] = {}
  mappings = target_table.get("mappings") if target_table else []

  for mapping in mappings or []:
    value, confidence = extract_value_by_label(text, mapping.get("source_label", ""))
    if value:
      fields[mapping["target_field"]] = build_field_entry(value, confidence)

  table_fields = target_table.get("fields") if target_table else []
  for field in table_fields or []:
    name = field["name"]
    if name in fields:
      continue
    value, confidence = infer_by_field_name(text, name)
    if value:
      fields[name] = build_field_entry(value, confidence)

  fields[DOCUMENT_NAME_FIELD] = build_field_entry(document_name, 1.0)
  return fields


def run_ocr(job: dict) -> dict:
  file_path = job["file_path"]
  target_table = job.get("target_table") or {}
  document_name = job.get("document", {}).get("filename") or Path(file_path).name

  text = extract_text(file_path)
  fields = infer_fields(text, target_table, document_name)
  rows: List[Dict[str, Any]] = [fields] if fields else []

  confidences = [cell.get("confidence", 0) for cell in fields.values() if isinstance(cell, dict)]
  overall_conf = sum(confidences) / len(confidences) if confidences else 0.5

  return {
    "text": text,
    "fields": fields,
    "rows": rows,
    "metadata": {
      "field_count": len(fields),
    },
    "confidence": overall_conf,
  }


def main():
  print("Worker started. Polling for jobs...")
  while True:
    try:
      job = fetch_job()
      if not job:
        time.sleep(POLL_INTERVAL)
        continue

      document_name = job.get("document", {}).get("filename", "document")
      print(f"Processing job {job['id']} for document {document_name}")
      try:
        result = run_ocr(job)
        confidence = result.get("confidence", 0.5)
        complete_job(job["id"], result, confidence=confidence)
        print(f"Job {job['id']} completed with confidence {confidence:.2f}")
      except Exception as exc:
        print(f"Job {job['id']} failed: {exc}")
        fail_job(job["id"], str(exc))
    except requests.HTTPError as http_error:
      print(f"Worker HTTP error: {http_error.response.text}")
      time.sleep(POLL_INTERVAL)
    except Exception as exc:
      print(f"Worker error: {exc}")
      time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
  main()