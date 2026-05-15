import { useState, useEffect, useCallback, useRef } from 'react'
import * as XLSX from 'xlsx'

export interface CustomerRow {
  id: string
  store_name: string
  customergroup: string
  customercode: string
  taxid: string
}

// ── Local types ───────────────────────────────────────────────────────────────
type ChangeType = 'add' | 'delete' | 'edit'
interface Change {
  type: ChangeType
  row?: CustomerRow
  key?: string
  before?: Partial<CustomerRow>
  after?: Partial<CustomerRow>
}
export interface Version {
  id: string
  timestamp: string
  label: string
  added: number
  deleted: number
  modified: number
  changes: Change[]
  snapshot: CustomerRow[]
}

// ── localStorage keys ─────────────────────────────────────────────────────────
const LS_ROWS    = 'armt_cm_rows'
const LS_HISTORY = 'armt_cm_history'
const LS_VER     = 'armt_cm_ver'
const SCHEMA_VER = '3'

// ── Seed data ─────────────────────────────────────────────────────────────────
const SEED: Omit<CustomerRow, 'id'>[] = [
  { store_name: 'ซีพี แอ็กซ์ตร้า', customergroup: '04 - ซีพี แอ็กซ์ตร้า(Makro)', customercode: '0118808 - บริษัท ซีพี แอ็กซ์ตร้า จำกัด (มหาชน) สำนักงานใหญ่', taxid: '0107567000414' },
  { store_name: 'ซีพี แอ็กซ์ตร้า', customergroup: '05 - โลตัส', customercode: '0118866 - บริษัท ซีพี แอ็กซ์ตร้า จำกัด (มหาชน) สำนักงานใหญ่', taxid: '0107567000414' },
  { store_name: 'บิ๊กซี 00000', customergroup: '06 - บิ๊กซี', customercode: '0102856-บมจ.บิ๊กซีซูเปอร์เซ็นเตอร์ จำกัด (มหาชน) สำนักงานใหญ่', taxid: '0107536000633' },
  { store_name: 'บิ๊กซี สาขาที่02043', customergroup: '06 - บิ๊กซี', customercode: '3073539 - บมจ.บิ๊กซี ซูเปอร์เซ็นเตอร์ (ศูนย์กระจายสินค้าบางปะอิน) สาขาที่02043', taxid: '0107536000633' },
  { store_name: 'บิ๊กซี (คลังธัญบุรี) สาขาที่00485', customergroup: '06 - บิ๊กซี', customercode: '0114556 - บมจ.บิ๊กซีซูเปอร์เซ็นเตอร์(คลังธัญบุรี) สาขาที่00485', taxid: '0107536000633' },
  { store_name: 'บิ๊กซี (คลังครอสด็อคธัญบุรี) สาขาที่00485', customergroup: '06 - บิ๊กซี', customercode: '0115526 - บมจ.บิ๊กซีซูเปอร์เซ็นเตอร์(คลังครอสด็อคธัญบุรี) สาขาที่00485', taxid: '0107536000633' },
  { store_name: 'บิ๊กซี สาขาที่00528', customergroup: '06 - บิ๊กซี', customercode: '3101168 - บมจ.บิ๊กซี ซูเปอร์เซ็นเตอร์ (ศูนย์กระจายสินค้าฉะเชิงเทรา)สาขาที่00528', taxid: '0107536000633' },
  { store_name: 'ซีพี ออลล์', customergroup: '07 - เซเว่นอีเลฟเว่น (7-11)', customercode: '0201553 - บริษัท ซีพี ออลล์ จำกัด (มหาชน) สำนักงานใหญ่', taxid: '0107542000011' },
  { store_name: 'เดอะมอลล์ สำนักงานใหญ่', customergroup: '09 - เดอะมอลล์', customercode: '0204754 - บริษัท เดอะมอลล์ กรุ๊ป จำกัด สำนักงานใหญ่', taxid: '0105523009350' },
  { store_name: 'เดอะมอลล์ สาขาที่00004', customergroup: '09 - เดอะมอลล์', customercode: '0208640 - บริษัท เดอะมอลล์ กรุ๊ป จำกัด สาขาที่00004', taxid: '0105523009350' },
  { store_name: 'เดอะมอลล์ สาขาที่00005', customergroup: '09 - เดอะมอลล์', customercode: '0115555 - บริษัท เดอะมอลล์กรุ๊ป จำกัด สาขาที่00005', taxid: '0105523009350' },
  { store_name: 'เดอะมอลล์ สาขาที่00006', customergroup: '09 - เดอะมอลล์', customercode: '0115542 - บริษัท เดอะมอลล์กรุ๊ป จำกัด สาขาที่00006', taxid: '0105523009350' },
  { store_name: 'เดอะมอลล์ สาขาที่00007', customergroup: '09 - เดอะมอลล์', customercode: '0207049 - บริษัท เดอะมอลล์ กรุ๊ป จำกัด สาขาที่00007', taxid: '0105523009350' },
  { store_name: 'เดอะมอลล์ สาขาที่00009', customergroup: '09 - เดอะมอลล์', customercode: '0114572 - บริษัท เดอะมอลล์ กรุ๊ป จำกัด สาขาที่00009', taxid: '0105523009350' },
  { store_name: 'เดอะมอลล์ สาขาที่00010', customergroup: '09 - เดอะมอลล์', customercode: '3230686 - บริษัท เดอะมอลล์ กรุ๊ป จำกัด สาขาที่00010', taxid: '0105523009350' },
  { store_name: 'เดอะมอลล์ สาขาที่00011', customergroup: '09 - เดอะมอลล์', customercode: '0115241 - บริษัท เดอะมอลล์ กรุ๊ป จำกัด สาขาที่00011', taxid: '0105523009350' },
  { store_name: 'เดอะมอลล์ สาขาที่00013', customergroup: '09 - เดอะมอลล์', customercode: '0115720 - บริษัท เดอะมอลล์ กรุ๊ป จำกัด สาขาที่00013', taxid: '0105523009350' },
  { store_name: 'เดอะมอลล์ สาขาที่00014', customergroup: '09 - เดอะมอลล์', customercode: '0115788 - บริษัท เดอะมอลล์ กรุ๊ป จำกัด สาขาที่00014', taxid: '0105523009350' },
  { store_name: 'ซิตี้มอลล์ สำนักงานใหญ่', customergroup: '09 - เดอะมอลล์', customercode: '0092128 - บริษัท ซิตี้มอลล์ กรุ๊ป จำกัด สำนักงานใหญ่', taxid: '0105540016253' },
  { store_name: 'ซิตี้มอลล์ สาขาที่ 00001', customergroup: '09 - เดอะมอลล์', customercode: '0114682 - บริษัท ซิตี้มอลล์ กรุ๊ป จำกัด สาขาที่ 00001', taxid: '0105540016253' },
  { store_name: 'ซิตี้มอลล์ สาขาที่00002', customergroup: '09 - เดอะมอลล์', customercode: '0118714 - บริษัท ซิตี้มอลล์ กรุ๊ป จำกัด สาขาที่00002', taxid: '0105540016253' },
  { store_name: 'สยามพารากอน สำนักงานใหญ่', customergroup: '09 - เดอะมอลล์', customercode: '0056119 - บริษัท สยามพารากอน รีเทล จำกัด สำนักงานใหญ่', taxid: '0105544113032' },
  { store_name: 'เอ็มโพเรี่ยม สำนักงานใหญ่', customergroup: '09 - เดอะมอลล์', customercode: '0063623 - บริษัท เอ็มโพเรี่ยม ฟู้ด แกลเลอรี่ จำกัด สำนักงานใหญ่', taxid: '0105548110704' },
  { store_name: 'พรอมานาด สำนักงานใหญ่', customergroup: '09 - เดอะมอลล์', customercode: '0113557 - บริษัท พรอมานาด โฮมเฟรชมาร์ท จำกัด สำนักงานใหญ่', taxid: '0105554112080' },
  { store_name: 'เดอะมอลล์ราชสีมา สำนักงานใหญ่', customergroup: '09 - เดอะมอลล์', customercode: '4144247 - บริษัท เดอะมอลล์ราชสีมา จำกัด สำนักงานใหญ่', taxid: '0305540000746' },
  { store_name: 'อิออน', customergroup: '10 - อิออน (MaxValu)', customercode: '0207036 - บริษัท อิออน (ไทยแลนด์) จำกัด สำนักงานใหญ่', taxid: '0105527044125' },
  { store_name: 'เซ็นทรัลฟู้ด มินิมาร์เก็ต', customergroup: '11 - เซ็นทรัล ฟู้ด มินิมาร์เก็ต', customercode: '0114886 - บริษัท เซ็นทรัล ฟู้ด มินิมาร์เก็ต จำกัด สำนักงานใหญ่', taxid: '0105535133093' },
  { store_name: 'เซ็นทรัลฟู้ด รีเทล', customergroup: '13 - ท๊อปส์ซุปเปอร์มาร์เก็ต', customercode: '3230217 - บริษัท เซ็นทรัล ฟู้ด รีเทล จำกัด', taxid: '0105535134278' },
  { store_name: 'เซ็นทรัลและมัทสึโมโตะ', customergroup: '13 - ท๊อปส์ซุปเปอร์มาร์เก็ต', customercode: '0115953 - บริษัท เซ็นทรัล และ มัทสึโมโตะ คิโยชิ จำกัด สาขา ดีซี สาขาที่00036', taxid: '0125558018410' },
  { store_name: 'ฟู้ดแลนด์', customergroup: '14 - ฟู้ดแลนด์', customercode: '0200897 - บ.ฟู้ดแลนด์ซุปเปอร์มาร์เก็ต จก. สำนักงานใหญ่', taxid: '0105515004549' },
  { store_name: 'วัตสัน', customergroup: '17 - วัตสัน', customercode: '0301152 - บริษัท เซ็นทรัล วัตสัน จำกัด สำนักงานใหญ่', taxid: '0105539086260' },
  { store_name: 'บู๊ทส์ รีเทล', customergroup: '19 - บู๊ทส์ รีเทล', customercode: '0301958 - บ.บู๊ทส์ รีเทล (ประเทศไทย) จก. สำนักงานใหญ่', taxid: '0115539007084' },
  { store_name: 'ปตท', customergroup: '25 - ปตท (Jiffy)', customercode: '0051460 - บริษัท ปตท. บริหารธุรกิจค้าปลีก จำกัด สำนักงานใหญ่', taxid: '0105537121254' },
  { store_name: 'ซูรูฮะ', customergroup: '46 - ซูรูฮะ', customercode: '0113748 - บริษัท ซูรูฮะ(ประเทศไทย) จำกัด สำนักงานใหญ่', taxid: '0105554157903' },
  { store_name: 'ซี.เจ. เอ็กซ์เพรส', customergroup: '47 - ซี.เจ.เอ็กซ์เพรส', customercode: '0076746 - บริษัท ซี.เจ. เอ็กซ์เพรส กรุ๊ป จำกัด สำนักงานใหญ่', taxid: '0105556055491' },
  { store_name: 'บิ๊กซี ฟู๊ด', customergroup: '68 - เอ็มเอ็ม เมก้า มาร์เก็ต', customercode: '0116224 - บริษัท บิ๊กซี ฟู๊ด เซอร์วิส จำกัด สำนักงานใหญ่', taxid: '0107536000633' },
  { store_name: 'ปิโตรเลียมไทย', customergroup: '69 - แมกซ์มาร์ท', customercode: '0086901 - บริษัท ปิโตรเลียมไทยคอร์ปอเรชั่น จำกัด สำนักงานใหญ่', taxid: '0105535099511' },
  { store_name: 'เซ็นทรัลฟู้ด โฮลเซลล์', customergroup: '80 - เซ็นทรัลฟู้ดโฮลเซล', customercode: '0118701 - บริษัท เซ็นทรัล ฟู้ด โฮลเซลล์ จำกัด สำนักงานใหญ่', taxid: '0125565034662' },
  { store_name: 'โฮมโปร', customergroup: '82 - โฮมโปร', customercode: '0114242 - บริษัท โฮม โปรดักส์ เซ็นเตอร์ จำกัด (มหาชน) สำนักงานใหญ่', taxid: '0107544000043' },
  { store_name: 'บิวเทรี่ยม', customergroup: '84 - บิวเทรี่ยม', customercode: '0119056 - บริษัท บิวเทรี่ยม จำกัด สำนักงานใหญ่', taxid: '0105555002130' },
  { store_name: 'ไทยฟู้ดส์เฟรซมาร์เก็ต', customergroup: '86 - ไทยฟู้ดส์เฟรซมาร์เก็ต', customercode: '0089128 - บริษัท ไทย ฟู้ดส์ เฟรซ มาร์เก็ต จำกัด สำนักงานใหญ่', taxid: '0105563089753' },
  { store_name: 'วิลล่า', customergroup: '97 - วิลล่า', customercode: '0202031 - บ.วิลล่ามาร์เก็ท เจพี จก. สำนักงานใหญ่', taxid: '0105531013646' },
]

