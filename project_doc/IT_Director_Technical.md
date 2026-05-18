# ARMT Invoice OCR — IT Director Technical Documentation

**บริษัท สหพัฒนพิบูล จำกัด (มหาชน)**
Document type: Technical Reference
Audience: IT Director / System Administrator / Lead Developer

---

## 1. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        USER BROWSER                          │
│                                                               │
│  React SPA (Vite build, served from Vercel CDN)               │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌───────────┐  │
│  │  PDF.js    │ │  MSAL.js   │ │  SheetJS   │ │  Customer │  │
│  │ (parse +   │ │ (Azure AD  │ │  (xlsx     │ │  config + │  │
│  │  render)   │ │   auth)    │ │  export)   │ │ detection)│  │
│  └────────────┘ └────────────┘ └────────────┘ └───────────┘  │
└───────────────────────────┬───────────────────────────────────┘
                            │ HTTPS
              ┌─────────────▼──────────────┐
              │      VERCEL PLATFORM        │
              │                             │
              │  /api/ocr      (serverless) │
              │  /api/extract  (serverless) │
              └──────────┬──────────────────┘
                         │ HTTPS
          ┌──────────────▼──────────────────────────┐
          │            OPENROUTER API                │
          │   Routes to: Google Gemini 2.5 Flash      │
          │   - Vision (image → text OCR)             │
          │   - Text (structured data extraction)     │
          └───────────────────────────────────────────┘

Auth flow (separate):
Browser ──► Microsoft Azure AD (login.microsoftonline.com)
        ◄── Bearer token (validated on every API call)
```

---

## 2. Full Tech Stack

### 2.1 Frontend

| Component     | Technology          | Version | Purpose                             |
| ------------- | ------------------- | ------- | ----------------------------------- |
| Framework     | React               | 18.3.1  | UI rendering                        |
| Language      | TypeScript          | 5.9.3   | Type safety                         |
| Build tool    | Vite                | 5.4.21  | Fast dev server + bundling          |
| Styling       | Tailwind CSS        | 3.4.17  | Utility-first CSS                   |
| UI primitives | Radix UI            | 1.4.3   | Accessible components               |
| Animation     | Framer Motion       | 12.38.0 | UI transitions, background paths    |
| PDF engine    | PDF.js (pdfjs-dist) | 4.9.155 | Client-side PDF parsing + rendering |
| Excel export  | SheetJS (xlsx)      | 0.18.5  | Generate .xlsx in browser           |
| Auth client   | @azure/msal-browser | 5.10.1  | Microsoft SSO                       |
| Analytics     | @vercel/analytics   | 2.0.1   | Page view tracking                  |

All processing (PDF reading, OCR rendering, Excel generation) happens **in the user's browser** — no file is uploaded to or stored on any server.

### 2.2 Backend (Serverless Functions)

| Function | Path              | Runtime               | Purpose                                                         |
| -------- | ----------------- | --------------------- | --------------------------------------------------------------- |
| OCR      | `/api/ocr.ts`     | Vercel Node.js (20.x) | Send image to Gemini Vision, return extracted text              |
| Extract  | `/api/extract.ts` | Vercel Node.js (20.x) | Send invoice text + customer instructions to Gemini, return JSON |

Both functions are **stateless** — no database, no file storage. Each request is self-contained. `api/extract.ts` is fully self-contained (it imports nothing from `src/`) because a Vercel serverless function cannot reliably resolve cross-directory imports at runtime.

### 2.3 Infrastructure & Hosting

| Service            | Provider         | Plan        | Notes                                     |
| ------------------ | ---------------- | ----------- | ----------------------------------------- |
| Hosting + CDN      | Vercel           | Hobby / Pro | Global edge network, auto HTTPS           |
| Serverless compute | Vercel Functions | Included    | Node.js 20.x managed runtime              |
| Source control     | GitHub           | Free / Team | Repository: RogerChouSPC/ARMT-INVOICE-OCR |
| CI/CD              | Vercel + GitHub  | Automatic   | Every push to `master` triggers a deploy  |

### 2.4 External APIs

| API              | Provider                | Used For              | Auth Method        |
| ---------------- | ----------------------- | --------------------- | ------------------ |
| Chat Completions | OpenRouter              | Routes AI requests    | API Key (env var)  |
| Gemini 2.5 Flash | Google (via OpenRouter) | OCR + data extraction | Via OpenRouter key |
| Microsoft Graph  | Microsoft Azure         | Validate user tokens  | Bearer token       |
| Azure AD Login   | Microsoft Entra ID      | User authentication   | OAuth 2.0 / OIDC   |

---

## 3. Request Flow — Step by Step

Every uploaded file is first identified against a **per-customer configuration**
(`src/config/customers.ts`). The matched customer's rules decide how the PDF is
read (OCR vs direct text) and what extraction instructions are sent to the AI.

### 3.0 Customer detection (runs for every file)

```
1. PDF.js extracts the text layer + page count
2. detectCustomer(text, filename) matches a customer by:
   a. filename keyword (e.g. "CFR_Invoice.pdf" → CFR)   ← highest priority
   b. issuer tax ID found in the text
   c. company-name keyword in the text
