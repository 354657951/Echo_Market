import { Link } from '../router/AppRouter'

// 统一处理未知路径，确保深层链接错误时仍有明确返回入口。
export function NotFoundPage() {
  return (
    <main className="route-main">
      <section className="empty-route-state not-found">
        <p className="eyebrow">404 / LOST ECHO</p>
        <h1>这段回声不存在。</h1>
        <p>你访问的页面可能已移动，返回首页重新开始。</p>
        <Link className="primary-action" to="/">返回首页</Link>
      </section>
    </main>
  )
}