function seedWithIds(): CustomerRow[] {
  return SEED.map((r, i) => ({ ...r, id: `seed-${i}` }))
}

function diff(before: CustomerRow[], after: CustomerRow[]): Change[] {
  const changes: Change[] = []
  const bMap = new Map(before.map(r => [r.id, r]))
  const aMap = new Map(after.map(r => [r.id, r]))
  for (const [id, r] of bMap) {
    if (!aMap.has(id)) {
      changes.push({ type: 'delete', row: r })
    } else {
      const a = aMap.get(id)!
      const bFields: Partial<CustomerRow> = {}
      const aFields: Partial<CustomerRow> = {}
      for (const f of ['store_name', 'customergroup', 'customercode', 'taxid'] as const) {
        if (r[f] !== a[f]) { bFields[f] = r[f]; aFields[f] = a[f] }
      }
      if (Object.keys(aFields).length) changes.push({ type: 'edit', key: id, before: bFields, after: aFields })
    }
  }
  for (const [id, r] of aMap) {
    if (!bMap.has(id)) changes.push({ type: 'add', row: r })
  }
  return changes
}

function lsGetRows(): CustomerRow[] | null {
  try { return JSON.parse(localStorage.getItem(LS_ROWS) || 'null') } catch { return null }
}
function lsGetHistory(): Version[] {
  try { return JSON.parse(localStorage.getItem(LS_HISTORY) || '[]') } catch { return [] }
}

