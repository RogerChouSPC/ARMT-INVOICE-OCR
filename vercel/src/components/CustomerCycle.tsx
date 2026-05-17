import { useState, useEffect, useRef } from 'react'

const CUSTOMERS = [
  'Aeon', 'Big C', 'Big C Food', 'Boots', 'BTM',
  'CFM', 'CFR', 'CFW', 'CJ', 'CMK', 'CP All',
  'Foodland', 'HomePro', 'Lotus', 'Makro', 'PTT',
  'TFG', 'The Mall', 'Tsuruha', 'Villa', 'Watson',
]

export default function CustomerCycle() {
  const [index, setIndex]       = useState(0)
  const [visible, setVisible]   = useState(true)
  const [showList, setShowList] = useState(false)
  const wrapperRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const id = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setIndex(i => (i + 1) % CUSTOMERS.length)
        setVisible(true)
      }, 400)
    }, 3600)
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
    <span className="inline-flex items-baseline gap-2" ref={wrapperRef}>
      <span
        className="text-primary transition-opacity duration-[400ms] ease-in-out"
        style={{ opacity: visible ? 1 : 0 }}
      >
        {CUSTOMERS[index]}
      </span>

      <span className="relative inline-flex items-center self-center">
        <button
          onClick={() => setShowList(v => !v)}
          title="View all supported customers"
          className="w-[18px] h-[18px] rounded-full border border-muted-foreground/40 text-muted-foreground/50 hover:text-primary hover:border-primary transition-colors inline-flex items-center justify-center text-[10px] font-bold flex-shrink-0"
        >
          i
        </button>

        {showList && (
          <div className="absolute left-1/2 -translate-x-1/2 top-6 z-20 bg-background border border-border rounded-xl shadow-card-hover p-4 w-56 animate-fade-in">
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
      </span>
    </span>
  )
}
