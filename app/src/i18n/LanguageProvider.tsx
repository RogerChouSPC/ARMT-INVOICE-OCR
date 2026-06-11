import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { th, en, COLUMN_LABELS, type TKey } from './dictionary'

export type Lang = 'th' | 'en'

const STORAGE_KEY = 'armt_lang'
const DICTS: Record<Lang, Record<TKey, string>> = { th, en }

interface LanguageContextValue {
  lang: Lang
  setLang: (lang: Lang) => void
  /** Translate a key. Optional `vars` interpolate `{name}` placeholders.
   *  A missing key falls back to the English string, then to the key id —
   *  it never renders blank. */
  t: (key: TKey, vars?: Record<string, string | number>) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

function readStored(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'th' || v === 'en') return v
  } catch { /* ignore */ }
  return 'th' // default to Thai for Thai AP/finance staff
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStored)

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* ignore */ }
  }, [])

  const t = useCallback(
    (key: TKey, vars?: Record<string, string | number>) => {
      const dict = DICTS[lang]
      // Fall back to English, then to the raw key id — never blank.
      const template = dict[key] ?? en[key] ?? key
      return interpolate(template, vars)
    },
    [lang]
  )

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useT() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useT must be used within a LanguageProvider')
  return ctx
}

/** Localized human-readable column header for an InvoiceRow field id. */
export function useColumnLabel() {
  const { lang } = useT()
  return useCallback(
    (key: keyof typeof COLUMN_LABELS) => COLUMN_LABELS[key][lang],
    [lang]
  )
}
