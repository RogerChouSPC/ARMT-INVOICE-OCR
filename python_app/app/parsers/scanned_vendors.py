"""Regex-based parsers for the scanned/photo-only vendor PDFs.

For each vendor: the PDF has no usable text layer, so app.extract OCRs once
(cached on disk), then this module's parsers regex-extract the structured
fields. No additional API calls are issued.

Each parser is independent — vendors don't share enough layout for shared
helpers. Field locations come from `vercel/src/config/customers.ts` and
validation against `data/Output.xlsx`.
"""

from __future__ import annotations

import re

from app.parsers.common import parse_thai_date, round_half_up
from app.schema import InvoiceRow


OUR_TAXID = "0107537001421"


# ============================== HomePro ==============================
#
# OCR layout:
#   เลขที่ <inv>
#   วันที <DD/MM/YYYY>             ← issue date
#   กำหนดวันชำระเงิน <DD/MM/YYYY>   ← gold uses THIS as invoicedate
#   รหัสลูกค้า 1000515117/V.3103   ← gold uses 'V3103' (the part after the slash, no dot)
#   เลขประจำตัวผู้เสียภาษีอากร 0107544000043
#   1 <description>
#   <amount>
#   ภาษีมูลค่าเพิ่ม <vat>
#   จำนวนเงินรวมทั้งสิ้น <total>

def parse_homepro(text: str, filename: str = "", **_kw) -> list[InvoiceRow]:
    rows: list[InvoiceRow] = []
    for page in text.split("--- PAGE BREAK ---"):
        if "โฮม โปรดักส์" not in page and "HomePro" not in page:
            continue
        # The OCR sometimes drops the mai-ek diacritic ('เลขที' vs 'เลขที่')
        # — accept either spelling.
        m_inv = re.search(r"เลขที่?\s+([A-Z0-9]+)", page)
        m_due = re.search(r"กำหนดวันชำระเงิน\s+(\d{1,2}/\d{1,2}/\d{2,4})", page)
        m_code = re.search(r"รหัสลูกค้า\s+\d+\s*/?\s*V\.?(\d+)", page)
        # HomePro stacks 3 labels then 3 values. Detect the stacked layout
        # first; fall back to inline 'label value' patterns otherwise.
        m_stacked = re.search(
            r"ราคาก่อนภาษีมูลค่าเพิ่ม\s*\n\s*ภาษีมูลค่าเพิ่ม\s*\n\s*จำนวนเงินรวมทั้งสิ้น\s*\n\s*([\d,]+\.\d{2})\s*\n\s*([\d,]+\.\d{2})\s*\n\s*([\d,]+\.\d{2})",
            page,
        )
        amount = vat = total = 0.0
        if m_stacked:
            amount = float(m_stacked.group(1).replace(",", ""))
            vat = float(m_stacked.group(2).replace(",", ""))
            total = float(m_stacked.group(3).replace(",", ""))
        else:
            m_total = re.search(r"จำนวนเงินรวมทั้งสิ้น\s+([\d,]+\.\d{2})", page)
            m_vat = re.search(r"ภาษีมูลค่าเพิ่ม\s+([\d,]+\.\d{2})", page)
            m_amount = re.search(r"ราคาก่อนภาษีมูลค่าเพิ่ม\s+([\d,]+\.\d{2})", page)
            amount = float(m_amount.group(1).replace(",", "")) if m_amount else 0.0
            vat = float(m_vat.group(1).replace(",", "")) if m_vat else 0.0
            total = float(m_total.group(1).replace(",", "")) if m_total else 0.0
            if amount == 0 and total > 0:
                amount = total - vat
        m_desc = re.search(r"^1\s+(.+?)\s*$", page, re.MULTILINE)
        if not m_inv:
            continue
        tax_3 = round_half_up(amount * 0.03, 2)
        net = round_half_up(amount + vat - tax_3, 2)
        rows.append(InvoiceRow(
            taxid="0107544000043",
            vendor_customercode=f"V{m_code.group(1)}" if m_code else "",
            vendor_branch="00000",
            invoiceno=m_inv.group(1),
            invoicedate=parse_thai_date(m_due.group(1)) if m_due else "",
            description=(m_desc.group(1) if m_desc else "").strip(),
            amount=amount, vat_7=vat,
            tax_pct=0, tax_2=0, tax_3=tax_3, tax_5=0,
            netamount=net,
        ))
    return rows


# ============================== Watsons ==============================
#
# OCR layout:
#   Attn: K. T.
#   ... ITEM ROWS (Description + Remark + Amount)
#   LS16985                ← vendor_customercode (the LS-prefix code; may appear earlier)
#   No: DR690301726        ← invoice no
#   Date: 29/03/26
#   TAX I.D: 0105539086260
#   Total exc. VAT  <amount>
#   VAT             <vat>

def parse_watson(text: str, filename: str = "", **_kw) -> list[InvoiceRow]:
    """Watson layout per page (one invoice each):
        No: <inv>
        Date: <DD/MM/YY>
        LS<NNNNN>            ← vendor_customercode
        ...
        Total exc. VAT
        VAT
        <amount>             ← total exc VAT (= 'amount' field in gold)
        <pct>%
        <vat>
        Total inc. VAT
        <total_inc>
        Less W/T
        <pct>%
        <wht>
        Net Total
        <net>
    """
    rows: list[InvoiceRow] = []
    for page in text.split("--- PAGE BREAK ---"):
        if "Central Watson" not in page and "Watson" not in page:
            continue
        m_inv = re.search(r"No:\s*([A-Z0-9]+)", page)
        m_date = re.search(r"Date:\s*(\d{1,2}/\d{1,2}/\d{2,4})", page)
        m_code = re.search(r"\b(LS\d{4,6})\b", page)

        # Extract the 5 totals values that appear AFTER 'Total exc. VAT'.
        tot_idx = page.find("Total exc. VAT")
        amount = vat = wht = net = 0.0
        if tot_idx >= 0:
            tail = page[tot_idx:]
            vals = re.findall(r"([\d,]+\.\d{2})", tail)
            if len(vals) >= 4:
                amount = float(vals[0].replace(",", ""))
                vat = float(vals[1].replace(",", ""))
                # vals[2] = total_inc_vat (skip)
                wht = float(vals[3].replace(",", ""))
                if len(vals) >= 5:
                    net = float(vals[4].replace(",", ""))
                else:
                    net = round_half_up(amount + vat - wht, 2)

        if not m_inv:
            continue
        rows.append(InvoiceRow(
            taxid="0105539086260",
            vendor_customercode=m_code.group(1) if m_code else "",
            vendor_branch="00000",
            invoiceno=m_inv.group(1),
            invoicedate=parse_thai_date(m_date.group(1)) if m_date else "",
            amount=amount, vat_7=vat,
            tax_pct=0, tax_2=0, tax_3=wht, tax_5=0,
            netamount=net,
        ))
    return rows


