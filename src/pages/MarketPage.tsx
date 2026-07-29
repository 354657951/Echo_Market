import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ProductCard } from '../components/market/ProductCard'
import { categories } from '../data/products'
import { useSearchParams } from '../router/AppRouter'
import { useAppStore } from '../state/AppStore'
import type { Category } from '../types/market'

type SortMode = 'latest' | 'price-asc' | 'price-desc'
type SearchExpression = {
  includeGroups: string[][]
  excludedTerms: string[]
  highlightTerms: string[]
}

const SEARCH_HISTORY_KEY = 'echo-market-search-history'

function readSearchHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]')
    return Array.isArray(history) ? history.filter((item): item is string => typeof item === 'string').slice(0, 6) : []
  } catch {
    return []
  }
}

function parseSearchExpression(value: string): SearchExpression {
  const excludedTerms: string[] = []
  const includeGroups = value
    .trim()
    .toLowerCase()
    .split(/\s+(?:or|\|)\s+/i)
    .map((group) => group
      .split(/\s+/)
      .filter(Boolean)
      .filter((term) => {
        if (!term.startsWith('-') || term.length === 1) return true
        excludedTerms.push(term.slice(1))
        return false
      }))
    .filter((group) => group.length > 0)

  return {
    includeGroups,
    excludedTerms: Array.from(new Set(excludedTerms)),
    highlightTerms: Array.from(new Set(includeGroups.flat())),
  }
}

