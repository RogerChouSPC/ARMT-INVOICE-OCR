import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { DropdownMenu } from 'radix-ui'

const CUSTOMERS = [
  'Aeon', 'Big C', 'Big C Food', 'Boots', 'BTM',
  'CFM', 'CFR', 'CFW', 'CJ', 'CMK', 'CP All',
  'Foodland', 'HomePro', 'Lotus', 'Makro', 'PTT',
  'TFG', 'The Mall', 'Tsuruha', 'Villa', 'Watson',
]

export default function CustomerCycle() {
  const [index, setIndex] = useState(0)

  // setTimeout pattern — resets every time index changes, no drift
  useEffect(() => {
    const id = setTimeout(() => {
      setIndex(i => (i + 1) % CUSTOMERS.length)
    }, 2400)
    return () => clearTimeout(id)
  }, [index])

  return (
    <div className="flex items-center gap-3">
      {/* overflow-hidden clips the spring motion above/below */}
      <span className="relative flex justify-center overflow-hidden font-bold tracking-tight leading-[1.2] py-1">
        {/* invisible widest-name spacer gives the container correct width + height */}
        <span className="invisible select-none" aria-hidden>Big C Food</span>

        {CUSTOMERS.map((name, i) => (
          <motion.span
            key={i}
            className="absolute text-primary"
            initial={{ opacity: 0, y: 100 }}
            transition={{ type: 'spring', stiffness: 50 }}
            animate={
              index === i
                ? { y: 0, opacity: 1 }
                : { y: index > i ? -100 : 100, opacity: 0 }
            }
          >
            {name}
          </motion.span>
        ))}
      </span>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            className="w-5 h-5 rounded-full border border-muted-foreground/40 text-muted-foreground/50 hover:text-primary hover:border-primary transition-colors flex items-center justify-center text-[11px] font-bold self-center flex-shrink-0 outline-none"
            title="View all supported customers"
          >
            i
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            sideOffset={8}
            align="center"
            className="z-50 w-56 overflow-hidden rounded-xl border border-border bg-background p-4 shadow-card-hover outline-none animate-fade-in"
          >
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              {CUSTOMERS.length} supported customers
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {CUSTOMERS.map(c => (
                <span key={c} className="text-xs text-foreground">{c}</span>
              ))}
            </div>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}
