"""Read text from a PDF file.

Two paths:
  - extract_text_layer(): returns text directly from pdfplumber's text layer
    plus a flag indicating whether the layer is usable. We treat large amounts
    of '(cid:NNN)' tokens (a sign of broken font encoding) as unusable so the
    caller can fall back to OCR.
  - render_pages_as_pngs(): rasterise pages for OCR.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path

import pdfplumber


@dataclass
class PdfText:
    text: str
    page_count: int
    is_digital: bool  # True if the text layer is clean enough to parse without OCR


def _is_text_clean(text: str) -> bool:
    """Heuristic: text layer is unusable when there's barely any text OR when
    >5% of chars are inside '(cid:...)' (broken-font encoding marker)."""
    stripped = (text or "").strip()
    # Require at least 50 chars of real content per PDF to be considered
    # 'digital'. Pages with only a few stray bytes (e.g. an embedded form)
    # should fall through to OCR.
    if len(stripped) < 50:
        return False
    cid_chars = sum(len(m) for m in __import__("re").findall(r"\(cid:\d+\)", text))
    return cid_chars / max(len(text), 1) < 0.05


def extract_text_layer(pdf_bytes_or_path: bytes | str | Path) -> PdfText:
    """Open a PDF (bytes or path) and return its text layer."""
    if isinstance(pdf_bytes_or_path, (bytes, bytearray)):
        source = io.BytesIO(pdf_bytes_or_path)
    else:
        source = str(pdf_bytes_or_path)

    pages_text: list[str] = []
    with pdfplumber.open(source) as pdf:
        for page in pdf.pages:
            pages_text.append(page.extract_text() or "")
    combined = "\n\n--- PAGE BREAK ---\n\n".join(pages_text)
    return PdfText(
        text=combined,
        page_count=len(pages_text),
        is_digital=_is_text_clean(combined),
    )


def render_pages_as_pngs(
    pdf_bytes_or_path: bytes | str | Path,
    dpi: int = 200,
) -> list[bytes]:
    """Rasterise each page to PNG bytes for OCR."""
    import pypdfium2 as pdfium

    if isinstance(pdf_bytes_or_path, (bytes, bytearray)):
        pdf = pdfium.PdfDocument(pdf_bytes_or_path)
    else:
        pdf = pdfium.PdfDocument(str(pdf_bytes_or_path))

    out: list[bytes] = []
    scale = dpi / 72
    for i in range(len(pdf)):
        page = pdf[i]
        pil_image = page.render(scale=scale).to_pil()
        buf = io.BytesIO()
        pil_image.save(buf, format="PNG")
        out.append(buf.getvalue())
    return out
