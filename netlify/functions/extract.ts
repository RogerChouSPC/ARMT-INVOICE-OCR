import type { Handler } from '@netlify/functions'

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

function parseJsonFromText(text: string): object[] {
  const stripped = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '')
  const parsed = JSON.parse(stripped)
  return Array.isArray(parsed) ? parsed : [parsed]
}

const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'OPENROUTER_API_KEY not configured' }) }
  }

  let text: string
  let filename: string
  let customerMasterJson: string
  try {
    const body = JSON.parse(event.body || '{}')
    text = (body.text || '').trim()
    filename = body.filename || ''
    if (!text) throw new Error('empty text')
    // Customer Master sent from frontend (localStorage); fall back to hardcoded seeds
    const cm = body.customerMaster
    customerMasterJson = (Array.isArray(cm) && cm.length > 0)
      ? JSON.stringify(cm.map(({ store_name, customergroup, customercode, taxid }: {
          store_name: string; customergroup: string; customercode: string; taxid: string
        }) => ({ store_name, customergroup, customercode, taxid })))
      : JSON.stringify(FALLBACK_CUSTOMER_MASTER)
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Expected { text: string, filename?: string, customerMaster?: array }' }) }
  }

  const truncated = text.length > 12000 ? text.slice(0, 12000) + '\n[truncated]' : text

  try {
    const res = await fetch(OPENROUTER_URL, {
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

    if (!res.ok) {
      const errText = await res.text()
      if (res.status === 429) {
        return {
          statusCode: 429,
          body: JSON.stringify({ error: 'API quota exceeded. Please try again shortly.' }),
        }
      }
      return { statusCode: 502, body: JSON.stringify({ error: `OpenRouter ${res.status}: ${errText.slice(0, 300)}` }) }
    }

    const data = await res.json()
    const raw: string = data?.choices?.[0]?.message?.content || '[]'

    let rows: object[]
    try {
      rows = parseJsonFromText(raw)
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
