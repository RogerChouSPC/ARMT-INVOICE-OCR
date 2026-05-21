"""Generic structured-OCR parser used for fully-scanned vendor invoices.

Each vendor's `parse()` here calls a vision-LLM with a vendor-specific JSON
prompt and converts the returned JSON to InvoiceRow records. Results are
cached on disk (see app.ocr_cache) so the API spend is paid once per PDF.

The prompts encode the per-vendor field-location rules from the original
`vercel/src/config/customers.ts` and any clarifications observed while
comparing against `data/Output.xlsx`.
"""

from __future__ import annotations

import json
import re

from app.ocr_cache import ocr_page_with_prompt_cached_sync
from app.parsers.common import round_half_up
from app.schema import InvoiceRow


# -- Generic JSON output shape ------------------------------------------------
# Every prompt below asks Gemini to emit this JSON shape per page:
#   {
#     "issuer_taxid": "<13-digit issuer tax id>",
#     "rows": [
#       {
#         "invoice_no": "...",
#         "invoice_date": "YYYY-MM-DD",
#         "due_date": "YYYY-MM-DD",
#         "vendor_customercode": "...",   # buyer's code at this vendor
#         "vendor_branch": "00000" | "00485" | ...,
#         "vendor_expensecode": "",
#         "description": "...",
#         "product_description": "...",
#         "amount": 12345.67,
#         "vat_7": 0,
#         "wht_pct": 0,       # actual rate (1, 2, 3, or 5; 0 if none)
#         "wht_amount": 0,
#         "netamount": 12345.67
#       },
#       ...
#     ]
#   }


def _parse_json_blob(text: str) -> dict:
    raw = text.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```\s*$", "", raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {}


def _row_from_json(j: dict, fallback_taxid: str) -> InvoiceRow:
    amount = float(j.get("amount") or 0)
    vat = float(j.get("vat_7") or 0)
    rate = int(j.get("wht_pct") or 0)
    wht = float(j.get("wht_amount") or 0)

    tax_pct = tax_2 = tax_3 = tax_5 = 0.0
    if wht > 0:
        if rate == 1:
            tax_pct = wht
        elif rate == 2:
            tax_2 = wht
        elif rate == 3:
            tax_3 = wht
        elif rate == 5:
            tax_5 = wht

    netamount = float(j.get("netamount") or 0)
    if netamount == 0:
        netamount = round_half_up(amount + vat - (tax_pct + tax_2 + tax_3 + tax_5), 2)

    return InvoiceRow(
        taxid=str(j.get("issuer_taxid") or fallback_taxid or ""),
        vendor_customercode=str(j.get("vendor_customercode") or ""),
        vendor_branch=str(j.get("vendor_branch") or ""),
        vendor_expensecode=str(j.get("vendor_expensecode") or ""),
        invoiceno=str(j.get("invoice_no") or ""),
        invoicedate=str(j.get("invoice_date") or ""),
        duedate=str(j.get("due_date") or ""),
        description=str(j.get("description") or ""),
        product_description=str(j.get("product_description") or ""),
        amount=amount,
        vat_7=vat,
        tax_pct=tax_pct,
        tax_2=tax_2,
        tax_3=tax_3,
        tax_5=tax_5,
        netamount=netamount,
    )


def run(prompt: str, *, tag: str, fallback_taxid: str,
        page_pngs: list[bytes] | None) -> list[InvoiceRow]:
    """OCR each page with the given prompt, parse JSON, return all rows."""
    if not page_pngs:
        return []
    rows: list[InvoiceRow] = []
    for i, png in enumerate(page_pngs):
        raw = ocr_page_with_prompt_cached_sync(png, prompt, tag=f"{tag}-p{i+1}")
        data = _parse_json_blob(raw)
        issuer = data.get("issuer_taxid") or fallback_taxid
        for j in data.get("rows", []):
            if "issuer_taxid" not in j and issuer:
                j["issuer_taxid"] = issuer
            rows.append(_row_from_json(j, fallback_taxid))
    return rows


# --- Prompt template factory -------------------------------------------------

BASE_INSTRUCTIONS = """You are extracting invoice line items from a Thai PDF page.
RETURN ONLY a JSON object (no markdown fences) with this shape:
{
  "issuer_taxid": "<13-digit tax id of the company that ISSUED this invoice — not 0107537001421 which is the buyer>",
  "rows": [
    {
      "invoice_no": "...",
      "invoice_date": "YYYY-MM-DD",
      "due_date": "YYYY-MM-DD",
      "vendor_customercode": "...",
      "vendor_branch": "00000",
      "vendor_expensecode": "",
      "description": "...",
      "product_description": "...",
      "amount": 12345.67,
      "vat_7": 0,
      "wht_pct": 0,
      "wht_amount": 0,
      "netamount": 12345.67
    }
  ]
}

Rules that apply to every invoice:
- One row per line item (multi-item invoices share invoice_no/date).
- Dates → YYYY-MM-DD. 4-digit year ≥ 2500 = Buddhist Era, subtract 543.
  2-digit year → prepend 20. English short month (e.g. 31-Mar-26 = 2026-03-31).
- Numbers must be JSON numbers (no commas, no currency).
- `wht_pct` = the printed rate (1, 2, 3, or 5). `wht_amount` = the printed amount.
  If no WHT is printed, set both to 0.
- `vendor_branch` = "00000" when the vendor is at สำนักงานใหญ่ / Head Office;
  otherwise the printed branch code (e.g. "00175", "00485"); never "Group" numbers.
- Use 0 for any missing numeric field.
- Use "" for any missing string field.
"""
