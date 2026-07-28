import type { ListingDraft, Order, Product } from '../types/market'
import { authFetch } from './authClient'

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

export class StoreApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'StoreApiError'
    this.status = status
  }
}

export function isUnauthorizedStoreError(error: unknown): error is StoreApiError {
  return error instanceof StoreApiError && error.status === 401
}

async function requestJson<T>(
  path: string,
  expectedUserId: string,
  init?: RequestInit,
): Promise<T> {
  const response = await authFetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  }, expectedUserId)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new StoreApiError(
      String(payload.message || '共享数据暂时不可用，请稍后重试。'),
      response.status,
    )
  }
  return payload as T
}

export async function fetchSharedStore(expectedUserId: string) {
  const payload = await requestJson<StoreResponse>('/api/store', expectedUserId)
  return payload.store
}

export async function importLegacyStore(legacy: {
  userProducts: Product[]
  favorites: string[]
  cart: Record<string, number>
  orders: Order[]
}, expectedUserId: string) {
  const payload = await requestJson<StoreResponse>('/api/store/bootstrap', expectedUserId, {
    method: 'POST',
    body: JSON.stringify(legacy),
  })
  return payload.store
}

export async function createSharedProduct(draft: ListingDraft, expectedUserId: string) {
  const payload = await requestJson<StoreResponse & { product: Product }>('/api/products', expectedUserId, {
    method: 'POST',
    body: JSON.stringify(draft),
  })
  return payload
}

export async function setSharedFavorite(
  productId: string,
  favorite: boolean,
  expectedUserId: string,
) {
  const payload = await requestJson<StoreResponse>(
    `/api/favorites/${encodeURIComponent(productId)}`,
    expectedUserId,
    {
      method: 'PUT',
      body: JSON.stringify({ favorite }),
    },
  )
  return payload.store
}

export async function setSharedCartQuantity(
  productId: string,
  quantity: number,
  expectedUserId: string,
) {
  const payload = await requestJson<StoreResponse>(
    `/api/cart/${encodeURIComponent(productId)}`,
    expectedUserId,
    {
      method: 'PUT',
      body: JSON.stringify({ quantity }),
    },
  )
  return payload.store
}

export async function createSharedOrder(
  pickup: string,
  contactTime: string,
  expectedUserId: string,
) {
  const payload = await requestJson<StoreResponse & { order: Order }>('/api/orders', expectedUserId, {
    method: 'POST',
    body: JSON.stringify({ pickup, contactTime }),
  })
  return payload
}
