import { Link } from '../router'
import { useAppStore } from '../store'
import type { Product } from '../types'

export function ProductCard({ product }: { product: Product }) {
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
