// Per-customer extraction rules.
//
// Each invoice customer prints its invoices in a consistent format, so the
// extraction logic is configured here per customer. To onboard a new customer,
// add one entry to CUSTOMER_RULES — no other code changes needed.
//
// This module is shared by the frontend (App.tsx — OCR routing) and the
// backend (api/extract.ts — prompt building + post-processing).

// How to obtain the PDF text for this customer:
//   'text' — read the embedded text layer directly (fast)
//   'ocr'  — render pages to images and OCR them (use for scanned PDFs, or
//            PDFs whose embedded font encoding is broken / garbled)
//   'auto' — decide automatically from the text layer (default)
export type ExtractMode = 'auto' | 'ocr' | 'text'

// Where vendor_customercode (the code the vendor assigned to OUR company) is found:
//   'buyer-line'     — ( CODE ) on the ชื่อผู้ซื้อ line          (CMK, CFR)
//   'header-bracket' — [CODE] / (CODE) after the company name    (BTM, CFW)
//   'ac-no'          — value of the "A/C No" field               (Foodland)
//   'vendor-no'      — value of the "Vendor No" field            (PTT)
//   'blank'          — always empty                              (HomePro, LT, ...)
//   'auto'           — try buyer-line, then header-bracket        (default)
export type VendorCodeSource =
  | 'buyer-line' | 'header-bracket' | 'ac-no' | 'vendor-no' | 'blank' | 'auto'

export interface CustomerRule {
  id: string
  label: string
  match: {
    filenameKeywords?: string[]  // matched (word-boundary) against the uploaded filename
    nameKeywords?: string[]      // matched against the invoice text
    taxids?: string[]            // issuer tax IDs found in the invoice text
  }
  extractMode: ExtractMode
  vendorCode: VendorCodeSource
  vendorBranch: 'auto' | 'blank'
  notes?: string                 // extra customer-specific instructions for the LLM
}

export const CUSTOMER_RULES: CustomerRule[] = [
  {
    id: 'CFR',
    label: 'Central Food Retail (CFR)',
    match: { filenameKeywords: ['cfr'], nameKeywords: ['เซ็นทรัล ฟู้ด รีเทล'], taxids: ['0105535134278'] },
    extractMode: 'ocr',
    vendorCode: 'buyer-line',
    vendorBranch: 'blank',
    notes: 'remark = the full text from the "หมายเหตุ" section through the "สำหรับร้านค้า" section as printed.',
  },
  {
    id: 'CMK',
    label: 'Central + Matsumoto Kiyoshi (CMK)',
    match: { filenameKeywords: ['cmk'], nameKeywords: ['มัทสึโมโตะ', 'matsumoto'], taxids: ['0125558018410'] },
    extractMode: 'ocr',
    vendorCode: 'buyer-line',
    vendorBranch: 'blank',
  },
  {
    id: 'CFM',
    label: 'Central Food (CFM)',
    match: { filenameKeywords: ['cfm'] },
    extractMode: 'ocr',
    vendorCode: 'auto',
    vendorBranch: 'blank',
  },
  {
    id: 'BTM',
    label: 'Beautrium (BTM)',
    match: { filenameKeywords: ['btm'], nameKeywords: ['บิวเทรี่ยม', 'beautrium'], taxids: ['0105555002130'] },
    extractMode: 'text',
    vendorCode: 'header-bracket',
    vendorBranch: 'auto',
  },
  {
    id: 'CFW',
    label: 'Central Food Wholesale (CFW)',
    match: { filenameKeywords: ['cfw'], nameKeywords: ['เซ็นทรัล ฟู้ด โฮลเซลล์'], taxids: ['0125565034662'] },
    extractMode: 'text',
    vendorCode: 'header-bracket',
    vendorBranch: 'auto',
  },
  {
    id: 'AEON',
    label: 'AEON',
    match: { filenameKeywords: ['aeon'], nameKeywords: ['อิออน'] },
    extractMode: 'ocr',
    vendorCode: 'blank',
    vendorBranch: 'auto',
    notes: 'NEVER calculate or derive any tax/VAT amount — only copy figures explicitly printed on the invoice.',
  },
  {
    id: 'BOOTS',
    label: 'Boots',
    match: { filenameKeywords: ['boots'], nameKeywords: ['บู๊ทส์'] },
    extractMode: 'ocr',
    vendorCode: 'auto',
    vendorBranch: 'auto',
    notes: 'Each line item has a VAT marker column next to the amount: "V" = VAT 7%, "N" = Non-VAT. When the marker is "V", put that line\'s VAT amount into vat_7. When "N", set vat_7 = "0".',
  },
  {
    id: 'CJ',
    label: 'CJ Express',
    match: { filenameKeywords: ['cj'], nameKeywords: ['cj express'] },
    extractMode: 'ocr',
    vendorCode: 'auto',
    vendorBranch: 'auto',
    notes: 'product_description MUST be copied verbatim — never reword, translate, or "correct" Thai. e.g. keep "ค่ากระจายสินค้า dc fee" exactly; never rewrite it as "ค่าบริหารจัดการ (DC Fee)".',
  },
  {
    id: 'FOODLAND',
    label: 'Foodland',
    match: { filenameKeywords: ['foodland'], nameKeywords: ['foodland', 'ฟู้ดแลนด์'] },
    extractMode: 'ocr',
    vendorCode: 'ac-no',
    vendorBranch: 'auto',
    notes: 'vendor_customercode = the value printed in the "A/C No" field.',
  },
  {
    id: 'PTT',
    label: 'PTT',
    match: { filenameKeywords: ['ptt'], nameKeywords: ['ปตท'] },
    extractMode: 'ocr',
    vendorCode: 'vendor-no',
    vendorBranch: 'auto',
    notes: 'vendor_customercode = the value printed in the "Vendor No" field.',
  },
  {
    id: 'THEMALL',
    label: 'The Mall',
    match: { filenameKeywords: ['themall'], nameKeywords: ['the mall', 'เดอะมอลล์'] },
    extractMode: 'ocr',
    vendorCode: 'blank',
    vendorBranch: 'auto',
    notes: 'product_description must include BOTH the Thai and English text as printed, e.g. "ส่วนลด Discount" — never drop the Thai part. The code next to "ชื่อลูกค้า" is สหพัฒนพิบูล (our company) — never use it.',
  },
  {
    id: 'HOMEPRO',
    label: 'HomePro',
    match: { filenameKeywords: ['homepro'], nameKeywords: ['homepro', 'home product', 'โฮมโปร'] },
    extractMode: 'ocr',
    vendorCode: 'blank',
    vendorBranch: 'auto',
  },
  {
    id: 'LT',
    label: 'Lotus (LT)',
    match: { filenameKeywords: ['lt', 'lotus'], nameKeywords: ['โลตัส'] },
    extractMode: 'text',
    vendorCode: 'blank',
    vendorBranch: 'auto',
  },
  {
    id: 'MAKRO',
    label: 'Makro',
    match: { filenameKeywords: ['makro'], nameKeywords: ['makro', 'แม็คโคร'] },
    extractMode: 'ocr',
    vendorCode: 'blank',
    vendorBranch: 'auto',
  },
  {
    id: 'TFG',
    label: 'TFG',
    match: { filenameKeywords: ['tfg'], nameKeywords: ['ไทยฟู้ด'] },
    extractMode: 'ocr',
    vendorCode: 'blank',
    vendorBranch: 'auto',
  },
  {
    id: 'VILLA',
    label: 'Villa Market',
    match: { filenameKeywords: ['villa'], nameKeywords: ['villa market', 'วิลล่า'] },
    extractMode: 'ocr',
    vendorCode: 'blank',
    vendorBranch: 'blank',
  },
  {
    id: 'WATSON',
    label: 'Watsons',
    match: { filenameKeywords: ['watson', 'watsons'], nameKeywords: ['watson', 'วัตสัน'] },
    extractMode: 'ocr',
    vendorCode: 'blank',
    vendorBranch: 'blank',
  },
]

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Word-boundary match so a short keyword like "lt" doesn't match "result.pdf".
function filenameMatches(filename: string, keywords: string[]): boolean {
  const fn = filename.toLowerCase()
  return keywords.some((kw) => {
    const re = new RegExp('(^|[^a-z0-9])' + escapeRegExp(kw.toLowerCase()) + '([^a-z0-9]|$)')
    return re.test(fn)
  })
}

