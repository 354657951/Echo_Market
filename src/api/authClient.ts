export interface AuthUser {
  id: string
  username: string
}

interface AuthPayload {
  authenticated: boolean
  user: AuthUser | null
  accessExpiresAt?: number
  message?: string
}

let refreshPromise: Promise<AuthPayload | null> | null = null

async function readPayload(response: Response): Promise<AuthPayload> {
  return response.json().catch(() => ({ authenticated: false, user: null }))
}

async function refreshInsideLock() {
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
    const locks = navigator.locks
    if (locks) return locks.request('echo-market-auth-refresh', refreshInsideLock)
    return refreshInsideLock()
  })().finally(() => { refreshPromise = null })
  return refreshPromise
}

export async function resolveInitialSession() {
  const response = await fetch('/api/auth/session')
  const payload = await readPayload(response)
  if (response.ok && payload.authenticated && payload.user) return payload.user
  return (await refreshAuthSession())?.user || null
}

export async function authFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init)
  if (response.status !== 401 || String(input).startsWith('/api/auth/')) return response
  const refreshed = await refreshAuthSession()
  if (!refreshed) {
    window.dispatchEvent(new CustomEvent('echo-market-auth-expired'))
    return response
  }
  return fetch(input, init)
}

async function submitAuth(path: string, body: Record<string, string>) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await readPayload(response)
  if (!response.ok || !payload.user) throw new Error(payload.message || '认证失败，请重试。')
  return payload.user
}

export function login(username: string, password: string) {
  return submitAuth('/api/auth/login', { username, password })
}

export function register(username: string, password: string, inviteCode: string) {
  return submitAuth('/api/auth/register', { username, password, inviteCode })
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' })
}
