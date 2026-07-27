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

const app = express()
const port = Number(process.env.PORT || 8787)
const accessCookieName = 'echo_market_access'
const refreshCookieName = 'echo_market_refresh'
const defaultAiApiUrl = 'https://api.siliconflow.cn/v1/chat/completions'
app.use(express.json({ limit: '4mb' }))

function jsonError(response, status, message) { response.status(status).json({ message }) }
function readCookie(request, name) {
  const prefix = `${name}=`
  const entry = String(request.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix))
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : ''
}
function cookie(name, value, maxAge, path = '/') { return `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}` }
function setAuthCookies(response, accessToken, refreshToken) {
  response.append('Set-Cookie', cookie(accessCookieName, accessToken, ACCESS_TOKEN_TTL_SECONDS))
  response.append('Set-Cookie', cookie(refreshCookieName, refreshToken, REFRESH_TOKEN_TTL_SECONDS, '/api/auth'))
}
function clearAuthCookies(response) {
  response.append('Set-Cookie', cookie(accessCookieName, '', 0))
  response.append('Set-Cookie', cookie(refreshCookieName, '', 0, '/api/auth'))
}
function sessionSecret() { return validateSessionSecret(process.env.APP_SESSION_SECRET) }
function publicUser(user) { return { id: user.id, username: user.username } }

app.use('/api', (request, response, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return next()
  const origin = request.headers.origin
  if (!origin) return next()
  try {
    const source = new URL(origin)
    const host = request.hostname
    const bothLocal = ['localhost', '127.0.0.1'].includes(source.hostname) && ['localhost', '127.0.0.1'].includes(host)
    if (bothLocal || source.host === request.get('host')) return next()
  } catch { /* invalid origins are rejected below */ }
  return jsonError(response, 403, '请求来源校验失败。')
})

let legacyBootstrap
async function ensureLegacyAccount() {
  if (legacyBootstrap) return legacyBootstrap
  legacyBootstrap = (async () => {
    if (!process.env.APP_USERNAME || !process.env.APP_PASSWORD) return null
    const { username, normalized } = validateUsername(process.env.APP_USERNAME)
    const passwordHash = await hashPassword(process.env.APP_PASSWORD)
    return ensureLegacyLocalUser(username, normalized, passwordHash)
  })()
  return legacyBootstrap
}
async function issueSession(response, user) {
  const refresh = createRefreshToken()
  const now = new Date().toISOString()
  await createLocalRefreshSession({ id: refresh.sessionId, userId: user.id, tokenHash: await hashRefreshSecret(refresh.secret), expiresAt: Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000, createdAt: now, lastUsedAt: now })
  const accessToken = await signAccessToken(publicUser(user), refresh.sessionId, sessionSecret())
  setAuthCookies(response, accessToken, refresh.token)
  return { authenticated: true, user: publicUser(user), accessExpiresAt: Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000 }
}
async function authenticatedUser(request) {
  try {
    const verified = await verifyAccessToken(readCookie(request, accessCookieName), sessionSecret())
    const user = await getLocalSessionUser(verified.sessionId)
    return user && user.id === verified.user.id ? user : null
  } catch { return null }
}
async function requireUser(request, response) {
  const user = await authenticatedUser(request)
  if (!user) jsonError(response, 401, '登录已过期，请重新登录。')
  return user
}

