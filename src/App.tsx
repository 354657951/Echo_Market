import { useEffect, useState } from 'react'
import { AuthChecking, LoginScreen } from './components/AuthScreens'
import { SiteLayout } from './components/SiteLayout'
import { AccountPage } from './pages/AccountPage'
import { CartPage } from './pages/CartPage'
import { FavoritesPage } from './pages/FavoritesPage'
import { HomePage } from './pages/HomePage'
import { MarketPage } from './pages/MarketPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ProductPage } from './pages/ProductPage'
import { PublishPage } from './pages/PublishPage'
import { StoryPage } from './pages/StoryPage'
import { useLocation } from './router'
import { AppStoreProvider } from './store'

type AuthState = 'checking' | 'signed-out' | 'signed-in'

function RouteContent({ onLogout }: { onLogout: () => Promise<void> }) {
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
  const [authState, setAuthState] = useState<AuthState>('checking')
  const [currentUser, setCurrentUser] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/auth/session', { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json()
        if (payload.authenticated) {
          setCurrentUser(String(payload.user))
          setAuthState('signed-in')
        } else {
          setAuthState('signed-out')
        }
      })
      .catch((error) => {
        if (error instanceof Error && error.name === 'AbortError') return
        setAuthState('signed-out')
      })
    return () => controller.abort()
  }, [])

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    setCurrentUser('')
    setAuthState('signed-out')
  }

  if (authState === 'checking') return <AuthChecking />
  if (authState === 'signed-out') {
    return (
      <LoginScreen
        onSignedIn={(username) => {
          setCurrentUser(username)
          setAuthState('signed-in')
        }}
      />
    )
  }

  return (
    <AppStoreProvider currentUser={currentUser}>
      <RouteContent onLogout={logout} />
    </AppStoreProvider>
  )
}
