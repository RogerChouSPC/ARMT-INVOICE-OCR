"""Helper: dump cached OCR text per vendor for inspection.

Usage:
    python -m app.dump_ocr CFM CFR CMK   # restrict
    python -m app.dump_ocr ALL           # all vendors
"""

from __future__ import annotations

import io
import sys
from pathlib import Path

from app.detect import detect_vendor
from app.ocr_cache import get_cached
from app.pdf_text import extract_text_layer

REPO_ROOT = Path(__file__).resolve().parents[2]
SAMPLES_DIR = REPO_ROOT / "ARMT-INVOICE-OCR" / "data" / "sample_invoices"


def main(argv: list[str]) -> int:
    if sys.stdout.encoding and "utf" not in sys.stdout.encoding.lower():
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

    want = set(arg.upper() for arg in argv) if argv else {"ALL"}
    for pdf in sorted(SAMPLES_DIR.glob("*.pdf")):
        data = pdf.read_bytes()
        text = extract_text_layer(data)
        rule = detect_vendor(text.text, pdf.name)
        vid = rule.id if rule else "(unknown)"
        if "ALL" not in want and vid not in want:
            continue
        cached = get_cached(data)
        chosen = cached if cached is not None else text.text
        print(f"\n======== {pdf.name} | vendor={vid} | source={'OCR' if cached else 'TEXT'} ========\n")
        print(chosen)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