// ── Exported helper so App.tsx can pass CM to extract ────────────────────────
export function getCustomerMasterRows(): CustomerRow[] {
  return lsGetRows() || seedWithIds()
}

const COLS: { key: keyof CustomerRow; label: string; width: number }[] = [
  { key: 'store_name',    label: 'ชื่อร้านค้า',      width: 220 },
  { key: 'customergroup', label: 'customergroup',     width: 260 },
  { key: 'customercode',  label: 'customercode',      width: 380 },
  { key: 'taxid',         label: 'taxid',             width: 150 },
]

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function CustomerMasterPage() {
  const [rows, setRows]         = useState<CustomerRow[]>([])
  const [history, setHistory]   = useState<Version[]>([])
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [dirty, setDirty]       = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null)
  const [editCell, setEditCell] = useState<{ row: number; col: keyof CustomerRow } | null>(null)
  const [editValue, setEditValue] = useState('')
  const [toast, setToast]       = useState<{ msg: string; ok: boolean } | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

  // ── load from localStorage ────────────────────────────────────────────────
  useEffect(() => {
    // Migration: reset to seed data and clear broken history
    if (localStorage.getItem(LS_VER) !== SCHEMA_VER) {
      localStorage.removeItem(LS_ROWS)
      localStorage.removeItem(LS_HISTORY)
      localStorage.setItem(LS_VER, SCHEMA_VER)
    }
    const saved = lsGetRows()
    if (saved) {
      setRows(saved)
    } else {
      const seedRows = seedWithIds()
      localStorage.setItem(LS_ROWS, JSON.stringify(seedRows))
      setRows(seedRows)
    }
    setHistory(lsGetHistory())
    setLoading(false)
  }, [])

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  // ── save to localStorage ──────────────────────────────────────────────────
  const save = useCallback(() => {
    const finalRows = editCell
      ? rows.map((r, i) => i === editCell.row ? { ...r, [editCell.col]: editValue } : r)
      : rows
    if (editCell) setEditCell(null)

    setSaving(true)
    try {
      const prevRows = lsGetRows() || []
      const changes = diff(prevRows, finalRows)
      const version: Version = {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        label: 'Web edit',
        added:    changes.filter(c => c.type === 'add').length,
        deleted:  changes.filter(c => c.type === 'delete').length,
        modified: changes.filter(c => c.type === 'edit').length,
        changes,
        // snapshot = state BEFORE this save so Restore undoes it
        snapshot: prevRows.length > 0 ? prevRows : finalRows,
      }
      const newHistory = [version, ...history].slice(0, 50)
      localStorage.setItem(LS_ROWS, JSON.stringify(finalRows))
      localStorage.setItem(LS_HISTORY, JSON.stringify(newHistory))
      setRows(finalRows)
      setHistory(newHistory)
      setDirty(false)
      showToast('Saved successfully')
    } catch (e) {
      showToast((e as Error).message || 'Save failed', false)
    } finally {
      setSaving(false)
    }
  }, [rows, editCell, editValue, history])

  // ── restore from version ──────────────────────────────────────────────────
  const restore = useCallback((id: string) => {
    const version = history.find(v => v.id === id)
    if (!version) return

    if (!version.snapshot || version.snapshot.length === 0) {
      showToast('Cannot restore: this version has no data snapshot', false)
      return
    }

    localStorage.setItem(LS_ROWS, JSON.stringify(version.snapshot))
    setRows(version.snapshot)
    setDirty(false)
    showToast(`Restored: ${version.snapshot.length} rows`)
  }, [history])

  // ── cell edit ─────────────────────────────────────────────────────────────
  const startEdit = (rowIdx: number, col: keyof CustomerRow) => {
    if (col === 'id') return
    setEditCell({ row: rowIdx, col })
    setEditValue(rows[rowIdx][col] as string)
  }

  const commitEdit = () => {
    if (!editCell) return
    setRows(prev => prev.map((r, i) =>
      i === editCell.row ? { ...r, [editCell.col]: editValue } : r
    ))
    setDirty(true)
    setEditCell(null)
  }

  const addRow = () => {
    const newRow: CustomerRow = { id: `new-${Date.now()}`, store_name: '', customergroup: '', customercode: '', taxid: '' }
    setRows(prev => [...prev, newRow])
    setDirty(true)
    setTimeout(() => startEdit(rows.length, 'store_name'), 0)
  }

  const deleteRow = (idx: number) => {
    setRows(prev => prev.filter((_, i) => i !== idx))
    setDirty(true)
  }

  // ── import Excel ──────────────────────────────────────────────────────────
  const importExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const wb = XLSX.read(ev.target?.result, { type: 'binary' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const raw: Record<string, string>[] = XLSX.utils.sheet_to_json(ws, { defval: '' })
      const imported: CustomerRow[] = raw.map((r, i) => ({
        id: `import-${Date.now()}-${i}`,
        store_name:    String(r['ชื่อร้านค้า'] || r['store_name'] || '').trim(),
        customergroup: String(r['customergroup'] || '').trim(),
        customercode:  String(r['customercode'] || '').trim(),
        taxid:         String(r['taxid'] || '').trim(),
      })).filter(r => r.store_name || r.taxid)
      if (imported.length === 0) { showToast('No valid rows found in file', false); return }

      // Auto-save with version entry
      const prevRows = lsGetRows() || []
      const changes = diff(prevRows, imported)
      const version: Version = {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        label: `Imported from Excel (${imported.length} rows)`,
        added:    changes.filter(c => c.type === 'add').length,
        deleted:  changes.filter(c => c.type === 'delete').length,
        modified: changes.filter(c => c.type === 'edit').length,
        changes,
        // snapshot = state BEFORE import so Restore undoes the import
        snapshot: prevRows.length > 0 ? prevRows : imported,
      }
      const newHistory = [version, ...lsGetHistory()].slice(0, 50)
      localStorage.setItem(LS_ROWS, JSON.stringify(imported))
      localStorage.setItem(LS_HISTORY, JSON.stringify(newHistory))
      setRows(imported)
      setHistory(newHistory)
      setDirty(false)
      showToast(`Imported ${imported.length} rows`)
    }
    reader.readAsBinaryString(file)
    e.target.value = ''
  }

  // ── export Excel ──────────────────────────────────────────────────────────
  const exportExcel = () => {
    const data = rows.map(r => ({ 'ชื่อร้านค้า': r.store_name, customergroup: r.customergroup, customercode: r.customercode, taxid: r.taxid }))
    const ws = XLSX.utils.json_to_sheet(data)
    ws['!cols'] = [{ wch: 35 }, { wch: 40 }, { wch: 70 }, { wch: 16 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Customer Master')
    XLSX.writeFile(wb, 'Customer_Master.xlsx')

    // Log export to history
    const currentRows = lsGetRows() || rows
    const version: Version = {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      label: `Exported to Excel (${rows.length} rows)`,
      added: 0, deleted: 0, modified: 0,
      changes: [],
      snapshot: currentRows,
    }
    const newHistory = [version, ...history].slice(0, 50)
    localStorage.setItem(LS_HISTORY, JSON.stringify(newHistory))
    setHistory(newHistory)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 text-sm">
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-google-blue animate-spin-slow mr-2">
          <path d="M12 4V2C6.48 2 2 6.48 2 12h2c0-4.42 3.58-8 8-8z" />
        </svg>
        Loading…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in">

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div className="card px-5 py-3 flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-gray-700 mr-auto">
          Customer Master
          <span className="ml-2 text-xs text-gray-400 font-normal">{rows.length} rows</span>
          {dirty && <span className="ml-2 text-xs text-google-blue font-normal">● unsaved</span>}
        </span>

        <label className="btn-secondary cursor-pointer text-xs">
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
          Import Excel
          <input ref={importRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={importExcel} />
        </label>

        <button className="btn-secondary text-xs" onClick={exportExcel}>
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" /></svg>
          Export Excel
        </button>

        <button className="btn-secondary text-xs" onClick={() => setShowHistory(v => !v)}>
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current"><path d="M13 3a9 9 0 1 0 9 9h-2a7 7 0 1 1-7-7v4l5-5-5-5v4z" /></svg>
          History {history.length > 0 && <span className="ml-1 bg-google-blue text-white rounded-full px-1.5 py-0 text-[10px]">{history.length}</span>}
        </button>

        <button className="btn-primary text-xs" onClick={save} disabled={saving || !dirty}>
          {saving
            ? <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current animate-spin-slow"><path d="M12 4V2C6.48 2 2 6.48 2 12h2c0-4.42 3.58-8 8-8z" /></svg>
            : <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current"><path d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z" /></svg>
          }
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="flex gap-4 items-start">

        {/* ── Table ──────────────────────────────────────────────────────────── */}
        <div className="card overflow-hidden flex-1 min-w-0">
          <div className="table-container">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-google-blue-light">
                  <th className="px-2 py-2.5 text-left font-medium text-gray-500 border-b border-gray-200 w-8 text-center">#</th>
                  {COLS.map(c => (
                    <th key={c.key as string} className="px-3 py-2.5 text-left font-medium text-gray-600 border-b border-gray-200 whitespace-nowrap" style={{ minWidth: c.width }}>
                      {c.label}
                    </th>
                  ))}
                  <th className="px-2 py-2.5 border-b border-gray-200 w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors group">
                    <td className="px-2 py-1 text-center text-gray-400">{ri + 1}</td>
                    {COLS.map(c => {
                      const isEditing = editCell?.row === ri && editCell?.col === c.key
                      const val = row[c.key] as string
                      return (
                        <td
                          key={c.key as string}
                          className={`px-1.5 py-1 cursor-text ${isEditing ? 'bg-google-blue-light ring-1 ring-google-blue ring-inset rounded' : ''}`}
                          onClick={() => !isEditing && startEdit(ri, c.key)}
                        >
                          {isEditing ? (
                            <input
                              autoFocus
                              className="input-cell"
                              value={editValue}
                              style={{ minWidth: c.width - 16 }}
                              onChange={e => setEditValue(e.target.value)}
                              onBlur={commitEdit}
                              onKeyDown={e => {
                                if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commitEdit() }
                                if (e.key === 'Escape') setEditCell(null)
                              }}
                            />
                          ) : (
                            <span
                              className={`block truncate px-1 py-0.5 rounded ${val ? 'text-gray-800' : 'text-gray-300 italic'}`}
                              style={{ maxWidth: c.width - 16 }}
                              title={val}
                            >
                              {val || '—'}
                            </span>
                          )}
                        </td>
                      )
                    })}
                    <td className="px-2 py-1 text-center">
                      <button
                        onClick={() => deleteRow(ri)}
                        className="w-5 h-5 rounded text-gray-300 hover:text-google-red hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 flex items-center justify-center"
                        title="Delete row"
                      >
                        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-gray-100">
            <button className="flex items-center gap-1.5 text-xs text-google-blue hover:text-google-blue-dark transition-colors" onClick={addRow}>
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
              Add row
            </button>
          </div>
        </div>

        {/* ── History Panel ─────────────────────────────────────────────────── */}
        {showHistory && (
          <div className="card w-80 shrink-0 flex flex-col animate-slide-up">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Version History</span>
              <button onClick={() => setShowHistory(false)} className="text-gray-400 hover:text-gray-600">
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
              </button>
            </div>
            {history.length === 0 ? (
              <p className="px-4 py-6 text-xs text-gray-400 text-center">No saved versions yet</p>
            ) : (
              <div className="overflow-y-auto max-h-[calc(100vh-280px)]">
                {history.map(v => (
                  <div key={v.id} className="border-b border-gray-100 last:border-0">
                    <div
                      className="px-4 py-3 hover:bg-gray-50 cursor-pointer flex items-start justify-between gap-2"
                      onClick={() => setExpandedVersion(expandedVersion === v.id ? null : v.id)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-gray-700 truncate">{v.label}</div>
                        <div className="text-[11px] text-gray-400 mt-0.5">{fmtDate(v.timestamp)}</div>
                        <div className="flex gap-2 mt-1 flex-wrap">
                          {v.snapshot?.length > 0 && <span className="text-[11px] text-gray-500">{v.snapshot.length} rows</span>}
                          {v.added > 0   && <span className="text-[11px] text-google-green">+{v.added}</span>}
                          {v.deleted > 0 && <span className="text-[11px] text-google-red">-{v.deleted}</span>}
                          {v.modified > 0 && <span className="text-[11px] text-yellow-600">~{v.modified}</span>}
                          {v.added === 0 && v.deleted === 0 && v.modified === 0 && (!v.snapshot || v.snapshot.length === 0) &&
                            <span className="text-[11px] text-gray-400">no changes</span>}
                        </div>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); restore(v.id) }}
                        disabled={!v.snapshot || v.snapshot.length === 0}
                        title={v.snapshot?.length > 0 ? `Undo this save → restore ${v.snapshot.length} rows` : 'No snapshot available'}
                        className="shrink-0 text-[11px] text-google-blue hover:underline disabled:text-gray-300 disabled:cursor-not-allowed"
                      >
                        Undo
                      </button>
                    </div>
                    {expandedVersion === v.id && v.changes.length > 0 && (
                      <div className="px-4 pb-3 space-y-1">
                        {v.changes.map((c, ci) => (
                          <div key={ci} className={`text-[11px] rounded px-2 py-1 ${
                            c.type === 'add'    ? 'bg-green-50 text-green-700' :
                            c.type === 'delete' ? 'bg-red-50 text-red-700' :
                            'bg-yellow-50 text-yellow-700'
                          }`}>
                            {c.type === 'add'    && c.row && <span><b>+</b> {c.row.store_name || c.row.customercode}</span>}
                            {c.type === 'delete' && c.row && <span><b>−</b> {c.row.store_name || c.row.customercode}</span>}
                            {c.type === 'edit'   && c.after && <span><b>~</b> {Object.entries(c.after).map(([k, v]) => `${k}: "${v}"`).join(', ')}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Toast ──────────────────────────────────────────────────────────── */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-lg shadow-lg text-sm text-white transition-all ${toast.ok ? 'bg-google-green' : 'bg-google-red'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
