import { Configuration, RedirectRequest } from '@azure/msal-browser'

// BASE_URL includes trailing slash (e.g. /armt-invoice-ocr/ on production).
const base = import.meta.env.BASE_URL
export const redirectUri = `${window.location.origin}${base}popup.html`

export const msalConfig: Configuration = {
  auth: {
    clientId:                 import.meta.env.VITE_AZURE_CLIENT_ID,
    authority:                `https://login.microsoftonline.com/${import.meta.env.VITE_AZURE_TENANT_ID}`,
    redirectUri,
  },
  cache: {
    cacheLocation: 'localStorage',
  },
}

export const loginRequest: RedirectRequest = {
  scopes: ['openid', 'profile', 'email'],
  redirectUri,
}
