"""Parser for Central Food Wholesale (CFW) invoices.

Each PDF page is one invoice with one line item. Format mirrors BTM (same vendor
group) with two layout differences:
  - Buyer code prefix is 'CFW-M' instead of 'BTM-MC'
  - Output's `description` is the line-item text + the หมายเหตุ text concatenated;
    `product_description` is left empty.
"""

from __future__ import annotations

import re

from app.parsers.common import collapse_spaces, parse_amount, parse_thai_date
from app.schema import InvoiceRow


INVOICE_NO_RE = re.compile(r"เลขที่\s+(\S+)")
DATE_RE = re.compile(r"วันที่\s+(\d{1,2}\s+\S+\s+\d{4})")
DUE_RE = re.compile(r"วันครบกำหนด\s+(\d{1,2}\s+\S+\s+\d{4})")
TAXID_RE = re.compile(r"เลขประจำตัวผู้เสียภาษี\s*:?\s*(\d{13})")
BUYER_CODE_RE = re.compile(r"ชื่อลูกค้า\s+CFW[-\s]?M(\d+)")
# Line item: "1. <description> <amount-as-'NNN NN'>"
ITEM_RE = re.compile(r"^\s*1\.\s+(.+?)\s+([\d,]+\s+\d{2})\s*$", re.MULTILINE)
VAT_RE = re.compile(r"ภาษีมูลค่าเพิ่ม\s+([\d,]+\s+\d{2})")
WHT_RE = re.compile(r"หักภาษี\s+ณ\s+ที่จ่าย\s+(\d+)%\s+จำนวนเงิน\s+([\d,]+\.\d{2})")
NOTE_RE = re.compile(r"หมายเหตุ\s+(.+?)(?=\n)", re.DOTALL)


def _split_pages(text: str) -> list[str]:
    if "--- PAGE BREAK ---" in text:
        return [p for p in text.split("--- PAGE BREAK ---") if p.strip()]
    parts = re.split(r"(?=ต้นฉบับใบแจ้งหนี้)", text)
    return [p for p in parts if "เซ็นทรัล ฟู้ด โฮลเซลล์" in p]


def _parse_page(page: str) -> InvoiceRow | None:
    inv = INVOICE_NO_RE.search(page)
    if not inv:
        return None
    invoice_no = inv.group(1).strip()

    date_m = DATE_RE.search(page)
    due_m = DUE_RE.search(page)
    invoice_date = parse_thai_date(date_m.group(1)) if date_m else ""
    due_date = parse_thai_date(due_m.group(1)) if due_m else ""

    issuer_taxid = ""
    for m in TAXID_RE.finditer(page):
        if m.group(1) != "0107537001421":
            issuer_taxid = m.group(1)
            break

    buyer_m = BUYER_CODE_RE.search(page)
    vendor_customercode = buyer_m.group(1) if buyer_m else ""

    vendor_branch = "00000" if "สำนักงานใหญ่" in page.split("ชื่อลูกค้า")[0] else ""

    item_m = ITEM_RE.search(page)
    item_desc = collapse_spaces(item_m.group(1)) if item_m else ""
    amount = parse_amount(item_m.group(2)) if item_m else 0.0

    vat_m = VAT_RE.search(page)
    vat_7 = parse_amount(vat_m.group(1)) if vat_m else 0.0

    tax_2 = tax_3 = tax_5 = 0.0
    wht_m = WHT_RE.search(page)
    if wht_m:
        pct = int(wht_m.group(1))
        amt = float(wht_m.group(2).replace(",", ""))
        if pct == 2:
            tax_2 = amt
        elif pct == 3:
            tax_3 = amt
        elif pct == 5:
            tax_5 = amt
    elif "Netting : Credit" in page or "Netting: Credit" in page:
        # CFW prints "Netting : Credit" on every invoice. When it ALSO prints an
        # explicit WHT line, the printed value wins (above). When only the Netting
        # header is present (with no explicit WHT amount), the buyer infers a 3%
        # withholding on the line-item amount — gold rows in data/Output.xlsx
        # consistently follow this rule.
        tax_3 = round(amount * 0.03, 2)

    note_m = NOTE_RE.search(page)
    note = collapse_spaces(note_m.group(1)) if note_m else ""

    # CFW joins the line-item description with the note into one `description`.
    description = (item_desc + note).strip() if item_desc or note else ""

    netamount = round(amount + vat_7 - (tax_2 + tax_3 + tax_5), 2)

    return InvoiceRow(
        taxid=issuer_taxid,
        vendor_customercode=vendor_customercode,
        vendor_branch=vendor_branch,
        invoiceno=invoice_no,
        invoicedate=invoice_date,
        duedate=due_date,
        description=description,
        product_description="",
        amount=amount,
        vat_7=vat_7,
        tax_pct=0,
        tax_2=tax_2,
        tax_3=tax_3,
        tax_5=tax_5,
        netamount=netamount,
    )


def parse(text: str, filename: str = "", **_kw) -> list[InvoiceRow]:
    rows: list[InvoiceRow] = []
    for page in _split_pages(text):
        row = _parse_page(page)
        if row:
            rows.append(row)
    return rows
