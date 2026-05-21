"""Parser for Lotus / CP Axtra (LT) invoices.

LT_Invoice.pdf has three different page formats; the parser dispatches by
content keywords:

  Type A — ใบแจ้งหนี้ single-item invoice (pages 1-2 in the sample).
           Fields: 'Invoice Number / Date / Due Date', 'Customer Site: TH<code>',
           one item line, totals.

  Type B — ใบเสร็จรับเงิน receipt (page 3). The receipt itself isn't a billed
           invoice; instead it references one invoice via the line item
           'A260310890 03-APR-26 CIS DCI Discount …' with a printed WHT.

  Type C — Credit Note Compensate Confirmation Report (page 4): one invoice
           number (e.g. C260302507CN3) with multiple JN-coded line items. Each
           item becomes its own row in the output.
"""

from __future__ import annotations

import json
import re

from app.parsers.common import collapse_spaces, parse_thai_date, round_half_up
from app.schema import InvoiceRow


# Prompt used for the credit-note multi-row table. The default OCR pass
# column-shuffles this layout, so we re-OCR just this page with a JSON
# instruction so Gemini emits rows in table order.
CREDIT_NOTE_PROMPT = """This invoice page contains a Thai credit-note table from CP Axtra (Lotus).
Extract every line item in TABLE ROW order — top to bottom, left to right within each row.

Output a JSON object only (no markdown fences) with this exact shape:
{
  "invoice_no": "C260302507CN3",
  "invoice_date": "YYYY-MM-DD",
  "vendor_no": "91644",
  "items": [
    {
      "deal_no": "...",
      "section": "...",
      "jn_code": "JN01",
      "jn_description": "ส่วนลดในการร่วมกันสนับสนุนการขาย-โปรโมชั่น",
      "product_code": "260300001585",
      "date_range": "29/01/2026-25/02/2026",
      "product_description": "(H + S) TAB WK 05 - 08 Y2026_DG FIGHT STAIN REMOVER 800 ML. REFILL",
      "amount": 234208.00,
      "vat": 0.00
    }
  ]
}

Rules:
- Read every line item — there are typically 7 in this table.
- Preserve product descriptions exactly as printed, including spaces and capitalisation.
- `jn_code` is JN01 for items under "ส่วนลดในการร่วมกันสนับสนุนการขาย-โปรโมชั่น", JN02 for items under "ส่วนลดในการร่วมกันสนับสนุนการขาย-คูปอง".
- `amount` and `vat` are numbers (no commas).
- Do not omit any item. If unsure, return the best reading."""


# Always 00175 for LT (sample); kept dynamic via regex.
BRANCH_RE = re.compile(r"สาขาที่\s*:?\s*(\d{4,6})")
# Gemini OCR sometimes emits 'จำ' as 'จํา' (NIKHAHIT + SARA AA) — accept either.
ISSUER_TAXID_RE = re.compile(r"เลขประจ(?:ำ|ํา)ตัวผู้เสียภาษี\s*:?\s*(\d{13})")

# Type A patterns
INVOICE_NO_A_RE = re.compile(r"Invoice Number\s*:\s*(\S+)")
INVOICE_DATE_A_RE = re.compile(r"Invoice Date\s*:\s*(\d{1,2}-[A-Za-z]{3}-\d{2,4})")
DUE_DATE_A_RE = re.compile(r"Due Date\s*:\s*(\d{1,2}-[A-Za-z]{3}-\d{2,4})")
CUSTOMER_SITE_A_RE = re.compile(r"Customer Site\s*:\s*TH(\d{3,7})")
# Standalone "ภาษีมูลค่าเพิ่ม" header on its own line (NOT preceded by 'ไม่เสีย'
# or 'ที่มี', which are the "no-VAT amount" and "with-VAT amount" totals).
VAT_A_RE = re.compile(r"(?:^|\n)ภาษีมูลค่าเพิ่ม\s+([\d,]+\.\d{2})")
NO_VAT_AMOUNT_A_RE = re.compile(r"จำนวนเงินที่ไม่เสียภาษีมูลค่าเพิ่ม\s+([\d,]+\.\d{2})")
HAS_VAT_AMOUNT_A_RE = re.compile(r"จำนวนเงินที่มีภาษีมูลค่าเพิ่ม\s+([\d,]+\.\d{2})")
# Item description on Type A: first numbered line. OCR splits the row across
# many lines — the item description is on the line following the leading '1'.
TOTAL_A_RE = re.compile(r"ยอดรวมทั้งสิ้น\s+([\d,]+\.\d{2})")

