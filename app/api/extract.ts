import type { Request, Response } from 'express'
import { divisionSalesPromptBlock } from './divisionSales'
import { verifyAzureToken } from './verifyToken'

// Customer rules live in src/config/customers.ts (single source of truth, used by
// the frontend). The API stays self-contained and does not import from src/ — the
// frontend detects the customer and sends the resulting instructions + directives
// in the request body.

export const DEFAULT_CUSTOMER_SECTION = `DETECTED CUSTOMER: unknown — use general rules.
vendor_customercode: a code in [brackets]/(parentheses) near the company name or ชื่อผู้ซื้อ line; otherwise a labelled รหัสร้านค้า / Customer Code. Strip vendor prefixes from hyphenated codes (e.g. "TOP-M802316" → "802316").
vendor_branch: only an explicitly labelled branch ("สาขาที่", "Branch", "Site code"); "Group [number]" is NOT a branch; return "" if none found.`

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MODEL = 'google/gemini-2.5-flash'
const OUR_TAXID = '0107537001421'

function buildSystemPrompt(customerMasterJson: string, customerSection: string): string {
  return `You are an expert at extracting structured data from Thai invoice text (ใบแจ้งหนี้, ใบวางบิล, ใบเสร็จรับเงิน).

CRITICAL CONTEXT — READ CAREFULLY:
- บริษัท สหพัฒนพิบูล จำกัด (มหาชน) (taxid ${OUR_TAXID}) is OUR COMPANY — the RECIPIENT of invoices.
- The company that ISSUED / SENT the invoice to us is the VENDOR/CUSTOMER in output fields.
- NEVER put สหพัฒนพิบูล in customergroup, customercode, or taxid output fields.
- taxid in output = the invoice ISSUER's tax ID (NOT ${OUR_TAXID}).

CUSTOMER MASTER LOOKUP TABLE (use this to fill customergroup and customercode):
${customerMasterJson}

HOW TO MAP customergroup and customercode:
1. Find the invoice issuer's taxid (the 13-digit number that is NOT ${OUR_TAXID}).
2. Find the issuer's company name and branch from the invoice header.
3. Look up the CUSTOMER MASTER table above: match by taxid first, then refine by company name/branch.
   - If the same taxid has multiple entries (e.g., ซีพี แอ็กซ์ตร้า), pick the row whose store_name best matches the issuer's name in the invoice.
   - taxid 0107567000414 with "Lotus" or "โลตัส" or "LT" → group "05 - โลตัส"
   - taxid 0107567000414 with "Makro" or "แม็คโคร" → group "04 - ซีพี แอ็กซ์ตร้า(Makro)"
   - taxid 0107567000414 with vendor address containing "นวมินทร์" (Nawamin street, e.g. "629/1 ถนนนวมินทร์") → group "05 - โลตัส"
   - taxid 0107567000414 with vendor address containing "พัฒนาการ" (Pattanakarn street, e.g. "1468 ถนนพัฒนาการ") → group "04 - ซีพี แอ็กซ์ตร้า(Makro)"
   - taxid 0107536000633 with "คลังครอสด็อคธัญบุรี 00485" → customercode "0115526"
   - taxid 0107536000633 headquarters → customercode "0102856"
   - taxid 0105540016253 (City Mall / ซิตี้มอลล์) with branch 00001 → customercode "0114682"
   - taxid 0105565017547 (บริษัท ออล สปีดดี้ / All Speedy) → treat as ซีพี ออลล์, use customergroup "07 - เซเว่นอีเลฟเว่น (7-11)" and customercode from the ซีพี ออลล์ row
4. Copy customergroup and customercode EXACTLY from the matching Customer Master row.

CUSTOMER-SPECIFIC INSTRUCTIONS (these are tailored to this invoice — follow them precisely):
${customerSection}

Given raw text from one or more invoice pages (separated by "--- PAGE BREAK ---"), extract ALL invoice line items and return a JSON array. Each element = one row.

PRODUCT → DIVISIONSALE MAPPING (สหพัฒน์ product lines; match the product/brand mentioned in the invoice to its division letter):
${divisionSalesPromptBlock()}

Output fields (22 columns):
- customergroup: from Customer Master lookup (exact copy)
- customercode: from Customer Master lookup (exact copy)
- taxid: the invoice ISSUER's 13-digit tax ID
- vendor_customercode: see CUSTOMER-SPECIFIC INSTRUCTIONS above
- vendor_branch: see CUSTOMER-SPECIFIC INSTRUCTIONS above
- vendor_expensecode: expense code if present, else ""
- vendor_expensegroup: expense group if present, else ""
- divisionsale: Look at the product/brand named in THIS row (use description, product_description, and the line's product text). If it matches a product in the PRODUCT → DIVISIONSALE MAPPING above — match by brand/product keyword, e.g. "โชกุบุสซึ" → "สบู่เหลวโชกุบุสซึ" → P — output that division letter (A / N / P / H). When a brand word maps to different divisions, use the FULL product description to pick the right one (e.g. "ปลากระป๋องซื่อสัตย์" → N, "ผงซักฟอกซื่อสัตย์" → P). If no listed product/brand is mentioned, return "".
- invoiceno: invoice number / เลขที่
- invoicedate: invoice date → YYYY-MM-DD (see date rules below)
- duedate: due/payment date → YYYY-MM-DD (see date rules below)
- description: main invoice description / purpose line
- product_description: product or service line item detail
- amount: amount before deductions (plain number, no commas)
- vat_7: VAT 7% amount (number or "0")
- tax_pct: general tax % amount (number or "0")
- tax_2: withholding tax 2% (number or "0")
- tax_3: withholding tax 3% (number or "0")
- tax_5: withholding tax 5% (number or "0")
- netamount: net payable after all deductions (number)
- remark: any notes / หมายเหตุ

General rules (apply to every invoice):
- Multiple line items per invoice → one row per item (share header: invoiceno, taxid, dates, etc.)
- Missing fields → empty string ""
- Numbers → plain string without commas or currency symbols
- Tax ID = exactly 13 digits
- Dates → YYYY-MM-DD. 4-digit year ≥ 2500 = Buddhist Era → subtract 543 (e.g. 2569 → 2026).
  4-digit year < 2500 = already Gregorian → use as-is. 2-digit year → prepend "20" (never subtract 543).
- NEVER calculate or derive any tax/VAT amount — only copy figures that are explicitly printed on the invoice; if not printed, use "0".
- invoiceno: OCR may insert spaces inside invoice numbers — reconstruct by removing spaces between digit groups around slashes (e.g. "3530103 / 010426" → "3530103/010426"). Extract EVERY invoice in the document; never skip one because its number looks unusual.
- product_description: copy the EXACT characters verbatim. Do NOT paraphrase, translate, summarise, "correct", or substitute any Thai word — output it exactly as printed. Preserve all languages; include both Thai and English when both appear (e.g. "ส่วนลด Discount").
- Return ONLY a valid JSON array, no markdown fences, no explanation`
}

