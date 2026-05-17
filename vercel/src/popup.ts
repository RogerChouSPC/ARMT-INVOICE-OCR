import { PublicClientApplication } from '@azure/msal-browser'
import { msalConfig } from './auth/msalConfig'

const instance = new PublicClientApplication(msalConfig)
instance.initialize().then(() => instance.handleRedirectPromise()).catch(console.error)
