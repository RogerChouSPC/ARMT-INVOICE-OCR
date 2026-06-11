import { useState, useCallback } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { useT } from '@/i18n/LanguageProvider'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import UploadZone from '@/components/UploadZone'
import { exportPaymentAdviceExcel } from '@/utils/paymentAdviceExcel'
import type { PaymentAdviceFile } from '@/types/paymentAdvice'

const apiUrl = (path: string) => `${import.meta.env.BASE_URL}api/${path}`
const baht = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error(`Could not read ${file.name}`))
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.readAsDataURL(file)
  })
}

interface FileSummary {
  f: PaymentAdviceFile
  calc: number
  invoices: number
  match: boolean
}

export default function PaymentAdvicePage() {
  const { getToken } = useAuth()
  const { t } = useT()
  const [files, setFiles] = useState<PaymentAdviceFile[]>([])
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Warn before refresh/close while there are parsed results or a run in progress.
  useBeforeUnload(files.length > 0 || processing)

  const processFiles = useCallback(async (uploaded: File[]) => {
    if (uploaded.length === 0) return
    setProcessing(true)
    setError(null)
    setFiles([])
    try {
      const payload = await Promise.all(
        uploaded.map(async (file) => ({ filename: file.name, base64: await readAsBase64(file) }))
      )
      const token = await getToken()
      const res = await fetch(apiUrl('payment-advice'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ files: payload }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        throw new Error(err.error || `Request failed: ${res.status}`)
      }
      const { files: parsed } = await res.json()
      setFiles(parsed as PaymentAdviceFile[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setProcessing(false)
    }
  }, [getToken])

  const summaries: FileSummary[] = files.map((f) => {
    const calc = Math.round(f.stores.reduce((s, st) => s + st.invoices.reduce((t, i) => t + i.transfer_amount, 0), 0) * 100) / 100
    const invoices = f.stores.reduce((s, st) => s + st.invoices.length, 0)
    return { f, calc, invoices, match: Math.abs(calc - f.transferred_amount) < 0.01 }
  })

  const totalStores = files.reduce((s, f) => s + f.stores.length, 0)
  const hasResults = files.length > 0

  return (
    <main className="flex-1 w-full px-6 flex flex-col gap-6">
      {!hasResults && !processing && (
        <div className="text-center pt-16 pb-2 animate-fade-in">
          <h2 className="text-4xl font-bold text-foreground tracking-tight leading-[1.2]">
            {t('pa.title')}
          </h2>
          <p className="text-muted-foreground mt-3">
            {t('pa.subtitle')}
          </p>
        </div>
      )}

      <div className="max-w-4xl mx-auto w-full flex flex-col gap-6 pt-6">
        <UploadZone onFiles={processFiles} disabled={processing} />

        {processing && (
          <div className="text-center text-sm text-muted-foreground animate-pulse py-4">
            {t('pa.reconciling')}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 text-destructive text-sm px-4 py-3">
            {error}
          </div>
        )}

        {hasResults && (
          <>
            <div className="flex items-center justify-between pt-2 animate-fade-in">
              <span className="text-sm text-muted-foreground">
                {t('pa.summary', { files: files.length, sites: totalStores, invoices: summaries.reduce((s, x) => s + x.invoices, 0) })}
              </span>
              <button className="btn-primary" onClick={() => exportPaymentAdviceExcel(files)}>
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                  <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                </svg>
                {t('pa.downloadExcel')}
              </button>
            </div>

            {/* Per-file reconciliation */}
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">{t('pa.col.filename')}</th>
                    <th className="text-left px-3 py-2 font-medium">{t('pa.col.reference')}</th>
                    <th className="text-left px-3 py-2 font-medium">{t('pa.col.valueDate')}</th>
                    <th className="text-right px-3 py-2 font-medium">{t('pa.col.bankTotal')}</th>
                    <th className="text-right px-3 py-2 font-medium">{t('pa.col.calcTotal')}</th>
                    <th className="text-center px-3 py-2 font-medium">{t('pa.col.match')}</th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.map((s, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-2 truncate max-w-[220px]" title={s.f.filename}>{s.f.filename}</td>
                      <td className="px-3 py-2">{s.f.reference}</td>
                      <td className="px-3 py-2">{s.f.value_date}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{baht(s.f.transferred_amount)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{baht(s.calc)}</td>
                      <td className="px-3 py-2 text-center">
                        <span
                          className="inline-block rounded px-2 py-0.5 text-xs font-semibold"
                          style={s.match
                            ? { backgroundColor: 'hsl(var(--success-bg))', color: 'hsl(var(--success))' }
                            : { backgroundColor: 'hsl(var(--destructive) / 0.15)', color: 'hsl(var(--destructive))' }}
                        >
                          {s.match ? `✓ ${t('pa.match')}` : `✗ ${t('pa.mismatch')}`}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Per-site reconciliation */}
            <div className="overflow-x-auto rounded-lg border border-border mb-10">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">{t('pa.col.payee')}</th>
                    <th className="text-left px-3 py-2 font-medium">{t('pa.col.site')}</th>
                    <th className="text-right px-3 py-2 font-medium">{t('pa.col.invoices')}</th>
                    <th className="text-right px-3 py-2 font-medium">{t('pa.col.calcTransfer')}</th>
                    <th className="text-right px-3 py-2 font-medium">{t('pa.col.pdfTotal')}</th>
                    <th className="text-center px-3 py-2 font-medium">{t('pa.col.match')}</th>
                  </tr>
                </thead>
                <tbody>
                  {files.flatMap((f, fi) => f.stores.map((st, si) => {
                    const calc = Math.round(st.invoices.reduce((t, i) => t + i.transfer_amount, 0) * 100) / 100
                    const match = Math.abs(calc - st.pdf_total_transfer) < 0.005
                    return (
                      <tr key={`${fi}-${si}`} className="border-t border-border">
                        <td className="px-3 py-2">{st.payee}</td>
                        <td className="px-3 py-2">{st.site}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{st.invoices.length}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{baht(calc)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{baht(st.pdf_total_transfer)}</td>
                        <td className="px-3 py-2 text-center">
                          <span
                            className="inline-block rounded px-2 py-0.5 text-xs font-semibold"
                            style={match
                              ? { backgroundColor: 'hsl(var(--success-bg))', color: 'hsl(var(--success))' }
                              : { backgroundColor: 'hsl(var(--destructive) / 0.15)', color: 'hsl(var(--destructive))' }}
                            title={match ? t('pa.match') : t('pa.mismatch')}
                          >
                            {match ? '✓' : '✗'}
                          </span>
                        </td>
                      </tr>
                    )
                  }))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
