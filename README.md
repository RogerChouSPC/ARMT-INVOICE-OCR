# ARMT Invoice OCR

AI-powered invoice data extraction for สหพัฒนพิบูล บมจ.

Upload supplier PDF invoices → AI reads and extracts all fields → Download as Excel.

---

## What It Does

Staff used to manually type invoice data from paper or PDF into Excel — slow and error-prone.
This system automates that entirely. Upload one invoice or fifty at once, get a clean Excel file in seconds.

## Key Features

- Supports **digital PDFs** (text-based) and **scanned PDFs** (image-based) automatically
- **Per-customer rules** — each supplier's invoice format is configured individually, so fields are read correctly even though every supplier lays out invoices differently
- Handles **broken-font PDFs** — some vendors embed fonts that produce unreadable text; these are automatically routed through image OCR for clean results
- **Parallel page processing** — multi-page invoices are OCR'd concurrently, so a 10-page file is nearly as fast as a 1-page file
- Live page progress counter while processing
- Extracts: invoice number, date, due date, customer code, amounts, VAT, withholding tax, net amount
- Maps vendors to the correct customergroup/customercode from the Customer Master
- Login with **company Microsoft account** — no separate password needed

## Supported Vendors

Makro · Lotus · Big C · 7-Eleven (CP ALL) · The Mall · AEON · Central Food Retail (CFR) · Central Food Wholesale (CFW) · Central Food (CFM) · Central + Matsumoto Kiyoshi (CMK) · Tops · Foodland · Watson · Boots · HomePro · PTT · Tsuruha · CJ Express · Beautrium (BTM) · TFG · Villa · and more

## Live Site

Hosted on the company server — ask IT for the internal URL.

---

## How to Add or Adjust a Vendor

There are two layers, depending on what you need:

**1. Vendor code mapping** (taxid → customergroup / customercode)
- Go to the **Customer Master** tab on the website
- Add one row: store name, customergroup, customercode, taxid
- Done — the AI matches it automatically on the next upload

**2. Extraction rules** (how to read that vendor's invoice — OCR vs text, where the
vendor code / branch are, special field rules)
- Add or edit one entry in [`app/src/config/customers.ts`](app/src/config/customers.ts)
- Each customer is a single config block: match keywords, OCR mode, vendor-code
  source, branch handling, and free-text AI notes
- Requires a developer and a redeploy (a quick change — typically under a day)

---

## Tech Stack (Summary)

| Layer        | Technology                                  |
| ------------ | ------------------------------------------- |
| Frontend     | React 18 + TypeScript + Vite + Tailwind CSS |
| Backend      | Express server (Node.js)                    |
| AI / OCR     | Google Gemini 2.5 Flash via OpenRouter      |
| Auth         | Microsoft Azure AD (MSAL)                   |
| PDF Engine   | PDF.js (client-side)                        |
| Excel Export | SheetJS (client-side)                       |
| Hosting      | Docker container on the company server      |
| CI/CD        | GitHub Actions (build image + deploy)       |
| Source Code  | GitHub                                      |

Key files:
- `app/src/config/customers.ts` — per-customer extraction rule table
- `app/api/extract.ts` — structured data extraction
- `app/api/ocr.ts` — image OCR
- `app/server/index.ts` — Express server (serves the API + website)
- `app/Dockerfile`, `app/docker-compose.yml` — container build + run

See [`project_doc/IT_Director_Technical.md`](project_doc/IT_Director_Technical.md) for full technical documentation.

---

*For IT setup and infrastructure details, see the `project_doc/` folder.*
