import { useState, useCallback } from 'react'
import Header from '@/components/Header'
import UploadZone from '@/components/UploadZone'
import ProcessingStatus from '@/components/ProcessingStatus'
import ResultsTable from '@/components/ResultsTable'
import CustomerMasterPage, { getCustomerMasterRows } from '@/components/CustomerMasterPage'
import { extractPdfText } from '@/utils/pdfTextExtractor'
import { renderPdfPages } from '@/utils/pdfRenderer'
import { exportToExcel } from '@/utils/excelExporter'
import type { InvoiceRow, FileProcessingStatus } from '@/types/invoice'
import { EMPTY_ROW } from '@/types/invoice'

type Tab = 'ocr' | 'customer-master'

export default function App() {
  const [activeTab, setActiveTab]     = useState<Tab>('ocr')
  const [statuses, setStatuses]       = useState<FileProcessingStatus[]>([])
  const [rows, setRows]               = useState<InvoiceRow[]>([])
  const [isProcessing, setIsProcessing] = useState(false)

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

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      try {
        updateStatus(i, { state: 'rendering', progress: 15 })
        const { text: pdfText, isDigital, pageCount } = await extractPdfText(file)
        let extractedRows: Partial<InvoiceRow>[] = []

        if (isDigital) {
          updateStatus(i, { state: 'extracting', progress: 50 })
          const res = await fetch('/api/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: pdfText, filename: file.name, customerMaster }),
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
          const ocrTexts: string[] = []
          for (let p = 0; p < pages.length; p++) {
            const ocrRes = await fetch('/api/ocr', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ image: pages[p].base64 }),
            })
            if (!ocrRes.ok) {
              const err = await ocrRes.json().catch(() => ({ error: `HTTP ${ocrRes.status}` }))
              throw new Error(err.error || `OCR failed on page ${p + 1}`)
            }
            const { text } = await ocrRes.json()
            ocrTexts.push(text)
            updateStatus(i, { progress: 60 + ((p + 1) / pages.length) * 20 })
          }
          updateStatus(i, { state: 'extracting', progress: 80 })
          const extractRes = await fetch('/api/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: ocrTexts.join('\n\n--- PAGE BREAK ---\n\n'), filename: file.name, customerMaster }),
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
        console.info(`${file.name}: ${isDigital ? 'digital' : 'scanned'} PDF, ${pageCount} page(s), ${fileRows.length} row(s)`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        updateStatus(i, { state: 'error', progress: 0, error: msg })
        console.error(`${file.name}:`, msg)
      }
    }

    setRows((prev) => [...prev, ...newRows.map((r, i) => ({ ...r, seq: prev.length + i + 1 }))])
    setIsProcessing(false)
  }, [updateStatus])

  const clearAll = () => { setRows([]); setStatuses([]) }

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

  const allDone = statuses.length > 0 && statuses.every((s) => s.state === 'done' || s.state === 'error')
  const isEmpty = rows.length === 0 && statuses.length === 0

  return (
    <div className="min-h-screen flex flex-col bg-ink">
      <Header rowCount={rows.length} activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === 'customer-master' && (
        <main className="flex-1 max-w-screen-2xl mx-auto w-full px-8 py-8">
          <CustomerMasterPage />
        </main>
      )}

      {activeTab === 'ocr' && (
        <main className="flex-1 max-w-screen-2xl mx-auto w-full px-8 flex flex-col">

          {/* ── Editorial hero (empty state) ── */}
          {isEmpty && (
            <div className="flex flex-col justify-between flex-1 py-12 min-h-[calc(100vh-3.5rem)]">

              {/* Headline block */}
              <div className="flex-1 flex flex-col justify-center">
                <p className="font-mono text-[10px] tracking-widest text-gold uppercase mb-8 animate-reveal delay-1"
                   style={{ opacity: 0 }}>
                  Thai Document Intelligence
                </p>
                <h1 className="font-display font-light text-cream leading-[0.88] animate-reveal delay-2"
                    style={{ fontSize: 'clamp(4rem, 11vw, 10rem)', letterSpacing: '-0.02em', opacity: 0 }}>
                  Invoice<br />
                  <span className="italic" style={{ color: 'rgba(232,226,217,0.45)' }}>Extractor</span>
                </h1>

                {/* Metadata row */}
                <div className="flex items-center gap-6 mt-10 animate-reveal delay-3" style={{ opacity: 0 }}>
                  <div className="h-px flex-1 max-w-[120px]" style={{ background: 'linear-gradient(90deg, #C9A84C, transparent)', opacity: 0.4 }} />
                  <span className="font-mono text-[10px] tracking-widest text-muted uppercase">Powered by Google Gemini</span>
                  <span className="font-mono text-[10px] text-faint">·</span>
                  <span className="font-mono text-[10px] tracking-widest text-muted uppercase">22-column Excel output</span>
                </div>
              </div>

              {/* Upload zone anchored to bottom */}
              <div className="animate-reveal delay-4" style={{ opacity: 0 }}>
                <div className="gold-line mb-4" />
                <UploadZone onFiles={processFiles} disabled={isProcessing} />
              </div>
            </div>
          )}

          {/* ── Active / results state ── */}
          {!isEmpty && (
            <div className="flex flex-col gap-5 py-8">
              <UploadZone onFiles={processFiles} disabled={isProcessing} />
              <ProcessingStatus items={statuses} />

              {rows.length > 0 && (
                <>
                  <ResultsTable rows={rows} onUpdate={setRows} />

                  <div className="flex items-center justify-between pt-2 pb-6">
                    <button className="btn-secondary text-danger hover:text-danger hover:border-danger" onClick={clearAll}>
                      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                      </svg>
                      Clear all
                    </button>

                    <div className="flex items-center gap-3">
                      {allDone && !isProcessing && (
                        <label className="btn-secondary cursor-pointer">
                          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current">
                            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                          </svg>
                          Add more
                          <input type="file" accept="application/pdf" multiple className="hidden"
                            onChange={(e) => e.target.files && processFiles(Array.from(e.target.files))} />
                        </label>
                      )}
                      <button className="btn-secondary" onClick={refreshCustomerMapping} disabled={isProcessing}>
                        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current">
                          <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
                        </svg>
                        Refresh Mapping
                      </button>
                      <button className="btn-primary" onClick={() => exportToExcel(rows)} disabled={rows.length === 0}>
                        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current">
                          <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                        </svg>
                        Download Excel
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </main>
      )}

      <footer className="border-t border-border py-4 px-8">
        <p className="font-mono text-[9px] tracking-widest text-faint uppercase">
          ARMT Invoice OCR &thinsp;·&thinsp; Google Gemini &thinsp;·&thinsp; Thai Language Support
        </p>
      </footer>
    </div>
  )
}
