import 'dotenv/config'
import express from 'express'
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
} from './auth/core.js'
import {
  bootstrapLocalStore,
  createLocalOrder,
  createLocalProduct,
  createLocalRefreshSession,
  createLocalUser,
  deleteLocalProduct,
  deleteLocalRefreshSession,
  ensureLegacyLocalUser,
  findLocalUserByNormalized,
  getLocalRefreshSession,
  getLocalSessionUser,
  getLocalStore,
  resolveLocalMedia,
  rotateLocalRefreshSession,
  updateLocalCart,
  updateLocalFavorite,
} from './server-store.mjs'
import {
  createAiRequestBody,
  createListingPrompt,
  normalizeAiListing,
  validateAiImage,
} from './shared/ai-listing.js'

const app = express()
const port = Number(process.env.PORT || 8787)
const accessCookieName = 'echo_market_access'
const refreshCookieName = 'echo_market_refresh'
const defaultAiApiUrl = 'https://api.siliconflow.cn/v1/chat/completions'

app.use(express.json({ limit: '4mb' }))

function jsonError(response, status, message) {
  response.status(status).json({ message })
}

// 认证凭据只存放在 HttpOnly Cookie，浏览器脚本无法直接读取。
function readCookie(request, name) {
  const prefix = `${name}=`
  const entry = String(request.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : ''
}

function cookie(name, value, maxAge, path = '/') {
  return `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
}

function setAuthCookies(response, accessToken, refreshToken) {
  response.append(
    'Set-Cookie',
    cookie(accessCookieName, accessToken, ACCESS_TOKEN_TTL_SECONDS),
  )
  response.append(
    'Set-Cookie',
    cookie(refreshCookieName, refreshToken, REFRESH_TOKEN_TTL_SECONDS, '/api/auth'),
  )
}

function clearAuthCookies(response) {
  response.append('Set-Cookie', cookie(accessCookieName, '', 0))
  response.append('Set-Cookie', cookie(refreshCookieName, '', 0, '/api/auth'))
}

function sessionSecret() {
  return validateSessionSecret(process.env.APP_SESSION_SECRET)
}

function publicUser(user) {
  return { id: user.id, username: user.username }
}

function upstreamErrorMessage(payload) {
  if (typeof payload === 'string') return payload
  return payload?.error?.message || payload?.message || 'AI 服务暂时不可用。'
}

function storeError(response, error, fallback = '共享数据暂时无法处理。') {
  jsonError(response, 500, error instanceof Error ? error.message : fallback)
}

// 对写操作校验同源，降低登录 Cookie 被跨站请求滥用的风险。
app.use('/api', (request, response, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return next()
  const origin = request.headers.origin
  if (!origin) return next()

  try {
    const source = new URL(origin)
    const requestHost = request.hostname
    const bothLocal =
      ['localhost', '127.0.0.1'].includes(source.hostname)
      && ['localhost', '127.0.0.1'].includes(requestHost)
    if (bothLocal || source.host === request.get('host')) return next()
  } catch {
    // 非法 Origin 统一在下方拒绝。
  }
  return jsonError(response, 403, '请求来源校验失败。')
})

let legacyBootstrap

// 将旧版共享管理员账号迁移为固定用户，确保旧商品仍有明确归属。
async function ensureLegacyAccount() {
  if (legacyBootstrap) return legacyBootstrap
  legacyBootstrap = (async () => {
    if (!process.env.APP_USERNAME || !process.env.APP_PASSWORD) return null
    const { username, normalized } = validateUsername(process.env.APP_USERNAME)
    const existing = await findLocalUserByNormalized(normalized)
    if (
      existing?.id === 'legacy-campus'
      && await verifyPassword(process.env.APP_PASSWORD, existing.passwordHash)
    ) {
      return existing
    }
    const passwordHash = await hashPassword(process.env.APP_PASSWORD)
    return ensureLegacyLocalUser(username, normalized, passwordHash)
  })()
  return legacyBootstrap
}

async function issueSession(response, user) {
  const refresh = createRefreshToken()
  const stamp = new Date().toISOString()
  await createLocalRefreshSession({
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
    sessionSecret(),
  )
  setAuthCookies(response, accessToken, refresh.token)
  return {
    authenticated: true,
    user: publicUser(user),
    accessExpiresAt: Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000,
  }
}

async function authenticatedUser(request) {
  try {
    const accessToken = readCookie(request, accessCookieName)
    const verified = await verifyAccessToken(accessToken, sessionSecret())
    const user = await getLocalSessionUser(verified.sessionId)
    return user?.id === verified.user.id ? user : null
  } catch {
    return null
  }
}

async function requireUser(request, response) {
  const user = await authenticatedUser(request)
  if (!user) jsonError(response, 401, '登录已过期，请重新登录。')
  return user
}

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    authConfigured: Boolean(process.env.APP_SESSION_SECRET && process.env.APP_INVITE_CODE),
    aiConfigured: Boolean(process.env.AI_API_KEY && process.env.AI_MODEL),
    aiProvider: (process.env.AI_API_URL || defaultAiApiUrl).includes('siliconflow.cn')
      ? 'siliconflow'
      : 'compatible',
    sharedStoreConfigured: true,
    mediaStoreConfigured: true,
  })
})

app.post('/api/auth/register', async (request, response) => {
  try {
    sessionSecret()
    await ensureLegacyAccount()
    if (!process.env.APP_INVITE_CODE) {
      return jsonError(response, 503, '注册邀请码尚未配置。')
    }
    if (!safeEqual(request.body?.inviteCode, process.env.APP_INVITE_CODE)) {
      return jsonError(response, 403, '邀请码不正确。')
    }

    const { username, normalized } = validateUsername(request.body?.username)
    const password = validatePassword(request.body?.password)
    const user = await createLocalUser({
      username,
      usernameNormalized: normalized,
      passwordHash: await hashPassword(password),
    })
    if (!user) return jsonError(response, 409, '该用户名已被使用。')
    response.status(201).json(await issueSession(response, user))
  } catch (error) {
    const message = error instanceof Error ? error.message : '注册失败。'
    jsonError(response, message.includes('APP_') ? 503 : 400, message)
  }
})

app.post('/api/auth/login', async (request, response) => {
  try {
    sessionSecret()
    await ensureLegacyAccount()
    const { normalized } = normalizeUsername(request.body?.username)
    const user = await findLocalUserByNormalized(normalized)
    const valid = user && await verifyPassword(request.body?.password, user.passwordHash)
    if (!valid) return jsonError(response, 401, '账号或密码不正确。')
    response.json(await issueSession(response, user))
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    jsonError(
      response,
      message.includes('APP_') ? 503 : 401,
      message.includes('APP_') ? message : '账号或密码不正确。',
    )
  }
})

app.post('/api/auth/refresh', async (request, response) => {
  try {
    const parsed = parseRefreshToken(readCookie(request, refreshCookieName))
    if (!parsed) {
      clearAuthCookies(response)
      return jsonError(response, 401, '刷新会话无效。')
    }

    const stored = await getLocalRefreshSession(parsed.sessionId)
    if (!stored || stored.expiresAt <= Date.now()) {
      await deleteLocalRefreshSession(parsed.sessionId)
      clearAuthCookies(response)
      return jsonError(response, 401, '刷新会话已过期。')
    }

    const previousHash = await hashRefreshSecret(parsed.secret)
    if (!safeEqual(previousHash, stored.tokenHash)) {
      await deleteLocalRefreshSession(parsed.sessionId)
      clearAuthCookies(response)
      return jsonError(response, 401, '刷新会话无效。')
    }

    const user = await getLocalSessionUser(parsed.sessionId)
    if (!user) throw new Error('用户不存在。')
    const next = createRefreshToken(parsed.sessionId)
    const rotated = await rotateLocalRefreshSession(
      parsed.sessionId,
      previousHash,
      await hashRefreshSecret(next.secret),
    )
    if (!rotated) throw new Error('刷新会话已失效。')

    const accessToken = await signAccessToken(
      user,
      parsed.sessionId,
      sessionSecret(),
    )
    setAuthCookies(response, accessToken, next.token)
    response.json({
      authenticated: true,
      user,
      accessExpiresAt: Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000,
    })
  } catch {
    clearAuthCookies(response)
    jsonError(response, 401, '刷新会话无效。')
  }
})

app.get('/api/auth/session', async (request, response) => {
  const user = await authenticatedUser(request)
  response.setHeader('Cache-Control', 'no-store')
  response.json({ authenticated: Boolean(user), user })
})

app.post('/api/auth/logout', async (request, response) => {
  const parsed = parseRefreshToken(readCookie(request, refreshCookieName))
  if (parsed) await deleteLocalRefreshSession(parsed.sessionId)
  clearAuthCookies(response)
  response.json({ authenticated: false, user: null })
})

app.post('/api/ai-polish', async (request, response) => {
  if (!(await requireUser(request, response))) return
  const apiKey = process.env.AI_API_KEY
  const model = process.env.AI_MODEL
  const apiUrl = process.env.AI_API_URL || defaultAiApiUrl
  if (!apiKey || !model) {
    return jsonError(
      response,
      503,
      'AI 接口尚未配置。请在 .env 中填写 AI_API_KEY 与 AI_MODEL。',
    )
  }

  const { rawDescription, condition, expectedPrice, image } = request.body ?? {}
  const imageValidation = validateAiImage(image)
  if (!imageValidation.ok) {
    return jsonError(response, 400, imageValidation.message)
  }
  if (typeof rawDescription !== 'string' || rawDescription.trim().length < 8) {
    return jsonError(response, 400, '请至少输入 8 个字的物品信息。')
  }

  const prompt = createListingPrompt({ rawDescription, condition, expectedPrice })
  try {
    const upstream = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        createAiRequestBody(apiUrl, model, prompt, imageValidation.image),
      ),
    })
    const payload = await upstream.json()
    if (!upstream.ok) {
      return jsonError(response, 502, upstreamErrorMessage(payload))
    }

    const text =
      payload.output_text
      || payload.choices?.[0]?.message?.content
      || payload.output
        ?.flatMap((item) => item.content || [])
        .find((item) => item.type === 'output_text')?.text
    if (typeof text !== 'string') {
      return jsonError(response, 502, 'AI 返回内容无法解析。')
    }

    const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
    const listing = normalizeAiListing(
      JSON.parse(cleaned),
      { rawDescription, condition, expectedPrice },
    )
    response.json({ configured: true, listing })
  } catch {
    jsonError(response, 502, '连接 AI 服务失败，请检查接口地址与网络。')
  }
})

app.get('/api/store', async (request, response) => {
  const user = await requireUser(request, response)
  if (!user) return
  try {
    response.json({ store: await getLocalStore(user.id) })
  } catch (error) {
    storeError(response, error)
  }
})

app.post('/api/store/bootstrap', async (request, response) => {
  const user = await requireUser(request, response)
  if (!user) return
  try {
    const { state } = await bootstrapLocalStore(request.body ?? {}, user)
    response.json({ store: state, imported: true })
  } catch (error) {
    jsonError(response, 500, error instanceof Error ? error.message : '本地数据迁移失败。')
  }
})

app.post('/api/products', async (request, response) => {
  const user = await requireUser(request, response)
  if (!user) return
  try {
    const result = await createLocalProduct(request.body ?? {}, user)
    response.status(201).json({ product: result.product, store: result.state })
  } catch (error) {
    jsonError(response, 400, error instanceof Error ? error.message : '商品发布失败。')
  }
})

app.delete('/api/products/:id', async (request, response) => {
  const user = await requireUser(request, response)
  if (!user) return
  try {
    const result = await deleteLocalProduct(request.params.id, user.id)
    if (result.result === 'missing') {
      return jsonError(response, 404, '商品不存在或已被删除。')
    }
    if (result.result === 'forbidden') {
      return jsonError(response, 403, '只能删除自己发布的商品。')
    }
    response.json({ store: result.state })
  } catch (error) {
    storeError(response, error, '商品删除失败。')
  }
})

app.put('/api/favorites/:id', async (request, response) => {
  const user = await requireUser(request, response)
  if (!user) return
  try {
    response.json({
      store: await updateLocalFavorite(
        request.params.id,
        Boolean(request.body?.favorite),
        user.id,
      ),
    })
  } catch (error) {
    storeError(response, error)
  }
})

app.put('/api/cart/:id', async (request, response) => {
  const user = await requireUser(request, response)
  if (!user) return
  try {
    response.json({
      store: await updateLocalCart(
        request.params.id,
        request.body?.quantity,
        user.id,
      ),
    })
  } catch (error) {
    storeError(response, error)
  }
})

app.post('/api/orders', async (request, response) => {
  const user = await requireUser(request, response)
  if (!user) return
  try {
    const result = await createLocalOrder(request.body ?? {}, user.id)
    response.status(201).json({ order: result.order, store: result.state })
  } catch (error) {
    jsonError(response, 400, error instanceof Error ? error.message : '交易确认失败。')
  }
})

app.get('/api/media/:filename', async (request, response) => {
  if (!(await requireUser(request, response))) return
  const filePath = resolveLocalMedia(request.params.filename)
  if (!filePath) return jsonError(response, 400, '图片地址无效。')
  response.sendFile(filePath, (error) => {
    if (error && !response.headersSent) jsonError(response, 404, '图片不存在。')
  })
})

app.listen(port, '127.0.0.1', () => {
  console.log(`Echo Market API listening on http://127.0.0.1:${port}`)
})
