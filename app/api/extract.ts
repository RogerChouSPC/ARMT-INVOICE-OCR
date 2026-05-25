import type { Request, Response } from 'express'

// Customer rules live in src/config/customers.ts (single source of truth, used by
// the frontend). The API stays self-contained and does not import from src/ — the
// frontend detects the customer and sends the resulting instructions + directives
// in the request body.

const DEFAULT_CUSTOMER_SECTION = `DETECTED CUSTOMER: unknown — use general rules.
vendor_customercode: a code in [brackets]/(parentheses) near the company name or ชื่อผู้ซื้อ line; otherwise a labelled รหัสร้านค้า / Customer Code. Strip vendor prefixes from hyphenated codes (e.g. "TOP-M802316" → "802316").
vendor_branch: only an explicitly labelled branch ("สาขาที่", "Branch", "Site code"); "Group [number]" is NOT a branch; return "" if none found.`

async function verifyAzureToken(authHeader: string | undefined): Promise<boolean> {
  if (!authHeader?.startsWith('Bearer ')) return false
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: authHeader },
    })
    return res.ok
  } catch {
    return false
  }
}

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

Output fields (22 columns):
- customergroup: from Customer Master lookup (exact copy)
- customercode: from Customer Master lookup (exact copy)
- taxid: the invoice ISSUER's 13-digit tax ID
- vendor_customercode: see CUSTOMER-SPECIFIC INSTRUCTIONS above
- vendor_branch: see CUSTOMER-SPECIFIC INSTRUCTIONS above
- vendor_expensecode: expense code if present, else ""
- vendor_expensegroup: expense group if present, else ""
- divisionsale: always return "" (not used yet)
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

const FALLBACK_CUSTOMER_MASTER = [
  { store_name: 'บิ๊กซี ซูเปอร์เซ็นเตอร์', customergroup: '01 - บิ๊กซี', customercode: '0100857 บิ๊กซี ซูเปอร์เซ็นเตอร์ จำกัด (มหาชน)', taxid: '0107537002445' },
  { store_name: 'โลตัส', customergroup: '05 - โลตัส', customercode: '0114682 ซีพี แอ็กซ์ตร้า จำกัด (โลตัส)', taxid: '0107567000414' },
  { store_name: 'แม็คโคร', customergroup: '04 - ซีพี แอ็กซ์ตร้า(Makro)', customercode: '0102856 ซีพี แอ็กซ์ตร้า จำกัด (Makro)', taxid: '0107567000414' },
  { store_name: 'เซ็นทรัล', customergroup: '11 - เซ็นทรัล', customercode: '0109266 เซ็นทรัลพัฒนา จำกัด (มหาชน)', taxid: '0107536000633' },
]

