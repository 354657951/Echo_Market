import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const LEGACY_USER_ID = 'legacy-campus'
const root = fileURLToPath(new URL('./', import.meta.url))
const dataDir = resolve(root, '.local-data')
const uploadDir = resolve(dataDir, 'uploads')
const storeFile = resolve(dataDir, 'store.json')
const seedFile = new URL('./data/seed-products.json', import.meta.url)
const categories = new Set(['数码', '学习', '生活', '运动', '影音'])
const imageTypes = new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'], ['image/gif', 'gif']])
let queue = Promise.resolve()

const nowIso = () => new Date().toISOString()
const clean = (value, length) => String(value || '').trim().slice(0, length)
const tags = (value) => (Array.isArray(value) ? value : String(value || '').split(/[·、,，]/)).map((item) => String(item).trim()).filter(Boolean).slice(0, 4)
function fields(payload) {
  const value = { title: clean(payload.title, 80), description: clean(payload.description, 1000), category: clean(payload.category, 10), condition: clean(payload.condition, 30) || '成色待确认', price: Math.round(Number(payload.price)), tags: tags(payload.tags) }
  if (value.title.length < 2 || value.description.length < 4) throw new Error('请补全商品标题和描述。')
  if (!categories.has(value.category)) throw new Error('请选择有效的商品分类。')
  if (!Number.isFinite(value.price) || value.price <= 0 || value.price > 1_000_000) throw new Error('请输入有效价格。')
  return value
}
async function initialState() {
  const products = JSON.parse(await readFile(seedFile, 'utf8'))
  return { products: products.map((p) => ({ ...p, sellerId: null })), users: [], refreshSessions: [], userFavorites: {}, userCarts: {}, orders: [], updatedAt: nowIso() }
}
function normalize(raw) {
  const state = raw && typeof raw === 'object' ? raw : {}
  return {
    products: (Array.isArray(state.products) ? state.products : []).map((p) => ({ ...p, sellerId: p.sellerId || (String(p.id).startsWith('user-') ? LEGACY_USER_ID : null) })),
    users: Array.isArray(state.users) ? state.users : [],
    refreshSessions: Array.isArray(state.refreshSessions) ? state.refreshSessions : [],
    userFavorites: state.userFavorites || { [LEGACY_USER_ID]: Array.isArray(state.favorites) ? state.favorites : [] },
    userCarts: state.userCarts || { [LEGACY_USER_ID]: state.cart && typeof state.cart === 'object' ? state.cart : {} },
    orders: (Array.isArray(state.orders) ? state.orders : []).map((o) => ({ ...o, userId: o.userId || LEGACY_USER_ID })),
    updatedAt: state.updatedAt || nowIso(),
  }
}
async function read() {
  await mkdir(uploadDir, { recursive: true })
  try { return normalize(JSON.parse(await readFile(storeFile, 'utf8'))) } catch { const state = await initialState(); await writeFile(storeFile, JSON.stringify(state, null, 2)); return state }
}
async function mutate(fn) {
  const operation = queue.then(async () => { const state = await read(); const result = await fn(state); state.updatedAt = nowIso(); await writeFile(storeFile, JSON.stringify(state, null, 2)); return { state, result } })
  queue = operation.then(() => undefined, () => undefined)
  return operation
}
function snapshot(state, userId) {
  return { products: state.products.map(({ sellerId, ...p }) => ({ ...p, isOwner: sellerId === userId })), favorites: [...(state.userFavorites[userId] || [])], cart: { ...(state.userCarts[userId] || {}) }, orders: state.orders.filter((o) => o.userId === userId).map(({ userId: _, ...o }) => o), updatedAt: state.updatedAt }
}
async function persistImage(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return clean(dataUrl, 2000) || '/products/lamp.jpg'
  const match = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/)
  if (!match || !imageTypes.has(match[1])) throw new Error('图片格式无法识别。')
  const bytes = Buffer.from(match[2], 'base64'); if (bytes.length > 2.5 * 1024 * 1024) throw new Error('图片请控制在 2.5 MB 以内。')
  const filename = `listing-${randomUUID()}.${imageTypes.get(match[1])}`; await mkdir(uploadDir, { recursive: true }); await writeFile(resolve(uploadDir, filename), bytes); return `/api/media/${filename}`
}