# Type B (receipt) patterns
RECEIPT_LINE_RE = re.compile(
    r"^(\d+)\s+([A-Z]\d+\w*)\s+(\d{1,2}-[A-Za-z]{3}-\d{2,4})\s+(.+?)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$",
    re.MULTILINE,
)
# Gemini OCR sometimes emits 'จำ' as 'จํา' (NIKHAHIT+SARA AA) — match either via
# the SARA-AM-or-equivalent class. The trailing 'บาท' anchor distinguishes the
# real WHT amount from a header line of the same phrase.
RECEIPT_WHT_RE = re.compile(r"ภาษีหัก\s*ณ\s*ที่จ่าย\s+([\d,]+\.\d{2})\s*บาท")
RECEIPT_SITE_RE = re.compile(r"รหัสลูกค้า\s*\(Site\)\s*:\s*TH(\d{3,7})")
RECEIPT_VAT_RE = re.compile(r"บวก ภาษีมูลค่าเพิ่ม.*?([\d,]+\.\d{2})", re.DOTALL)

# Type C (Credit Note) patterns
CN_INVOICE_NO_RE = re.compile(r"\b([A-Z]\d{9}[A-Z]+\d?)\b")
CN_DATE_THAI_RE = re.compile(r"วันที่\s+(\d{1,2}\s+\S+\s+\d{4})")
CN_VENDOR_NO_RE = re.compile(r"VENDOR\s+NO\s+(\d+)")
# Each item is: a long product code at line start (e.g. 260300001585) +
# date range + product description, followed somewhere by an amount line.
CN_PRODUCT_RE = re.compile(
    r"^(\d{12})\s+(\d{1,2}/\d{1,2}/\d{4}-\d{1,2}/\d{1,2}/\d{4})\s+(.+?)$",
    re.MULTILINE,
)
# Amount lines on CN page: "<amount> 0.00" (amount + VAT)
CN_AMOUNT_RE = re.compile(r"^([\d,]+\.\d{2})\s+0\.00\s*$", re.MULTILINE)
CN_JN_HEADER_RE = re.compile(r"^(JN\d{2})\s+(.+?)$", re.MULTILINE)


THAI_TO_ISO_MONTHS = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}


def _parse_lt_date(s: str) -> str:
    """LT prints dates like '31-Mar-26'. Treat 2-digit year as 20YY."""
    m = re.fullmatch(r"(\d{1,2})-([A-Za-z]{3})-(\d{2,4})", s.strip())
    if not m:
        return parse_thai_date(s)
    d = int(m.group(1))
    mo = THAI_TO_ISO_MONTHS.get(m.group(2).upper(), 0)
    y = int(m.group(3))
    if y < 100:
        y += 2000
    elif y >= 2500:
        y -= 543
    if not mo:
        return ""
    return f"{y:04d}-{mo:02d}-{d:02d}"


def _split_pages(text: str) -> list[str]:
    return text.split("--- PAGE BREAK ---")


def _detect_page_type(page: str) -> str:
    # Order matters: pages 1-2 and 3-4 share boilerplate footers. Distinguish
    # by markers that ONLY appear on the relevant page type:
    #   C: 'TOTAL VENDOR' / 'CREDIT NOTE COMPENSATE' (the multi-item credit note)
    #   A: English 'Invoice Number:' + 'Customer Site:' (simple invoice)
    #   B: Thai 'รหัสลูกค้า (Site)' (the receipt page references our company that way)
    if "TOTAL VENDOR" in page or "CREDIT NOTE COMPENSATE" in page.upper():
        return "C"
    if "Invoice Number" in page and "Customer Site" in page:
        return "A"
    if "รหัสลูกค้า (Site)" in page or "(Site):" in page:
        return "B"
    return ""


