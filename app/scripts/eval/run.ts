// Eval harness entry point. Runs sampled (or all) PDFs through the real pipeline
// and scores extracted rows against the ground-truth registers.
//
// Usage (from app/):
//   npx tsx scripts/eval/run.ts                 # 2 PDFs per vendor (sampled)
//   npx tsx scripts/eval/run.ts --sample 4      # 4 PDFs per vendor
//   npx tsx scripts/eval/run.ts --vendor CJ     # one vendor
//   npx tsx scripts/eval/run.ts --all           # every PDF (full LLM cost)
//   npx tsx scripts/eval/run.ts --concurrency 4
//
// Needs OPENROUTER_API_KEY (from app/.env or the environment).
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { runPdf, type PipelineResult } from './pipeline.ts'
import { loadGroundTruth } from './groundTruth.ts'
import { scoreRows, emptyTallies, type ScoreResult } from './score.ts'
import { SCORED_FIELDS, type FieldKey, type RowRecord } from './fields.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

interface Vendor { code: string; expectedCustomerId: string | null; inputDir: string; outputFile: string }
const vendors: Vendor[] = JSON.parse(readFileSync(join(HERE, 'vendor-map.json'), 'utf-8'))

// ── args ──
const args = process.argv.slice(2)
function flag(name: string): boolean { return args.includes('--' + name) }
function opt(name: string, def: string): string {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}
const SAMPLE = parseInt(opt('sample', '2'), 10)
const ALL = flag('all')
const ONLY = opt('vendor', '')
const PDF_FILTER = opt('pdf', '') // only PDFs whose filename includes this substring
const CONCURRENCY = Math.max(1, parseInt(opt('concurrency', '3'), 10))

// ── api key ──
function loadApiKey(): string {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY
  const envPath = join(HERE, '..', '..', '.env')
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
      const m = line.match(/^\s*OPENROUTER_API_KEY\s*=\s*(.+?)\s*$/)
      if (m) return m[1].replace(/^["']|["']$/g, '')
    }
  }
  return ''
}
const API_KEY = loadApiKey()
if (!API_KEY) {
  console.error('ERROR: OPENROUTER_API_KEY not found. Set it in app/.env or the environment.')
  process.exit(1)
}

