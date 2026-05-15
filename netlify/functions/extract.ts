import type { Handler } from '@netlify/functions'

/**
 * Gemini field extraction — uses gemini-1.5-flash (1,500 req/day free tier).
 * Receives raw OCR/PDF text, returns structured 22-column invoice rows.
 */
const GEMINI_MODEL = 'gemini-2.5-flash'

const SYSTEM_PROMPT = `You are an expert at extracting structured data from Thai invoice text (ใบแจ้งหนี้, ใบวางบิล, ใบเสร็จรับเงิน).

Given raw text from one or more invoice pages (separated by "--- PAGE BREAK ---"), extract ALL invoice line items and return a JSON array. Each element = one row.

Output fields (22 columns):
- customergroup: Customer group name (e.g. "11 - เซ็นทรัล")
- customercode: Customer code + company name
- taxid: 13-digit Thai tax ID (เลขที่ผู้เสียภาษีอากร / เลขประจำตัวผู้เสียภาษี)
- vendor_customercode: Vendor's customer code / รหัสลูกค้า / Customer Code
- vendor_branch: Branch code / รหัสสาขา / Branch
- vendor_expensecode: Expense code / รหัสค่าใช้จ่าย
- vendor_expensegroup: Expense group / กลุ่มค่าใช้จ่าย
- divisionsale: Division or sale code
- invoiceno: Invoice number / เลขที่ใบแจ้งหนี้ / เลขที่เอกสาร / Invoice No.
- invoicedate: Invoice date → YYYY-MM-DD (convert Buddhist Era: subtract 543 from year)
- duedate: Due/payment date → YYYY-MM-DD
- description: Main invoice description / purpose
- product_description: Product or service line item details
- amount: Amount before deductions (plain number, no commas, e.g. "45918.05")
- vat_7: VAT 7% amount (number or "0")
- tax_pct: General tax % amount (number or "0")
- tax_2: Withholding tax 2% amount (number or "0")
- tax_3: Withholding tax 3% / ภาษีหัก ณ ที่จ่าย (number or "0")
- tax_5: Withholding tax 5% amount (number or "0")
- netamount: Net payable after all deductions (number)
- remark: Any special notes / หมายเหตุ

Rules:
- Multiple line items per invoice → one row per item (share header fields: invoiceno, taxid, dates, etc.)
- Missing fields → empty string ""
- Numbers → plain string without commas or currency symbols
- Dates → YYYY-MM-DD; Thai Buddhist Era year → subtract 543
- Tax ID = exactly 13 digits
- If only one total row found, return as single row
- Return ONLY a valid JSON array, no markdown fences, no explanation`

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

  // Truncate very long text to stay within token limits (~8000 chars is enough for Thai invoices)
  const truncated = text.length > 12000 ? text.slice(0, 12000) + '\n[truncated]' : text

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
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
      // Surface quota errors with actionable message
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
