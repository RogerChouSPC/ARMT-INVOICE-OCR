import { useState } from 'react'
import { motion } from 'framer-motion'
import { Sparkles, LogOut, Sun, Moon, Zap, ZapOff, ChevronDown } from 'lucide-react'
import { useTheme } from '@/hooks/useTheme'
import { useT } from '@/i18n/LanguageProvider'
import type { TKey } from '@/i18n/dictionary'

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
const EXTRACT_SUBPAGES: { tab: Tab; labelKey: TKey; descKey: TKey }[] = [
  { tab: 'ocr', labelKey: 'header.extractInvoices', descKey: 'header.extractInvoices.desc' },
  { tab: 'customer-master', labelKey: 'header.customerMaster', descKey: 'header.customerMaster.desc' },
]

export default function Header({ activeTab, onTabChange, user, onLogout, liveEnabled, onToggleLive }: HeaderProps) {
  const { dark, toggle } = useTheme()
  const { t, lang, setLang } = useT()
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
                {t('header.invoiceExtract')}
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${extractOpen ? 'rotate-180' : ''}`} />
              </button>

              {extractOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setExtractOpen(false)} aria-hidden="true" />
                  <div className="absolute left-0 top-full z-40 w-64 rounded-lg border border-border bg-background shadow-lg py-1">
                    {EXTRACT_SUBPAGES.map(({ tab, labelKey, descKey }) => (
                      <button
                        key={tab}
                        onClick={() => { onTabChange(tab); setExtractOpen(false) }}
                        className={`w-full text-left px-3 py-2 transition-colors ${
                          activeTab === tab ? 'bg-primary/10' : 'hover:bg-muted'
                        }`}
                      >
                        <div className={`text-sm font-medium ${activeTab === tab ? 'text-primary' : 'text-foreground'}`}>{t(labelKey)}</div>
                        <div className="text-[11px] text-muted-foreground">{t(descKey)}</div>
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
              {t('header.makroExtract')}
            </button>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {/* TH/EN language toggle — one click switches + persists immediately */}
          <button
            onClick={() => setLang(lang === 'th' ? 'en' : 'th')}
            aria-label={lang === 'th' ? t('header.lang.toEn') : t('header.lang.toTh')}
            aria-pressed={lang === 'en'}
            title={lang === 'th' ? t('header.lang.toEn') : t('header.lang.toTh')}
            className="flex items-center h-8 rounded-full bg-muted p-0.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className={`px-2 py-1 rounded-full transition-colors ${lang === 'th' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>
              ไทย
            </span>
            <span className={`px-2 py-1 rounded-full transition-colors ${lang === 'en' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>
              EN
            </span>
          </button>

          <button
            onClick={onToggleLive}
            title={liveEnabled ? t('header.live.on') : t('header.live.off')}
            className={`flex items-center gap-1.5 h-8 px-2.5 rounded-full text-xs font-medium transition-colors ${
              liveEnabled
                ? 'text-primary bg-primary/10 hover:bg-primary/20'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            {liveEnabled ? <Zap className="h-3.5 w-3.5" /> : <ZapOff className="h-3.5 w-3.5" />}
            {t('header.live.label')}
          </button>

          <button
            onClick={toggle}
            title={dark ? t('header.theme.toLight') : t('header.theme.toDark')}
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
              title={t('header.signOut')}
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
