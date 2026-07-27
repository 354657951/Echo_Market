import { Link } from '../../router/AppRouter'
import { useAppStore } from '../../state/AppStore'
import type { Product } from '../../types/market'

export function ProductCard({ product }: { product: Product }) {
  // 商品卡片只负责展示与轻量操作，详情内容由独立路由承载。
  const { favorites, toggleFavorite, addToCart } = useAppStore()
  const isFavorite = favorites.includes(product.id)

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
          onClick={() => toggleFavorite(product.id)}
          type="button"
        >
          {isFavorite ? '已收藏' : '收藏'}
        </button>
        <button onClick={() => addToCart(product)} type="button">加入清单</button>
      </div>
    </article>
  )
}
