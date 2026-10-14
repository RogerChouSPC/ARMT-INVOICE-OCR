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
│  React SPA (Vite build, served by the Express server)         │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌───────────┐  │
│  │  PDF.js    │ │  MSAL.js   │ │  SheetJS   │ │  Customer │  │
│  │ (parse +   │ │ (Azure AD  │ │  (xlsx     │ │  config + │  │
│  │  render)   │ │   auth)    │ │  export)   │ │ detection)│  │
│  └────────────┘ └────────────┘ └────────────┘ └───────────┘  │
└───────────────────────────┬───────────────────────────────────┘
                            │ HTTPS
              ┌─────────────▼──────────────┐
              │  COMPANY SERVER (Docker)   │
              │  Express server (Node.js)  │
              │  /api/ocr      route       │
              │  /api/extract  route       │
              │  /api/jobs     routes      │
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

The browser still inspects PDFs, detects customers, shows progress, and generates
Excel output. PDFs with 25 pages or fewer keep the synchronous browser-led flow.
PDFs with more than 25 pages are submitted to the server as persistent background
jobs; their input, OCR checkpoints, and result are stored temporarily in the
Docker job-data volume.

### 2.2 Backend (Express Server)

A single Express (Node.js 20) server handles the API routes, background worker,
and built frontend. It runs inside a Docker container. Entry point:
`server/index.ts`.

| Route                       | File             | Purpose                                                          |
| --------------------------- | ---------------- | ---------------------------------------------------------------- |
| `POST /api/ocr`             | `api/ocr.ts`     | Send image to Gemini Vision, return extracted text               |
| `POST /api/extract`         | `api/extract.ts` | Send invoice text + customer instructions to Gemini, return JSON |
| `POST /api/jobs`            | `api/jobs.ts`    | Persist and enqueue a large PDF; return `202` plus job ID        |
| `GET /api/jobs/:jobId`      | `api/jobs.ts`    | Poll owner-scoped progress and retrieve terminal rows            |

The compatibility OCR/extract routes remain request-scoped. Background-job
routes are stateful: each job is persisted beneath `JOB_DATA_DIR` so work can
continue after the browser disconnects and resume after a container restart.
The frontend and server worker both use `src/config/customers.ts` as the shared
customer-detection source of truth.

### 2.3 Infrastructure & Hosting

| Service         | Provider                            | Notes                                              |
| --------------- | ----------------------------------- | -------------------------------------------------- |
| Hosting         | Company server                      | Runs the Docker container; managed by company IT   |
| Runtime         | Docker                              | Node.js 20 container built from `app/Dockerfile`   |
| Job storage     | Docker named volume                 | `armt-job-data` mounted at `/app/job-data`         |
| TLS / HTTPS     | Company server                      | Certificate + reverse proxy provided by IT         |
| Container image | GitHub Container Registry (ghcr.io) | Image built and stored by GitHub Actions           |
| Source control  | GitHub                              | Repository: RogerChouSPC/ARMT-INVOICE-OCR          |
| CI/CD           | GitHub Actions                      | Every push to `master` builds an image and deploys |

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

### 3.1 Small digital PDF (text-based, 25 pages or fewer)

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

### 3.2 Small scanned PDF (image-based, 25 pages or fewer)

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

### 3.5 Large PDF background job (more than 25 pages)

```
1. The browser counts pages and performs initial customer detection
2. POST /api/jobs sends the extraction inputs (and PDF base64 when OCR is
   required); the server persists the job and returns HTTP 202 immediately
3. One job runs at a time by default (JOB_CONCURRENCY=1)
4. OCR jobs render at most 10 pages per range (OCR_RENDER_BATCH_PAGES=10);
   every successful page is checkpointed beneath /app/job-data
5. The browser polls GET /api/jobs/:jobId for page/batch progress and rows
6. Refresh restores polling from local storage; it does not cancel server work
7. On container restart, non-terminal jobs are re-enqueued and completed OCR
   pages are skipped; completed/error job files expire after 24 hours
```

---

## 4. Authentication & Security

### Authentication Flow

