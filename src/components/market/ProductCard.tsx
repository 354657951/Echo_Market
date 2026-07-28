import { useState } from 'react'
import { Link } from '../../router/AppRouter'
import { useAppStore } from '../../state/AppStore'
import type { Product } from '../../types/market'

interface ProductSelection {
  selected: boolean
  onChange: (selected: boolean) => void
}

export function ProductCard({
  product,
  selection,
}: {
  product: Product
  selection?: ProductSelection
}) {
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
    <article className={`product-card${selection ? ' is-selecting' : ''}${selection?.selected ? ' is-selected' : ''}`}>
      {selection && (
        <label className="product-selection-control">
          <input
            aria-label={`选择 ${product.title}`}
            checked={selection.selected}
            onChange={(event) => selection.onChange(event.target.checked)}
            type="checkbox"
          />
          <span>{selection.selected ? '已选择' : '选择'}</span>
        </label>
      )}
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
      {selection ? (
        <p className="product-selection-hint">勾选后可统一加入清单或取消收藏</p>
      ) : (
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
      )}
    </article>
  )
}