function parseJsonFromText(text: string): object[] {
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
 * For Makro invoices: locate a line item in the OCR page text by its printed
 * amount and extract the two-line description layout:
 *   - The line ON THE SAME LINE as the amount → product_description (detail)
 *   - The line IMMEDIATELY ABOVE the amount  → description (category heading)
 *
 * Makro prints each item as:
 *   "Data Providing Deal/MSP"              ← description (no amount)
 *   "Data Providing Deal/MSP 2026  7,326.53"  ← product_description + amount
 *
 * usedPositions prevents the same text position being matched twice when
 * multiple line items share the same amount value.
 */
function findMakroItemLines(
  pageText: string,
  amountRaw: string,
  usedPositions: Set<number>,
): { description: string; product_description: string } | null {
  const amtNum = parseFloat((amountRaw || '').replace(/,/g, ''))
  if (isNaN(amtNum) || amtNum <= 0) return null
  // Makro prints amounts with thousands separators: 7,326.53 / 115,600.00
  const formatted = amtNum.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

  let from = 0
  while (from < pageText.length) {
    const idx = pageText.indexOf(formatted, from)
    if (idx < 0) break
    if (!usedPositions.has(idx)) {
      usedPositions.add(idx)

      // Line that contains the amount
      const lineStart = pageText.lastIndexOf('\n', idx - 1) + 1
      const lineEnd   = pageText.indexOf('\n', idx)
      const line      = pageText.slice(lineStart, lineEnd > 0 ? lineEnd : pageText.length)

      // product_description = everything before the amount on that line
      const product_description = line.slice(0, line.indexOf(formatted)).trim()

      // description = the line immediately above
      const prevEnd   = lineStart > 0 ? lineStart - 1 : 0
      const prevStart = pageText.lastIndexOf('\n', prevEnd - 1) + 1
      const description = pageText.slice(prevStart, prevEnd).trim()

      if (description || product_description) {
        return { description, product_description }
      }
    }
    from = idx + 1
  }
  return null
}

/** Convert YYYY-MM-DD → DD/MM/YYYY. Passes through anything that doesn't match. */
function isoToDmy(date: string): string {
  if (!date) return date
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return date
  return `${m[3]}/${m[2]}/${m[1]}`
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

  let text: string
  let filename: string
  let customerMasterJson: string
  let customerSection: string
  let vendorCode: string
  let vendorBranch: string
  let customerId: string
  try {
    const body = req.body || {}
    text = (body.text || '').trim()
    filename = body.filename || ''
    if (!text) throw new Error('empty text')
    customerSection = (body.customerInstructions || '').trim() || DEFAULT_CUSTOMER_SECTION
    vendorCode = body.vendorCode || 'auto'
    vendorBranch = body.vendorBranch || 'auto'
    customerId = (body.customerId || '').toUpperCase()
    const cm = body.customerMaster
    customerMasterJson = (Array.isArray(cm) && cm.length > 0)
      ? JSON.stringify(cm.map(({ store_name, customergroup, customercode, taxid }: {
          store_name: string; customergroup: string; customercode: string; taxid: string
        }) => ({ store_name, customergroup, customercode, taxid })))
      : JSON.stringify(FALLBACK_CUSTOMER_MASTER)
  } catch {
    return res.status(400).json({ error: 'Expected { text: string, filename?: string, customerMaster?: array }' })
  }

  const truncated = text.length > 750000 ? text.slice(0, 750000) + '\n[truncated]' : text

  try {
    const apiRes = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: buildSystemPrompt(customerMasterJson, customerSection) },
          { role: 'user', content: `Filename: ${filename}\n\nInvoice text:\n\n${truncated}` },
        ],
        temperature: 0.1,
      }),
    })

    if (!apiRes.ok) {
      const errText = await apiRes.text()
      if (apiRes.status === 429) {
        return res.status(429).json({ error: 'API quota exceeded. Please try again shortly.' })
      }
      return res.status(502).json({ error: `OpenRouter ${apiRes.status}: ${errText.slice(0, 300)}` })
    }

    const data = await apiRes.json()
    const raw: string = data?.choices?.[0]?.message?.content || '[]'

    let rows: Record<string, unknown>[]
    try {
      rows = parseJsonFromText(raw) as Record<string, unknown>[]
    } catch {
      rows = []
    }

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

    // Makro: hard-code description and product_description.
    //
    // The LLM consistently:
    //   - puts the category heading (e.g. "Retro Bonus") in product_description ← correct value, wrong field
    //   - puts the receipt header "ได้รับชำระเงินตามรายการดังนี้" in description ← useless
    //
    // The OCR text structure has Gemini merge or skip the heading-only lines,
    // so "line above the amount" is NOT the category heading — it's things like
    // "N", "Amount", or the previous row's amount.  But the text ON the amount
    // line (before the number) IS the correct detail text.
    //
    // Strategy:
    //   description         ← LLM's product_description  (category heading — LLM gets this right)
    //   product_description ← OCR text before the amount  (detail line — OCR extraction gets this right)
    if (customerId === 'MAKRO') {
      const pageTextCache = new Map<string, string>()
      const usedByPage    = new Map<string, Set<number>>()
      rows = rows.map((r) => {
        const invoiceNo = (r.invoiceno as string) || ''
        if (!pageTextCache.has(invoiceNo)) {
          pageTextCache.set(invoiceNo, getInvoicePageSection(text, invoiceNo))
          usedByPage.set(invoiceNo, new Set())
        }
        const pageText = pageTextCache.get(invoiceNo)!
        const used     = usedByPage.get(invoiceNo)!
        const found    = findMakroItemLines(pageText, (r.amount as string) || '', used)

        // description: trust the LLM — with correct customer instructions it now correctly
        //   extracts the category heading (e.g. "Retro Bonus") into description.
        // product_description: override from OCR text (verbatim text printed before the
        //   amount on that line, e.g. "Retro Bonus 2026").
        const newProductDesc = found?.product_description || (r.product_description as string)

        return { ...r, product_description: newProductDesc }
      })
    }

    // LT (Lotus) — three server-side fixes:
    //   1. Drop rows whose invoiceno doesn't match any of the 4 known formats.
    //      The LLM occasionally hallucinates plausible-looking invoice numbers
    //      (e.g. "P00030007P0N") from misread OCR text or column headers, and
    //      attaches fabricated VAT/amount to them.  Strict pattern filter only
    //      keeps rows we can map to a real Lotus document.
    //   2. description: force invoice-level deal-type line for Formats A/D
    //      (skipped for Formats B/C where description is per-row in a table).
    //   3. vendor_customercode: convert printed "TH0XXXX" → internal "9XXXX".
    if (customerId === 'LT') {
      // Pattern legend:
      //   C\d{9}(CN|CV)\d   — Credit Note   (e.g. C260400519CN3)
      //   BH\d{4}-\d{5}     — Tax Invoice   (e.g. BH2603-00013)
      //   A\d{9}            — Receipt line  (e.g. A260310890)
      //   M\d{9}MDN         — Monthly Disc. (e.g. M260310670MDN)
      const LT_INVOICE_RE = /^(?:C\d{9}(?:CN|CV)\d|BH\d{4}-\d{5}|A\d{9}|M\d{9}MDN)$/i
      rows = rows.filter((r) => {
        const inv = ((r.invoiceno as string) || '').trim()
        return inv !== '' && LT_INVOICE_RE.test(inv)
      })

      const ltDescCache = new Map<string, string | null>()
      rows = rows.map((r) => {
        const invoiceNo = (r.invoiceno as string) || ''
        if (!ltDescCache.has(invoiceNo)) {
          const pageText = getInvoicePageSection(text, invoiceNo)
          ltDescCache.set(invoiceNo, findLTDescription(pageText))
        }
        const desc = ltDescCache.get(invoiceNo)
        const withDesc = desc ? { ...r, description: desc } : r
        const code = (withDesc.vendor_customercode as string) || ''
        const converted = convertLTVendorCode(code)
        return converted !== code ? { ...withDesc, vendor_customercode: converted } : withDesc
      })
    }

    // CFR: truncate remark at the first boundary word found:
    //   1. "Netting"        — netting/payment info starts here
    //   2. "สำหรับร้านค้า" — store instructions start here (fallback if no Netting)
    if (customerId === 'CFR') {
      rows = rows.map((r) => {
        const remark = (r.remark as string) || ''
        const cutNetting = remark.indexOf('Netting')
        const cutStore   = remark.indexOf('สำหรับร้านค้า')
        const cut = cutNetting > 0 ? cutNetting : cutStore > 0 ? cutStore : -1
        return cut > 0 ? { ...r, remark: remark.slice(0, cut).trim() } : r
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

    return res.status(200).json({ rows })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return res.status(500).json({ error: message })
  }
}
