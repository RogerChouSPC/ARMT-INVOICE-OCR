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
  login: () => Promise<void>
  logout: () => void
  getToken: () => Promise<string | null>
}

const msalInstance = new PublicClientApplication(msalConfig)
const AuthContext = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    msalInstance.initialize().then(async () => {
      // Handle redirect callback if returning from login
      await msalInstance.handleRedirectPromise().catch(() => null)

      const accounts = msalInstance.getAllAccounts()
      if (accounts.length > 0) {
        const account = accounts[0]
        setUser({
          name:    account.name ?? account.username,
          email:   account.username,
          account,
        })
      }
      setLoading(false)
    })
  }, [])

  const login = async () => {
    try {
      const result = await msalInstance.loginPopup(loginRequest)
      setUser({
        name:    result.account.name ?? result.account.username,
        email:   result.account.username,
        account: result.account,
      })
    } catch (e) {
      console.error('Login failed', e)
      throw e
    }
  }

  const logout = () => {
    msalInstance.logoutPopup({ account: user?.account })
    setUser(null)
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
        const result = await msalInstance.acquireTokenPopup({ ...loginRequest, account: user.account })
        return result.accessToken
      }
      return null
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, getToken }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