- Protocol: **OAuth 2.0 / OpenID Connect** via Microsoft Entra ID (Azure AD)
- Library: MSAL.js (popup / redirect-bridge flow)
- Token stored in: `localStorage` (scoped to domain)
- Token validated on: **every API call** — `/api/ocr`, `/api/extract`, and
  `/api/jobs` endpoints verify the bearer token before processing
- Background jobs are bound to the verified token subject; another user receives
  `404` rather than learning whether a job exists

### Security Posture

| Area             | Implementation                                               |
| ---------------- | ------------------------------------------------------------ |
| Transport        | HTTPS terminated by the company server (TLS)                 |
| API keys         | Stored as server environment variables, never in source code |
| Data persistence | Large-job inputs/checkpoints/results live in a named volume for 24 hours |
| Access control   | Any valid Microsoft account in the tenant can log in         |
| Input validation | Invoice text truncated to 40,000 chars before sending to AI  |

### Environment Variables Required

| Variable                    | Where Set                   | Purpose                                      |
| --------------------------- | --------------------------- | -------------------------------------------- |
| `OPENROUTER_API_KEY`        | Server `.env` (secret)      | AI API access                                |
| `VITE_AZURE_CLIENT_ID`      | Build arg / `.env` (public) | Azure app registration client ID             |
| `VITE_AZURE_TENANT_ID`      | Build arg / `.env` (public) | Azure AD tenant ID                           |
| `JOB_DATA_DIR`              | Server `.env`                | Persistent job root (`/app/job-data`)         |
| `JOB_CONCURRENCY`           | Server `.env`                | Concurrent large jobs (default `1`)           |
| `OCR_RENDER_BATCH_PAGES`    | Server `.env`                | Pages rendered per range (default/max `10`)   |
| `JOB_RETENTION_HOURS`       | Server `.env`                | Terminal-job retention (default `24` hours)   |

`VITE_AZURE_*` values are baked into the browser bundle at build time and are not
secret. `OPENROUTER_API_KEY` is read by the server at runtime and must be kept
out of the source code and the Docker image. Keep `JOB_CONCURRENCY=1` unless
the host has sufficient RAM and OpenRouter quota; increasing it raises memory
use and rate-limit risk.

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
- The frontend sends the initial match and built instructions. After OCR, the
  background worker re-runs detection using the same `src/config/customers.ts`
  file copied into the runtime image

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

### Server Hosting

Hosting runs on a company-owned server, so there is no per-request hosting fee.
The cost is the server itself (a VM or physical host) plus IT maintenance time.
A small Linux VM (around 2 vCPU / 2 GB RAM) is sufficient for this workload.

Unlike the previous Vercel setup, large PDFs use short create/poll requests
instead of holding one HTTP request open through OCR and extraction. Model or
host failures can still make a job terminal, but reverse-proxy request timeouts
no longer define the maximum processing duration.

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

### Total Monthly Estimate (500 invoices)

| Item            | Cost                                  |
| --------------- | ------------------------------------- |
| Company server  | Internal — no per-request hosting fee |
| OpenRouter (AI) | ~$3 USD                               |
| Azure AD        | $0 (included in M365)                 |
| GitHub          | $0–$4 USD                             |
| **Total**       | **~$3–7 USD/month + server cost**     |

---

## 7. Scaling Considerations

### Current Capacity

| Scenario                                | Status                                                    |
| --------------------------------------- | --------------------------------------------------------- |
| Multiple users uploading simultaneously | Supported — limited by the server's CPU / memory          |
| Bulk upload (10–20 files at once)       | Supported — files processed sequentially per user         |
| Multi-page file                         | >25 pages use persistent background jobs and bounded ranges |
| 500 invoices/month                      | Comfortably within free/pro tier                          |
| 5,000 invoices/month                    | Supported — AI cost increases linearly (~$20–40 AI cost)  |

### Bottlenecks to Watch

