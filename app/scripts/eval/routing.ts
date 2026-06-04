// Offline routing report (no API key, no LLM): for every PDF, run the same
// pdf.js text extraction + detectCustomer + shouldUseOcr the app uses, and check
// whether the detected customer matches the vendor folder's expected rule.
//
// Surfaces: detection misses, text-vs-OCR path split, and broken/empty PDFs —
// all before spending a cent on extraction.
//
// Run: npx tsx scripts/eval/routing.ts
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { extractPdfText } from './pdfText.ts'
import { detectCustomer, shouldUseOcr } from '../../src/config/customers.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
interface Vendor { code: string; expectedCustomerId: string | null; inputDir: string }
const vendors: Vendor[] = JSON.parse(readFileSync(join(HERE, 'vendor-map.json'), 'utf-8'))

const onlyVendor = process.argv[2] // optional: run a single vendor code

let totalPdf = 0, totalOcr = 0, totalText = 0, totalDetectOk = 0, totalDetectMiss = 0, totalEmpty = 0
const missDetail: string[] = []

for (const v of vendors) {
  if (onlyVendor && v.code !== onlyVendor) continue
  const pdfs = readdirSync(v.inputDir).filter((f) => f.toLowerCase().endsWith('.pdf'))
  let ocr = 0, text = 0, detOk = 0, detMiss = 0, empty = 0
  for (const f of pdfs) {
    totalPdf++
    let res
    try {
      res = await extractPdfText(join(v.inputDir, f))
    } catch (e) {
      empty++; totalEmpty++
      missDetail.push(`${v.code}/${f}: PDF read error — ${(e as Error).message}`)
      continue
    }
    const detected = detectCustomer(res.text, f)
    const useOcr = shouldUseOcr(detected, res.isDigital)
    if (useOcr) { ocr++; totalOcr++ } else { text++; totalText++ }
    if (res.text.replace(/\s+/g, '').length < 20) empty++  // scanned: no text layer (expected → OCR)

    // Detection from the text layer only. Scanned PDFs legitimately detect null
    // here (the app re-detects from OCR text later), so only flag a miss when the
    // text layer was substantial yet detection disagreed with the expected rule.
    const detId = detected?.id ?? null
    if (v.expectedCustomerId) {
      if (detId === v.expectedCustomerId) { detOk++; totalDetectOk++ }
      else if (res.isDigital || res.text.replace(/\s+/g, '').length > 200) {
        detMiss++; totalDetectMiss++
        missDetail.push(`${v.code}/${f}: expected ${v.expectedCustomerId} got ${detId ?? 'null'} (digital=${res.isDigital})`)
      }
    }
  }
  console.log(
    `${v.code.padEnd(9)} pdfs=${String(pdfs.length).padStart(3)} ocr=${String(ocr).padStart(3)} text=${String(text).padStart(3)} ` +
    `detectFromText:ok=${String(detOk).padStart(3)} miss=${String(detMiss).padStart(2)} noTextLayer=${String(empty).padStart(3)}`
  )
}

console.log('\n=== ROUTING TOTALS ===')
console.log(`pdfs=${totalPdf} ocrPath=${totalOcr} textPath=${totalText} | detectFromText ok=${totalDetectOk} miss=${totalDetectMiss} | readErrors=${totalEmpty}`)
if (missDetail.length) {
  console.log('\nDETAIL (first 40):')
  for (const m of missDetail.slice(0, 40)) console.log('  -', m)
}
