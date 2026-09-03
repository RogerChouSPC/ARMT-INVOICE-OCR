# PROGRESS.md

Running log of changes made each session. Most-recent entry first.
Update this file at the end of every working session.

---

## 2026-09-03 — Session: onboard Saha Lawson (บจ.สห ลอว์สัน)

### Completed

#### New customer: Saha Lawson — rule + customer master + assets
- Added `CUSTOMER_MASTER_SEED` row: `39 - สห ลอว์สัน` / `0115283 - บริษัท สห ลอว์สัน จำกัด สำนักงานใหญ่` / taxid `0105555166337` (`src/config/customerMasterSeed.ts`).
- Added the `LAWSON` `CustomerRule`. `extractMode: 'ocr'` is forced, not guessed: all four PDFs in the 17-08-69 batch have a **completely empty text layer** (44–330 chars total, page-break markers only), so the text path would return nothing.
- Notes cover the fields confirmed against the 4 real PDFs (35 pages) plus the user's annotated screenshot: `vendor_customercode` (varies per product group — M1 / M11 / M1111 / M1118 / M1124 / M1132, cross-checkable against the "M1111B" code at the bottom-right), `taxid` (top-left VAT Reg. No., **not** the `TAXID :0107537001421` mid-page which is สหพัฒนพิบูล's own), `invoiceno`, `invoicedate`, `duedate` (from the payment paragraph), `description` (charge line + period line joined), `product_description` (all remaining product lines joined).
- Renamed the sample folder `Lawson_Invoice/` → `บจ.สห ลอว์สัน/` to match the other vendor folders (บจ. — it is a บริษัทจำกัด, not มหาชน). Copied the A-division file to `data/sample_invoices/Lawson_Invoice.pdf`.

#### Landing-page customer list is now derived, not duplicated
- **Bug**: `CustomerCycle.tsx` hard-coded a 22-name array duplicating `CUSTOMER_RULES`. Nothing kept the two in sync, and the "Adding a New Customer" checklist never mentioned the file — so Lawson was invisible on the landing page even after the rule existed.
- **Fix**: added `displayName` to `CustomerRule` (all 23 entries) and derived `CUSTOMERS` from `CUSTOMER_RULES.map(r => r.displayName)`, sorted case-insensitively. The "N supported customers" count now comes from the same array, and the invisible width-reserving spacer is computed from the longest name instead of the literal `'Big C Food'`.
- Updated `CLAUDE.md`: corrected the customer-master seed location (it moved to `customerMasterSeed.ts`), added the `displayName` step, and noted the localStorage caveat — existing browsers need **Restore default** on the Customer Master page before a new seed row shows up.
- Verified: `tsc` clean, `npm run build` clean, 23 unique names in the derived list, `detectCustomer` returns `LAWSON` for all four real filenames and via taxid and company name, and 6 existing vendors still route to their own rules.

#### Ground truth arrived — every field rule re-derived from the register

The customer supplied `2569 ทะเบียนคุม บจ.สห ลอว์สัน (SAHALAWSON).xlsx` (37 rows) plus a fifth PDF, `ใบแจ้งหนี้ สห ลอว์สัน A.pdf`, which is the first Lawson sample carrying **VAT 7%**. Files were filed to the standard locations (`INVOICE JAN-APR/…/บจ.สห ลอว์สัน/`, `OUTPUT JAN-APR/…/`) and `SAHALAWSON` added to `scripts/eval/vendor-map.json`, so Lawson now scores alongside every other vendor.

**The register contradicted three of the answers we were given verbally — the register won each time.** Worth remembering for the next vendor: ask for the register before writing rules.

| | told | register |
|---|---|---|
| `vendor_branch` | unused, leave blank | constant `"00000"` (the 604/601/606/607 number on the invoice is never booked) |
| `description` | first line only | first line **plus** a following `เริ่ม …` period line |
| `duedate` | (not raised) | always blank, though the invoice prints a payment deadline |

