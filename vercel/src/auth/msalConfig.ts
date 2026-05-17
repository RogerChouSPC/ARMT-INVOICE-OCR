import { Configuration, PopupRequest } from '@azure/msal-browser'

export const popupRedirectUri = `${window.location.origin}/popup.html`

export const msalConfig: Configuration = {
  auth: {
    clientId:    import.meta.env.VITE_AZURE_CLIENT_ID,
    authority:   `https://login.microsoftonline.com/${import.meta.env.VITE_AZURE_TENANT_ID}`,
    redirectUri: popupRedirectUri,
  },
  cache: {
    cacheLocation: 'localStorage',
  },
}

export const loginRequest: PopupRequest = {
  scopes: ['openid', 'profile', 'email'],
  redirectUri: popupRedirectUri,
}