# ============================== Tsuruha ==============================
#
# OCR layout (each page is one invoice):
#   Tsuruha (Thailand) Co., Ltd.
#   Tax ID: 0105554157903
#   Vendor: 007003
#   Inv No: IV212/13032026
#   Date: 13/03/2026
#   Subtotal: 875.00
#   VAT: 0.00
#   Total: 875.00

def parse_tsuruha(text: str, filename: str = "", **_kw) -> list[InvoiceRow]:
    """Tsuruha layout per page (one invoice each):
        INV No. IV212/13032026
        Date 13/03/2026
        Vendor 007003
        Total before Vat <amt>, VAT <vat>, WT3% <wht>, Net amount <net>
    OCR stacks labels first, then values; the totals show '<amt> <wht> <net>'
    in that order on consecutive lines.
    """
    rows: list[InvoiceRow] = []
    for page in text.split("--- PAGE BREAK ---"):
        if "Tsuruha" not in page and "ซูรูฮะ" not in page and "ซูรฮะ" not in page:
            continue
        m_inv = re.search(r"\b(IV\d+/\d{8})\b", page)
        m_date = re.search(r"\bDate\s+(\d{1,2}/\d{1,2}/\d{4})", page, re.IGNORECASE)
        # Vendor code: first 6 digits on a line of its own, possibly with
        # extra OCR-merged digits after (e.g. '007003006'). Skip the 13-digit
        # taxid lines.
        m_vendor = None
        for mm in re.finditer(r"^(\d{6})(\d*)\s*$", page, re.MULTILINE):
            full = mm.group(1) + mm.group(2)
            if len(full) == 13:  # taxid
                continue
            m_vendor = mm
            break

        # Totals: take the last 3 amount values that are NOT '0.00'.
        all_amounts = [float(x.replace(",", "")) for x in re.findall(r"^([\d,]+\.\d{2})\s*$", page, re.MULTILINE)]
        amount = tax_3 = net = 0.0
        if len(all_amounts) >= 3:
            # The pattern in the OCR is: amount, vat (often 0), wht, net.
            # We take the largest amount as the subtotal, then compute WHT 3%.
            net = all_amounts[-1]
            tax_3 = all_amounts[-2]
            amount = all_amounts[-3]
            # Sometimes the OCR includes 'Total amount' which duplicates the
            # subtotal. Use whatever's printed and trust the relationship.
        elif all_amounts:
            amount = max(all_amounts)
            tax_3 = round_half_up(amount * 0.03, 2)
            net = round_half_up(amount - tax_3, 2)

        if not m_inv:
            continue
        rows.append(InvoiceRow(
            taxid="0105554157903",
            vendor_customercode=m_vendor.group(1) if m_vendor else "",
            vendor_branch="00000",
            invoiceno=m_inv.group(1),
            invoicedate=parse_thai_date(m_date.group(1)) if m_date else "",
            amount=amount, vat_7=0,
            tax_pct=0, tax_2=0, tax_3=tax_3, tax_5=0,
            netamount=net,
        ))
    return rows


# ============================== Boots ==============================
#
# OCR layout: single invoice per page with multiple line items.
# Total/VAT printed once per page. WHT is 3% applied to total per gold.

def parse_boots(text: str, filename: str = "", **_kw) -> list[InvoiceRow]:
    """Boots invoices have many line items per invoice (Supplier/Flat Rebate
    + Distribution Fee Income pairs across multiple PG references). The gold
    aggregates them by TYPE within each invoice, emitting one row per type:
        - 'Supplier/Flat Rebate (0.5%)' sum across all refs → one row
        - 'Distribution Fee Income (1.5%)' sum across all refs → another row
    """
    from collections import OrderedDict
    item_re = re.compile(
        r"^(.+?)\s+(\d+)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([VN])\s*$",
        re.MULTILINE,
    )
    by_invoice: dict[str, dict] = OrderedDict()
    meta: dict[str, dict] = {}

    for page in text.split("--- PAGE BREAK ---"):
        if "Boots Retail" not in page:
            continue
        # The SIN-prefix invoice number is unique to Boots — match it directly
        # to handle continuation pages where the OCR stacks labels then values.
        m_inv = re.search(r"\b(SIN\d{8})\b", page)
        if not m_inv:
            continue
        inv_no = m_inv.group(1)

        if inv_no not in meta:
            m_date = re.search(r"Document\s*Date:?\s*(\d{1,2}\s+\w+\s+\d{4})", page)
            m_code = re.search(r"Customer:\s*[\$S]?(S?\d+-?\d*)", page) \
                or re.search(r"Customer:\s*(\S+)", page)
            cust_code = (m_code.group(1) if m_code else "").lstrip("$")
            if cust_code and not cust_code.startswith("S"):
                cust_code = "S" + cust_code
            invoice_date = ""
            if m_date:
                try:
                    from datetime import datetime
                    dt = datetime.strptime(m_date.group(1), "%d %B %Y")
                    invoice_date = dt.strftime("%Y-%m-%d")
                except ValueError:
                    pass
            meta[inv_no] = {"cust": cust_code, "date": invoice_date}

        groups = by_invoice.setdefault(inv_no, OrderedDict())
        # Single-item invoices stack labels and values heavily. Heuristic:
        # take the largest positive amount BEFORE the 'Remark' footer as the
        # line-item subtotal. Detect this layout by absence of a multi-item
        # row match AND presence of a 'Total THB Excl./Exd. WHT' header.
        if not item_re.search(page) and re.search(r"Total\s+THB\s+(?:Excl|Exd)\.", page):
            cut = page.find("Remark")
            head = page[:cut] if cut > 0 else page
            amts = [float(x.replace(",", "")) for x in re.findall(r"([\d,]+\.\d{2})", head)]
            amts = [a for a in amts if a > 0]
            if amts:
                amt = max(amts)
                # Description heuristic: the line containing 'Fee' or
                # 'Listing' or 'Scan' near the top, else 'Item'.
                desc_m = re.search(
                    r"(Listing\s+Fee[^\n]*|Scan\s+Out|Distribution\s+Fee[^\n]*|Supplier[^\n]*)",
                    head, re.IGNORECASE,
                )
                base = (desc_m.group(1).strip() if desc_m else "Item")
                groups.setdefault(base, {"amount": 0.0, "vat_marker": "N"})
                groups[base]["amount"] += amt
            continue
        for desc, _qty, _unit, line_amt, vmark in item_re.findall(page):
            # Aggregate by item TYPE — the leading phrase before 'Ref. PG'.
            base = re.sub(r"\s+Ref\.?\s+PG.*$", "", desc).strip()
            # Normalize Gemini OCR typos ('Suppller' → 'Supplier', 'Disribution' → 'Distribution', etc.)
            base = base.replace("Suppller", "Supplier").replace("Disributiom", "Distribution")
            amt = float(line_amt.replace(",", ""))
            cur = groups.get(base, {"amount": 0.0, "vat_marker": vmark})
            cur["amount"] += amt
            if vmark == "V":
                cur["vat_marker"] = "V"
            groups[base] = cur

    rows: list[InvoiceRow] = []
    for inv_no, groups in by_invoice.items():
        m = meta[inv_no]
        for desc, agg in groups.items():
            amount = round_half_up(agg["amount"], 2)
            vat = round_half_up(amount * 0.07, 2) if agg["vat_marker"] == "V" else 0.0
            tax_3 = round_half_up(amount * 0.03, 2)
            net = round_half_up(amount + vat - tax_3, 2)
            rows.append(InvoiceRow(
                taxid="0115539007084",
                vendor_customercode=m["cust"],
                vendor_branch="00000",
                invoiceno=inv_no,
                invoicedate=m["date"],
                description=desc,
                amount=amount, vat_7=vat,
                tax_pct=0, tax_2=0, tax_3=tax_3, tax_5=0,
                netamount=net,
            ))
    return rows


