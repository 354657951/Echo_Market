import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const LEGACY_USER_ID = 'legacy-campus'

const root = fileURLToPath(new URL('./', import.meta.url))
// 集成测试可指定独立目录，避免修改开发者现有的本地商品与账号。
const dataDir = process.env.LOCAL_DATA_DIR
  ? resolve(process.env.LOCAL_DATA_DIR)
  : resolve(root, '.local-data')
const uploadDir = resolve(dataDir, 'uploads')
const storeFile = resolve(dataDir, 'store.json')
const seedFile = new URL('./data/seed-products.json', import.meta.url)
const seedProductsPromise = readFile(seedFile, 'utf8').then(JSON.parse)
const categories = new Set(['数码', '学习', '生活', '运动', '影音'])
const imageTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
])

let mutationQueue = Promise.resolve()

const nowIso = () => new Date().toISOString()
const cleanText = (value, length) =>
  String(value || '').trim().slice(0, length)

function normalizeTags(value) {
  return (Array.isArray(value)
    ? value
    : String(value || '').split(/[·、,，]/))
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, 4)
}

function validateProductFields(payload) {
  const product = {
    title: cleanText(payload.title, 80),
    description: cleanText(payload.description, 1000),
    category: cleanText(payload.category, 10),
    condition: cleanText(payload.condition, 30) || '成色待确认',
    price: Math.round(Number(payload.price)),
    tags: normalizeTags(payload.tags),
    flaws: cleanText(payload.flaws, 500),
    accessories: cleanText(payload.accessories, 300),
    tradeNote: cleanText(payload.tradeNote, 500),
  }
  if (product.title.length < 2 || product.description.length < 4) {
    throw new Error('请补全商品标题和描述。')
  }
  if (!categories.has(product.category)) {
    throw new Error('请选择有效的商品分类。')
  }
  if (
    !Number.isFinite(product.price)
    || product.price <= 0
    || product.price > 1_000_000
  ) {
    throw new Error('请输入有效价格。')
  }
  return product
}

async function createInitialState() {
  const products = await seedProductsPromise
  return {
    products: products.map((product) => ({ ...product, sellerId: null })),
    users: [],
    refreshSessions: [],
    userFavorites: {},
    userCarts: {},
    orders: [],
    updatedAt: nowIso(),
  }
}

// 将单用户版本的数据结构升级为按用户隔离的结构，旧发布归原管理员所有。
async function normalizeState(rawState) {
  const state = rawState && typeof rawState === 'object' ? rawState : {}
  const seedProducts = await seedProductsPromise
  const seedProductById = new Map(
    seedProducts.map((product) => [product.id, product]),
  )
  const hasUserFavorites =
    state.userFavorites
    && typeof state.userFavorites === 'object'
    && !Array.isArray(state.userFavorites)
  const hasUserCarts =
    state.userCarts
    && typeof state.userCarts === 'object'
    && !Array.isArray(state.userCarts)

  return {
    products: (Array.isArray(state.products) ? state.products : []).map(
      (product) => {
        // 旧版种子数据补齐结构化详情；用户发布的内容保持原样。
        const seedProduct = seedProductById.get(product.id)
        return {
          ...product,
          flaws: cleanText(product.flaws, 500) || seedProduct?.flaws || '',
          accessories:
            cleanText(product.accessories, 300)
            || seedProduct?.accessories
            || '',
          tradeNote:
            cleanText(product.tradeNote, 500)
            || seedProduct?.tradeNote
            || '',
          sellerId:
            product.sellerId
            || (String(product.id).startsWith('user-')
              ? LEGACY_USER_ID
              : null),
        }
      },
    ),
    users: Array.isArray(state.users) ? state.users : [],
    refreshSessions: (Array.isArray(state.refreshSessions)
      ? state.refreshSessions
      : []).filter((session) => Number(session.expiresAt) > Date.now()),
    userFavorites: hasUserFavorites
      ? state.userFavorites
      : {
          [LEGACY_USER_ID]: Array.isArray(state.favorites)
            ? state.favorites
            : [],
        },
    userCarts: hasUserCarts
      ? state.userCarts
      : {
          [LEGACY_USER_ID]:
            state.cart && typeof state.cart === 'object' ? state.cart : {},
        },
    orders: (Array.isArray(state.orders) ? state.orders : []).map(
      (order) => ({ ...order, userId: order.userId || LEGACY_USER_ID }),
    ),
    updatedAt: state.updatedAt || nowIso(),
  }
}

