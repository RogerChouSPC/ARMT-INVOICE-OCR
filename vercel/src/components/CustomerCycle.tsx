import { useState, useEffect, useRef } from 'react'

const CUSTOMERS = [
  'Aeon', 'Big C', 'Big C Food', 'Boots', 'BTM',
  'CFM', 'CFR', 'CFW', 'CJ', 'CMK', 'CP All',
  'Foodland', 'HomePro', 'Lotus', 'Makro', 'PTT',
  'TFG', 'The Mall', 'Tsuruha', 'Villa', 'Watson',
]

export default function CustomerCycle() {
  const [index, setIndex]       = useState(0)
  const [animKey, setAnimKey]   = useState(0)
  const [showList, setShowList] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const id = setInterval(() => {
      setIndex(i => (i + 1) % CUSTOMERS.length)
      setAnimKey(k => k + 1)
    }, 2400)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!showList) return
    const fn = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowList(false)
      }
    }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [showList])

  return (
    <div className="relative inline-block" ref={wrapperRef}>
      <p className="text-xl text-muted-foreground">
        Supported for{' '}
        <span
          key={animKey}
          className="text-primary font-semibold animate-slide-up inline-block"
        >
          {CUSTOMERS[index]}
        </span>
        {' '}
        <button
          onClick={() => setShowList(v => !v)}
          title="View all supported customers"
          className="w-[17px] h-[17px] rounded-full border border-muted-foreground/40 text-muted-foreground/50 hover:text-primary hover:border-primary transition-colors inline-flex items-center justify-center text-[10px] font-bold align-middle mb-0.5"
        >
          i
        </button>
      </p>

      {showList && (
        <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-20 bg-background border border-border rounded-xl shadow-card-hover p-4 w-56 animate-fade-in">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            {CUSTOMERS.length} supported customers
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {CUSTOMERS.map(c => (
              <span key={c} className="text-xs text-foreground">{c}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
