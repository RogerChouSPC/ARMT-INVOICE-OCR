// The 22 ground-truth columns, in Excel column order (index 0 = seq).
// Keys match InvoiceRow (src/types/invoice.ts). The register's seq-sheet first
// 22 columns are exactly the app's export, so column index == this order.
export const COLUMN_KEYS = [
  'seq',
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
  'vat_7',
  'tax_pct',
  'tax_2',
  'tax_3',
  'tax_5',
  'netamount',
  'remark',
] as const

export type FieldKey = (typeof COLUMN_KEYS)[number]

// Fields actually scored (seq is positional, not extracted).
export const SCORED_FIELDS: FieldKey[] = COLUMN_KEYS.filter((k) => k !== 'seq') as FieldKey[]

export const MONEY_FIELDS: FieldKey[] = ['amount', 'vat_7', 'tax_pct', 'tax_2', 'tax_3', 'tax_5', 'netamount']
export const DATE_FIELDS: FieldKey[] = ['invoicedate', 'duedate']

export type RowRecord = Record<string, unknown>