export const FALLBACK_CUSTOMER_MASTER = [
  { store_name: 'บิ๊กซี ซูเปอร์เซ็นเตอร์', customergroup: '01 - บิ๊กซี', customercode: '0100857 บิ๊กซี ซูเปอร์เซ็นเตอร์ จำกัด (มหาชน)', taxid: '0107537002445' },
  { store_name: 'โลตัส', customergroup: '05 - โลตัส', customercode: '0114682 ซีพี แอ็กซ์ตร้า จำกัด (โลตัส)', taxid: '0107567000414' },
  { store_name: 'แม็คโคร', customergroup: '04 - ซีพี แอ็กซ์ตร้า(Makro)', customercode: '0102856 ซีพี แอ็กซ์ตร้า จำกัด (Makro)', taxid: '0107567000414' },
  { store_name: 'เซ็นทรัล', customergroup: '11 - เซ็นทรัล', customercode: '0109266 เซ็นทรัลพัฒนา จำกัด (มหาชน)', taxid: '0107536000633' },
]

export function parseJsonFromText(text: string): object[] {
  const stripped = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '')
  const parsed = JSON.parse(stripped)
  return Array.isArray(parsed) ? parsed : [parsed]
}

// Vendors where vendor_customercode is always blank — guard for the case where
// customer detection failed but the invoice still belongs to one of them.
const BLANK_VENDOR_CODE_NAMES = ['homepro', 'home product', 'lotus', 'makro', 'tfg', 'villa', 'watson']

// Deterministically extract vendor_customercode from the raw invoice text.
// Three real layouts (verified against sample PDFs):
//   buyer-line     — ( CODE ) on the ชื่อผู้ซื้อ line, e.g. "...จำกัด ( 042501)"  (CMK)
//   header-bracket — [CODE] right after the vendor company name             (BTM, CFW)
//   top-m-line     — digits after "TOP-M" on the เจ้าของ/ตัวแทน(รหัสร้านค้า) line  (CFR)
// pdf.js joins all text with spaces and brackets may contain inner spaces — hence \s*.
function extractHeaderVendorCode(invoiceText: string, mode: 'buyer-line' | 'header-bracket' | 'top-m-line' | 'auto'): string | null {
  const head = invoiceText.slice(0, 800)
  if (mode === 'auto' && BLANK_VENDOR_CODE_NAMES.some((n) => head.toLowerCase().includes(n))) return null

  if (mode === 'top-m-line') {
    // Tolerates OCR noise: spaces inside "TOP-M" or between it and the digits.
    const m = invoiceText.match(/เจ้าของ[^\n\r]{0,60}TOP[\s-]*M[\s]*(\d+)/)
    if (m) return m[1]
    return null
  }

  if (mode === 'buyer-line' || mode === 'auto') {
    const buyerIdx = invoiceText.search(/ชื่อผู้ซื้อ|ผู้ซื้อ/)
    if (buyerIdx >= 0) {
      const m = invoiceText.slice(buyerIdx, buyerIdx + 400).match(/[\[(]\s*(\d{4,8})\s*[\])]/)
      if (m) return m[1]
    }
  }

  if (mode === 'header-bracket' || mode === 'auto') {
    const m2 = head.match(/[\[(]\s*(\d{4,8})\s*[\])]/)
    if (m2) return m2[1]
  }

  return null
}

/**
 * Returns true when the invoice text has a ภาษีมูลค่าเพิ่ม (VAT) summary line
 * with a non-zero amount.  Used to trigger per-line vat_7 / tax_3 / netamount
 * calculation when the vendor only prints a grand-total VAT, not per-line.
 *
 * Strategy: Makro (and similar) invoices put the VAT label on the left and the
 * amount in the far-right column of the same OCR line — but they also embed a
 * long descriptive paragraph in the middle (withholding-tax note), so a short
 * character-count window misses the number.  We collect ALL decimal numbers on
 * the same line and take the LAST one (= rightmost column = VAT total).
 * If the line has no decimals we fall back to scanning the next 4 lines.
 */
function hasNonZeroVat(invoiceText: string): boolean {
  const idx = invoiceText.indexOf('ภาษีมูลค่าเพิ่ม')
  if (idx < 0) return false

  const from = invoiceText.slice(idx)

  // --- same-line check (handles "ภาษีมูลค่าเพิ่ม ... 23,939.28" on one OCR line) ---
  const eol = from.indexOf('\n')
  const sameLine = eol > 0 ? from.slice(0, eol) : from.slice(0, 1000)
  const sameLineNums = [...sameLine.matchAll(/([\d,]+\.\d{2})/g)]
  if (sameLineNums.length > 0) {
    // Last decimal on the line = rightmost column = VAT total
    const last = parseFloat(sameLineNums[sameLineNums.length - 1][1].replace(/,/g, ''))
    return !isNaN(last) && last > 0
  }

  // --- multi-line fallback (amount on its own line in the right column) ---
  const lines = from.split(/\r?\n/)
  for (let i = 1; i <= Math.min(4, lines.length - 1); i++) {
    const m = lines[i].match(/([\d,]+\.\d{2})/)
    if (m) {
      const val = parseFloat(m[1].replace(/,/g, ''))
      if (!isNaN(val) && val > 0) return true
    }
  }
  return false
}

/**
 * Isolate the page of the combined OCR text that contains a given invoice number.
 * Pages are separated by "--- PAGE BREAK ---" (inserted by the frontend).
 * Falls back to the whole document if the invoice number is not found.
 *
 * This allows per-invoice VAT detection in a multi-invoice PDF — e.g. page 1
 * has invoice A (0.00 VAT) and page 2 has invoice B (non-zero VAT).  Without
 * page isolation, a document-level check would wrongly trigger calculations
 * for invoice A because VAT was found somewhere else in the document.
 */
function getInvoicePageSection(invoiceText: string, invoiceNo: string): string {
  const PAGE_BREAK = '--- PAGE BREAK ---'
  if (!invoiceNo) return invoiceText
  const idx = invoiceText.indexOf(invoiceNo)
  if (idx < 0) return invoiceText
  const before = invoiceText.lastIndexOf(PAGE_BREAK, idx)
  const start  = before < 0 ? 0 : before + PAGE_BREAK.length
  const after  = invoiceText.indexOf(PAGE_BREAK, idx)
  const end    = after  < 0 ? invoiceText.length : after
  return invoiceText.slice(start, end)
}

/**
 * For Lotus (LT) invoices: find the INVOICE-LEVEL description that's shared
 * across every row.  Only used for Formats A and D — for Formats B and C the
 * description is in a per-row table column and must be left to the LLM (else
 * we'd stomp every row with the same value).
 *
 * Format A (Credit Note): JNxx/JVxx/SNxx/SVxx/ONxx code line below VENDOR NO
 *   → returns the full line (e.g. "JN01 ส่วนลดในการร่วมกันสนับสนุนการขาย-โปรโมชัน")
 * Format D (Monthly Discount, invoice no ends in MDN): body mentions
 *   "Monthly Discount" without a "CIS " prefix
 *   → returns the literal "Monthly Discount"
 *
 * Returns null when no invoice-level pattern is recognised (Formats B/C, or
 * a yet-unknown layout).
 */
