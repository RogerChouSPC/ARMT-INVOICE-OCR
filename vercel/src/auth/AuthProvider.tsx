import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { PublicClientApplication, AccountInfo, InteractionRequiredAuthError } from '@azure/msal-browser'
import { msalConfig, loginRequest } from './msalConfig'

interface AuthUser {
  name: string
  email: string
  account: AccountInfo
}

interface AuthCtx {
  user: AuthUser | null
  loading: boolean
  error: string | null
  login: () => Promise<void>
  logout: () => void
  getToken: () => Promise<string | null>
}

function clearMsalStorage() {
  Object.keys(localStorage).filter(k => k.startsWith('msal.')).forEach(k => localStorage.removeItem(k))
  Object.keys(sessionStorage).filter(k => k.startsWith('msal.')).forEach(k => sessionStorage.removeItem(k))
}

// If the constructor throws due to corrupt localStorage, clear and retry once
let msalInstance: PublicClientApplication
try {
  msalInstance = new PublicClientApplication(msalConfig)
} catch {
  clearMsalStorage()
  msalInstance = new PublicClientApplication(msalConfig)
}
export { msalInstance }

function accountToUser(account: AccountInfo): AuthUser {
  return { name: account.name ?? account.username, email: account.username, account }
}

const AuthContext = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    const init = async () => {
      try {
        await msalInstance.initialize()
        // Process any pending redirect response (from loginRedirect flow)
        const result = await msalInstance.handleRedirectPromise({ navigateToLoginRequestUrl: false })
        if (result?.account) {
          setUser(accountToUser(result.account))
        } else {
          const accounts = msalInstance.getAllAccounts()
          if (accounts.length > 0) setUser(accountToUser(accounts[0]))
        }
      } catch (e) {
        console.error('MSAL init error:', e)
        setError((e as Error).message ?? 'Auth initialisation failed')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  const login = async () => {
    // loginRedirect navigates the browser to Microsoft — does not return
    await msalInstance.loginRedirect(loginRequest)
  }

  const logout = () => {
    msalInstance.logoutRedirect({
      account: user?.account,
      postLogoutRedirectUri: window.location.origin,
    }).catch(() => {
      setUser(null)
      clearMsalStorage()
      window.location.reload()
    })
  }

  const getToken = async (): Promise<string | null> => {
    if (!user) return null
    try {
      const result = await msalInstance.acquireTokenSilent({ ...loginRequest, account: user.account })
      return result.accessToken
    } catch (e) {
      if (e instanceof InteractionRequiredAuthError) {
        try {
          const result = await msalInstance.acquireTokenPopup({ ...loginRequest, account: user.account })
          return result.accessToken
        } catch { return null }
      }
      return null
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, error, login, logout, getToken }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
