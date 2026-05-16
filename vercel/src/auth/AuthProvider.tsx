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

// Clear stale MSAL state from localStorage to prevent cache/state mismatch errors
function clearMsalCache() {
  Object.keys(localStorage)
    .filter(k => k.startsWith('msal.'))
    .forEach(k => localStorage.removeItem(k))
}

const AuthContext = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    const init = async () => {
      try {
        const instance = new PublicClientApplication(msalConfig)
        await instance.initialize()

        const result = await instance.handleRedirectPromise()

        if (result?.account) {
          setUser({
            name:    result.account.name ?? result.account.username,
            email:   result.account.username,
            account: result.account,
          })
        } else {
          const accounts = instance.getAllAccounts()
          if (accounts.length > 0) {
            setUser({
              name:    accounts[0].name ?? accounts[0].username,
              email:   accounts[0].username,
              account: accounts[0],
            })
          }
        }
      } catch (e) {
        // Clear stale cache so the next login attempt starts fresh
        clearMsalCache()
        const msg = (e as Error).message ?? String(e)
        console.error('MSAL init error:', msg)
        setError(`Sign-in error: ${msg}`)
      } finally {
        setLoading(false)
      }
    }

    init()
  }, [])

  const login = async () => {
    // Always start with a clean slate to avoid interaction_in_progress / cache errors
    clearMsalCache()
    const instance = new PublicClientApplication(msalConfig)
    await instance.initialize()
    await instance.loginRedirect(loginRequest)
  }

  const logout = () => {
    const instance = new PublicClientApplication(msalConfig)
    instance.initialize().then(() => {
      instance.logoutRedirect({
        postLogoutRedirectUri: window.location.origin,
      })
    })
  }

  const getToken = async (): Promise<string | null> => {
    if (!user) return null
    try {
      const instance = new PublicClientApplication(msalConfig)
      await instance.initialize()
      const result = await instance.acquireTokenSilent({
        ...loginRequest,
        account: user.account,
      })
      return result.accessToken
    } catch (e) {
      if (e instanceof InteractionRequiredAuthError) {
        const instance = new PublicClientApplication(msalConfig)
        await instance.initialize()
        await instance.acquireTokenRedirect({ ...loginRequest, account: user.account })
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
