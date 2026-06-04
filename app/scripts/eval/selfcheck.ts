// Sanity check: load every vendor register and feed its own rows back through
// the scorer. A correct loader + normaliser must report ~100% field accuracy
// and zero unmatched. This validates the join/normalisation BEFORE we trust any
// real extraction accuracy number.
//
// Run: npx tsx scripts/eval/selfcheck.ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadGroundTruth } from './groundTruth.ts'
import { scoreRows } from './score.ts'
import { SCORED_FIELDS } from './fields.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const vendors: { code: string; outputFile: string }[] = JSON.parse(
  readFileSync(join(HERE, 'vendor-map.json'), 'utf-8')
)

let totalRows = 0
let totalUnmatched = 0
let totalFieldMatch = 0
let totalFieldTotal = 0
const problems: string[] = []

for (const v of vendors) {
  let gt
  try {
    gt = loadGroundTruth(v.outputFile)
  } catch (e) {
    problems.push(`${v.code}: LOAD FAILED — ${(e as Error).message}`)
    continue
  }
  // Score the register's own rows against itself.
  const res = scoreRows(gt.rows, gt, { maxMismatches: 5 })
  totalRows += gt.rows.length
  totalUnmatched += res.unmatched

  let fm = 0, ft = 0
  for (const f of SCORED_FIELDS) { fm += res.fieldTallies[f].match; ft += res.fieldTallies[f].total }
  totalFieldMatch += fm
  totalFieldTotal += ft
  const acc = ft ? (100 * fm / ft) : 100

  const flag = res.unmatched > 0 || acc < 99.5 ? '  <-- CHECK' : ''
  console.log(
    `${v.code.padEnd(9)} sheet=${gt.sheetName.slice(0, 10).padEnd(10)} rows=${String(gt.rows.length).padStart(4)} ` +
    `unmatched=${String(res.unmatched).padStart(3)} fieldAcc=${acc.toFixed(1)}%${flag}`
  )
  if (res.unmatched > 0) {
    problems.push(`${v.code}: ${res.unmatched} rows did not self-match (invoiceno blank or duplicate-amount collision)`)
  }
  for (const m of res.mismatches.slice(0, 3)) {
    problems.push(`${v.code}: self-mismatch inv=${m.invoiceno} field=${m.field} got=${JSON.stringify(m.got)} want=${JSON.stringify(m.want)}`)
  }
}

console.log('\n=== SELF-CHECK TOTALS ===')
console.log(`rows=${totalRows} unmatched=${totalUnmatched} fieldAcc=${(100 * totalFieldMatch / totalFieldTotal).toFixed(2)}%`)
if (problems.length) {
  console.log('\nNOTES:')
  for (const p of problems.slice(0, 40)) console.log('  -', p)
}
