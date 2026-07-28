import { useEffect, useRef, useState } from 'react'
import { ProductCard } from '../components/market/ProductCard'
import { Link, useNavigate, useParams } from '../router/AppRouter'
import { useAppStore } from '../state/AppStore'
import type { Product } from '../types/market'

function findRelatedProducts(products: Product[], current: Product) {
  return products
    .filter((item) => item.id !== current.id)
    .map((item, index) => {
      const sharedTags = item.tags.filter((tag) =>
        current.tags.includes(tag),
      ).length
      const priceDifference = Math.abs(item.price - current.price)
      const similarPrice =
        current.price > 0 && priceDifference / current.price <= 0.45
      return {
        item,
        index,
        score:
          (item.category === current.category ? 4 : 0)
          + sharedTags * 2
          + (similarPrice ? 1 : 0),
      }
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) =>
      right.score - left.score || left.index - right.index)
    .slice(0, 3)
    .map((entry) => entry.item)
}

export function ProductPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const {
    allProducts,
    favorites,
    cart,
    addToCart,
    toggleFavorite,
    syncStatus,
  } = useAppStore()
  const [pendingAction, setPendingAction] =
    useState<'favorite' | 'cart' | 'plan' | ''>('')
  const imageDialogRef = useRef<HTMLDialogElement>(null)
  const product = allProducts.find((item) => item.id === id)

  useEffect(() => {
    // 切换到另一个商品时关闭旧图片，避免顶层弹窗保留上一件商品。
    imageDialogRef.current?.close()
  }, [id])

  if (!product) {
    const isLoading = syncStatus === 'loading'
    return (
      <main className="route-main">
        <section className="route-hero compact" role="status">
          <p className="eyebrow">
            {isLoading ? 'SHARED LISTING' : 'ITEM NOT FOUND'}
          </p>
          <h1>{isLoading ? '正在同步商品…' : '这件旧物已不在集市中。'}</h1>
          <p>
            {isLoading
              ? '正在读取共享商品资料，请稍候。'
              : '它可能已经被发布者移除，也可能是链接地址有误。'}
          </p>
          {!isLoading && (
            <Link className="primary-action" to="/market">
              返回校园集市
            </Link>
          )}
        </section>
      </main>
    )
  }

  const related = findRelatedProducts(allProducts, product)
  const isFavorite = favorites.includes(product.id)
  const cartQuantity = cart[product.id] || 0

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
        <div className="product-page-image">
          <button
            aria-label={`放大查看 ${product.title} 的商品照片`}
            className="image-zoom-trigger"
            onClick={() => imageDialogRef.current?.showModal()}
            type="button"
          >
            <img alt={product.title} src={product.image} />
            <span>查看大图</span>
          </button>
        </div>
        <div className="product-page-content">
          <Link className="breadcrumb" to="/market">
            校园集市 / {product.category}
          </Link>
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
            {product.flaws && (
              <div><dt>已知瑕疵</dt><dd>{product.flaws}</dd></div>
            )}
            {product.accessories && (
              <div><dt>随附物品</dt><dd>{product.accessories}</dd></div>
            )}
            {product.tradeNote && (
              <div><dt>交易备注</dt><dd>{product.tradeNote}</dd></div>
            )}
            <div><dt>建议方式</dt><dd>当面验货后确认</dd></div>
          </dl>
          <div className="detail-actions">
            <button
              aria-pressed={isFavorite}
              className="outline-action"
              disabled={Boolean(pendingAction)}
              onClick={() => void runAction('favorite')}
              type="button"
            >
              {pendingAction === 'favorite'
                ? '同步中…'
                : isFavorite ? '取消收藏' : '加入收藏'}
            </button>
            <button
              className="outline-action"
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

      <dialog
        aria-labelledby="product-image-dialog-title"
        className="image-dialog"
        onCancel={(event) => {
          event.preventDefault()
          imageDialogRef.current?.close()
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            imageDialogRef.current?.close()
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') imageDialogRef.current?.close()
        }}
        ref={imageDialogRef}
      >
        <div className="image-dialog-frame">
          <div className="image-dialog-heading">
            <p id="product-image-dialog-title">{product.title}</p>
            <button
              className="outline-action"
              onClick={() => imageDialogRef.current?.close()}
              type="button"
            >
              关闭
            </button>
          </div>
          <img alt={`${product.title} 大图`} src={product.image} />
        </div>
      </dialog>

      <section className="route-section related-section">
        <div className="section-row-heading">
          <div>
            <p className="eyebrow">RELATED LISTINGS</p>
            <h2>相似旧物</h2>
          </div>
          <Link to={`/market?category=${encodeURIComponent(product.category)}`}>
            查看{product.category}分类
          </Link>
        </div>
        {related.length > 0 ? (
          <div className="product-grid">
            {related.map((item) => (
              <ProductCard key={item.id} product={item} />
            ))}
          </div>
        ) : (
          <p className="subtle-copy">
            暂时没有足够相似的物品，<Link to="/market">浏览全部旧物</Link>。
          </p>
        )}
      </section>
    </main>
  )
}
