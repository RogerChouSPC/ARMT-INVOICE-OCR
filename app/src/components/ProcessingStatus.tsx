import { useState } from 'react'
import type { FileProcessingStatus } from '@/types/invoice'
import PdfPreviewDialog from './PdfPreviewDialog'
import { useT } from '@/i18n/LanguageProvider'
import type { TKey } from '@/i18n/dictionary'

const STATE_LABEL_KEYS: Record<string, TKey> = {
  idle:       'status.state.idle',
  rendering:  'status.state.rendering',
  ocr:        'status.state.ocr',
  extracting: 'status.state.extracting',
  done:       'status.state.done',
  error:      'status.state.error',
}

const STATE_COLORS: Record<string, string> = {
  idle:       'bg-border',
  rendering:  'bg-primary',
  ocr:        'bg-primary',
  extracting: 'bg-primary',
  done:       'bg-green-500',
  error:      'bg-destructive',
}

const isProcessing = (state: string) =>
  state !== 'idle' && state !== 'done' && state !== 'error'

interface Props {
  items: FileProcessingStatus[]
  pageStats: { done: number; total: number }
}

export default function ProcessingStatus({ items, pageStats }: Props) {
  const { t } = useT()
  const [previewFile, setPreviewFile] = useState<File | null>(null)

  if (items.length === 0) return null

  return (
    <>
      <div className="card p-5 animate-slide-up">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-foreground">{t('status.heading')}</h2>
          {pageStats.total > 0 && (
            <span className="text-sm font-semibold text-primary tabular-nums">
              {pageStats.done}/{pageStats.total}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-3">
          {items.map((item, i) => (
            <div key={i}>
              <div className="flex items-center justify-between mb-1.5">
                {/* left: file icon + name */}
                <div className="flex items-center gap-2 min-w-0">
                  <FileIcon state={item.state} />
                  <span className="text-sm text-foreground truncate max-w-xs">{item.file.name}</span>
                </div>

                {/* right: eye → bar loader (if processing) → status label */}
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <button
                    onClick={() => setPreviewFile(item.file)}
                    title={t('status.previewPdf')}
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                      <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
                    </svg>
                  </button>

                  {isProcessing(item.state) && (
                    <div className="flex items-end gap-[1.5px] h-4">
                      {[0, 1, 2, 3, 4].map((j) => (
                        <div
                          key={j}
                          className="bg-primary rounded-t-sm origin-bottom animate-bar-loader"
                          style={{ width: '2.5px', height: '14px', animationDelay: `${(j + 1) * 0.12}s` }}
                        />
                      ))}
                    </div>
                  )}

                  <span className={`text-xs font-medium ${
                    item.state === 'error' ? 'text-destructive' :
                    item.state === 'done'  ? 'text-green-600'   : 'text-primary'
                  }`}>
                    {t(STATE_LABEL_KEYS[item.state])}
                  </span>
                </div>
              </div>

              <div className="h-1 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${STATE_COLORS[item.state]} ${
                    isProcessing(item.state) ? 'animate-pulse' : ''
                  }`}
                  style={{ width: `${item.progress}%` }}
                />
              </div>

              {item.error && (
                <p className="text-xs text-destructive mt-1 leading-relaxed">
                  {item.error}
                  {item.error.toLowerCase().includes('quota') && (
                    <span className="block text-muted-foreground mt-0.5">
                      {t('status.quotaFix')}{' '}
                      <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                        aistudio.google.com
                      </a>
                    </span>
                  )}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      <PdfPreviewDialog file={previewFile} onClose={() => setPreviewFile(null)} />
    </>
  )
}

function FileIcon({ state }: { state: string }) {
  if (state === 'done') return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-green-500 shrink-0">
      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
    </svg>
  )
  if (state === 'error') return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-destructive shrink-0">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
    </svg>
  )
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-muted-foreground shrink-0">
      <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5z" />
    </svg>
  )
}