3. The matched rule provides: extractMode, vendorCode source,
   vendorBranch handling, and customer-specific AI notes
4. If no customer matches → generic rules are used as fallback
```

### 3.1 Digital PDF (text-based invoice)

```
1. User uploads PDF
2. PDF.js extracts text from each page (client-side, no server)
3. Customer config (or auto-detection) selects the direct-text path
4. Text + customer instructions sent to /api/extract (with Bearer token
   + Customer Master data)
5. Gemini 2.5 Flash extracts structured fields → returns JSON array
6. Server post-processes vendor_customercode / vendor_branch deterministically
7. App displays rows; user clicks Download → SheetJS generates .xlsx client-side
```

### 3.2 Scanned PDF (image-based invoice)

```
1. User uploads PDF
2. PDF.js text extraction returns little/no text → scanned
3. PDF.js renders each page to a PNG canvas (1.5× scale)
4. ALL pages are sent to /api/ocr IN PARALLEL (one call per page,
   fired concurrently via Promise.all — page order preserved)
5. Gemini Vision reads each image → returns raw text
6. Combined page text + customer instructions → /api/extract
7. Same extraction + download flow as digital
```

### 3.3 Garbled-font PDF (broken text layer)

```
- Some vendors (CFM, CFR, CMK) embed fonts with a broken encoding that
  maps Thai glyphs onto Cyrillic code points — the text layer is unreadable
- extractPdfText counts Cyrillic characters; >20 = garbled
- Garbled PDFs are forced down the OCR path (Section 3.2), which reads the
  page visually and produces clean Thai
- These customers are also pinned to extractMode: 'ocr' in the config
```

### 3.4 Mixed PDF (some pages digital, some scanned)

```
- Triggered when <50% of pages have a real text layer
  (e.g. CP ALL: 5 scanned + 1 digital summary page)