async function readState() {
  await mkdir(uploadDir, { recursive: true })
  try {
    return normalizeState(
      JSON.parse(await readFile(storeFile, 'utf8')),
    )
  } catch {
    const state = await createInitialState()
    await writeFile(storeFile, JSON.stringify(state, null, 2))
    return state
  }
}

/**
 * 串行执行本地文件写入，防止两个请求互相覆盖。
 * 认证会话变化不更新业务同步时间，只有商品和交易操作才更新。
 */
async function mutateState(operation, { touchStore = true } = {}) {
  const queued = mutationQueue.then(async () => {
    const state = await readState()
    const result = await operation(state)
    if (touchStore) state.updatedAt = nowIso()
    await writeFile(storeFile, JSON.stringify(state, null, 2))
    return { state, result }
  })
  mutationQueue = queued.then(
    () => undefined,
    () => undefined,
  )
  return queued
}

function createSnapshot(state, userId) {
  return {
    products: state.products.map(({ sellerId, ...product }) => ({
      ...product,
      isOwner: sellerId === userId,
    })),
    favorites: [...(state.userFavorites[userId] || [])],
    cart: { ...(state.userCarts[userId] || {}) },
    orders: state.orders
      .filter((order) => order.userId === userId)
      .map(({ userId: _userId, ...order }) => order),
    updatedAt: state.updatedAt,
  }
}

async function persistImage(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    return cleanText(dataUrl, 2000) || '/products/lamp.jpg'
  }

  const match = dataUrl.match(
    /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/,
  )
  if (!match || !imageTypes.has(match[1])) {
    throw new Error('图片格式无法识别。')
  }

  const bytes = Buffer.from(match[2], 'base64')
  if (bytes.length > 2.5 * 1024 * 1024) {
    throw new Error('图片请控制在 2.5 MB 以内。')
  }
  const filename = `listing-${randomUUID()}.${imageTypes.get(match[1])}`
  await mkdir(uploadDir, { recursive: true })
  await writeFile(resolve(uploadDir, filename), bytes)
  return `/api/media/${filename}`
}

export async function findLocalUserByNormalized(normalizedUsername) {
  const state = await readState()
  return state.users.find(
    (user) => user.usernameNormalized === normalizedUsername,
  ) || null
}

export async function ensureLegacyLocalUser(
  username,
  usernameNormalized,
  passwordHash,
) {
  const { result } = await mutateState(
    (state) => {
      let user = state.users.find((item) => item.id === LEGACY_USER_ID)
      if (!user) {
        user = {
          id: LEGACY_USER_ID,
          username,
          usernameNormalized,
          passwordHash,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        }
        state.users.push(user)
      } else if (passwordHash) {
        Object.assign(user, {
          username,
          usernameNormalized,
          passwordHash,
          updatedAt: nowIso(),
        })
      }
      return user
    },
    { touchStore: false },
  )
  return result
}

export async function createLocalUser(input) {
  const { result } = await mutateState(
    (state) => {
      if (
        state.users.some(
          (user) => user.usernameNormalized === input.usernameNormalized,
        )
      ) {
        return null
      }
      const stamp = nowIso()
      const user = {
        id: randomUUID(),
        ...input,
        createdAt: stamp,
        updatedAt: stamp,
      }
      state.users.push(user)
      return user
    },
    { touchStore: false },
  )
  return result
}

export async function createLocalRefreshSession(session) {
  await mutateState(
    (state) => {
      state.refreshSessions = state.refreshSessions.filter(
        (item) => item.id !== session.id,
      )
      state.refreshSessions.push(session)
    },
    { touchStore: false },
  )
}

