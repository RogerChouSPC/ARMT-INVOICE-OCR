"""On-disk OCR result cache.

The cache key is a SHA-256 of (pdf bytes + model name). Storing only the
hash lets us reuse OCR text across runs and across renames of the source
file. This dramatically cuts cost during parser iteration — we OCR each
sample PDF once, then re-run the parser thousands of times for free.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
from pathlib import Path

from app.ocr import ocr_pages


CACHE_DIR = Path(__file__).resolve().parent.parent / "ocr_cache"


def _cache_path(pdf_bytes: bytes, model: str) -> Path:
    h = hashlib.sha256()
    h.update(pdf_bytes)
    h.update(b"\x00" + model.encode("utf-8"))
    return CACHE_DIR / f"{h.hexdigest()}.txt"


def get_cached(pdf_bytes: bytes, model: str | None = None) -> str | None:
    model = model or os.environ.get("OPENROUTER_MODEL", "google/gemini-2.5-flash")
    p = _cache_path(pdf_bytes, model)
    if p.exists():
        return p.read_text(encoding="utf-8")
    return None


def put_cached(pdf_bytes: bytes, text: str, model: str | None = None) -> None:
    model = model or os.environ.get("OPENROUTER_MODEL", "google/gemini-2.5-flash")
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    _cache_path(pdf_bytes, model).write_text(text, encoding="utf-8")


async def ocr_pdf_pages_cached(
    pdf_bytes: bytes,
    page_pngs: list[bytes],
    api_key: str | None = None,
) -> str:
    """OCR a PDF's pages with caching. Returns combined page text (with
    '--- PAGE BREAK ---' separators), reading from cache if present.

    Pass `page_pngs` (already rasterised) so we don't pay rasterisation cost
    on a cache hit either.
    """
    model = os.environ.get("OPENROUTER_MODEL", "google/gemini-2.5-flash")
    cached = get_cached(pdf_bytes, model)
    if cached is not None:
        return cached
    text = await ocr_pages(page_pngs, api_key=api_key)
    put_cached(pdf_bytes, text, model)
    return text


def ocr_pdf_pages_cached_sync(pdf_bytes: bytes, page_pngs: list[bytes]) -> str:
    """Sync wrapper for non-async call sites (CLI / FastAPI sync endpoints)."""
    return asyncio.run(ocr_pdf_pages_cached(pdf_bytes, page_pngs))


async def ocr_page_with_prompt_cached(
    page_png: bytes, prompt: str, *, tag: str,
) -> str:
    """Same caching pattern as the plain OCR call, but keys also on the prompt
    via `tag` (a short identifier like 'lt-creditnote-json'). Use for vendor
    pages that need a structured / table-aware prompt.
    """
    import hashlib
    from app.ocr import ocr_page_with_prompt
    model = os.environ.get("OPENROUTER_MODEL", "google/gemini-2.5-flash")
    h = hashlib.sha256()
    h.update(page_png)
    h.update(b"\x00" + tag.encode())
    h.update(b"\x00" + prompt.encode())
    h.update(b"\x00" + model.encode())
    path = CACHE_DIR / f"{h.hexdigest()}.{tag}.txt"
    if path.exists():
        return path.read_text(encoding="utf-8")
    text = await ocr_page_with_prompt(page_png, prompt)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return text


def ocr_page_with_prompt_cached_sync(page_png: bytes, prompt: str, *, tag: str) -> str:
    return asyncio.run(ocr_page_with_prompt_cached(page_png, prompt, tag=tag))