- Entire PDF treated as scanned → all pages go through OCR
- Ensures line-item pages are not missed
```

---

## 4. Authentication & Security

### Authentication Flow

- Protocol: **OAuth 2.0 / OpenID Connect** via Microsoft Entra ID (Azure AD)
- Library: MSAL.js (popup / redirect-bridge flow)
- Token stored in: `localStorage` (scoped to domain)
- Token validated on: **every API call** — both `/api/ocr` and `/api/extract`
  call Microsoft Graph (`/v1.0/me`) to verify the bearer token before processing

### Security Posture

| Area             | Implementation                                               |
| ---------------- | ------------------------------------------------------------ |
| Transport        | HTTPS enforced by Vercel (TLS 1.2/1.3)                       |
| API keys         | Stored as Vercel environment variables, never in source code |
| Data persistence | None — invoices are never written to disk or database        |
| Access control   | Any valid Microsoft account in the tenant can log in         |
| Input validation | Invoice text truncated to 40,000 chars before sending to AI  |

### Environment Variables Required

| Variable               | Where Set        | Purpose                          |
| ---------------------- | ---------------- | -------------------------------- |
| `OPENROUTER_API_KEY`   | Vercel dashboard | AI API access                    |
| `VITE_AZURE_CLIENT_ID` | Vercel dashboard | Azure app registration client ID |
| `VITE_AZURE_TENANT_ID` | Vercel dashboard | Azure AD tenant ID               |

---

## 5. AI Model — Google Gemini 2.5 Flash

### Why Gemini 2.5 Flash

- Strong **Thai language** comprehension (critical for this use case)
- **Vision capability** — reads scanned invoice images directly
- Fast response time (2–5 seconds per page for OCR)
- Cost-effective at scale

### Prompt Engineering — Per-Customer

The extraction prompt is **assembled per customer**, not a single fixed prompt:

- A shared base covers company context, the Customer Master lookup, the 22
  output fields, date conversion, and general rules
- A **customer-specific section** is injected, built from that customer's
  config entry — where `vendor_customercode` is found, how `vendor_branch` is
  handled, and any free-text notes (e.g. Boots VAT marker column, CFR remark
  range, CJ verbatim description rule)
- The frontend detects the customer and sends the built instructions in the
  `/api/extract` request body, so the API needs no config import

### Deterministic Post-Processing

The AI is unreliable for `vendor_customercode`, so after the AI responds the
server applies a deterministic override based on the customer config:

- `buyer-line` / `header-bracket` — a regex extracts the code in `[brackets]`
  or `(parentheses)` from the raw invoice text and overrides the AI value
- `blank` — the field is forced empty
- `ac-no` / `vendor-no` — left to the AI (those invoices are scanned/OCR'd)

### Known Limitations

- Invoice text is truncated at **40,000 characters** per extraction call —
  extremely long multi-invoice documents may still lose later content
- AI extraction accuracy depends on OCR quality for scanned PDFs
- Model responses are non-deterministic (temperature 0.1 for extract, 0 for
  OCR) — rare edge cases may differ slightly on retry

---

## 6. Pricing & Cost Model

### Vercel Hosting

| Plan  | Cost               | Limits                                                            | Recommendation             |
| ----- | ------------------ | ----------------------------------------------------------------- | -------------------------- |
| Hobby | Free               | 100 GB bandwidth, 100K function calls/month, 10s function timeout | Suitable for low volume    |
| Pro   | $20 USD/user/month | Unlimited bandwidth, 1M function calls/month, 60s timeout         | Recommended for production |

> **Note:** Hobby plan has a **10-second serverless function timeout**. With
> parallel OCR each `/api/ocr` call is a single page (short), but a 40,000-char
> `/api/extract` call on a large document can run long. Pro plan (60s timeout)
> is recommended for production use.

### OpenRouter / Gemini 2.5 Flash

Pricing is per token (1 token ≈ 0.75 words in English, less for Thai).

| Operation                              | Tokens (est.)              | Cost per call (est.) |
| --------------------------------------- | -------------------------- | -------------------- |
| OCR — 1 scanned page                    | ~800 input + ~500 output   | ~$0.0004             |
| Extract — 1 invoice (all pages text)    | ~2,000 input + ~800 output | ~$0.001              |
| **Total per invoice (digital)**         |                            | **~$0.001**          |
| **Total per invoice (6-page scanned)**  |                            | **~$0.004**          |

| Monthly Volume | Est. Cost   |
| -------------- | ----------- |
| 100 invoices   | < $1 USD    |
| 500 invoices   | ~$2–5 USD   |
| 2,000 invoices | ~$8–20 USD  |

> Prices based on Gemini 2.5 Flash rates via OpenRouter as of May 2026. Subject to change.

### Microsoft Azure AD

- Included with existing Microsoft 365 Business / Enterprise license
- No additional cost assuming tenant is already configured
- App registration required (one-time setup, free)

### GitHub

- Public repository: Free
- Private repository: $4 USD/user/month (GitHub Team)

### Total Monthly Estimate (500 invoices, Pro plan)

| Item            | Cost                  |
| --------------- | --------------------- |
| Vercel Pro      | $20 USD               |
| OpenRouter (AI) | ~$3 USD               |
| Azure AD        | $0 (included in M365) |
| GitHub          | $0–$4 USD             |
| **Total**       | **~$23–27 USD/month** |

---

## 7. Scaling Considerations

### Current Capacity

| Scenario                                | Status                                                    |
| --------------------------------------- | --------------------------------------------------------- |
| Multiple users uploading simultaneously | Supported — Vercel auto-scales serverless                 |
| Bulk upload (10–20 files at once)       | Supported — files processed sequentially per user         |
| Multi-page file                         | Pages OCR'd in parallel — fast regardless of page count   |
| 500 invoices/month                      | Comfortably within free/pro tier                          |
| 5,000 invoices/month                    | Supported — AI cost increases linearly (~$20–40 AI cost)  |

### Bottlenecks to Watch

| Bottleneck                       | Threshold                            | Mitigation                                              |
| -------------------------------- | ------------------------------------ | ------------------------------------------------------- |
| Vercel function timeout          | 10s (Hobby) / 60s (Pro)              | Upgrade to Pro; OCR calls are per-page (short)          |
| OpenRouter rate limits           | ~60 requests/min                     | Parallel OCR fires N calls per file; add retry/backoff for very high volume |
| Extract text truncation          | 40,000 chars (very large documents)  | Chunk text by page and merge multiple extract calls     |
| No persistent storage            | Data lost on browser close           | Add database layer (see Section 9)                      |

### Horizontal Scaling

Vercel serverless functions scale to zero when idle and auto-scale on demand —
**no manual action required**. Parallel OCR means a single multi-page file
fires multiple concurrent function invocations; Vercel scales these
automatically. The only manual scaling decision is the **Vercel plan tier**
(Hobby → Pro for the higher timeout and call quota).

---

## 8. CI/CD Pipeline

```
Developer pushes code to GitHub (master branch)
          ↓
