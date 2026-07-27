import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from '../router/AppRouter'
import { useAppStore } from '../state/AppStore'

export function CartPage() {
  const navigate = useNavigate()
  const { cartItems, cartCount, cartTotal, updateQuantity, checkout } = useAppStore()
  const [pickup, setPickup] = useState('主楼大厅')
  const [contactTime, setContactTime] = useState('今天 18:00—20:00')
  const [agreed, setAgreed] = useState(false)
  const [message, setMessage] = useState('确认前请再次查看每件物品的成色与交接地点。')

  function confirmTrade(event: FormEvent<HTMLFormElement>) {
    // 交易确认单只记录线下交接计划，不执行在线支付。
    event.preventDefault()
    if (!agreed) {
      setMessage('请先确认当面验货与安全交易约定。')
      return
    }
    try {
      const order = checkout(pickup, contactTime)
      navigate(`/account?order=${encodeURIComponent(order.id)}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '暂时无法生成确认单。')
    }
  }

  return (
    <main className="route-main">
      <section className="route-hero compact">
        <p className="eyebrow">TRADE PLAN / {String(cartCount).padStart(2, '0')}</p>
        <h1>交易清单</h1>
        <p>这里不是在线付款页，而是一份校内当面交易计划。</p>
      </section>

      <section className="route-section cart-page-layout">
        <div className="cart-page-list">
          {cartItems.length === 0 ? (
            <div className="empty-route-state">
              <p className="eyebrow">EMPTY TRADE PLAN</p>
              <h2>清单还是空的。</h2>
              <p>选择真正需要的物品，再一起规划校内交接。</p>
              <Link className="primary-action" to="/market">浏览校园集市</Link>
            </div>
          ) : (
            cartItems.map(({ product, quantity }) => (
              <article className="cart-page-item" key={product.id}>
                <img alt={product.title} src={product.image} />
                <div>
                  <p className="product-category">{product.category} · {product.condition}</p>
                  <Link to={`/product/${product.id}`}><h2>{product.title}</h2></Link>
                  <p>{product.campus} · {product.seller}</p>
                  <div className="quantity-control">
                    <button
                      aria-label={`减少 ${product.title} 数量`}
                      onClick={() => updateQuantity(product.id, quantity - 1)}
                      type="button"
                    >
                      −
                    </button>
                    <span>{quantity}</span>
                    <button
                      aria-label={`增加 ${product.title} 数量`}
                      onClick={() => updateQuantity(product.id, quantity + 1)}
                      type="button"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="cart-item-total">
                  <strong>¥{product.price * quantity}</strong>
                  <button onClick={() => updateQuantity(product.id, 0)} type="button">移除</button>
                </div>
              </article>
            ))
          )}
        </div>

        <form className="trade-plan-card liquid-glass-light" onSubmit={confirmTrade}>
          <p className="eyebrow">MEET-UP PLAN</p>
          <h2>交接计划</h2>
          <div className="trade-total"><span>共 {cartCount} 件</span><strong>¥{cartTotal}</strong></div>
          <label htmlFor="pickup">建议集合地点</label>
          <select id="pickup" onChange={(event) => setPickup(event.target.value)} value={pickup}>
            <option>主楼大厅</option>
            <option>一校区图书馆门口</option>
            <option>科学园 2A 服务台</option>
            <option>二区食堂入口</option>
          </select>
          <label htmlFor="contact-time">方便联系时间</label>
          <select id="contact-time" onChange={(event) => setContactTime(event.target.value)} value={contactTime}>
            <option>今天 18:00—20:00</option>
            <option>明天 12:00—14:00</option>
            <option>明天 18:00—20:00</option>
            <option>周末 10:00—17:00</option>
          </select>
          <label className="safety-agreement">
            <input checked={agreed} onChange={(event) => setAgreed(event.target.checked)} type="checkbox" />
            <span>我会当面验货，不通过陌生链接付款。</span>
          </label>
          <p className="trade-message" role="status">{message}</p>
          <button disabled={cartItems.length === 0} type="submit">生成交易确认单</button>
        </form>
      </section>
    </main>
  )
}