# ============================== CJ Express ==============================

def parse_cj(text: str, filename: str = "", **_kw) -> list[InvoiceRow]:
    """CJ Express layout (one invoice per page, often multiple line items):
        เลขที่ <10-digit>
        วันที่ <DD.MM.YYYY>
        รหัสลูกหนี้: <code>   ← vendor_customercode
        ลำดับ ... รายการ ... จำนวนเงิน
        <N> <desc> 1 AU <unit_price> <amount>
        ...
        รวมเงินก่อนภาษีมูลค่าเพิ่ม <total>
    Each line item becomes its own InvoiceRow with the same invoice header.
    WHT is 3% on each item per gold convention.
    """
    rows: list[InvoiceRow] = []
    for page in text.split("--- PAGE BREAK ---"):
        if "ซี.เจ" not in page and "CJ" not in page.upper():
            continue
        m_inv = re.search(r"เลขที่\s+(\d{10})", page)
        m_date = re.search(r"วันที่\s+(\d{1,2}[\./]\d{1,2}[\./]\d{4})", page)
        # CJ OCR stacks labels first then values — the customer code is the
        # FIRST standalone 6-digit number that appears AFTER 'รหัสลูกหนี้'.
        cust_idx = page.find("รหัสลูกหนี้")
        m_code = re.search(r"^(\d{6})\s*$", page[cust_idx:], re.MULTILINE) if cust_idx >= 0 else None

        # Each item line: '<N> <desc...> 1 AU <unit_price> <amount>' where the
        # unit_price and amount are the same (qty 1). Collect every standalone
        # amount line, then dedupe consecutive duplicates to get one entry per
        # item.
        cut = page.find("รวมเงินก่อนภาษีมูลค่าเพิ่ม")
        head = page[:cut] if cut > 0 else page
        # Each line item has its amount appearing twice (unit_price + amount).
        # Take every second amount (the second-of-each-pair) starting from
        # the table. But the simplest heuristic that works: dedupe by removing
        # adjacent duplicates, then drop subtotals (small amounts that don't
        # represent items).
        head_amounts = [float(x.replace(",", "")) for x in re.findall(r"^([\d,]+\.\d{2})\s*$", head, re.MULTILINE)]
        # Each item appears as TWO consecutive identical amount lines (unit
        # price + amount); collapse them to one.
        unique_items: list[float] = []
        i = 0
        while i < len(head_amounts):
            unique_items.append(head_amounts[i])
            if i + 1 < len(head_amounts) and head_amounts[i] == head_amounts[i + 1]:
                i += 2
            else:
                i += 1

        if not m_inv:
            continue
        for amt in unique_items:
            tax_3 = round_half_up(amt * 0.03, 2)
            net = round_half_up(amt - tax_3, 2)
            rows.append(InvoiceRow(
                taxid="0105556055491",
                vendor_customercode=m_code.group(1) if m_code else "",
                vendor_branch="00000",
                invoiceno=m_inv.group(1),
                invoicedate=parse_thai_date(m_date.group(1).replace(".", "/")) if m_date else "",
                amount=amt, vat_7=0,
                tax_pct=0, tax_2=0, tax_3=tax_3, tax_5=0,
                netamount=net,
            ))
    return rows


# ============================== Foodland ==============================

def parse_foodland(text: str, filename: str = "", **_kw) -> list[InvoiceRow]:
    """Foodland layout per page:
        A/C No. <code>
        INVOICE No. RI <inv-suffix>      ← may have a space; strip it
        Invoice Date <DD/MM/YYYY>
        ...
        มูลค่าสินค้าหรือบริการ <amount>
        ภาษีมูลค่าเพิ่ม <vat>
        รวมเป็นเงินทั้งสิ้น <total>

    Gold-side quirk: 'ค่าโฆษณา' (advertising) invoices apply 2% WHT and use
    the tax_2 column; everything else is 3% in tax_3.
    """
    rows: list[InvoiceRow] = []
    for page in text.split("--- PAGE BREAK ---"):
        if "ฟู้ดแลนด์" not in page and "Foodland" not in page.lower():
            continue
        m_inv = re.search(r"INVOICE\s*No\.\s*(RI\s*\d+)", page)
        m_date = re.search(r"Invoice\s*Date\s*(\d{1,2}/\d{1,2}/\d{4})", page)
        m_acno = re.search(r"A/C\s*No\.\s*(\d+)", page)
        if not m_inv:
            continue

        # Collect the amounts AFTER 'มูลค่าสินค้าหรือบริการ' (the per-page
        # totals section). Then identify:
        #   amount       = first amount (or matches the printed sum-of-items)
        #   grand_total  = the LARGEST amount (รวมเป็นเงินทั้งสิ้น)
        #   vat          = grand_total − amount  (handles either label order)
        tot_idx = page.find("มูลค่าสินค้าหรือบริการ")
        amount = vat = 0.0
        if tot_idx >= 0:
            amts = [float(x.replace(",", "")) for x in re.findall(r"([\d,]+\.\d{2})", page[tot_idx:])]
            amts = [a for a in amts if a > 0]
            if amts:
                grand = max(amts)
                # The smallest amount equal to or less than grand is the base.
                # Most pages have exactly [amount, vat, grand] OR [amount, grand]:
                non_grand = [a for a in amts if a != grand]
                if non_grand:
                    amount = max(non_grand)
                    vat = round_half_up(grand - amount, 2) if grand > amount else 0.0
                else:
                    amount = grand
        # WHT: 2% for 'ค่าโฆษณา' (advertising), 3% otherwise.
        wht_rate = 0.02 if "ค่าโฆษณา" in page else 0.03
        wht = round_half_up(amount * wht_rate, 2)
        net = round_half_up(amount + vat - wht, 2)
        rows.append(InvoiceRow(
            taxid="0105515004549",
            vendor_customercode=m_acno.group(1) if m_acno else "",
            vendor_branch="00000",
            invoiceno=m_inv.group(1).replace(" ", ""),  # 'RI 26001030' → 'RI26001030'
            invoicedate=parse_thai_date(m_date.group(1)) if m_date else "",
            amount=amount, vat_7=vat,
            tax_pct=0,
            tax_2=wht if wht_rate == 0.02 else 0,
            tax_3=wht if wht_rate == 0.03 else 0,
            tax_5=0,
            netamount=net,
        ))
    return rows


