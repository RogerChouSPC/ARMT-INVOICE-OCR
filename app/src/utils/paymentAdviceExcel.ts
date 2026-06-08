// Faithful port of the coworker's openpyxl workbook (P1 Makro PDF AR/app.py
// build_excel) to exceljs, generated client-side and downloaded. Produces the
// same 5 sheets with the same styling and match/mismatch reconciliation:
//   Payment Info · Invoice Details · Invoices (Flat) · Summary by Site · By Invoice Date
import ExcelJS from 'exceljs'
import type { PaymentAdviceFile, PaymentAdviceStore } from '@/types/paymentAdvice'

const CLR_DARK = '1F4E79'
const CLR_MID = '2E75B6'
const CLR_ALT = 'D6E4F0'
const CLR_TOTAL = 'FFF2CC'
const CLR_MATCH = 'D5F5E3'
const CLR_MISMATCH = 'FADBD8'
const CLR_WHITE = 'FFFFFF'
const CLR_GREEN = '1E8449'
const CLR_RED = 'C0392B'
const AMT_FMT = '#,##0.00'
const EXCEL_ROW_LIMIT = 1_000_000

const argb = (hex: string) => 'FF' + hex
type WS = ExcelJS.Worksheet

const r2 = (n: number) => Math.round(n * 100) / 100
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

function font(opts: { bold?: boolean; size?: number; color?: string } = {}) {
  return { name: 'Calibri', bold: !!opts.bold, size: opts.size ?? 10, color: { argb: argb(opts.color ?? '000000') } }
}
const hdrFont = (size = 10) => font({ bold: true, size, color: CLR_WHITE })
const fill = (hex: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } })
function align(h: 'left' | 'center' | 'right' = 'left', wrap = false): Partial<ExcelJS.Alignment> {
  return { horizontal: h, vertical: 'middle', wrapText: wrap }
}
function border(): Partial<ExcelJS.Borders> {
  const s = { style: 'thin' as const, color: { argb: argb('BBBBBB') } }
  return { top: s, left: s, bottom: s, right: s }
}

function setWidths(ws: WS, widths: Record<number, number>) {
  for (const [col, w] of Object.entries(widths)) ws.getColumn(Number(col)).width = w
}

/** Header row with bg fill + white bold + border + wrap. cols is 1-based labels. */
function writeHeader(ws: WS, rowIdx: number, cols: string[], bg = CLR_DARK, height = 26) {
  const row = ws.getRow(rowIdx)
  cols.forEach((text, i) => {
    const c = row.getCell(i + 1)
    c.value = text
    c.font = hdrFont()
    c.fill = fill(bg)
    c.alignment = align('center', true)
    c.border = border()
  })
  row.height = height
}

function freeze(ws: WS, rows: number) {
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: rows, showGridLines: false }]
}
function noGrid(ws: WS) {
  ws.views = [{ showGridLines: false }]
}

const calcXfer = (store: PaymentAdviceStore) => r2(sum(store.invoices.map((i) => i.transfer_amount)))