function findLTDescription(pageText: string): string | null {
  // Format A — deal-type code (returns the full matching line)
  const codeMatch = pageText.match(/\b(?:JN0[12]|JV0[12]|SN0[16]|SN12|SV03|ON01)\b/i)
  if (codeMatch) {
    const idx       = codeMatch.index!
    const lineStart = pageText.lastIndexOf('\n', idx - 1) + 1
    const lineEnd   = pageText.indexOf('\n', idx)
    const line      = pageText.slice(lineStart, lineEnd > 0 ? lineEnd : pageText.length).trim()
    return line || null
  }

  // Format D — standalone "Monthly Discount" (negative lookbehind excludes
  // "CIS Monthly Discount" which is a Format-C per-row value).
  if (/(?<!CIS\s)Monthly\s+Discount/i.test(pageText)) return 'Monthly Discount'

  return null
}

const LT_SECTION_RE = /\b(?:JN0[12]|JV0[12]|SN0[16]|SN12|SV03|ON01)\b/i

/**
 * For Lotus (LT) Format A (Credit Note): the JN01/JN02/JV01/... line is a
 * SECTION header, and ONE credit note can contain several sections. Each deal
 * row belongs to the section header that PRECEDES it. Given a string from the
 * row that physically appears in the page (its deal-reference number, else its
 * formatted amount), return the nearest section-header line above it.
 * Returns null if there are no section headers or the anchor can't be located.
 */
function findLTSectionForRow(pageText: string, anchor: string | null): string | null {
  if (!anchor) return null
  const idx = pageText.indexOf(anchor)
  if (idx < 0) return null
  const lines = pageText.slice(0, idx).split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    if (LT_SECTION_RE.test(lines[i])) return lines[i].trim()
  }
  return null
}

/** Anchor used to locate an LT row in the page text: its deal-reference number
 *  (a long digit run in product_description), falling back to its formatted amount. */
function ltRowAnchor(r: Record<string, unknown>): string | null {
  const ref = String(r.product_description ?? '').match(/\d{8,}/)
  if (ref) return ref[0]
  const amt = parseFloat(String(r.amount ?? '').replace(/,/g, ''))
  if (!isNaN(amt) && amt > 0) return amt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return null
}

/**
 * For Lotus (LT) invoices: Lotus prints our vendor customer code as
 * "TH0XXXX"; our internal code is "9XXXX".  Convert by stripping "TH"
 * and replacing the leading "0" with "9".  Codes that don't match this
 * exact shape (e.g. plain numeric "90607" from credit notes, or Site
 * codes like "TH10672") are returned unchanged.
 */
function convertLTVendorCode(code: string): string {
  const m = code.match(/^TH0(\d+)$/i)
  return m ? '9' + m[1] : code
}

/**
 * Find every plausible Lotus invoice-number candidate that ACTUALLY appears
 * in the source text.  We use this as a whitelist for filtering LLM output:
 * any extracted invoiceno that doesn't appear in the printed OCR text is a
 * hallucination and gets dropped.
 *
 * Patterns are deliberately BROAD (loose digit counts, optional dashes) so
 * we accept new layout variations we haven't seen yet — the safety comes
 * from the value having to be physically present in the source text, not
 * from matching a strict template.  This is more resilient than a tight
 * anchored regex (^...$) which would reject any legitimate-but-unfamiliar
 * shape.
 */
function findLTInvoiceCandidates(text: string): Set<string> {
  const found = new Set<string>()
  const patterns: RegExp[] = [
    /\bC\d{6,14}(?:CN|CV)\d{0,3}\b/gi,    // Format A — Credit Note     e.g. C260400519CN3
    /\b[A-Z]{2,3}\d{3,8}-?\d{3,8}\b/gi,   // Format B — Tax Invoice and variants
                                          //           e.g. BH2603-00013 / DC2511-00051 / TS2601-00030
                                          //           Any 2-3 letter prefix works — new document
                                          //           types (FOO, BAR…) are picked up automatically
                                          //           because the position-based whitelist still
                                          //           requires the value to actually appear on the page.
    /\bA\d{8,12}\b/gi,                    // Format C — Receipt row      e.g. A260310890
    /\bM\d{6,14}MDN\b/gi,                 // Format D — Monthly Discount e.g. M260410670MDN
  ]
  for (const re of patterns) {
    const matches = text.match(re)
    if (matches) for (const m of matches) found.add(m.toUpperCase().replace(/\s+/g, ''))
  }
  return found
}

/** Cut a captured note at the first boundary word ("Netting" or "สำหรับร้านค้า"),
 *  dropping it and anything after. Shared by CFR/CMK/BTM/CJ/CFW note handling. */
function cutAtNetting(s: string): string {
  const a = s.indexOf('Netting')
  const b = s.indexOf('สำหรับร้านค้า')
  const cut = a > 0 ? a : b > 0 ? b : -1
  return cut > 0 ? s.slice(0, cut).trim() : s.trim()
}

// Thai non-spacing combining marks (upper/lower vowels + tone marks). Stripping
// these from two strings lets us compare words ignoring marks the OCR dropped.
// NOTE: deliberately excludes the spacing vowels า(0E32) ำ(0E33) ะ(0E30).
const THAI_MARKS = /[ัิ-ฺ็-๎]/
const THAI_MARKS_G = /[ัิ-ฺ็-๎]/g
const stripThaiMarks = (s: string) => s.replace(THAI_MARKS_G, '')

// Some vendors print a fixed charge phrase that OCR mangles by dropping Thai
// tone marks (e.g. "ค่าส่วนลดชดเชยสินค้า" → "คาสวนลดชดเชยสินคา"). The charge is one
// of a small known set, so when a description STARTS with the marks-stripped form
// of a known charge, restore the correct charge prefix and keep the trailing text.
type Charge = { canon: string; bare: string }
const mkCharges = (arr: string[]): Charge[] =>
  arr.map((c) => ({ canon: c, bare: stripThaiMarks(c) }))
     .sort((a, b) => b.bare.length - a.bare.length) // longest (most specific) first
function restoreLeadingCharge(desc: string, charges: Charge[]): string {
  const bare = stripThaiMarks(desc)
  for (const { canon, bare: charge } of charges) {
    if (!bare.startsWith(charge)) continue
    // Consume `charge.length` non-mark chars from the original to find where the
    // charge prefix ends, then skip any trailing marks that belonged to it.
    let consumed = 0
    let i = 0
    while (i < desc.length && consumed < charge.length) {
      if (!THAI_MARKS.test(desc[i])) consumed++
      i++
    }
    while (i < desc.length && THAI_MARKS.test(desc[i])) i++
    return (canon + desc.slice(i)).trim()
  }
  return desc
}
const PT_CHARGES = mkCharges(['ค่าส่วนลดชดเชยสินค้า', 'ค่าสินค้าแรกเข้า', 'ค่าโฆษณา'])
const restorePtCharge = (d: string) => restoreLeadingCharge(d, PT_CHARGES)
// TSURUHA reference charge list (the line below No.1), per staff.
const TSURUHA_CHARGES = mkCharges([
  'ค่าชดเชยส่วนลด',
  'ค่าดำเนินการนำเข้าข้อมูลสินค้าใหม่',
  'ค่าบริการชดเชยปรับราคาทุน',
  'ค่า DC Fee 1.7%',
])
// TSURUHA product names that, when present in the รายการ, go to product_description.
const TSURUHA_PRODUCTS = ['Kincho', 'Dorco']