# LT and Makro share issuer taxid 0107567000414. We pre-fill the LT customer
# group and code directly so the Customer Master lookup doesn't accidentally
# return the Makro entry.
LT_CUSTOMERGROUP = "05 - โลตัส"
LT_CUSTOMERCODE = "0118866 - บริษัท ซีพี แอ็กซ์ตร้า จำกัด (มหาชน) สำนักงานใหญ่"


def _parse_type_a(page: str) -> InvoiceRow | None:
    inv_m = INVOICE_NO_A_RE.search(page)
    if not inv_m:
        return None

    inv_no = inv_m.group(1).strip()
    inv_date = ""
    due_date = ""
    if (m := INVOICE_DATE_A_RE.search(page)):
        inv_date = _parse_lt_date(m.group(1))
    if (m := DUE_DATE_A_RE.search(page)):
        due_date = _parse_lt_date(m.group(1))

    site_m = CUSTOMER_SITE_A_RE.search(page)
    vendor_customercode = site_m.group(1) if site_m else ""

    # Issuer taxid: prefer LT's 0107567000414.
    issuer_taxid = ""
    for m in ISSUER_TAXID_RE.finditer(page):
        if m.group(1) != "0107537001421":
            issuer_taxid = m.group(1)
            break

    # Branch
    branch = ""
    for m in BRANCH_RE.finditer(page):
        if m.group(1) != "0107537001421":
            branch = m.group(1)
            break

    # Amounts
    amount = 0.0
    if (m := NO_VAT_AMOUNT_A_RE.search(page)):
        v = float(m.group(1).replace(",", ""))
        if v > 0:
            amount = v
    if amount == 0 and (m := HAS_VAT_AMOUNT_A_RE.search(page)):
        v = float(m.group(1).replace(",", ""))
        if v > 0:
            amount = v
    # Fallback: total minus VAT
    vat = 0.0
    if (m := VAT_A_RE.search(page)):
        vat = float(m.group(1).replace(",", ""))
    if amount == 0 and (m := TOTAL_A_RE.search(page)):
        amount = float(m.group(1).replace(",", "")) - vat

    # Description: line that contains 'ค่า' (typical LT service line), or
    # immediately after a standalone '1' line. Heuristic search:
    description = ""
    lines = [ln.strip() for ln in page.split("\n")]
    for i, ln in enumerate(lines):
        if ln == "1" and i + 1 < len(lines) and lines[i + 1] and not lines[i + 1].isdigit():
            description = lines[i + 1]
            break
    if not description:
        for ln in lines:
            if "ค่า" in ln and not ln.startswith("จำนวน") and not ln.startswith("ภาษี"):
                description = ln
                break

    # WHT: LT pages 1-2 don't print explicit WHT. Convention from gold:
    #   - rental items (ค่าเช่า) → 5% WHT but gold filed under TAX 3%
    #   - everything else → 3% WHT
    wht_rate = 0.05 if "ค่าเช่า" in description else 0.03
    tax_3 = round_half_up(amount * wht_rate, 2)

    netamount = round(amount + vat - tax_3, 2)

    return InvoiceRow(
        customergroup=LT_CUSTOMERGROUP,
        customercode=LT_CUSTOMERCODE,
        taxid=issuer_taxid,
        vendor_customercode=vendor_customercode,
        vendor_branch=branch,
        invoiceno=inv_no,
        invoicedate=inv_date,
        duedate=due_date,
        description=description,
        product_description="",
        amount=amount,
        vat_7=vat,
        tax_pct=0,
        tax_2=0,
        tax_3=tax_3,
        tax_5=0,
        netamount=netamount,
    )


