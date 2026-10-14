import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { useT } from '@/i18n/LanguageProvider'
import LoginPage from '@/components/LoginPage'
import Header from '@/components/Header'
import UploadZone from '@/components/UploadZone'
import ProcessingStatus from '@/components/ProcessingStatus'
import ResultsTable from '@/components/ResultsTable'
import TableSkeleton from '@/components/TableSkeleton'
import CustomerMasterPage, { getCustomerMasterRows } from '@/components/CustomerMasterPage'
import PaymentAdvicePage from '@/components/PaymentAdvicePage'
import CustomerCycle from '@/components/CustomerCycle'
import BackgroundPaths from '@/components/BackgroundPaths'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import { extractPdfText, countPdfPages } from '@/utils/pdfTextExtractor'
import { detectCustomer, shouldUseOcr, buildCustomerInstructions } from '@/config/customers'
import { exportToExcel } from '@/utils/excelExporter'
import {
  createActiveJobRegistry,
  createBackgroundJob,
  isBackgroundJobUnavailableError,
  pollBackgroundJob,
  runBackgroundJobsInOrder,
  type BackgroundJobStage,
  type BackgroundJobStatus,
} from '@/api/backgroundJobs'
import type { InvoiceRow, FileProcessingStatus, ProcessingState } from '@/types/invoice'
import { EMPTY_ROW } from '@/types/invoice'

type Tab = 'ocr' | 'customer-master' | 'payment-advice'

const apiUrl = (path: string) => `${import.meta.env.BASE_URL}api/${path}`
const LARGE_PDF_PAGE_THRESHOLD = 25

function processingState(stage: BackgroundJobStage): ProcessingState {
  return stage === 'queued' ? 'rendering' : stage
}

function statusPatch(status: BackgroundJobStatus): Partial<FileProcessingStatus> {
  return {
    filename: status.filename,
    state: processingState(status.status),
    progress: status.progress,
    pagesDone: status.pagesDone,
    pagesTotal: status.pagesTotal,
    extractBatchesDone: status.extractBatchesDone,
    extractBatchesTotal: status.extractBatchesTotal,
    error: status.error ?? undefined,
  }
}

function completeRows(rows: Partial<InvoiceRow>[], filename: string): InvoiceRow[] {
  const complete = rows.map((row) => ({ ...EMPTY_ROW(), ...row, seq: 0 }))
  if (complete.length === 0) complete.push({ ...EMPTY_ROW(), remark: filename })
  return complete
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Processing aborted', 'AbortError')
}

