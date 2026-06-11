import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Spreadsheet-style keyboard navigation for an editable table.
 *
 * The hook owns ONLY the "active cell" (row index + column index) and the key
 * dispatch state machine. It is intentionally agnostic about how a given table
 * stores its edit value — the consumer wires the actual edit start / commit /
 * cancel through the callbacks below. This lets both ResultsTable (value lives
 * in the row data) and CustomerMasterPage (value lives in a separate editValue
 * state) share one navigation brain.
 *
 * Key model (only fires when the table container has focus and the event did
 * not originate from inside the editing <input> — see `onContainerKeyDown`):
 *  - Arrows: move active cell within bounds (no wrap).
 *  - Tab / Shift-Tab: move right / left, wrapping to next / previous row's
 *    first / last cell. At the very end (last cell, forward) or very start
 *    (first cell, backward) we let the browser move focus onward so the user is
 *    never trapped.
 *  - Enter: begin editing the active cell.
 *  - Printable character: begin editing, replacing the cell with that char.
 *  - (Commit-then-advance-down on Enter, and Esc-to-cancel, happen inside the
 *    input via `handleEditKeyDown` because the input owns the keystrokes while
 *    editing.)
 */

export interface ActiveCell {
  row: number
  col: number
}

interface GridNavOptions<K extends string> {
  /** Number of data rows. */
  rowCount: number
  /** Ordered column keys (left→right) as they appear in the table. */
  columns: readonly K[]
  /** Whether a cell is currently being edited (the input is mounted). */
  isEditing: boolean
  /** Begin editing the cell at (row, colKey). `initialChar` is set for type-to-edit. */
  onStartEdit: (row: number, colKey: K, initialChar?: string) => void
  /** Commit the current edit (called on Enter-while-editing, before advancing). */
  onCommit: () => void
  /** Cancel the current edit, leaving the cell active (Esc). */
  onCancel: () => void
  /** Optional: return false for columns that must not be edited. */
  isColumnEditable?: (colKey: K) => boolean
}

