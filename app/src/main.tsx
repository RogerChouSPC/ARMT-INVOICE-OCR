import { StrictMode, Component, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/index.css'
import App from '@/App'
import { AuthProvider } from '@/auth/AuthProvider'
import { LanguageProvider } from '@/i18n/LanguageProvider'
import { th, en } from '@/i18n/dictionary'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      const err = this.state.error as Error
      // The boundary sits above the LanguageProvider, so read the stored
      // language directly rather than via the hook.
      const lang = (() => { try { return localStorage.getItem('armt_lang') === 'en' ? en : th } catch { return th } })()
      return (
        <div style={{ padding: 40, fontFamily: 'system-ui', textAlign: 'center', color: '#333' }}>
          <h2 style={{ marginBottom: 8 }}>{lang['error.title']}</h2>
          <p style={{ color: '#666', fontSize: 13 }}>{err.message}</p>
          <button
            onClick={() => { localStorage.clear(); sessionStorage.clear(); window.location.reload() }}
            style={{ marginTop: 20, padding: '8px 20px', cursor: 'pointer', borderRadius: 8, border: '1px solid #ccc' }}
          >
            {lang['error.clearReload']}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <LanguageProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </LanguageProvider>
    </ErrorBoundary>
  </StrictMode>
)
