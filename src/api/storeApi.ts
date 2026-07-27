import type { ListingDraft, Order, Product } from '../types/market'

export interface SharedStoreSnapshot {
  products: Product[]
  favorites: string[]
  cart: Record<string, number>
  orders: Order[]
  updatedAt: string
}

interface StoreResponse {
  store: SharedStoreSnapshot
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(String(payload.message || '共享数据暂时不可用，请稍后重试。'))
  }
  return payload as T
}

export async function fetchSharedStore() {
  const payload = await requestJson<StoreResponse>('/api/store')
  return payload.store
}

export async function importLegacyStore(legacy: {
  userProducts: Product[]
  favorites: string[]
  cart: Record<string, number>
  orders: Order[]
}) {
  const payload = await requestJson<StoreResponse>('/api/store/bootstrap', {
    method: 'POST',
    body: JSON.stringify(legacy),
  })
  return payload.store
}

export async function createSharedProduct(draft: ListingDraft) {
  const payload = await requestJson<StoreResponse & { product: Product }>('/api/products', {
    method: 'POST',
    body: JSON.stringify(draft),
  })
  return payload
}

export async function setSharedFavorite(productId: string, favorite: boolean) {
  const payload = await requestJson<StoreResponse>(
    `/api/favorites/${encodeURIComponent(productId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ favorite }),
    },
  )
  return payload.store
}

export async function setSharedCartQuantity(productId: string, quantity: number) {
  const payload = await requestJson<StoreResponse>(
    `/api/cart/${encodeURIComponent(productId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ quantity }),
    },
  )
  return payload.store
}

export async function createSharedOrder(pickup: string, contactTime: string) {
  const payload = await requestJson<StoreResponse & { order: Order }>('/api/orders', {
    method: 'POST',
    body: JSON.stringify({ pickup, contactTime }),
  })
  return payload
}
