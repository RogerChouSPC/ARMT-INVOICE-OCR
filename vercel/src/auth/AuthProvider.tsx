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
      // Process the redirect response if returning from Microsoft login
      const result = await msalInstance.handleRedirectPromise().catch(() => null)

      if (result?.account) {
        setUser({
          name:  result.account.name ?? result.account.username,
          email: result.account.username,
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
      setLoading(false)
    })
  }, [])

  // Full-page redirect to Microsoft — no popup, works in all browsers
  const login = async () => {
    await msalInstance.loginRedirect(loginRequest)
  }

  const logout = () => {
    msalInstance.logoutRedirect({ account: user?.account, postLogoutRedirectUri: window.location.origin })
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
        // Silent failed — do a redirect to refresh token
        await msalInstance.acquireTokenRedirect({ ...loginRequest, account: user.account })
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
