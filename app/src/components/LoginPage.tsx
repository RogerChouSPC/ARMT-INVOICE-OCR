import { useState } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { useT } from '@/i18n/LanguageProvider'

interface Props {
  initError?: string | null
  isLoading?: boolean
}

export default function LoginPage({ initError, isLoading }: Props) {
  const { login } = useAuth()
  const { t } = useT()
  const [signing, setSigning] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const handleLogin = async () => {
    setSigning(true)
    setError(null)
    try {
      await login()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSigning(false)
    }
  }

  const displayError = error ?? initError
  const busy = isLoading || signing

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">

        <div className="flex flex-col items-center mb-12">
          <div className="h-16 w-16 rounded-2xl bg-primary flex items-center justify-center mb-5 shadow-button">
            <svg viewBox="0 0 24 24" className="w-8 h-8 fill-primary-foreground">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 4h6v6h6v10H6V4z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">SPC OCR</h1>
          <p className="text-base text-muted-foreground mt-2">{t('login.tagline')}</p>
        </div>

        <div className="border border-border rounded-2xl p-8 flex flex-col gap-5 shadow-card">

          {isLoading && !displayError && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="h-4 w-4 rounded-full border-2 border-muted-foreground border-t-transparent animate-spin flex-shrink-0" />
              {t('login.checkingSession')}
            </div>
          )}

          {displayError && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-xl px-4 py-3 break-words">
              {displayError}
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={busy}
            className="w-full flex items-center justify-center gap-3 px-4 py-3.5 bg-[#2F2F2F] hover:bg-[#1a1a1a] text-white rounded-xl text-sm font-semibold transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {signing ? (
              <div className="h-5 w-5 rounded-full border-2 border-white border-t-transparent animate-spin flex-shrink-0" />
            ) : (
              <svg width="20" height="20" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0">
                <rect x="1"  y="1"  width="9" height="9" fill="#F25022"/>
                <rect x="11" y="1"  width="9" height="9" fill="#7FBA00"/>
                <rect x="1"  y="11" width="9" height="9" fill="#00A4EF"/>
                <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
              </svg>
            )}
            {signing ? t('login.redirecting') : isLoading ? t('login.pleaseWait') : t('login.signIn')}
          </button>

          {signing && (
            <p className="text-xs text-muted-foreground text-center">
              {t('login.redirectNote')}
            </p>
          )}

          <p className="text-xs text-muted-foreground text-center">
            {t('login.authorisedOnly')}
          </p>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-8">
          {t('login.footer')}
        </p>

        <p className="text-center mt-3">
          <button
            onClick={() => {
              Object.keys(localStorage).filter(k => k.startsWith('msal.')).forEach(k => localStorage.removeItem(k))
              sessionStorage.clear()
              window.location.reload()
            }}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            {t('login.troubleSignIn')}
          </button>
        </p>

      </div>
    </div>
  )
}
