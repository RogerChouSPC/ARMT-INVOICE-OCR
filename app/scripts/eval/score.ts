// Match extracted rows to ground-truth rows and tally per-field accuracy.
//
// Matching: an extracted row matches a GT row by invoice number; when an invoice
// has multiple GT line items, we greedily pair on closest `amount`. An extracted
// row whose invoiceno isn't in the register at all is "unmatched" (likely a
// hallucination or an OCR-mangled number) and counts against precision.
import { SCORED_FIELDS, type FieldKey, type RowRecord } from './fields.ts'
import { fieldMatches, normInvoice, normNum } from './normalize.ts'
import type { GroundTruth } from './groundTruth.ts'

export interface FieldTally { match: number; total: number }

export interface ScoreResult {
  extracted: number
  matched: number
  unmatched: number
  /** rows that matched on invoiceno AND every scored field */
  exactRowMatches: number
  fieldTallies: Record<FieldKey, FieldTally>
  /** sample of mismatches for inspection */
  mismatches: { invoiceno: string; field: FieldKey; got: unknown; want: unknown }[]
}

export function emptyTallies(): Record<FieldKey, FieldTally> {
  const t = {} as Record<FieldKey, FieldTally>
  for (const f of SCORED_FIELDS) t[f] = { match: 0, total: 0 }
  return t
}

export function scoreRows(
  extracted: RowRecord[],
  gt: GroundTruth,
  opts: { maxMismatches?: number } = {}
): ScoreResult {
  const maxMis = opts.maxMismatches ?? 25
  const fieldTallies = emptyTallies()
  const consumed = new Set<RowRecord>()
  const mismatches: ScoreResult['mismatches'] = []
  let matched = 0
  let unmatched = 0
  let exactRowMatches = 0

  for (const ex of extracted) {
    const key = normInvoice(ex.invoiceno)
    const candidates = (key && gt.byInvoice.get(key)) || []
    const free = candidates.filter((c) => !consumed.has(c))
    if (free.length === 0) {
      unmatched++
      continue
    }
    // pick closest amount among free candidates
    const exAmt = normNum(ex.amount) ?? 0
    let best = free[0]
    let bestDiff = Infinity
    for (const c of free) {
      const diff = Math.abs((normNum(c.amount) ?? 0) - exAmt)
      if (diff < bestDiff) { bestDiff = diff; best = c }
    }
    consumed.add(best)
    matched++

    let allFields = true
    for (const f of SCORED_FIELDS) {
      const ok = fieldMatches(f, ex[f], best[f])
      fieldTallies[f].total++
      if (ok) fieldTallies[f].match++
      else {
        allFields = false
        if (mismatches.length < maxMis) {
          mismatches.push({ invoiceno: key, field: f, got: ex[f], want: best[f] })
        }
      }
    }
    if (allFields) exactRowMatches++
  }

  return { extracted: extracted.length, matched, unmatched, exactRowMatches, fieldTallies, mismatches }
}