app.get('/api/health', (_request, response) => response.json({ ok: true, authConfigured: Boolean(process.env.APP_SESSION_SECRET && process.env.APP_INVITE_CODE), aiConfigured: Boolean(process.env.AI_API_KEY && process.env.AI_MODEL), sharedStoreConfigured: true, mediaStoreConfigured: true }))
app.post('/api/auth/register', async (request, response) => {
  try {
    sessionSecret()
    await ensureLegacyAccount()
    if (!process.env.APP_INVITE_CODE) return jsonError(response, 503, '注册邀请码尚未配置。')
    if (!safeEqual(request.body?.inviteCode, process.env.APP_INVITE_CODE)) return jsonError(response, 403, '邀请码不正确。')
    const { username, normalized } = validateUsername(request.body?.username)
    const passwordHash = await hashPassword(validatePassword(request.body?.password))
    const user = await createLocalUser({ username, usernameNormalized: normalized, passwordHash })
    if (!user) return jsonError(response, 409, '该用户名已被使用。')
    response.status(201).json(await issueSession(response, user))
  } catch (error) { jsonError(response, error instanceof Error && error.message.includes('APP_') ? 503 : 400, error instanceof Error ? error.message : '注册失败。') }
})
app.post('/api/auth/login', async (request, response) => {
  try {
    sessionSecret(); await ensureLegacyAccount()
    const { normalized } = normalizeUsername(request.body?.username)
    const user = await findLocalUserByNormalized(normalized)
    if (!user || !(await verifyPassword(request.body?.password, user.passwordHash))) return jsonError(response, 401, '账号或密码不正确。')
    response.json(await issueSession(response, user))
  } catch (error) { jsonError(response, error instanceof Error && error.message.includes('APP_') ? 503 : 401, error instanceof Error && error.message.includes('APP_') ? error.message : '账号或密码不正确。') }
})
app.post('/api/auth/refresh', async (request, response) => {
  try {
    const parsed = parseRefreshToken(readCookie(request, refreshCookieName)); if (!parsed) return jsonError(response, 401, '刷新会话无效。')
    const session = await getLocalRefreshSession(parsed.sessionId); if (!session || session.expiresAt <= Date.now()) { await deleteLocalRefreshSession(parsed.sessionId); clearAuthCookies(response); return jsonError(response, 401, '刷新会话已过期。') }
    const oldHash = await hashRefreshSecret(parsed.secret)
    if (!safeEqual(oldHash, session.tokenHash)) { await deleteLocalRefreshSession(parsed.sessionId); clearAuthCookies(response); return jsonError(response, 401, '刷新会话无效。') }
    const user = await getLocalSessionUser(parsed.sessionId); if (!user) return jsonError(response, 401, '用户不存在。')
    const next = createRefreshToken(parsed.sessionId); const nextHash = await hashRefreshSecret(next.secret)
    if (!(await rotateLocalRefreshSession(parsed.sessionId, oldHash, nextHash))) return jsonError(response, 401, '刷新会话已失效。')
    const accessToken = await signAccessToken(user, parsed.sessionId, sessionSecret()); setAuthCookies(response, accessToken, next.token)
    response.json({ authenticated: true, user, accessExpiresAt: Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000 })
  } catch { clearAuthCookies(response); jsonError(response, 401, '刷新会话无效。') }
})
app.get('/api/auth/session', async (request, response) => { const user = await authenticatedUser(request); response.setHeader('Cache-Control', 'no-store'); response.json({ authenticated: Boolean(user), user }) })
app.post('/api/auth/logout', async (request, response) => { const parsed = parseRefreshToken(readCookie(request, refreshCookieName)); if (parsed) await deleteLocalRefreshSession(parsed.sessionId); clearAuthCookies(response); response.json({ authenticated: false, user: null }) })

