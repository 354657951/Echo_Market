import { ProductCard } from '../components/market/ProductCard'
import { Link } from '../router/AppRouter'
import { useAppStore } from '../state/AppStore'

export function FavoritesPage() {
  // 收藏页复用商品卡片，保证操作反馈和集市页面一致。
  const { favoriteProducts } = useAppStore()

  return (
    <main className="route-main">
      <section className="route-hero compact">
        <p className="eyebrow">SAVED ITEMS / {String(favoriteProducts.length).padStart(2, '0')}</p>
        <h1>我的收藏</h1>
        <p>先保存，再慢慢比较状态、地点与价格。</p>
      </section>
      <section className="route-section">
        {favoriteProducts.length > 0 ? (
          <div className="product-grid">
            {favoriteProducts.map((product) => <ProductCard key={product.id} product={product} />)}
          </div>
        ) : (
          <div className="empty-route-state">
            <p className="eyebrow">NOTHING SAVED YET</p>
            <h2>还没有收藏任何物品。</h2>
            <p>在商品卡片或详情页点击“收藏”，它们会集中出现在这里。</p>
            <Link className="primary-action" to="/market">去集市看看</Link>
          </div>
        )}
      </section>
    </main>
  )
}
