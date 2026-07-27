import { useMemo } from 'react'
import { ProductCard } from '../components/market/ProductCard'
import { categories } from '../data/products'
import { useSearchParams } from '../router/AppRouter'
import { useAppStore } from '../state/AppStore'
import type { Category } from '../types/market'

type SortMode = 'latest' | 'price-asc' | 'price-desc'

export function MarketPage() {
  const { allProducts } = useAppStore()
  const [params, setParams] = useSearchParams()
  const query = params.get('q') || ''
  const rawCategory = params.get('category') || '全部'
  const category = categories.includes(rawCategory as Category) ? rawCategory as Category : '全部'
  const rawSort = params.get('sort') || 'latest'
  const sort = ['latest', 'price-asc', 'price-desc'].includes(rawSort) ? rawSort as SortMode : 'latest'

  // 搜索、分类和排序均由 URL 查询参数驱动，刷新或分享链接后条件仍可恢复。
  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const result = allProducts.filter((product) => {
      const matchesCategory = category === '全部' || product.category === category
      const searchable = [product.title, product.description, product.category, ...product.tags]
        .join(' ')
        .toLowerCase()
      return matchesCategory && (!normalized || searchable.includes(normalized))
    })
    if (sort === 'price-asc') return [...result].sort((left, right) => left.price - right.price)
    if (sort === 'price-desc') return [...result].sort((left, right) => right.price - left.price)
    return result
  }, [allProducts, category, query, sort])

  function updateParam(key: string, value: string, fallback: string) {
    // 默认值不写入地址栏，保持链接简洁。
    const next = new URLSearchParams(params)
    if (value === fallback || !value) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  return (
    <main className="route-main">
      <section className="route-hero compact">
        <p className="eyebrow">CAMPUS MARKET / {String(filteredProducts.length).padStart(2, '0')}</p>
        <h1>校园集市</h1>
        <p>用清晰条件找到值得继续使用的物品。</p>
      </section>

      <section className="route-section market-section">
        <div className="market-toolbar multi-row">
          <label className="search-field">
            <span>搜索旧物</span>
            <input
              onChange={(event) => updateParam('q', event.target.value, '')}
              placeholder="键盘、教材、台灯…"
              type="search"
              value={query}
            />
          </label>
          <label className="sort-field">
            <span>排序方式</span>
            <select onChange={(event) => updateParam('sort', event.target.value, 'latest')} value={sort}>
              <option value="latest">最新发布</option>
              <option value="price-asc">价格从低到高</option>
              <option value="price-desc">价格从高到低</option>
            </select>
          </label>
          <div aria-label="商品分类" className="filter-list">
            {categories.map((item) => (
              <button
                className={category === item ? 'filter-button is-active' : 'filter-button'}
                key={item}
                onClick={() => updateParam('category', item, '全部')}
                type="button"
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="result-summary">
          <span>找到 {filteredProducts.length} 件物品</span>
          {(query || category !== '全部' || sort !== 'latest') && (
            <button onClick={() => setParams({}, { replace: true })} type="button">重置条件</button>
          )}
        </div>

        {filteredProducts.length > 0 ? (
          <div className="product-grid">
            {filteredProducts.map((product) => <ProductCard key={product.id} product={product} />)}
          </div>
        ) : (
          <div className="empty-state">
            <p>没有找到符合条件的旧物。</p>
            <button onClick={() => setParams({}, { replace: true })} type="button">查看全部</button>
          </div>
        )}
      </section>
    </main>
  )
}
