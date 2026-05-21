"""Parser for Big C (บิ๊กซี ซูเปอร์เซ็นเตอร์) invoices.

Each PDF page is one invoice with one line item; text layer is clean.

Landmarks:
  Issuer line:     'บริษัท บิ๊กซี ... <branch>'  OR  'บมจ. บิ๊กซี ... <branch>'
  Buyer line:      'ชื่อลูกค้า : 4000047 ... เลขที่ : <inv>'
  Date / Due:      'วันที่ : <DD/MM/YYYY>', 'วันที่ครบกำหนด : <DD/MM/YYYY>'
  Item line:       '<description> [<code> : ] 1.00 <unit_price> <amount>'
  Code/expense:    next line is either '<code>-XXX : <expense_code>-<group>' or
                   just '<expense_code>-<group>'.
  WHT:             'หมายเหตุ กรุณาหักภาษี ณ. ที่จ่าย <pct> % = <wht> มูลค่ารวม <amt>'
  VAT:             'ภาษีมูลค่าเพิ่ม <pct>% <vat>'
"""

from __future__ import annotations

import re

from app.customer_master import get_master
from app.parsers.common import collapse_spaces, parse_amount, parse_thai_date
from app.schema import InvoiceRow


INVOICE_NO_RE = re.compile(r"เลขที่\s*:\s*(\S+)")
DATE_RE = re.compile(r"วันที่\s*:\s*(\d{1,2}/\d{1,2}/\d{2,4})")
DUE_RE = re.compile(r"วันที่ครบกำหนด\s*:\s*(\d{1,2}/\d{1,2}/\d{2,4})")
TAXID_RE = re.compile(r"รหัสประจำตัวผู้เสียภาษี\s*(\d{13})")
BUYER_CODE_RE = re.compile(r"ชื่อลูกค้า\s*:\s*(\d{4,10})\s")
HEADER_BRANCH_RE = re.compile(r"(?:บริษัท|บมจ\.)\s*บิ๊กซี[^\n]*?(\d{5})\s+Page", re.DOTALL)
ITEM_LINE_RE = re.compile(r"^(.+?)\s+1\.00\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$", re.MULTILINE)
EXPENSE_RE = re.compile(r"(?:^|: )(\d{5})-", re.MULTILINE)
WHT_RE = re.compile(r"กรุณาหักภาษี\s*ณ\.\s*ที่จ่าย\s+(\d+(?:\.\d+)?)\s*%\s*=\s*([\d,]+\.\d{2})\s*มูลค่ารวม\s+([\d,]+\.\d{2})")
VAT_RE = re.compile(r"ภาษีมูลค่าเพิ่ม\s+(\d+(?:\.\d+)?)\s*%\s+([\d,]+\.\d{2})")
ISSUER_LINE_RE = re.compile(r"((?:บริษัท|บมจ\.)\s*บิ๊กซี[^\n]+)")


def _split_pages(text: str) -> list[str]:
    return [p for p in text.split("--- PAGE BREAK ---") if "ใบแจ้งหนี้" in p]


def _clean_description(item_desc: str) -> str:
    """Strip trailing code tokens before the qty: stuff like
    '4014 3290 :' or 'P1D04-PARB004328-HO :' that some pages have."""
    # Pattern A: trailing '<digits> <digits> :' (e.g. '4014 3290 :')
    item_desc = re.sub(r"\s+\d{3,}\s+\d{3,}\s*:\s*$", "", item_desc)
    # Pattern B: trailing '<CODE>-XXX :' where CODE is alnum
    item_desc = re.sub(r"\s+[A-Z0-9]+-[A-Z0-9]+-[A-Z]+\s*:\s*$", "", item_desc)
    # Pattern C: trailing token ':' (catch-all)
    item_desc = re.sub(r"\s*:\s*$", "", item_desc)
    return item_desc.rstrip()


