# PROGRESS.md

Running log of changes made each session. Most-recent entry first.
Update this file at the end of every working session.

---

## 2026-05-25 — Session: ken-app-migrate-docker

### Completed

#### LT — switch to position-based invoice-number whitelist
- Replaced the strict anchored regex with `findLTInvoiceCandidates()` that scans the OCR text with BROAD patterns and builds a set of every invoice-number candidate that actually appears in the source.  The filter now keeps any LLM extraction whose invoiceno is present in that set.
- Why: a tight `^...$` regex would reject any future Lotus variation (different digit count, optional dash, etc.) even when the value is genuinely printed on the page.  Position-based validation accepts those because the whitelist comes from the printed text — yet still drops hallucinations like "P00030007P0N" because the LLM can't fabricate something that's also coincidentally in the OCR.

#### LT — drop hallucinated invoice numbers + clarify Format D VAT trap
- **Bug**: a 15-page Lotus PDF (mixed Credit Note / Tax Invoice / Monthly Discount) produced a fake row with invoiceno `P00030007P0N` and a fabricated `vat_7` value. That invoice number doesn't exist in the PDF — it was an LLM hallucination, likely seeded by Format-D column headers (`จำนวนเงินรวม VAT 7%`, `TAB 7%`) that the LLM mistook for VAT amounts.
- **Fix #1** (`extract.ts`): added a strict regex filter in the LT post-processing block that drops any row whose `invoiceno` doesn't match one of the 4 known LT shapes:
  - `C\d{9}(CN|CV)\d` (Credit Note)
  - `BH\d{4}-\d{5}` (Tax Invoice)
  - `A\d{9}` (Receipt line)
  - `M\d{9}MDN` (Monthly Discount)
- **Fix #2** (`customers.ts`): added explicit Format-D guidance that "VAT 7%" / "TAB 7%" / "DISPLAY %" / "MD %" are column-header LABELS for total/discount columns, NOT VAT amounts. Plus a global note that invoiceno MUST match one of the 4 patterns or the row should be omitted.

#### Fix: phantom VAT 7% on invoices that have no VAT
- **Bug**: `hasNonZeroVat()` fallback scans the 4 lines after "ภาษีมูลค่าเพิ่ม" and returns the first decimal it finds. On Lotus credit notes (and other vendors), the nearest decimal is often the AMOUNT or TOTAL column — not the VAT cell — so the function returned `true` even when VAT was 0.00. That triggered `vat_7 = amount × 0.07` on rows that should have had `vat_7 = 0`.
- **Fix**: narrowed the VAT/WHT3 calculation block in `extract.ts` to `customerId === 'MAKRO'` only. Makro is the only vendor that prints grand-total-only VAT and needs per-line splitting; every other customer either prints per-line VAT (LLM extracts it) or has no VAT (must stay 0). Removed the now-unused `skipVatCalc` workaround for CFR (CFR isn't Makro so it wouldn't have triggered anyway) and the dead `hasWithholdingTax3()` function.

#### LT — support 4 invoice formats + TH→9 vendor code conversion
- `customers.ts`: rewrote LT `notes` as a 4-format guide. Each format has its own recognition cues and per-field mapping:
  - **Format A** — Credit Note Compensate Confirmation Report (Cxxx CN3/CV3)
  - **Format B** — Tax Invoice with No/Item Category/Description/UOM/Quantity/Unit Price/Amount table (BHxxxx)
  - **Format C** — Receipt with ลำดับ/เลขที่ใบแจ้งหนี้/วันที่ใบแจ้งหนี้/รายการ/จำนวนเงิน table (282434-style)
  - **Format D** — Monthly Discount invoice (Mxxx MDN), one row per invoice grand total
- `extract.ts`: 
  - `findLTDescription()` rewritten to override description ONLY for invoice-level cases (A: JNxx/JVxx/SNxx/SVxx/ONxx code line; D: standalone "Monthly Discount" via `(?<!CIS\s)` negative lookbehind). For Formats B & C, description is per-row in a table column — server returns null so LLM extraction is kept.
  - Added `convertLTVendorCode()`: strips "TH" prefix and replaces leading "0" with "9" (e.g. "TH00607" → "90607"). Applied to all LT rows in the post-processing block. Non-matching codes (plain numeric, Site codes "TH1xxxx") pass through unchanged.

#### CFR — description label fix
- **Commit `2695aeb`**
- LLM was including the word "รายการ" as part of the description value.
- Fixed: notes now say "text AFTER the 'รายการ' label — do NOT include the word 'รายการ' itself".

#### CFR — correct description / VAT / TAX extraction
- **Commit `669e252`**
- `customers.ts`: rewrote CFR `notes` to map fields from the printed invoice labels:
  - `description` = text after **รายการ** label
  - `product_description` = text after **สินค้า :** (blank if absent)
  - `amount` = **รวม** subtotal
  - `vat_7` = copy **บวกภาษีมูลค่าเพิ่ม 7%(บาท)** verbatim
  - `tax_3` = copy **หักภาษี ณ ที่จ่าย 3%(บาท)** verbatim
  - `netamount` = copy **รวมเป็นเงินทั้งสิ้น (บาท)** verbatim