Implemented in the `LAWSON` block of `postProcessRows` plus `TAX_RULES.LAWSON`:
- `vendor_branch` → `"00000"`; `vendor_expensegroup` ← the page's `Code : Merchan?dising <X>` (OCR drops the `n` on some scans, so the regex tolerates it).
- `divisionsale` ← the single standalone `A`/`H`/`N`/`P` in the **filename**. Lawson issues one PDF per สหพัฒน์ division. Product-name matching against `divisionSales.ts` had scored 27/29: it read ดอร์โค as P (the mapping spells it `มีดโกนหนวดดอร์โก` — different ค/ก and reversed word order) and left the Campaign invoice blank for having no product line. The filename is 37/37.
- `duedate` / `tax_pct` / `tax_2` / `tax_5` / `vendor_expensecode` / `remark` blanked; `vat_7` blanked when zero (the register leaves VAT empty rather than writing 0.00).
- Withholding is **always** 3% — `tax_3 = amount × 0.03`, `netamount = amount + vat_7 − tax_3`. Verified against all 37 register rows before implementing.
- Two pieces of page furniture that OCR reads as extra product lines are stripped from the end of `product_description`, repeatedly: the right-hand `รวมเป็นเงิน <total>` column header, and the italic running number + period below the table (`194876` / `07/69`). The strip requires end-of-string so a genuine in-cell `… รวมเป็นเงิน 14,792.20 บาท` summary keeps its trailing บาท and survives.

Multi-page invoices needed no server-side merge after all: the totals block is printed **only on the last page** (pages 1/2, 1/4, 2/4, 3/4 carry none), so the prompt rule alone gets it right — 16 pages → 10 rows on the P file, including a 4-page invoice.

**Score against the register: 705/740 fields = 95.3%, 37/37 rows matched.** Fifteen of the twenty columns are 100%, including every money column (`amount`, `vat_7`, `tax_3`, `netamount`) and both VAT-7% invoices.

#### Corrected register — description rule reversed, two open questions closed

The customer replaced the register with a corrected copy (46 cells changed). Diffed old against new before touching anything; three findings:

1. **`description` is the FIRST LINE ONLY.** The `เริ่ม <date> - <date>` period line belongs at the head of `product_description`, not appended to `description` — 22 invoices re-typed that way, and the Campaign invoice likewise moves its quoted campaign name out of `description`. This is exactly what we were told verbally; the first register contradicted its own stated rule, we followed the file, and were wrong. The rule in `customers.ts` now says first line only, never append, with an example for each of the five invoice shapes.
2. **`IN-2607-0157` vendor_expensegroup** corrected Nonfood → **Dryfood**, matching what the page prints. The extraction had been right all along.
3. **`IN-2606-0904` invoicedate** corrected 20/06/26 → **25/06/26**, matching the OCR. Also right all along.

`IN-2607-0996`, previously the one invoice booked inconsistently with its own format, now follows the same rule as the other 21 — the contradiction is gone.

Also added `saraAm()`: Gemini's OCR writes Thai SARA AM decomposed (`U+0E4D U+0E32` — นิคหิต + สระอา) where a person types the composed `U+0E33`. The two render identically but never compare equal, and Unicode NFC does not fold them for Thai. Applied to Lawson's `description` and `product_description`.

**Final score: 712/740 = 96.2%, 37/37 rows. Eighteen of the twenty columns are 100%**, including every money column, every code column, and both dates.

### Remaining

No rule is wrong any more — comparing content only (ignoring line breaks, spacing and case), `description` is **37/37** with zero structural differences and `product_description` is **34/37**. What is left:

1. **Thai OCR character accuracy** — the ceiling on these scans. `ข้าวดัม`/`ข้าวต้ม`, `หมูช่อง`/`หมูซอง`, `จั่ว`/`ฉั่ว`, `SKUS`/`SKUs`. Improving this means a better OCR pass, not a better rule.
2. **`IN-2606-0301`** — the register cell stops mid-list (387 chars against the invoice's 668). The extraction is the more complete of the two; no action.

#### product_description now line-breaks like the register

The customer asked for one product per line, matching the CR-LF separation in their ทะเบียนคุม, so the exported Excel pastes straight in. The prompt now says to put each printed line on its own line; 37/37 rows come back that way. The table in the app is unaffected — `ResultsTable` renders each cell `block truncate`, so a multi-line value still occupies one row height and shows in full on hover and while editing.

Watch the escaping when editing these notes. `notes` is a TypeScript template literal and PROGRESS.md gets written the same way, so a backslash-n typed into either becomes a real line break rather than the two characters the sentence was describing — it bit both files in this session. Spell the escape out in words instead.

---

## 2026-05-25 — Session: ken-app-migrate-docker

### Completed

#### LT — accept DC/TS (and any 2-3 letter) Tax Invoice prefixes
- Broadened Format B candidate pattern from `BH\d{3,8}-?\d{3,8}` to `[A-Z]{2,3}\d{3,8}-?\d{3,8}`.  This accepts the newly-seen `DC2511-00051` and `TS2601-00030` shapes, plus any future 2-3 letter prefix Lotus introduces.  Safety still comes from the position-based whitelist — any extracted value must actually appear in the OCR text.
- Updated Format B notes and the GLOBAL invoiceno rule to mention the new known prefixes.

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
