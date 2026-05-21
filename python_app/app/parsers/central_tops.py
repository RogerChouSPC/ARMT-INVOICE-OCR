"""Parser shared by Central Food Retail (CFR) and Central + Matsumoto Kiyoshi
(CMK). Same invoice template as CFM — one invoice per page — but with two
template-specific transformations:

  - vendor_customercode: the OCR'd value reads 'TOP-M<digits>'; the gold
    output stores it as '9<digits>' (the buyer's internal SPC code). We strip
    the 'TOP-M' prefix and prepend '9'.
  - vendor_branch: the Group expense code (e.g. 29420, 99999) is stored in the
    vendor_branch column, same convention as CFM.

The Netting:Credit footer indicates WHT 3% always for CFR/CMK; we use the
printed value when available, else compute 3% of the subtotal.
"""

from __future__ import annotations

import re

from app.parsers.common import collapse_spaces, round_half_up
from app.schema import InvoiceRow


# CFR has two invoice-number formats:
#   1. 'เลขที่ : PRM9926000007'  (inline label)
#   2. 'เลขที่\nเลขที่อ้างอิง\nวันที่\n...\n3530103/010426\n3530103\n01/04/26'
#      (labels stacked first, then values — slash format invoice no)
INVOICE_NO_RE = re.compile(r"เลขที่\s*:\s*([A-Z0-9/]+)")
# Fallback for stacked layout: a 6-8 digit / 6 digit slash format on its own line.
INVOICE_NO_SLASH_RE = re.compile(r"(?:^|\n)(\d{6,8}/\d{6})\s*$", re.MULTILINE)
DATE_RE = re.compile(r"วันที\s*:\s*(\d{1,2}/\d{1,2}/\d{2})")
TAXID_RE = re.compile(r"เลขประจำตัวผู้เสียภาษี\s*:?\s*(\d{13})")
BUYER_CODE_RE = re.compile(r"\(รหัสร้านค้า\)\s*:\s*\S*?M(\d+)")
# Expense code: 5 digits after 'Group'. Two layouts:
#   (a) 'Group\n29130'         (single value — standard CFR/CMK)
#   (b) 'Group\n13\n29130'     (two values — slash-format CFR pages)
# Skip 1-2-digit values and take the first 4-6 digit number.
EXPENSE_GROUP_RE = re.compile(r"Group\s*\n+(?:\s*\d{1,2}\s*\n+)?\s*(\d{4,6})")
SUBTOTAL_RE = re.compile(r"(?:^|\n)รวม\s*\n?\s*([\d,]+\.\d{2})")
VAT_RE = re.compile(r"บวกภาษีมูลค่าเพิ่ม\s*7%\s*\(บาท\)\s*\n?\s*([\d,]+\.\d{2})")
WHT_RE = re.compile(r"หักภาษี\s*ณ\s*ที่จ่าย\s*(\d+)\s*%\s*\(บาท\)\s*\n?\s*([\d,]+\.\d{2})")
TOTAL_NET_RE = re.compile(r"รวมเป็นเงินทั้งสิ้น\s*\(บาท\)\s*\n?\s*([\d,]+\.\d{2})")
ITEM_RE = re.compile(r"รายการ\s+(.+?)\s*$", re.MULTILINE)
NOTE_RE = re.compile(r"หมายเหตุ\s+(.+?)(?:\n|$)")


def _parse_dd_mm_yy(s: str) -> str:
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{2,4})", s.strip())
    if not m:
        return ""
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if y < 100:
        y += 2000
    elif y >= 2500:
        y -= 543
    return f"{y:04d}-{mo:02d}-{d:02d}"


def _parse_page(page: str, *, has_netting: bool) -> InvoiceRow | None:
    inv_m = INVOICE_NO_RE.search(page) or INVOICE_NO_SLASH_RE.search(page)
    if not inv_m:
        return None
    invoice_no = inv_m.group(1).strip()

    date_m = DATE_RE.search(page)
    invoice_date = _parse_dd_mm_yy(date_m.group(1)) if date_m else ""

    issuer_taxid = ""
    for m in TAXID_RE.finditer(page):
        if m.group(1) != "0107537001421":
            issuer_taxid = m.group(1)
            break

    buyer_m = BUYER_CODE_RE.search(page)
    if buyer_m:
        vendor_customercode = "9" + buyer_m.group(1)
    else:
        # CFM-style layout (slash-format invoices on CFR pages 6-7): the
        # buyer code prints WITHOUT the 'TOP-M' prefix. Use the raw digits.
        alt_m = re.search(r"\(รหัสร้านค้า\)\s*:\s*(\d+)", page)
        vendor_customercode = alt_m.group(1) if alt_m else ""

    expense_m = EXPENSE_GROUP_RE.search(page)
    expense_code = expense_m.group(1) if expense_m else ""

    amount = 0.0
    if (m := SUBTOTAL_RE.search(page)):
        amount = float(m.group(1).replace(",", ""))

    vat_amt = 0.0
    if (m := VAT_RE.search(page)):
        vat_amt = float(m.group(1).replace(",", ""))

    tax_pct = tax_2 = tax_3 = tax_5 = 0.0
    if (wht_m := WHT_RE.search(page)):
        rate = int(wht_m.group(1))
        amt = float(wht_m.group(2).replace(",", ""))
        if rate == 1:
            tax_pct = amt
        elif rate == 2:
            tax_2 = amt
        elif rate == 3:
            tax_3 = amt
        elif rate == 5:
            tax_5 = amt
    if tax_pct + tax_2 + tax_3 + tax_5 == 0 and has_netting and amount > 0:
        # CFR invoices that print only Netting:Credit (no explicit WHT line)
        # default to 3% — same convention used by CFW.
        tax_3 = round_half_up(amount * 0.03, 2)

    netamount = 0.0
    if (m := TOTAL_NET_RE.search(page)):
        netamount = float(m.group(1).replace(",", ""))
    if netamount == 0:
        netamount = round_half_up(amount + vat_amt - (tax_pct + tax_2 + tax_3 + tax_5), 2)

    item_m = ITEM_RE.search(page)
    note_m = NOTE_RE.search(page)
    item_text = collapse_spaces(item_m.group(1)) if item_m else ""
    note_text = collapse_spaces(note_m.group(1)) if note_m else ""

    return InvoiceRow(
        taxid=issuer_taxid,
        vendor_customercode=vendor_customercode,
        vendor_branch=expense_code,
        vendor_expensecode="",
        invoiceno=invoice_no,
        invoicedate=invoice_date,
        description=item_text,
        product_description=note_text,
        amount=amount,
        vat_7=vat_amt,
        tax_pct=tax_pct,
        tax_2=tax_2,
        tax_3=tax_3,
        tax_5=tax_5,
        netamount=netamount,
    )


def _parse_for_marker(text: str, marker: str) -> list[InvoiceRow]:
    rows: list[InvoiceRow] = []
    for page in text.split("--- PAGE BREAK ---"):
        if marker not in page:
            continue
        has_netting = "Netting" in page
        row = _parse_page(page, has_netting=has_netting)
        if row:
            rows.append(row)
    return rows


def parse_cfr(text: str, filename: str = "", **_kw) -> list[InvoiceRow]:
    return _parse_for_marker(text, "เซ็นทรัล ฟู้ด รีเทล")


def parse_cmk(text: str, filename: str = "", **_kw) -> list[InvoiceRow]:
    return _parse_for_marker(text, "มัทสึโมโตะ")