export function useGridNavigation<K extends string>(opts: GridNavOptions<K>) {
  const { rowCount, columns, isEditing, onStartEdit, onCommit, onCancel, isColumnEditable } = opts
  const colCount = columns.length

  const [active, setActive] = useState<ActiveCell | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Keep the latest values reachable from stable callbacks without re-binding.
  const latest = useRef({ rowCount, colCount, columns, isEditing, onStartEdit, onCommit, onCancel, isColumnEditable, active })
  latest.current = { rowCount, colCount, columns, isEditing, onStartEdit, onCommit, onCancel, isColumnEditable, active }

  // Clamp / clear the active cell if the data shrank under it.
  useEffect(() => {
    if (!active) return
    if (rowCount === 0) { setActive(null); return }
    if (active.row >= rowCount || active.col >= colCount) {
      setActive({ row: Math.min(active.row, rowCount - 1), col: Math.min(active.col, colCount - 1) })
    }
  }, [rowCount, colCount, active])

  const editable = useCallback((col: number) => {
    const fn = latest.current.isColumnEditable
    return fn ? fn(latest.current.columns[col]) : true
  }, [])

  // Move active cell to next editable column in `dir` (+1/-1) on the same row;
  // returns the new col or null if none in-bounds.
  const nextEditableCol = useCallback((from: number, dir: 1 | -1) => {
    let c = from + dir
    while (c >= 0 && c < latest.current.colCount) {
      if (editable(c)) return c
      c += dir
    }
    return null
  }, [editable])

  const scrollIntoView = useCallback((row: number, col: number) => {
    const el = containerRef.current?.querySelector<HTMLElement>(
      `[data-grid-cell="${row}-${col}"]`
    )
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [])

  const moveTo = useCallback((row: number, col: number) => {
    setActive({ row, col })
    // Defer so the cell exists / layout settled before scrolling.
    requestAnimationFrame(() => scrollIntoView(row, col))
  }, [scrollIntoView])

  /** Programmatic move used by consumers (e.g. commit-then-advance-down). */
  const moveDown = useCallback((from?: ActiveCell) => {
    const a = from ?? latest.current.active
    if (!a) return
    if (a.row + 1 < latest.current.rowCount) moveTo(a.row + 1, a.col)
    else moveTo(a.row, a.col) // stay; re-scroll
  }, [moveTo])

  const onContainerKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const L = latest.current
    // While editing, the <input> owns the keystrokes — do not hijack arrows etc.
    // (Enter/Esc/Tab while editing are handled by handleEditKeyDown on the input.)
    if (L.isEditing) return
    if (L.rowCount === 0 || L.colCount === 0) return

    // Initialise the active cell on first interaction with the table.
    const a = L.active ?? { row: 0, col: 0 }
    if (!L.active) { setActive(a) }

    const key = e.key

    switch (key) {
      case 'ArrowUp':
        e.preventDefault()
        if (a.row > 0) moveTo(a.row - 1, a.col)
        return
      case 'ArrowDown':
        e.preventDefault()
        if (a.row < L.rowCount - 1) moveTo(a.row + 1, a.col)
        return
      case 'ArrowLeft': {
        e.preventDefault()
        const c = nextEditableCol(a.col, -1)
        if (c !== null) moveTo(a.row, c)
        return
      }
      case 'ArrowRight': {
        e.preventDefault()
        const c = nextEditableCol(a.col, 1)
        if (c !== null) moveTo(a.row, c)
        return
      }
      case 'Tab': {
        const dir: 1 | -1 = e.shiftKey ? -1 : 1
        const c = nextEditableCol(a.col, dir)
        if (c !== null) {
          e.preventDefault()
          moveTo(a.row, c)
        } else {
          // Edge of the row → wrap to adjacent row, else let focus leave the table.
          if (dir === 1 && a.row < L.rowCount - 1) {
            const first = editable(0) ? 0 : nextEditableCol(0, 1)
            if (first !== null) { e.preventDefault(); moveTo(a.row + 1, first) }
          } else if (dir === -1 && a.row > 0) {
            const lastIdx = L.colCount - 1
            const last = editable(lastIdx) ? lastIdx : nextEditableCol(lastIdx, -1)
            if (last !== null) { e.preventDefault(); moveTo(a.row - 1, last) }
          }
          // else: do NOT preventDefault → browser moves focus out (no trap).
        }
        return
      }
      case 'Enter':
        e.preventDefault()
        if (editable(a.col)) L.onStartEdit(a.row, L.columns[a.col])
        return
      case 'Escape':
        // Not editing: blur the table so the user can escape keyboard mode.
        e.preventDefault()
        containerRef.current?.blur()
        return
      default:
        // Type-to-edit: a single printable char with no modifier begins editing.
        if (
          key.length === 1 &&
          !e.ctrlKey && !e.metaKey && !e.altKey &&
          editable(a.col)
        ) {
          e.preventDefault()
          L.onStartEdit(a.row, L.columns[a.col], key)
        }
        return
    }
  }, [moveTo, nextEditableCol, editable])

  /**
   * Key handler for the editing <input>. Returns true if it handled the event
   * (the consumer should then have committed/cancelled as appropriate).
   *
   *  - Enter: commit, then advance the active cell DOWN one row (data-entry loop).
   *  - Tab / Shift-Tab: commit, then move right / left (wrapping), keep editing? No —
   *    we move the active cell and the consumer decides; here we just move selection.
   *  - Escape: cancel, keep cell active. Refocus the container so nav continues.
   *  Arrows are intentionally NOT handled → they move the text caret inside the input.
   */
  const handleEditKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    const L = latest.current
    const a = L.active
    if (!a) return false

    if (e.key === 'Enter') {
      e.preventDefault()
      L.onCommit()
      // advance down (stay in column)
      if (a.row + 1 < L.rowCount) moveTo(a.row + 1, a.col)
      containerRef.current?.focus()
      return true
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      L.onCommit()
      const dir: 1 | -1 = e.shiftKey ? -1 : 1
      const c = nextEditableCol(a.col, dir)
      if (c !== null) moveTo(a.row, c)
      else if (dir === 1 && a.row + 1 < L.rowCount) {
        const first = editable(0) ? 0 : nextEditableCol(0, 1)
        if (first !== null) moveTo(a.row + 1, first)
      } else if (dir === -1 && a.row > 0) {
        const lastIdx = L.colCount - 1
        const last = editable(lastIdx) ? lastIdx : nextEditableCol(lastIdx, -1)
        if (last !== null) moveTo(a.row - 1, last)
      }
      containerRef.current?.focus()
      return true
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      L.onCancel()
      containerRef.current?.focus()
      return true
    }
    return false
  }, [moveTo, nextEditableCol, editable])

  return {
    /** Currently active (selected) cell, or null. */
    active,
    /** Imperatively set the active cell (e.g. on click). */
    setActive,
    /** Ref to attach to the focusable, scrollable table container. */
    containerRef,
    /** Attach to the container's onKeyDown. */
    onContainerKeyDown,
    /** Attach to the editing input's onKeyDown. */
    handleEditKeyDown,
    /** Move active cell down one (used after an external commit, if needed). */
    moveDown,
  }
}