// ── Sheet 1: Payment Info ──
function sheetPaymentInfo(wb: ExcelJS.Workbook, files: PaymentAdviceFile[]) {
  const ws = wb.addWorksheet('Payment Info')
  noGrid(ws)
  ws.mergeCells('A1:H1')
  const t = ws.getCell('A1')
  t.value = 'CP Axtra PCL. — Payment Advice Summary'
  t.font = font({ bold: true, size: 14, color: CLR_WHITE })
  t.fill = fill(CLR_DARK)
  t.alignment = align('center')
  ws.getRow(1).height = 36

  writeHeader(ws, 2, ['#', 'Filename', 'Reference', 'Value Date', 'Bank Total (THB)',
    'Calc Total (THB)', 'Difference', 'Match', 'Sites', 'Invoices'], CLR_MID, 28)

  let grandBank = 0, grandCalc = 0, grandSites = 0, grandInv = 0
  const aligns: ('left' | 'center' | 'right')[] = ['center', 'left', 'center', 'center', 'right', 'right', 'right', 'center', 'center', 'center']

  files.forEach((f, idx0) => {
    const idx = idx0 + 1
    const rowIdx = idx + 2
    const calc = r2(sum(f.stores.map(calcXfer)))
    const diff = r2(calc - f.transferred_amount)
    const match = Math.abs(diff) < 0.01
    const alt = idx % 2 === 0
    const invCount = sum(f.stores.map((s) => s.invoices.length))
    const rowData: (string | number)[] = [idx, f.filename, f.reference, f.value_date,
      f.transferred_amount, calc, diff, match ? '✓  Match' : '✗  MISMATCH', f.stores.length, invCount]

    const row = ws.getRow(rowIdx)
    rowData.forEach((val, i) => {
      const col = i + 1
      const c = row.getCell(col)
      c.value = val
      c.font = font()
      c.alignment = align(aligns[i])
      c.border = border()
      if (alt) c.fill = fill(CLR_ALT)
      if (col === 5 || col === 6 || col === 7) c.numFmt = AMT_FMT
      if (col === 7) c.font = font({ bold: true, color: Math.abs(diff) < 0.01 ? CLR_GREEN : CLR_RED })
      if (col === 8) { c.fill = fill(match ? CLR_MATCH : CLR_MISMATCH); c.font = font({ bold: true, color: match ? CLR_GREEN : CLR_RED }) }
    })
    grandBank += f.transferred_amount; grandCalc += calc; grandSites += f.stores.length; grandInv += invCount
  })

  const tr = files.length + 3
  grandCalc = r2(grandCalc)
  const grandDiff = r2(grandCalc - grandBank)
  const grandMatch = Math.abs(grandDiff) < 0.01
  ws.mergeCells(`A${tr}:D${tr}`)
  const a = ws.getCell(`A${tr}`)
  a.value = `GRAND TOTAL — ${files.length} file(s)`
  a.font = hdrFont(11); a.fill = fill(CLR_DARK); a.alignment = align('center'); a.border = border()
  const grandCells: [number, string | number][] = [[5, grandBank], [6, grandCalc], [7, grandDiff],
    [8, grandMatch ? '✓  Match' : '✗  MISMATCH'], [9, grandSites], [10, grandInv]]
  for (const [col, val] of grandCells) {
    const c = ws.getRow(tr).getCell(col)
    c.value = val; c.font = hdrFont(11); c.fill = fill(CLR_DARK)
    c.alignment = align(col <= 7 ? 'right' : 'center'); c.border = border()
    if (col === 5 || col === 6 || col === 7) c.numFmt = AMT_FMT
  }
  setWidths(ws, { 1: 4, 2: 30, 3: 12, 4: 14, 5: 20, 6: 20, 7: 14, 8: 14, 9: 8, 10: 10 })
}

// ── Detail/Flat shared column spec (alignment, isAmount) ──
const DETAIL_SPEC: [('left' | 'center' | 'right'), boolean][] = [
  ['center', false], ['left', false], ['center', false], ['center', false], ['center', false],
  ['left', false], ['center', false], ['center', false], ['center', false], ['center', false],
  ['center', false], ['right', true], ['right', true], ['right', true],
]
const DETAIL_WIDTHS = { 1: 6, 2: 26, 3: 10, 4: 8, 5: 12, 6: 26, 7: 12, 8: 16, 9: 5, 10: 10, 11: 18, 12: 18, 13: 14, 14: 18 }
const DETAIL_HEADERS = ['File #', 'Filename', 'Reference', 'Payee', 'Site', 'Email / Fax',
  'Inv. Date', 'Inv. Number', 'Seq', 'Store No.', 'Ref. Code', 'Invoice Amount', 'WHT Amount', 'Transfer Amount']

function invoiceRowValues(fileNum: number, f: PaymentAdviceFile, store: PaymentAdviceStore, inv: PaymentAdviceStore['invoices'][number]): (string | number)[] {
  return [fileNum, f.filename, f.reference, store.payee, store.site, store.email,
    inv.inv_date, inv.inv_number, inv.inv_seq, inv.store_code, inv.reference,
    inv.inv_amount, inv.wht_amount, inv.transfer_amount]
}

function writeInvoiceRow(ws: WS, rowIdx: number, vals: (string | number)[], altFill: boolean) {
  const row = ws.getRow(rowIdx)
  vals.forEach((val, i) => {
    const c = row.getCell(i + 1)
    const [aln, isAmt] = DETAIL_SPEC[i]
    c.value = val; c.font = font(); c.alignment = align(aln); c.border = border()
    if (altFill) c.fill = fill(CLR_ALT)
    if (isAmt) c.numFmt = AMT_FMT
  })
}

