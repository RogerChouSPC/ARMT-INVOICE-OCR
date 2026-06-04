// Field normalisation + comparison for scoring extracted rows against the
// ground-truth register. Goal: ignore representation differences (whitespace,
// thousands separators, date format, BE/CE, zero-vs-blank) while still catching
// genuine value errors.
import { MONEY_FIELDS, DATE_FIELDS, type FieldKey } from './fields.ts'

/** Normalise free text: to string, NFC, trim, collapse internal whitespace. */
export function normText(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).normalize('NFC').replace(/\s+/g, ' ').trim()
}

/** Parse a money-ish value to a number (commas/spaces/currency stripped). null if not numeric. */
export function normNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const cleaned = String(v).replace(/[,\s]/g, '').replace(/[^0-9.\-]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : null
}

/** Money compare: treat null/blank as 0; equal within ±0.01. */
function moneyEqual(a: unknown, b: unknown): boolean {
  const na = normNum(a) ?? 0
  const nb = normNum(b) ?? 0
  return Math.abs(na - nb) <= 0.011
}

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n)
}

/** Normalise a date to DD/MM/YYYY (Gregorian). Handles JS Date, DD/MM/YYYY,
 *  YYYY-MM-DD, and Buddhist-era years (>=2500 → −543). Returns '' if unknown. */
export function normDate(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  if (v instanceof Date && !isNaN(v.getTime())) {
    // SheetJS date cells can land a few seconds before/after midnight with a tz
    // offset (e.g. 2026-02-28 → 2026-02-27T16:59:56Z). Round to the nearest whole
    // UTC day, then read in UTC, so the calendar date is stable.
    const d = new Date(Math.round(v.getTime() / 86400000) * 86400000)
    return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
  }
  const s = String(v).trim()
  let d: number, m: number, y: number
  let mm = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/) // DD/MM/YYYY
  if (mm) { d = +mm[1]; m = +mm[2]; y = +mm[3] }
  else {
    mm = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/) // YYYY-MM-DD
    if (mm) { y = +mm[1]; m = +mm[2]; d = +mm[3] }
    else return s // unknown format — compare raw
  }
  if (y >= 2500) y -= 543
  return `${pad2(d)}/${pad2(m)}/${y}`
}

/** Invoice-number key: string, upper, strip all whitespace, and normalise a
 *  trailing line-sequence suffix so "-001" == "-1" (MAKRO post-processing emits
 *  "-1"/"-2" while the register stores zero-padded "-001"/"-002"). Both sides
 *  pass through here, so this only affects join/equality, never the printed value. */
export function normInvoice(v: unknown): string {
  return normText(v)
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/-(\d+)$/, (_, d) => '-' + String(parseInt(d, 10)))
}

/** Canonicalise a "<NN> - <label>" customergroup: strip the leading-zero/dash-
 *  spacing drift between registers ("9 - X", "06-X") and the seed ("09 - X"). */
function normGroupLabel(v: unknown): string {
  const s = normText(v)
  const m = s.match(/^(\d+)\s*-\s*(.*)$/)
  return m ? `${parseInt(m[1], 10)} - ${m[2]}` : s
}

/** Canonicalise a "<code> - <name>" customercode: keep the code (identifier,
 *  leading zeros significant) but normalise dash spacing ("0102856-X" vs "0102856 - X"). */
function normCodeLabel(v: unknown): string {
  const s = normText(v)
  const m = s.match(/^(\w+)\s*-\s*(.*)$/)
  return m ? `${m[1]} - ${m[2]}` : s
}

/** True if two values match for the given field, under field-appropriate rules. */
export function fieldMatches(field: FieldKey, a: unknown, b: unknown): boolean {
  if (MONEY_FIELDS.includes(field)) return moneyEqual(a, b)
  if (DATE_FIELDS.includes(field)) return normDate(a) === normDate(b)
  if (field === 'invoiceno') return normInvoice(a) === normInvoice(b)
  if (field === 'customergroup') return normGroupLabel(a) === normGroupLabel(b)
  if (field === 'customercode') return normCodeLabel(a) === normCodeLabel(b)
  return normText(a) === normText(b)
}
