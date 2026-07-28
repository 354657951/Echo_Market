export interface AuthUser {
  id: string
  username: string
}

export const AUTH_EXPIRED_EVENT = 'echo-market-auth-expired'
export const AUTH_SESSION_CHANGED_EVENT = 'echo-market-auth-session-changed'
export const AUTH_SESSION_VERIFIED_EVENT = 'echo-market-auth-session-verified'

export interface AuthExpiredEventDetail {
  userId?: string
}

export interface AuthSessionChangedEventDetail {
  previousUserId: string
  user: AuthUser
}

interface AuthPayload {
  authenticated: boolean
  user: AuthUser | null
  accessExpiresAt?: number
  message?: string
}

let refreshPromise: Promise<AuthPayload | null> | null = null

async function readPayload(response: Response): Promise<AuthPayload> {
  return response
    .json()
    .catch(() => ({ authenticated: false, user: null }))
}

async function refreshInsideLock() {
  // 其他标签页可能刚完成刷新；先复查会话，减少刷新令牌并发轮换。
  const sessionResponse = await fetch('/api/auth/session')
  const session = await readPayload(sessionResponse)
  if (sessionResponse.ok && session.authenticated && session.user) return session

  const response = await fetch('/api/auth/refresh', { method: 'POST' })
  const payload = await readPayload(response)
  return response.ok && payload.authenticated && payload.user ? payload : null
}

export async function refreshAuthSession() {
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    // 支持 Web Locks 的浏览器会在多个标签页之间串行刷新同一会话。
    const locks = navigator.locks
    if (locks) {
      return locks.request('echo-market-auth-refresh', refreshInsideLock)
    }
    return refreshInsideLock()
  })().finally(() => {
    refreshPromise = null
  })
  return refreshPromise
}

export async function resolveInitialSession() {
  const response = await fetch('/api/auth/session')
  const payload = await readPayload(response)
  if (response.ok && payload.authenticated && payload.user) return payload.user
  return (await refreshAuthSession())?.user || null
}

/**
 * 带自动续期的同源请求。
 * 访问令牌过期时只重试一次，避免业务请求进入无限刷新循环。
 */
export async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  expectedUserId?: string,
) {
  const response = await fetch(input, init)
  if (response.status !== 401 || String(input).startsWith('/api/auth/')) {
    return response
  }

  const refreshed = await refreshAuthSession()
  if (!refreshed) {
    window.dispatchEvent(new CustomEvent<AuthExpiredEventDetail>(
      AUTH_EXPIRED_EVENT,
      { detail: { userId: expectedUserId } },
    ))
    return response
  }

  // 旧账号的失败请求不能在刷新后借用新账号身份重试写入。
  if (expectedUserId && refreshed.user?.id !== expectedUserId) {
    if (refreshed.user) {
      window.dispatchEvent(new CustomEvent<AuthSessionChangedEventDetail>(
        AUTH_SESSION_CHANGED_EVENT,
        { detail: { previousUserId: expectedUserId, user: refreshed.user } },
      ))
    }
    return response
  }

  const retried = await fetch(input, init)
  if (retried.status === 401) {
    window.dispatchEvent(new CustomEvent<AuthExpiredEventDetail>(
      AUTH_EXPIRED_EVENT,
      { detail: { userId: expectedUserId } },
    ))
  }
  return retried
}

async function submitAuth(path: string, body: Record<string, string>) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await readPayload(response)
  if (!response.ok || !payload.user) {
    throw new Error(payload.message || '认证失败，请重试。')
  }
  return payload.user
}

export function login(username: string, password: string) {
  return submitAuth('/api/auth/login', { username, password })
}

export function register(
  username: string,
  password: string,
  inviteCode: string,
) {
  return submitAuth('/api/auth/register', { username, password, inviteCode })
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' })
}
