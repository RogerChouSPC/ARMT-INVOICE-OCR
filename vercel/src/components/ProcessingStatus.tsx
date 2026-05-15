import type { FileProcessingStatus } from '@/types/invoice'

const STATE_LABELS: Record<string, string> = {
  idle:       'Waiting',
  rendering:  'Rendering pages',
  ocr:        'Running OCR',
  extracting: 'Extracting fields',
  done:       'Done',
  error:      'Error',
}

interface Props { items: FileProcessingStatus[] }

export default function ProcessingStatus({ items }: Props) {
  if (items.length === 0) return null

  return (
    <div className="animate-slide-up" style={{ border: '1px solid #2A2824', borderRadius: '4px', background: '#141310', padding: '1.5rem' }}>
      <p className="font-mono text-[10px] tracking-widest uppercase text-gold mb-5 opacity-70">Processing</p>
      <div className="flex flex-col gap-4">
        {items.map((item, i) => (
          <div key={i}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3 min-w-0">
                <StatusDot state={item.state} />
                <span className="font-mono text-xs text-cream truncate max-w-xs opacity-80">{item.file.name}</span>
              </div>
              <span className={`font-mono text-[10px] tracking-widest uppercase ml-4 shrink-0 ${
                item.state === 'error' ? 'text-danger' :
                item.state === 'done'  ? 'text-gold' : 'text-muted'
              }`}>
                {STATE_LABELS[item.state]}
              </span>
            </div>

            {/* Progress track */}
            <div className="h-px w-full" style={{ background: '#2A2824' }}>
              <div
                className="h-px transition-all duration-500"
                style={{
                  width: `${item.progress}%`,
                  background: item.state === 'error' ? '#C0392B' : item.state === 'done' ? '#C9A84C' : 'rgba(201,168,76,0.6)',
                  boxShadow: item.state !== 'idle' && item.state !== 'error' ? '0 0 8px rgba(201,168,76,0.4)' : 'none',
                }}
              />
            </div>

            {item.error && (
              <p className="font-mono text-[11px] text-danger mt-2 leading-relaxed">
                {item.error}
                {item.error.toLowerCase().includes('quota') && (
                  <span className="block text-faint mt-1">
                    Fix: enable billing at{' '}
                    <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-gold underline">aistudio.google.com</a>
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

function StatusDot({ state }: { state: string }) {
  const base = 'w-1.5 h-1.5 rounded-full shrink-0'
  if (state === 'done')  return <span className={`${base} bg-gold`} />
  if (state === 'error') return <span className={`${base} bg-danger`} />
  if (state === 'idle')  return <span className={`${base} bg-faint`} />
  return <span className={`${base} bg-gold animate-pulse`} style={{ boxShadow: '0 0 6px rgba(201,168,76,0.6)' }} />
}
