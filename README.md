# ARMT Invoice OCR

AI-powered invoice data extraction for สหพัฒนพิบูล บมจ.

Upload supplier PDF invoices → AI reads and extracts all fields → Download as Excel.

---

## What It Does

Staff used to manually type invoice data from paper or PDF into Excel — slow and error-prone.  
This system automates that entirely. Upload one invoice or fifty at once, get a clean Excel file in seconds.

## Key Features

- Supports **digital PDFs** (text-based) and **scanned PDFs** (image-based) automatically
- Extracts: invoice number, date, due date, customer code, amounts, VAT, withholding tax, net amount
- Maps vendors to the correct customergroup/customercode from the Customer Master
- Login with **company Microsoft account** — no separate password needed
- Add new vendors in under 1 minute via the Customer Master tab

## Supported Vendors

Makro · Lotus · Big C · 7-Eleven (CP ALL) · The Mall · AEON · Central Food Mini · Tops · Foodland · Watson · Boots · HomePro · PTT (Jiffy) · Tsuruha · CJ Express · MM Mega · CFW · BTM · TFG · Villa · and more

## Live Site

**https://spc-ocr.vercel.app**

---

## How to Add a New Vendor

1. Go to the **Customer Master** tab on the website
2. Add one row: store name, customergroup, customercode, taxid
3. Done — the AI will match it automatically on the next upload

For special cases (same taxid for multiple stores, or company name differs from customer name), contact the development team to add a prompt rule.

---

## Tech Stack (Summary)

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| Backend | Vercel Serverless Functions (Node.js) |
| AI / OCR | Google Gemini 2.5 Flash via OpenRouter |
| Auth | Microsoft Azure AD (MSAL) |
| PDF Engine | PDF.js (client-side) |
| Excel Export | SheetJS (client-side) |
| Hosting | Vercel (global CDN) |
| Source Code | GitHub |

See [`project_doc/IT_Director_Technical.md`](project_doc/IT_Director_Technical.md) for full technical documentation.

---

*For IT setup and infrastructure details, see the `project_doc/` folder.*