- `api/extract.ts`: added `skipVatCalc = customerId === 'CFR'` guard so the server-side VAT/WHT3 calculation block is skipped for CFR. Without this, the block was zeroing out `tax_3` (CFR label doesn't match the `อัตราร้อยละ 3 จำนวน` regex) and writing a wrong `netamount`.

#### LT (Lotus) — switch to OCR mode
- **Commit `ee7f95b`**
- Changed LT `extractMode: 'text'` → `'ocr'`.
- `pdf.js` text extraction collapses the multi-column CREDIT NOTE COMPENSATE CONFIRMATION REPORT table into garbled text the LLM cannot parse (→ 0 rows → fallback filename row).
- With OCR, Gemini Vision reads the visual table layout reliably.

#### LT (Lotus) — detection fix + format notes
- **Commit `16af727`**
- **Root cause**: `detectCustomer()` checks nameKeywords before filenameKeywords. The invoice body contains "ซีพี แอ็กซ์ตร้า" which matched MAKRO's nameKeyword at index 13 before LT at index 12 could match (LT only had `['โลตัส', 'lotus']`). Result: MAKRO's OCR path + wrong two-line instructions → 0 rows extracted.
- **Fix**: added `'นวมินทร์'` (Lotus HQ street address printed on every Lotus invoice header) to LT's `nameKeywords`. LT (index 12) now wins before MAKRO (index 13).
- Updated LT `notes` for the Lotus Credit Note Compensate Confirmation Report format:
  - `vendor_customercode` = number after "VENDOR NO"
  - `description` = SECTION column value
  - `product_description` = detail reference line (starts with 12-digit ref number)
  - `vat_7` = copy VAT column verbatim

#### CP Axtra address-based customergroup disambiguation
- **Commit `8cfea15`**
- Lotus (group 05) and Makro (group 04) share taxid `0107567000414`.
- Address is the only reliable discriminator:
  - `นวมินทร์` (629/1 ถนนนวมินทร์) → Lotus → customergroup `05 - โลตัส`
  - `พัฒนาการ` (1468 ถนนพัฒนาการ) → Makro → customergroup `04 - ซีพี แอ็กซ์ตร้า(Makro)`
- Added to `buildSystemPrompt()` so the LLM also knows the rule.
- Added server-side post-processing block (after CFR remark) that hard-overrides `customergroup` + `customercode` per invoice page using `getInvoicePageSection()` + customer master lookup.

### Files changed this session
- `app/src/config/customers.ts` — LT detection keywords, LT notes, LT extractMode, CFR notes
- `app/api/extract.ts` — address disambiguation block, `skipVatCalc` for CFR, system prompt address rules

---

## 2026-05-24 — Session: Makro + CFR fixes

### Completed

#### Makro — VAT 7% / TAX 3% / netamount calculation
- Per-line: `vat_7 = amount × 0.07`, `tax_3 = amount × 0.03`, `netamount = amount + vat7 - tax3`
- Triggered by: `isMAKRO || hasNonZeroVat(pageText) || hasWithholdingTax3(pageText)` (per invoice page via `getInvoicePageSection`)
- `hasNonZeroVat()`: finds ภาษีมูลค่าเพิ่ม line, takes last decimal on same line (rightmost column = VAT total)
- `hasWithholdingTax3()`: matches `อัตราร้อยละ 3 จำนวน <amount>`; Makro always sets `applyWht3=true` as fallback
- Per-invoice isolation prevents VAT from one invoice bleeding into a neighbouring zero-VAT invoice in the same multi-page PDF

#### Makro — description / product_description from OCR text
- `findMakroItemLines()`: locates formatted amount in OCR page text → `product_description` = verbatim text before amount on that line
- LLM handles `description` (category heading); server handles `product_description` (detail line)

#### Makro — OCR re-detection for scanned PDFs
- Scanned PDFs → `extractPdfText` returns empty text → `detectCustomer` returns null
- Fix in `App.tsx`: after OCR, re-detect from assembled OCR text if initial detect was null → `effectiveRule`

#### CFR — remark truncation
- Stop at `'Netting'` first; fall back to stop at `'สำหรับร้านค้า'`
- Server-side: `customerId === 'CFR'` block in `api/extract.ts`

### Key design decisions
- `customers.ts` is the single source of truth — no customer-specific logic anywhere else except `api/extract.ts` post-processing
- Server-side overrides are deterministic and verifiable; LLM handles semantic extraction
- `--- PAGE BREAK ---` markers (from OCR path) enable per-invoice isolation for multi-invoice PDFs

---

## Known issues / Next steps

- [ ] Verify LT address disambiguation is correctly setting customergroup 05 after the OCR fix (was showing 1 row before `ee7f95b` fix — needs re-test)
- [ ] Confirm CFR `tax_3` and `netamount` are correct after `skipVatCalc` fix
- [ ] Consider whether other customers that print explicit VAT/tax values also need `skipVatCalc` treatment
