import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AUTH_EXPIRED_EVENT,
  AUTH_SESSION_CHANGED_EVENT,
  AUTH_SESSION_VERIFIED_EVENT,
  logout as logoutSession,
  resolveInitialSession,
  type AuthExpiredEventDetail,
  type AuthSessionChangedEventDetail,
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
  const currentUserRef = useRef<AuthUser | null>(
    IS_GITHUB_PAGES_DEMO ? demoUser : null,
  )
  const sessionCheckSequence = useRef(0)

  const showSignedOut = useCallback((expired: boolean) => {
    sessionCheckSequence.current += 1
    currentUserRef.current = null
    setCurrentUser(null)
    setSessionExpired(expired)
    setAuthState('signed-out')
  }, [])

  const showSignedIn = useCallback((user: AuthUser) => {
    sessionCheckSequence.current += 1
    currentUserRef.current = user
    setCurrentUser(user)
    setSessionExpired(false)
    setAuthState('signed-in')
  }, [])

  const verifyCurrentSession = useCallback(async (initial = false) => {
    const sequence = ++sessionCheckSequence.current
    try {
      const user = await resolveInitialSession()
      if (sequence !== sessionCheckSequence.current) return
      if (!user) {
        showSignedOut(!initial)
        return
      }

      const previousUser = currentUserRef.current
      if (previousUser?.id !== user.id) {
        showSignedIn(user)
        return
      }

      window.dispatchEvent(new CustomEvent(AUTH_SESSION_VERIFIED_EVENT))
    } catch {
      if (sequence === sessionCheckSequence.current && initial) {
        showSignedOut(false)
      }
    }
  }, [showSignedIn, showSignedOut])

  useEffect(() => {
    if (IS_GITHUB_PAGES_DEMO) return
    void verifyCurrentSession(true)

    // 普通接口刷新会话失败时，统一回到登录页并给出明确提示。
    const handleExpiredSession = (event: Event) => {
      const { userId } = (event as CustomEvent<AuthExpiredEventDetail>).detail || {}
      if (userId && currentUserRef.current?.id !== userId) return
      showSignedOut(true)
    }
    const handleChangedSession = (event: Event) => {
      const detail = (event as CustomEvent<AuthSessionChangedEventDetail>).detail
      if (!detail?.user || currentUserRef.current?.id !== detail.previousUserId) return
      showSignedIn(detail.user)
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpiredSession)
    window.addEventListener(AUTH_SESSION_CHANGED_EVENT, handleChangedSession)
    return () => {
      sessionCheckSequence.current += 1
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpiredSession)
      window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, handleChangedSession)
    }
  }, [showSignedIn, showSignedOut, verifyCurrentSession])

  useEffect(() => {
    if (IS_GITHUB_PAGES_DEMO || authState !== 'signed-in') return
    // 账号可能在其他标签页发生变化；先确认身份，再允许 Store 拉取快照。
    const verifyAndRefresh = () => void verifyCurrentSession()
    const timer = window.setInterval(verifyAndRefresh, 30000)
    const handleFocus = verifyAndRefresh
    window.addEventListener('focus', handleFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', handleFocus)
    }
  }, [authState, verifyCurrentSession])

  async function logout() {
    if (IS_GITHUB_PAGES_DEMO) return
    try {
      await logoutSession()
    } finally {
      showSignedOut(false)
    }
  }

  if (authState === 'checking') return <AuthChecking />
  if (authState === 'signed-out' || !currentUser) {
    return (
      <LoginScreen
        onSignedIn={showSignedIn}
        sessionExpired={sessionExpired}
      />
    )
  }

  return (
    <AppStoreProvider currentUser={currentUser} key={currentUser.id}>
      <RouteContent onLogout={logout} />
    </AppStoreProvider>
  )
}
