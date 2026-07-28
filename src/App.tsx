import { useEffect, useState } from 'react'
import {
  logout as logoutSession,
  resolveInitialSession,
  type AuthUser,
} from './api/authClient'
import { AuthChecking, LoginScreen } from './components/auth/AuthScreens'
import { SiteLayout } from './components/layout/SiteLayout'
import { IS_GITHUB_PAGES_DEMO } from './config/runtime'
import { AccountPage } from './pages/AccountPage'
import { CartPage } from './pages/CartPage'
import { FavoritesPage } from './pages/FavoritesPage'
import { HomePage } from './pages/HomePage'
import { MarketPage } from './pages/MarketPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ProductPage } from './pages/ProductPage'
import { PublishPage } from './pages/PublishPage'
import { StoryPage } from './pages/StoryPage'
import { useLocation } from './router/AppRouter'
import { AppStoreProvider } from './state/AppStore'

type AuthState = 'checking' | 'signed-out' | 'signed-in'

function RouteContent({ onLogout }: { onLogout: () => Promise<void> }) {
  // 认证完成后再挂载业务页面，避免不同用户之间短暂复用上一份状态。
  const { pathname } = useLocation()
  let page

  if (pathname === '/') page = <HomePage />
  else if (pathname === '/market') page = <MarketPage />
  else if (/^\/product\/[^/]+\/?$/.test(pathname)) page = <ProductPage />
  else if (pathname === '/publish') page = <PublishPage />
  else if (pathname === '/favorites') page = <FavoritesPage />
  else if (pathname === '/cart') page = <CartPage />
  else if (pathname === '/story') page = <StoryPage />
  else if (pathname === '/account') page = <AccountPage onLogout={onLogout} />
  else page = <NotFoundPage />

  return <SiteLayout onLogout={onLogout}>{page}</SiteLayout>
}

export default function App() {
  const demoUser: AuthUser = { id: 'demo', username: '演示访客' }
  const [authState, setAuthState] = useState<AuthState>(
    IS_GITHUB_PAGES_DEMO ? 'signed-in' : 'checking',
  )
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(
    IS_GITHUB_PAGES_DEMO ? demoUser : null,
  )
  const [sessionExpired, setSessionExpired] = useState(false)

  useEffect(() => {
    if (IS_GITHUB_PAGES_DEMO) return
    let active = true

    void resolveInitialSession()
      .then((user) => {
        if (!active) return
        setCurrentUser(user)
        setAuthState(user ? 'signed-in' : 'signed-out')
      })
      .catch(() => {
        if (active) setAuthState('signed-out')
      })

    // 普通接口刷新会话失败时，统一回到登录页并给出明确提示。
    const handleExpiredSession = () => {
      setCurrentUser(null)
      setSessionExpired(true)
      setAuthState('signed-out')
    }
    window.addEventListener('echo-market-auth-expired', handleExpiredSession)
    return () => {
      active = false
      window.removeEventListener('echo-market-auth-expired', handleExpiredSession)
    }
  }, [])

  async function logout() {
    if (IS_GITHUB_PAGES_DEMO) return
    try {
      await logoutSession()
    } finally {
      setCurrentUser(null)
      setSessionExpired(false)
      setAuthState('signed-out')
    }
  }

  if (authState === 'checking') return <AuthChecking />
  if (authState === 'signed-out' || !currentUser) {
    return (
      <LoginScreen
        onSignedIn={(user) => {
          setCurrentUser(user)
          setSessionExpired(false)
          setAuthState('signed-in')
        }}
        sessionExpired={sessionExpired}
      />
    )
  }

  return (
    <AppStoreProvider currentUser={currentUser}>
      <RouteContent onLogout={logout} />
    </AppStoreProvider>
  )
}
