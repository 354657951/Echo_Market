import { useState } from 'react'
import { Link } from '../../router/AppRouter'
import { useAppStore } from '../../state/AppStore'
import type { Product } from '../../types/market'

export function ProductCard({ product }: { product: Product }) {
  // 商品卡片只负责展示与轻量操作，详情内容由独立路由承载。
  const { favorites, cart, toggleFavorite, addToCart } = useAppStore()
  const isFavorite = favorites.includes(product.id)
  const cartQuantity = cart[product.id] || 0
  const [pendingAction, setPendingAction] = useState<'favorite' | 'cart' | ''>('')

  async function runAction(action: 'favorite' | 'cart') {
    setPendingAction(action)
    try {
      if (action === 'favorite') await toggleFavorite(product.id)
      else await addToCart(product)
    } catch {
      // 全局提示已呈现失败原因，卡片只负责恢复按钮状态。
    } finally {
      setPendingAction('')
    }
  }

  return (
    <article className="product-card">
      <Link aria-label={`查看 ${product.title}`} className="product-image-button" to={`/product/${product.id}`}>
        <img alt={product.title} loading="lazy" src={product.image} />
      </Link>
      <div className="product-meta">
        <div>
          <p className="product-category">{product.category} · {product.condition}</p>
          <h3 className="product-title">{product.title}</h3>
        </div>
        <p className="product-price">¥{product.price}</p>
      </div>
      <div className="product-actions">
        <button
          aria-pressed={isFavorite}
          disabled={Boolean(pendingAction)}
          onClick={() => void runAction('favorite')}
          type="button"
        >
          {pendingAction === 'favorite' ? '同步中…' : isFavorite ? '已收藏' : '收藏'}
        </button>
        <button
          disabled={Boolean(pendingAction)}
          onClick={() => void runAction('cart')}
          type="button"
        >
          {pendingAction === 'cart'
            ? '正在加入…'
            : cartQuantity > 0
              ? `清单中 · ${cartQuantity}`
              : '加入清单'}
        </button>
      </div>
    </article>
  )
}
