// Build the exceljs workbook from the golden data and write it out, so we can
// confirm it opens cleanly and the key reconciliation values are present.
// Verification only. Run from app/: npx tsx scripts/paymentAdvice/verify_excel.ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildPaymentAdviceWorkbook } from '../../src/utils/paymentAdviceExcel.ts'
import type { PaymentAdviceFile } from '../../src/types/paymentAdvice.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const golden = JSON.parse(readFileSync(join(HERE, 'golden.json'), 'utf-8')) as PaymentAdviceFile
const wb = buildPaymentAdviceWorkbook([golden])
await wb.xlsx.writeFile(join(HERE, 'ts_output.xlsx'))
console.log('sheets:', wb.worksheets.map((w) => w.name).join(' | '))
