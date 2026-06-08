// Parity check: run the TS Payment Advice parser on the sample PDF and diff the
// result against golden.json (produced by ref_parse.py = the coworker's exact
// logic). Verification only — not shipped.
//
// Run from app/: npx tsx scripts/paymentAdvice/verify.ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { extractPaymentAdvice, type PaymentAdviceFile } from '../../api/paymentAdvice.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const SAMPLE = 'd:/spc_ocr/P1 Makro PDF AR/P1 Makro PDF AR/sample PDF/20260505_15348.pdf'
const golden = JSON.parse(readFileSync(join(HERE, 'golden.json'), 'utf-8')) as PaymentAdviceFile

const got = extractPaymentAdvice(readFileSync(SAMPLE), golden.filename)

const errors: string[] = []
const eq = (a: unknown, b: unknown, label: string) => { if (a !== b) errors.push(`${label}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`) }

eq(got.reference, golden.reference, 'reference')
eq(got.value_date, golden.value_date, 'value_date')
eq(got.transferred_amount, golden.transferred_amount, 'transferred_amount')
eq(got.stores.length, golden.stores.length, 'stores.length')

const gotInv = got.stores.reduce((s, st) => s + st.invoices.length, 0)
const wantInv = golden.stores.reduce((s, st) => s + st.invoices.length, 0)
eq(gotInv, wantInv, 'total invoices')

// Deep field-by-field comparison
const n = Math.min(got.stores.length, golden.stores.length)
for (let i = 0; i < n; i++) {
  const a = got.stores[i], b = golden.stores[i]
  for (const k of ['payee', 'site', 'email', 'pdf_total_invoice', 'pdf_total_wht', 'pdf_total_transfer'] as const) {
    eq(a[k], b[k], `store[${i}].${k}`)
  }
  const m = Math.min(a.invoices.length, b.invoices.length)
  if (a.invoices.length !== b.invoices.length) errors.push(`store[${i}] invoice count: got ${a.invoices.length} want ${b.invoices.length}`)
  for (let j = 0; j < m; j++) {
    const ia = a.invoices[j], ib = b.invoices[j]
    for (const k of ['inv_date', 'inv_number', 'inv_seq', 'store_code', 'reference', 'inv_amount', 'wht_amount', 'transfer_amount'] as const) {
      if (ia[k] !== ib[k]) { errors.push(`store[${i}].inv[${j}].${k}: got ${JSON.stringify(ia[k])} want ${JSON.stringify(ib[k])}`); }
    }
    if (errors.length > 40) break
  }
  if (errors.length > 40) break
}

const calc = Math.round(got.stores.reduce((s, st) => s + st.invoices.reduce((t, i) => t + i.transfer_amount, 0), 0) * 100) / 100
console.log(`TS parser: stores=${got.stores.length} invoices=${gotInv} calcSum=${calc} bank=${got.transferred_amount} reconciles=${Math.abs(calc - got.transferred_amount) < 0.01}`)

if (errors.length === 0) {
  console.log('\n✅ PARITY: TS parser output is IDENTICAL to the coworker reference.')
} else {
  console.log(`\n❌ ${errors.length} differences (first 40):`)
  for (const e of errors.slice(0, 40)) console.log('  -', e)
  process.exit(1)
}
