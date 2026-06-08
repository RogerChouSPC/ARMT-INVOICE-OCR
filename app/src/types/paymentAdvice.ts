// Client-side types for the Makro Payment Advice tab. Structurally identical to
// the server-side shapes in api/paymentAdvice.ts (kept separate so the API stays
// self-contained and is not pulled into the browser bundle).

export interface PaymentAdviceInvoice {
  inv_date: string
  inv_number: string
  inv_seq: number
  store_code: string
  reference: string
  inv_amount: number
  wht_amount: number
  transfer_amount: number
}

export interface PaymentAdviceStore {
  payee: string
  site: string
  email: string
  pdf_total_invoice: number
  pdf_total_wht: number
  pdf_total_transfer: number
  invoices: PaymentAdviceInvoice[]
}

export interface PaymentAdviceFile {
  filename: string
  reference: string
  value_date: string
  transferred_amount: number
  stores: PaymentAdviceStore[]
}
