import { useState, useEffect } from 'react'
import type { InvoiceRow } from '@/types/invoice'
import { INVOICE_COLUMNS } from '@/types/invoice'

interface Props {
  rows: InvoiceRow[]
  onUpdate: (rows: InvoiceRow[]) => void
}

export default function ResultsTable({ rows, onUpdate }: Props) {
  const [editCell, setEditCell] = useState<{ row: number; col: keyof InvoiceRow } | null>(null)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    if (!fullscreen) return
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false) }
    document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [fullscreen])

  if (rows.length === 0) return null

  const updateCell = (rowIdx: number, col: keyof InvoiceRow, value: string) => {
    const updated = rows.map((r, i) => (i === rowIdx ? { ...r, [col]: value } : r))
    onUpdate(updated)
  }

  const deleteRow = (idx: number) => {
    onUpdate(rows.filter((_, i) => i !== idx))
  }

  return (
    <div className={fullscreen
      ? 'fixed inset-0 z-50 bg-background flex flex-col'
      : 'card overflow-hidden animate-slide-up'
    }>
      <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
        <h2 className="text-sm font-medium text-foreground">
          Extracted Data
          <span className="ml-2 text-xs text-muted-foreground font-normal">— click any cell to edit</span>
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{rows.length} rows · 22 columns</span>
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

      <div className={fullscreen ? 'flex-1 overflow-auto' : 'table-container'}>
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
                className="border-b border-border hover:bg-muted/40 transition-colors group"
              >
                {/* Delete button */}
                <td className="px-2 py-1.5 text-center">
                  <button
                    onClick={() => deleteRow(rowIdx)}
                    className="w-5 h-5 rounded text-muted-foreground/30 hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100 flex items-center justify-center"
                    title="Delete row"
                  >
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current">
                      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                    </svg>
                  </button>
                </td>

                {INVOICE_COLUMNS.map((col) => {
                  const isEditing = editCell?.row === rowIdx && editCell?.col === col.key
                  const value = String(row[col.key] ?? '')
                  return (
                    <td
                      key={col.key}
                      className={`px-1.5 py-1 ${isEditing ? 'bg-google-blue-light ring-1 ring-google-blue ring-inset rounded' : ''}`}
                      onClick={() => setEditCell({ row: rowIdx, col: col.key })}
                    >
                      {isEditing ? (
                        <input
                          autoFocus
                          className="input-cell"
                          value={value}
                          onChange={(e) => updateCell(rowIdx, col.key, e.target.value)}
                          onBlur={() => setEditCell(null)}
                          onKeyDown={(e) => e.key === 'Escape' && setEditCell(null)}
                          style={{ minWidth: col.width - 12 }}
                        />
                      ) : (
                        <span
                          className={`block truncate px-1 py-0.5 rounded cursor-text ${value ? 'text-foreground' : 'text-muted-foreground/40 italic'}`}
                          style={{ maxWidth: col.width - 12 }}
                          title={value}
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
    </div>
  )
}
