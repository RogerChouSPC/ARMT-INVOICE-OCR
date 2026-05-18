import { useState, useCallback } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import LoginPage from '@/components/LoginPage'
import Header from '@/components/Header'
import UploadZone from '@/components/UploadZone'
import ProcessingStatus from '@/components/ProcessingStatus'
import ResultsTable from '@/components/ResultsTable'
import TableSkeleton from '@/components/TableSkeleton'
import CustomerMasterPage, { getCustomerMasterRows } from '@/components/CustomerMasterPage'
import CustomerCycle from '@/components/CustomerCycle'
import BackgroundPaths from '@/components/BackgroundPaths'
import { extractPdfText, countPdfPages } from '@/utils/pdfTextExtractor'
import { detectCustomer, shouldUseOcr, buildCustomerInstructions } from '@/config/customers'
import { renderPdfPages } from '@/utils/pdfRenderer'
import { exportToExcel } from '@/utils/excelExporter'
import type { InvoiceRow, FileProcessingStatus } from '@/types/invoice'
import { EMPTY_ROW } from '@/types/invoice'

type Tab = 'ocr' | 'customer-master'

export default function App() {
  const { user, loading, error, logout, getToken } = useAuth()
  const [activeTab, setActiveTab]       = useState<Tab>('ocr')
  const [liveEnabled, setLiveEnabled]   = useState(() => localStorage.getItem('live') !== 'off')
  const [statuses, setStatuses]         = useState<FileProcessingStatus[]>([])
  const [rows, setRows]                 = useState<InvoiceRow[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [pageStats, setPageStats]       = useState({ done: 0, total: 0 })

  // All hooks must be declared before any conditional return
  const updateStatus = useCallback(
    (idx: number, patch: Partial<FileProcessingStatus>) =>
      setStatuses((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s))),
    []
  )

  const processFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return
    setIsProcessing(true)
    setStatuses(files.map((file) => ({ file, state: 'idle', progress: 0, rows: [] })))
    const newRows: InvoiceRow[] = []
    const customerMaster = getCustomerMasterRows()

    // Pre-count pages across all files for the "done/total" progress display.
    const pageCounts: number[] = []
    for (const file of files) {
      try { pageCounts.push(await countPdfPages(file)) }
      catch { pageCounts.push(1) }
    }
    setPageStats({ done: 0, total: pageCounts.reduce((a, b) => a + b, 0) })

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const pagesBefore = pageCounts.slice(0, i).reduce((a, b) => a + b, 0)
      try {
        updateStatus(i, { state: 'rendering', progress: 15 })
        const { text: pdfText, isDigital, pageCount } = await extractPdfText(file)
        let extractedRows: Partial<InvoiceRow>[] = []

        // Per-customer config decides OCR vs direct text; falls back to auto-detection.
        // The detected rule is sent to /api/extract so the API needs no config import.
        const customerRule = detectCustomer(pdfText, file.name)
        const useOcr = shouldUseOcr(customerRule, isDigital)
        const customerPayload = {
          customerId: customerRule?.id ?? null,
          customerInstructions: buildCustomerInstructions(customerRule),
          vendorCode: customerRule?.vendorCode ?? 'auto',
          vendorBranch: customerRule?.vendorBranch ?? 'auto',
        }

        if (!useOcr) {
          updateStatus(i, { state: 'extracting', progress: 50 })
          const token = await getToken()
          const res = await fetch('/api/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({ text: pdfText, filename: file.name, customerMaster, ...customerPayload }),
          })
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
            throw new Error(err.error || `Extract failed: ${res.status}`)
          }
          const { rows: r } = await res.json()
          extractedRows = r
        } else {
          updateStatus(i, { state: 'ocr', progress: 25 })
          const pages = await renderPdfPages(file, (cur, total) => {
            updateStatus(i, { progress: 25 + (cur / total) * 35 })
          })
          // OCR all pages in parallel — far faster for multi-page invoices.
          // Promise.all preserves order, so pages stay in sequence.
          const ocrToken = await getToken()
          let ocrDone = 0
          const ocrTexts = await Promise.all(pages.map(async (page, p) => {
            const ocrRes = await fetch('/api/ocr', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(ocrToken ? { Authorization: `Bearer ${ocrToken}` } : {}) },
              body: JSON.stringify({ image: page.base64 }),
            })
            if (!ocrRes.ok) {
              const err = await ocrRes.json().catch(() => ({ error: `HTTP ${ocrRes.status}` }))
              throw new Error(err.error || `OCR failed on page ${p + 1}`)
            }
            const { text } = await ocrRes.json()
            ocrDone++
            updateStatus(i, { progress: 60 + (ocrDone / pages.length) * 20 })
            setPageStats((s) => ({ ...s, done: pagesBefore + ocrDone }))
            return text as string
          }))
          updateStatus(i, { state: 'extracting', progress: 80 })
          const extractToken = await getToken()
          const extractRes = await fetch('/api/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(extractToken ? { Authorization: `Bearer ${extractToken}` } : {}) },
            body: JSON.stringify({ text: ocrTexts.join('\n\n--- PAGE BREAK ---\n\n'), filename: file.name, customerMaster, ...customerPayload }),
          })
          if (!extractRes.ok) {
            const err = await extractRes.json().catch(() => ({ error: `HTTP ${extractRes.status}` }))
            throw new Error(err.error || `Extract failed: ${extractRes.status}`)
          }
          const { rows: r } = await extractRes.json()
          extractedRows = r
        }

        const fileRows: InvoiceRow[] = (extractedRows as Partial<InvoiceRow>[]).map((r) => ({ ...EMPTY_ROW(), ...r, seq: 0 }))
        if (fileRows.length === 0) fileRows.push({ ...EMPTY_ROW(), remark: file.name })
        newRows.push(...fileRows)
        updateStatus(i, { state: 'done', progress: 100, rows: fileRows })
        console.info(`${file.name}: customer=${customerRule?.id ?? 'unknown'}, ${useOcr ? 'OCR' : 'text'} path, ${pageCount} page(s), ${fileRows.length} row(s)`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        updateStatus(i, { state: 'error', progress: 0, error: msg })
        console.error(`${file.name}:`, msg)
      } finally {
        // Ensure every page of this file is counted once the file finishes.
        setPageStats((s) => ({ ...s, done: Math.max(s.done, pagesBefore + pageCounts[i]) }))
      }
    }

    setRows((prev) => [...prev, ...newRows.map((r, i) => ({ ...r, seq: prev.length + i + 1 }))])
    setIsProcessing(false)
  }, [updateStatus, getToken])

  const refreshCustomerMapping = useCallback(() => {
    const cm = getCustomerMasterRows()
    setRows(prev => prev.map(row => {
      if (!row.taxid) return row
      const matches = cm.filter(c => c.taxid === row.taxid)
      if (matches.length === 0) return row
      if (matches.length === 1) return { ...row, customergroup: matches[0].customergroup, customercode: matches[0].customercode }
      const hint = row.customergroup.toLowerCase()
      const best = matches.find(m => hint.includes(m.store_name.toLowerCase())) ?? matches[0]
      return { ...row, customergroup: best.customergroup, customercode: best.customercode }
    }))
  }, [])

  if (!user) return <LoginPage initError={error} isLoading={loading} />

  const clearAll = () => { setRows([]); setStatuses([]); setPageStats({ done: 0, total: 0 }) }

  const allDone = statuses.length > 0 && statuses.every((s) => s.state === 'done' || s.state === 'error')

  return (
    <>
    {liveEnabled && <BackgroundPaths />}
    <div className="min-h-screen flex flex-col relative z-[2]">
      <Header
        rowCount={rows.length}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        user={user}
        onLogout={logout}
        liveEnabled={liveEnabled}
        onToggleLive={() => {
          const next = !liveEnabled
          setLiveEnabled(next)
          localStorage.setItem('live', next ? 'on' : 'off')
        }}
      />

      {activeTab === 'customer-master' && (
        <main className="flex-1 w-full px-6 py-8">
          <CustomerMasterPage />
        </main>
      )}

      {activeTab === 'ocr' && (
        <main className="flex-1 w-full px-6 flex flex-col gap-6">

          {rows.length === 0 && statuses.length === 0 && (
            <div className="text-center pt-20 pb-6 animate-fade-in">
              <h2 className="text-6xl font-bold text-foreground tracking-tight leading-[1.2]">
                Extract invoices in seconds<br />
                Supported for
              </h2>
              <CustomerCycle />
            </div>
          )}

          <div className={`max-w-3xl mx-auto w-full flex flex-col gap-6 ${(statuses.length > 0 || rows.length > 0) ? 'pt-8' : ''}`}>
            {rows.length > 0 && (
              <div className="pt-8 pb-2 flex items-center justify-between animate-fade-in">
                <span className="text-sm text-muted-foreground">{rows.length} {rows.length === 1 ? 'row' : 'rows'} extracted</span>
                {allDone && !isProcessing && (
                  <label className="btn-secondary cursor-pointer">
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                    </svg>
                    Add more
                    <input type="file" accept="application/pdf" multiple className="hidden"
                      onChange={(e) => e.target.files && processFiles(Array.from(e.target.files))} />
                  </label>
                )}
              </div>
            )}

            <UploadZone onFiles={processFiles} disabled={isProcessing} />
            <ProcessingStatus items={statuses} pageStats={pageStats} />

            {isProcessing && rows.length === 0 && <TableSkeleton />}

            {rows.length > 0 && (
              <>
                <ResultsTable rows={rows} onUpdate={setRows} />

                <div className="flex items-center justify-between pb-10">
                  <button
                    className="text-sm text-muted-foreground hover:text-destructive transition-colors"
                    onClick={clearAll}
                  >
                    Clear all
                  </button>

                  <div className="flex items-center gap-3">
                    <button className="btn-secondary" onClick={refreshCustomerMapping} disabled={isProcessing}>
                      <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                        <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
                      </svg>
                      Refresh Mapping
                    </button>
                    <button className="btn-primary" onClick={() => exportToExcel(rows)} disabled={rows.length === 0}>
                      <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                      </svg>
                      Download Excel
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </main>
      )}
    </div>
    </>
  )
}
