import { useState } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '@/auth/AuthProvider'

interface Props {
  initError?: string | null
  isLoading?: boolean
}

export default function LoginPage({ initError, isLoading }: Props) {
  const { login } = useAuth()
  const [signing, setSigning] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const handleLogin = async () => {
    setSigning(true)
    setError(null)
    try {
      await login()
    } catch (e) {
      setError(`Sign-in failed: ${(e as Error).message}`)
      setSigning(false)
    }
  }

  const handleClearAndRetry = () => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('msal.')) localStorage.removeItem(key)
    }
    sessionStorage.clear()
    window.location.reload()
  }

  const displayError = error ?? initError
  const busy = isLoading || signing

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-sm"
      >
        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <div className="h-14 w-14 rounded-3xl bg-primary flex items-center justify-center mb-4 shadow-button">
            <svg viewBox="0 0 24 24" className="w-7 h-7 fill-primary-foreground">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 4h6v6h6v10H6V4z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">SPC OCR Invoice</h1>
          <p className="text-sm text-muted-foreground mt-1">Thai Invoice Extractor · Gemini AI</p>
        </div>

        {/* Card */}
        <div className="card p-8 flex flex-col gap-5">
          <div>
            <h2 className="text-base font-semibold text-foreground">Sign in to continue</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Use your company Microsoft 365 account to access this tool.
            </p>
          </div>

          {isLoading && !displayError && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="h-4 w-4 rounded-full border-2 border-muted-foreground border-t-transparent animate-spin flex-shrink-0" />
              Checking session…
            </div>
          )}

          {displayError && (
            <div className="flex flex-col gap-2">
              <div className="text-sm text-destructive bg-destructive/10 rounded-2xl px-4 py-3 break-words">
                {displayError}
              </div>
              <button
                onClick={handleClearAndRetry}
                className="text-xs text-muted-foreground underline underline-offset-2 self-start pl-1 hover:text-foreground"
              >
                Clear session and try again
              </button>
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={busy}
            className="w-full flex items-center gap-3 px-4 py-3 bg-[#2F2F2F] hover:bg-[#1a1a1a] text-white rounded-xl text-sm font-medium transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {signing ? (
              <div className="h-5 w-5 rounded-full border-2 border-white border-t-transparent animate-spin flex-shrink-0" />
            ) : (
              <svg width="20" height="20" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0">
                <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
                <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
                <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
                <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
              </svg>
            )}
            {signing ? 'Redirecting to Microsoft…' : isLoading ? 'Please wait…' : 'Sign in with Microsoft'}
          </button>

          <p className="text-xs text-muted-foreground text-center">
            Access is restricted to authorised company accounts only.
          </p>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-8">
          ARMT Invoice OCR · Confidential internal tool
        </p>
      </motion.div>
    </div>
  )
}