# ============================== TFG (Thai Foods) ==============================

def parse_tfg(text: str, filename: str = "", **_kw) -> list[InvoiceRow]:
    """TFG layout per page (one invoice each):
        รหัสลูกค้า<NL><7-digit>          ← vendor_customercode (e.g. 3001059)
        เลขที่เอกสาร<NL><inv>            ← invoice number (e.g. IN2100007022)
        วันที่ในเอกสาร<NL><DD.MM.YYYY>
        จำนวนเงิน<NL><amount>
        จำนวนภาษีมูลค่าเพิ่ม<NL><vat>
        จำนวนภาษีหัก ณ ที่จ่าย<NL><wht>
    """
    rows: list[InvoiceRow] = []
    for page in text.split("--- PAGE BREAK ---"):
        if "ไทย ฟู้ดส์" not in page and "ไทยฟู้ด" not in page and "Thai Foods" not in page:
            continue
        m_inv = re.search(r"(IN[VT]?\d{8,12})", page)
        m_date = re.search(r"วันที่ในเอกสาร\s*\n+\s*(\d{1,2}[\./]\d{1,2}[\./]\d{4})", page)
        m_code = re.search(r"รหัสลูกค้า\s*\n[^\n]*\n([\d]{7})", page)
        if not m_code:
            m_code = re.search(r"^(\d{7})\s*$", page, re.MULTILINE)
        m_amount = re.search(r"จำนวนเงินก่อนส่วนลด\s*\n([\d,]+\.\d{2})", page)
        # TFG totals have two layouts:
        #  (a) <vat_label>\n<vat>\n<wht_label>\n<wht>
        #  (b) <vat_label>\n<wht_label>\n<vat>\n<wht>  ← labels stacked first
        # Detect (b) by checking if 'ที่จ่าย' is on the next line after the VAT
        # label; otherwise (a). Either way, the VALUES end with <vat>\n<wht>.
        m_stacked = re.search(
            r"จำนวนภาษีมูลค่าเพิ่ม\s*\n+จำนวนภาษีหัก\s*ณ\s*ที่จ่าย\s*\n+([\d,]+\.\d{2})\s*\n+([\d,]+\.\d{2})",
            page,
        )
        if m_stacked:
            m_vat = type("M", (), {"group": staticmethod(lambda i: m_stacked.group(1))})()
            m_wht = type("M", (), {"group": staticmethod(lambda i: m_stacked.group(2))})()
        else:
            m_vat = re.search(r"จำนวนภาษีมูลค่าเพิ่ม\s*\n([\d,]+\.\d{2})", page)
            m_wht = re.search(r"จำนวนภาษีหัก\s*ณ\s*ที่จ่าย\s*\n([\d,]+\.\d{2})", page)
        if not m_inv:
            continue
        amount = float(m_amount.group(1).replace(",", "")) if m_amount else 0.0
        vat = float(m_vat.group(1).replace(",", "")) if m_vat else 0.0
        wht = float(m_wht.group(1).replace(",", "")) if m_wht else round_half_up(amount * 0.03, 2)
        net = round_half_up(amount + vat - wht, 2)
        rows.append(InvoiceRow(
            taxid="0105563089753",
            vendor_customercode=m_code.group(1) if m_code else "",
            vendor_branch="00000",
            invoiceno=m_inv.group(1),
            invoicedate=parse_thai_date(m_date.group(1).replace(".", "/")) if m_date else "",
            amount=amount, vat_7=vat,
            tax_pct=0, tax_2=0, tax_3=wht, tax_5=0,
            netamount=net,
        ))
    return rows


# ============================== PTT (Jiffy) ==============================

def parse_ptt(text: str, filename: str = "", **_kw) -> list[InvoiceRow]:
    """PTT (Jiffy) layout per page (one invoice):
        เลขที่เอกสารบัญชี/Accounting <10-digit>
        วันที่/Date <DD.MM.YYYY>
        รหัสผูขาย/Vendor No.<NL><code>
        <amount> ... รวมจำนวนเงินก่อนภาษีมูลค่าเพิ่ม <amount>
    """
    rows: list[InvoiceRow] = []
    for page in text.split("--- PAGE BREAK ---"):
        if "ปตท" not in page and "PTT" not in page:
            continue
        m_inv = re.search(r"เลขที่เอกสารบัญชี.*?\n(\d{10})", page, re.DOTALL)
        m_date = re.search(r"วันที่\s*/\s*Date\s*\n?\s*(\d{1,2}[\./]\d{1,2}[\./]\d{4})", page)
        # Vendor No on the next line(s) — find the FIRST 7-9 digit number on
        # its own line after the 'Vendor No' label.
        vidx = page.find("Vendor No")
        m_vendor = re.search(r"^(\d{7,9})\s*$", page[vidx:], re.MULTILINE) if vidx >= 0 else None
        m_amount = re.search(r"รวมจำนวนเงินก่อนภาษีมูลค่าเพิ่ม[^\n]*\n(?:[^\n]*\n)*?\s*([\d,]+\.\d{2})", page)
        # Fallback: any X.XX before 'รวมจำนวนเงินก่อนภาษี'
        if not m_amount:
            m_amount = re.search(r"([\d,]+\.\d{2})\s*\n\s*0\.00\s*\n\s*[\d,]+\.\d{2}", page)
        if not m_inv:
            continue
        amount = 0.0
        if m_amount:
            try:
                amount = float(m_amount.group(1).replace(",", ""))
            except ValueError:
                pass
        tax_3 = round_half_up(amount * 0.03, 2)
        net = round_half_up(amount - tax_3, 2)
        rows.append(InvoiceRow(
            taxid="0105537121254",
            vendor_customercode=m_vendor.group(1) if m_vendor else "",
            vendor_branch="00000",
            invoiceno=m_inv.group(1),
            invoicedate=parse_thai_date(m_date.group(1).replace(".", "/")) if m_date else "",
            amount=amount, vat_7=0,
            tax_pct=0, tax_2=0, tax_3=tax_3, tax_5=0,
            netamount=net,
        ))
    return rows