/** Convert YYYY-MM-DD → DD/MM/YYYY. Passes through anything that doesn't match. */
function isoToDmy(date: string): string {
  if (!date) return date
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return date
  return `${m[3]}/${m[2]}/${m[1]}`
}

/**
 * Append a 1-based sequence suffix to invoiceno when one invoice number spans
 * multiple line items: "X" with 3 rows → "X-1", "X-2", "X-3" (in row order).
 * Single-item invoices are left unchanged. Accounting needs each line to carry a
 * unique invoice reference. Used by both MAKRO and LT (Lotus).
 */
function appendInvoiceSeq(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const counts = new Map<string, number>()
  for (const r of rows) {
    const inv = (r.invoiceno as string) || ''
    if (inv) counts.set(inv, (counts.get(inv) || 0) + 1)
  }
  const seen = new Map<string, number>()
  return rows.map((r) => {
    const inv = (r.invoiceno as string) || ''
    if (!inv || (counts.get(inv) || 0) <= 1) return r
    const n = (seen.get(inv) || 0) + 1
    seen.set(inv, n)
    return { ...r, invoiceno: `${inv}-${String(n).padStart(3, '0')}` }
  })
}

/** Customer-master row shape used for the LLM lookup table. */
export interface CustomerMasterEntry {
  store_name: string
  customergroup: string
  customercode: string
  taxid: string
}

/** Normalized inputs to the extraction core (already validated). */
export interface ExtractCoreInput {
  text: string
  filename: string
  /** Pre-built customer-specific prompt section (or DEFAULT_CUSTOMER_SECTION). */
  customerSection: string
  vendorCode: string
  vendorBranch: string
  /** Upper-cased customer id (e.g. "MAKRO", "LT", ""). */
  customerId: string
  /** JSON string of the customer-master lookup table (or FALLBACK). */
  customerMasterJson: string
  apiKey: string
}

export type ExtractCoreResult =
  | { ok: true; rows: Record<string, unknown>[] }
  | { ok: false; status: number; error: string }

/** Chat messages sent to the extraction model. Exported so the eval harness can
 *  build an identical prompt for cache-keying without duplicating the format. */
export function buildExtractMessages(
  input: Pick<ExtractCoreInput, 'text' | 'filename' | 'customerSection' | 'customerMasterJson'>
): { role: 'system' | 'user'; content: string }[] {
  const truncated = input.text.length > 750000 ? input.text.slice(0, 750000) + '\n[truncated]' : input.text
  return [
    { role: 'system', content: buildSystemPrompt(input.customerMasterJson, input.customerSection) },
    { role: 'user', content: `Filename: ${input.filename}\n\nInvoice text:\n\n${truncated}` },
  ]
}

export type ModelCallResult =
  | { ok: true; content: string }
  | { ok: false; status: number; error: string }

/** The raw OpenRouter call: messages → model content string (un-parsed). */
export async function callExtractModel(
  messages: { role: string; content: string }[],
  apiKey: string
): Promise<ModelCallResult> {
  try {
    const apiRes = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.1, max_tokens: 32768 }),
    })

    if (!apiRes.ok) {
      const errText = await apiRes.text()
      if (apiRes.status === 429) {
        return { ok: false, status: 429, error: 'API quota exceeded. Please try again shortly.' }
      }
      return { ok: false, status: 502, error: `OpenRouter ${apiRes.status}: ${errText.slice(0, 300)}` }
    }

    const data = await apiRes.json()
    return { ok: true, content: data?.choices?.[0]?.message?.content || '[]' }
  } catch (err) {
    return { ok: false, status: 500, error: err instanceof Error ? err.message : String(err) }
  }
}

export interface PostProcessOpts {
  text: string
  vendorCode: string
  vendorBranch: string
  customerId: string
  customerMasterJson: string
}

/**
 * Pure extraction core: build prompt → OpenRouter → JSON parse → deterministic
 * post-processing → rows.  Contains NO auth, env, or Express dependency, so it
 * can be called directly (e.g. by the eval harness in scripts/eval) as well as
 * by the HTTP handler below.  Behavior is identical to the original handler.
 */
export async function extractRowsCore(input: ExtractCoreInput): Promise<ExtractCoreResult> {
  // Large PDFs (e.g. a 37-page Makro register) overflow the model's output token
  // budget when sent in one shot, truncating the JSON → parse throws → blank.
  // Batch by page so each call's output stays within max_tokens, and surface a
  // parse exception as an error instead of silently returning [].
  const pages = input.text
    .split(/\n*\s*---\s*PAGE BREAK\s*---\s*\n*/)
    .filter((p) => p.trim().length > 0)
  const BATCH = 8

  let rawRows: Record<string, unknown>[]

  if (pages.length <= BATCH) {
    // Common small-doc path — single call, unchanged behavior except that a true
    // JSON-parse exception now surfaces an error rather than blanking the result.
    const call = await callExtractModel(buildExtractMessages(input), input.apiKey)
    if (!call.ok) return call
    try {
      rawRows = parseJsonFromText(call.content) as Record<string, unknown>[]
    } catch {
      return { ok: false, status: 502, error: 'The model returned invalid JSON (try fewer pages or re-run).' }
    }
  } else {
    // Multi-batch path: each batch is one model call. Running them sequentially
    // made large PDFs (e.g. 37 pages → 5 calls) ~5× slower and tripped the
    // gateway timeout (504). Run them through a bounded-concurrency pool instead,
    // capped so even a 100-page doc (13 batches) never fires more than CONCURRENCY
    // simultaneous OpenRouter calls (rate-limit safety) — and assemble the parsed
    // rows strictly IN BATCH ORDER so appendInvoiceSeq sees rows in page order.
    const CONCURRENCY = 5

    // Build the batch texts first, preserving order.
    const batchTexts: string[] = []
    for (let i = 0; i < pages.length; i += BATCH) {
      batchTexts.push(pages.slice(i, i + BATCH).join('\n\n--- PAGE BREAK ---\n\n'))
    }

    type BatchResult =
      | { ok: true; rows: Record<string, unknown>[] }
      | { ok: false; status: number; error: string }

    // Order-preserving bounded pool (same shape as the pool in api/ocrPdf.ts):
    // at most `n` workers pull from a shared index, writing results by index.
    const results: BatchResult[] = new Array(batchTexts.length)
    let next = 0
    async function worker() {
      while (next < batchTexts.length) {
        const i = next++
        const batchText = batchTexts[i]
        const start = i * BATCH + 1
        const end = Math.min(i * BATCH + BATCH, pages.length)
        const call = await callExtractModel(
          buildExtractMessages({ ...input, text: batchText }),
          input.apiKey
        )
        if (!call.ok) {
          results[i] = { ok: false, status: call.status, error: call.error }
          continue
        }
        try {
          results[i] = { ok: true, rows: parseJsonFromText(call.content) as Record<string, unknown>[] }
        } catch {
          results[i] = {
            ok: false,
            status: 502,
            error: `Extraction failed on pages ${start}-${end} of ${pages.length} (model output not valid JSON).`,
          }
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, batchTexts.length) }, worker)
    )

    // Surface the earliest-by-index failure (so the page range in the error is the
    // first failing batch in page order); only merge rows when EVERY batch parsed.
    const firstFailure = results.find((r) => !r.ok)
    if (firstFailure && !firstFailure.ok) return firstFailure

    rawRows = []
    for (const r of results) {
      if (r.ok) rawRows.push(...r.rows)
    }
  }

  // Post-process ONCE over the FULL original text so per-invoice page isolation,
  // Makro VAT/WHT calc, and appendInvoiceSeq see every row + the whole document.
  const rows = postProcessRows(rawRows, {
    text: input.text,
    vendorCode: input.vendorCode,
    vendorBranch: input.vendorBranch,
    customerId: input.customerId,
    customerMasterJson: input.customerMasterJson,
  })
  return { ok: true, rows }
}