// ── Sheet 2: Invoice Details (with subtotal blocks + row-limit splitting) ──
function makeDetailSheet(wb: ExcelJS.Workbook, num: number): { ws: WS; row: number } {
  const ws = wb.addWorksheet(num === 1 ? 'Invoice Details' : `Invoice Details (${num})`)
  noGrid(ws); freeze(ws, 2)
  writeHeader(ws, 1, new Array(14).fill(''), CLR_DARK, 22)
  const groups: [string, string][] = [['A1:C1', 'Source'], ['D1:F1', 'Site Info'], ['G1:K1', 'Invoice'], ['L1:N1', 'Amounts']]
  for (const [range, label] of groups) {
    ws.mergeCells(range)
    const c = ws.getCell(range.split(':')[0])
    c.value = label; c.font = hdrFont(11); c.alignment = align('center')
  }
  writeHeader(ws, 2, DETAIL_HEADERS, CLR_MID, 28)
  setWidths(ws, DETAIL_WIDTHS)
  return { ws, row: 3 }
}

function writeSubtotalBlock(ws: WS, row: number, fileNum: number, filename: string, store: PaymentAdviceStore,
  calcInv: number, calcWht: number, calcXf: number): number {
  const pdfXfer = store.pdf_total_transfer
  const match = Math.abs(calcXf - pdfXfer) < 0.005

  // Row A — label bar
  ws.mergeCells(`A${row}:K${row}`)
  let a = ws.getCell(`A${row}`)
  a.value = `File ${fileNum}: ${filename}  |  Site ${store.site}  —  ${store.invoices.length} invoices`
  a.font = font({ bold: true, color: CLR_WHITE }); a.fill = fill(CLR_MID); a.alignment = align('left'); a.border = border()
  for (const [col, val] of [[12, 'Invoice Amount'], [13, 'WHT Amount'], [14, 'Transfer Amount']] as [number, string][]) {
    const c = ws.getRow(row).getCell(col)
    c.value = val; c.font = font({ bold: true, color: CLR_WHITE }); c.fill = fill(CLR_MID); c.alignment = align('right'); c.border = border()
  }
  row++

  // Row B — Calculated
  ws.mergeCells(`A${row}:K${row}`)
  a = ws.getCell(`A${row}`)
  a.value = 'Calculated Sum'; a.font = font({ bold: true }); a.fill = fill(CLR_TOTAL); a.alignment = align('right'); a.border = border()
  for (const [col, val] of [[12, calcInv], [13, calcWht], [14, calcXf]] as [number, number][]) {
    const c = ws.getRow(row).getCell(col)
    c.value = val; c.font = font({ bold: true }); c.fill = fill(CLR_TOTAL); c.alignment = align('right'); c.border = border(); c.numFmt = AMT_FMT
  }
  row++

  // Row C — PDF stated + match
  const mc = match ? CLR_MATCH : CLR_MISMATCH
  const fc = match ? CLR_GREEN : CLR_RED
  const label = match ? '✓  Match' : `✗  MISMATCH  (diff: ${(r2(calcXf - pdfXfer) >= 0 ? '+' : '') + r2(calcXf - pdfXfer).toLocaleString('en-US', { minimumFractionDigits: 2 })})`
  ws.mergeCells(`A${row}:K${row}`)
  a = ws.getCell(`A${row}`)
  a.value = `PDF Stated Total  —  ${label}`
  a.font = font({ bold: true, color: fc }); a.fill = fill(mc); a.alignment = align('right'); a.border = border()
  for (const [col, val] of [[12, store.pdf_total_invoice], [13, store.pdf_total_wht], [14, store.pdf_total_transfer]] as [number, number][]) {
    const c = ws.getRow(row).getCell(col)
    c.value = val; c.font = font({ bold: true, color: fc }); c.fill = fill(mc); c.alignment = align('right'); c.border = border(); c.numFmt = AMT_FMT
  }
  row++

  // Spacer
  for (let col = 1; col <= 14; col++) { const c = ws.getRow(row).getCell(col); c.value = ''; c.fill = fill('F0F0F0') }
  ws.getRow(row).height = 5
  row++
  return row
}

