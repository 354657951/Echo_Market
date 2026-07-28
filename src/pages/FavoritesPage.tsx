import { useEffect, useMemo, useRef, useState } from 'react'
import { ProductCard } from '../components/market/ProductCard'
import { categories } from '../data/products'
import { Link, useSearchParams } from '../router/AppRouter'
import { useAppStore } from '../state/AppStore'
import type { Category } from '../types/market'

type FavoriteSortMode = 'saved' | 'price-asc' | 'price-desc'

export function FavoritesPage() {
  // 收藏页只派生当前收藏视图，不复制或修改全局收藏状态。
  const { favoriteProducts, addFavoritesToCart, removeFavorites } = useAppStore()
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [batchPending, setBatchPending] = useState<'cart' | 'remove' | ''>('')
  const selectAllRef = useRef<HTMLInputElement>(null)
  const [params, setParams] = useSearchParams()
  const query = params.get('q') || ''
  const rawCategory = params.get('category') || '全部'
  const category = categories.includes(rawCategory as Category) ? rawCategory as Category : '全部'
  const rawSort = params.get('sort') || 'saved'
  const sort = ['saved', 'price-asc', 'price-desc'].includes(rawSort)
    ? rawSort as FavoriteSortMode
    : 'saved'

  const visibleFavorites = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const result = favoriteProducts.filter((product) => {
      const matchesCategory = category === '全部' || product.category === category
      const searchable = [product.title, product.description, product.category, ...product.tags]
        .join(' ')
        .toLowerCase()
      return matchesCategory && (!normalized || searchable.includes(normalized))
    })
    if (sort === 'price-asc') return [...result].sort((left, right) => left.price - right.price)
    if (sort === 'price-desc') return [...result].sort((left, right) => right.price - left.price)
    return result
  }, [category, favoriteProducts, query, sort])

  const visibleIds = useMemo(() => visibleFavorites.map((product) => product.id), [visibleFavorites])
  const selectedVisibleIds = useMemo(
    () => visibleIds.filter((id) => selectedIds.has(id)),
    [selectedIds, visibleIds],
  )
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleIds.length === visibleIds.length

  useEffect(() => {
    setSelectedIds((current) => {
      const visibleSet = new Set(visibleIds)
      const next = new Set([...current].filter((id) => visibleSet.has(id)))
      return next.size === current.size ? current : next
    })
  }, [visibleIds])

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedVisibleIds.length > 0 && !allVisibleSelected
    }
  }, [allVisibleSelected, selectedVisibleIds.length])

  function updateParam(key: string, value: string, fallback: string) {
    const next = new URLSearchParams(params)
    if (value === fallback || !value) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  function exitSelectionMode() {
    setSelectedIds(new Set())
    setSelectionMode(false)
  }

  function toggleSelection(id: string, selected: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (selected) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function toggleAllVisible(selected: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current)
      visibleIds.forEach((id) => {
        if (selected) next.add(id)
        else next.delete(id)
      })
      return next
    })
  }

  async function runBatchAction(action: 'cart' | 'remove') {
    if (selectedVisibleIds.length === 0) return
    setBatchPending(action)
    try {
      if (action === 'cart') await addFavoritesToCart(selectedVisibleIds)
      else await removeFavorites(selectedVisibleIds)
      exitSelectionMode()
    } catch {
      // 失败原因由全局 Toast 呈现，保留勾选便于重试。
    } finally {
      setBatchPending('')
    }
  }

  return (
    <main className="route-main">
      <section className="route-hero compact">
        <p className="eyebrow">SAVED ITEMS / {String(favoriteProducts.length).padStart(2, '0')}</p>
        <h1>我的收藏</h1>
        <p>先保存，再慢慢比较状态、地点与价格。</p>
      </section>
      <section className="route-section">
        {favoriteProducts.length > 0 ? (
          <>
            <div className="market-toolbar multi-row">
              <label className="search-field">
                <span>搜索收藏</span>
                <input
                  onChange={(event) => updateParam('q', event.target.value, '')}
                  placeholder="标题、描述或标签…"
                  type="search"
                  value={query}
                />
              </label>
              <label className="sort-field">
                <span>排序方式</span>
                <select onChange={(event) => updateParam('sort', event.target.value, 'saved')} value={sort}>
                  <option value="saved">收藏顺序</option>
                  <option value="price-asc">价格从低到高</option>
                  <option value="price-desc">价格从高到低</option>
                </select>
              </label>
              <div aria-label="收藏分类" className="filter-list">
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
              <span>显示 {visibleFavorites.length} / {favoriteProducts.length} 件收藏</span>
              {(query || category !== '全部' || sort !== 'saved') && (
                <button onClick={() => setParams({}, { replace: true })} type="button">重置条件</button>
              )}
            </div>

            <div className={`favorites-batch-toolbar${selectionMode ? ' is-active' : ''}`}>
              {selectionMode ? (
                <>
                  <label className="batch-select-all">
                    <input
                      checked={allVisibleSelected}
                      disabled={Boolean(batchPending) || visibleIds.length === 0}
                      onChange={(event) => toggleAllVisible(event.target.checked)}
                      ref={selectAllRef}
                      type="checkbox"
                    />
                    <span>全选当前结果</span>
                  </label>
                  <span aria-live="polite" className="batch-selected-count">
                    已选 {selectedVisibleIds.length} / {visibleIds.length} 件
                  </span>
                  <div className="batch-actions">
                    <button
                      disabled={Boolean(batchPending) || selectedVisibleIds.length === 0}
                      onClick={() => void runBatchAction('cart')}
                      type="button"
                    >
                      {batchPending === 'cart' ? '正在加入…' : '加入清单'}
                    </button>
                    <button
                      className="batch-remove"
                      disabled={Boolean(batchPending) || selectedVisibleIds.length === 0}
                      onClick={() => void runBatchAction('remove')}
                      type="button"
                    >
                      {batchPending === 'remove' ? '正在取消…' : '取消收藏'}
                    </button>
                    <button disabled={Boolean(batchPending)} onClick={exitSelectionMode} type="button">完成</button>
                  </div>
                </>
              ) : (
                <>
                  <span>选择多件收藏后统一处理</span>
                  <button
                    disabled={visibleFavorites.length === 0}
                    onClick={() => setSelectionMode(true)}
                    type="button"
                  >
                    批量管理
                  </button>
                </>
              )}
            </div>

            {visibleFavorites.length > 0 ? (
              <div className="product-grid">
                {visibleFavorites.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    selection={selectionMode ? {
                      selected: selectedIds.has(product.id),
                      onChange: (selected) => toggleSelection(product.id, selected),
                    } : undefined}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <p>收藏中没有符合条件的物品。</p>
                <button onClick={() => setParams({}, { replace: true })} type="button">查看全部收藏</button>
              </div>
            )}
          </>
        ) : (
          <div className="empty-route-state">
            <p className="eyebrow">NOTHING SAVED YET</p>
            <h2>还没有收藏任何物品。</h2>
            <p>在商品卡片或详情页点击“收藏”，它们会集中出现在这里。</p>
            <Link className="primary-action" to="/market">去集市看看</Link>
          </div>
        )}
      </section>
    </main>
  )
}
