// Minimal popup OAuth callback handler.
// Loaded by popup.html when Microsoft redirects back after login.
// Processes the auth code and hands the result to the parent window via MSAL,
// then closes this popup window.
import { PublicClientApplication } from '@azure/msal-browser'

const instance = new PublicClientApplication({
  auth: {
    clientId:    import.meta.env.VITE_AZURE_CLIENT_ID,
    authority:   `https://login.microsoftonline.com/${import.meta.env.VITE_AZURE_TENANT_ID}`,
    redirectUri: `${window.location.origin}/popup.html`,
  },
  cache: { cacheLocation: 'localStorage' },
})

instance.initialize()
  .then(() => instance.handleRedirectPromise())
  .catch(console.error)
  .finally(() => {
    // MSAL closes the popup itself; this is a safety fallback
    setTimeout(() => { try { window.close() } catch { /* ignore */ } }, 3000)
  })
