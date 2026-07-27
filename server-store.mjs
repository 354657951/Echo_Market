import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('./', import.meta.url))
const dataDirectory = resolve(projectRoot, '.local-data')
const uploadDirectory = resolve(dataDirectory, 'uploads')
const storeFile = resolve(dataDirectory, 'store.json')
const seedFile = new URL('./data/seed-products.json', import.meta.url)
const allowedCategories = new Set(['数码', '学习', '生活', '运动', '影音'])
const allowedImageTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
])
const maxImageBytes = 2.5 * 1024 * 1024
let mutationQueue = Promise.resolve()

function nowIso() {
  return new Date().toISOString()
}

function cleanText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength)
}

function parseTags(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 4)
  }
  return String(value || '')
    .split(/[·、,，]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4)
}

function validateProductInput(payload) {
  const title = cleanText(payload.title, 80)
  const description = cleanText(payload.description, 1000)
  const category = cleanText(payload.category, 10)
  const condition = cleanText(payload.condition, 30)
  const price = Number(payload.price)

  if (title.length < 2 || description.length < 4) {
    throw new Error('请补全商品标题和描述。')
  }
  if (!allowedCategories.has(category)) throw new Error('请选择有效的商品分类。')
  if (!Number.isFinite(price) || price <= 0 || price > 1000000) {
    throw new Error('请输入有效价格。')
  }

  return {
    title,
    description,
    category,
    condition: condition || '成色待确认',
    price: Math.round(price),
    tags: parseTags(payload.tags),
  }
}

async function initialState() {
  const seedProducts = JSON.parse(await readFile(seedFile, 'utf8'))
  return {
    products: seedProducts,
    favorites: [],
    cart: {},
    orders: [],
    updatedAt: nowIso(),
  }
}

async function ensureDirectories() {
  await mkdir(uploadDirectory, { recursive: true })
}

async function readStore() {
  await ensureDirectories()
  try {
    return JSON.parse(await readFile(storeFile, 'utf8'))
  } catch {
    const state = await initialState()
    await writeFile(storeFile, JSON.stringify(state, null, 2), 'utf8')
    return state
  }
}

async function mutateStore(mutator) {
  const operation = mutationQueue.then(async () => {
    const state = await readStore()
    const result = await mutator(state)
    state.updatedAt = nowIso()
    await writeFile(storeFile, JSON.stringify(state, null, 2), 'utf8')
    return { state, result }
  })
  mutationQueue = operation.then(() => undefined, () => undefined)
  return operation
}

function decodeDataImage(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null
  const matched = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/)
  if (!matched) throw new Error('图片格式无法识别。')
  const extension = allowedImageTypes.get(matched[1])
  if (!extension) throw new Error('仅支持 JPG、PNG、WebP 或 GIF 图片。')
  const bytes = Buffer.from(matched[2], 'base64')
  if (bytes.length > maxImageBytes) throw new Error('图片请控制在 2.5 MB 以内。')
  return { bytes, extension }
}

async function persistImage(dataUrl) {
  const image = decodeDataImage(dataUrl)
  if (!image) return cleanText(dataUrl, 2000) || '/products/lamp.jpg'
  const filename = `listing-${randomUUID()}.${image.extension}`
  await ensureDirectories()
  await writeFile(resolve(uploadDirectory, filename), image.bytes)
  return `/api/media/${filename}`
}

export async function getLocalStore() {
  return readStore()
}

export async function bootstrapLocalStore(payload) {
  return mutateStore(async (state) => {
    const knownProducts = new Set(state.products.map((product) => product.id))
    for (const rawProduct of (Array.isArray(payload.userProducts) ? payload.userProducts : []).slice(0, 50)) {
      try {
        const fields = validateProductInput(rawProduct)
        const id = cleanText(rawProduct.id, 100) || `legacy-${randomUUID()}`
        if (knownProducts.has(id)) continue
        state.products.unshift({
          id,
          ...fields,
          campus: cleanText(rawProduct.campus, 100) || '待与买家协商',
          seller: cleanText(rawProduct.seller, 80) || 'campus',
          image: await persistImage(rawProduct.image),
          postedAt: cleanText(rawProduct.postedAt, 80) || '历史发布',
        })
        knownProducts.add(id)
      } catch {
        // 跳过格式异常的旧记录，继续迁移其余数据。
      }
    }
    state.favorites = Array.from(new Set([
      ...state.favorites,
      ...(Array.isArray(payload.favorites) ? payload.favorites : []),
    ])).slice(0, 200)
    for (const [productId, rawQuantity] of Object.entries(payload.cart || {}).slice(0, 200)) {
      const quantity = Math.max(0, Math.min(5, Math.round(Number(rawQuantity) || 0)))
      if (quantity > 0) state.cart[productId] = Math.max(state.cart[productId] || 0, quantity)
    }
    const knownOrders = new Set(state.orders.map((order) => order.id))
    for (const order of (Array.isArray(payload.orders) ? payload.orders : []).slice(0, 50)) {
      if (order?.id && !knownOrders.has(order.id)) state.orders.push(order)
    }
  })
}

export async function createLocalProduct(payload, currentUser) {
  const fields = validateProductInput(payload)
  const product = {
    id: `user-${Date.now()}-${randomUUID().slice(0, 8)}`,
    ...fields,
    campus: '待与买家协商',
    seller: currentUser,
    image: await persistImage(payload.image),
    postedAt: '刚刚发布',
  }
  const { state } = await mutateStore((current) => {
    current.products.unshift(product)
  })
  return { product, state }
}

export async function updateLocalFavorite(productId, favorite) {
  const { state } = await mutateStore((current) => {
    current.favorites = favorite
      ? Array.from(new Set([productId, ...current.favorites]))
      : current.favorites.filter((id) => id !== productId)
  })
  return state
}

export async function updateLocalCart(productId, rawQuantity) {
  const quantity = Math.max(0, Math.min(5, Math.round(Number(rawQuantity) || 0)))
  const { state } = await mutateStore((current) => {
    if (quantity === 0) delete current.cart[productId]
    else current.cart[productId] = quantity
  })
  return state
}

export async function createLocalOrder(payload) {
  const pickup = cleanText(payload.pickup, 80)
  const contactTime = cleanText(payload.contactTime, 80)
  if (!pickup || !contactTime) throw new Error('请补全交接地点和联系时间。')

  let createdOrder
  const { state } = await mutateStore((current) => {
    const items = Object.entries(current.cart)
      .map(([id, quantity]) => {
        const product = current.products.find((item) => item.id === id)
        return product ? { product, quantity } : null
      })
      .filter(Boolean)
    if (items.length === 0) throw new Error('交易清单为空。')
    const total = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0)
    createdOrder = {
      id: `ECHO-${Date.now().toString().slice(-8)}-${randomUUID().slice(0, 4).toUpperCase()}`,
      createdAt: new Date().toLocaleString('zh-CN', { hour12: false }),
      total,
      status: '待与卖家确认',
      pickup,
      contactTime,
      items,
    }
    current.orders.unshift(createdOrder)
    current.cart = {}
  })
  return { order: createdOrder, state }
}

export function resolveLocalMedia(filename) {
  const safeName = cleanText(filename, 180)
  if (!/^[a-zA-Z0-9._-]+$/.test(safeName) || !extname(safeName)) return null
  return resolve(uploadDirectory, safeName)
}