/** Evenly-spaced sample of n items from arr (deterministic). */
function sample<T>(arr: T[], n: number): T[] {
  if (ALL || n >= arr.length) return arr
  const out: T[] = []
  for (let i = 0; i < n; i++) out.push(arr[Math.floor((i * arr.length) / n)])
  return out
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let idx = 0
  async function worker() {
    while (idx < items.length) {
      const i = idx++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
  return out
}

function fieldAcc(tallies: Record<FieldKey, { match: number; total: number }>): number {
  let m = 0, t = 0
  for (const f of SCORED_FIELDS) { m += tallies[f].match; t += tallies[f].total }
  return t ? (100 * m / t) : 0
}

interface VendorReport {
  code: string; expectedCustomerId: string | null
  pdfs: number; detectOk: number
  score: ScoreResult; errors: string[]
  llmCalls: number; ocrCalls: number
}

async function main() {
  const selected = vendors.filter((v) => !ONLY || v.code === ONLY)
  const reports: VendorReport[] = []
  const overallTallies = emptyTallies()

  console.log(`Running ${ALL ? 'ALL' : `${SAMPLE}/vendor`} | concurrency=${CONCURRENCY} | vendors=${selected.length}\n`)

  for (const v of selected) {
    let all = readdirSync(v.inputDir).filter((f) => f.toLowerCase().endsWith('.pdf'))
    if (PDF_FILTER) all = all.filter((f) => f.includes(PDF_FILTER))
    const pdfs = PDF_FILTER ? all : sample(all, SAMPLE)
    const results: PipelineResult[] = await pool(pdfs, CONCURRENCY, (f) => runPdf(join(v.inputDir, f), API_KEY))

    const extracted: RowRecord[] = []
    let detectOk = 0, llmCalls = 0, ocrCalls = 0
    const errors: string[] = []
    for (const r of results) {
      if (r.error) errors.push(`${r.pdf}: ${r.error}`)
      if (v.expectedCustomerId && r.effectiveId === v.expectedCustomerId) detectOk++
      extracted.push(...r.rows)
      if (r.llmCalled) llmCalls++
      ocrCalls += r.ocrCalls
    }

    const gt = loadGroundTruth(v.outputFile)
    const score = scoreRows(extracted, gt, { maxMismatches: 12 })
    for (const f of SCORED_FIELDS) {
      overallTallies[f].match += score.fieldTallies[f].match
      overallTallies[f].total += score.fieldTallies[f].total
    }

    reports.push({ code: v.code, expectedCustomerId: v.expectedCustomerId, pdfs: pdfs.length, detectOk, score, errors, llmCalls, ocrCalls })

    const prec = score.extracted ? (100 * score.matched / score.extracted) : 0
    console.log(
      `${v.code.padEnd(9)} pdfs=${String(pdfs.length).padStart(2)} det=${String(detectOk).padStart(2)}/${pdfs.length} ` +
      `rows=${String(score.extracted).padStart(4)} matched=${String(score.matched).padStart(4)} ` +
      `prec=${prec.toFixed(0).padStart(3)}% exactRow=${String(score.exactRowMatches).padStart(4)} ` +
      `fieldAcc=${fieldAcc(score.fieldTallies).toFixed(1)}%${errors.length ? `  ERR=${errors.length}` : ''}`
    )
  }

  // ── per-field weakest (over matched rows) ──
  console.log('\n=== PER-FIELD ACCURACY (matched rows, all vendors) ===')
  const fieldRows = SCORED_FIELDS
    .map((f) => ({ f, ...overallTallies[f], acc: overallTallies[f].total ? 100 * overallTallies[f].match / overallTallies[f].total : 100 }))
    .sort((a, b) => a.acc - b.acc)
  for (const r of fieldRows) {
    console.log(`  ${r.f.padEnd(20)} ${r.acc.toFixed(1).padStart(6)}%  (${r.match}/${r.total})`)
  }

  // ── overall ──
  const totRows = reports.reduce((s, r) => s + r.score.extracted, 0)
  const totMatched = reports.reduce((s, r) => s + r.score.matched, 0)
  const totExact = reports.reduce((s, r) => s + r.score.exactRowMatches, 0)
  const totLlm = reports.reduce((s, r) => s + r.llmCalls, 0)
  const totOcr = reports.reduce((s, r) => s + r.ocrCalls, 0)
  console.log('\n=== OVERALL ===')
  console.log(`extracted=${totRows} matched=${totMatched} (prec=${totRows ? (100 * totMatched / totRows).toFixed(1) : 0}%) ` +
    `exactRowMatch=${totExact} (${totMatched ? (100 * totExact / totMatched).toFixed(1) : 0}% of matched) ` +
    `overallFieldAcc=${fieldAcc(overallTallies).toFixed(2)}%`)
  console.log(`LLM extract calls=${totLlm}  OCR calls=${totOcr} (uncached this run)`)

  // ── sample mismatches ──
  console.log('\n=== SAMPLE MISMATCHES (first 3 per vendor) ===')
  for (const r of reports) {
    for (const m of r.score.mismatches.slice(0, 3)) {
      const got = JSON.stringify(m.got)?.slice(0, 45)
      const want = JSON.stringify(m.want)?.slice(0, 45)
      console.log(`  ${r.code.padEnd(9)} inv=${m.invoiceno.slice(0, 16).padEnd(16)} ${m.field.padEnd(18)} got=${got} want=${want}`)
    }
    for (const e of r.errors.slice(0, 2)) console.log(`  ${r.code.padEnd(9)} ERROR ${e.slice(0, 80)}`)
  }

  // ── persist JSON report ──
  const reportsDir = join(HERE, 'reports')
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outPath = join(reportsDir, `report-${stamp}.json`)
  writeFileSync(outPath, JSON.stringify({
    config: { sample: ALL ? 'all' : SAMPLE, concurrency: CONCURRENCY, vendor: ONLY || 'all' },
    overall: { extracted: totRows, matched: totMatched, exactRowMatch: totExact, fieldAcc: fieldAcc(overallTallies), llmCalls: totLlm, ocrCalls: totOcr },
    perField: fieldRows,
    vendors: reports,
  }, null, 2), 'utf-8')
  console.log(`\nReport written: ${outPath}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
