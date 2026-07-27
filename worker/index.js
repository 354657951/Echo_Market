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
import { createRefreshSession, createUser, deleteRefreshSession, ensureAuthStore, ensureLegacyUser, findUserByNormalized, getRefreshSession, getSessionUser, rotateRefreshSession } from './auth-store.js'
import { handleStoreApi, serveMedia } from './store-multi.js'

const accessCookieName = 'echo_market_access'
const refreshCookieName = 'echo_market_refresh'
const defaultAiApiUrl = 'https://api.siliconflow.cn/v1/chat/completions'
function json(data, status = 200, headers = {}) { return new Response(JSON.stringify(data), { status, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', ...headers } }) }
function readCookie(request, name) { const prefix = `${name}=`; const entry = (request.headers.get('Cookie') || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix)); return entry ? decodeURIComponent(entry.slice(prefix.length)) : '' }
function cookie(name, value, maxAge, path = '/') { return `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}` }
function authHeaders(access, refresh) { const headers = new Headers({ 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' }); headers.append('Set-Cookie', cookie(accessCookieName, access, ACCESS_TOKEN_TTL_SECONDS)); headers.append('Set-Cookie', cookie(refreshCookieName, refresh, REFRESH_TOKEN_TTL_SECONDS, '/api/auth')); return headers }
function clearHeaders() { const headers = new Headers({ 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' }); headers.append('Set-Cookie', cookie(accessCookieName, '', 0)); headers.append('Set-Cookie', cookie(refreshCookieName, '', 0, '/api/auth')); return headers }
const secret = (env) => validateSessionSecret(env.APP_SESSION_SECRET)
const publicUser = (user) => ({ id: user.id, username: user.username })
async function issue(env, user) { const refresh = createRefreshToken(); const stamp = new Date().toISOString(); await createRefreshSession(env, { id: refresh.sessionId, userId: user.id, tokenHash: await hashRefreshSecret(refresh.secret), expiresAt: Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000, createdAt: stamp, lastUsedAt: stamp }); const access = await signAccessToken(publicUser(user), refresh.sessionId, secret(env)); return { body: { authenticated: true, user: publicUser(user), accessExpiresAt: Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000 }, headers: authHeaders(access, refresh.token) } }
async function authenticate(request, env) { try { const verified = await verifyAccessToken(readCookie(request, accessCookieName), secret(env)); const user = await getSessionUser(env, verified.sessionId); return user?.id === verified.user.id ? user : null } catch { return null } }
function sameOrigin(request) { if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return true; const origin = request.headers.get('Origin'); return !origin || origin === new URL(request.url).origin }

async function register(request, env) {
  try { secret(env); await ensureAuthStore(env); if (env.APP_USERNAME && env.APP_PASSWORD) await ensureLegacyUser(env); if (!env.APP_INVITE_CODE) return json({ message: '注册邀请码尚未配置。' }, 503); const body = await request.json(); if (!safeEqual(body.inviteCode, env.APP_INVITE_CODE)) return json({ message: '邀请码不正确。' }, 403); const { username, normalized } = validateUsername(body.username); const passwordHash = await hashPassword(validatePassword(body.password)); const user = await createUser(env, { username, normalized, passwordHash }); if (!user) return json({ message: '该用户名已被使用。' }, 409); const result = await issue(env, user); return new Response(JSON.stringify(result.body), { status: 201, headers: result.headers }) } catch (error) { return json({ message: error instanceof Error ? error.message : '注册失败。' }, String(error).includes('APP_') || String(error).includes('D1') ? 503 : 400) }
}
async function login(request, env) {
  try { secret(env); await ensureAuthStore(env); const body = await request.json(); const { normalized } = normalizeUsername(body.username); if (env.APP_USERNAME && normalized === normalizeUsername(env.APP_USERNAME).normalized) await ensureLegacyUser(env); const user = await findUserByNormalized(env, normalized); if (!user || !(await verifyPassword(body.password, user.passwordHash))) return json({ message: '账号或密码不正确。' }, 401); const result = await issue(env, user); return new Response(JSON.stringify(result.body), { headers: result.headers }) } catch (error) { return json({ message: String(error).includes('APP_') || String(error).includes('D1') ? String(error).replace(/^Error:\s*/, '') : '账号或密码不正确。' }, String(error).includes('APP_') || String(error).includes('D1') ? 503 : 401) }
}
async function refresh(request, env) {
  const parsed = parseRefreshToken(readCookie(request, refreshCookieName)); if (!parsed) return new Response(JSON.stringify({ message: '刷新会话无效。' }), { status: 401, headers: clearHeaders() })
  try { const session = await getRefreshSession(env, parsed.sessionId); if (!session || Number(session.expiresAt) <= Date.now()) { await deleteRefreshSession(env, parsed.sessionId); return new Response(JSON.stringify({ message: '刷新会话已过期。' }), { status: 401, headers: clearHeaders() }) } const oldHash = await hashRefreshSecret(parsed.secret); if (!safeEqual(oldHash, session.tokenHash)) { await deleteRefreshSession(env, parsed.sessionId); return new Response(JSON.stringify({ message: '刷新会话无效。' }), { status: 401, headers: clearHeaders() }) } const user = await getSessionUser(env, parsed.sessionId); if (!user) throw new Error('missing user'); const next = createRefreshToken(parsed.sessionId); if (!(await rotateRefreshSession(env, parsed.sessionId, oldHash, await hashRefreshSecret(next.secret)))) throw new Error('stale refresh'); const access = await signAccessToken(user, parsed.sessionId, secret(env)); return new Response(JSON.stringify({ authenticated: true, user, accessExpiresAt: Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000 }), { headers: authHeaders(access, next.token) }) } catch { return new Response(JSON.stringify({ message: '刷新会话无效。' }), { status: 401, headers: clearHeaders() }) }
}
async function logout(request, env) { const parsed = parseRefreshToken(readCookie(request, refreshCookieName)); if (parsed) await deleteRefreshSession(env, parsed.sessionId); return new Response(JSON.stringify({ authenticated: false, user: null }), { headers: clearHeaders() }) }
function createAiBody(url, model, prompt) { return url.includes('/chat/completions') ? { model, messages: [{ role: 'system', content: '你是校园二手交易平台的商品编辑。请严格返回一个 JSON 对象，不要输出 Markdown。' }, { role: 'user', content: prompt }], stream: false, temperature: 0.2, max_tokens: 800, enable_thinking: false, response_format: { type: 'json_object' } } : { model, input: prompt } }
async function polish(request, env) { if (!env.AI_API_KEY || !env.AI_MODEL) return json({ configured: false, message: 'AI 接口尚未配置。' }, 503); const body = await request.json(); const raw = typeof body.rawDescription === 'string' ? body.rawDescription.trim() : ''; if (raw.length < 8) return json({ message: '请至少输入 8 个字的物品信息。' }, 400); const prompt = ['你是校园二手交易平台的商品编辑。', '请把用户提供的信息整理为可信、克制、无夸张承诺的商品资料。', '只返回合法 JSON，不要使用 Markdown。', '字段必须为 title、category、tags、description、priceSuggestion、safetyNote。', 'category 只能是 数码、学习、生活、运动、影音 之一。', `原始描述：${raw}`, `成色：${body.condition || '未说明'}`, `期望价格：${body.expectedPrice || '未说明'}`].join('\n'); try { const url = env.AI_API_URL || defaultAiApiUrl; const upstream = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${env.AI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(createAiBody(url, env.AI_MODEL, prompt)) }); const payload = await upstream.json(); if (!upstream.ok) return json({ message: payload?.error?.message || payload?.message || 'AI 服务暂时不可用。' }, 502); const value = payload.output_text || payload.choices?.[0]?.message?.content; if (typeof value !== 'string') return json({ message: 'AI 返回内容无法解析。' }, 502); return json({ configured: true, listing: JSON.parse(value.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()) }) } catch { return json({ message: '连接 AI 服务失败，请检查接口地址与网络。' }, 502) } }

export default { async fetch(request, env) {
  const url = new URL(request.url)
  if (url.pathname.startsWith('/api/') && !sameOrigin(request)) return json({ message: '请求来源校验失败。' }, 403)
  if (url.pathname === '/api/health') return json({ ok: true, authConfigured: Boolean(env.DB && env.APP_SESSION_SECRET && env.APP_INVITE_CODE), aiConfigured: Boolean(env.AI_API_KEY && env.AI_MODEL), sharedStoreConfigured: Boolean(env.DB), mediaStoreConfigured: Boolean(env.MEDIA), storageMode: env.DB ? 'd1' : 'unconfigured', mediaMode: env.MEDIA ? 'r2' : 'unconfigured' })
  if (url.pathname === '/api/auth/register' && request.method === 'POST') return register(request, env)
  if (url.pathname === '/api/auth/login' && request.method === 'POST') return login(request, env)
  if (url.pathname === '/api/auth/refresh' && request.method === 'POST') return refresh(request, env)
  if (url.pathname === '/api/auth/session' && request.method === 'GET') { const user = await authenticate(request, env); return json({ authenticated: Boolean(user), user }) }
  if (url.pathname === '/api/auth/logout' && request.method === 'POST') return logout(request, env)
  const protectedPath = url.pathname === '/api/ai-polish' || url.pathname.startsWith('/api/media/') || url.pathname === '/api/store' || url.pathname === '/api/store/bootstrap' || url.pathname === '/api/products' || url.pathname.startsWith('/api/products/') || url.pathname === '/api/orders' || url.pathname.startsWith('/api/favorites/') || url.pathname.startsWith('/api/cart/')
  if (protectedPath) { const user = await authenticate(request, env); if (!user) return json({ message: '登录已过期，请重新登录。' }, 401); if (url.pathname === '/api/ai-polish' && request.method === 'POST') return polish(request, env); if (url.pathname.startsWith('/api/media/')) return serveMedia(request, env, url); const response = await handleStoreApi(request, env, user, url); if (response) return response }
  const asset = await env.ASSETS.fetch(request); if (request.method === 'GET' && asset.status === 404 && request.headers.get('Accept')?.includes('text/html')) return env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request)); return asset
} }
