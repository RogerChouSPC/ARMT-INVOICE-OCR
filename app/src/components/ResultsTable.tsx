import { useState, useEffect, useRef } from 'react'
import type { InvoiceRow } from '@/types/invoice'
import { INVOICE_COLUMNS } from '@/types/invoice'
import ConfirmDialog from '@/components/ConfirmDialog'

// Money columns that should carry a soft "not a number" hint when non-empty and unparseable.
const MONEY_COLS = new Set<keyof InvoiceRow>([
  'amount', 'vat_7', 'tax_pct', 'tax_2', 'tax_3', 'tax_5', 'netamount',
])

// A value is "bad numeric" only when it is non-empty AND cannot parse as a number
// (commas/spaces tolerated, since amounts may be formatted). Light touch — never blocks editing.
const isBadNumeric = (v: string) => {
  if (!v.trim()) return false
  return Number.isNaN(Number(v.replace(/[, ]/g, '')))
}

interface Snapshot {
  rows: InvoiceRow[]
  timestamp: Date
}

interface Props {
  rows: InvoiceRow[]
  onUpdate: (rows: InvoiceRow[]) => void
}

export default function ResultsTable({ rows, onUpdate }: Props) {
  const [editCell, setEditCell] = useState<{ row: number; col: keyof InvoiceRow } | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState<Snapshot[]>([])
  const [highlightedRows, setHighlightedRows] = useState<Set<number>>(new Set())
  const [highlightedCells, setHighlightedCells] = useState<Set<string>>(new Set())
  const [confirmDeleteRow, setConfirmDeleteRow] = useState<number | null>(null)
  const [confirmClearHistory, setConfirmClearHistory] = useState(false)
  const initialSaved = useRef(false)
  const lastSnapshotJson = useRef('')
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Save initial snapshot when rows first arrive; reset when cleared
  useEffect(() => {
    if (rows.length === 0) {
      initialSaved.current = false
      lastSnapshotJson.current = ''
      setHistory([])
      return
    }
    if (!initialSaved.current) {
      const snap = rows.map(r => ({ ...r }))
      setHistory([{ rows: snap, timestamp: new Date() }])
      lastSnapshotJson.current = JSON.stringify(snap)
      initialSaved.current = true
    }
  }, [rows.length]) // intentional: only react to count changes, not cell edits

  useEffect(() => {
    if (!fullscreen) return
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false) }
    document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [fullscreen])

  if (rows.length === 0) return null

  const pushSnapshot = (targetRows?: InvoiceRow[]) => {
    const target = targetRows ?? rows
    const json = JSON.stringify(target)
    if (json === lastSnapshotJson.current) return
    lastSnapshotJson.current = json
    setHistory(prev => [...prev, { rows: target.map(r => ({ ...r })), timestamp: new Date() }])
  }

  const updateCell = (rowIdx: number, col: keyof InvoiceRow, value: string) => {
    onUpdate(rows.map((r, i) => (i === rowIdx ? { ...r, [col]: value } : r)))
  }

  const deleteRow = (idx: number) => {
    pushSnapshot()
    onUpdate(rows.filter((_, i) => i !== idx))
  }

  const handleCellClick = (rowIdx: number, col: keyof InvoiceRow) => {
    pushSnapshot()
    setEditCell({ row: rowIdx, col })
  }

  const restoreVersion = (snap: Snapshot) => {
    const changedRows = new Set<number>()
    const changedCells = new Set<string>()
    snap.rows.forEach((snapRow, i) => {
      const curr = rows[i]
      for (const col of INVOICE_COLUMNS) {
        const before = String(curr?.[col.key] ?? '')
        const after  = String(snapRow[col.key] ?? '')
        if (before !== after) {
          changedRows.add(i)
          changedCells.add(`${i}:${col.key}`)
        }
      }
    })
    setHighlightedRows(changedRows)
    setHighlightedCells(changedCells)
    onUpdate(snap.rows.map(r => ({ ...r })))
    if (highlightTimer.current) clearTimeout(highlightTimer.current)
    highlightTimer.current = setTimeout(() => {
      setHighlightedRows(new Set())
      setHighlightedCells(new Set())
    }, 3000)
  }

  const clearHistory = () => {
    // Always keep history[0] (the original extraction) so the user can always revert to it
    const original = history.length > 0 ? history[0] : { rows: rows.map(r => ({ ...r })), timestamp: new Date() }
    setHistory([original])
    // Reset to original's JSON so the next edit properly creates a new checkpoint
    lastSnapshotJson.current = JSON.stringify(original.rows)
  }

  const fmt = (d: Date) =>
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  const tableWrapClass = fullscreen
    ? 'flex-1 min-w-0 overflow-auto'
    : showHistory
      ? 'table-container flex-1 min-w-0'
      : 'table-container'

  return (
    <div className={fullscreen
      ? 'fixed inset-0 z-50 bg-background flex flex-col'
      : 'card overflow-hidden animate-slide-up'
    }>
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
        <h2 className="text-sm font-medium text-foreground">
          Extracted Data
          <span className="ml-2 text-xs text-muted-foreground font-normal">— click any cell to edit</span>
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{rows.length} rows · 22 columns</span>

          {/* Version history toggle */}
          {history.length > 0 && (
            <button
              onClick={() => setShowHistory(v => !v)}
              title="Version history"
              className={`p-1.5 rounded hover:bg-muted transition-colors flex items-center gap-1 ${
                showHistory ? 'text-primary bg-muted/60' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                <path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z" />
              </svg>
              <span className="text-xs font-medium">{history.length}</span>
            </button>
          )}

          {/* Fullscreen toggle */}
          <button
            onClick={() => setFullscreen(v => !v)}
            title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            {fullscreen ? (
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Body: table + optional history sidebar */}
      <div className={`flex ${fullscreen ? 'flex-1 overflow-hidden' : ''}`}>
        <div className={tableWrapClass}>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-google-blue-light">
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground border-b border-border whitespace-nowrap w-10" />
                {INVOICE_COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className="px-3 py-2.5 text-left font-medium text-muted-foreground border-b border-border whitespace-nowrap"
                    style={{ minWidth: col.width }}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIdx) => (
                <tr
                  key={rowIdx}
                  className={`border-b border-border transition-colors duration-700 group ${
                    highlightedRows.has(rowIdx)
                      ? 'bg-amber-50 dark:bg-amber-950/30'
                      : 'hover:bg-muted/40'
                  }`}
                >
                  <td className="px-2 py-1.5 text-center">
                    <button
                      type="button"
                      aria-label={`Delete row ${rowIdx + 1}`}
                      onClick={() => setConfirmDeleteRow(rowIdx)}
                      className="w-5 h-5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary flex items-center justify-center"
                      title="Delete row"
                    >
                      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                      </svg>
                    </button>
                  </td>

                  {INVOICE_COLUMNS.map((col) => {
                    const isEditing   = editCell?.row === rowIdx && editCell?.col === col.key
                    const isCellDiff  = highlightedCells.has(`${rowIdx}:${col.key}`)
                    const value = String(row[col.key] ?? '')
                    return (
                      <td
                        key={col.key}
                        className={`px-1.5 py-1 transition-colors duration-700 ${
                          isEditing  ? 'bg-google-blue-light ring-1 ring-google-blue ring-inset rounded' :
                          isCellDiff ? 'bg-amber-200 dark:bg-amber-800/60' : ''
                        }`}
                        onClick={() => handleCellClick(rowIdx, col.key)}
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            className="input-cell"
                            value={value}
                            onChange={(e) => updateCell(rowIdx, col.key, e.target.value)}
                            onBlur={(e) => {
                              const finalRows = rows.map((r, i) => i === rowIdx ? { ...r, [col.key]: e.target.value } : r)
                              pushSnapshot(finalRows)
                              setEditCell(null)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const finalRows = rows.map((r, i) => i === rowIdx ? { ...r, [col.key]: e.currentTarget.value } : r)
                                pushSnapshot(finalRows)
                                setEditCell(null)
                              }
                              if (e.key === 'Escape') setEditCell(null)
                            }}
                            style={{ minWidth: col.width - 12 }}
                          />
                        ) : (
                          <span
                            className={`block truncate px-1 py-0.5 rounded cursor-text ${
                              !value
                                ? 'text-placeholder italic'
                                : MONEY_COLS.has(col.key) && isBadNumeric(value)
                                  ? 'text-destructive'
                                  : 'text-foreground'
                            }`}
                            style={{ maxWidth: col.width - 12 }}
                            title={MONEY_COLS.has(col.key) && isBadNumeric(value) ? 'ไม่ใช่ตัวเลข' : value}
                          >
                            {value || '—'}
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Version history sidebar */}
        {showHistory && (
          <div className={`w-48 shrink-0 border-l border-border overflow-y-auto bg-background flex flex-col ${fullscreen ? '' : 'max-h-[60vh]'}`}>
            <div className="px-3 py-2.5 border-b border-border flex items-center justify-between shrink-0">
              <span className="text-xs font-semibold text-foreground">History</span>
              <button
                onClick={() => setConfirmClearHistory(true)}
                className="text-xs text-muted-foreground hover:text-destructive transition-colors"
              >
                Clear
              </button>
            </div>

            <div className="flex flex-col">
              {/* Current state — not clickable */}
              <div className="px-3 py-2.5 border-b border-border bg-primary/5">
                <div className="text-xs font-bold text-primary">Current</div>
                <div className="text-xs text-muted-foreground mt-0.5">{rows.length} rows</div>
              </div>

              {/* Past snapshots — newest first, each clickable to restore */}
              {[...history].reverse().map((snap, i) => {
                const isOriginal = i === history.length - 1
                return (
                  <button
                    key={i}
                    onClick={() => restoreVersion(snap)}
                    className="px-3 py-2.5 text-left border-b border-border hover:bg-muted transition-colors flex flex-col gap-0.5 w-full"
                  >
                    <span className="text-xs text-foreground">
                      {isOriginal ? 'Original extraction' : fmt(snap.timestamp)}
                    </span>
                    <span className="text-xs text-muted-foreground">{snap.rows.length} rows</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDeleteRow !== null}
        title="Delete this row?"
        message="This removes the row from the extracted data. You can undo via version history."
        confirmLabel="Delete"
        onConfirm={() => {
          if (confirmDeleteRow !== null) deleteRow(confirmDeleteRow)
          setConfirmDeleteRow(null)
        }}
        onCancel={() => setConfirmDeleteRow(null)}
      />

      <ConfirmDialog
        open={confirmClearHistory}
        title="Clear version history?"
        message="The original extraction is kept; intermediate checkpoints are removed."
        confirmLabel="Clear"
        onConfirm={() => { clearHistory(); setConfirmClearHistory(false) }}
        onCancel={() => setConfirmClearHistory(false)}
      />
    </div>
  )
}