/**
 * Deterministic per-customer post-processing applied to the LLM's raw rows.
 * Pure & synchronous (no network) — the eval harness can re-run this for free
 * over cached raw model output to evaluate post-processing changes at zero LLM cost.
 */
export function postProcessRows(rawRows: Record<string, unknown>[], opts: PostProcessOpts): Record<string, unknown>[] {
  const { text, vendorCode, vendorBranch, customerId, customerMasterJson } = opts
  let rows = rawRows

    // Config-driven post-processing — deterministic overrides per customer.
    if (vendorCode === 'blank') {
      rows = rows.map((r) => ({ ...r, vendor_customercode: '' }))
    } else if (vendorCode === 'buyer-line' || vendorCode === 'header-bracket' || vendorCode === 'top-m-line' || vendorCode === 'auto') {
      // 'ac-no' / 'vendor-no' are left to the LLM (those invoices are scanned/OCR'd)
      const code = extractHeaderVendorCode(text, vendorCode)
      if (code) rows = rows.map((r) => ({ ...r, vendor_customercode: code }))
    }

    if (vendorBranch === 'blank') {
      rows = rows.map((r) => ({ ...r, vendor_branch: '' }))
    }

    // Makro-only per-line VAT/WHT3 calculation.
    //
    // Makro prints only the GRAND TOTAL VAT and WHT3 — the LLM tends to copy
    // those totals into every row, so we recompute them per-line:
    //   vat_7     = amount × 0.07   (only when the page actually has VAT)
    //   tax_3     = amount × 0.03   (Makro invoices always carry WHT3)
    //   netamount = amount + vat_7 − tax_3
    //
    // We DO NOT run this block for other vendors.  Every other customer either:
    //   (a) prints per-line VAT/WHT3 explicitly — LLM extracts them directly, or
    //   (b) has no VAT — must stay zero.
    // An earlier broader trigger fired for any invoice where `hasNonZeroVat`
    // returned true, but that produced false positives on non-Makro vendors:
    // the fallback in hasNonZeroVat picks up the AMOUNT or TOTAL column
    // instead of the VAT cell, fabricating a 7% VAT on invoices that
    // actually have VAT = 0.
    if (customerId === 'MAKRO') {
      const vatCache = new Map<string, boolean>()
      rows = rows.map((r) => {
        const invoiceNo = (r.invoiceno as string) || ''
        if (!vatCache.has(invoiceNo)) {
          vatCache.set(invoiceNo, hasNonZeroVat(getInvoicePageSection(text, invoiceNo)))
        }
        const applyVat = vatCache.get(invoiceNo)!

        const amt = parseFloat((r.amount as string)?.replace(/,/g, '') ?? '')
        if (isNaN(amt)) return { ...r, vat_7: '0', tax_3: '0' }

        const vat7 = applyVat ? amt * 0.07 : 0
        const tax3 = amt * 0.03
        const net  = amt + vat7 - tax3
        return {
          ...r,
          vat_7:     applyVat ? vat7.toFixed(2) : '0',
          tax_3:     tax3.toFixed(2),
          netamount: net.toFixed(2),
        }
      })
    }

    // Makro: combine both lines of the รายละเอียด cell into description, and
    // blank product_description.  The previous position-based approach (read
    // the line above the amount from OCR) was unreliable because Gemini Vision
    // does not always preserve the two-line row structure as separate text
    // lines.  Trust the LLM — which sees the page text and is instructed by
    // the notes to read both lines — and just merge whatever it puts in the
    // two fields:
    //   description         = LLM.description + ' ' + LLM.product_description
    //   product_description = ''
    // This works whether the LLM follows the new note (puts both in description,
    // leaves product_description empty) or the old split (line 1 in description,
    // line 2 in product_description).
    //
    // Also append a 1-based sequence suffix to invoiceno when one invoice has
    // multiple line items: "26512592" with 2 rows → "26512592-1", "26512592-2".
    // Single-item invoices are left unchanged.  Accounting needs each line to
    // have a unique invoice reference.
    if (customerId === 'MAKRO') {
      rows = rows.map((r) => {
        const desc  = ((r.description as string)         || '').trim()
        const pdesc = ((r.product_description as string) || '').trim()
        const combined = [desc, pdesc].filter(Boolean).join(' ').trim()
        return { ...r, description: combined, product_description: '' }
      })

      rows = appendInvoiceSeq(rows)
    }

    // LT (Lotus) — three server-side fixes:
    //   1. Drop rows whose invoiceno isn't actually printed on the source PDF.
    //      Build the whitelist FROM the OCR text itself (position-based) —
    //      this way new format variations we haven't anticipated still pass,
    //      while hallucinated invoice numbers (e.g. "P00030007P0N" fabricated
    //      from column-header noise) get dropped because no such string exists
    //      in the source.
    //   2. description: force invoice-level deal-type line for Formats A/D
    //      (skipped for Formats B/C where description is per-row in a table).
    //   3. vendor_customercode: convert printed "TH0XXXX" → internal "9XXXX".
    // Tax fields are NEVER calculated for Lotus — the LLM copies the printed
    // values (or "0.00" when absent) per the customer notes. EXCEPTION: credit-
    // note invoices (invoiceno starting with "C") have no printed net amount, so
    // netamount is computed below (amount + vat_7 − all withholding taxes).
    if (customerId === 'LT') {
      const validInvoices = findLTInvoiceCandidates(text)
      rows = rows.filter((r) => {
        const inv = ((r.invoiceno as string) || '').trim().toUpperCase().replace(/\s+/g, '')
        return inv !== '' && validInvoices.has(inv)
      })

      rows = rows.map((r) => {
        const invoiceNo = (r.invoiceno as string) || ''
        const pageText = getInvoicePageSection(text, invoiceNo)
        // Format A: resolve THIS row's section header (a credit note may hold
        // several JN01/JN02/... sections — each row takes the header above its
        // own deal reference, not the first header in the document). Fall back to
        // the invoice-level description for Format D / when the row can't be located.
        let desc: string | null = null
        if (LT_SECTION_RE.test(pageText)) desc = findLTSectionForRow(pageText, ltRowAnchor(r))
        if (desc == null) desc = findLTDescription(pageText)
        const withDesc = desc ? { ...r, description: desc } : r
        const code = (withDesc.vendor_customercode as string) || ''
        const converted = convertLTVendorCode(code)
        return converted !== code ? { ...withDesc, vendor_customercode: converted } : withDesc
      })

      // Lotus CREDIT NOTE invoices (invoiceno starts with "C") print only AMOUNT
      // and VAT — no net amount — so compute it here:
      //   netamount = amount + vat_7 − tax_2 − tax_3 − tax_5
      // Other Lotus formats keep the printed netamount (copied by the LLM).
      rows = rows.map((r) => {
        const inv = ((r.invoiceno as string) || '').trim().toUpperCase()
        if (!inv.startsWith('C')) return r
        const amt = parseFloat(String((r.amount as string) ?? '').replace(/,/g, ''))
        if (isNaN(amt)) return r
        const num = (v: unknown) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0
        const net = amt + num(r.vat_7) - num(r.tax_2) - num(r.tax_3) - num(r.tax_5)
        return { ...r, netamount: net.toFixed(2) }
      })

      // One Lotus invoice number spans several deal rows — append a running
      // sequence suffix (…CN3-1, …CN3-2). Done LAST, after all invoiceno-based
      // lookups above, so page isolation still works on the bare number.
      rows = appendInvoiceSeq(rows)
    }

    // CP All (7-Eleven): one invoice number can span several line items —
    // append the running 3-digit sequence suffix, same as Makro / Lotus.
    if (customerId === 'CP_ALL') {
      rows = appendInvoiceSeq(rows)
    }

    // THEMALL (incl. City Mall Group / EM District / Emporium / EmQuartier /
    // Emsphere):
    //   1. product_description is always blank — the only descriptive text
    //      lives in the รายการ / Description column which maps to `description`.
    //   2. Withholding tax is computed per-invoice from amount:
    //        - tax_2 = amount × 0.02  when the invoice text contains
    //          "ค่าสื่อ" / "ค่าโฆษณา" / "โฆษณา" / "Advertising" (media/ad fees)
    //        - tax_3 = amount × 0.03  otherwise (general service fees)
    //   3. netamount = amount + vat_7 − tax_2 − tax_3
    if (customerId === 'THEMALL') {
      const AD_KEYWORDS = /ค่าสื่อ|ค่าโฆษณา|โฆษณา|advertising/i
      const adCache = new Map<string, boolean>()
      rows = rows.map((r) => {
        const invoiceNo = (r.invoiceno as string) || ''
        if (!adCache.has(invoiceNo)) {
          adCache.set(invoiceNo, AD_KEYWORDS.test(getInvoicePageSection(text, invoiceNo)))
        }
        const isAd = adCache.get(invoiceNo)!

        const amt = parseFloat((r.amount as string)?.replace(/,/g, '') ?? '')
        if (isNaN(amt)) return { ...r, product_description: '' }

        const vat  = parseFloat((r.vat_7 as string)?.replace(/,/g, '') ?? '') || 0
        const tax2 = isAd  ? amt * 0.02 : 0
        const tax3 = !isAd ? amt * 0.03 : 0
        const net  = amt + vat - tax2 - tax3
        return {
          ...r,
          product_description: '',
          tax_2:     tax2.toFixed(2),
          tax_3:     tax3.toFixed(2),
          netamount: net.toFixed(2),
        }
      })
    }

    // CFR: the หมายเหตุ note lives in `remark`; truncate it at Netting/สำหรับร้านค้า.
    if (customerId === 'CFR') {
      rows = rows.map((r) => ({ ...r, remark: cutAtNetting((r.remark as string) || '') }))
    }

    // CFM: strip the leading "รายการ"/"สินค้า" labels the LLM sometimes keeps,
    // blank vendor_expensegroup, and fold the remark into the description.
    if (customerId === 'CFM') {
      const stripLabel = (s: string, label: string) =>
        s.replace(new RegExp('^\\s*' + label + '\\s*:?\\s*'), '').trim()
      // defensive: cut the boilerplate that can leak into the remark
      const cutRemark = (s: string) =>
        s.split(/ข้าพเจ้าได้รับทราบ|หมายเหตุ\s*\n?\s*1\./)[0].trim()
      rows = rows.map((r) => {
        let desc = stripLabel(String((r.description as string) ?? ''), 'รายการ')
        const pdesc = stripLabel(String((r.product_description as string) ?? ''), 'สินค้า')
        const remark = cutRemark(String((r.remark as string) ?? ''))
        if (remark) desc = [desc, remark].filter(Boolean).join(' ').trim()
        return { ...r, description: desc, product_description: pdesc, remark, vendor_expensegroup: '' }
      })
    }

    // CMK / BTM / CJ: the หมายเหตุ note goes into `product_description` (these
    // invoices have no product-detail line); truncate it at Netting/สำหรับร้านค้า.
    if (customerId === 'CMK' || customerId === 'BTM' || customerId === 'CJ') {
      rows = rows.map((r) => ({ ...r, product_description: cutAtNetting((r.product_description as string) || '') }))
    }

    // CFW: description = รายการ + หมายเหตุ. Combine whatever the LLM put in
    // description and product_description, cut at Netting, and blank product_description.
    // CFW / WATSON / PT all want the WHOLE description content in `description` with
    // product_description blank — the LLM sometimes splits a multi-line cell across
    // the two fields, so merge them here.
    if (customerId === 'CFW' || customerId === 'WATSON' || customerId === 'PT' || customerId === 'FOODLAND') {
      rows = rows.map((r) => {
        const desc  = String((r.description as string) ?? '').trim()
        const pdesc = String((r.product_description as string) ?? '').trim()
        let merged = cutAtNetting([desc, pdesc].filter(Boolean).join(' '))
        // PT: repair the charge phrase when OCR dropped its Thai tone marks.
        if (customerId === 'PT') merged = restorePtCharge(merged)
        return { ...r, description: merged, product_description: '' }
      })
    }

    // AEON: no invoice number on the output, no product-detail field, and the
    // invoice is VAT 0% — force those deterministically. netamount is computed
    // per line by the TAX_RULES block below (3% WHT), NOT taken from the total.
    if (customerId === 'AEON') {
      rows = rows.map((r) => ({ ...r, invoiceno: '', product_description: '', vat_7: '0' }))
    }

    // BOOTS: collapse ONLY the two rebate/fee categories, PER INVOICE.
    //   - Classify a line by its distinctive, reliably-OCR'd token (Rebate /
    //     Distribution) and snap to the canonical label — so OCR mangling the
    //     leading word ("Supplier" → "Suppller") or the "(0.5%)" still groups
    //     correctly (the % text comes from the fixed label, not the OCR).
    //   - Merge per (invoiceno + category): a Boots PDF often holds many separate
    //     invoices (e.g. several single-line "SP4 Scan out" invoices) — those must
    //     stay distinct, so different Invoice No.s never merge together.
    //   - Every OTHER line (Scan out, Anniversary support income, SPC, …) passes
    //     through as its own row — never absorbed; just Ref-cleaned and blanked.
    //   tax_3 / netamount are then computed per row by TAX_RULES (always 3%).
    if (customerId === 'BOOTS') {
      const cleanDesc = (s: string) =>
        s.replace(/\s*\bRef\b\.?.*$/i, '').replace(/\s+/g, ' ').trim()
      const category = (s: string): string | null => {
        if (/rebat/i.test(s)) return 'Supplier/Flat Rebate (0.5%)'
        if (/distribut/i.test(s)) return 'Distribution Fee Income (1.5%)'
        return null
      }
      const out: Record<string, unknown>[] = []
      const mergedByKey = new Map<string, Record<string, unknown>>()
      for (const r of rows) {
        const base = { ...r, product_description: '', vendor_expensecode: '', vendor_expensegroup: '' }
        const cat = category(String((r.description as string) ?? ''))
        const amt = parseFloat(String((r.amount as string) ?? '').replace(/,/g, ''))
        const vat = parseFloat(String((r.vat_7 as string) ?? '').replace(/,/g, ''))
        if (!cat) {
          out.push({ ...base, description: cleanDesc(String((r.description as string) ?? '')) })
          continue
        }
        const key = String((r.invoiceno as string) ?? '').trim() + '|' + cat
        const existing = mergedByKey.get(key)
        if (existing) {
          existing.__sum = (existing.__sum as number) + (isNaN(amt) ? 0 : amt)
          existing.__vat = (existing.__vat as number) + (isNaN(vat) ? 0 : vat)
        } else {
          const row = { ...base, description: cat, __sum: isNaN(amt) ? 0 : amt, __vat: isNaN(vat) ? 0 : vat }
          mergedByKey.set(key, row)
          out.push(row)
        }
      }
      rows = out.map((r) => {
        if ('__sum' in r) {
          const { __sum, __vat, ...rest } = r as Record<string, unknown>
          return { ...rest, amount: (__sum as number).toFixed(2), vat_7: (__vat as number).toFixed(2) }
        }
        return r
      })
    }

    // TSURUHA: one invoice = ONE row. The Description cell lists a charge line
    // plus several "(Period …) <channel>" lines (All Store / Lazada / Shopee);
    // the LLM tends to emit one row per line. Collapse rows that share an
    // invoiceno into a single row — join their descriptions and set amount to
    // the sum of the line amounts (which equals the printed "Total before Vat").
    // tax_3 / netamount are then computed on that total by the TAX_RULES block.
    if (customerId === 'TSURUHA') {
      const groups = new Map<string, Record<string, unknown>[]>()
      for (const r of rows) {
        const key = String((r.invoiceno as string) ?? '').trim()
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(r)
      }
      rows = [...groups.values()].map((grp) => {
        const descs: string[] = []
        const products: string[] = []
        let sum = 0
        for (const r of grp) {
          let d = String((r.description as string) ?? '').trim()
          const pd = String((r.product_description as string) ?? '').trim()
          // Pull known product names (Kincho/Dorco) into product_description —
          // the LLM may have put them in EITHER field — and drop them from the
          // description text when present there.
          for (const p of TSURUHA_PRODUCTS) {
            const re = new RegExp(p, 'i')
            if (!re.test(d) && !re.test(pd)) continue
            if (!products.some((x) => x.toLowerCase() === p.toLowerCase())) products.push(p)
            d = d.replace(re, '').trim()
          }
          if (d && !descs.includes(d)) descs.push(d)
          const a = parseFloat(String((r.amount as string) ?? '').replace(/,/g, ''))
          if (!isNaN(a)) sum += a
        }
        // Repair the leading charge phrase when OCR dropped its Thai tone marks.
        const description = restoreLeadingCharge(descs.join(' '), TSURUHA_CHARGES)
        return { ...grp[0], description, product_description: products.join(' '), amount: sum.toFixed(2) }
      })

      // Safety net: the product names are reliable keywords. If the source text
      // mentions one but the LLM dropped it from both fields, attach it — only
      // when this upload is a single invoice (one row), so it can't be misattributed.
      if (rows.length === 1) {
        const have = String((rows[0].product_description as string) ?? '')
        const found = TSURUHA_PRODUCTS.filter(
          (p) => new RegExp(p, 'i').test(text) && !new RegExp(p, 'i').test(have)
        )
        if (found.length) {
          rows[0] = { ...rows[0], product_description: [have, ...found].filter(Boolean).join(' ') }
        }
      }
    }

    // In-house vendor_customercode normalisation:
    //   CFR, CMK — "9" + the 6-digit store code (TOP-M802316 → 9802316).
    //   BTM, CFW, HOMEPRO — keep digits only (CFW-M900548 → 900548; V.3103 → 3103).
    if (customerId === 'CFR' || customerId === 'CMK') {
      rows = rows.map((r) => {
        const d = String((r.vendor_customercode as string) ?? '').replace(/\D/g, '')
        return /^\d{6}$/.test(d) ? { ...r, vendor_customercode: '9' + d } : r
      })
    } else if (customerId === 'BTM' || customerId === 'CFW' || customerId === 'HOMEPRO') {
      rows = rows.map((r) => {
        const vc = String((r.vendor_customercode as string) ?? '')
        const d = vc.replace(/\D/g, '')
        return d && d !== vc ? { ...r, vendor_customercode: d } : r
      })
    }

    // FOODLAND: the A/C No. is always one of a known set; OCR may misread it.
    // Snap to an exact digits match, or to the single closest code within edit
    // distance 2. Leave ambiguous reads alone (929508 is a prefix of 92950801,
    // so a truncated 92950801 can't be safely distinguished from 929508).
    if (customerId === 'FOODLAND') {
      const CODES = ['929509', '912074', '929508', '92950801']
      const lev = (a: string, b: string): number => {
        const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
        for (let j = 0; j <= b.length; j++) dp[0][j] = j
        for (let i = 1; i <= a.length; i++)
          for (let j = 1; j <= b.length; j++)
            dp[i][j] = Math.min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1))
        return dp[a.length][b.length]
      }
      rows = rows.map((r) => {
        const d = String((r.vendor_customercode as string) ?? '').replace(/\D/g, '')
        if (!d) return r
        if (CODES.includes(d)) return { ...r, vendor_customercode: d }
        const scored = CODES.map((c) => ({ c, dist: lev(d, c) })).sort((x, y) => x.dist - y.dist)
        if (scored[0].dist <= 2 && (scored.length < 2 || scored[1].dist > scored[0].dist)) {
          return { ...r, vendor_customercode: scored[0].c }
        }
        return { ...r, vendor_customercode: d }
      })
    }

    // Withholding-tax calculation (classified per row from its description) for the
    // vendors that print only a grand-total / net-of-WHT figure. Verified against
    // each register. Per vendor: an "ad" keyword triggers the 2% rate; "ค่าปรับ"
    // (CJ only) means no WHT; everything else is 3%.
    //   netamount = amount + vat_7 − tax_2 − tax_3   (vat_7 stays as printed)
    const TAX_RULES: Record<string, { ad: RegExp | null; penalty: boolean }> = {
      CJ:     { ad: /ค่าโฆษณา|โฆษณา/, penalty: true },
      BTM:    { ad: /ค่าโฆษณา|โฆษณา/, penalty: false },
      CFW:    { ad: /ค่าโฆษณา|โฆษณา/, penalty: false },
      PT:     { ad: /ค่าโฆษณา|โฆษณา/, penalty: false },
      FOODLAND:{ ad: /ค่าโฆษณา|โฆษณา/, penalty: false },  // ค่าโฆษณา → 2%, else 3%
      PTT:    { ad: /Media/i,          penalty: false },
      WATSON: { ad: null,              penalty: false },  // always 3%
      VILLA:  { ad: null,              penalty: false },  // always 3%
      AEON:   { ad: null,              penalty: false },  // always 3%, VAT 0% (vat_7 forced 0 above)
      BOOTS:  { ad: null,              penalty: false },  // always 3% (WHT printed on invoice; label as 3%)
      TSURUHA:{ ad: null,              penalty: false },  // always 3% on the merged "Total before Vat"
    }
    const taxRule = TAX_RULES[customerId]
    if (taxRule) {
      rows = rows.map((r) => {
        const amt = parseFloat(String((r.amount as string) ?? '').replace(/,/g, ''))
        if (isNaN(amt)) return r
        const cls = `${(r.description as string) ?? ''} ${(r.product_description as string) ?? ''}`
        const vat = parseFloat(String((r.vat_7 as string) ?? '').replace(/,/g, '')) || 0
        let tax2 = 0, tax3 = 0
        if (taxRule.penalty && /ค่าปรับ/.test(cls)) { /* penalty — no withholding */ }
        else if (taxRule.ad && taxRule.ad.test(cls)) tax2 = amt * 0.02
        else tax3 = amt * 0.03
        return {
          ...r,
          tax_2:     tax2.toFixed(2),
          tax_3:     tax3.toFixed(2),
          netamount: (amt + vat - tax2 - tax3).toFixed(2),
        }
      })
    }

    // Big C: split the รายการ cell into 4 fields.
    //   Format:  "<Thai/English description> : <5-digit code> <English group>"
    //   Example: "ส่วนลดพิเศษ Anniversary P1D04-PANI006012-HO : 21630 Salted Grocery -DF"
    //   →  description         = "ส่วนลดพิเศษ Anniversary P1D04-PANI006012-HO"
    //      vendor_expensecode  = "21630"
    //      vendor_expensegroup = "Salted Grocery -DF"
    //      product_description = ""
    // The LLM tends to dump the whole cell into product_description, so we
    // merge description + product_description first, then parse.  No match →
    // leave description alone and just blank product_description.
    if (customerId === 'BIGC' || customerId === 'BIGC_FOOD') {
      const BIGC_ROW_RE = /^(.+?)\s*:\s*(\d{5})\s+(.+)$/
      rows = rows.map((r) => {
        const desc  = ((r.description as string)         || '').trim()
        const pdesc = ((r.product_description as string) || '').trim()
        const full  = [desc, pdesc].filter(Boolean).join(' ').trim()
        const m = full.match(BIGC_ROW_RE)
        if (!m) return { ...r, product_description: '' }
        return {
          ...r,
          description:         m[1].trim(),
          vendor_expensecode:  m[2],
          vendor_expensegroup: m[3].trim(),
          product_description: '',
        }
      })
    }

    // CP Axtra address disambiguation: Lotus (customergroup 05) and Makro (customergroup 04)
    // share the same taxid (0107567000414).  The only reliable discriminator is the vendor's
    // printed address.  Per-invoice page, search for the distinctive street name and override
    // customergroup / customercode from the matching Customer Master row.
    //   "629/1 ถนนนวมินทร์" (Nawamin)     → Lotus  → group 05
    //   "1468 ถนนพัฒนาการ"  (Pattanakarn) → Makro  → group 04
    {
      const masterEntries: Array<{store_name: string; customergroup: string; customercode: string; taxid: string}> = JSON.parse(customerMasterJson)
      const lotusEntry = masterEntries.find(e => e.taxid === '0107567000414' && e.customergroup.startsWith('05'))
      const makroEntry = masterEntries.find(e => e.taxid === '0107567000414' && e.customergroup.startsWith('04'))
      if (lotusEntry || makroEntry) {
        const addrCache = new Map<string, { customergroup: string; customercode: string } | null>()
        rows = rows.map((r) => {
          const invoiceNo = (r.invoiceno as string) || ''
          if (!addrCache.has(invoiceNo)) {
            const pageText = getInvoicePageSection(text, invoiceNo)
            if (pageText.includes('นวมินทร์') && lotusEntry) {
              addrCache.set(invoiceNo, { customergroup: lotusEntry.customergroup, customercode: lotusEntry.customercode })
            } else if (pageText.includes('พัฒนาการ') && makroEntry) {
              addrCache.set(invoiceNo, { customergroup: makroEntry.customergroup, customercode: makroEntry.customercode })
            } else {
              addrCache.set(invoiceNo, null)
            }
          }
          const override = addrCache.get(invoiceNo)
          return override ? { ...r, ...override } : r
        })
      }
    }

    // Convert dates from YYYY-MM-DD → DD/MM/YYYY for all customers.
    rows = rows.map((r) => ({
      ...r,
      invoicedate: isoToDmy(r.invoicedate as string),
      duedate:     isoToDmy(r.duedate as string),
    }))

  return rows
}

