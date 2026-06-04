// Load a vendor's ground-truth register (.xlsx) into row records indexed by
// invoice number. The canonical data lives on the sheet whose first column
// header is `seq` (the ทะเบียนคุม tab); other tabs are vendor working sheets.
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { COLUMN_KEYS, type RowRecord } from './fields.ts'
import { normInvoice } from './normalize.ts'

export interface GroundTruth {
  rows: RowRecord[]
  /** normInvoice(invoiceno) -> rows sharing it (multi-line invoices). */
  byInvoice: Map<string, RowRecord[]>
  sheetName: string
}

/** Find the sheet whose header row's first cell is "seq" (case/space-insensitive). */
function findSeqSheet(wb: XLSX.WorkBook): { name: string; rows: unknown[][] } | null {
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: false })
    const header0 = grid[0]?.[0]
    if (typeof header0 === 'string' && header0.trim().toLowerCase() === 'seq') {
      return { name, rows: grid }
    }
  }
  return null
}

export function loadGroundTruth(xlsxPath: string): GroundTruth {
  const wb = XLSX.read(readFileSync(xlsxPath), { type: 'buffer', cellDates: true })
  const sheet = findSeqSheet(wb)
  if (!sheet) throw new Error(`No "seq" sheet found in ${xlsxPath} (sheets: ${wb.SheetNames.join(', ')})`)

  const rows: RowRecord[] = []
  for (let i = 1; i < sheet.rows.length; i++) {
    const raw = sheet.rows[i]
    if (!raw || raw[0] === null || raw[0] === undefined || raw[0] === '') continue // require seq
    const rec: RowRecord = {}
    for (let c = 0; c < COLUMN_KEYS.length; c++) rec[COLUMN_KEYS[c]] = raw[c] ?? ''
    rows.push(rec)
  }

  const byInvoice = new Map<string, RowRecord[]>()
  for (const r of rows) {
    const key = normInvoice(r.invoiceno)
    if (!key) continue
    const arr = byInvoice.get(key)
    if (arr) arr.push(r)
    else byInvoice.set(key, [r])
  }

  return { rows, byInvoice, sheetName: sheet.name }
}