function sheetInvoiceDetails(wb: ExcelJS.Workbook, files: PaymentAdviceFile[]) {
  let num = 1
  let { ws, row } = makeDetailSheet(wb, num)
  let grandInv = 0, grandWht = 0, grandXf = 0, grandInvCount = 0

  files.forEach((f, fi) => {
    const fileNum = fi + 1
    for (const store of f.stores) {
      const invCount = store.invoices.length
      if (row + invCount + 5 > EXCEL_ROW_LIMIT) { num++; ({ ws, row } = makeDetailSheet(wb, num)) }
      let calcInv = 0, calcWht = 0, calcXf = 0
      store.invoices.forEach((inv, idx) => {
        writeInvoiceRow(ws, row, invoiceRowValues(fileNum, f, store, inv), idx % 2 === 1)
        calcInv += inv.inv_amount; calcWht += inv.wht_amount; calcXf += inv.transfer_amount
        row++
      })
      calcInv = r2(calcInv); calcWht = r2(calcWht); calcXf = r2(calcXf)
      row = writeSubtotalBlock(ws, row, fileNum, f.filename, store, calcInv, calcWht, calcXf)
      grandInv += calcInv; grandWht += calcWht; grandXf += calcXf; grandInvCount += invCount
    }
  })

  const totalSites = sum(files.map((f) => f.stores.length))
  grandXf = r2(grandXf)
  const grandBank = r2(sum(files.map((f) => f.transferred_amount)))
  const grandMatch = Math.abs(grandXf - grandBank) < 0.01

  ws.mergeCells(`A${row}:K${row}`)
  let a = ws.getCell(`A${row}`)
  a.value = `GRAND TOTAL — ${files.length} file(s) / ${totalSites} sites / ${grandInvCount} invoices`
  a.font = hdrFont(11); a.fill = fill(CLR_DARK); a.alignment = align('left'); a.border = border()
  for (const [col, val] of [[12, r2(grandInv)], [13, r2(grandWht)], [14, grandXf]] as [number, number][]) {
    const c = ws.getRow(row).getCell(col)
    c.value = val; c.font = hdrFont(11); c.fill = fill(CLR_DARK); c.numFmt = AMT_FMT; c.alignment = align('right'); c.border = border()
  }
  row++

  const mc = grandMatch ? CLR_MATCH : CLR_MISMATCH
  const fc = grandMatch ? CLR_GREEN : CLR_RED
  const diffLabel = grandMatch ? '✓  Grand total matches bank letter(s)'
    : `✗  MISMATCH  (diff: ${(r2(grandXf - grandBank) >= 0 ? '+' : '') + r2(grandXf - grandBank).toLocaleString('en-US', { minimumFractionDigits: 2 })})`
  ws.mergeCells(`A${row}:K${row}`)
  a = ws.getCell(`A${row}`)
  a.value = diffLabel; a.font = font({ bold: true, color: fc }); a.fill = fill(mc); a.alignment = align('left'); a.border = border()
  for (const [col, val] of [[12, grandBank], [13, ''], [14, '']] as [number, string | number][]) {
    const c = ws.getRow(row).getCell(col)
    c.value = val; c.font = font({ bold: true, color: fc }); c.fill = fill(mc); c.alignment = align('right'); c.border = border()
    if (col === 12) c.numFmt = AMT_FMT
  }
}

// ── Sheet 3: Invoices (Flat) ──
function sheetInvoiceFlat(wb: ExcelJS.Workbook, files: PaymentAdviceFile[]) {
  let num = 1
  const newSheet = (n: number): { ws: WS; row: number } => {
    const ws = wb.addWorksheet(n === 1 ? 'Invoices (Flat)' : `Invoices (Flat) (${n})`)
    noGrid(ws); freeze(ws, 1)
    writeHeader(ws, 1, DETAIL_HEADERS, CLR_MID, 28)
    setWidths(ws, DETAIL_WIDTHS)
    return { ws, row: 2 }
  }
  let { ws, row } = newSheet(num)
  let grandInv = 0, grandWht = 0, grandXf = 0, grandCount = 0

  files.forEach((f, fi) => {
    const fileNum = fi + 1
    for (const store of f.stores) {
      for (const inv of store.invoices) {
        if (!inv.inv_number) continue
        if (row > EXCEL_ROW_LIMIT) { num++; ({ ws, row } = newSheet(num)) }
        writeInvoiceRow(ws, row, invoiceRowValues(fileNum, f, store, inv), row % 2 === 0)
        grandInv += inv.inv_amount; grandWht += inv.wht_amount; grandXf += inv.transfer_amount; grandCount++
        row++
      }
    }
  })

  grandInv = r2(grandInv); grandWht = r2(grandWht); grandXf = r2(grandXf)
  const totalSites = sum(files.map((f) => f.stores.length))
  ws.mergeCells(`A${row}:K${row}`)
  const a = ws.getCell(`A${row}`)
  a.value = `GRAND TOTAL — ${files.length} file(s) / ${totalSites} sites / ${grandCount} invoices`
  a.font = hdrFont(11); a.fill = fill(CLR_DARK); a.alignment = align('left'); a.border = border()
  for (const [col, val] of [[12, grandInv], [13, grandWht], [14, grandXf]] as [number, number][]) {
    const c = ws.getRow(row).getCell(col)
    c.value = val; c.font = hdrFont(11); c.fill = fill(CLR_DARK); c.numFmt = AMT_FMT; c.alignment = align('right'); c.border = border()
  }
}

