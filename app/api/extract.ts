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

    // Makro: invoice only prints total VAT, not per-line.
    // Deterministically calculate vat_7 = amount × 0.07 for every row.
    if (customerId === 'MAKRO') {
      rows = rows.map((r) => {
        const amt = parseFloat(r.amount as string)
        const vat = isNaN(amt) ? '0' : (amt * 0.07).toFixed(2)
        return { ...r, vat_7: vat }
      })
    }

    return res.status(200).json({ rows })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return res.status(500).json({ error: message })
  }
}