export function MarketPage() {
  const { allProducts } = useAppStore()
  const [params, setParams] = useSearchParams()
  const query = params.get('q') || ''
  const [draftQuery, setDraftQuery] = useState(query)
  const [searchHistory, setSearchHistory] = useState(readSearchHistory)
  const [searchPanelOpen, setSearchPanelOpen] = useState(false)
  const paramsRef = useRef(params)
  const queryTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  paramsRef.current = params
  const rawCategory = params.get('category') || '全部'
  const category = categories.includes(rawCategory as Category) ? rawCategory as Category : '全部'
  const rawSort = params.get('sort') || 'latest'
  const sort = ['latest', 'price-asc', 'price-desc'].includes(rawSort) ? rawSort as SortMode : 'latest'

  const searchExpression = useMemo(() => parseSearchExpression(draftQuery), [draftQuery])
  const suggestionPool = useMemo(() => Array.from(new Set(
    allProducts.flatMap((product) => [product.title, ...product.tags]),
  )), [allProducts])
  const activeTerm = draftQuery.trim().split(/\s+/).at(-1)?.replace(/^-/, '').toLowerCase() || ''
  const searchSuggestions = useMemo(() => {
    if (!activeTerm) return []
    return suggestionPool
      .filter((item) => item.toLowerCase() !== activeTerm && item.toLowerCase().includes(activeTerm))
      .slice(0, 6)
  }, [activeTerm, suggestionPool])

  useEffect(() => {
    setDraftQuery(query)
  }, [query])

  useEffect(() => () => {
    if (queryTimer.current) window.clearTimeout(queryTimer.current)
  }, [])

  // 商品量较小时在浏览器内完成组合搜索，URL 只做延迟同步和分享状态保存。
  const filteredProducts = useMemo(() => {
    const result = allProducts.filter((product) => {
      const matchesCategory = category === '全部' || product.category === category
      const searchable = [product.title, product.description, product.category, ...product.tags]
        .join(' ')
        .toLowerCase()
      const matchesIncluded = searchExpression.includeGroups.length === 0
        || searchExpression.includeGroups.some((group) => group.every((term) => searchable.includes(term)))
      const matchesExcluded = searchExpression.excludedTerms.every((term) => !searchable.includes(term))
      return matchesCategory && matchesIncluded && matchesExcluded
    })
    if (sort === 'price-asc') return [...result].sort((left, right) => left.price - right.price)
    if (sort === 'price-desc') return [...result].sort((left, right) => right.price - left.price)
    return result
  }, [allProducts, category, searchExpression, sort])

  const fallbackProducts = useMemo(() => allProducts
    .filter((product) => category === '全部' || product.category === category)
    .slice(0, 3), [allProducts, category])

  function updateParam(key: string, value: string, fallback: string) {
    // 默认值不写入地址栏，保持链接简洁。
    const next = new URLSearchParams(paramsRef.current)
    if (value === fallback || !value) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  function updateQuery(value: string) {
    setDraftQuery(value)
    setSearchPanelOpen(true)
    if (queryTimer.current) window.clearTimeout(queryTimer.current)
    queryTimer.current = window.setTimeout(() => updateParam('q', value.trim(), ''), 300)
  }

  function rememberSearch(value: string) {
    const normalized = value.trim()
    if (!normalized) return
    setSearchHistory((current) => {
      const next = [normalized, ...current.filter((item) => item !== normalized)].slice(0, 6)
      try {
        localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next))
      } catch {
        // 隐私模式禁用本地存储时，当前会话内的搜索仍可正常使用。
      }
      return next
    })
  }

  function commitSearch(value: string) {
    if (queryTimer.current) window.clearTimeout(queryTimer.current)
    setDraftQuery(value)
    updateParam('q', value.trim(), '')
    rememberSearch(value)
    setSearchPanelOpen(false)
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') commitSearch(draftQuery)
    if (event.key === 'Escape') setSearchPanelOpen(false)
  }

  function clearSearchHistory() {
    try {
      localStorage.removeItem(SEARCH_HISTORY_KEY)
    } catch {
      // 本地存储不可用时只清除当前内存中的历史记录。
    }
    setSearchHistory([])
  }

  function resetFilters() {
    if (queryTimer.current) window.clearTimeout(queryTimer.current)
    setDraftQuery('')
    setSearchPanelOpen(false)
    setParams({}, { replace: true })
  }

  const panelItems = activeTerm ? searchSuggestions : searchHistory
  const panelLabel = activeTerm ? '搜索建议' : '最近搜索'

  return (
    <main className="route-main">
      <section className="route-hero compact">
        <p className="eyebrow">CAMPUS MARKET / {String(filteredProducts.length).padStart(2, '0')}</p>
        <h1>校园集市</h1>
        <p>用清晰条件找到值得继续使用的物品。</p>
      </section>

      <section className="route-section market-section">
        <div className="market-toolbar multi-row">
          <div
            className="search-field"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setSearchPanelOpen(false)
            }}
          >
            <label htmlFor="market-search">搜索旧物</label>
            <input
              autoComplete="off"
              id="market-search"
              onChange={(event) => updateQuery(event.target.value)}
              onFocus={() => setSearchPanelOpen(true)}
              onKeyDown={handleSearchKeyDown}
              placeholder="键盘 教材 台灯…"
              type="search"
              value={draftQuery}
            />
            {searchPanelOpen && panelItems.length > 0 && (
              <div className="search-panel">
                <div className="search-panel-heading">
                  <span>{panelLabel}</span>
                  {!activeTerm && (
                    <button onClick={clearSearchHistory} type="button">清除</button>
                  )}
                </div>
                {panelItems.map((item) => (
                  <button
                    className="search-suggestion"
                    key={item}
                    onClick={() => commitSearch(item)}
                    type="button"
                  >
                    {item}
                  </button>
                ))}
              </div>
            )}
          </div>
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
          {(draftQuery || category !== '全部' || sort !== 'latest') && (
            <button onClick={resetFilters} type="button">重置条件</button>
          )}
        </div>

        {filteredProducts.length > 0 ? (
          <div className="product-grid">
            {filteredProducts.map((product) => (
              <ProductCard
                highlightTerms={searchExpression.highlightTerms}
                key={product.id}
                product={product}
              />
            ))}
          </div>
        ) : (
          <>
            <div className="empty-state">
              <p>没有找到与“{draftQuery || category}”匹配的旧物。</p>
              <button onClick={resetFilters} type="button">查看全部</button>
            </div>
            {fallbackProducts.length > 0 && (
              <section className="search-fallback" aria-labelledby="search-fallback-title">
                <h2 id="search-fallback-title">你可能也会喜欢</h2>
                <div className="product-grid">
                  {fallbackProducts.map((product) => <ProductCard key={product.id} product={product} />)}
                </div>
              </section>
            )}
          </>
        )}
      </section>
    </main>
  )
}
