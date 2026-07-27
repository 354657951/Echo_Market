import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  createSharedOrder,
  createSharedProduct,
  fetchSharedStore,
  importLegacyStore,
  setSharedCartQuantity,
  setSharedFavorite,
  type SharedStoreSnapshot,
} from '../api/storeApi'
import { IS_GITHUB_PAGES_DEMO, withBase } from '../config/runtime'
import { products } from '../data/products'
import type { ListingDraft, Order, Product } from '../types/market'

type SyncStatus = 'loading' | 'ready' | 'saving' | 'error'
type NoticeTone = 'success' | 'error' | 'info'

interface Notice {
  id: number
  message: string
  tone: NoticeTone
}

// 旧版浏览器数据只用于一次性迁移和静态演示版，异常数据会安全回退。
function readStored<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key)
    return stored ? (JSON.parse(stored) as T) : fallback
  } catch {
    return fallback
  }
}

function readLegacySnapshot() {
  return {
    userProducts: readStored<Product[]>('echo-market-products', []),
    cart: readStored<Record<string, number>>('echo-market-cart', {}),
    favorites: readStored<string[]>('echo-market-favorites', []),
    orders: readStored<Order[]>('echo-market-orders', []),
  }
}

function hasLegacyData(snapshot: ReturnType<typeof readLegacySnapshot>) {
  return snapshot.userProducts.length > 0
    || snapshot.favorites.length > 0
    || snapshot.orders.length > 0
    || Object.keys(snapshot.cart).length > 0
}

interface StoreValue {
  currentUser: string
  allProducts: Product[]
  userProducts: Product[]
  favorites: string[]
  favoriteProducts: Product[]
  cart: Record<string, number>
  cartItems: Array<{ product: Product; quantity: number }>
  cartCount: number
  cartTotal: number
  orders: Order[]
  syncStatus: SyncStatus
  syncMessage: string
  lastSyncedAt: string
  refreshSharedData: () => Promise<void>
  addToCart: (product: Product) => Promise<void>
  updateQuantity: (id: string, quantity: number) => Promise<void>
  toggleFavorite: (id: string) => Promise<void>
  publishProduct: (draft: ListingDraft) => Promise<Product>
  checkout: (pickup: string, contactTime: string) => Promise<Order>
}

const StoreContext = createContext<StoreValue | null>(null)

/**
 * 全站业务状态容器。
 * 完整在线版以共享服务端为事实来源；静态演示版才继续使用浏览器本地存储。
 */
