"""Gemini OCR via OpenRouter.

Only used for invoices whose PDF has no usable text layer (scanned PDFs and
PDFs with broken-CID font encoding). One API call per page; pages are issued
concurrently with httpx.AsyncClient.
"""

from __future__ import annotations

import asyncio
import base64
import os

import httpx


OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "google/gemini-2.5-flash"
OCR_PROMPT = (
    "Extract ALL text from this invoice image exactly as it appears. Include every "
    "word, number, date, barcode, and special character. Preserve structure and "
    "line breaks. Output only the raw extracted text."
)


class OCRError(RuntimeError):
    pass


async def ocr_page(page_png: bytes, api_key: str, model: str = DEFAULT_MODEL) -> str:
    """OCR a single page PNG, returns the extracted text."""
    image_b64 = base64.b64encode(page_png).decode("ascii")
    async with httpx.AsyncClient(timeout=90.0) as client:
        res = await client.post(
            OPENROUTER_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "temperature": 0,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "image_url",
                         "image_url": {"url": f"data:image/png;base64,{image_b64}"}},
                        {"type": "text", "text": OCR_PROMPT},
                    ],
                }],
            },
        )
    if res.status_code == 429:
        raise OCRError("OpenRouter quota exceeded (429).")
    if res.status_code != 200:
        raise OCRError(f"OpenRouter {res.status_code}: {res.text[:300]}")
    body = res.json()
    return body["choices"][0]["message"]["content"] or ""


async def ocr_pages(pages: list[bytes], api_key: str | None = None) -> str:
    """OCR a list of page PNGs concurrently and join with page-break markers."""
    api_key = api_key or os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise OCRError(
            "OPENROUTER_API_KEY is not set. Add it to python_app/.env or the env."
        )
    tasks = [ocr_page(p, api_key) for p in pages]
    texts = await asyncio.gather(*tasks)
    return "\n\n--- PAGE BREAK ---\n\n".join(texts)


async def ocr_page_with_prompt(
    page_png: bytes, prompt: str, api_key: str | None = None,
    model: str | None = None,
) -> str:
    """OCR a single page with a custom prompt — used for tabular pages where
    we need Gemini to return JSON instead of raw text.
    """
    api_key = api_key or os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise OCRError("OPENROUTER_API_KEY is not set.")
    model = model or os.environ.get("OPENROUTER_MODEL", DEFAULT_MODEL)
    image_b64 = base64.b64encode(page_png).decode("ascii")
    async with httpx.AsyncClient(timeout=120.0) as client:
        res = await client.post(
            OPENROUTER_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "temperature": 0,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "image_url",
                         "image_url": {"url": f"data:image/png;base64,{image_b64}"}},
                        {"type": "text", "text": prompt},
                    ],
                }],
            },
        )
    if res.status_code != 200:
        raise OCRError(f"OpenRouter {res.status_code}: {res.text[:300]}")
    return res.json()["choices"][0]["message"]["content"] or ""
