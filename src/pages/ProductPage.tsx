import { useEffect, useState } from 'react'
import { ProductCard } from '../components/market/ProductCard'
import { Link, useNavigate, useParams } from '../router/AppRouter'
import { useAppStore } from '../state/AppStore'

export function ProductPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { allProducts, favorites, addToCart, toggleFavorite, syncStatus } = useAppStore()
  const [pendingAction, setPendingAction] = useState<'favorite' | 'cart' | 'plan' | ''>('')
  const product = allProducts.find((item) => item.id === id)

  useEffect(() => {
    // 商品不存在时返回集市，避免渲染无效详情。
    if (!product && syncStatus !== 'loading') navigate('/market', { replace: true })
  }, [navigate, product, syncStatus])

  if (!product) {
    return (
      <main className="route-main">
        <section className="route-hero compact" role="status">
          <p className="eyebrow">SHARED LISTING</p>
          <h1>{syncStatus === 'loading' ? '正在同步商品…' : '正在返回集市…'}</h1>
        </section>
      </main>
    )
  }

  const related = allProducts
    .filter((item) => item.id !== product.id && item.category === product.category)
    .slice(0, 3)
  const isFavorite = favorites.includes(product.id)

  async function runAction(action: 'favorite' | 'cart' | 'plan') {
    setPendingAction(action)
    // “立即规划交易”先加入清单，再跳转到线下交接计划。
    try {
      if (action === 'favorite') await toggleFavorite(product!.id)
      else {
        await addToCart(product!)
        if (action === 'plan') navigate('/cart')
      }
    } catch {
      // 全局提示已呈现失败原因，详情页只负责恢复按钮状态。
    } finally {
      setPendingAction('')
    }
  }

  return (
    <main className="route-main">
      <section className="product-page">
        <div className="product-page-image"><img alt={product.title} src={product.image} /></div>
        <div className="product-page-content">
          <Link className="breadcrumb" to="/market">校园集市 / {product.category}</Link>
          <p className="eyebrow">{product.condition} · {product.postedAt}</p>
          <h1>{product.title}</h1>
          <strong className="detail-price">¥{product.price}</strong>
          <p className="detail-description">{product.description}</p>
          <div className="tag-row">
            {product.tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
          <dl className="detail-list">
            <div><dt>发布者</dt><dd>{product.seller}</dd></div>
            <div><dt>交接地点</dt><dd>{product.campus}</dd></div>
            <div><dt>建议方式</dt><dd>当面验货后确认</dd></div>
          </dl>
          <div className="detail-actions">
            <button
              className="outline-action"
              disabled={Boolean(pendingAction)}
              onClick={() => void runAction('favorite')}
              type="button"
            >
              {pendingAction === 'favorite' ? '同步中…' : isFavorite ? '取消收藏' : '加入收藏'}
            </button>
            <button
              className="outline-action"
              disabled={Boolean(pendingAction)}
              onClick={() => void runAction('cart')}
              type="button"
            >
              {pendingAction === 'cart' ? '正在加入…' : '加入清单'}
            </button>
            <button
              className="primary-action"
              disabled={Boolean(pendingAction)}
              onClick={() => void runAction('plan')}
              type="button"
            >
              {pendingAction === 'plan' ? '正在准备…' : '立即规划交易'}
            </button>
          </div>
        </div>
      </section>

      <section className="route-section related-section">
        <div className="section-row-heading">
          <div><p className="eyebrow">MORE IN {product.category}</p><h2>相似旧物</h2></div>
          <Link to={`/market?category=${encodeURIComponent(product.category)}`}>查看该分类</Link>
        </div>
        {related.length > 0 ? (
          <div className="product-grid">
            {related.map((item) => <ProductCard key={item.id} product={item} />)}
          </div>
        ) : (
          <p className="subtle-copy">该分类暂时没有更多物品。</p>
        )}
      </section>
    </main>
  )
}