export async function getLocalRefreshSession(id) {
  const state = await readState()
  return state.refreshSessions.find((session) => session.id === id) || null
}

export async function rotateLocalRefreshSession(
  id,
  expectedHash,
  nextTokenHash,
) {
  const { result } = await mutateState(
    (state) => {
      const session = state.refreshSessions.find((item) => item.id === id)
      if (
        !session
        || session.tokenHash !== expectedHash
        || session.expiresAt <= Date.now()
      ) {
        return null
      }
      session.tokenHash = nextTokenHash
      session.lastUsedAt = nowIso()
      return session
    },
    { touchStore: false },
  )
  return result
}

export async function deleteLocalRefreshSession(id) {
  await mutateState(
    (state) => {
      state.refreshSessions = state.refreshSessions.filter(
        (session) => session.id !== id,
      )
    },
    { touchStore: false },
  )
}

export async function getLocalSessionUser(sessionId) {
  const state = await readState()
  const session = state.refreshSessions.find(
    (item) => item.id === sessionId && item.expiresAt > Date.now(),
  )
  if (!session) return null
  const user = state.users.find((item) => item.id === session.userId)
  return user ? { id: user.id, username: user.username } : null
}

export async function getLocalStore(userId) {
  return createSnapshot(await readState(), userId)
}

export async function bootstrapLocalStore(payload, user) {
  const { state } = await mutateState(async (store) => {
    const knownProductIds = new Set(
      store.products.map((product) => product.id),
    )
    for (const rawProduct of (
      Array.isArray(payload.userProducts) ? payload.userProducts : []
    ).slice(0, 50)) {
      try {
        const id =
          cleanText(rawProduct.id, 100)
          || `legacy-${randomUUID()}`
        if (knownProductIds.has(id)) continue
        store.products.unshift({
          id,
          ...validateProductFields(rawProduct),
          campus:
            cleanText(rawProduct.campus, 100) || '待与买家协商',
          seller: user.username,
          sellerId: user.id,
          image: await persistImage(rawProduct.image),
          postedAt:
            cleanText(rawProduct.postedAt, 80) || '历史发布',
        })
        knownProductIds.add(id)
      } catch {
        // 单件旧商品异常时跳过，不阻断其余数据迁移。
      }
    }

    const validIds = new Set(store.products.map((product) => product.id))
    const importedFavorites = Array.isArray(payload.favorites)
      ? payload.favorites.filter((id) => validIds.has(id))
      : []
    store.userFavorites[user.id] = Array.from(
      new Set([
        ...(store.userFavorites[user.id] || []),
        ...importedFavorites,
      ]),
    ).slice(0, 200)

    const cart = store.userCarts[user.id] || {}
    for (const [id, rawQuantity] of Object.entries(payload.cart || {}).slice(
      0,
      200,
    )) {
      const quantity = Math.max(
        0,
        Math.min(5, Math.round(Number(rawQuantity) || 0)),
      )
      if (quantity && validIds.has(id)) {
        cart[id] = Math.max(cart[id] || 0, quantity)
      }
    }
    store.userCarts[user.id] = cart

    const knownOrderIds = new Set(
      store.orders
        .filter((order) => order.userId === user.id)
        .map((order) => order.id),
    )
    for (const order of (
      Array.isArray(payload.orders) ? payload.orders : []
    ).slice(0, 50)) {
      if (order?.id && !knownOrderIds.has(order.id)) {
        store.orders.push({ ...order, userId: user.id })
        knownOrderIds.add(order.id)
      }
    }
  })
  return { state: createSnapshot(state, user.id) }
}

export async function createLocalProduct(payload, user) {
  const product = {
    id: `user-${Date.now()}-${randomUUID().slice(0, 8)}`,
    ...validateProductFields(payload),
    campus: '待与买家协商',
    seller: user.username,
    sellerId: user.id,
    image: await persistImage(payload.image),
    postedAt: '刚刚发布',
  }
  const { state } = await mutateState((store) => {
    store.products.unshift(product)
  })
  const { sellerId: _sellerId, ...publicProduct } = product
  return {
    product: { ...publicProduct, isOwner: true },
    state: createSnapshot(state, user.id),
  }
}

