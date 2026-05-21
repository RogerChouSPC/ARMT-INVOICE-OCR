"""Pre-warm the OCR cache by running every sample PDF through Gemini once.

Run from python_app/:
    python -m app.warm_ocr

This burns the OpenRouter key one time (one Gemini call per page). After this
runs, all subsequent extractions use the cached text — zero API spend during
parser development.
"""

from __future__ import annotations

import asyncio
import io
import sys
from pathlib import Path

from app.ocr_cache import get_cached, put_cached
from app.detect import detect_vendor
from app.pdf_text import extract_text_layer, render_pages_as_pngs
from app.ocr import ocr_pages

REPO_ROOT = Path(__file__).resolve().parents[2]
SAMPLES_DIR = REPO_ROOT / "ARMT-INVOICE-OCR" / "data" / "sample_invoices"


async def warm() -> None:
    if sys.stdout.encoding and "utf" not in sys.stdout.encoding.lower():
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

    pdfs = sorted(SAMPLES_DIR.glob("*.pdf"))
    print(f"Found {len(pdfs)} PDFs in {SAMPLES_DIR}\n")

    # Identify which PDFs need OCR. Rules:
    #   - rule.extract_mode == 'ocr' → always OCR
    #   - rule.extract_mode == 'text' → check if all pages have a clean text layer
    #   - else → check is_digital
    needs_ocr = []
    for pdf_path in pdfs:
        data = pdf_path.read_bytes()
        text_result = extract_text_layer(data)
        rule = detect_vendor(text_result.text, pdf_path.name)
        if rule and rule.extract_mode == "text":
            # Even text-mode PDFs sometimes have pages with no text (LT pages 3-4).
            empty_pages = sum(
                1 for p in text_result.text.split("--- PAGE BREAK ---") if not p.strip()
            )
            if empty_pages:
                print(f"  {pdf_path.name:30} marker=mixed (text+OCR)  empty_pages={empty_pages}")
                needs_ocr.append(pdf_path)
            else:
                print(f"  {pdf_path.name:30} marker=text-only  (skip OCR)")
        elif rule and rule.extract_mode == "ocr":
            print(f"  {pdf_path.name:30} marker=OCR-required (mode=ocr)")
            needs_ocr.append(pdf_path)
        elif text_result.is_digital:
            print(f"  {pdf_path.name:30} marker=auto-text  (skip OCR)")
        else:
            print(f"  {pdf_path.name:30} marker=auto-OCR  (no text layer)")
            needs_ocr.append(pdf_path)

    print(f"\n{len(needs_ocr)} PDF(s) require OCR.\n")

    for pdf_path in needs_ocr:
        data = pdf_path.read_bytes()
        if get_cached(data) is not None:
            print(f"  [hit ] {pdf_path.name} — cached, skipping")
            continue
        print(f"  [miss] {pdf_path.name} — rasterising + OCRing…", flush=True)
        page_pngs = render_pages_as_pngs(data)
        try:
            text = await ocr_pages(page_pngs)
            put_cached(data, text)
            print(f"        → {len(text)} chars across {len(page_pngs)} page(s)")
        except Exception as e:
            print(f"        ✗ {e}")

    print("\nDone. Cache lives in python_app/ocr_cache/")


if __name__ == "__main__":
    asyncio.run(warm())