/** Build the customer-master JSON string used by the prompt (or FALLBACK when empty). */
export function buildCustomerMasterJson(cm: unknown): string {
  return (Array.isArray(cm) && cm.length > 0)
    ? JSON.stringify((cm as CustomerMasterEntry[]).map(({ store_name, customergroup, customercode, taxid }) =>
        ({ store_name, customergroup, customercode, taxid })))
    : JSON.stringify(FALLBACK_CUSTOMER_MASTER)
}

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  if (!await verifyAzureToken(req.headers.authorization)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' })
  }

  let coreInput: ExtractCoreInput
  try {
    const body = req.body || {}
    const text = (body.text || '').trim()
    if (!text) throw new Error('empty text')
    coreInput = {
      text,
      filename: body.filename || '',
      customerSection: (body.customerInstructions || '').trim() || DEFAULT_CUSTOMER_SECTION,
      vendorCode: body.vendorCode || 'auto',
      vendorBranch: body.vendorBranch || 'auto',
      customerId: (body.customerId || '').toUpperCase(),
      customerMasterJson: buildCustomerMasterJson(body.customerMaster),
      apiKey,
    }
  } catch {
    return res.status(400).json({ error: 'Expected { text: string, filename?: string, customerMaster?: array }' })
  }

  const result = await extractRowsCore(coreInput)
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error })
  }
  return res.status(200).json({ rows: result.rows })
}
