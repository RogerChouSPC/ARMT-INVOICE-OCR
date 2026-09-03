# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**ARMT Invoice OCR** — a Thai invoice data-extraction web app for บริษัท สหพัฒนพิบูล จำกัด (มหาชน) (taxid `0107537001421`). Users upload PDF invoices from retail chain vendors; the app extracts 22 structured fields into an editable table and exports to Excel.

Active branch: `ken-app-migrate-docker`. All work lives under `app/`.

---

## Development Commands

All commands run from `app/`:

```bash
# Local development (two terminals)
npm run dev        # Vite dev server on :5173 (proxies /api → :3000)
npm run server     # Express API server on :3000 (tsx watch, hot-reload)

# Production
npm run build      # tsc + vite build → dist/
npm run start      # serve dist/ + API on :3000
```

**Required env vars** — copy `app/.env.example` to `app/.env`:
- `OPENROUTER_API_KEY` — server-side only (never in the bundle)
- `VITE_AZURE_CLIENT_ID` / `VITE_AZURE_TENANT_ID` — baked into the browser bundle at build time
- `VITE_BASE_PATH` — Vite asset base path (default `/`, production `/armt-invoice-ocr/`)

---

## Architecture

### Request flow

```
Browser (React SPA)
  └─ pdf.js: extractPdfText(file)          # read embedded text layer + detect isDigital
  └─ detectCustomer(pdfText, filename)      # → CustomerRule | null   [customers.ts]
  └─ shouldUseOcr(rule, isDigital)          # decides path

  TEXT PATH (digital PDFs, extractMode:'text')
    └─ POST /api/extract  { text, filename, customerMaster, customerId, customerInstructions, ... }

  OCR PATH  (scanned PDFs, extractMode:'ocr', or broken font encoding)
    └─ renderPdfPages(file) → base64 PNG per page
    └─ POST /api/ocr { image }  (parallel, one per page)
    └─ join ocrTexts with "--- PAGE BREAK ---"
    └─ re-detect customer from OCR text if initial detect was null
    └─ POST /api/extract  { text: ocrCombined, ... }

Express server (server/index.ts)
  POST /api/ocr      → api/ocr.ts      # Gemini 2.5 Flash vision: image → raw text
  POST /api/extract  → api/extract.ts  # Gemini 2.5 Flash text: text → JSON rows
```

### Key files

| File | Role |
|---|---|
| `src/config/customers.ts` | **Single source of truth for all customer rules.** Detection keywords, extractMode, vendorCode strategy, and per-customer LLM instructions (`notes`). Edit this to onboard new customers or fix extraction. |
| `api/extract.ts` | LLM prompt builder + all server-side post-processing (VAT calc, description overrides, date format, address disambiguation). |
| `api/ocr.ts` | Single-page OCR via Gemini Vision. |
| `src/App.tsx` | Orchestrates the entire file processing pipeline. |
| `src/components/CustomerMasterPage.tsx` | Customer master CRUD (localStorage). Exports `getCustomerMasterRows()` used by App.tsx to send the lookup table to the API. |
| `src/config/customerMasterSeed.ts` | `CUSTOMER_MASTER_SEED` — taxid → customergroup/customercode. Pure data, no React, so `scripts/eval` imports it too. |
| `src/types/invoice.ts` | `InvoiceRow` (22 fields), `EMPTY_ROW`, `INVOICE_COLUMNS`. |
| `scripts/eval/` | Headless eval harness — runs the real pipeline over `vendor-map.json` and scores against the ทะเบียนคุม registers. OCR and raw LLM output are cached, so post-processing changes re-score for free. |

---

## Customer Detection & Routing (`customers.ts`)

`detectCustomer(invoiceText, filename)` iterates `CUSTOMER_RULES` three times in priority order:
1. **taxid** match in invoice text
2. **nameKeywords** match in invoice text (lowercased)
3. **filenameKeywords** match (word-boundary regex, lowercased)

Returns the **first** match — rule order in the array matters when two customers share the same company name (e.g. CP Axtra / taxid `0107567000414` is used by both Lotus and Makro; Lotus rule must come before Makro and must have a discriminating nameKeyword like `'นวมินทร์'`).

`extractMode` per customer:
- `'text'` — use embedded PDF text (fast, for clean digital PDFs)
- `'ocr'`  — always render to images and OCR (scanned PDFs, broken font encoding, or complex table layouts)
- `'auto'` — `isDigital` detection decides (`isDigital` = >100 non-space chars/page average, majority of pages have text, no Cyrillic garbling)