export async function deleteLocalProduct(id, userId) {
  let imagePath = ''
  const { state, result } = await mutateState((store) => {
    const product = store.products.find((item) => item.id === id)
    if (!product) return 'missing'
    if (product.sellerId !== userId) return 'forbidden'

    imagePath = product.image
    store.products = store.products.filter((item) => item.id !== id)
    Object.keys(store.userFavorites).forEach((uid) => {
      store.userFavorites[uid] = store.userFavorites[uid].filter(
        (productId) => productId !== id,
      )
    })
    Object.values(store.userCarts).forEach((cart) => {
      delete cart[id]
    })
    return 'deleted'
  })

  if (result === 'deleted' && imagePath.startsWith('/api/media/')) {
    const filename = decodeURIComponent(
      imagePath.slice('/api/media/'.length),
    )
    // 只删除本项目生成的扁平文件名，避免旧数据中的异常路径越过上传目录。
    const mediaFile = resolveLocalMedia(filename)
    if (mediaFile) await unlink(mediaFile).catch(() => undefined)
  }
  return { result, state: createSnapshot(state, userId) }
}

export async function updateLocalFavorite(id, favorite, userId) {
  const { state } = await mutateState((store) => {
    const productExists = store.products.some((product) => product.id === id)
    if (!productExists) throw new Error('商品不存在或已被删除。')
    const favorites = store.userFavorites[userId] || []
    store.userFavorites[userId] = favorite
      ? Array.from(new Set([id, ...favorites]))
      : favorites.filter((productId) => productId !== id)
  })
  return createSnapshot(state, userId)
}

export async function updateLocalCart(id, rawQuantity, userId) {
  const quantity = Math.max(
    0,
    Math.min(5, Math.round(Number(rawQuantity) || 0)),
  )
  const { state } = await mutateState((store) => {
    const productExists = store.products.some((product) => product.id === id)
    if (quantity && !productExists) {
      throw new Error('商品不存在或已被删除。')
    }
    const cart = store.userCarts[userId] || {}
    if (!quantity) delete cart[id]
    else cart[id] = quantity
    store.userCarts[userId] = cart
  })
  return createSnapshot(state, userId)
}

export async function createLocalOrder(payload, userId) {
  const pickup = cleanText(payload.pickup, 80)
  const contactTime = cleanText(payload.contactTime, 80)
  if (!pickup || !contactTime) {
    throw new Error('请补全交接地点和联系时间。')
  }

  let createdOrder
  const { state } = await mutateState((store) => {
    const items = Object.entries(store.userCarts[userId] || {})
      .map(([id, quantity]) => {
        const rawProduct = store.products.find((product) => product.id === id)
        if (!rawProduct) return null
        const { sellerId, ...product } = rawProduct
        return {
          product: { ...product, isOwner: sellerId === userId },
          quantity,
        }
      })
      .filter(Boolean)
    if (!items.length) throw new Error('交易清单为空。')

    createdOrder = {
      id: `ECHO-${Date.now().toString().slice(-8)}-${randomUUID()
        .slice(0, 4)
        .toUpperCase()}`,
      createdAt: new Date().toLocaleString('zh-CN', { hour12: false }),
      total: items.reduce(
        (total, item) => total + item.product.price * item.quantity,
        0,
      ),
      status: '待与卖家确认',
      pickup,
      contactTime,
      items,
      userId,
    }
    store.orders.unshift(createdOrder)
    store.userCarts[userId] = {}
  })

  const { userId: _userId, ...order } = createdOrder
  return { order, state: createSnapshot(state, userId) }
}

export function resolveLocalMedia(filename) {
  const cleanFilename = cleanText(filename, 180)
  return /^[a-zA-Z0-9._-]+$/.test(cleanFilename) && extname(cleanFilename)
    ? resolve(uploadDir, cleanFilename)
    : null
}
