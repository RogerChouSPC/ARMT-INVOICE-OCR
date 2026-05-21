"""Top-level extraction: PDF bytes → list[InvoiceRow].

Pipeline per file:
  1. Try the PDF text layer.
  2. If the layer is clean, route to a Python parser by detected vendor.
  3. Otherwise (broken font or scanned), OCR every page via Gemini (cached),
     then run the per-vendor parser on the OCR text.
  4. After parsing, fill customergroup/customercode from the Customer Master.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.customer_master import CustomerMasterEntry, lookup
from app.detect import VendorRule, detect_vendor
from app.ocr_cache import ocr_pdf_pages_cached_sync
from app.parsers import get_parser
from app.pdf_text import extract_text_layer, render_pages_as_pngs
from app.schema import InvoiceRow


@dataclass
class ExtractResult:
    rows: list[InvoiceRow]
    vendor_id: str
    page_count: int
    used_ocr: bool
    warnings: list[str]


def extract_pdf(
    pdf_bytes: bytes,
    filename: str,
    master: list[CustomerMasterEntry],
) -> ExtractResult:
    """Run the full pipeline on one PDF and return the parsed rows."""
    warnings: list[str] = []
    pdf_text = extract_text_layer(pdf_bytes)

    rule = detect_vendor(pdf_text.text, filename)
    vendor_id = rule.id if rule else ""

    # Decide whether to OCR.
    use_ocr = _should_use_ocr(rule, pdf_text.is_digital)
    text = pdf_text.text

    if use_ocr:
        # Rasterise pages → Gemini vision OCR (cached by SHA-256 of PDF bytes).
        try:
            page_pngs = render_pages_as_pngs(pdf_bytes)
            text = ocr_pdf_pages_cached_sync(pdf_bytes, page_pngs)
        except Exception as e:
            warnings.append(f"OCR failed for {filename}: {e}")
            return ExtractResult(rows=[], vendor_id=vendor_id, page_count=pdf_text.page_count,
                                 used_ocr=True, warnings=warnings)

    # LT (Lotus) is a special hybrid: pages 1-2 have a text layer, pages 3-4 don't.
    # We re-OCR every page anyway when ANY page is missing text — simpler and
    # consistent. The cache makes the cost a one-time event per PDF.
    if rule and rule.id == "LT" and not use_ocr:
        # Check whether the text-layer extraction lost any pages.
        if any(not p.strip() for p in text.split("--- PAGE BREAK ---")):
            try:
                page_pngs = render_pages_as_pngs(pdf_bytes)
                text = ocr_pdf_pages_cached_sync(pdf_bytes, page_pngs)
                use_ocr = True
            except Exception as e:
                warnings.append(f"LT partial-OCR failed for {filename}: {e}")

    if not rule:
        warnings.append(f"No vendor matched for '{filename}'.")
        return ExtractResult(rows=[], vendor_id="", page_count=pdf_text.page_count,
                             used_ocr=use_ocr, warnings=warnings)

    parser = get_parser(rule.id)
    if not parser:
        warnings.append(
            f"Vendor {rule.id} detected but no Python parser implemented yet."
        )
        return ExtractResult(rows=[], vendor_id=rule.id, page_count=pdf_text.page_count,
                             used_ocr=use_ocr, warnings=warnings)

    # Some parsers (LT credit-note page, CP All multi-row table) need to
    # re-OCR a specific page with a structured prompt — pre-render once and
    # pass through. CP All uses higher DPI because its line-item table is
    # dense and 200 DPI loses some rows.
    page_pngs_for_parser: list[bytes] | None = None
    if rule.id in {"LT", "CP_ALL"}:
        try:
            dpi = 300 if rule.id == "CP_ALL" else 200
            page_pngs_for_parser = render_pages_as_pngs(pdf_bytes, dpi=dpi)
        except Exception:
            page_pngs_for_parser = None

    rows = parser(text, filename, page_pngs=page_pngs_for_parser)
    rows = [_fill_master_fields(r, master) for r in rows]
    return ExtractResult(rows=rows, vendor_id=rule.id, page_count=pdf_text.page_count,
                         used_ocr=use_ocr, warnings=warnings)


def _should_use_ocr(rule: VendorRule | None, auto_is_digital: bool) -> bool:
    if rule is None:
        return not auto_is_digital
    if rule.extract_mode == "ocr":
        return True
    if rule.extract_mode == "text":
        return False
    return not auto_is_digital  # 'auto'


def _fill_master_fields(row: InvoiceRow, master: list[CustomerMasterEntry]) -> InvoiceRow:
    """Look up customergroup/customercode by taxid (+ vendor_branch refinement).

    If the parser has already populated these fields (e.g. because it had richer
    issuer-text context to disambiguate two master rows sharing the same
    branch), we leave its choice alone.
    """
    if row.customergroup and row.customercode:
        return row
    if not row.taxid:
        return row
    branch_hint = ""
    if row.vendor_branch and row.vendor_branch != "00000":
        branch_hint = f"สาขาที่{row.vendor_branch}"
    entry = lookup(master, row.taxid, branch_hint=branch_hint)
    if entry:
        row.customergroup = entry.customergroup
        row.customercode = entry.customercode
    return row