export function AppStoreProvider({
  children,
  currentUser,
}: {
  children: ReactNode
  currentUser: string
}) {
  const legacy = useMemo(readLegacySnapshot, [])
  const [allProducts, setAllProducts] = useState<Product[]>(
    IS_GITHUB_PAGES_DEMO ? [...legacy.userProducts, ...products] : products,
  )
  const [cart, setCart] = useState<Record<string, number>>(legacy.cart)
  const [favorites, setFavorites] = useState<string[]>(legacy.favorites)
  const [orders, setOrders] = useState<Order[]>(legacy.orders)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(
    IS_GITHUB_PAGES_DEMO ? 'ready' : 'loading',
  )
  const [syncMessage, setSyncMessage] = useState(
    IS_GITHUB_PAGES_DEMO ? '静态演示数据仅保存在本机' : '正在连接共享数据',
  )
  const [lastSyncedAt, setLastSyncedAt] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)

  const userProducts = useMemo(
    () => allProducts.filter((product) => product.id.startsWith('user-')),
    [allProducts],
  )
  const favoriteProducts = useMemo(
    () => favorites.map((id) => allProducts.find((product) => product.id === id)).filter(Boolean) as Product[],
    [allProducts, favorites],
  )
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

  const applySnapshot = useCallback((snapshot: SharedStoreSnapshot) => {
    setAllProducts(snapshot.products)
    setFavorites(snapshot.favorites)
    setCart(snapshot.cart)
    setOrders(snapshot.orders)
    setLastSyncedAt(snapshot.updatedAt)
  }, [])

  const announce = useCallback((message: string, tone: NoticeTone = 'success') => {
    setNotice({ id: Date.now(), message, tone })
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 3200)
    return () => window.clearTimeout(timer)
  }, [notice])

  const refreshSharedData = useCallback(async () => {
    if (IS_GITHUB_PAGES_DEMO) {
      announce('静态演示版使用本机数据。', 'info')
      return
    }
    setSyncStatus('loading')
    setSyncMessage('正在获取组员的最新修改')
    try {
      const snapshot = await fetchSharedStore()
      applySnapshot(snapshot)
      setSyncStatus('ready')
      setSyncMessage('共享数据已同步')
    } catch (error) {
      setSyncStatus('error')
      setSyncMessage(error instanceof Error ? error.message : '共享数据同步失败')
      announce('同步失败，请稍后点击状态按钮重试。', 'error')
      throw error
    }
  }, [announce, applySnapshot])

  useEffect(() => {
    if (IS_GITHUB_PAGES_DEMO) return
    let active = true

    async function initializeSharedStore() {
      try {
        const migrationKey = 'echo-market-shared-import-v1'
        const shouldImport = !localStorage.getItem(migrationKey) && hasLegacyData(legacy)
        const snapshot = shouldImport
          ? await importLegacyStore(legacy)
          : await fetchSharedStore()
        if (!active) return
        applySnapshot(snapshot)
        setSyncStatus('ready')
        setSyncMessage(shouldImport ? '本地数据已迁移到共享空间' : '共享数据已同步')
        if (shouldImport) {
          localStorage.setItem(migrationKey, 'done')
          ;['echo-market-products', 'echo-market-cart', 'echo-market-favorites', 'echo-market-orders']
            .forEach((key) => localStorage.removeItem(key))
          announce('本机原有数据已安全迁移，组员现在可以共同查看。')
        }
      } catch (error) {
        if (!active) return
        setSyncStatus('error')
        setSyncMessage(error instanceof Error ? error.message : '共享数据同步失败')
      }
    }

    void initializeSharedStore()
    return () => {
      active = false
    }
  }, [announce, applySnapshot, legacy])

  useEffect(() => {
    if (IS_GITHUB_PAGES_DEMO) return
    const refreshSilently = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const snapshot = await fetchSharedStore()
        applySnapshot(snapshot)
        setSyncStatus('ready')
        setSyncMessage('共享数据已同步')
      } catch {
        setSyncStatus('error')
        setSyncMessage('暂时无法获取最新数据')
      }
    }
    const timer = window.setInterval(refreshSilently, 30000)
    window.addEventListener('focus', refreshSilently)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshSilently)
    }
  }, [applySnapshot])

  // 静态演示版保留原有本地能力；完整在线版不再把业务状态写入浏览器。
  useEffect(() => {
    if (!IS_GITHUB_PAGES_DEMO) return
    localStorage.setItem('echo-market-products', JSON.stringify(userProducts))
    localStorage.setItem('echo-market-cart', JSON.stringify(cart))
    localStorage.setItem('echo-market-favorites', JSON.stringify(favorites))
    localStorage.setItem('echo-market-orders', JSON.stringify(orders))
  }, [cart, favorites, orders, userProducts])

  async function runSharedMutation<T>(
    action: () => Promise<{ store: SharedStoreSnapshot } & T>,
    successMessage: string,
  ) {
    setSyncStatus('saving')
    setSyncMessage('正在写入共享空间')
    try {
      const result = await action()
      applySnapshot(result.store)
      setSyncStatus('ready')
      setSyncMessage('共享数据已同步')
      announce(successMessage)
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败，请稍后重试。'
      setSyncStatus('error')
      setSyncMessage(message)
      announce(message, 'error')
      throw error
    }
  }

  async function addToCart(product: Product) {
    const quantity = Math.min((cart[product.id] || 0) + 1, 5)
    if (IS_GITHUB_PAGES_DEMO) {
      setCart((current) => ({ ...current, [product.id]: quantity }))
      announce(`已将“${product.title}”加入清单。`)
      return
    }
    await runSharedMutation(
      async () => ({ store: await setSharedCartQuantity(product.id, quantity) }),
      `已将“${product.title}”加入共享清单。`,
    )
  }

  async function updateQuantity(id: string, quantity: number) {
    const normalized = Math.max(0, Math.min(quantity, 5))
    if (IS_GITHUB_PAGES_DEMO) {
      setCart((current) => {
        const next = { ...current }
        if (normalized <= 0) delete next[id]
        else next[id] = normalized
        return next
      })
      announce(normalized > 0 ? '商品数量已更新。' : '商品已从清单移除。')
      return
    }
    await runSharedMutation(
      async () => ({ store: await setSharedCartQuantity(id, normalized) }),
      normalized > 0 ? '共享清单数量已更新。' : '商品已从共享清单移除。',
    )
  }

  async function toggleFavorite(id: string) {
    const favorite = !favorites.includes(id)
    if (IS_GITHUB_PAGES_DEMO) {
      setFavorites((current) =>
        favorite ? [...current, id] : current.filter((item) => item !== id),
      )
      announce(favorite ? '已加入收藏。' : '已取消收藏。')
      return
    }
    await runSharedMutation(
      async () => ({ store: await setSharedFavorite(id, favorite) }),
      favorite ? '已加入共享收藏。' : '已取消共享收藏。',
    )
  }

  async function publishProduct(draft: ListingDraft) {
    if (IS_GITHUB_PAGES_DEMO) {
      const product: Product = {
        id: `user-${Date.now()}`,
        title: draft.title.trim(),
        category: draft.category,
        description: draft.description.trim(),
        price: Number(draft.price),
        condition: draft.condition,
        campus: '待与买家协商',
        seller: currentUser,
        image: draft.image || withBase('/products/lamp.jpg'),
        tags: draft.tags
          .split(/[·、,，]/)
          .map((tag) => tag.trim())
          .filter(Boolean)
          .slice(0, 4),
        postedAt: '刚刚发布',
      }
      setAllProducts((current) => [product, ...current])
      announce('商品已保存到本机演示数据。')
      return product
    }
    const result = await runSharedMutation(
      () => createSharedProduct(draft),
      '商品已发布，组员刷新后即可看到。',
    )
    return result.product
  }

  async function checkout(pickup: string, contactTime: string) {
    if (cartItems.length === 0) throw new Error('交易清单为空。')
    if (IS_GITHUB_PAGES_DEMO) {
      const order: Order = {
        id: `ECHO-${Date.now().toString().slice(-8)}`,
        createdAt: new Date().toLocaleString('zh-CN', { hour12: false }),
        total: cartTotal,
        status: '待与卖家确认',
        pickup,
        contactTime,
        items: cartItems,
      }
      setOrders((current) => [order, ...current])
      setCart({})
      announce('交易确认单已生成。')
      return order
    }
    const result = await runSharedMutation(
      () => createSharedOrder(pickup, contactTime),
      '交易确认单已保存到共享记录。',
    )
    return result.order
  }

  const value = {
    currentUser,
    allProducts,
    userProducts,
    favorites,
    favoriteProducts,
    cart,
    cartItems,
    cartCount,
    cartTotal,
    orders,
    syncStatus,
    syncMessage,
    lastSyncedAt,
    refreshSharedData,
    addToCart,
    updateQuantity,
    toggleFavorite,
    publishProduct,
    checkout,
  }

  return (
    <StoreContext.Provider value={value}>
      {children}
      {notice && (
        <div className="action-toast" data-tone={notice.tone} key={notice.id} role="status">
          <span aria-hidden="true" />
          <p>{notice.message}</p>
          <button aria-label="关闭提示" onClick={() => setNotice(null)} type="button">关闭</button>
        </div>
      )}
    </StoreContext.Provider>
  )
}

export function useAppStore() {
  const store = useContext(StoreContext)
  if (!store) throw new Error('AppStoreProvider is missing.')
  return store
}
