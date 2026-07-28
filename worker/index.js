import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  createRefreshToken,
  hashPassword,
  hashRefreshSecret,
  normalizeUsername,
  parseRefreshToken,
  safeEqual,
  signAccessToken,
  validatePassword,
  validateSessionSecret,
  validateUsername,
  verifyAccessToken,
  verifyPassword,
} from '../auth/core.js'
import {
  createAiRequestBody,
  createListingPrompt,
  normalizeAiListing,
  validateAiImage,
} from '../shared/ai-listing.js'
import {
  createRefreshSession,
  createUser,
  deleteRefreshSession,
  ensureAuthStore,
  ensureLegacyUser,
  findUserByNormalized,
  getRefreshSession,
  getSessionUser,
  rotateRefreshSession,
} from './auth-store.js'
import { handleStoreApi, serveMedia } from './store-multi.js'

const accessCookieName = 'echo_market_access'
const refreshCookieName = 'echo_market_refresh'
const defaultAiApiUrl = 'https://api.siliconflow.cn/v1/chat/completions'

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  })
}

function readCookie(request, name) {
  const prefix = `${name}=`
  const entry = (request.headers.get('Cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : ''
}

function cookie(name, value, maxAge, path = '/') {
  return `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
}

function authHeaders(accessToken, refreshToken) {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  })
  headers.append(
    'Set-Cookie',
    cookie(accessCookieName, accessToken, ACCESS_TOKEN_TTL_SECONDS),
  )
  headers.append(
    'Set-Cookie',
    cookie(refreshCookieName, refreshToken, REFRESH_TOKEN_TTL_SECONDS, '/api/auth'),
  )
  return headers
}

function clearAuthHeaders() {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  })
  headers.append('Set-Cookie', cookie(accessCookieName, '', 0))
  headers.append('Set-Cookie', cookie(refreshCookieName, '', 0, '/api/auth'))
  return headers
}

const sessionSecret = (env) => validateSessionSecret(env.APP_SESSION_SECRET)
const publicUser = (user) => ({ id: user.id, username: user.username })

function sameOrigin(request) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return true
  const origin = request.headers.get('Origin')
  return !origin || origin === new URL(request.url).origin
}

function upstreamErrorMessage(payload) {
  if (typeof payload === 'string') return payload
  return payload?.error?.message || payload?.message || 'AI 服务暂时不可用。'
}

async function issueSession(env, user) {
  const refresh = createRefreshToken()
  const stamp = new Date().toISOString()
  await createRefreshSession(env, {
    id: refresh.sessionId,
    userId: user.id,
    tokenHash: await hashRefreshSecret(refresh.secret),
    expiresAt: Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000,
    createdAt: stamp,
    lastUsedAt: stamp,
  })
  const accessToken = await signAccessToken(
    publicUser(user),
    refresh.sessionId,
    sessionSecret(env),
  )
  return {
    body: {
      authenticated: true,
      user: publicUser(user),
      accessExpiresAt: Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000,
    },
    headers: authHeaders(accessToken, refresh.token),
  }
}

async function authenticatedUser(request, env) {
  try {
    const verified = await verifyAccessToken(
      readCookie(request, accessCookieName),
      sessionSecret(env),
    )
    const user = await getSessionUser(env, verified.sessionId)
    return user?.id === verified.user.id ? user : null
  } catch {
    return null
  }
}

async function register(request, env) {
  try {
    sessionSecret(env)
    await ensureAuthStore(env)
    if (env.APP_USERNAME && env.APP_PASSWORD) await ensureLegacyUser(env)
    if (!env.APP_INVITE_CODE) {
      return json({ message: '注册邀请码尚未配置。' }, 503)
    }

    const body = await request.json()
    if (!safeEqual(body.inviteCode, env.APP_INVITE_CODE)) {
      return json({ message: '邀请码不正确。' }, 403)
    }
    const { username, normalized } = validateUsername(body.username)
    const passwordHash = await hashPassword(validatePassword(body.password))
    const user = await createUser(env, { username, normalized, passwordHash })
    if (!user) return json({ message: '该用户名已被使用。' }, 409)

    const result = await issueSession(env, user)
    return new Response(JSON.stringify(result.body), {
      status: 201,
      headers: result.headers,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '注册失败。'
    const status = message.includes('APP_') || message.includes('D1') ? 503 : 400
    return json({ message }, status)
  }
}

async function login(request, env) {
  try {
    sessionSecret(env)
    await ensureAuthStore(env)
    const body = await request.json()
    const { normalized } = normalizeUsername(body.username)
    if (
      env.APP_USERNAME
      && normalized === normalizeUsername(env.APP_USERNAME).normalized
    ) {
      await ensureLegacyUser(env)
    }
    const user = await findUserByNormalized(env, normalized)
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      return json({ message: '账号或密码不正确。' }, 401)
    }
    const result = await issueSession(env, user)
    return new Response(JSON.stringify(result.body), { headers: result.headers })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    const configurationError = message.includes('APP_') || message.includes('D1')
    return json(
      { message: configurationError ? message : '账号或密码不正确。' },
      configurationError ? 503 : 401,
    )
  }
}

async function refresh(request, env) {
  const parsed = parseRefreshToken(readCookie(request, refreshCookieName))
  if (!parsed) {
    return new Response(JSON.stringify({ message: '刷新会话无效。' }), {
      status: 401,
      headers: clearAuthHeaders(),
    })
  }

  try {
    const stored = await getRefreshSession(env, parsed.sessionId)
    if (!stored || Number(stored.expiresAt) <= Date.now()) {
      await deleteRefreshSession(env, parsed.sessionId)
      return new Response(JSON.stringify({ message: '刷新会话已过期。' }), {
        status: 401,
        headers: clearAuthHeaders(),
      })
    }

    const previousHash = await hashRefreshSecret(parsed.secret)
    if (!safeEqual(previousHash, stored.tokenHash)) {
      await deleteRefreshSession(env, parsed.sessionId)
      return new Response(JSON.stringify({ message: '刷新会话无效。' }), {
        status: 401,
        headers: clearAuthHeaders(),
      })
    }

    const user = await getSessionUser(env, parsed.sessionId)
    if (!user) throw new Error('用户不存在。')
    const next = createRefreshToken(parsed.sessionId)
    const rotated = await rotateRefreshSession(
      env,
      parsed.sessionId,
      previousHash,
      await hashRefreshSecret(next.secret),
    )
    if (!rotated) throw new Error('刷新会话已失效。')
    const accessToken = await signAccessToken(
      user,
      parsed.sessionId,
      sessionSecret(env),
    )
    return new Response(
      JSON.stringify({
        authenticated: true,
        user,
        accessExpiresAt: Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000,
      }),
      { headers: authHeaders(accessToken, next.token) },
    )
  } catch {
    return new Response(JSON.stringify({ message: '刷新会话无效。' }), {
      status: 401,
      headers: clearAuthHeaders(),
    })
  }
}

async function logout(request, env) {
  const parsed = parseRefreshToken(readCookie(request, refreshCookieName))
  if (parsed) await deleteRefreshSession(env, parsed.sessionId)
  return new Response(
    JSON.stringify({ authenticated: false, user: null }),
    { headers: clearAuthHeaders() },
  )
}

async function polishListing(request, env) {
  if (!env.AI_API_KEY || !env.AI_MODEL) {
    return json(
      {
        configured: false,
        message: 'AI 接口尚未配置。请填写 AI_API_KEY 与 AI_MODEL。',
      },
      503,
    )
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ message: '请求内容无法解析，请重新选择商品照片。' }, 400)
  }

  const rawDescription =
    typeof body.rawDescription === 'string' ? body.rawDescription.trim() : ''
  const imageValidation = validateAiImage(body.image)
  if (!imageValidation.ok) {
    return json({ message: imageValidation.message }, 400)
  }
  if (rawDescription.length < 8) {
    return json({ message: '请至少输入 8 个字的物品信息。' }, 400)
  }

  const prompt = createListingPrompt({
    rawDescription,
    condition: body.condition,
    expectedPrice: body.expectedPrice,
  })

  try {
    // 商品图片和文字都由 Worker 转发，浏览器永远接触不到 AI 密钥。
    const apiUrl = env.AI_API_URL || defaultAiApiUrl
    const upstream = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.AI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        createAiRequestBody(
          apiUrl,
          env.AI_MODEL,
          prompt,
          imageValidation.image,
        ),
      ),
    })
    const payload = await upstream.json()
    if (!upstream.ok) {
      return json({ message: upstreamErrorMessage(payload) }, 502)
    }

    const text =
      payload.output_text
      || payload.choices?.[0]?.message?.content
      || payload.output
        ?.flatMap((item) => item.content || [])
        .find((item) => item.type === 'output_text')?.text
    if (typeof text !== 'string') {
      return json({ message: 'AI 返回内容无法解析。' }, 502)
    }

    const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
    const listing = normalizeAiListing(
      JSON.parse(cleaned),
      {
        rawDescription,
        condition: body.condition,
        expectedPrice: body.expectedPrice,
      },
    )
    return json({ configured: true, listing })
  } catch {
    return json({ message: '连接 AI 服务失败，请检查接口地址与网络。' }, 502)
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/') && !sameOrigin(request)) {
      return json({ message: '请求来源校验失败。' }, 403)
    }

    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        authConfigured: Boolean(
          env.DB && env.APP_SESSION_SECRET && env.APP_INVITE_CODE,
        ),
        aiConfigured: Boolean(env.AI_API_KEY && env.AI_MODEL),
        sharedStoreConfigured: Boolean(env.DB),
        mediaStoreConfigured: Boolean(env.MEDIA),
        storageMode: env.DB ? 'd1' : 'unconfigured',
        mediaMode: env.MEDIA ? 'r2' : 'unconfigured',
      })
    }
    if (url.pathname === '/api/auth/register' && request.method === 'POST') {
      return register(request, env)
    }
    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      return login(request, env)
    }
    if (url.pathname === '/api/auth/refresh' && request.method === 'POST') {
      return refresh(request, env)
    }
    if (url.pathname === '/api/auth/session' && request.method === 'GET') {
      const user = await authenticatedUser(request, env)
      return json({ authenticated: Boolean(user), user })
    }
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
      return logout(request, env)
    }

    const protectedPath =
      url.pathname === '/api/ai-polish'
      || url.pathname.startsWith('/api/media/')
      || url.pathname === '/api/store'
      || url.pathname === '/api/store/bootstrap'
      || url.pathname === '/api/products'
      || url.pathname.startsWith('/api/products/')
      || url.pathname === '/api/orders'
      || url.pathname.startsWith('/api/favorites/')
      || url.pathname.startsWith('/api/cart/')

    if (protectedPath) {
      const user = await authenticatedUser(request, env)
      if (!user) return json({ message: '登录已过期，请重新登录。' }, 401)
      if (url.pathname === '/api/ai-polish' && request.method === 'POST') {
        return polishListing(request, env)
      }
      if (url.pathname.startsWith('/api/media/')) {
        return serveMedia(request, env, url)
      }
      const storeResponse = await handleStoreApi(request, env, user, url)
      if (storeResponse) return storeResponse
    }

    const asset = await env.ASSETS.fetch(request)
    if (
      request.method === 'GET'
      && asset.status === 404
      && request.headers.get('Accept')?.includes('text/html')
    ) {
      return env.ASSETS.fetch(
        new Request(new URL('/index.html', request.url), request),
      )
    }
    return asset
  },
}
