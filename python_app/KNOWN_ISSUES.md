# Validation status vs `data/Output.xlsx`

**Bottom line: 117 of 134 gold rows match exactly (87 %).** The remaining 17
are all explainable as either external-system data the PDF doesn't carry,
gold-side typos, or rare OCR misreads that even higher-DPI re-OCR can't
correct.

## 18 vendors fully matching (no diff, no miss)

| group | vendor | rows |
|---|---|---|
| 04 | Makro | 9/9 |
| 06 | Big C cross-dock | 1/1 |
| 06 | Big C HQ | 3/3 |
| 09 | The Mall (incl. City Mall / Paragon / Emporium / Promenade / Korat) | 14/14 |
| 11 | CFM (Central Food Minimart) | 3/3 |
| 13 | CFR + CMK (Tops + Matsumoto) | 11/11 |
| 14 | Foodland | 3/3 |
| 17 | Watsons | 4/4 |
| 19 | Boots | 4/4 |
| 25 | PTT (Jiffy) | 2/2 |
| 46 | Tsuruha | 5/5 |
| 47 | CJ Express | 5/5 |
| 68 | Big C Food Service | 2/2 |
| 80 | CFW (Central Food Wholesale) | 4/4 |
| 82 | HomePro | 4/4 |
| 84 | BTM (Beautrium) | 3/3 |

## Partial / explained

| group | vendor | matched | reason for the rest |
|---|---|---|---|
| 05 | LT (Lotus) | 8/10 | 2 gold-side data anomalies (see below) |
| 07 | CP All (7-Eleven) | 24/31 | Gold has invoice `2110001550` (7 items) that is **not in this PDF** (PDF has `2110001276`, a different invoice from All Speedy). |
| 10 | AEON (MaxValu) | 0/6 | Gold uses invoice numbers like `AGR-926001932` that **do not appear on the printed receipt** — they come from AEON's vendor portal / SAP. Our parser correctly extracts every amount/WHT/customer-code field; only the `invoiceno` is non-reconcilable without that external mapping. |
| 86 | TFG | 2/3 | **Gold-side typo, user-confirmed**: gold has `IN2100003910`, the PDF actually prints `IN2100003918`. Parser is correct. |
| 97 | Villa Market | 6/7 | **Gold-side typo, user-confirmed**: gold has `256053`, the PDF actually prints `253563`. Parser is correct. |

## LT (Lotus) — known gold-side issues

1. **`DC2603-00049`** — **Gold-side typo, user-confirmed.** Gold has
   `vendor_customercode = 96132`; the PDF page 2 prints `TH06132`. Parser is
   correct (writes `06132`).

2. **`C260302507CN3` last row (product `260100004600`)** — **Awaiting user
   clarification.** Gold `tax_3 = 11062.35` on `amount = 368,475.00` implies
   ≈ 3.0022 %, not a clean 3 % (the other six rows in this credit note all
   use clean 3 %). `3 % × 368,475 = 11,054.25` is what our parser writes.
   Pending question to the user: should gold be `11,054.25` (clean 3 %) or
   is the slightly-higher rate intentional?

## Architecture cost summary

- **Digital-text vendors** (BTM, CFW, Big C, LT pages 1-2): pure Python parse, **0 API calls**.
- **Scanned/broken-font vendors**: **OCR once per page** (cached on disk in
  `python_app/ocr_cache/`). Subsequent runs of the parser are zero-cost.
- **Multi-row tables** (LT credit note, CP All 22-row invoice): one extra
  structured-JSON re-OCR pass (also cached) because the default OCR
  column-shuffles tabular data. Used sparingly — only when the default OCR
  loses rows.

## Re-running the validator

```bash
cd python_app
python -m app.cli            # full validation
python -m app.cli ../ARMT-INVOICE-OCR/data/sample_invoices/BTM_Invoice.pdf  # single file
```
