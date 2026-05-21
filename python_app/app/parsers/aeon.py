"""Parser for AEON (MaxValu) receipts.

The PDF is a consolidated receipt (ใบเสร็จรับเงิน) that lists multiple line
items, each with its own Slip# and WHT rate. Each line item becomes one row.

KNOWN LIMITATION: the gold Output.xlsx uses invoice numbers like
'AGR-926001932' that do NOT appear anywhere in the printed receipt. Those
seem to come from a separate AEON billing system / SAP. We use the printed
Slip# as the best-available invoiceno; the gold AEON rows will therefore not
match by (taxid, invoiceno) key in the validator. All other fields
(amounts, WHT %, vendor_customercode, dates) are extractable.
"""

from __future__ import annotations

import re

from app.parsers.common import collapse_spaces, round_half_up
from app.schema import InvoiceRow


RECEIPT_NO_RE = re.compile(r"เลขที่\s+([A-Z0-9]+)")
DATE_RE = re.compile(r"วันที่\s+(\d{1,2}/\d{1,2}/\d{4})")
BUYER_CODE_RE = re.compile(r"รหัสผู้ซื้อ\s+(\d+)")
TAXID_RE = re.compile(r"เลขประจำตัวผู้เสียภาษีอากร\s+(\d{13})")
# Slip# header line carries the description + slip code.
SLIP_RE = re.compile(r"^(.+?)\s+Slip\s*#\s*([A-Z0-9][A-Z0-9\-\s]*?)\s*$", re.MULTILINE)
# Amount lines look like '<rate>%\n<amount>' anywhere on the page.
RATE_AMT_RE = re.compile(r"^\s*(\d+)%\s*\n\s*([\d,]+\.\d{2})\s*$", re.MULTILINE)
VAT_RE = re.compile(r"จำนวนภาษีมูลค่าเพิ่ม\(อัตราภาษี\s*/\s*VAT\s*(\d+)%\)\s*\n\s*([\d,]+\.\d{2})")


def _parse_date(s: str) -> str:
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if not m:
        return ""
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if y >= 2500:
        y -= 543
    return f"{y:04d}-{mo:02d}-{d:02d}"


def _parse_page(page: str) -> list[InvoiceRow]:
    date_m = DATE_RE.search(page)
    invoice_date = _parse_date(date_m.group(1)) if date_m else ""

    issuer_taxid = ""
    for m in TAXID_RE.finditer(page):
        if m.group(1) != "0107537001421":
            issuer_taxid = m.group(1)
            break

    buyer_m = BUYER_CODE_RE.search(page)
    vendor_customercode = buyer_m.group(1) if buyer_m else ""

    # Page-level VAT (some pages charge VAT on top of the items).
    page_vat_rate = 0
    page_vat_amt = 0.0
    if (m := VAT_RE.search(page)):
        page_vat_rate = int(m.group(1))
        page_vat_amt = float(m.group(2).replace(",", ""))

    # Pass 1: each "<description> Slip# <code>" header line is one item.
    slips: list[tuple[str, str]] = []  # (description, slip)
    for m in SLIP_RE.finditer(page):
        desc = collapse_spaces(m.group(1))
        if not desc or desc.lower() in {"item", "รับชำระเป็นค่า"}:
            continue
        slip = "Slip#" + m.group(2).strip()
        slips.append((desc, slip))

    # Pass 2: each "<rate>%\n<amount>" pair is one item. Pair to slips by index.
    rate_amts: list[tuple[int, float]] = []
    for m in RATE_AMT_RE.finditer(page):
        rate_amts.append((int(m.group(1)), float(m.group(2).replace(",", ""))))

    rows: list[InvoiceRow] = []
    for i, (desc, slip) in enumerate(slips):
        if i >= len(rate_amts):
            break
        rate, amount = rate_amts[i]

        tax_pct = tax_2 = tax_3 = tax_5 = 0.0
        if rate == 1:
            tax_pct = round_half_up(amount * 0.01, 2)
        elif rate == 2:
            tax_2 = round_half_up(amount * 0.02, 2)
        elif rate == 3:
            tax_3 = round_half_up(amount * 0.03, 2)
        elif rate == 5:
            tax_5 = round_half_up(amount * 0.05, 2)

        # Page-level VAT applies once per page; attribute it to the first/only
        # item. The only sample AEON row with VAT is on the single-item page 2.
        vat_7 = page_vat_amt if (page_vat_rate == 7 and len(slips) == 1) else 0.0
        netamount = round_half_up(amount + vat_7 - (tax_pct + tax_2 + tax_3 + tax_5), 2)

        rows.append(InvoiceRow(
            taxid=issuer_taxid,
            vendor_customercode=vendor_customercode,
            vendor_branch="00000",
            invoiceno=slip,
            invoicedate=invoice_date,
            description=desc,
            amount=amount,
            vat_7=vat_7,
            tax_pct=tax_pct,
            tax_2=tax_2,
            tax_3=tax_3,
            tax_5=tax_5,
            netamount=netamount,
        ))
    return rows


def parse(text: str, filename: str = "", **_kw) -> list[InvoiceRow]:
    rows: list[InvoiceRow] = []
    for page in text.split("--- PAGE BREAK ---"):
        if "อิออน" not in page and "AEON" not in page.upper() and "ÆON" not in page:
            continue
        rows.extend(_parse_page(page))
    return rows
