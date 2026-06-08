# ARMT Invoice OCR — Executive Overview

**บริษัท สหพัฒนพิบูล จำกัด (มหาชน)**  
Document type: Executive Summary  
Audience: CEO / Senior Management  
Last updated: June 2026

---

## The Problem

Every month, the accounting team receives **invoices from 20+ suppliers** — Makro, Lotus, Big C, 7-Eleven, Boots, HomePro, and many more.

Each invoice must be manually read and typed into Excel, field by field:
- Invoice number, date, due date
- Customer codes
- Amounts, VAT, tax, net amount

This process is:
- **Slow** — 5 to 10 minutes per invoice
- **Error-prone** — manual typing introduces mistakes
- **Repetitive** — same work every billing cycle

---

## The Solution

**ARMT Invoice OCR** is a web application that automates this entirely.

```
Staff uploads PDF invoice
          ↓
AI reads and understands the invoice
          ↓
Data is extracted and mapped automatically
          ↓
Staff downloads a clean, ready-to-use Excel file
```

What used to take 5–10 minutes per invoice now takes **under 30 seconds**.

---

## How It Works — 3 Simple Steps

### Step 1 — Upload
Staff goes to the website and uploads one or multiple PDF invoices at once.  
No installation required. Works in any web browser.

### Step 2 — AI Processes
The system automatically:
- Identifies which supplier the invoice is from
- Applies that supplier's own set of reading rules (each supplier prints invoices differently)
- Reads the PDF — whether it is digital text or a scanned paper image
- Extracts all relevant fields
- Maps the supplier to the correct internal customer code

### Step 3 — Download Excel
Staff clicks **Download Excel** and receives a formatted spreadsheet with all extracted data, ready for the accounting system.

---

## Business Impact

| Metric | Before | After |
|---|---|---|
| Time per invoice | 5–10 minutes | ~30 seconds |
| Risk of typo errors | High | Very low |
| Staff effort | High (manual) | Minimal (review only) |
| Invoices per hour | ~8–12 | 60+ |
| Accuracy on key financial figures | Variable (human typing) | 99–100% (measured) |
| Training required | Moderate | Minimal |

---

## Accuracy & Quality Assurance

A common question with any automation is: *"How do we know it's reading the numbers correctly?"* We now answer that with hard evidence.

The system has been **tested against 425 real supplier invoices** (around 11,000 individual line items) from January–April, comparing every figure the system produced against the accounting team's own verified records.

**The most important financial fields are read near-perfectly:**

| Field | Measured accuracy |
|---|---|
| Invoice number | ~100% |
| Supplier tax ID | ~100% |
| Amount | ~99% |
| VAT | ~100% |

Descriptive text fields (product names, notes) and a few supplier-specific details are continually being refined toward the same level.

**Two things make this trustworthy and low-risk:**
- **Continuous review** — the accounting team checks each supplier and flags anything that needs adjusting. Fixes are turned around quickly.
- **Automatic re-checking** — every improvement is automatically re-tested against all the verified invoices, so refining one supplier can never quietly break another. Quality only moves in one direction: up.

---

## Security & Access Control

- Staff log in using their **existing company Microsoft (Office 365) account**
- No new passwords to remember
- No invoice data is stored permanently — files are processed and discarded
- Hosted on the company's own server, inside the company's control

---

## Current Vendor Coverage

The system currently supports all major suppliers:

Makro · Lotus · Big C · 7-Eleven · The Mall · AEON · Central Food (Retail / Wholesale / Minimart) · Tops · Foodland · Watson · Boots · HomePro · PTT · Tsuruha · CJ Express · Beautrium · Villa · and more

Each supplier's invoice format is tuned individually, so the system reads each one accurately even though every supplier lays out its invoices differently. **Adding a new supplier, or fine-tuning an existing one, is a small change** — one configuration entry, handled quickly by the developer (typically within a day, including testing).

---

## Operating Cost Summary

| Item | Monthly Cost (Est.) |
|---|---|
| Web hosting (company server) | Internal — no per-request fee |
| AI processing (per invoice) | ~$0.01–0.03 USD |
| Microsoft login (Azure AD) | Included in M365 license |
| **Total for ~500 invoices/month** | **< $15 USD/month + server cost** |

The system pays for itself after processing just a few invoices worth of staff time.

---

## What's Next (Optional Roadmap)

| Enhancement | Benefit | Status |
|---|---|---|
| Automatic accuracy checking | Objective, ongoing proof of data quality | ✅ Delivered |
| Invoice history database | Track all past extractions, audit trail | Planned |
| Email / auto-upload integration | Zero manual steps for receiving invoices | Planned |
| ERP / SAP direct integration | Skip Excel, post directly to accounting system | Planned |
| Role-based access | Control which staff can access which vendors | Planned |

---

*For full technical details, refer to the IT Director Technical Document.*
</content>