# ============================== Big C Food ==============================

def parse_bigc_food(text: str, filename: str = "", **_kw) -> list[InvoiceRow]:
    """Big C Food layout is the Big C layout (same template):
        ชื่อลูกค้า : <7-digit> สหพัฒนพิบูล ... สำนักงานใหญ่
        เลขที่ : <inv>
        วันที่ : <DD/MM/YYYY>
        ... <code>-<expense_name> ...
        มูลค่ารวม <amount>
        กรุณาหักภาษี ณ. ที่จ่าย 3.00 % = <wht>
    """
    rows: list[InvoiceRow] = []
    for page in text.split("--- PAGE BREAK ---"):
        if "บิ๊กซี ฟู้ด" not in page and "บิ๊กซีฟู้ด" not in page \
                and "บิ๊กซี ฟู๊ด" not in page and "Big C Food" not in page:
            continue
        m_inv = re.search(r"เลขที่\s*:\s*(BC\d+)", page)
        m_date = re.search(r"วันที่\s*:\s*(\d{1,2}/\d{1,2}/\d{4})", page)
        m_code = re.search(r"ชื่อลูกค้า\s*:\s*(\d{7})", page)
        # Big C Food stacks labels and values; the amount appears AFTER
        # "จำนวนเงินรวมทั้งสิ้น" footer block, sometimes several lines later.
        # We find the FIRST positive amount after the "จำนวนเงินรวมทั้งสิ้น"
        # header — that's the subtotal/amount field.
        amount_idx = page.find("จำนวนเงินรวมทั้งสิ้น")
        m_amount = None
        if amount_idx >= 0:
            for m in re.finditer(r"([\d,]+\.\d{2})", page[amount_idx:]):
                val = float(m.group(1).replace(",", ""))
                if val > 0:
                    m_amount = m
                    break
        m_wht = re.search(r"กรุณาหักภาษี\s*ณ\.?\s*ที่จ่าย[\s\n]*(\d+(?:\.\d+)?)\s*%\s*=\s*([\d,]+\.\d{2})", page)
        # Expense code: ANY 5-digit number followed by '-' that occurs AFTER
        # the 'รายการ' (item) label and BEFORE 'หมายเหตุ' (note).
        cut_start = page.find("รายการ")
        cut_end = page.find("หมายเหตุ")
        exp_region = page[cut_start:cut_end] if cut_start >= 0 and cut_end > cut_start else page
        m_exp = re.search(r"(\d{5})-", exp_region)

        if not m_inv:
            continue
        amount = float(m_amount.group(1).replace(",", "")) if m_amount else 0.0
        wht = float(m_wht.group(2).replace(",", "")) if m_wht else round_half_up(amount * 0.03, 2)
        net = round_half_up(amount - wht, 2)
        rows.append(InvoiceRow(
            taxid="0105563176541",
            vendor_customercode=m_code.group(1) if m_code else "",
            vendor_branch="00000",
            vendor_expensecode=m_exp.group(1) if m_exp else "",
            invoiceno=m_inv.group(1),
            invoicedate=parse_thai_date(m_date.group(1)) if m_date else "",
            amount=amount, vat_7=0,
            tax_pct=0, tax_2=0, tax_3=wht, tax_5=0,
            netamount=net,
        ))
    return rows


# ============================== Makro ==============================
#
# Each PDF page is one receipt (one invoice number) that may have multiple
# line items. Gold output uses 'INV-XXX' format: the bare invoice number plus
# '-001', '-002' for each item.
#
# VAT mode is indicated by the header line: pages titled 'ใบเสร็จรับเงิน' only
# have no VAT; pages titled 'ใบเสร็จรับเงิน/ใบกำกับภาษี' apply 7% VAT per
# item. WHT is always 3% per gold convention.

# Makro and LT (Lotus) share issuer taxid 0107567000414. We pre-fill the
# Makro customer group/code directly so the Customer Master lookup doesn't
# accidentally return the LT entry.
MAKRO_CUSTOMERGROUP = "04 - ซีพี แอ็กซ์ตร้า(Makro)"
MAKRO_CUSTOMERCODE = "0118808 - บริษัท ซีพี แอ็กซ์ตร้า จำกัด (มหาชน) สำนักงานใหญ่"

MAKRO_INV_RE = re.compile(r"เลขที่\s*\n?\s*NO\.?\s*\n?\s*(\d{8})")
MAKRO_BUYER_RE = re.compile(r"\((\d{7})\)")
MAKRO_THAI_DATE_RE = re.compile(r"(\d{1,2}\s+\S+\s+\d{4})")


def parse_makro(text: str, filename: str = "", **_kw) -> list[InvoiceRow]:
    rows: list[InvoiceRow] = []
    for page in text.split("--- PAGE BREAK ---"):
        if "makro" not in page.lower() and "AXTRA" not in page.upper() \
                and "แอ็กซ์ตร้า" not in page and "แอ๊กซ์ตร้า" not in page:
            continue
        m_inv = MAKRO_INV_RE.search(page)
        if not m_inv:
            continue
        invoice_no = m_inv.group(1)

        m_buyer = MAKRO_BUYER_RE.search(page)
        buyer = m_buyer.group(1) if m_buyer else ""

        m_date = MAKRO_THAI_DATE_RE.search(page)
        invoice_date = parse_thai_date(m_date.group(1)) if m_date else ""

        is_vat = "/ใบกำกับภาษี" in page or "ใบกำกับภาษี" in page.split("เลขที่", 1)[0]

        # Extract line-item amounts in order. Two layouts:
        #  (a) '<amount> <line_no>'  on its own line (e.g. '1,664.61 1')
        #  (b) Amount values stacked, then line numbers stacked separately:
        #        1,664.61
        #        4,161.52
        #        1
        #        2
        # We pick the region BETWEEN the 'Amount' header and the 'TOTAL' line
        # and pull every X.XX value out — this naturally captures both layouts.
        amounts: list[float] = []
        start = page.find("Amount")
        if start < 0:
            start = page.find("จำนวนเงิน (บาท)")
        # End at the FIRST totals marker — either 'จำนวนเงินรวม (TOTAL)' on
        # multi-item pages, OR the WHT preamble 'บมจ.ซีพี แอ็กซ์ตร้า ได้หัก'
        # which appears earlier when the totals block is split.
        end = page.find("จำนวนเงินรวม (TOTAL)")
        if end < 0:
            end = page.find("จำนวนเงินรวม")
        wht_idx = page.find("บมจ.ซีพี แอ็กซ์ตร้า ได้หัก")
        if wht_idx < 0:
            wht_idx = page.find("บมจ.บีพี แอ๊กซ์ตร้า ได้หัก")  # OCR variant
        if wht_idx > 0 and (end < 0 or wht_idx < end):
            end = wht_idx
        if start >= 0 and end > start:
            region = page[start:end]
            amounts = [
                float(m.group(1).replace(",", ""))
                for m in re.finditer(r"([\d,]+\.\d{2})", region)
            ]

        for i, amt in enumerate(amounts, start=1):
            vat = round_half_up(amt * 0.07, 2) if is_vat else 0.0
            tax_3 = round_half_up(amt * 0.03, 2)
            net = round_half_up(amt + vat - tax_3, 2)
            rows.append(InvoiceRow(
                customergroup=MAKRO_CUSTOMERGROUP,
                customercode=MAKRO_CUSTOMERCODE,
                taxid="0107567000414",
                vendor_customercode=buyer,
                vendor_branch="00000",
                invoiceno=f"{invoice_no}-{i:03d}",
                invoicedate=invoice_date,
                amount=amt, vat_7=vat,
                tax_pct=0, tax_2=0, tax_3=tax_3, tax_5=0,
                netamount=net,
            ))
    return rows


