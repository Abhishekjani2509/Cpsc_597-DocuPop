# OCR Worker

Python worker that consumes document processing jobs from the DocuPop API. Uses Tesseract OCR to extract text from images and PDFs, then intelligently maps extracted data to target table schemas.

## Features

- Processes images (PNG, JPG, TIFF, etc.) and PDFs
- Image preprocessing for improved OCR accuracy (grayscale, contrast, sharpening, denoising)
- High-resolution PDF rendering (300 DPI)
- Field extraction via label matching and field name inference
- Confidence scoring for extracted values
- Polling-based job processing with automatic retry

## Architecture

The worker:
1. Polls `/api/processing/jobs/next` for pending jobs
2. Downloads and processes documents locally with Tesseract
3. Extracts fields based on target table mappings
4. Reports results back to `/api/processing/jobs/{id}` with confidence scores

Results are automatically ingested into the specified data table.
