import { StrictMode, Component, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/index.css'
import App from '@/App'
import { AuthProvider } from '@/auth/AuthProvider'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      const err = this.state.error as Error
      return (
        <div style={{ padding: 40, fontFamily: 'system-ui', textAlign: 'center', color: '#333' }}>
          <h2 style={{ marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ color: '#666', fontSize: 13 }}>{err.message}</p>
          <button
            onClick={() => { localStorage.clear(); sessionStorage.clear(); window.location.reload() }}
            style={{ marginTop: 20, padding: '8px 20px', cursor: 'pointer', borderRadius: 8, border: '1px solid #ccc' }}
          >
            Clear data and reload
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
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>
)
