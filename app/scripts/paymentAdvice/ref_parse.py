# -*- coding: utf-8 -*-
"""Golden-reference generator for the Payment Advice port.

Runs the coworker's EXACT parsing logic (copied verbatim from
P1 Makro PDF AR/app.py extract_one, minus the Flask JOBS progress updates) via
pdfplumber, and dumps the structured result as JSON. The TS port must reproduce
this output. Verification only — not shipped.

Usage: python ref_parse.py <pdf_path> > golden.json
"""
import re, sys, json
import pdfplumber

DATE_RE  = re.compile(r'^\d{2}/\d{2}/\d{2}$')
PAYEE_RE = re.compile(r'Payee\s*:\s*(\S+)')
SITE_RE  = re.compile(r'Site\s*:\s*(\S+)')
EMAIL_RE = re.compile(r'Email/Fax\s+No\s*:\s*(\S+)', re.IGNORECASE)
REF_RE   = re.compile(r'Our Reference:\s*(\S+)')
VALDATE_RE = re.compile(r'Value Date:\s*(\S+)')
TOTAL_RE = re.compile(r'^Total\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})$')
XFER_RE  = re.compile(r'Transferred Amount:\s*([\d,]+\.\d{2})')

def _amt(s): return round(float(s.replace(",", "")), 2)

def extract_one(pdf_path, orig_name):
    result = {"filename": orig_name, "reference": "", "value_date": "",
              "transferred_amount": 0.0, "stores": []}
    current = None
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if not text:
                continue
            for line in text.split("\n"):
                line = line.strip()
                if not line:
                    continue
                m = REF_RE.search(line)
                if m and not result["reference"]:
                    result["reference"] = m.group(1); continue
                m = VALDATE_RE.search(line)
                if m and not result["value_date"]:
                    result["value_date"] = m.group(1); continue
                m = XFER_RE.search(line)
                if m and not result["transferred_amount"]:
                    result["transferred_amount"] = _amt(m.group(1)); continue
                m = PAYEE_RE.search(line)
                if m:
                    if current:
                        result["stores"].append(current)
                    current = {"payee": m.group(1), "site": "", "email": "",
                               "pdf_total_invoice": 0.0, "pdf_total_wht": 0.0,
                               "pdf_total_transfer": 0.0, "invoices": []}
                    continue
                m = SITE_RE.search(line)
                if m and current and not current["site"]:
                    current["site"] = m.group(1); continue
                m = EMAIL_RE.search(line)
                if m and current:
                    current["email"] = m.group(1); continue
                m = TOTAL_RE.match(line)
                if m and current:
                    current["pdf_total_invoice"] = _amt(m.group(1))
                    current["pdf_total_wht"]      = _amt(m.group(2))
                    current["pdf_total_transfer"] = _amt(m.group(3))
                    continue
                parts = line.split()
                if len(parts) >= 6 and DATE_RE.match(parts[0]) and current:
                    try:
                        xfer_amt = _amt(parts[-1]); wht_amt = _amt(parts[-2]); inv_amt = _amt(parts[-3])
                        raw_inv = parts[1]; desc = parts[2:-3]; inv_seq = 1
                        if '|' in raw_inv:
                            base, _, seq_str = raw_inv.partition('|')
                            raw_inv = base; inv_seq = int(seq_str) if seq_str.isdigit() else 1
                            store_code = desc[0] if desc else ""; ref_code = desc[1] if len(desc) > 1 else ""
                        elif len(desc) >= 2 and desc[0] == '|' and desc[1].isdigit():
                            inv_seq = int(desc[1]); store_code = desc[2] if len(desc) > 2 else ""; ref_code = desc[3] if len(desc) > 3 else ""
                        else:
                            store_code = desc[0] if desc else ""; ref_code = desc[1] if len(desc) > 1 else ""
                        current["invoices"].append({
                            "inv_date": parts[0], "inv_number": raw_inv, "inv_seq": inv_seq,
                            "store_code": store_code, "reference": ref_code,
                            "inv_amount": inv_amt, "wht_amount": wht_amt, "transfer_amount": xfer_amt,
                        })
                    except (ValueError, IndexError):
                        pass
    if current:
        result["stores"].append(current)
    return result

if __name__ == "__main__":
    import os
    path = sys.argv[1]
    data = extract_one(path, os.path.basename(path))
    sys.stdout.write(json.dumps(data, ensure_ascii=False))