Vercel webhook triggered automatically
          ↓
Vercel runs: tsc -b && vite build
          ↓
If build passes → deployed to production (spc-ocr.vercel.app)
          ↓
If build fails → previous version stays live, developer notified
```

- **Zero-downtime deploys** — Vercel swaps to the new version atomically
- **Instant rollback** — one click in the Vercel dashboard reverts to any previous deployment
- **Preview deployments** — every pull request gets its own preview URL for testing

---

## 9. Current Limitations & Recommended Improvements

### Limitation 1 — No Data Persistence

**Issue:** Extracted data exists only in the browser session. Closing the tab loses all data.
**Recommendation:** Add a database (e.g. Vercel Postgres / PlanetScale) to store extraction history with timestamps, user, and file name.
**Effort:** Medium (2–3 days)

### Limitation 2 — No Audit Trail

**Issue:** No log of who processed which invoice, when.
**Recommendation:** Log each extraction to a database with user email, filename, timestamp, and row count.
**Effort:** Low (1 day, once a database is added)

### Limitation 3 — No Role-Based Access Control

**Issue:** Any user with a valid Microsoft account in the tenant can access the system.
**Recommendation:** Add Azure AD security groups — restrict to specific departments (e.g. accounting only).
**Effort:** Low (configure MSAL scopes + group check)

### Limitation 4 — Customer Config Is Code, Not Data

**Issue:** Onboarding a new customer or tweaking a rule requires editing `src/config/customers.ts` and a redeploy. Non-developers cannot do this.
**Recommendation:** Move the customer rule table to a database or admin UI so business users can manage it.
**Effort:** Medium (2–4 days)

### Limitation 5 — Extract Text Truncation at 40,000 Characters

**Issue:** Extremely long multi-invoice documents may still have content cut off.
**Recommendation:** Chunk text by page and make multiple sequential extract calls; merge results.
**Effort:** Medium (1–2 days)

### Limitation 6 — No ERP Integration

**Issue:** Staff still manually imports the Excel into the accounting system.
**Recommendation:** Direct API integration with SAP / Oracle / internal ERP to post invoice data directly.
**Effort:** High (depends on ERP system and API availability)

---

## 10. Repository Structure

```
roger_spc_ocr_collab/
├── README.md                         ← Project overview (GitHub front page)
├── project_doc/
│   ├── CEO_Overview.md               ← Executive summary
│   └── IT_Director_Technical.md      ← This document
├── ARMT-INVOICE-OCR/
│   └── data/
│       ├── Customer Master.xlsx      ← Vendor mapping table
│       ├── sample_invoices/          ← Sample PDFs for testing (one per customer)
│       └── alloutput.xlsx            ← Last extraction output
└── vercel/                           ← All application source code
    ├── api/
    │   ├── ocr.ts                    ← Serverless: image OCR via Gemini Vision
    │   └── extract.ts                ← Serverless: structured extraction (self-contained)
    ├── src/
    │   ├── App.tsx                   ← Main app logic + processing pipeline
    │   ├── auth/                     ← Microsoft MSAL authentication
    │   ├── components/               ← UI components (ProcessingStatus, ResultsTable, …)
    │   ├── config/
    │   │   └── customers.ts          ← Per-customer rule table + detection (key file)
    │   ├── utils/
    │   │   ├── pdfTextExtractor.ts    ← PDF text extraction, page count, garbled detection
    │   │   ├── pdfRenderer.ts         ← PDF page → PNG image for OCR
    │   │   └── excelExporter.ts       ← Excel file generation
    │   └── types/invoice.ts          ← TypeScript types + column definitions
    ├── package.json
    ├── vercel.json                   ← Routing rules
    └── vite.config.ts                ← Build configuration
```

> **Key file for maintenance:** `src/config/customers.ts`. Each customer is one
> entry (filename/taxid/name match, OCR mode, vendor-code source, branch
> handling, AI notes). Onboarding a customer = adding one entry.

---

## 11. Contacts & Access

| Resource                  | Location                                               |
| ------------------------- | ------------------------------------------------------ |
| Live site                 | https://spc-ocr.vercel.app                             |
| Source code               | https://github.com/RogerChouSPC/ARMT-INVOICE-OCR       |
| Vercel dashboard          | https://vercel.com (login with project owner account)  |
| OpenRouter API key        | Vercel environment variables (contact project owner)   |
| Azure AD app registration | Azure Portal → App registrations → SPC OCR Invoice     |

---

*Last updated: May 2026*
