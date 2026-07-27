import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { products } from '../data/products'
import type { ListingDraft, Order, Product } from '../types/market'

// 本地存储损坏或首次访问时返回安全默认值，避免页面因 JSON 异常而白屏。
function readStored<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key)
    return stored ? (JSON.parse(stored) as T) : fallback
  } catch {
    return fallback
  }
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
  addToCart: (product: Product) => void
  updateQuantity: (id: string, quantity: number) => void
  toggleFavorite: (id: string) => void
  publishProduct: (draft: ListingDraft) => Product
  checkout: (pickup: string, contactTime: string) => Order
}

const StoreContext = createContext<StoreValue | null>(null)

/**
 * 全站业务状态容器。
 * 商品、收藏、交易清单和确认记录均集中管理，并同步到浏览器本地存储。
 */
export function AppStoreProvider({
  children,
  currentUser,
}: {
  children: ReactNode
  currentUser: string
}) {
  const [userProducts, setUserProducts] = useState<Product[]>(() =>
    readStored<Product[]>('echo-market-products', []),
  )
  const [cart, setCart] = useState<Record<string, number>>(() =>
    readStored<Record<string, number>>('echo-market-cart', {}),
  )
  const [favorites, setFavorites] = useState<string[]>(() =>
    readStored<string[]>('echo-market-favorites', []),
  )
  const [orders, setOrders] = useState<Order[]>(() =>
    readStored<Order[]>('echo-market-orders', []),
  )

  const allProducts = useMemo(() => [...userProducts, ...products], [userProducts])
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

  // 以下四个副作用分别持久化独立业务数据，方便后续替换为真实后端接口。
  useEffect(() => {
    localStorage.setItem('echo-market-products', JSON.stringify(userProducts))
  }, [userProducts])

  useEffect(() => {
    localStorage.setItem('echo-market-cart', JSON.stringify(cart))
  }, [cart])

  useEffect(() => {
    localStorage.setItem('echo-market-favorites', JSON.stringify(favorites))
  }, [favorites])

  useEffect(() => {
    localStorage.setItem('echo-market-orders', JSON.stringify(orders))
  }, [orders])

  function addToCart(product: Product) {
    // 单件商品最多保留 5 件，避免误触造成异常数量。
    setCart((current) => ({
      ...current,
      [product.id]: Math.min((current[product.id] || 0) + 1, 5),
    }))
  }

  function updateQuantity(id: string, quantity: number) {
    // 数量归零时直接删除条目，保证清单结构保持精简。
    setCart((current) => {
      const next = { ...current }
      if (quantity <= 0) delete next[id]
      else next[id] = Math.min(quantity, 5)
      return next
    })
  }

  function toggleFavorite(id: string) {
    // 收藏使用商品 id 存储，避免重复保存完整商品对象。
    setFavorites((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  function publishProduct(draft: ListingDraft) {
    // 发布前页面已经完成基础校验，这里负责规范化标签并生成唯一商品 id。
    const product: Product = {
      id: `user-${Date.now()}`,
      title: draft.title.trim(),
      category: draft.category,
      description: draft.description.trim(),
      price: Number(draft.price),
      condition: draft.condition,
      campus: '待与买家协商',
      seller: currentUser,
      image: draft.image || '/products/lamp.jpg',
      tags: draft.tags
        .split(/[·、,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 4),
      postedAt: '刚刚发布',
    }
    setUserProducts((current) => [product, ...current])
    return product
  }

  function checkout(pickup: string, contactTime: string) {
    // 课程项目不处理线上支付，只生成可追溯的线下交接确认记录。
    if (cartItems.length === 0) throw new Error('交易清单为空。')
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
    return order
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
    addToCart,
    updateQuantity,
    toggleFavorite,
    publishProduct,
    checkout,
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useAppStore() {
  // 统一通过 Hook 访问状态，防止组件绕过 Provider。
  const store = useContext(StoreContext)
  if (!store) throw new Error('AppStoreProvider is missing.')
  return store
}
