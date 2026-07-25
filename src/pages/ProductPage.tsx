import { useEffect } from 'react'
import { ProductCard } from '../components/ProductCard'
import { Link, useNavigate, useParams } from '../router'
import { useAppStore } from '../store'

export function ProductPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { allProducts, favorites, addToCart, toggleFavorite } = useAppStore()
  const product = allProducts.find((item) => item.id === id)

  useEffect(() => {
    if (!product) navigate('/market', { replace: true })
  }, [navigate, product])

  if (!product) return null

  const related = allProducts
    .filter((item) => item.id !== product.id && item.category === product.category)
    .slice(0, 3)
  const isFavorite = favorites.includes(product.id)

  function buyNow() {
    addToCart(product!)
    navigate('/cart')
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
            <button className="outline-action" onClick={() => toggleFavorite(product.id)} type="button">
              {isFavorite ? '取消收藏' : '加入收藏'}
            </button>
            <button className="outline-action" onClick={() => addToCart(product)} type="button">加入清单</button>
            <button className="primary-action" onClick={buyNow} type="button">立即规划交易</button>
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