# ============================== Villa Market ==============================
#
# Per-page layout:
#   DC\n<code>             ← vendor_customercode (e.g. '059', 'F258')
#   เลขที่สัญญา <inv>      ← invoice number (6 digits)
#   วันที่แจ้งหนี้ <date>   ← invoice date DD/MM/YYYY
#
# The amount block stacks labels first then values:
#   จำนวนเงิน               (amount)
#   บวก ภาษีมูลค่าเพิ่ม 7%   (vat)
#   หัก ภาษีหัก ณ ที่จ่าย 3% (wht)
#   รวมเงินทั้งสิ้น          (net)
#   ...
#   1.65% บาท              (percent line)
#   <amount> บาท
#   <vat> บาท
#   <wht> บาท
#   <net> บาท

VILLA_INV_RE = re.compile(r"เลขที่สัญญา\s+(\d+)")
VILLA_DATE_RE = re.compile(r"วันที่แจ้งหนี้\s+(\d{1,2}/\d{1,2}/\d{4})")
# Customer code: DC<newline><code>  OR  similar isolation; capture short
# alnum tokens near the top of the page.
VILLA_CODE_LINE_RE = re.compile(r"^\s*(F\d{3}|\d{3,4})\s*$", re.MULTILINE)
# Sequence of 4 amount lines ending with 'บาท' that look like the totals block.
VILLA_TOTALS_RE = re.compile(
    r"%\s*บาท\s*\n([\d,]+\.\d{2})\s*บาท\s*\n"
    r"([\d,]+\.\d{2})\s*บาท\s*\n"
    r"([\d,]+\.\d{2})\s*บาท\s*\n"
    r"([\d,]+\.\d{2})\s*บาท"
)


def parse_villa(text: str, filename: str = "", **_kw) -> list[InvoiceRow]:
    rows: list[InvoiceRow] = []
    for page in text.split("--- PAGE BREAK ---"):
        if "วิลล่า" not in page and "Villa" not in page:
            continue
        m_inv = VILLA_INV_RE.search(page)
        if not m_inv:
            continue
        invoice_no = m_inv.group(1)
        m_date = VILLA_DATE_RE.search(page)
        invoice_date = parse_thai_date(m_date.group(1)) if m_date else ""

        # Customer code: a short token on a line, '<3-4 digits>' or 'F<3 digits>'.
        # The OCR sometimes places it just before the page-of-30 header, so we
        # search the ENTIRE page text for a line that matches and pick the
        # first one that ISN'T '591' (the vendor address number).
        cust = ""
        for m in VILLA_CODE_LINE_RE.finditer(page):
            tok = m.group(1)
            if tok in {"591", "1010", "688"}:  # vendor address tokens
                continue
            cust = tok
            break

        # The four totals (amount, vat, wht, net) are the LAST four 'NNN.NN บาท'
        # entries on the page. Some pages have an extra leading purchase total
        # above; taking the last 4 isolates the relevant block.
        amount = vat = tax_3 = net = 0.0
        baht_amounts = re.findall(r"([\d,]+\.\d{2})\s*บาท", page)
        if len(baht_amounts) >= 4:
            amount = float(baht_amounts[-4].replace(",", ""))
            vat = float(baht_amounts[-3].replace(",", ""))
            tax_3 = float(baht_amounts[-2].replace(",", ""))
            net = float(baht_amounts[-1].replace(",", ""))

        rows.append(InvoiceRow(
            taxid="0105531013646",
            vendor_customercode=cust,
            vendor_branch="00000",
            invoiceno=invoice_no,
            invoicedate=invoice_date,
            amount=amount, vat_7=vat,
            tax_pct=0, tax_2=0, tax_3=tax_3, tax_5=0,
            netamount=net,
        ))
    return rows


# ============================== The Mall ==============================
#
# Each PDF page is one invoice from a branch of the Mall/City Mall/Emporium/
# Paragon/Promenade/Korat group. The issuer varies (and so does the taxid).
#
# Landmarks per page:
#   Issuer line:  'บริษัท <NAME> จำกัด สำนักงานใหญ่' OR 'สาขาที่ <NNNNN>'
#   Tax ID:       'เลขประจำตัวผู้เสียภาษีอากร (Tax ID.) 0105540016253'
#   ชื่อลูกค้า:    'SHP00 ...' or 'SHP20 ...'  (the buyer-code prefix)
#   เลขที่ / No:  '2026/2612014382' on a value line
#   Date:         'DD.MM.YYYY' on a value line
#   Subtotal:     'รวมจำนวนเงินที่ไม่มีภาษีมูลค่าเพิ่ม 1,199.00'  (Total Amount Without Vat)
#
# WHT: gold uses 3% computed (CR convention), no VAT.

THEMALL_TAXID_RE = re.compile(r"\(Tax ID\.?\)\s*(\d{13})")
THEMALL_SHP_RE = re.compile(r"\b(SHP\d{2})\b")
THEMALL_BRANCH_RE = re.compile(r"สาขาที่\s*0*(\d{4,5})", )
THEMALL_HQ_RE = re.compile(r"สำนักงานใหญ่")
# Some pages OCR the invoice number with a space between '2026' and the
# 10-digit suffix ('2026 / 2607000294'); we strip whitespace from the match.
THEMALL_INV_RE = re.compile(r"(2026\s*/\s*2\d{9})")
THEMALL_DATE_RE = re.compile(r"(\d{1,2}[\./]\d{1,2}[\./]\d{4})")
# The OCR for The Mall stacks LABELS first and VALUES below. The first value
# after the 'Total Amount' header is the no-VAT subtotal (= the 'amount' field
# in gold). Single-item invoices may have only ONE value after 'Total Amount'
# before the next label block — match a single value too.
THEMALL_TOTAL_BLOCK_RE = re.compile(
    r"จำนวนเงินรวม\s*\n\s*Total Amount\s*\n((?:\s*[\d,]+\.\d{2}\s*\n)+)",
)


