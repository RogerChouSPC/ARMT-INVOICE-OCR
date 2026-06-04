# -*- coding: utf-8 -*-
"""Generate vendor-map.json pairing each input PDF folder with its ground-truth
Excel register and the expected customers.ts rule id.

Run:  python app/scripts/eval/gen_vendor_map.py
Output: app/scripts/eval/vendor-map.json (paths are absolute)

This avoids embedding Thai strings in the TS harness — the harness just reads
the JSON. Re-run if the dataset folders change."""
import os, re, json, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))  # ARMT-INVOICE-OCR
INPUT_DIR = os.path.join(REPO, 'INVOICE JAN-APR', 'INVOICE JAN-APR')
OUTPUT_DIR = os.path.join(REPO, 'OUTPUT JAN-APR', 'OUTPUT JAN-APR')

# code -> distinctive Thai (or ascii) substring found in the INPUT folder name
FOLDER_HINT = {
    'CJ': 'ซีเจ',
    'TSURUHA': 'ซูรูฮะ',
    'BTM': 'บิวเทรี่ยม',
    'MM': '(MM)',
    'BOOTS': 'บู๊สท์',
    'PT': 'ปิโตรเลี่ยม',
    'FOODLAND': 'ฟู้ดแลนด์',
    'VILLA': 'วิลล่า',
    'AEON': 'อิออน',
    'CFM': 'ฟู้ด มินิมาร์เก็ต',
    'CFR': 'ฟู้ด รีเทล',
    'CFW': 'ฟู้ด โฮลเซลล์',
    'CMK': 'มัทสึโมโตะ',
    'WATSON': 'วัตสัน',
    'THE MALL': 'เดอะมอลล์',
    'TFM': 'เฟรช',
    'MAKRO': '(MAKRO)',
    'CP ALL': 'ซีพีออลล์',
    'LOTUS': '(LOTUS)',
    'BigC': 'ซูเปอร์เซ็นเตอร์',
    'PTT': 'ปตท',
    'HOMEPRO': 'โฮม โปรดักส์',
}

# code -> customers.ts rule id (expected). None = no rule exists for this vendor.
CUSTOMER_ID = {
    'CJ': 'CJ', 'TSURUHA': 'TSURUHA', 'BTM': 'BTM', 'MM': 'BIGC_FOOD',
    'BOOTS': 'BOOTS', 'PT': None, 'FOODLAND': 'FOODLAND', 'VILLA': 'VILLA',
    'AEON': 'AEON', 'CFM': 'CFM', 'CFR': 'CFR', 'CFW': 'CFW', 'CMK': 'CMK',
    'WATSON': 'WATSON', 'THE MALL': 'THEMALL', 'TFM': None, 'MAKRO': 'MAKRO',
    'CP ALL': 'CP_ALL', 'LOTUS': 'LT', 'BigC': 'BIGC', 'PTT': 'PTT',
    'HOMEPRO': 'HOMEPRO',
}

def out_code(fn):
    m = re.findall(r'\(([^)]*)\)', fn)
    return m[-1].strip() if m else None

def main():
    folders = [d for d in os.listdir(INPUT_DIR) if os.path.isdir(os.path.join(INPUT_DIR, d))]
    files = [f for f in os.listdir(OUTPUT_DIR) if f.lower().endswith('.xlsx') and not f.startswith('~')]
    by_code = {}
    for f in files:
        c = out_code(f)
        if c:
            by_code[c] = f

    vendors = []
    errors = []
    for code, hint in FOLDER_HINT.items():
        matched = [d for d in folders if hint in d]
        if len(matched) != 1:
            errors.append(f'INPUT folder for {code!r} (hint {hint!r}) matched {len(matched)}: {matched}')
            continue
        if code not in by_code:
            errors.append(f'OUTPUT file for code {code!r} not found')
            continue
        vendors.append({
            'code': code,
            'expectedCustomerId': CUSTOMER_ID[code],
            'inputDir': os.path.join(INPUT_DIR, matched[0]),
            'outputFile': os.path.join(OUTPUT_DIR, by_code[code]),
            'pdfCount': len([p for p in os.listdir(os.path.join(INPUT_DIR, matched[0])) if p.lower().endswith('.pdf')]),
        })

    if errors:
        print('VENDOR MAP ERRORS:', file=sys.stderr)
        for e in errors:
            print('  -', e, file=sys.stderr)
        sys.exit(1)

    vendors.sort(key=lambda v: v['code'])
    out_path = os.path.join(HERE, 'vendor-map.json')
    with open(out_path, 'w', encoding='utf-8') as fh:
        json.dump(vendors, fh, ensure_ascii=False, indent=2)
    print(f'Wrote {out_path} with {len(vendors)} vendors (expected 22).')
    for v in vendors:
        print(f"  {v['code']:9} -> {str(v['expectedCustomerId']):9} ({v['pdfCount']:3} pdfs)")

if __name__ == '__main__':
    main()