// ── Sheet 4: Summary by Site ──
function sheetSiteSummary(wb: ExcelJS.Workbook, files: PaymentAdviceFile[]) {
  const ws = wb.addWorksheet('Summary by Site')
  noGrid(ws); freeze(ws, 2)
  const fileRefs = files.map((f) => f.reference).join(' / ')
  ws.mergeCells('A1:K1')
  const t = ws.getCell('A1')
  t.value = `Summary by Site  |  ${files.length} file(s)  |  Ref: ${fileRefs}`
  t.font = font({ bold: true, size: 13, color: CLR_WHITE }); t.fill = fill(CLR_DARK); t.alignment = align('center')
  ws.getRow(1).height = 32

  writeHeader(ws, 2, ['#', 'File #', 'Filename', 'Reference', 'Payee', 'Site', 'Email / Fax',
    'Inv. Count', 'Calc. Transfer Amt', 'PDF Total Amt', 'Match?'], CLR_MID, 28)

  let grandCalc = 0, grandPdf = 0, grandCount = 0, row = 3
  const aligns: ('left' | 'center' | 'right')[] = ['center', 'center', 'left', 'center', 'center', 'center', 'left', 'center', 'right', 'right', 'center']

  files.forEach((f, fi) => {
    const fileNum = fi + 1
    for (const store of f.stores) {
      const calc = calcXfer(store)
      const pdfT = store.pdf_total_transfer
      const match = Math.abs(calc - pdfT) < 0.005
      const alt = row % 2 === 0
      const rowData: (string | number)[] = [row - 2, fileNum, f.filename, f.reference, store.payee, store.site, store.email,
        store.invoices.length, calc, pdfT, match ? '✓  Match' : '✗  MISMATCH']
      const r = ws.getRow(row)
      rowData.forEach((val, i) => {
        const col = i + 1
        const c = r.getCell(col)
        c.value = val; c.font = font(); c.alignment = align(aligns[i]); c.border = border()
        if (alt) c.fill = fill(CLR_ALT)
        if (col === 9 || col === 10) c.numFmt = AMT_FMT
        if (col === 11) { c.fill = fill(match ? CLR_MATCH : CLR_MISMATCH); c.font = font({ bold: true, color: match ? CLR_GREEN : CLR_RED }) }
      })
      grandCalc += calc; grandPdf += pdfT; grandCount += store.invoices.length; row++
    }
  })

  grandCalc = r2(grandCalc); grandPdf = r2(grandPdf)
  const grandMatch = Math.abs(grandCalc - grandPdf) < 0.01
  ws.mergeCells(`A${row}:G${row}`)
  const a = ws.getCell(`A${row}`)
  a.value = 'GRAND TOTAL'; a.font = hdrFont(11); a.fill = fill(CLR_DARK); a.alignment = align('center'); a.border = border()
  const cells: [number, string | number][] = [[8, grandCount], [9, grandCalc], [10, grandPdf], [11, grandMatch ? '✓  Match' : '✗  MISMATCH']]
  for (const [col, val] of cells) {
    const c = ws.getRow(row).getCell(col)
    c.value = val; c.font = hdrFont(11); c.fill = fill(CLR_DARK)
    c.alignment = align(col === 8 || col === 9 || col === 10 ? 'right' : 'center'); c.border = border()
    if (col === 9 || col === 10) c.numFmt = AMT_FMT
  }
  setWidths(ws, { 1: 5, 2: 6, 3: 26, 4: 10, 5: 8, 6: 12, 7: 26, 8: 10, 9: 20, 10: 18, 11: 14 })
}