export async function findLocalUserByNormalized(value) { return (await read()).users.find((u) => u.usernameNormalized === value) || null }
export async function ensureLegacyLocalUser(username, usernameNormalized, passwordHash) {
  const { result } = await mutate((s) => { let u = s.users.find((item) => item.id === LEGACY_USER_ID); if (!u) { u = { id: LEGACY_USER_ID, username, usernameNormalized, passwordHash, createdAt: nowIso(), updatedAt: nowIso() }; s.users.push(u) } else if (passwordHash) Object.assign(u, { username, usernameNormalized, passwordHash, updatedAt: nowIso() }); return u }); return result
}
export async function createLocalUser(input) { const { result } = await mutate((s) => { if (s.users.some((u) => u.usernameNormalized === input.usernameNormalized)) return null; const now = nowIso(); const u = { id: randomUUID(), ...input, createdAt: now, updatedAt: now }; s.users.push(u); return u }); return result }
export async function createLocalRefreshSession(session) { await mutate((s) => s.refreshSessions.push(session)) }
export async function getLocalRefreshSession(id) { return (await read()).refreshSessions.find((s) => s.id === id) || null }
export async function rotateLocalRefreshSession(id, expectedHash, tokenHash) { const { result } = await mutate((s) => { const session = s.refreshSessions.find((item) => item.id === id); if (!session || session.tokenHash !== expectedHash || session.expiresAt <= Date.now()) return null; session.tokenHash = tokenHash; session.lastUsedAt = nowIso(); return session }); return result }
export async function deleteLocalRefreshSession(id) { await mutate((s) => { s.refreshSessions = s.refreshSessions.filter((item) => item.id !== id) }) }
export async function getLocalSessionUser(id) { const s = await read(); const session = s.refreshSessions.find((item) => item.id === id && item.expiresAt > Date.now()); if (!session) return null; const u = s.users.find((item) => item.id === session.userId); return u ? { id: u.id, username: u.username } : null }
export async function getLocalStore(userId) { return snapshot(await read(), userId) }
export async function bootstrapLocalStore(payload, user) {
  const { state } = await mutate(async (s) => {
    const known = new Set(s.products.map((p) => p.id))
    for (const raw of (Array.isArray(payload.userProducts) ? payload.userProducts : []).slice(0, 50)) try { const id = clean(raw.id, 100) || `legacy-${randomUUID()}`; if (known.has(id)) continue; s.products.unshift({ id, ...fields(raw), campus: clean(raw.campus, 100) || '待与买家协商', seller: user.username, sellerId: user.id, image: await persistImage(raw.image), postedAt: clean(raw.postedAt, 80) || '历史发布' }); known.add(id) } catch { /* skip invalid legacy product */ }
    s.userFavorites[user.id] = Array.from(new Set([...(s.userFavorites[user.id] || []), ...(Array.isArray(payload.favorites) ? payload.favorites : [])])).slice(0, 200)
    const cart = s.userCarts[user.id] || {}; for (const [id, q] of Object.entries(payload.cart || {}).slice(0, 200)) { const n = Math.max(0, Math.min(5, Math.round(Number(q) || 0))); if (n) cart[id] = Math.max(cart[id] || 0, n) } s.userCarts[user.id] = cart
    const ids = new Set(s.orders.filter((o) => o.userId === user.id).map((o) => o.id)); for (const order of (Array.isArray(payload.orders) ? payload.orders : []).slice(0, 50)) if (order?.id && !ids.has(order.id)) s.orders.push({ ...order, userId: user.id })
  }); return { state: snapshot(state, user.id) }
}
export async function createLocalProduct(payload, user) { const product = { id: `user-${Date.now()}-${randomUUID().slice(0, 8)}`, ...fields(payload), campus: '待与买家协商', seller: user.username, sellerId: user.id, image: await persistImage(payload.image), postedAt: '刚刚发布' }; const { state } = await mutate((s) => s.products.unshift(product)); const { sellerId: _, ...result } = product; return { product: { ...result, isOwner: true }, state: snapshot(state, user.id) } }
export async function deleteLocalProduct(id, userId) { const { state, result } = await mutate((s) => { const product = s.products.find((p) => p.id === id); if (!product) return 'missing'; if (product.sellerId !== userId) return 'forbidden'; s.products = s.products.filter((p) => p.id !== id); Object.keys(s.userFavorites).forEach((uid) => { s.userFavorites[uid] = s.userFavorites[uid].filter((value) => value !== id) }); Object.values(s.userCarts).forEach((cart) => delete cart[id]); return 'deleted' }); return { result, state: snapshot(state, userId) } }
export async function updateLocalFavorite(id, favorite, userId) { const { state } = await mutate((s) => { const list = s.userFavorites[userId] || []; s.userFavorites[userId] = favorite ? Array.from(new Set([id, ...list])) : list.filter((value) => value !== id) }); return snapshot(state, userId) }
export async function updateLocalCart(id, raw, userId) { const quantity = Math.max(0, Math.min(5, Math.round(Number(raw) || 0))); const { state } = await mutate((s) => { const cart = s.userCarts[userId] || {}; if (!quantity) delete cart[id]; else cart[id] = quantity; s.userCarts[userId] = cart }); return snapshot(state, userId) }
export async function createLocalOrder(payload, userId) {
  const pickup = clean(payload.pickup, 80); const contactTime = clean(payload.contactTime, 80); if (!pickup || !contactTime) throw new Error('请补全交接地点和联系时间。'); let created
  const { state } = await mutate((s) => { const items = Object.entries(s.userCarts[userId] || {}).map(([id, quantity]) => { const raw = s.products.find((p) => p.id === id); if (!raw) return null; const { sellerId, ...product } = raw; return { product: { ...product, isOwner: sellerId === userId }, quantity } }).filter(Boolean); if (!items.length) throw new Error('交易清单为空。'); created = { id: `ECHO-${Date.now().toString().slice(-8)}-${randomUUID().slice(0, 4).toUpperCase()}`, createdAt: new Date().toLocaleString('zh-CN', { hour12: false }), total: items.reduce((sum, item) => sum + item.product.price * item.quantity, 0), status: '待与卖家确认', pickup, contactTime, items, userId }; s.orders.unshift(created); s.userCarts[userId] = {} })
  const { userId: _, ...order } = created; return { order, state: snapshot(state, userId) }
}
export function resolveLocalMedia(filename) { const name = clean(filename, 180); return /^[a-zA-Z0-9._-]+$/.test(name) && extname(name) ? resolve(uploadDir, name) : null }
