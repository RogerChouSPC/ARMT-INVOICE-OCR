import type { VercelRequest, VercelResponse } from '@vercel/node'

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

function buildSystemPrompt(customerMasterJson: string): string {
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
   - For example: taxid 0107567000414 with "Lotus" or "โลตัส" or "LT" → group "05 - โลตัส"
   - taxid 0107567000414 with "Makro" or "แม็คโคร" → group "04 - ซีพี แอ็กซ์ตร้า(Makro)"
   - taxid 0107536000633 with "คลังครอสด็อคธัญบุรี 00485" → customercode "0115526"
   - taxid 0107536000633 headquarters → customercode "0102856"
   - taxid 0105540016253 (City Mall / ซิตี้มอลล์) with branch 00001 → customercode "0114682"
   - taxid 0105565017547 (บริษัท ออล สปีดดี้ / All Speedy) → treat as ซีพี ออลล์, use customergroup "07 - เซเว่นอีเลฟเว่น (7-11)" and customercode from the ซีพี ออลล์ row in the Customer Master
4. Copy customergroup and customercode EXACTLY from the matching Customer Master row.

HOW TO MAP vendor_customercode:
Search in this priority order:
1. Bracket or parenthesis pattern appended to the vendor/company name: "Company Name [CODE]" or "Company Name (CODE)" → extract CODE only (digits).
   e.g. "บริษัท บิวเทรี่ยม จำกัด สำนักงานใหญ่ [321801]" → "321801"
   e.g. "CFR (040101)" → "040101" ; "CFW (040201)" → "040201" ; "CMK (042501)" → "042501"
   This pattern takes highest priority — always check the company name line first.
2. Field labels: "รหัสร้านค้า", "Customer Code", "Supplier Code", "ชื่อลูกค้า [CODE]", "เจ้าของ/ตัวแทน(รหัสร้านค้า)"
3. "A/C No" field (Foodland invoices)
4. "Vendor No" field (PTT invoices)
5. Big C: 7-digit code next to our company name (e.g. 4000047…)
6. CP All / 7-11: supplier code (e.g. 2000087)
- Strip text prefixes: "BTM-MC15009" → "15009"; "TOP-M802316" → "802316"; "CFW-M900548" → "900548"
- If the vendor code is missing for a vendor but another entry in the SAME document has the same address (street/building), reuse that code.
- Leave BLANK ("") for these vendors: โฮมโปร / HomePro, โลตัส / Lotus / LT, แม็คโคร / Makro, TFG / ไทยฟู้ดกรุ๊ป, วิลล่า / Villa Market, วัตสัน / Watson / Watsons

HOW TO MAP vendor_branch:
- Look for: "Group [number]", "สาขาที่ [code]", "Branch", "Site code", or branch number in company header.
- Use the branch code WITHOUT leading zeros where it's a number (e.g., "00485" stays "00485", "29130" stays "29130").
- If vendor is สำนักงานใหญ่ (head office) with no branch code: use "00000".
- Leave BLANK ("") for these vendors: วิลล่า / Villa Market, วัตสัน / Watson / Watsons

Given raw text from one or more invoice pages (separated by "--- PAGE BREAK ---"), extract ALL invoice line items and return a JSON array. Each element = one row.

Output fields (22 columns):
- customergroup: from Customer Master lookup (exact copy)
- customercode: from Customer Master lookup (exact copy)
- taxid: the invoice ISSUER's 13-digit tax ID
- vendor_customercode: our code in vendor's system (strip text prefixes, keep numbers)
- vendor_branch: vendor branch/group code for our transactions
- vendor_expensecode: expense code if present, else ""
- vendor_expensegroup: expense group if present, else ""
- divisionsale: division or sale code if present, else ""
- invoiceno: invoice number / เลขที่
- invoicedate: invoice date → YYYY-MM-DD. Date conversion rules:
  * 4-digit year ≥ 2500 = Buddhist Era → subtract 543 (e.g., 2569 → 2026)
  * 4-digit year < 2500 = already Gregorian → use as-is (e.g., 2026 → 2026)
  * 2-digit year = Gregorian short form → prepend "20" (e.g., "26" → 2026, "30/04/26" → 2026-04-30)
  * DO NOT subtract 543 from 2-digit years
- duedate: due/payment date → YYYY-MM-DD (same conversion rules as invoicedate)
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

Rules:
- Multiple line items per invoice → one row per item (share header: invoiceno, taxid, dates, etc.)
- Missing fields → empty string ""
- Numbers → plain string without commas or currency symbols
- Dates → YYYY-MM-DD; 4-digit year ≥ 2500 = Buddhist Era → subtract 543; 2-digit year = prepend "20" (never subtract 543)
- Tax ID = exactly 13 digits
- NEVER calculate or derive any tax/VAT amount — only copy figures that are explicitly printed on the invoice; if not printed, use "0"
- invoiceno: OCR often inserts spaces within invoice numbers — reconstruct by removing spaces between digit groups around slashes (e.g. "3530103 / 010426" or "3 530103/010426" or "353 0103 /01 0426" → all become "3530103/010426"); extract EVERY invoice number that appears in the document, do NOT skip any
- Extract ALL line items from ALL invoices present in the document — never skip an invoice because its number looks unusual or has spacing
- product_description: copy the EXACT text from the invoice verbatim — do NOT paraphrase, summarise, or substitute Thai terms (e.g. invoice says "ค่ากระจายสินค้า dc fee" → output that exactly, NOT "ค่าบริหารจัดการ (DC Fee)")
- product_description: preserve ALL languages as printed; include both Thai and English when both appear (e.g. "ส่วนลด Discount" not just "Discount")
- Boots invoices: each line item may have a VAT marker column next to the amount ('V' = VAT 7%, 'N' = Non-VAT); if marker is 'V' read the corresponding VAT amount from the invoice into vat_7; if 'N' set vat_7 = "0"
- CFR invoices: remark field = full concatenated text from the "หมายเหตุ" section through the "สำหรับร้านค้า" section as printed
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
  try {
    const body = req.body || {}
    text = (body.text || '').trim()
    filename = body.filename || ''
    if (!text) throw new Error('empty text')
    const cm = body.customerMaster
    customerMasterJson = (Array.isArray(cm) && cm.length > 0)
      ? JSON.stringify(cm.map(({ store_name, customergroup, customercode, taxid }: {
          store_name: string; customergroup: string; customercode: string; taxid: string
        }) => ({ store_name, customergroup, customercode, taxid })))
      : JSON.stringify(FALLBACK_CUSTOMER_MASTER)
  } catch {
    return res.status(400).json({ error: 'Expected { text: string, filename?: string, customerMaster?: array }' })
  }

  const truncated = text.length > 12000 ? text.slice(0, 12000) + '\n[truncated]' : text

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
          { role: 'system', content: buildSystemPrompt(customerMasterJson) },
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

    let rows: object[]
    try {
      rows = parseJsonFromText(raw)
    } catch {
      rows = []
    }

    return res.status(200).json({ rows })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return res.status(500).json({ error: message })
  }
}