function createAiRequestBody(apiUrl, model, prompt) {
  return apiUrl.includes('/chat/completions') ? { model, messages: [{ role: 'system', content: '你是校园二手交易平台的商品编辑。请严格返回一个 JSON 对象，不要输出 Markdown。' }, { role: 'user', content: prompt }], stream: false, temperature: 0.2, max_tokens: 800, enable_thinking: false, response_format: { type: 'json_object' } } : { model, input: prompt }
}
app.post('/api/ai-polish', async (request, response) => {
  if (!(await requireUser(request, response))) return
  if (!process.env.AI_API_KEY || !process.env.AI_MODEL) return jsonError(response, 503, 'AI 接口尚未配置。请在 .env 中填写 AI_API_KEY 与 AI_MODEL。')
  const raw = typeof request.body?.rawDescription === 'string' ? request.body.rawDescription.trim() : ''; if (raw.length < 8) return jsonError(response, 400, '请至少输入 8 个字的物品信息。')
  const prompt = ['你是校园二手交易平台的商品编辑。', '请把用户提供的信息整理为可信、克制、无夸张承诺的商品资料。', '只返回合法 JSON，不要使用 Markdown。', '字段必须为 title、category、tags、description、priceSuggestion、safetyNote。', 'category 只能是 数码、学习、生活、运动、影音 之一。', 'tags 必须是 2 到 4 个简短中文字符串组成的数组。', `原始描述：${raw}`, `成色：${request.body.condition || '未说明'}`, `期望价格：${request.body.expectedPrice || '未说明'}`].join('\n')
  try { const apiUrl = process.env.AI_API_URL || defaultAiApiUrl; const upstream = await fetch(apiUrl, { method: 'POST', headers: { Authorization: `Bearer ${process.env.AI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(createAiRequestBody(apiUrl, process.env.AI_MODEL, prompt)) }); const payload = await upstream.json(); if (!upstream.ok) return jsonError(response, 502, payload?.error?.message || payload?.message || 'AI 服务暂时不可用。'); const text = payload.output_text || payload.choices?.[0]?.message?.content; if (typeof text !== 'string') return jsonError(response, 502, 'AI 返回内容无法解析。'); response.json({ configured: true, listing: JSON.parse(text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()) }) } catch { jsonError(response, 502, '连接 AI 服务失败，请检查接口地址与网络。') }
})

app.get('/api/store', async (req, res) => { const user = await requireUser(req, res); if (user) res.json({ store: await getLocalStore(user.id) }) })
app.post('/api/store/bootstrap', async (req, res) => { const user = await requireUser(req, res); if (!user) return; try { const { state } = await bootstrapLocalStore(req.body || {}, user); res.json({ store: state, imported: true }) } catch (error) { jsonError(res, 500, error.message) } })
app.post('/api/products', async (req, res) => { const user = await requireUser(req, res); if (!user) return; try { const result = await createLocalProduct(req.body || {}, user); res.status(201).json({ product: result.product, store: result.state }) } catch (error) { jsonError(res, 400, error.message) } })
app.delete('/api/products/:id', async (req, res) => { const user = await requireUser(req, res); if (!user) return; const result = await deleteLocalProduct(req.params.id, user.id); if (result.result === 'missing') return jsonError(res, 404, '商品不存在或已被删除。'); if (result.result === 'forbidden') return jsonError(res, 403, '只能删除自己发布的商品。'); res.json({ store: result.state }) })
app.put('/api/favorites/:id', async (req, res) => { const user = await requireUser(req, res); if (user) res.json({ store: await updateLocalFavorite(req.params.id, Boolean(req.body?.favorite), user.id) }) })
app.put('/api/cart/:id', async (req, res) => { const user = await requireUser(req, res); if (user) res.json({ store: await updateLocalCart(req.params.id, req.body?.quantity, user.id) }) })
app.post('/api/orders', async (req, res) => { const user = await requireUser(req, res); if (!user) return; try { const result = await createLocalOrder(req.body || {}, user.id); res.status(201).json({ order: result.order, store: result.state }) } catch (error) { jsonError(res, 400, error.message) } })
app.get('/api/media/:filename', async (req, res) => { if (!(await requireUser(req, res))) return; const file = resolveLocalMedia(req.params.filename); if (!file) return jsonError(res, 400, '图片地址无效。'); res.sendFile(file, (error) => { if (error && !res.headersSent) jsonError(res, 404, '图片不存在。') }) })

app.listen(port, '127.0.0.1', () => console.log(`Echo Market API listening on http://127.0.0.1:${port}`))