// ── Sheet 5: By Invoice Date ──
function parseDmy(s: string): number {
  const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(s)
  if (!m) return 0
  return new Date(2000 + +m[3], +m[2] - 1, +m[1]).getTime()
}

function sheetByDate(wb: ExcelJS.Workbook, files: PaymentAdviceFile[]) {
  const ws = wb.addWorksheet('By Invoice Date')
  noGrid(ws); freeze(ws, 2)

  const byDate = new Map<string, { fname: string; ref: string; date: string; count: number; inv: number; wht: number; xfer: number }>()
  for (const f of files) {
    for (const store of f.stores) {
      for (const inv of store.invoices) {
        const key = `${f.filename} ${f.reference} ${inv.inv_date}`
        let e = byDate.get(key)
        if (!e) { e = { fname: f.filename, ref: f.reference, date: inv.inv_date, count: 0, inv: 0, wht: 0, xfer: 0 }; byDate.set(key, e) }
        e.count++; e.inv += inv.inv_amount; e.wht += inv.wht_amount; e.xfer += inv.transfer_amount
      }
    }
  }
  const entries = [...byDate.values()].sort((a, b) => a.fname < b.fname ? -1 : a.fname > b.fname ? 1 : parseDmy(a.date) - parseDmy(b.date))

  ws.mergeCells('A1:H1')
  const t = ws.getCell('A1')
  t.value = `Invoice Breakdown by Date  |  ${files.length} file(s)`
  t.font = font({ bold: true, size: 13, color: CLR_WHITE }); t.fill = fill(CLR_DARK); t.alignment = align('center')
  ws.getRow(1).height = 32

  writeHeader(ws, 2, ['#', 'Filename', 'Reference', 'Invoice Date', 'Invoice Count', 'Invoice Amount', 'WHT Amount', 'Transfer Amount'], CLR_MID, 28)

  const grand = { count: 0, inv: 0, wht: 0, xfer: 0 }
  const aligns: ('left' | 'center' | 'right')[] = ['center', 'left', 'center', 'center', 'center', 'right', 'right', 'right']
  entries.forEach((e, i) => {
    const rowIdx = i + 3
    const alt = (i + 1) % 2 === 0
    const vals: (string | number)[] = [i + 1, e.fname, e.ref, e.date, e.count, r2(e.inv), r2(e.wht), r2(e.xfer)]
    const r = ws.getRow(rowIdx)
    vals.forEach((val, j) => {
      const col = j + 1
      const c = r.getCell(col)
      c.value = val; c.font = font(); c.alignment = align(aligns[j]); c.border = border()
      if (alt) c.fill = fill(CLR_ALT)
      if (col >= 6) c.numFmt = AMT_FMT
    })
    grand.count += e.count; grand.inv += e.inv; grand.wht += e.wht; grand.xfer += e.xfer
  })

  const tr = entries.length + 3
  ws.mergeCells(`A${tr}:D${tr}`)
  const a = ws.getCell(`A${tr}`)
  a.value = 'TOTAL'; a.font = hdrFont(11); a.fill = fill(CLR_DARK); a.alignment = align('center'); a.border = border()
  const cells: [number, number][] = [[5, grand.count], [6, r2(grand.inv)], [7, r2(grand.wht)], [8, r2(grand.xfer)]]
  for (const [col, val] of cells) {
    const c = ws.getRow(tr).getCell(col)
    c.value = val; c.font = hdrFont(11); c.fill = fill(CLR_DARK); c.alignment = align('right'); c.border = border()
    if (col >= 6) c.numFmt = AMT_FMT
  }
  setWidths(ws, { 1: 5, 2: 26, 3: 12, 4: 15, 5: 16, 6: 20, 7: 16, 8: 20 })
}

export function buildPaymentAdviceWorkbook(files: PaymentAdviceFile[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  sheetPaymentInfo(wb, files)
  sheetInvoiceDetails(wb, files)
  sheetInvoiceFlat(wb, files)
  sheetSiteSummary(wb, files)
  sheetByDate(wb, files)
  return wb
}

/** Build the workbook and trigger a browser download. */
export async function exportPaymentAdviceExcel(files: PaymentAdviceFile[], filename?: string) {
  const wb = buildPaymentAdviceWorkbook(files)
  const buf = await wb.xlsx.writeBuffer()
  const ts = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').replace(/(\d{8})(\d{6})/, '$1_$2')
  const name = filename || `Makro_Extracted_${ts}.xlsx`
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
