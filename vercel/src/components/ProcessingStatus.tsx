import type { FileProcessingStatus } from '@/types/invoice'

const STATE_LABELS: Record<string, string> = {
  idle:       'Waiting',
  rendering:  'Rendering pages…',
  ocr:        'Running OCR…',
  extracting: 'Extracting fields…',
  done:       'Done',
  error:      'Error',
}

const STATE_COLORS: Record<string, string> = {
  idle:       'bg-border',
  rendering:  'bg-primary',
  ocr:        'bg-primary',
  extracting: 'bg-primary',
  done:       'bg-green-500',
  error:      'bg-destructive',
}

interface Props { items: FileProcessingStatus[] }

export default function ProcessingStatus({ items }: Props) {
  if (items.length === 0) return null

  return (
    <div className="card p-5 animate-slide-up">
      <h2 className="text-sm font-semibold text-foreground mb-4">Processing</h2>
      <div className="flex flex-col gap-3">
        {items.map((item, i) => (
          <div key={i}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <FileIcon state={item.state} />
                <span className="text-sm text-foreground truncate max-w-xs">{item.file.name}</span>
              </div>
              <span className={`text-xs font-medium ml-3 shrink-0 ${
                item.state === 'error' ? 'text-destructive' :
                item.state === 'done'  ? 'text-green-600'   : 'text-primary'
              }`}>
                {STATE_LABELS[item.state]}
              </span>
            </div>

            <div className="h-1 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${STATE_COLORS[item.state]} ${
                  item.state !== 'idle' && item.state !== 'done' && item.state !== 'error' ? 'animate-pulse' : ''
                }`}
                style={{ width: `${item.progress}%` }}
              />
            </div>

            {item.error && (
              <p className="text-xs text-destructive mt-1 leading-relaxed">
                {item.error}
                {item.error.toLowerCase().includes('quota') && (
                  <span className="block text-muted-foreground mt-0.5">
                    Fix: enable billing at{' '}
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
  if (state !== 'idle') return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-primary animate-spin-slow shrink-0">
      <path d="M12 4V2C6.48 2 2 6.48 2 12h2c0-4.42 3.58-8 8-8z" />
    </svg>
  )
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-muted-foreground shrink-0">
      <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5z" />
    </svg>
  )
}
