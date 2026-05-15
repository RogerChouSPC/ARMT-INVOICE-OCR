export interface InvoiceRow {
  seq: number
  customergroup: string
  customercode: string
  taxid: string
  vendor_customercode: string
  vendor_branch: string
  vendor_expensecode: string
  vendor_expensegroup: string
  divisionsale: string
  invoiceno: string
  invoicedate: string
  duedate: string
  description: string
  product_description: string
  amount: string
  vat_7: string
  tax_pct: string
  tax_2: string
  tax_3: string
  tax_5: string
  netamount: string
  remark: string
}

export const INVOICE_COLUMNS: { key: keyof InvoiceRow; label: string; width: number }[] = [
  { key: 'seq', label: 'seq', width: 60 },
  { key: 'customergroup', label: 'customergroup', width: 200 },
  { key: 'customercode', label: 'customercode', width: 200 },
  { key: 'taxid', label: 'taxid', width: 140 },
  { key: 'vendor_customercode', label: 'vendor_customercode', width: 160 },
  { key: 'vendor_branch', label: 'vendor_branch', width: 120 },
  { key: 'vendor_expensecode', label: 'vendor_expensecode', width: 140 },
  { key: 'vendor_expensegroup', label: 'vendor_expensegroup', width: 140 },
  { key: 'divisionsale', label: 'divisionsale', width: 120 },
  { key: 'invoiceno', label: 'invoiceno', width: 160 },
  { key: 'invoicedate', label: 'invoicedate', width: 120 },
  { key: 'duedate', label: 'duedate', width: 120 },
  { key: 'description', label: 'description', width: 240 },
  { key: 'product_description', label: 'product_description', width: 240 },
  { key: 'amount', label: 'amount', width: 110 },
  { key: 'vat_7', label: 'VAT 7%', width: 100 },
  { key: 'tax_pct', label: 'TAX %', width: 100 },
  { key: 'tax_2', label: 'TAX 2%', width: 100 },
  { key: 'tax_3', label: 'TAX 3%', width: 100 },
  { key: 'tax_5', label: 'TAX 5%', width: 100 },
  { key: 'netamount', label: 'netamount', width: 110 },
  { key: 'remark', label: 'remark', width: 160 },
]

export const EMPTY_ROW = (): InvoiceRow => ({
  seq: 0,
  customergroup: '',
  customercode: '',
  taxid: '',
  vendor_customercode: '',
  vendor_branch: '',
  vendor_expensecode: '',
  vendor_expensegroup: '',
  divisionsale: '',
  invoiceno: '',
  invoicedate: '',
  duedate: '',
  description: '',
  product_description: '',
  amount: '',
  vat_7: '',
  tax_pct: '',
  tax_2: '',
  tax_3: '',
  tax_5: '',
  netamount: '',
  remark: '',
})

export type ProcessingState =
  | 'idle'
  | 'rendering'
  | 'ocr'
  | 'extracting'
  | 'done'
  | 'error'

export interface FileProcessingStatus {
  file: File
  state: ProcessingState
  progress: number
  error?: string
  rows: InvoiceRow[]
}
