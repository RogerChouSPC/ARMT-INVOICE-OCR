import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/index.css'
import App from '@/App'
import { AuthProvider } from '@/auth/AuthProvider'
import { PublicClientApplication } from '@azure/msal-browser'
import { msalConfig } from '@/auth/msalConfig'

// When Microsoft redirects back from OAuth, it loads this page inside the popup
// that loginPopup opened. Don't render the React app in that context — just let
// MSAL process the auth code and close the popup.
const isPopupCallback = window.opener !== null && window.opener !== window

if (isPopupCallback) {
  const instance = new PublicClientApplication(msalConfig)
  instance.initialize()
    .then(() => instance.handleRedirectPromise({ navigateToLoginRequestUrl: false }))
    .catch(console.error)
    .finally(() => {
      // MSAL should call window.close() itself; this is a fallback
      setTimeout(() => { try { window.close() } catch { /* ignore */ } }, 2000)
    })
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AuthProvider>
        <App />
      </AuthProvider>
    </StrictMode>
  )
}
