"""Parser for Central Food Minimart (CFM) — the FamilyMart franchise.

OCR'd PDF; one invoice per page; clean structured layout.

Landmarks:
  Issuer taxid:   'เลขประจำตัวผู้เสียภาษี :0105535133093'
  Invoice no:     'เลขที่ : 17556399/300426'
  Invoice date:   'วันที่ 30/04/26'
  Buyer code:     'เจ้าของ/ตัวแทน(รหัสร้านค้า) : 9812292'
  Expense code:   the digits printed below 'Group' header
  Total:          'รวม 7,622.69'
  WHT (3%):       'หักภาษี ณ ที่จ่าย 3 %(บาท) 228.68'
  VAT (7%):       'บวกภาษีมูลค่าเพิ่ม 7%(บาท) 0.00'
  Item ref:       'รายการ <description>'
  Note:           'หมายเหตุ <text>'  (combined with รายการ for full description)
  Product line:   'สินค้า : <barcode> <product name>'
"""

from __future__ import annotations

import re

from app.parsers.common import collapse_spaces
from app.schema import InvoiceRow


# Gemini OCR's column-shuffling sometimes splits the 'เลขที่ : <value>' pair
# across many lines. We match the value pattern directly: NNNNNNN/DDMMYY on
# its own line, optionally preceded by ': '.
INVOICE_NO_RE = re.compile(r"(?:^|\n):?\s*(\d{6,8}/\d{6})\s*$", re.MULTILINE)
# Invoice date prints DD/MM/YY (2-digit year). The signature date later uses
# a 4-digit year so we exclude that by restricting to 2-digit years.
DATE_RE = re.compile(r"(?:^|\n)\s*(\d{1,2}/\d{1,2}/\d{2})\s*$", re.MULTILINE)
TAXID_RE = re.compile(r"เลขประจำตัวผู้เสียภาษี\s*:?\s*(\d{13})")
BUYER_CODE_RE = re.compile(r"\(รหัสร้านค้า\)\s*:\s*(\d+)")
EXPENSE_CODE_RE = re.compile(r"Group\s*\n?\s*(\d+)\s*\n?\s*(\d{4,6})")
SUBTOTAL_RE = re.compile(r"(?:^|\n)รวม\s+([\d,]+\.\d{2})")
VAT_RE = re.compile(r"บวกภาษีมูลค่าเพิ่ม\s*7%\s*\(บาท\)\s*([\d,]+\.\d{2})")
WHT_RE = re.compile(r"หักภาษี\s*ณ\s*ที่จ่าย\s*(\d+)\s*%\s*\(บาท\)\s*([\d,]+\.\d{2})")
TOTAL_NET_RE = re.compile(r"รวมเป็นเงินทั้งสิ้น\s*\(บาท\)\s*([\d,]+\.\d{2})")
ITEM_RE = re.compile(r"รายการ\s+(.+?)\s*$", re.MULTILINE)
NOTE_RE = re.compile(r"หมายเหตุ\s+(.+?)(?:\n|$)")
PRODUCT_RE = re.compile(r"สินค้า\s*:\s*(.+?)\s*$", re.MULTILINE)


def _parse_lt_date(s: str) -> str:
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{2,4})", s.strip())
    if not m:
        return ""
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if y < 100:
        y += 2000
    elif y >= 2500:
        y -= 543
    return f"{y:04d}-{mo:02d}-{d:02d}"


def _parse_page(page: str) -> InvoiceRow | None:
    inv_m = INVOICE_NO_RE.search(page)
    if not inv_m:
        return None
    invoice_no = inv_m.group(1).strip()

    date_m = DATE_RE.search(page)
    invoice_date = _parse_lt_date(date_m.group(1)) if date_m else ""

    issuer_taxid = ""
    for m in TAXID_RE.finditer(page):
        if m.group(1) != "0107537001421":
            issuer_taxid = m.group(1)
            break

    buyer_m = BUYER_CODE_RE.search(page)
    vendor_customercode = buyer_m.group(1) if buyer_m else ""

    expense_m = EXPENSE_CODE_RE.search(page)
    expense_code = expense_m.group(2) if expense_m else ""

    amount = 0.0
    if (m := SUBTOTAL_RE.search(page)):
        amount = float(m.group(1).replace(",", ""))

    vat_amt = 0.0
    if (m := VAT_RE.search(page)):
        vat_amt = float(m.group(1).replace(",", ""))

    tax_3 = 0.0
    wht_m = WHT_RE.search(page)
    if wht_m:
        rate = int(wht_m.group(1))
        amt = float(wht_m.group(2).replace(",", ""))
        if rate == 3:
            tax_3 = amt

    netamount = 0.0
    if (m := TOTAL_NET_RE.search(page)):
        netamount = float(m.group(1).replace(",", ""))

    item_m = ITEM_RE.search(page)
    note_m = NOTE_RE.search(page)
    item_text = collapse_spaces(item_m.group(1)) if item_m else ""
    note_text = collapse_spaces(note_m.group(1)) if note_m else ""
    description = (item_text + " " + note_text).strip() if item_text or note_text else ""

    product_m = PRODUCT_RE.search(page)
    product_description = collapse_spaces(product_m.group(1)) if product_m else ""
    # Gold keeps a leading space on the product description (verbatim from PDF).
    if product_description and not product_description.startswith(" "):
        product_description = " " + product_description

    # CFM gold-data convention: the expense code (e.g. 29130) is stored in the
    # vendor_branch column, not in vendor_expensecode. Mirroring that here.
    return InvoiceRow(
        taxid=issuer_taxid,
        vendor_customercode=vendor_customercode,
        vendor_branch=expense_code,
        vendor_expensecode="",
        invoiceno=invoice_no,
        invoicedate=invoice_date,
        description=description,
        product_description=product_description,
        amount=amount,
        vat_7=vat_amt,
        tax_pct=0,
        tax_2=0,
        tax_3=tax_3,
        tax_5=0,
        netamount=netamount,
    )


def parse(text: str, filename: str = "", **_kw) -> list[InvoiceRow]:
    rows: list[InvoiceRow] = []
    for page in text.split("--- PAGE BREAK ---"):
        if "เซ็นทรัล ฟู้ด มินิมาร์เก็ต" not in page:
            continue
        row = _parse_page(page)
        if row:
            rows.append(row)
    return rows
