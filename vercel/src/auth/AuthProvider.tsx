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

// Single shared instance — must not be re-created (token cache lives in memory here)
const msalInstance = new PublicClientApplication(msalConfig)

// Clear only MSAL interaction/request state; leave token/account cache intact
function clearInteractionState() {
  for (const key of Object.keys(localStorage)) {
    if (key.includes('.interaction.') || key.includes('.request.params') || key.includes('.nonce.')) {
      localStorage.removeItem(key)
    }
  }
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
        const result = await msalInstance.handleRedirectPromise()

        if (result?.account) {
          setUser({
            name:    result.account.name ?? result.account.username,
            email:   result.account.username,
            account: result.account,
          })
        } else {
          const accounts = msalInstance.getAllAccounts()
          if (accounts.length > 0) {
            setUser({
              name:    accounts[0].name ?? accounts[0].username,
              email:   accounts[0].username,
              account: accounts[0],
            })
          }
        }
      } catch (e) {
        // Clear stale interaction state so the next login attempt starts fresh
        clearInteractionState()
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
    // Clear stale interaction state to prevent interaction_in_progress errors
    clearInteractionState()
    await msalInstance.loginRedirect(loginRequest)
  }

  const logout = () => {
    msalInstance.logoutRedirect({
      account: user?.account,
      postLogoutRedirectUri: window.location.origin,
    })
  }

  const getToken = async (): Promise<string | null> => {
    if (!user) return null
    try {
      const result = await msalInstance.acquireTokenSilent({
        ...loginRequest,
        account: user.account,
      })
      return result.accessToken
    } catch (e) {
      if (e instanceof InteractionRequiredAuthError) {
        await msalInstance.acquireTokenRedirect({ ...loginRequest, account: user.account })
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