---

## Server-Side Post-Processing (`api/extract.ts`)

After the LLM returns rows, deterministic overrides are applied in order:

1. **`vendor_customercode`** — extracted from raw text by `extractHeaderVendorCode()` for buyer-line / header-bracket / top-m-line modes; left to LLM for customer-line / ac-no / vendor-no modes.

2. **VAT + WHT calculation** — two separate mechanisms. `customerId === 'MAKRO'` recomputes `vat_7 = amount × 0.07` per line (Makro prints only grand totals), with per-invoice-page isolation via `getInvoicePageSection()` (uses `--- PAGE BREAK ---` markers). Every other vendor keeps the printed VAT and only gets withholding computed, driven by the `TAX_RULES` table: `ad` regex → `tax_2 = amount × 0.02`, otherwise `tax_3 = amount × 0.03`, then `netamount = amount + vat_7 − tax_2 − tax_3`. Vendors absent from `TAX_RULES` keep whatever the LLM extracted.

3. **Makro description override** — `findMakroItemLines()` locates the formatted amount in OCR text and extracts `product_description` as the verbatim text before it on that line.

4. **CFR remark truncation** — stops remark at `'Netting'` or `'สำหรับร้านค้า'`, whichever comes first.

5. **CP Axtra address disambiguation** — for any row with taxid `0107567000414`, searches the invoice page text for `'นวมินทร์'` (Lotus, group 05) or `'พัฒนาการ'` (Makro, group 04) and overrides `customergroup` + `customercode` from the customer master.

6. **Lawson field rules** — every value taken from the ทะเบียนคุม register, not the invoice layout: `vendor_branch` forced to `"00000"`; `vendor_expensegroup` parsed from the page's `Code : Merchan?dising <X>` (OCR drops the `n`); `divisionsale` from the single standalone `A`/`H`/`N`/`P` letter in the **filename** (Lawson ships one PDF per สหพัฒน์ division); `duedate`, `tax_pct`, `tax_2`, `tax_5`, `vendor_expensecode`, `remark` blanked; `vat_7` blanked when zero; a trailing `รวมเป็นเงิน <amount>` stripped from `product_description` (the column header bleeding in via OCR). Withholding comes from `TAX_RULES.LAWSON` — always 3%.

7. **Date format** — `isoToDmy()` converts `YYYY-MM-DD` → `DD/MM/YYYY` for all rows.

---

## Customer Master

Stored in **localStorage** (`armt_cm_rows`). Seed data lives in `src/config/customerMasterSeed.ts` (pure data — imported by both the UI and `scripts/eval`). The master is sent with every `/api/extract` call so the LLM uses it for `customergroup` / `customercode` lookup. `getCustomerMasterRows()` returns localStorage data or falls back to seed.

The server has a minimal `FALLBACK_CUSTOMER_MASTER` in `api/extract.ts` used only when the frontend sends no master.

---

## Authentication

Azure AD / MSAL. Every `/api/ocr` and `/api/extract` request requires a valid Azure AD Bearer token. The server validates it by calling `https://graph.microsoft.com/v1.0/me`. `AuthProvider.tsx` wraps the app; `useAuth().getToken()` returns a fresh access token silently (popup fallback).

---

## Adding a New Customer

1. Add a `CustomerRule` entry to `CUSTOMER_RULES` in `src/config/customers.ts` — choose `extractMode`, `vendorCode` strategy, set `displayName` (short brand name), and write `notes` describing the invoice layout (fields, label names, special rules).
2. Add a row to `CUSTOMER_MASTER_SEED` in `src/config/customerMasterSeed.ts` (`store_name` / `customergroup` / `customercode` / `taxid`).
3. If special post-processing is needed (calculated taxes, field overrides), add a block in `api/extract.ts` after the existing ones.
4. Place a sample PDF in `ARMT-INVOICE-OCR/data/sample_invoices/`.

The landing-page customer list (`CustomerCycle.tsx`) and its "N supported customers" count are **derived from `CUSTOMER_RULES.displayName`** — no separate list to maintain.

Existing browsers hold the customer master in localStorage (`armt_cm_rows`), so a new seed row only appears after the user clicks **Restore default** on the Customer Master page.

---

## Progress Tracking

Session progress is logged in [`PROGRESS.md`](./PROGRESS.md) at the repo root. **Update it at the end of every working session** with what was changed and what remains.