def parse_themall(text: str, filename: str = "", **_kw) -> list[InvoiceRow]:
    rows: list[InvoiceRow] = []
    for page in text.split("--- PAGE BREAK ---"):
        if "เดอะมอลล์" not in page and "ซิตี้มอลล์" not in page \
                and "EM DISTRICT" not in page and "EMPORIUM" not in page \
                and "พารากอน" not in page and "พรอมานาด" not in page \
                and "พรอมมานาด" not in page and "PROMENADE" not in page \
                and "THE MALL" not in page:
            continue
        m_inv = THEMALL_INV_RE.search(page)
        if not m_inv:
            continue
        # Strip any internal whitespace from the invoice number (Gemini OCR
        # sometimes inserts spaces around the slash: '2026 / 2607000294').
        invoice_no = re.sub(r"\s+", "", m_inv.group(1))

        m_taxid = THEMALL_TAXID_RE.search(page)
        m_shp = THEMALL_SHP_RE.search(page)

        # Branch: explicit 'สาขาที่ NNNNN' wins; else 'สำนักงานใหญ่' → 00000.
        branch = "00000"
        if (m := THEMALL_BRANCH_RE.search(page)):
            branch = m.group(1).zfill(5)

        # Date: take the first DD.MM.YYYY (4-digit year, distinguishes from
        # 2-digit-year strings on other layouts) that appears AFTER the
        # invoice number line.
        date_str = ""
        tail = page[m_inv.end():]
        m_date = THEMALL_DATE_RE.search(tail)
        if m_date:
            date_str = parse_thai_date(m_date.group(1).replace(".", "/"))

        # Take the FIRST value from the totals stack — this is the no-VAT
        # subtotal (= the amount field in gold).
        amount = 0.0
        if (m := THEMALL_TOTAL_BLOCK_RE.search(page)):
            values = [v.strip() for v in m.group(1).strip().splitlines() if v.strip()]
            if values:
                amount = float(values[0].replace(",", ""))

        tax_3 = round_half_up(amount * 0.03, 2)
        net = round_half_up(amount - tax_3, 2)
        rows.append(InvoiceRow(
            taxid=m_taxid.group(1) if m_taxid else "",
            vendor_customercode=m_shp.group(1) if m_shp else "",
            vendor_branch=branch,
            invoiceno=invoice_no,
            invoicedate=date_str,
            amount=amount, vat_7=0,
            tax_pct=0, tax_2=0, tax_3=tax_3, tax_5=0,
            netamount=net,
        ))
    return rows


# ============================== CP All (7-Eleven) ==============================
#
# CP_ALL_Invoice.pdf has multiple invoices spread across pages. Each invoice
# starts with a "ใบแจ้งหนี้" header and ends before the next or at EOF.
#
# Line items have the pattern "<...> <amount>.00 บาท" inline. The page tail
# carries totals ("รวม X,XXX.XX", "บวก ภาษีมูลค่าเพิ่ม", "หัก ณ ที่จ่าย",
# "จำนวนเงินทั้งสิ้นที่ต้องชำระ").
#
# WHT handling (per Output.xlsx convention):
#   - Penalty invoices ("ค่าปรับ" prefix on items) have no WHT.
#   - Other invoices default to 3% WHT on each line item even when the printed
#     "หัก ณ ที่จ่าย" shows 0.00 (handled the same way as CFW Netting:Credit).

CP_ALL_INVOICE_HEADER_RE = re.compile(
    r"เลขที่\s*:\s*(\d{10})\s*\n.*?วันที่\s*:\s*(\d{1,2}[\./]\d{1,2}[\./]\d{4})",
    re.DOTALL,
)
# OCR layout has the LABELS stacked first, then the VALUES stacked below — so a
# direct 'รหัสลูกค้า : <value>' regex misses it. Instead we look for the first
# 7-digit number followed by 'สำนักงานใหญ่', which is the customer code line.
CP_ALL_CUST_RE = re.compile(r"^(\d{7})\s+สำนักงานใหญ่", re.MULTILINE)
CP_ALL_LINE_AMT_RE = re.compile(r"([\d,]+\.\d{2})\s*บาท")
# Section split marker
CP_ALL_PAGE_SECTION_SPLIT = "ใบแจ้งหนี้"


def _split_cp_all_invoices(text: str) -> list[str]:
    """Group OCR pages into invoice 'sections' by invoice number.

    A single invoice can span multiple pages (e.g. 3400050708 covers pages
    1-3). We group by the (invoice_no, customer_code) header — pages with the
    same header are merged into one section.
    """
    pages = text.split("--- PAGE BREAK ---")
    sections: list[str] = []
    current_key: tuple[str, str] | None = None
    buffer: list[str] = []
    last_inv = "?"
    last_cust = "?"
    for p in pages:
        m_inv = re.search(r"เลขที่\s*:[^\n]*\n(?:[^\n0-9]+:[^\n]*\n)*\s*(\d{10})", p)
        m_cust = CP_ALL_CUST_RE.search(p)
        # Carry forward the last invoice/cust on continuation pages.
        if m_inv:
            last_inv = m_inv.group(1)
        if m_cust:
            last_cust = m_cust.group(1)
        key = (last_inv, last_cust)
        if key != current_key:
            if buffer:
                sections.append("\n".join(buffer))
            buffer = [p]
            current_key = key
        else:
            buffer.append(p)
    if buffer:
        sections.append("\n".join(buffer))
    return sections


CP_ALL_TABLE_PROMPT = """This is a Thai CP All / 7-Eleven / All Speedy invoice page.
Look at the 'รายการ' / Description column. Each line item begins with a phrase
like "ค่าปรับ P/O <10-digit-PO-number>" or "Redemption-Supplier" or a similar
prefix, then a product description, then an amount in baht.

Your job: enumerate EVERY line item visible on this page — INCLUDING items
whose baht amount wraps to the next visual line. Then output:

{
  "invoice_no": "<the 10-digit เลขที่ at the top>",
  "invoice_date": "<DD.MM.YYYY or DD/MM/YYYY as printed>",
  "customer_code": "<the 7-digit รหัสลูกค้า>",
  "items": [
    {"po_number": "1012026867", "amount": 3000.0},
    {"po_number": "1012028108", "amount": 3000.0},
    ...
  ]
}

CRITICAL RULES:
- DO NOT SUMMARISE. List every distinct row in the table.
- A 3-page CP All invoice can have 22+ rows total. Page counts at the top
  (e.g. "หน้า 1/3") tell you it's multi-page; you only see one page at a time.
- Output ONLY the JSON object — no markdown fences, no explanation.
- amount is a JSON number (no comma, no currency symbol).
- If a P/O number appears with NO visible baht amount on this page, skip it
  rather than guessing.
"""


