import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { PublicClientApplication, AccountInfo, InteractionRequiredAuthError, BrowserAuthError } from '@azure/msal-browser'
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

export const msalInstance = new PublicClientApplication(msalConfig)

function accountToUser(account: AccountInfo): AuthUser {
  return { name: account.name ?? account.username, email: account.username, account }
}

const AuthContext = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const init = async () => {
      try {
        await msalInstance.initialize()

        // Only call handleRedirectPromise if the URL actually contains an auth code.
        // On a plain refresh there is nothing to process, so skip it and just read
        // the account cache directly — this avoids the 3s stall.
        const hasCode =
          window.location.hash.includes('code=') ||
          window.location.search.includes('code=')

        if (hasCode) {
          const result = await msalInstance.handleRedirectPromise({ navigateToLoginRequestUrl: false })
          if (result?.account) {
            setUser(accountToUser(result.account))
            return
          }
        }

        const accounts = msalInstance.getAllAccounts()
        if (accounts.length > 0) setUser(accountToUser(accounts[0]))
      } catch (e) {
        console.error('MSAL init error:', e)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  const login = async () => {
    try {
      const result = await msalInstance.loginPopup(loginRequest)
      if (result.account) setUser(accountToUser(result.account))
    } catch (e) {
      const code = (e as BrowserAuthError)?.errorCode ?? ''
      if (code === 'popup_window_error' || code === 'empty_window_error' || code === 'user_cancelled') {
        throw new Error(
          'The sign-in popup was blocked or closed. ' +
          'Please allow popups for this site in your browser and try again.'
        )
      }
      throw e
    }
  }

  const logout = () => {
    msalInstance.logoutPopup({ account: user?.account }).catch(() => {
      setUser(null)
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
    <AuthContext.Provider value={{ user, loading, error: null, login, logout, getToken }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