/** Read a File as a base64 string (no data: prefix) for sending to the API. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error(`Could not read ${file.name}`))
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.readAsDataURL(file)
  })
}

export default function App() {
  const { user, loading, error, logout, getToken } = useAuth()
  const { t } = useT()
  const [activeTab, setActiveTab]       = useState<Tab>('ocr')
  const [liveEnabled, setLiveEnabled]   = useState(() => localStorage.getItem('live') !== 'off')
  const [statuses, setStatuses]         = useState<FileProcessingStatus[]>([])
  const [rows, setRows]                 = useState<InvoiceRow[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [pendingJobRemovals, setPendingJobRemovals] = useState<string[]>([])
  const activeJobRegistry = useMemo(() => createActiveJobRegistry(localStorage), [])
  const lifecycleControllers = useRef(new Set<AbortController>())
  const rowCommitWaiters = useRef<Array<() => void>>([])
  const pageStats = useMemo(() => statuses.reduce(
    (total, status) => ({
      done: total.done + (status.pagesDone ?? 0),
      total: total.total + (status.pagesTotal ?? 0),
    }),
    { done: 0, total: 0 },
  ), [statuses])

  // All hooks must be declared before any conditional return
  const updateStatus = useCallback(
    (idx: number, patch: Partial<FileProcessingStatus>) =>
      setStatuses((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s))),
    []
  )

  const updateJobStatus = useCallback(
    (jobId: string, patch: Partial<FileProcessingStatus>) =>
      setStatuses((prev) => prev.map((status) =>
        status.jobId === jobId ? { ...status, ...patch } : status)),
    [],
  )

  const appendRows = useCallback((completed: InvoiceRow[]): Promise<void> => {
    return new Promise(resolve => {
      rowCommitWaiters.current.push(resolve)
      setRows(previous => [
        ...previous,
        ...completed.map((row, index) => ({
          ...row,
          seq: previous.length + index + 1,
        })),
      ])
    })
  }, [])

  const scheduleJobRemoval = useCallback((jobId: string) => {
    setPendingJobRemovals(previous =>
      previous.includes(jobId) ? previous : [...previous, jobId])
  }, [])

  useEffect(() => {
    if (pendingJobRemovals.length === 0) return
    for (const jobId of pendingJobRemovals) activeJobRegistry.remove(jobId)
    setPendingJobRemovals([])
  }, [activeJobRegistry, pendingJobRemovals])

  useEffect(() => {
    const committed = rowCommitWaiters.current.splice(0)
    for (const resolve of committed) resolve()
  }, [rows])

  useEffect(() => () => {
    for (const controller of lifecycleControllers.current) controller.abort()
    lifecycleControllers.current.clear()
    const abandoned = rowCommitWaiters.current.splice(0)
    for (const resolve of abandoned) resolve()
  }, [])

  useEffect(() => {
    if (!user) return
    const restored = activeJobRegistry.list()
    if (restored.length === 0) return

    const controller = new AbortController()
    setIsProcessing(true)
    setStatuses((previous) => {
      const existing = new Set(previous.flatMap(status => status.jobId ? [status.jobId] : []))
      return [
        ...previous,
        ...restored
          .filter(job => !existing.has(job.jobId))
          .map(job => ({
            filename: job.filename,
            jobId: job.jobId,
            state: 'rendering' as const,
            progress: 0,
            pagesDone: 0,
            pagesTotal: job.pagesTotal,
            extractBatchesDone: 0,
            extractBatchesTotal: 0,
            rows: [],
          })),
      ]
    })

    const restore = async (job: typeof restored[number]) => {
      try {
        await pollBackgroundJob(job.jobId, getToken, {
          registry: activeJobRegistry,
          signal: controller.signal,
          onStatus: status => { updateJobStatus(job.jobId, statusPatch(status)) },
          onResult: async resultRows => {
            const completed = completeRows(resultRows, job.filename)
            updateJobStatus(job.jobId, { rows: completed })
            await appendRows(completed)
          },
        })
        throwIfAborted(controller.signal)
        scheduleJobRemoval(job.jobId)
      } catch (pollError) {
        if (isAbortError(pollError)) throw pollError
        const message = pollError instanceof Error ? pollError.message : 'Unknown error'
        updateJobStatus(job.jobId, { state: 'error', error: message })
        if (isBackgroundJobUnavailableError(pollError)) {
          scheduleJobRemoval(job.jobId)
        }
      }
    }

    void runBackgroundJobsInOrder(restored, restore, controller.signal)
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setIsProcessing(false)
      })
    return () => { controller.abort() }
  }, [
    activeJobRegistry,
    appendRows,
    getToken,
    scheduleJobRemoval,
    updateJobStatus,
    user,
  ])

  const processFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return
    const controller = new AbortController()
    lifecycleControllers.current.add(controller)
    setIsProcessing(true)
    setStatuses(files.map((file) => ({
      file,
      filename: file.name,
      state: 'idle',
      progress: 0,
      pagesDone: 0,
      rows: [],
    })))
    const customerMaster = getCustomerMasterRows()

    try {
      // Pre-count pages across all files for the "done/total" progress display.
      const pageCounts: number[] = []
      for (const file of files) {
        try {
          pageCounts.push(await countPdfPages(file))
          throwIfAborted(controller.signal)
        } catch (countError) {
          if (controller.signal.aborted) throwIfAborted(controller.signal)
          if (isAbortError(countError)) throw countError
          pageCounts.push(1)
        }
      }
      setStatuses(previous => previous.map((status, index) => ({
        ...status,
        pagesTotal: pageCounts[index],
      })))

      await runBackgroundJobsInOrder(files, async (file, i) => {
        let backgroundJobId: string | undefined
        try {
          updateStatus(i, { state: 'rendering', progress: 15 })
          const { text: pdfText, isDigital, pageCount } = await extractPdfText(file)
          throwIfAborted(controller.signal)
          updateStatus(i, { pagesTotal: pageCount })
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

          if (pageCount > LARGE_PDF_PAGE_THRESHOLD) {
            let pdfPayload: { pdf?: string } = {}
            if (useOcr) {
              pdfPayload = { pdf: await fileToBase64(file) }
              throwIfAborted(controller.signal)
            }
            const created = await createBackgroundJob({
              filename: file.name,
              pageCount,
              text: pdfText,
              isDigital,
              useOcr,
              ...pdfPayload,
              customerMaster,
              ...customerPayload,
            }, getToken)
            backgroundJobId = created.jobId
            activeJobRegistry.save({
              jobId: created.jobId,
              filename: file.name,
              pagesTotal: created.pagesTotal,
            })
            throwIfAborted(controller.signal)
            updateStatus(i, {
              jobId: created.jobId,
              state: 'rendering',
              progress: 0,
              pagesDone: 0,
              pagesTotal: created.pagesTotal,
              extractBatchesDone: 0,
              extractBatchesTotal: 0,
            })

            await pollBackgroundJob(created.jobId, getToken, {
              registry: activeJobRegistry,
              signal: controller.signal,
              onStatus: status => { updateStatus(i, statusPatch(status)) },
              onResult: async resultRows => {
                const completed = completeRows(resultRows, file.name)
                updateStatus(i, { rows: completed })
                await appendRows(completed)
              },
            })
            throwIfAborted(controller.signal)
            scheduleJobRemoval(created.jobId)
            return
          }

          if (!useOcr) {
            updateStatus(i, { state: 'extracting', progress: 50, pagesDone: pageCount })
            const token = await getToken()
            throwIfAborted(controller.signal)
            const res = await fetch(apiUrl('extract'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
              body: JSON.stringify({ text: pdfText, filename: file.name, customerMaster, ...customerPayload }),
            })
            throwIfAborted(controller.signal)
            if (!res.ok) {
              const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
              throwIfAborted(controller.signal)
              throw new Error([err.error, err.reason].filter(Boolean).join(" — ") || `Extract failed: ${res.status}`)
            }
            const { rows: extracted } = await res.json()
            throwIfAborted(controller.signal)
            extractedRows = extracted
          } else {
            updateStatus(i, { state: 'ocr', progress: 35 })
            // Render + OCR the whole PDF on the server (poppler), not in the browser.
            // The browser's pdf.js renderer drops Thai combining marks for some fonts
            // (e.g. PT invoices); poppler renders them correctly and this matches the
            // eval harness, so production output equals the verified test results.
            const ocrToken = await getToken()
            throwIfAborted(controller.signal)
            const pdfBase64 = await fileToBase64(file)
            throwIfAborted(controller.signal)
            const ocrRes = await fetch(apiUrl('ocr-pdf'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(ocrToken ? { Authorization: `Bearer ${ocrToken}` } : {}) },
              body: JSON.stringify({ pdf: pdfBase64 }),
            })
            throwIfAborted(controller.signal)
            if (!ocrRes.ok) {
              const err = await ocrRes.json().catch(() => ({ error: `HTTP ${ocrRes.status}` }))
              throwIfAborted(controller.signal)
              throw new Error([err.error, err.reason].filter(Boolean).join(" — ") || `OCR failed: ${ocrRes.status}`)
            }
            const { text: ocrCombined } = await ocrRes.json()
            throwIfAborted(controller.signal)
            updateStatus(i, { state: 'extracting', progress: 80, pagesDone: pageCount })
            // Scanned PDFs have no embedded text, so pdfText may be empty/garbled
            // and the initial detectCustomer() above may have returned null.
            // Re-detect from the assembled OCR text now that we have real content.
            const effectiveRule = customerRule ?? detectCustomer(ocrCombined, file.name)
            const effectivePayload = effectiveRule === customerRule
              ? customerPayload
              : {
                  customerId:           effectiveRule?.id ?? null,
                  customerInstructions: buildCustomerInstructions(effectiveRule),
                  vendorCode:           effectiveRule?.vendorCode  ?? 'auto',
                  vendorBranch:         effectiveRule?.vendorBranch ?? 'auto',
                }
            const extractToken = await getToken()
            throwIfAborted(controller.signal)
            const extractRes = await fetch(apiUrl('extract'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(extractToken ? { Authorization: `Bearer ${extractToken}` } : {}) },
              body: JSON.stringify({ text: ocrCombined, filename: file.name, customerMaster, ...effectivePayload }),
            })
            throwIfAborted(controller.signal)
            if (!extractRes.ok) {
              const err = await extractRes.json().catch(() => ({ error: `HTTP ${extractRes.status}` }))
              throwIfAborted(controller.signal)
              throw new Error([err.error, err.reason].filter(Boolean).join(" — ") || `Extract failed: ${extractRes.status}`)
            }
            const { rows: extracted } = await extractRes.json()
            throwIfAborted(controller.signal)
            extractedRows = extracted
          }

          const fileRows = completeRows(extractedRows, file.name)
          updateStatus(i, {
            state: 'done',
            progress: 100,
            pagesDone: pageCount,
            pagesTotal: pageCount,
            rows: fileRows,
          })
          await appendRows(fileRows)
          throwIfAborted(controller.signal)
        } catch (processingError) {
          if (controller.signal.aborted) throwIfAborted(controller.signal)
          if (isAbortError(processingError)) throw processingError
          const message = processingError instanceof Error ? processingError.message : 'Unknown error'
          updateStatus(i, { state: 'error', error: message })
          if (backgroundJobId && isBackgroundJobUnavailableError(processingError)) {
            scheduleJobRemoval(backgroundJobId)
          }
        }
      }, controller.signal)
    } catch (processingError) {
      if (controller.signal.aborted) return
      if (!isAbortError(processingError)) throw processingError
    } finally {
      lifecycleControllers.current.delete(controller)
      if (!controller.signal.aborted) setIsProcessing(false)
    }
  }, [
    activeJobRegistry,
    appendRows,
    getToken,
    scheduleJobRemoval,
    updateStatus,
  ])

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

  // Warn before refresh/close while there are extracted rows or a run in progress —
  // the data lives in memory only and would otherwise be lost silently.
  useBeforeUnload(rows.length > 0 || isProcessing)

  if (!user) return <LoginPage initError={error} isLoading={loading} />

  const clearAll = () => { setRows([]); setStatuses([]) }

  const allDone = statuses.length > 0 && statuses.every((s) => s.state === 'done' || s.state === 'error')

  return (
    <>
    {liveEnabled && <BackgroundPaths dimmed={rows.length > 0} />}
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

      {activeTab === 'payment-advice' && <PaymentAdvicePage />}

      {activeTab === 'ocr' && (
        <main className="flex-1 w-full px-6 flex flex-col gap-6">

          {rows.length === 0 && statuses.length === 0 && (
            <div className="text-center pt-16 pb-4 animate-fade-in">
              <h2 className="text-4xl sm:text-5xl font-bold text-foreground tracking-tight leading-tight text-balance">
                {t('app.hero.title')}<br />
                {t('app.hero.supportedFor')}
              </h2>
              <CustomerCycle />
            </div>
          )}

          <div className={`max-w-3xl mx-auto w-full flex flex-col gap-6 ${(statuses.length > 0 || rows.length > 0) ? 'pt-8' : ''}`}>
            {rows.length > 0 && (
              <div className="pt-8 pb-2 flex items-center justify-between animate-fade-in">
                <span className="text-sm text-muted-foreground">{rows.length === 1 ? t('app.rowsExtracted.one') : t('app.rowsExtracted.many', { n: rows.length })}</span>
                {allDone && !isProcessing && (
                  <label className="btn-secondary cursor-pointer">
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                    </svg>
                    {t('app.addMore')}
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
                    {t('app.clearAll')}
                  </button>

                  <div className="flex items-center gap-3">
                    <button className="btn-secondary" onClick={refreshCustomerMapping} disabled={isProcessing}>
                      <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                        <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
                      </svg>
                      {t('app.refreshMapping')}
                    </button>
                    <button className="btn-primary" onClick={() => exportToExcel(rows)} disabled={rows.length === 0}>
                      <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                      </svg>
                      {t('app.downloadExcel')}
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
