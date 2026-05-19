import * as XLSX from 'xlsx'
import type { InvoiceRow } from '@/types/invoice'

const HEADERS = [
  'seq ',
  'customergroup',
  'customercode',
  'taxid',
  'vendor_customercode',
  'vendor_branch',
  'vendor_expensecode',
  'vendor_expensegroup',
  'divisionsale',
  'invoiceno',
  'invoicedate',
  'duedate',
  'description',
  'product_description',
  'amount',
  'VAT 7% ',
  'TAX % ',
  'TAX 2% ',
  'TAX 3% ',
  'TAX 5% ',
  'netamount',
  'remark',
]

export function exportToExcel(rows: InvoiceRow[], filename = 'invoice_output.xlsx') {
  const data = rows.map((r, idx) => [
    idx + 1,
    r.customergroup,
    r.customercode,
    r.taxid,
    r.vendor_customercode,
    r.vendor_branch,
    r.vendor_expensecode,
    r.vendor_expensegroup,
    r.divisionsale,
    r.invoiceno,
    r.invoicedate,
    r.duedate,
    r.description,
    r.product_description,
    r.amount ? Number(r.amount) : '',
    r.vat_7 ? Number(r.vat_7) : '',
    r.tax_pct ? Number(r.tax_pct) : '',
    r.tax_2 ? Number(r.tax_2) : '',
    r.tax_3 ? Number(r.tax_3) : '',
    r.tax_5 ? Number(r.tax_5) : '',
    r.netamount ? Number(r.netamount) : '',
    r.remark,
  ])

  const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...data])

  // Column widths
  ws['!cols'] = [
    { wch: 6 }, { wch: 30 }, { wch: 30 }, { wch: 16 }, { wch: 18 },
    { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 20 },
    { wch: 14 }, { wch: 14 }, { wch: 40 }, { wch: 40 }, { wch: 14 },
    { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
    { wch: 14 }, { wch: 20 },
  ]

  // Header row style — bold
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c })
    if (!ws[addr]) continue
    ws[addr].s = { font: { bold: true }, fill: { fgColor: { rgb: 'E8F0FE' } } }
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Output')
  XLSX.writeFile(wb, filename)
}
