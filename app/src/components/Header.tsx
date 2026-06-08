import { useState } from 'react'
import { motion } from 'framer-motion'
import { Sparkles, LogOut, Sun, Moon, Zap, ZapOff, ChevronDown } from 'lucide-react'
import { useTheme } from '@/hooks/useTheme'

type Tab = 'ocr' | 'customer-master' | 'payment-advice'

interface HeaderProps {
  rowCount: number
  activeTab: Tab
  onTabChange: (tab: Tab) => void
  user: { name: string; email: string } | null
  onLogout: () => void
  liveEnabled: boolean
  onToggleLive: () => void
}

// "Invoice Extract" is a tool with two pages: the extractor itself and the
// Customer Master lookup table it uses — so Customer Master is a sub-item in its
// dropdown, not a separate top-level page. "Makro Invoice Extract" is its own tool.
const EXTRACT_SUBPAGES: { tab: Tab; label: string; desc: string }[] = [
  { tab: 'ocr', label: 'Extract Invoices', desc: 'Read supplier invoices with AI' },
  { tab: 'customer-master', label: 'Customer Master', desc: 'Vendor lookup table used by extraction' },
]

export default function Header({ activeTab, onTabChange, user, onLogout, liveEnabled, onToggleLive }: HeaderProps) {
  const { dark, toggle } = useTheme()
  const [extractOpen, setExtractOpen] = useState(false)
  const extractActive = activeTab === 'ocr' || activeTab === 'customer-master'

  return (
    <header className="sticky top-0 z-20 border-t-[3px] border-t-primary bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border">
      <div className="w-full px-6 h-14 flex items-center justify-between">

        <div className="flex items-center h-full gap-6">
          <div className="flex items-center gap-2">
            <motion.div
              whileHover={{ rotate: 5, scale: 1.1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 10 }}
              className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center"
            >
              <Sparkles className="h-3.5 w-3.5 text-primary-foreground" />
            </motion.div>
            <span className="font-semibold text-sm tracking-tight">SPC OCR</span>
          </div>

          <nav className="flex items-center h-full">
            {/* Invoice Extract — tool with a dropdown of its pages (Extract + Customer Master) */}
            <div className="relative h-full">
              <button
                onClick={() => setExtractOpen((o) => !o)}
                className={`h-full px-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-1 ${
                  extractActive ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                Invoice Extract
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${extractOpen ? 'rotate-180' : ''}`} />
              </button>

              {extractOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setExtractOpen(false)} aria-hidden="true" />
                  <div className="absolute left-0 top-full z-40 w-64 rounded-lg border border-border bg-background shadow-lg py-1">
                    {EXTRACT_SUBPAGES.map(({ tab, label, desc }) => (
                      <button
                        key={tab}
                        onClick={() => { onTabChange(tab); setExtractOpen(false) }}
                        className={`w-full text-left px-3 py-2 transition-colors ${
                          activeTab === tab ? 'bg-primary/10' : 'hover:bg-muted'
                        }`}
                      >
                        <div className={`text-sm font-medium ${activeTab === tab ? 'text-primary' : 'text-foreground'}`}>{label}</div>
                        <div className="text-[11px] text-muted-foreground">{desc}</div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Makro Invoice Extract — separate tool */}
            <button
              onClick={() => onTabChange('payment-advice')}
              className={`h-full px-4 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'payment-advice' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Makro Invoice Extract
            </button>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onToggleLive}
            title={liveEnabled ? 'Turn off background animation' : 'Turn on background animation'}
            className={`flex items-center gap-1.5 h-8 px-2.5 rounded-full text-xs font-medium transition-colors ${
              liveEnabled
                ? 'text-primary bg-primary/10 hover:bg-primary/20'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            {liveEnabled ? <Zap className="h-3.5 w-3.5" /> : <ZapOff className="h-3.5 w-3.5" />}
            Live
          </button>

          <button
            onClick={toggle}
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="h-8 w-8 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          {user && (
          <div className="flex items-center gap-2 pl-3 border-l border-border">
            <div className="text-right hidden sm:block">
              <p className="text-xs font-medium text-foreground leading-tight">{user.name}</p>
              <p className="text-[11px] text-muted-foreground leading-tight">{user.email}</p>
            </div>
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <button
              onClick={onLogout}
              title="Sign out"
              className="h-8 w-8 flex items-center justify-center rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
        </div>
      </div>
    </header>
  )
}
