import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { products } from './data'
import type { ListingDraft, Order, Product } from './types'

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
    setCart((current) => ({
      ...current,
      [product.id]: Math.min((current[product.id] || 0) + 1, 5),
    }))
  }

  function updateQuantity(id: string, quantity: number) {
    setCart((current) => {
      const next = { ...current }
      if (quantity <= 0) delete next[id]
      else next[id] = Math.min(quantity, 5)
      return next
    })
  }

  function toggleFavorite(id: string) {
    setFavorites((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  function publishProduct(draft: ListingDraft) {
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
  const store = useContext(StoreContext)
  if (!store) throw new Error('AppStoreProvider is missing.')
  return store
}
