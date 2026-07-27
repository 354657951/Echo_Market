import { FULL_SITE_URL, IS_GITHUB_PAGES_DEMO } from '../config/runtime'
import { Link, useSearchParams } from '../router/AppRouter'
import { useAppStore } from '../state/AppStore'

export function AccountPage({ onLogout }: { onLogout: () => Promise<void> }) {
  const { currentUser, favorites, cartCount, userProducts, orders } = useAppStore()
  const [params] = useSearchParams()
  // 新生成的确认单通过查询参数高亮，帮助用户快速定位结果。
  const highlightedOrder = params.get('order')

  return (
    <main className="route-main">
      <section className="account-hero">
        <div>
          <p className="eyebrow">MEMBER ARCHIVE</p>
          <h1>{currentUser}</h1>
          <p>欢迎回到你的校园循环档案。</p>
        </div>
        {IS_GITHUB_PAGES_DEMO ? (
          <a className="outline-action" href={FULL_SITE_URL} rel="noreferrer" target="_blank">
            打开完整在线版
          </a>
        ) : (
          <button className="outline-action" onClick={onLogout} type="button">退出当前账号</button>
        )}
      </section>

      <section className="route-section account-stats">
        <Link to="/favorites"><strong>{favorites.length}</strong><span>收藏物品</span></Link>
        <Link to="/cart"><strong>{cartCount}</strong><span>清单物品</span></Link>
        <Link to="/market"><strong>{userProducts.length}</strong><span>我的发布</span></Link>
        <div><strong>{orders.length}</strong><span>确认记录</span></div>
      </section>

      <section className="route-section order-section" id="orders">
        <div className="section-row-heading">
          <div><p className="eyebrow">TRADE RECORDS</p><h2>交易确认记录</h2></div>
          <Link to="/cart">规划新的交易</Link>
        </div>
        {orders.length > 0 ? (
          <div className="order-list">
            {orders.map((order) => (
              <article className={highlightedOrder === order.id ? 'order-card is-highlighted' : 'order-card'} key={order.id}>
                <div>
                  <p>{order.id}</p>
                  <h3>{order.items.map((item) => item.product.title).join('、')}</h3>
                </div>
                <dl>
                  <div><dt>状态</dt><dd>{order.status}</dd></div>
                  <div><dt>地点</dt><dd>{order.pickup}</dd></div>
                  <div><dt>联系时间</dt><dd>{order.contactTime}</dd></div>
                  <div><dt>合计</dt><dd>¥{order.total}</dd></div>
                </dl>
                <span>{order.createdAt}</span>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-route-state compact-empty">
            <h2>还没有交易确认记录。</h2>
            <p>把感兴趣的物品加入清单，就能规划第一次校内交接。</p>
            <Link className="primary-action" to="/market">浏览集市</Link>
          </div>
        )}
      </section>
    </main>
  )
}
