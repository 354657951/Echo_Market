import { useState, type ReactNode } from 'react'
import { FULL_SITE_URL, IS_GITHUB_PAGES_DEMO } from '../../config/runtime'
import { NavLink } from '../../router/AppRouter'
import { useAppStore } from '../../state/AppStore'

// 主导航配置集中维护，确保桌面和响应式导航顺序一致。
const navigation = [
  { to: '/', label: '首页', end: true },
  { to: '/market', label: '集市' },
  { to: '/publish', label: 'AI 发布' },
  { to: '/story', label: '循环故事' },
]

export function SiteLayout({
  children,
  onLogout,
}: {
  children: ReactNode
  onLogout: () => Promise<void>
}) {
  const {
    cartCount,
    favorites,
    currentUser,
    syncStatus,
    syncMessage,
    refreshSharedData,
  } = useAppStore()
  const [loggingOut, setLoggingOut] = useState(false)

  async function logoutWithFeedback() {
    setLoggingOut(true)
    try {
      await onLogout()
    } finally {
      setLoggingOut(false)
    }
  }

  return (
    <div className="site-frame">
      <header className="site-header">
        <NavLink className="site-logo" to="/">回声集</NavLink>
        <nav aria-label="主导航" className="site-navigation">
          {navigation.map((item) => (
            <NavLink
              className={({ isActive }) => isActive ? 'site-nav-link is-active' : 'site-nav-link'}
              end={item.end}
              key={item.to}
              to={item.to}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="site-actions">
          {!IS_GITHUB_PAGES_DEMO && (
            <button
              aria-label={`${syncMessage}，点击立即刷新`}
              className="sync-indicator"
              data-status={syncStatus}
              disabled={syncStatus === 'loading' || syncStatus === 'saving'}
              onClick={() => void refreshSharedData().catch(() => undefined)}
              title={syncMessage}
              type="button"
            >
              <span aria-hidden="true" />
              {syncStatus === 'saving' ? '保存中' : syncStatus === 'loading' ? '同步中' : syncStatus === 'error' ? '重试同步' : '已同步'}
            </button>
          )}
          <NavLink aria-label={`收藏 ${favorites.length} 件`} className="counter-link" to="/favorites">
            收藏 <span>{favorites.length}</span>
          </NavLink>
          <NavLink aria-label={`交易清单 ${cartCount} 件`} className="counter-link" to="/cart">
            清单 <span>{cartCount}</span>
          </NavLink>
          <NavLink className="account-link" to="/account">{currentUser.username}</NavLink>
        </div>
      </header>

      {children}

      <footer className="site-footer">
        <div>
          <strong>回声集</strong>
          <p>AI 校园旧物循环站</p>
        </div>
        <div className="footer-links">
          <NavLink to="/market">浏览全部旧物</NavLink>
          <NavLink to="/publish">发布一件闲置</NavLink>
          <NavLink to="/favorites">查看收藏</NavLink>
          <NavLink to="/story">了解循环计划</NavLink>
        </div>
        {IS_GITHUB_PAGES_DEMO ? (
          <a className="footer-logout" href={FULL_SITE_URL} rel="noreferrer" target="_blank">
            打开完整在线版
          </a>
        ) : (
          <button
            className="footer-logout"
            disabled={loggingOut}
            onClick={() => void logoutWithFeedback()}
            type="button"
          >
            {loggingOut ? '正在退出…' : '退出登录'}
          </button>
        )}
      </footer>
    </div>
  )
}
