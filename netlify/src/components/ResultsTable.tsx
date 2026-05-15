import { useState } from 'react'
import type { InvoiceRow } from '@/types/invoice'
import { INVOICE_COLUMNS } from '@/types/invoice'

interface Props {
  rows: InvoiceRow[]
  onUpdate: (rows: InvoiceRow[]) => void
}

export default function ResultsTable({ rows, onUpdate }: Props) {
  const [editCell, setEditCell] = useState<{ row: number; col: keyof InvoiceRow } | null>(null)

  if (rows.length === 0) return null

  const updateCell = (rowIdx: number, col: keyof InvoiceRow, value: string) => {
    const updated = rows.map((r, i) => (i === rowIdx ? { ...r, [col]: value } : r))
    onUpdate(updated)
  }

  const deleteRow = (idx: number) => {
    onUpdate(rows.filter((_, i) => i !== idx))
  }

  return (
    <div className="card overflow-hidden animate-slide-up">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-700">
          Extracted Data
          <span className="ml-2 text-xs text-gray-400 font-normal">— click any cell to edit</span>
        </h2>
        <span className="text-xs text-gray-500">{rows.length} rows · 22 columns</span>
      </div>

      <div className="table-container">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-google-blue-light">
              <th className="px-3 py-2.5 text-left font-medium text-gray-600 border-b border-gray-200 whitespace-nowrap w-10" />
              {INVOICE_COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className="px-3 py-2.5 text-left font-medium text-gray-600 border-b border-gray-200 whitespace-nowrap"
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
                className="border-b border-gray-100 hover:bg-gray-50 transition-colors group"
              >
                {/* Delete button */}
                <td className="px-2 py-1.5 text-center">
                  <button
                    onClick={() => deleteRow(rowIdx)}
                    className="w-5 h-5 rounded text-gray-300 hover:text-google-red hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 flex items-center justify-center"
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
                          className={`block truncate px-1 py-0.5 rounded cursor-text ${value ? 'text-gray-800' : 'text-gray-300 italic'}`}
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
