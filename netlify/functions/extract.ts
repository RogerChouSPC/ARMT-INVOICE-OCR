import type { Handler } from '@netlify/functions'
import { getStore } from '@netlify/blobs'

const GEMINI_MODEL = 'gemini-2.5-flash'
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
4. Copy customergroup and customercode EXACTLY from the matching Customer Master row.

HOW TO MAP vendor_customercode:
- Look for: "รหัสร้านค้า", "Customer Code", "ชื่อลูกค้า [CODE]", "เจ้าของ/ตัวแทน(รหัสร้านค้า)"
- Strip any text prefixes: "BTM-MC15009" → "15009"; "TOP-M802316" → "802316"; "CFW-M900548" → "900548"; "LS16985" → "LS16985" (keep if no clear rule); numeric only is preferred.
- For Big C: the code starting with "4000047" or similar 7-digit number next to our name.
- For CP All / 7-11: the supplier code (2000087 etc.) from the invoice.

HOW TO MAP vendor_branch:
- Look for: "Group [number]", "สาขาที่ [code]", "Branch", "Site code", or branch number in company header.
- Use the branch code WITHOUT leading zeros where it's a number (e.g., "00485" stays "00485", "29130" stays "29130").
- If vendor is สำนักงานใหญ่ (head office) with no branch code: use "00000".

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
- invoicedate: invoice date → YYYY-MM-DD (Buddhist Era: subtract 543 from year)
- duedate: due/payment date → YYYY-MM-DD
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
- Dates → YYYY-MM-DD; Buddhist Era year → subtract 543
- Tax ID = exactly 13 digits
- Return ONLY a valid JSON array, no markdown fences, no explanation`
}

const FALLBACK_CUSTOMER_MASTER = [
  { store_name: 'บิ๊กซี ซูเปอร์เซ็นเตอร์', customergroup: '01 - บิ๊กซี', customercode: '0100857 บิ๊กซี ซูเปอร์เซ็นเตอร์ จำกัด (มหาชน)', taxid: '0107537002445' },
  { store_name: 'โลตัส', customergroup: '05 - โลตัส', customercode: '0114682 ซีพี แอ็กซ์ตร้า จำกัด (โลตัส)', taxid: '0107567000414' },
  { store_name: 'แม็คโคร', customergroup: '04 - ซีพี แอ็กซ์ตร้า(Makro)', customercode: '0102856 ซีพี แอ็กซ์ตร้า จำกัด (Makro)', taxid: '0107567000414' },
  { store_name: 'เซ็นทรัล', customergroup: '11 - เซ็นทรัล', customercode: '0109266 เซ็นทรัลพัฒนา จำกัด (มหาชน)', taxid: '0107536000633' },
]

const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'GEMINI_API_KEY not configured' }) }
  }

  let text: string
  let filename: string
  try {
    const body = JSON.parse(event.body || '{}')
    text = (body.text || '').trim()
    filename = body.filename || ''
    if (!text) throw new Error('empty text')
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Expected { text: string, filename?: string }' }) }
  }

  // Load Customer Master from Blobs for accurate lookup; fall back to seed rows
  let customerMasterJson: string
  try {
    const store = getStore('customer-master')
    const raw = await store.get('state', { type: 'text' })
    if (raw) {
      const state = JSON.parse(raw)
      const rows = (state.rows || []).map(({ store_name, customergroup, customercode, taxid }: {
        store_name: string; customergroup: string; customercode: string; taxid: string
      }) => ({ store_name, customergroup, customercode, taxid }))
      customerMasterJson = JSON.stringify(rows, null, 0)
    } else {
      customerMasterJson = JSON.stringify(FALLBACK_CUSTOMER_MASTER)
    }
  } catch {
    customerMasterJson = JSON.stringify(FALLBACK_CUSTOMER_MASTER)
  }

  const truncated = text.length > 12000 ? text.slice(0, 12000) + '\n[truncated]' : text

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: buildSystemPrompt(customerMasterJson) }] },
          contents: [{
            role: 'user',
            parts: [{ text: `Filename: ${filename}\n\nInvoice text:\n\n${truncated}` }],
          }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      }
    )

    if (!geminiRes.ok) {
      const errText = await geminiRes.text()
      if (geminiRes.status === 429) {
        return {
          statusCode: 429,
          body: JSON.stringify({
            error: 'Gemini API quota exceeded. Please wait a minute and try again, or enable billing at console.cloud.google.com to remove free-tier limits.',
          }),
        }
      }
      return { statusCode: 502, body: JSON.stringify({ error: `Gemini ${geminiRes.status}: ${errText.slice(0, 300)}` }) }
    }

    const data = await geminiRes.json()
    const raw: string = data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]'

    let rows: object[]
    try {
      const parsed = JSON.parse(raw)
      rows = Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      rows = []
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { statusCode: 500, body: JSON.stringify({ error: message }) }
  }
}

export { handler }
