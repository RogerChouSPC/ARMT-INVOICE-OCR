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
//   'ac-no'          — value of the "A/C No" field
//   'vendor-no'      — value of the "Vendor No" field            (PTT)
//   'customer-line'  — code on the labelled customer line:       (Big C, CJ, CP All)
//                      รหัสลูกค้า / รหัสลูกหนี้ / start of ชื่อลูกค้า
//   'blank'          — always empty                              (HomePro, LT, ...)
//   'auto'           — try buyer-line, then header-bracket        (default)
export type VendorCodeSource =
  | 'buyer-line' | 'header-bracket' | 'ac-no' | 'vendor-no' | 'customer-line' | 'top-m-line' | 'blank' | 'auto'

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
    vendorCode: 'top-m-line',
    vendorBranch: 'blank',
    notes: `vendor_customercode = the digits after "TOP-M" on the เจ้าของ/ตัวแทน(รหัสร้านค้า) line (e.g. "TOP-M802316" → "802316").
description = the text AFTER the "รายการ" label — do NOT include the word "รายการ" itself (e.g. line reads "รายการ Gondolar" → description = "Gondolar").
product_description = the text after "สินค้า :" if that line is present (e.g. "8850002041622 ไลปอนเอฟเอ็กซ์ตร้าใช้จีนิดผลิตภัณฑ์ล้างจานเข้มข้น 1700มล."); leave "" if no "สินค้า :" line.
amount = the "รวม" subtotal (before VAT and tax).
vat_7 = copy the amount printed on the "บวกภาษีมูลค่าเพิ่ม 7%(บาท)" line exactly (e.g. "700.00"); do NOT calculate.
tax_3 = copy the amount printed on the "หักภาษี ณ ที่จ่าย 3%(บาท)" line exactly (e.g. "300.00"); do NOT calculate.
netamount = copy the "รวมเป็นเงินทั้งสิ้น (บาท)" amount exactly (e.g. "10400.00"); do NOT calculate.
remark = the text from the "หมายเหตุ" line: if "Netting" appears, stop before it; otherwise stop before "สำหรับร้านค้า". Do not include either boundary word or anything after it.`,
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
    match: { filenameKeywords: ['cfm'], nameKeywords: ['เซ็นทรัลฟู้ด มินิมาร์เก็ต', 'central food minimart'], taxids: ['0105535133093'] },
    extractMode: 'ocr',
    vendorCode: 'customer-line',
    vendorBranch: 'blank',
    notes: 'vendor_customercode = the value next to "เจ้าของ/ตัวแทน(รหัสร้านค้า)" (e.g. 9812292).',
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
    match: { filenameKeywords: ['aeon'], nameKeywords: ['อิออน'], taxids: ['0105527044125'] },
    extractMode: 'ocr',
    vendorCode: 'customer-line',
    vendorBranch: 'auto',
    notes: 'NEVER calculate or derive any tax/VAT amount — only copy figures explicitly printed on the invoice. vendor_customercode = the value of the "รหัสผู้ซื้อ" field.',
  },
  {
    id: 'BOOTS',
    label: 'Boots',
    match: { filenameKeywords: ['boots'], nameKeywords: ['บู๊ทส์', 'boots retail'], taxids: ['0115539007084'] },
    extractMode: 'ocr',
    vendorCode: 'customer-line',
    vendorBranch: 'auto',
    notes: 'vendor_customercode = the value next to the "Customer :" label (e.g. "S006-1"). Each line item has a VAT marker column next to the amount: "V" = VAT 7%, "N" = Non-VAT. When the marker is "V", put that line\'s VAT amount into vat_7. When "N", set vat_7 = "0".',
  },
  {
    id: 'CJ',
    label: 'CJ Express',
    match: {
      filenameKeywords: ['cj'],
      nameKeywords: ['cj express', 'ซี.เจ. เอ็กซ์เพรส', 'ซี.เจ.เอ็กซ์เพรส'],
      taxids: ['0105556055491'],
    },
    extractMode: 'ocr',
    vendorCode: 'customer-line',
    vendorBranch: 'auto',
    notes: 'product_description MUST be copied verbatim — never reword, translate, or "correct" Thai. e.g. keep "ค่ากระจายสินค้า dc fee" exactly; never rewrite it as "ค่าบริหารจัดการ (DC Fee)".',
  },
  {
    id: 'FOODLAND',
    label: 'Foodland',
    match: { filenameKeywords: ['foodland'], nameKeywords: ['foodland', 'ฟู้ดแลนด์'], taxids: ['0105515004549'] },
    extractMode: 'ocr',
    vendorCode: 'ac-no',
    vendorBranch: 'auto',
    notes: 'vendor_customercode = the value of the "A/C No" field (e.g. 929509). "ลำดับที่สาขา" is our own branch, not the vendor code.',
  },
  {
    id: 'PTT',
    label: 'PTT',
    match: { filenameKeywords: ['ptt'], nameKeywords: ['ปตท'], taxids: ['0105537121254'] },
    extractMode: 'ocr',
    vendorCode: 'vendor-no',
    vendorBranch: 'auto',
    notes: 'vendor_customercode = the value printed in the "Vendor No" field.',
  },
  {
    id: 'THEMALL',
    label: 'The Mall / City Mall Group',
    match: {
      filenameKeywords: ['themall', 'em district', 'emdistrict', 'emporium', 'emquartier', 'emsphere', 'city mall', 'citymall'],
      nameKeywords: ['the mall', 'เดอะมอลล์', 'city mall', 'ซิตี้มอลล์', 'em district', 'emporium', 'emquartier', 'emsphere'],
      taxids: ['0105523009350', '0105540016253'],
    },
    extractMode: 'ocr',
    vendorCode: 'customer-line',
    vendorBranch: 'auto',
    notes: `description = the FULL text in the รายการ / Description column verbatim, including every line of the cell (e.g. "ส่วนลดรับรายการ_M Price 04/2026_(02.04.2026_29.04.2026) C37 - Dairy-OR Period 02.04.2026 - 29.04.2026").
product_description = always "" (blank). Server enforces this.
vendor_customercode = the code at the start of the ชื่อลูกค้า / Customer Name line (e.g. "SHP00" / "SHP20").`,
  },
  {
    id: 'HOMEPRO',
    label: 'HomePro',
    match: { filenameKeywords: ['homepro'], nameKeywords: ['homepro', 'home product', 'โฮมโปร'], taxids: ['0107544000043'] },
    extractMode: 'ocr',
    vendorCode: 'customer-line',
    vendorBranch: 'auto',
    notes: 'vendor_customercode = the value next to "รหัสลูกค้า" (e.g. 1000515117). Drop any "/ V.xxxx" suffix.',
  },
  {
    id: 'LT',
    label: 'Lotus (LT)',
    match: {
      filenameKeywords: ['lt', 'lotus'],
      nameKeywords: ['โลตัส', 'lotus', 'นวมินทร์'],
    },
    extractMode: 'ocr',
    vendorCode: 'customer-line',
    vendorBranch: 'auto',
    notes: `LOTUS prints invoices in 4 DISTINCT FORMATS. Identify the format from the header/layout, then follow its rules.

NEVER calculate tax for Lotus — always copy printed values; if a field is not printed, use "0.00".

vendor_customercode (all formats): extract the raw printed customer code (e.g. "TH00607", "90607", or "10670"). The server converts "TH0XXXX" → "9XXXX" automatically — just give the raw printed value.

FORMAT A — CREDIT NOTE COMPENSATE CONFIRMATION REPORT
Recognise by: header text "CREDIT NOTE COMPENSATE CONFIRMATION REPORT"; invoice number like "Cxxxxxxxx CN3" or "...CV3".
- ONE ROW per DEAL line in the DEAL NO / BUYER / SECTION / AMOUNT / VAT table.
- vendor_customercode = number after "VENDOR NO" (e.g. "VENDOR NO 90607" → "90607")
- invoiceno = top-right reference (e.g. "C260400473CN3")
- amount = AMOUNT column value
- vat_7 = VAT column value verbatim (may be 0.00) — copy, do NOT calculate.
- netamount = AMOUNT column value (same as amount when VAT is 0; copy, do NOT calculate)
- description = deal-type code line below VENDOR NO (e.g. "JN01 ส่วนลดในการร่วมกันสนับสนุนการขาย-โปรโมชัน") — same for all rows. Recognised codes: JN01/JN02/JV01/JV02/SN01/SN06/SN12/SV03/ON01.
- product_description = detail reference line below each deal row (starts with 12-digit ref, then date range, then SKU info; e.g. "260300001811 26/02/2026-25/03/2026 90607_WK9-12 CP24_6_MAMA BIG PACK PLUS PORK 95G")

FORMAT B — TAX INVOICE (and document-type variants)
Recognise by: header "ใบแจ้งหนี้" + table columns "No | Item Category | Description | UOM | Quantity | Unit Price | Amount"; invoice number is a 2-3 letter prefix + 4 digits + "-" + 5 digits. Known prefixes: BH (e.g. "BH2603-00013"), DC (e.g. "DC2511-00051"), TS (e.g. "TS2601-00030"); other 2-3 letter prefixes may exist and should be accepted.
- ONE ROW per Description-column line item.
- vendor_customercode = "Customer Code" field value (e.g. "TH00607")
- vendor_branch = "สาขาที่:" field value on the vendor side (e.g. "00175")
- invoiceno = "Invoice Number" value (e.g. "BH2603-00013")
- invoicedate = "Invoice Date" value (e.g. "31-Mar-26")
- duedate = "Due Date" value (e.g. "07-Apr-26")
- description = "Description" column value verbatim PER ROW (e.g. "ค่าขนส่ง BackHaul เดือน มีนาคม 2569")
- amount = "Amount" column value
- vat_7 = "ภาษีมูลค่าเพิ่ม" summary line value verbatim (usually "0.00" for these invoices)
- netamount = "ยอดรวมทั้งสิ้น" summary line value verbatim — COPY as printed, do NOT calculate from amount + VAT

FORMAT C — RECEIPT
Recognise by: header "ใบเสร็จรับเงิน" + table columns "ลำดับ | เลขที่ใบแจ้งหนี้ | วันที่ใบแจ้งหนี้ | รายการ | จำนวนเงินตามใบแจ้งหนี้ | จำนวนเงินรับ".
- ONE ROW per table line item.
- vendor_customercode = "รหัสลูกค้า:" field at top-right (e.g. "TH00607") — NOT the "(Site)" code.
- invoiceno = "เลขที่ใบแจ้งหนี้" column value PER ROW (e.g. "A260310890") — NOT the top "เลขที่" number (e.g. "282434").
- invoicedate = "วันที่ใบแจ้งหนี้" column value PER ROW (e.g. "03-APR-26")
- description = "รายการ" column value PER ROW verbatim (e.g. "CIS DCI Discount", "CIS Monthly Discount")
- amount = "จำนวนเงินตามใบแจ้งหนี้" column value
- netamount = "จำนวนเงินรับ" column value PER ROW — COPY as printed, do NOT calculate

FORMAT D — MONTHLY DISCOUNT
Recognise by: invoice number ending in "MDN" (e.g. "M260410670MDN"); body mentions "Monthly Discount"; has a "MONTHLY DISCOUNT CHARGE DETAIL" section.
- ONE ROW per invoice — just the grand total. Do NOT expand the MONTHLY DISCOUNT CHARGE DETAIL table or "Monthly Discount - Net Receipt Details" table.
- vendor_customercode = number after "VENDOR NO" or "Vendor No" (e.g. "VENDOR NO :10670" → "10670")
- invoiceno = top-right invoice code (e.g. "M260410670MDN") — must match pattern "M" + 9 digits + "MDN". Do NOT invent invoice numbers from any other text.
- invoicedate = top "วันที่ <Thai date>" (e.g. "3 พฤษภาคม 2569")
- description = "Monthly Discount" (exactly these two words)
- amount = the grand total amount of the invoice (e.g. "253,792.81")
- netamount = the grand total amount as printed (same as amount when VAT is 0; copy, do NOT calculate)
- vat_7 = the value of the "ภาษีมูลค่าเพิ่ม VAT" CELL only (almost always "0"). The column header "จำนวนเงินรวม VAT 7%" is just the LABEL for the total-with-VAT column — it is NOT a VAT amount. Likewise "TAB 7%" / "TAB %" / "DISPLAY %" / "MD %" are discount-percentage columns, never VAT. If ภาษีมูลค่าเพิ่ม shows 0, vat_7 = "0".

GLOBAL — for ALL Lotus formats: invoiceno MUST match one of these shapes — "Cxxxxxxxxx CN/CVx" (Format A), "XX(X)xxxx-xxxxx" with a 2-3 letter prefix like BH/DC/TS (Format B), "Axxxxxxxxx" (Format C), or "Mxxxxxxxxx MDN" (Format D). If you can't find a value matching one of these, leave the row out — do NOT fabricate an invoice number from random characters or column-header noise.`,
  },
  {
    id: 'MAKRO',
    label: 'Makro',
    match: {
      filenameKeywords: ['makro', 'ซีพีแอ็กซ์ตร้า'],
      nameKeywords: ['makro', 'แม็คโคร', 'cp axtra', 'ซีพี แอ็กซ์ตร้า', 'ซีพีแอ็กซ์ตร้า'],
    },
    extractMode: 'ocr',
    vendorCode: 'customer-line',
    vendorBranch: 'auto',
    notes: `vendor_customercode = the number in (parentheses) after our company name on the "ได้รับเงินจาก" line (e.g. 2128209).
TWO-LINE ITEM LAYOUT — each line item in the รายละเอียด/Description column is printed as EXACTLY two lines:
  Line 1 — the short category/charge-type heading, printed WITHOUT an amount on the right side → this is "description".
    Examples: "Promotion/Markdown Deal", "Retro Bonus", "Store Celebration", "Data Providing Deal/MSP", "ค่ากระจายสินค้า"
  Line 2 — the specific detail text printed ON THE SAME LINE as the baht amount on the right → this is "product_description".
    Examples: "DF2026036574 Promotion Support based on Sale", "Retro Bonus 2026", "Store Celebration 2026", "Data Providing Deal/MSP 2026", "Backhaul Wangnoi", "ค่ากระจายสินค้า 2026"
CRITICAL — "ได้รับชำระเงินตามรายการดังนี้" is a receipt header printed above the table. It is NEVER a description — do NOT put it in description for any row.
RULE: description = the line WITHOUT an amount (the heading); product_description = the line WITH the amount (the detail). Never swap them.
vat_7: calculate as amount × 0.07 for each line item (Makro prints only the total VAT, not per-line — this overrides the general no-calculate rule).`,
  },
  {
    id: 'TFG',
    label: 'TFG',
    match: { filenameKeywords: ['tfg'], nameKeywords: ['ไทยฟู้ด'] },
    extractMode: 'ocr',
    vendorCode: 'customer-line',
    vendorBranch: 'auto',
    notes: 'vendor_customercode = the value next to the "รหัสลูกค้า" field.',
  },
  {
    id: 'VILLA',
    label: 'Villa Market',
    match: { filenameKeywords: ['villa'], nameKeywords: ['villa market', 'วิลล่า'] },
    extractMode: 'ocr',
    vendorCode: 'customer-line',
    vendorBranch: 'blank',
    notes: 'vendor_customercode = the code on the right side of the invoice that starts with "PVC" (the prefix may vary).',
  },
  {
    id: 'WATSON',
    label: 'Watsons',
    match: { filenameKeywords: ['watson', 'watsons'], nameKeywords: ['watson', 'วัตสัน'] },
    extractMode: 'ocr',
    vendorCode: 'customer-line',
    vendorBranch: 'blank',
    notes: 'vendor_customercode = the value next to "Attn:" on the right side of the invoice.',
  },
  {
    id: 'TSURUHA',
    label: 'Tsuruha',
    match: { filenameKeywords: ['tsuruha'], nameKeywords: ['tsuruha', 'ซูรูฮะ'] },
    extractMode: 'ocr',
    vendorCode: 'customer-line',
    vendorBranch: 'auto',
    notes: 'vendor_customercode = the value of the "Vendor" field.',
  },
  {
    id: 'BIGC_FOOD',
    label: 'Big C Food Service',
    match: {
      filenameKeywords: ['big c food', 'bigcfood', 'bigc_food'],
      nameKeywords: ['บิ๊กซี ฟู๊ด', 'บิ๊กซีฟู๊ด', 'บิ๊กซี ฟู้ด', 'big c food', 'bigc food'],
      taxids: ['0105563176541'],
    },
    extractMode: 'auto',
    vendorCode: 'customer-line',
    vendorBranch: 'auto',
    notes: 'vendor_customercode = the number at the start of the ชื่อลูกค้า line (e.g. 6600179). The numeric code printed right after the VENDOR company name at the top (e.g. "00000") is the vendor_branch, NOT the vendor_customercode — keep the two separate.',
  },
  {
    id: 'BIGC',
    label: 'Big C',
    match: {
      filenameKeywords: ['big c', 'bigc', 'big-c'],
      nameKeywords: ['บิ๊กซีซูเปอร์เซ็นเตอร์', 'บิ๊กซี ซูเปอร์เซ็นเตอร์', 'big c supercenter', 'big c super center', 'บิ๊กซี', 'big c', 'bigc'],
      taxids: ['0107536000633'],
    },
    extractMode: 'auto',
    vendorCode: 'customer-line',
    vendorBranch: 'auto',
    notes: 'vendor_customercode = the number at the start of the ชื่อลูกค้า line (e.g. 4000047). The numeric code printed right after the VENDOR company name at the top (e.g. "00000" or "00485") is the vendor_branch, NOT the vendor_customercode — keep the two separate.',
  },
  {
    id: 'CP_ALL',
    label: 'CP All (7-Eleven)',
    match: {
      filenameKeywords: ['cp all', 'cpall', 'cp-all', 'cp_all', 'all speedy', 'allspeedy'],
      nameKeywords: ['ซีพี ออลล์', 'ซีพีออลล์', 'cp all', 'cpall', 'all speedy', 'ออลล์ สปีดดี้'],
      taxids: ['0107542000011', '0105565017547'],
    },
    extractMode: 'auto',
    vendorCode: 'customer-line',
    vendorBranch: 'auto',
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
// Priority: issuer tax id → company-name keyword → filename keyword (last resort).
export function detectCustomer(invoiceText: string, filename: string): CustomerRule | null {
  for (const r of CUSTOMER_RULES) {
    if (r.match.taxids?.some((t) => invoiceText.includes(t))) return r
  }
  const lower = invoiceText.toLowerCase()
  for (const r of CUSTOMER_RULES) {
    if (r.match.nameKeywords?.some((k) => lower.includes(k.toLowerCase()))) return r
  }
  for (const r of CUSTOMER_RULES) {
    if (r.match.filenameKeywords && filenameMatches(filename, r.match.filenameKeywords)) return r
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
    case 'customer-line':
      return 'vendor_customercode: the code our company (the buyer) was assigned by this vendor. Find it next to a customer/buyer/account-code label (รหัสลูกค้า / รหัสลูกหนี้ / รหัสผู้ซื้อ / รหัสร้านค้า / Customer Code / Customer No / "Customer:"), or as the leading code on the ชื่อลูกค้า / ชื่อผู้ซื้อ line, or a code in (parentheses) after our company name. It is NOT the vendor_branch and NOT the vendor company name.'
    case 'top-m-line':
      return 'vendor_customercode: the digits after "TOP-M" on the เจ้าของ/ตัวแทน(รหัสร้านค้า) line (e.g. "TOP-M802316" → "802316"). (Also enforced automatically.)'
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
vendor_branch: if the vendor (issuer) company designation anywhere on the invoice includes "สำนักงานใหญ่", "Head Office", "HQ", or similar head-office indicators (and this refers to the vendor company, NOT to สหพัฒนพิบูล / our company), return "00000". Otherwise, use only an explicitly labelled branch ("สาขาที่", "Branch", "Site code"); "Group [number]" is NOT a branch; return "" if none found.`
  }

  const lines: string[] = [`DETECTED CUSTOMER: ${rule.label}`, vendorCodeInstruction(rule.vendorCode)]

  if (rule.vendorBranch === 'blank') {
    lines.push('vendor_branch: always return "" (blank).')
  } else {
    lines.push('vendor_branch: if the vendor (issuer) company designation anywhere on the invoice includes "สำนักงานใหญ่", "Head Office", "HQ", or similar head-office indicators (and this refers to the vendor company, NOT to สหพัฒนพิบูล / our company), return "00000". Otherwise, use only an explicitly labelled branch ("สาขาที่", "Branch", "Site code"); "Group [number]" is NOT a branch; return "" if none found.')
  }

  if (rule.notes) lines.push(rule.notes)

  return lines.join('\n')
}