def _parse_page(page: str) -> InvoiceRow | None:
    inv_m = INVOICE_NO_RE.search(page)
    if not inv_m:
        return None
    invoice_no = inv_m.group(1).strip()

    date_m = DATE_RE.search(page)
    invoice_date = parse_thai_date(date_m.group(1)) if date_m else ""
    due_m = DUE_RE.search(page)
    due_date = parse_thai_date(due_m.group(1)) if due_m else ""

    issuer_taxid = ""
    for m in TAXID_RE.finditer(page):
        if m.group(1) != "0107537001421":
            issuer_taxid = m.group(1)
            break

    buyer_m = BUYER_CODE_RE.search(page)
    vendor_customercode = buyer_m.group(1) if buyer_m else ""

    branch_m = HEADER_BRANCH_RE.search(page)
    vendor_branch = branch_m.group(1) if branch_m else "00000"

    item_m = ITEM_LINE_RE.search(page)
    description = ""
    amount = 0.0
    if item_m:
        description = _clean_description(item_m.group(1))
        # The trailing field is the amount.
        amount = parse_amount(item_m.group(3))

    # Override amount from "มูลค่ารวม" — the authoritative total per invoice header
    # (occasionally differs from the item-line trio when there are sub-totals).
    wht_m = WHT_RE.search(page)
    wht_pct = 0.0
    wht_amt = 0.0
    if wht_m:
        wht_pct = float(wht_m.group(1))
        wht_amt = float(wht_m.group(2).replace(",", ""))
        amount = float(wht_m.group(3).replace(",", ""))

    vat_amt = 0.0
    vat_m = VAT_RE.search(page)
    if vat_m:
        vat_amt = float(vat_m.group(2).replace(",", ""))

    expense_code = ""
    # Look for expense code in the lines BETWEEN the item line and the หมายเหตุ.
    if item_m:
        tail = page[item_m.end(): page.find("หมายเหตุ", item_m.end()) if "หมายเหตุ" in page else None]
        em = EXPENSE_RE.search(tail)
        if em:
            expense_code = em.group(1)

    tax_2 = tax_3 = tax_5 = 0.0
    if wht_amt:
        if abs(wht_pct - 2.0) < 0.1:
            tax_2 = wht_amt
        elif abs(wht_pct - 3.0) < 0.1:
            tax_3 = wht_amt
        elif abs(wht_pct - 5.0) < 0.1:
            tax_5 = wht_amt

    netamount = round(amount + vat_amt - (tax_2 + tax_3 + tax_5), 2)

    # Customer Master disambiguation: Big C taxid + branch 00485 has TWO master
    # rows (คลังธัญบุรี vs คลังครอสด็อคธัญบุรี). Pick the one whose name appears
    # in the issuer line on this page.
    customergroup = ""
    customercode = ""
    issuer_m = ISSUER_LINE_RE.search(page)
    issuer_text = issuer_m.group(1) if issuer_m else ""
    if issuer_taxid:
        master = get_master()
        candidates = [
            m for m in master
            if m.taxid == issuer_taxid
            and (vendor_branch in m.customercode or vendor_branch == "00000" and "สำนักงานใหญ่" in m.customercode)
        ]
        if len(candidates) > 1 and issuer_text:
            # PDF text often inserts spaces inside Thai words ('คลัง ครอส ด็อค')
            # while the master row's name has none ('คลังครอสด็อค'). Strip
            # whitespace from both, then prefer the candidate whose code has the
            # most 4-char windows that also appear in the issuer line.
            issuer_norm = "".join(issuer_text.split())

            def score(entry) -> int:
                code_norm = "".join(entry.customercode.split())
                return sum(
                    1 for i in range(len(code_norm) - 3)
                    if code_norm[i:i + 4] in issuer_norm
                )
            candidates.sort(key=score, reverse=True)
        if candidates:
            customergroup = candidates[0].customergroup
            customercode = candidates[0].customercode

    return InvoiceRow(
        customergroup=customergroup,
        customercode=customercode,
        taxid=issuer_taxid,
        vendor_customercode=vendor_customercode,
        vendor_branch=vendor_branch,
        vendor_expensecode=expense_code,
        invoiceno=invoice_no,
        invoicedate=invoice_date,
        duedate=due_date,
        description=collapse_spaces(description),
        product_description="",
        amount=amount,
        vat_7=vat_amt,
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