| Bottleneck                       | Threshold                            | Mitigation                                              |
| -------------------------------- | ------------------------------------ | ------------------------------------------------------- |
| Server CPU / memory              | Sustained heavy concurrent load      | Increase the VM size, or run multiple containers behind a load balancer |
| OpenRouter rate limits           | ~60 requests/min                     | Keep job concurrency at 1; bounded OCR already retries transient failures |
| Extract text truncation          | 40,000 chars (very large documents)  | Chunk text by page and merge multiple extract calls     |
| Job-volume capacity              | Temporary PDF/checkpoint growth      | Monitor `armt-job-data`; terminal jobs expire after 24 hours |

### Horizontal Scaling

The app runs as a Docker container, so it does not auto-scale on its own.
For higher load, run multiple containers behind a reverse proxy / load
balancer, or move the container to a larger server. For the expected
accounting-team volume, a single container on a modest VM is sufficient.

---

## 8. CI/CD Pipeline

```
Developer pushes code to GitHub (master branch)
          ↓
GitHub Actions runs (.github/workflows/deploy.yml)
          ↓
Builds the Docker image (tsc -b && vite build run inside the image)
          ↓
Pushes the image to GitHub Container Registry (ghcr.io)
          ↓
Connects to the company server over SSH
          ↓
Server runs: docker compose pull && docker compose up -d
```

- **Rollback** — raise the client large-job threshold above supported file sizes
  to stop routing new PDFs into background jobs; the existing synchronous routes
  remain available. A previous image tag can also be re-deployed.
- **Restart safety** — `restart: unless-stopped` brings the app back after a
  server reboot, and startup recovery re-enqueues non-terminal jobs from the
  `armt-job-data` volume
- **Required GitHub secrets** — listed at the top of `.github/workflows/deploy.yml`
  (Azure IDs, server SSH host/user/key, deploy path, registry pull token)

---

## 9. Current Limitations & Recommended Improvements

### Limitation 1 — No Long-Term Archive

**Issue:** Active large jobs survive refresh/restart, but their temporary server
data expires after 24 hours and completed table data is not an audit archive.
**Recommendation:** Add a database (e.g. PostgreSQL, run as another Docker
container) to store extraction history with timestamps, user, and file name.
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
├── .github/workflows/deploy.yml      ← CI/CD: build image + deploy to server
├── project_doc/
│   ├── CEO_Overview.md               ← Executive summary
│   └── IT_Director_Technical.md      ← This document
├── ARMT-INVOICE-OCR/
│   └── data/
│       ├── Customer Master.xlsx      ← Vendor mapping table
│       ├── sample_invoices/          ← Sample PDFs for testing (one per customer)
│       └── alloutput.xlsx            ← Last extraction output
└── app/                              ← All application source code
    ├── api/
    │   ├── ocr.ts                    ← API route: image OCR via Gemini Vision
    │   ├── extract.ts                ← API route: structured extraction
    │   ├── jobs.ts                   ← Persistent background-job API
    │   ├── jobStore.ts               ← Job files, checkpoints, cleanup
    │   └── jobWorker.ts              ← Queue, recovery, bounded OCR orchestration
    ├── server/
    │   └── index.ts                  ← Express server: API routes + serves the website
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
    ├── Dockerfile                    ← Builds the container image
    ├── docker-compose.yml            ← Runs the container on the server
    ├── .env.example                  ← Environment variable template
    ├── package.json
    └── vite.config.ts                ← Build configuration
```

> **Key file for maintenance:** `src/config/customers.ts`. Each customer is one
> entry (filename/taxid/name match, OCR mode, vendor-code source, branch
> handling, AI notes). Onboarding a customer = adding one entry.

---

## 11. Contacts & Access

| Resource                  | Location                                               |
| ------------------------- | ------------------------------------------------------ |
| Live site                 | Company server — internal URL (ask IT)                 |
| Source code               | https://github.com/RogerChouSPC/ARMT-INVOICE-OCR       |
| Deployment pipeline       | GitHub → Actions tab (`.github/workflows/deploy.yml`)  |
| Container image           | GitHub → Packages (ghcr.io)                            |
| OpenRouter API key        | Server `.env` file (contact project owner / IT)        |
| Azure AD app registration | Azure Portal → App registrations → SPC OCR Invoice     |

---

*Last updated: 14 October 2026 — persistent background jobs for PDFs over 25 pages.*