// Identify which customer an invoice belongs to.
// Priority: filename keyword → issuer tax id → company-name keyword.
export function detectCustomer(invoiceText: string, filename: string): CustomerRule | null {
  for (const r of CUSTOMER_RULES) {
    if (r.match.filenameKeywords && filenameMatches(filename, r.match.filenameKeywords)) return r
  }
  for (const r of CUSTOMER_RULES) {
    if (r.match.taxids?.some((t) => invoiceText.includes(t))) return r
  }
  const lower = invoiceText.toLowerCase()
  for (const r of CUSTOMER_RULES) {
    if (r.match.nameKeywords?.some((k) => lower.includes(k.toLowerCase()))) return r
  }
  return null
}

// Decide OCR vs direct text extraction for a customer.
// `autoIsDigital` is the automatic detection result, used when the customer's
// extractMode is 'auto' or the customer is unknown.
export function shouldUseOcr(rule: CustomerRule | null, autoIsDigital: boolean): boolean {
  if (rule?.extractMode === 'ocr') return true
  if (rule?.extractMode === 'text') return false
  return !autoIsDigital
}

function vendorCodeInstruction(src: VendorCodeSource): string {
  switch (src) {
    case 'buyer-line':
      return 'vendor_customercode: the number in ( parentheses ) on the ชื่อผู้ซื้อ line. (This is also enforced automatically — just give your best reading.)'
    case 'header-bracket':
      return 'vendor_customercode: the number in [brackets] or (parentheses) right after the vendor company name. (Also enforced automatically.)'
    case 'ac-no':
      return 'vendor_customercode: the value printed in the "A/C No" field.'
    case 'vendor-no':
      return 'vendor_customercode: the value printed in the "Vendor No" field.'
    case 'blank':
      return 'vendor_customercode: always return "" (blank).'
    case 'auto':
    default:
      return 'vendor_customercode: a code in [brackets]/(parentheses) near the company name or ชื่อผู้ซื้อ line; otherwise a labelled รหัสร้านค้า / Customer Code / Supplier Code. Strip any vendor prefix from hyphenated codes (e.g. "TOP-M802316" → "802316").'
  }
}

// Build the customer-specific section of the extraction prompt.
export function buildCustomerInstructions(rule: CustomerRule | null): string {
  if (!rule) {
    return `DETECTED CUSTOMER: unknown — use general rules.
${vendorCodeInstruction('auto')}
vendor_branch: only an explicitly labelled branch ("สาขาที่", "Branch", "Site code"); "Group [number]" is NOT a branch; return "" if none found.`
  }

  const lines: string[] = [`DETECTED CUSTOMER: ${rule.label}`, vendorCodeInstruction(rule.vendorCode)]

  if (rule.vendorBranch === 'blank') {
    lines.push('vendor_branch: always return "" (blank).')
  } else {
    lines.push('vendor_branch: only an explicitly labelled branch ("สาขาที่", "Branch", "Site code"); "Group [number]" is NOT a branch; return "" if none found.')
  }

  if (rule.notes) lines.push(rule.notes)

  return lines.join('\n')
}