def _parse_type_b(page: str) -> InvoiceRow | None:
    """Receipt page — pull the embedded invoice reference."""
    line_m = RECEIPT_LINE_RE.search(page)
    if not line_m:
        return None
    inv_no = line_m.group(2)
    inv_date = _parse_lt_date(line_m.group(3))
    description = collapse_spaces(line_m.group(4))
    amount = float(line_m.group(5).replace(",", ""))

    issuer_taxid = ""
    for m in ISSUER_TAXID_RE.finditer(page):
        if m.group(1) != "0107537001421":
            issuer_taxid = m.group(1)
            break

    branch = ""
    for m in BRANCH_RE.finditer(page):
        if m.group(1) != "0107537001421":
            branch = m.group(1)
            break

    site_m = RECEIPT_SITE_RE.search(page)
    vendor_customercode = site_m.group(1) if site_m else ""

    vat = 0.0
    if (m := RECEIPT_VAT_RE.search(page)):
        vat = float(m.group(1).replace(",", ""))

    wht_m = RECEIPT_WHT_RE.search(page)
    tax_3 = float(wht_m.group(1).replace(",", "")) if wht_m else round_half_up(amount * 0.03, 2)

    netamount = round(amount + vat - tax_3, 2)

    return InvoiceRow(
        customergroup=LT_CUSTOMERGROUP,
        customercode=LT_CUSTOMERCODE,
        taxid=issuer_taxid,
        vendor_customercode=vendor_customercode,
        vendor_branch=branch,
        invoiceno=inv_no,
        invoicedate=inv_date,
        duedate="",
        description=description,
        product_description="",
        amount=amount,
        vat_7=vat,
        tax_pct=0,
        tax_2=0,
        tax_3=tax_3,
        tax_5=0,
        netamount=netamount,
    )


def _parse_type_c_from_json(json_text: str) -> list[InvoiceRow]:
    """Parse the credit-note table from structured JSON returned by a
    table-aware OCR re-pass. The plain OCR for this page column-shuffles the
    rows, so we re-issue with a JSON-format prompt and parse that here.
    """
    raw = json_text.strip()
    # Strip code fences if Gemini emitted them
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```\s*$", "", raw)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []

    inv_no = data.get("invoice_no", "")
    inv_date = data.get("invoice_date", "")
    vendor_customercode = data.get("vendor_no", "")
    issuer_taxid = "0107567000414"
    branch = "00175"

    rows: list[InvoiceRow] = []
    for item in data.get("items", []):
        amt = float(item.get("amount", 0) or 0)
        vat = float(item.get("vat", 0) or 0)
        jn_id = item.get("jn_code", "") or ""
        jn_desc = item.get("jn_description", "") or ""
        code = item.get("product_code", "") or ""
        date_range = item.get("date_range", "") or ""
        desc = item.get("product_description", "") or ""

        description = f"{jn_id} {jn_desc}".strip()
        product_description = f"{code} {date_range} {desc}".strip()
        tax_3 = round_half_up(amt * 0.03, 2)
        net = round_half_up(amt + vat - tax_3, 2)
        rows.append(InvoiceRow(
            customergroup=LT_CUSTOMERGROUP,
            customercode=LT_CUSTOMERCODE,
            taxid=issuer_taxid,
            vendor_customercode=vendor_customercode,
            vendor_branch=branch,
            invoiceno=inv_no,
            invoicedate=inv_date,
            description=description,
            product_description=product_description,
            amount=amt,
            vat_7=vat,
            tax_pct=0,
            tax_2=0,
            tax_3=tax_3,
            tax_5=0,
            netamount=net,
        ))
    return rows


def parse(text: str, filename: str = "", *, page_pngs: list[bytes] | None = None,
          **_kw) -> list[InvoiceRow]:
    rows: list[InvoiceRow] = []
    pages = _split_pages(text)
    for idx, page in enumerate(pages):
        ptype = _detect_page_type(page)
        if ptype == "A":
            row = _parse_type_a(page)
            if row:
                rows.append(row)
        elif ptype == "B":
            row = _parse_type_b(page)
            if row:
                rows.append(row)
        elif ptype == "C":
            # The default OCR pass shuffles this multi-column table — re-OCR
            # this single page with a JSON-format prompt and parse that.
            if page_pngs and idx < len(page_pngs):
                from app.ocr_cache import ocr_page_with_prompt_cached_sync
                try:
                    json_text = ocr_page_with_prompt_cached_sync(
                        page_pngs[idx], CREDIT_NOTE_PROMPT, tag="lt-creditnote-json"
                    )
                    rows.extend(_parse_type_c_from_json(json_text))
                except Exception:
                    pass
    return rows