def _cp_all_structured(page_pngs: list[bytes] | None,
                       fallback_section: str = "") -> tuple[str, str, str, list[float]]:
    """Re-OCR the page(s) of one CP All invoice and return (inv_no, date,
    cust, [amounts])."""
    if not page_pngs:
        return ("", "", "", [])
    import json as _json
    from app.ocr_cache import ocr_page_with_prompt_cached_sync

    all_items: list[float] = []
    inv_no = ""
    date_str = ""
    cust = ""
    for i, png in enumerate(page_pngs):
        try:
            raw = ocr_page_with_prompt_cached_sync(
                png, CP_ALL_TABLE_PROMPT, tag=f"cpall-p{i+1}"
            )
        except Exception:
            continue
        s = raw.strip()
        s = re.sub(r"^```(?:json)?\s*", "", s)
        s = re.sub(r"\s*```\s*$", "", s)
        try:
            data = _json.loads(s)
        except _json.JSONDecodeError:
            continue
        if data.get("invoice_no") and not inv_no:
            inv_no = str(data["invoice_no"])
        if data.get("invoice_date") and not date_str:
            date_str = str(data["invoice_date"])
        if data.get("customer_code") and not cust:
            cust = str(data["customer_code"])
        for item in data.get("items", []):
            try:
                all_items.append(float(item.get("amount", 0)))
            except (TypeError, ValueError):
                pass
    return (inv_no, date_str, cust, all_items)


def parse_cp_all(text: str, filename: str = "", **kw) -> list[InvoiceRow]:
    rows: list[InvoiceRow] = []
    page_pngs = kw.get("page_pngs") or []

    # Build a map from (inv_no, cust) → list of page indices.  Multi-page
    # invoices show their header (inv-no + dates) only on the FIRST page;
    # continuation pages carry the SAME invoice number — we propagate it.
    pages = text.split("--- PAGE BREAK ---")
    invoice_pages: dict[tuple[str, str], list[int]] = {}
    current_key: tuple[str, str] | None = None
    for idx, p in enumerate(pages):
        m_inv = re.search(r"เลขที่\s*:[^\n]*\n(?:[^\n0-9]+:[^\n]*\n)*\s*(\d{10})", p)
        m_cust = CP_ALL_CUST_RE.search(p)
        if m_inv and m_cust:
            current_key = (m_inv.group(1), m_cust.group(1))
        if current_key is not None:
            invoice_pages.setdefault(current_key, []).append(idx)

    for section in _split_cp_all_invoices(text):
        if "CP ALL" not in section.upper() and "ซีพี ออลล์" not in section and "สปีดดี้" not in section:
            continue
        m_inv = re.search(r"เลขที่\s*:\s*(\d{10})", section)
        m_date = re.search(r"วันที่\s*:\s*(\d{1,2}[\./]\d{1,2}[\./]\d{4})", section)
        m_cust = CP_ALL_CUST_RE.search(section)
        if not (m_inv and m_date):
            continue
        invoice_no = m_inv.group(1)
        # Date format on CP All: "12.03.2026" (with dots) or "12/03/2026".
        date_str = m_date.group(1).replace(".", "/")
        invoice_date = parse_thai_date(date_str)
        cust = m_cust.group(1) if m_cust else ""

        # All Speedy = same group as CP All; use its actual issuer taxid.
        is_all_speedy = "ALL SPEEDY" in section.upper()
        taxid = "0105565017547" if is_all_speedy else "0107542000011"
        # Customer Master has CP All but NOT All Speedy under its own taxid.
        # Per the existing rules, All Speedy rows still map to '07 - 7-Eleven'
        # (same customer group as CP All). Pre-fill the customer fields so the
        # Master lookup (which would otherwise return empty for All Speedy)
        # gets the right values.
        cp_all_group = "07 - เซเว่นอีเลฟเว่น (7-11)"
        cp_all_code = "0201553 - บริษัท ซีพี ออลล์ จำกัด (มหาชน) สำนักงานใหญ่"

        # CP All convention: penalty invoices skip WHT; everything else gets 3%.
        is_penalty = "ค่าปรับ" in section
        wht_rate = 0.0 if is_penalty else 0.03

        # First pass: regex over the cached OCR text (cheap).
        regex_amounts = [
            float(m.group(1).replace(",", ""))
            for m in CP_ALL_LINE_AMT_RE.finditer(section)
        ]

        # Second pass: for multi-page invoices whose default OCR dropped some
        # baht-suffixes (common when the OCR splits 'NN.NN <marker>\nบาท'),
        # re-OCR just THIS invoice's pages with a JSON-format prompt that
        # asks Gemini to enumerate every line item. The cache keys on the
        # page image, so paying this is a one-time cost per PDF.
        idxs = invoice_pages.get((invoice_no, cust), [])
        pngs_for_inv = [page_pngs[i] for i in idxs if i < len(page_pngs)] if page_pngs else []
        structured_inv_no, _, _, structured_amounts = _cp_all_structured(
            pngs_for_inv, fallback_section=section,
        )

        # Prefer structured when it found more items.
        line_amounts = (
            structured_amounts if len(structured_amounts) > len(regex_amounts)
            else regex_amounts
        )

        if not line_amounts:
            # Single-line invoice that only shows the amount in the totals
            # block (e.g. 3400070230 'Redemption-Supplier' which prints just
            # the total amount). Use the printed total.
            m_total = re.search(r"รวม\s+([\d,]+\.\d{2})", section)
            if m_total:
                line_amounts = [float(m_total.group(1).replace(",", ""))]

        for amt in line_amounts:
            tax_3 = round_half_up(amt * wht_rate, 2) if wht_rate else 0.0
            net = round_half_up(amt - tax_3, 2)
            rows.append(InvoiceRow(
                customergroup=cp_all_group,
                customercode=cp_all_code,
                taxid=taxid,
                vendor_customercode=cust,
                vendor_branch="00000",
                invoiceno=invoice_no,
                invoicedate=invoice_date,
                amount=amt, vat_7=0,
                tax_pct=0, tax_2=0, tax_3=tax_3, tax_5=0,
                netamount=net,
            ))
    return rows
