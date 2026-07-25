import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { AnimatedHeading } from './components/AnimatedHeading'
import { FadeIn } from './components/FadeIn'
import { categories, products } from './data'
import type { Category, ListingDraft, Product } from './types'

const heroVideo =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260403_050628_c4e32401-fab4-4a27-b7a8-6e9291cd5959.mp4'

const emptyDraft: ListingDraft = {
  rawDescription: '',
  title: '',
  category: '生活',
  description: '',
  price: '',
  condition: '九成新',
  tags: '',
  image: '',
}

function readStored<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key)
    return stored ? (JSON.parse(stored) as T) : fallback
  } catch {
    return fallback
  }
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export default function App() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<Category>('全部')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [draft, setDraft] = useState<ListingDraft>(emptyDraft)
  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [aiMessage, setAiMessage] = useState('输入物品现状，AI 将整理标题、分类、标签和可信描述。')
  const [notice, setNotice] = useState('')
  const [userProducts, setUserProducts] = useState<Product[]>(() =>
    readStored<Product[]>('echo-market-products', []),
  )
  const [cart, setCart] = useState<Record<string, number>>(() =>
    readStored<Record<string, number>>('echo-market-cart', {}),
  )
  const [favorites, setFavorites] = useState<string[]>(() =>
    readStored<string[]>('echo-market-favorites', []),
  )

  const allProducts = useMemo(() => [...userProducts, ...products], [userProducts])

  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return allProducts.filter((product) => {
      const categoryMatches = category === '全部' || product.category === category
      const text = [product.title, product.description, product.category, ...product.tags]
        .join(' ')
        .toLowerCase()
      return categoryMatches && (!normalized || text.includes(normalized))
    })
  }, [allProducts, category, query])

  const cartItems = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, quantity]) => {
          const product = allProducts.find((item) => item.id === id)
          return product ? { product, quantity } : null
        })
        .filter((item): item is { product: Product; quantity: number } => item !== null),
    [allProducts, cart],
  )

  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0)
  const cartTotal = cartItems.reduce((sum, item) => sum + item.product.price * item.quantity, 0)

  useEffect(() => {
    localStorage.setItem('echo-market-cart', JSON.stringify(cart))
  }, [cart])

  useEffect(() => {
    localStorage.setItem('echo-market-favorites', JSON.stringify(favorites))
  }, [favorites])

  useEffect(() => {
    localStorage.setItem('echo-market-products', JSON.stringify(userProducts))
  }, [userProducts])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 2400)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (!selectedProduct && !cartOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedProduct(null)
        setCartOpen(false)
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [cartOpen, selectedProduct])

  function addToCart(product: Product) {
    setCart((current) => ({ ...current, [product.id]: (current[product.id] || 0) + 1 }))
    setNotice(`已将“${product.title}”加入清单`)
  }

  function updateQuantity(id: string, nextQuantity: number) {
    setCart((current) => {
      const next = { ...current }
      if (nextQuantity <= 0) delete next[id]
      else next[id] = nextQuantity
      return next
    })
  }

  function toggleFavorite(id: string) {
    setFavorites((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  function updateDraft<K extends keyof ListingDraft>(key: K, value: ListingDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function handleImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 2.5 * 1024 * 1024) {
      setAiMessage('图片请控制在 2.5 MB 以内。')
      setAiStatus('error')
      return
    }
    const reader = new FileReader()
    reader.onload = () => updateDraft('image', String(reader.result))
    reader.readAsDataURL(file)
  }

  async function polishWithAi() {
    if (draft.rawDescription.trim().length < 8) {
      setAiStatus('error')
      setAiMessage('请先输入至少 8 个字的物品信息。')
      return
    }

    setAiStatus('loading')
    setAiMessage('正在整理商品信息…')

    try {
      const response = await fetch('/api/ai-polish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawDescription: draft.rawDescription,
          condition: draft.condition,
          expectedPrice: draft.price,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || 'AI 服务暂时不可用。')
      const listing = payload.listing
      updateDraft('title', String(listing.title || ''))
      updateDraft('category', (listing.category || '生活') as ListingDraft['category'])
      updateDraft('description', String(listing.description || ''))
      updateDraft('price', String(listing.priceSuggestion || draft.price || ''))
      updateDraft('tags', Array.isArray(listing.tags) ? listing.tags.join(' · ') : '')
      setAiStatus('success')
      setAiMessage(String(listing.safetyNote || '已完成整理，请确认后发布。'))
    } catch (error) {
      setAiStatus('error')
      setAiMessage(error instanceof Error ? error.message : 'AI 服务暂时不可用。')
    }
  }

  function publishListing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const price = Number(draft.price)
    if (!draft.title.trim() || !draft.description.trim() || !Number.isFinite(price) || price <= 0) {
      setAiStatus('error')
      setAiMessage('请补全商品标题、描述和有效价格。')
      return
    }

    const product: Product = {
      id: `user-${Date.now()}`,
      title: draft.title.trim(),
      category: draft.category,
      description: draft.description.trim(),
      price,
      condition: draft.condition,
      campus: '待与买家协商',
      seller: '我发布的',
      image: draft.image || '/products/lamp.jpg',
      tags: draft.tags
        .split(/[·、,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 4),
      postedAt: '刚刚发布',
    }

    setUserProducts((current) => [product, ...current])
    setDraft(emptyDraft)
    setAiStatus('idle')
    setAiMessage('发布成功，商品已进入集市。')
    setNotice('新的旧物档案已发布')
    window.setTimeout(() => scrollToSection('market'), 100)
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <section className="relative flex min-h-screen flex-col overflow-hidden" id="home">
        <video
          aria-label="校园旧物循环站背景影像"
          autoPlay
          className="absolute inset-0 h-full w-full object-cover"
          loop
          muted
          playsInline
          src={heroVideo}
        />

        <div className="relative z-10 px-6 pt-6 md:px-12 lg:px-16">
          <nav className="liquid-glass flex items-center justify-between rounded-xl px-4 py-2">
            <a className="text-2xl font-semibold tracking-tight" href="#home">
              回声集
            </a>
            <div className="hidden items-center gap-8 text-sm md:flex">
              <a className="nav-link" href="#market">
                集市
              </a>
              <a className="nav-link" href="#publish">
                AI 发布
              </a>
              <a className="nav-link" href="#story">
                循环故事
              </a>
              <button className="nav-link" onClick={() => setCartOpen(true)} type="button">
                清单 {cartCount}
              </button>
            </div>
            <button
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-gray-100 md:px-6"
              onClick={() => scrollToSection('publish')}
              type="button"
            >
              发布闲置
            </button>
          </nav>
        </div>

        <div className="relative z-10 flex flex-1 flex-col justify-end px-6 pb-12 md:px-12 lg:px-16 lg:pb-16">
          <div className="lg:grid lg:grid-cols-2 lg:items-end">
            <div>
              <AnimatedHeading text={'让旧物留下回声\n让价值再次流动。'} />
              <FadeIn delay={800} duration={1000}>
                <p className="hero-subtitle mb-5 max-w-xl text-base text-gray-300 md:text-lg">
                  AI 辅助整理商品信息，让每一次发布更真实、更省力，也让校园里的闲置找到下一位需要它的人。
                </p>
              </FadeIn>
              <FadeIn delay={1200} duration={1000}>
                <div className="flex flex-wrap gap-4">
                  <button
                    className="rounded-lg bg-white px-8 py-3 font-medium text-black transition-colors hover:bg-gray-100"
                    onClick={() => scrollToSection('market')}
                    type="button"
                  >
                    逛逛旧物
                  </button>
                  <button
                    className="liquid-glass rounded-lg border border-white/20 px-8 py-3 font-medium text-white transition-colors hover:bg-white hover:text-black"
                    onClick={() => scrollToSection('publish')}
                    type="button"
                  >
                    AI 帮我发布
                  </button>
                </div>
              </FadeIn>
            </div>
            <FadeIn
              className="mt-8 flex items-end justify-start lg:mt-0 lg:justify-end"
              delay={1400}
              duration={1000}
            >
              <div className="liquid-glass rounded-xl border border-white/20 px-6 py-3">
                <p className="text-lg font-light md:text-xl lg:text-2xl">记录 · 流转 · 再出发</p>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      <section className="section-shell" id="market">
        <div className="section-heading">
          <div>
            <p className="eyebrow">01 / MARKET</p>
            <h2>今天，哪些物品正在等待新的主人？</h2>
          </div>
          <p>按真实需求寻找，不制造无效消费。</p>
        </div>

        <div className="market-toolbar">
          <label className="search-field">
            <span className="sr-only">搜索商品</span>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索键盘、教材、台灯…"
              type="search"
              value={query}
            />
          </label>
          <div className="filter-list" aria-label="商品分类">
            {categories.map((item) => (
              <button
                className={category === item ? 'filter-button is-active' : 'filter-button'}
                key={item}
                onClick={() => setCategory(item)}
                type="button"
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="product-grid">
          {filteredProducts.map((product) => (
            <article className="product-card" key={product.id}>
              <button
                aria-label={`查看 ${product.title}`}
                className="product-image-button"
                onClick={() => setSelectedProduct(product)}
                type="button"
              >
                <img alt={product.title} loading="lazy" src={product.image} />
              </button>
              <div className="product-meta">
                <div>
                  <p className="product-category">{product.category} · {product.condition}</p>
                  <button className="product-title" onClick={() => setSelectedProduct(product)} type="button">
                    {product.title}
                  </button>
                </div>
                <p className="product-price">¥{product.price}</p>
              </div>
              <div className="product-actions">
                <button onClick={() => toggleFavorite(product.id)} type="button">
                  {favorites.includes(product.id) ? '已收藏' : '收藏'}
                </button>
                <button onClick={() => addToCart(product)} type="button">
                  加入清单
                </button>
              </div>
            </article>
          ))}
        </div>

        {filteredProducts.length === 0 && (
          <div className="empty-state">
            <p>暂时没有匹配的物品。</p>
            <button
              onClick={() => {
                setQuery('')
                setCategory('全部')
              }}
              type="button"
            >
              清除筛选
            </button>
          </div>
        )}
      </section>

      <section className="publish-section" id="publish">
        <div className="section-heading">
          <div>
            <p className="eyebrow">02 / AI LISTING STUDIO</p>
            <h2>只写真实情况，剩下的交给 AI 整理。</h2>
          </div>
          <p>所有生成内容都可以再次编辑，最终发布权始终属于你。</p>
        </div>

        <div className="publish-layout">
          <form className="publish-form" onSubmit={publishListing}>
            <div className="field full">
              <label htmlFor="raw-description">先随手描述一下物品</label>
              <textarea
                id="raw-description"
                onChange={(event) => updateDraft('rawDescription', event.target.value)}
                placeholder="例如：用了一个学期的无线键盘，功能都正常，宿舍自提，希望 200 左右出…"
                rows={5}
                value={draft.rawDescription}
              />
            </div>
            <div className="field">
              <label htmlFor="condition">物品成色</label>
              <select
                id="condition"
                onChange={(event) => updateDraft('condition', event.target.value)}
                value={draft.condition}
              >
                <option>全新未拆</option>
                <option>九成新</option>
                <option>八成新</option>
                <option>七成新</option>
                <option>明显使用痕迹</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="expected-price">期望价格</label>
              <input
                id="expected-price"
                min="1"
                onChange={(event) => updateDraft('price', event.target.value)}
                placeholder="¥"
                type="number"
                value={draft.price}
              />
            </div>
            <button
              className="ai-button full"
              disabled={aiStatus === 'loading'}
              onClick={polishWithAi}
              type="button"
            >
              {aiStatus === 'loading' ? 'AI 正在整理…' : '用 AI 整理商品信息'}
            </button>

            <div className="status-row full" data-status={aiStatus}>
              <span>{aiStatus === 'success' ? '已完成' : aiStatus === 'error' ? '需要处理' : '准备就绪'}</span>
              <p>{aiMessage}</p>
            </div>

            <div className="field full">
              <label htmlFor="listing-title">商品标题</label>
              <input
                id="listing-title"
                onChange={(event) => updateDraft('title', event.target.value)}
                placeholder="AI 生成后也可以手动修改"
                value={draft.title}
              />
            </div>
            <div className="field">
              <label htmlFor="listing-category">分类</label>
              <select
                id="listing-category"
                onChange={(event) =>
                  updateDraft('category', event.target.value as ListingDraft['category'])
                }
                value={draft.category}
              >
                {categories
                  .filter((item) => item !== '全部')
                  .map((item) => (
                    <option key={item}>{item}</option>
                  ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="listing-tags">标签</label>
              <input
                id="listing-tags"
                onChange={(event) => updateDraft('tags', event.target.value)}
                placeholder="自提 · 可试用"
                value={draft.tags}
              />
            </div>
            <div className="field full">
              <label htmlFor="listing-description">商品描述</label>
              <textarea
                id="listing-description"
                onChange={(event) => updateDraft('description', event.target.value)}
                placeholder="写清楚功能、瑕疵、配件和交易方式"
                rows={4}
                value={draft.description}
              />
            </div>
            <div className="field full">
              <label htmlFor="listing-image">商品照片</label>
              <input accept="image/*" id="listing-image" onChange={handleImage} type="file" />
            </div>
            <button className="publish-button full" type="submit">
              确认并发布
            </button>
          </form>

          <aside className="listing-preview">
            <p className="preview-label">LIVE PREVIEW</p>
            <div className="preview-image">
              <img
                alt="待发布商品预览"
                src={draft.image || '/products/lamp.jpg'}
              />
            </div>
            <div className="preview-content">
              <p>{draft.category} · {draft.condition}</p>
              <h3>{draft.title || '你的商品标题会出现在这里'}</h3>
              <strong>{draft.price ? `¥${draft.price}` : '价格待填写'}</strong>
              <p>{draft.description || '一段克制、真实、方便买家判断的商品描述。'}</p>
              <div className="tag-row">
                {(draft.tags ? draft.tags.split(/[·、,，]/) : ['真实描述', '当面验货'])
                  .map((tag) => tag.trim())
                  .filter(Boolean)
                  .slice(0, 4)
                  .map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="story-section" id="story">
        <p className="eyebrow">03 / CIRCULATION STORY</p>
        <div className="story-copy">
          <h2>一件闲置，不必以被遗忘收场。</h2>
          <p>
            回声集把商品发布拆成可验证的信息：实际成色、使用痕迹、交易地点与卖家承诺。
            AI 只负责整理表达，不替任何人编造事实。
          </p>
        </div>
        <div className="metrics">
          <div>
            <strong>6</strong>
            <span>类校园常见物品</span>
          </div>
          <div>
            <strong>1</strong>
            <span>个清晰的 AI 能力</span>
          </div>
          <div>
            <strong>0</strong>
            <span>条默认夸张文案</span>
          </div>
        </div>
      </section>

      <footer>
        <div>
          <strong>回声集</strong>
          <p>AI 校园旧物循环站</p>
        </div>
        <div className="footer-links">
          <a href="#market">浏览集市</a>
          <a href="#publish">发布闲置</a>
          <button onClick={() => setCartOpen(true)} type="button">
            我的清单
          </button>
        </div>
        <p>小组课程项目 · 2026</p>
      </footer>

      {selectedProduct && (
        <div
          aria-modal="true"
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setSelectedProduct(null)
          }}
          role="dialog"
        >
          <div className="product-dialog">
            <button
              aria-label="关闭商品详情"
              className="close-button"
              onClick={() => setSelectedProduct(null)}
              type="button"
            >
              关闭
            </button>
            <img alt={selectedProduct.title} src={selectedProduct.image} />
            <div className="dialog-content">
              <p>{selectedProduct.category} · {selectedProduct.condition}</p>
              <h2>{selectedProduct.title}</h2>
              <strong>¥{selectedProduct.price}</strong>
              <p>{selectedProduct.description}</p>
              <dl>
                <div><dt>交易地点</dt><dd>{selectedProduct.campus}</dd></div>
                <div><dt>发布者</dt><dd>{selectedProduct.seller}</dd></div>
                <div><dt>发布时间</dt><dd>{selectedProduct.postedAt}</dd></div>
              </dl>
              <div className="dialog-actions">
                <button onClick={() => toggleFavorite(selectedProduct.id)} type="button">
                  {favorites.includes(selectedProduct.id) ? '取消收藏' : '收藏'}
                </button>
                <button onClick={() => addToCart(selectedProduct)} type="button">
                  加入清单
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {cartOpen && (
        <div
          aria-modal="true"
          className="cart-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setCartOpen(false)
          }}
          role="dialog"
        >
          <aside className="cart-drawer">
            <div className="cart-header">
              <div>
                <p className="eyebrow">MY LIST</p>
                <h2>交易清单</h2>
              </div>
              <button onClick={() => setCartOpen(false)} type="button">关闭</button>
            </div>
            <div className="cart-list">
              {cartItems.length === 0 ? (
                <div className="empty-cart">
                  <p>清单还是空的。</p>
                  <button
                    onClick={() => {
                      setCartOpen(false)
                      scrollToSection('market')
                    }}
                    type="button"
                  >
                    去集市看看
                  </button>
                </div>
              ) : (
                cartItems.map(({ product, quantity }) => (
                  <div className="cart-item" key={product.id}>
                    <img alt="" src={product.image} />
                    <div>
                      <h3>{product.title}</h3>
                      <p>¥{product.price}</p>
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
                    <button onClick={() => updateQuantity(product.id, 0)} type="button">
                      移除
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="cart-summary">
              <div><span>共 {cartCount} 件物品</span><strong>¥{cartTotal}</strong></div>
              <button
                disabled={cartItems.length === 0}
                onClick={() => setNotice('请与卖家确认物品状态和线下交易地点')}
                type="button"
              >
                发起交易确认
              </button>
              <p>建议当面验货，不通过平台外链接付款。</p>
            </div>
          </aside>
        </div>
      )}

      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  )
}
