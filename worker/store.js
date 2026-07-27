import seedProducts from '../data/seed-products.json'

const allowedCategories = new Set(['数码', '学习', '生活', '运动', '影音'])
const allowedImageTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
])
const maxImageBytes = 2.5 * 1024 * 1024

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    price INTEGER NOT NULL,
    condition TEXT NOT NULL,
    campus TEXT NOT NULL,
    seller TEXT NOT NULL,
    image TEXT NOT NULL,
    tags_json TEXT NOT NULL,
    posted_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'shared'
  )`,
  `CREATE TABLE IF NOT EXISTS favorites (
    product_id TEXT PRIMARY KEY NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS cart_items (
    product_id TEXT PRIMARY KEY NOT NULL,
    quantity INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS store_meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
]

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  })
}

function requireStoreBindings(env) {
  if (!env.DB) throw new Error('共享数据库尚未绑定。')
  return env.DB
}

function nowIso() {
  return new Date().toISOString()
}

function sharedUpdateStatement(db, now = nowIso()) {
  return db
    .prepare(
      `INSERT INTO store_meta (key, value, updated_at)
       VALUES ('shared_updated_at', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(now, now)
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

function mapProduct(row) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    description: row.description,
    price: Number(row.price),
    condition: row.condition,
    campus: row.campus,
    seller: row.seller,
    image: row.image,
    tags: parseTags(JSON.parse(row.tags_json || '[]')),
    postedAt: row.posted_at,
  }
}

function productInsert(db, product, source = 'shared') {
  return db
    .prepare(
      `INSERT OR IGNORE INTO products
       (id, title, category, description, price, condition, campus, seller, image, tags_json, posted_at, created_at, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      product.id,
      product.title,
      product.category,
      product.description,
      Math.round(Number(product.price)),
      product.condition,
      product.campus,
      product.seller,
      product.image,
      JSON.stringify(parseTags(product.tags)),
      product.postedAt,
      product.createdAt || nowIso(),
      source,
    )
}

async function ensureStore(env) {
  const db = requireStoreBindings(env)
  await db.batch(schemaStatements.map((statement) => db.prepare(statement)))

  const seeded = await db
    .prepare("SELECT value FROM store_meta WHERE key = 'seed_version'")
    .first()
  if (seeded?.value === '1') return db

  const seededAt = nowIso()
  const inserts = seedProducts.map((product) =>
    productInsert(db, { ...product, createdAt: seededAt }, 'seed'),
  )
  inserts.push(
    db
      .prepare(
        `INSERT INTO store_meta (key, value, updated_at)
         VALUES ('seed_version', '1', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .bind(seededAt),
    sharedUpdateStatement(db, seededAt),
  )
  await db.batch(inserts)
  return db
}

async function snapshot(env) {
  const db = await ensureStore(env)
  const [productRows, favoriteRows, cartRows, orderRows, updatedRow] = await Promise.all([
    db.prepare(
      "SELECT * FROM products ORDER BY CASE source WHEN 'shared' THEN 0 WHEN 'legacy' THEN 1 ELSE 2 END DESC, created_at DESC",
    ).all(),
    db.prepare('SELECT product_id FROM favorites ORDER BY updated_at DESC').all(),
    db.prepare('SELECT product_id, quantity FROM cart_items ORDER BY updated_at DESC').all(),
    db.prepare('SELECT payload_json FROM orders ORDER BY created_at DESC').all(),
    db.prepare("SELECT value FROM store_meta WHERE key = 'shared_updated_at'").first(),
  ])

  return {
    products: productRows.results.map(mapProduct),
    favorites: favoriteRows.results.map((row) => row.product_id),
    cart: Object.fromEntries(
      cartRows.results.map((row) => [row.product_id, Number(row.quantity)]),
    ),
    orders: orderRows.results
      .map((row) => {
        try {
          return JSON.parse(row.payload_json)
        } catch {
          return null
        }
      })
      .filter(Boolean),
    updatedAt: updatedRow?.value || nowIso(),
  }
}

function cleanText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength)
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
  if (!allowedCategories.has(category)) {
    throw new Error('请选择有效的商品分类。')
  }
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

function decodeDataImage(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null
  const matched = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/)
  if (!matched) throw new Error('图片格式无法识别。')
  const extension = allowedImageTypes.get(matched[1])
  if (!extension) throw new Error('仅支持 JPG、PNG、WebP 或 GIF 图片。')
  const binary = atob(matched[2])
  if (binary.length > maxImageBytes) throw new Error('图片请控制在 2.5 MB 以内。')
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return { bytes, contentType: matched[1], extension }
}

async function persistImage(env, dataUrl) {
  const image = decodeDataImage(dataUrl)
  if (!image) return cleanText(dataUrl, 2000) || '/products/lamp.jpg'
  if (!env.MEDIA) throw new Error('图片存储尚未绑定，请稍后重试。')

  const key = `listing-${crypto.randomUUID()}.${image.extension}`
  await env.MEDIA.put(key, image.bytes, {
    httpMetadata: { contentType: image.contentType, cacheControl: 'public, max-age=31536000, immutable' },
  })
  return `/api/media/${encodeURIComponent(key)}`
}

async function createProduct(request, env, currentUser) {
  const payload = await request.json()
  const fields = validateProductInput(payload)
  const db = await ensureStore(env)
  const createdAt = nowIso()
  const product = {
    id: `user-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    ...fields,
    campus: '待与买家协商',
    seller: currentUser,
    image: await persistImage(env, payload.image),
    postedAt: '刚刚发布',
    createdAt,
  }
  await db.batch([
    productInsert(db, product, 'shared'),
    sharedUpdateStatement(db, createdAt),
  ])
  return json({ product, store: await snapshot(env) }, 201)
}

async function updateFavorite(request, env, productId) {
  const payload = await request.json()
  const favorite = Boolean(payload.favorite)
  const db = await ensureStore(env)
  const updatedAt = nowIso()
  if (favorite) {
    await db.batch([
      db.prepare('INSERT OR REPLACE INTO favorites (product_id, updated_at) VALUES (?, ?)')
        .bind(productId, updatedAt),
      sharedUpdateStatement(db, updatedAt),
    ])
  } else {
    await db.batch([
      db.prepare('DELETE FROM favorites WHERE product_id = ?').bind(productId),
      sharedUpdateStatement(db, updatedAt),
    ])
  }
  return json({ store: await snapshot(env) })
}

async function updateCart(request, env, productId) {
  const payload = await request.json()
  const quantity = Math.max(0, Math.min(5, Math.round(Number(payload.quantity) || 0)))
  const db = await ensureStore(env)
  const updatedAt = nowIso()
  if (quantity === 0) {
    await db.batch([
      db.prepare('DELETE FROM cart_items WHERE product_id = ?').bind(productId),
      sharedUpdateStatement(db, updatedAt),
    ])
  } else {
    await db.batch([
      db.prepare(
        `INSERT INTO cart_items (product_id, quantity, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(product_id) DO UPDATE SET quantity = excluded.quantity, updated_at = excluded.updated_at`,
      ).bind(productId, quantity, updatedAt),
      sharedUpdateStatement(db, updatedAt),
    ])
  }
  return json({ store: await snapshot(env) })
}

async function createOrder(request, env) {
  const payload = await request.json()
  const pickup = cleanText(payload.pickup, 80)
  const contactTime = cleanText(payload.contactTime, 80)
  if (!pickup || !contactTime) return json({ message: '请补全交接地点和联系时间。' }, 400)

  const db = await ensureStore(env)
  const rows = await db.prepare(
    `SELECT p.*, c.quantity
     FROM cart_items c
     INNER JOIN products p ON p.id = c.product_id
     ORDER BY c.updated_at DESC`,
  ).all()
  if (rows.results.length === 0) return json({ message: '交易清单为空。' }, 400)

  const items = rows.results.map((row) => ({
    product: mapProduct(row),
    quantity: Number(row.quantity),
  }))
  const total = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0)
  const createdAtIso = nowIso()
  const order = {
    id: `ECHO-${Date.now().toString().slice(-8)}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
    createdAt: new Date().toLocaleString('zh-CN', {
      hour12: false,
      timeZone: 'Asia/Shanghai',
    }),
    total,
    status: '待与卖家确认',
    pickup,
    contactTime,
    items,
  }
  await db.batch([
    db.prepare('INSERT INTO orders (id, payload_json, created_at) VALUES (?, ?, ?)')
      .bind(order.id, JSON.stringify(order), createdAtIso),
    db.prepare('DELETE FROM cart_items'),
    sharedUpdateStatement(db, createdAtIso),
  ])
  return json({ order, store: await snapshot(env) }, 201)
}

async function importLegacyProduct(env, db, rawProduct) {
  const fields = validateProductInput(rawProduct)
  const product = {
    id: cleanText(rawProduct.id, 100) || `legacy-${crypto.randomUUID()}`,
    ...fields,
    campus: cleanText(rawProduct.campus, 100) || '待与买家协商',
    seller: cleanText(rawProduct.seller, 80) || 'campus',
    image: await persistImage(env, rawProduct.image),
    postedAt: cleanText(rawProduct.postedAt, 80) || '历史发布',
    createdAt: nowIso(),
  }
  return productInsert(db, product, 'legacy')
}

async function bootstrapLegacy(request, env) {
  const payload = await request.json()
  const db = await ensureStore(env)
  const statements = []
  const updatedAt = nowIso()

  for (const product of (Array.isArray(payload.userProducts) ? payload.userProducts : []).slice(0, 50)) {
    try {
      statements.push(await importLegacyProduct(env, db, product))
    } catch {
      // 单条旧数据异常时跳过，不阻断其余有效记录迁移。
    }
  }
  for (const productId of (Array.isArray(payload.favorites) ? payload.favorites : []).slice(0, 200)) {
    statements.push(
      db.prepare('INSERT OR IGNORE INTO favorites (product_id, updated_at) VALUES (?, ?)')
        .bind(cleanText(productId, 100), updatedAt),
    )
  }
  for (const [productId, rawQuantity] of Object.entries(payload.cart || {}).slice(0, 200)) {
    const quantity = Math.max(0, Math.min(5, Math.round(Number(rawQuantity) || 0)))
    if (quantity > 0) {
      statements.push(
        db.prepare(
          `INSERT INTO cart_items (product_id, quantity, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(product_id) DO UPDATE SET
             quantity = MAX(cart_items.quantity, excluded.quantity),
             updated_at = excluded.updated_at`,
        ).bind(cleanText(productId, 100), quantity, updatedAt),
      )
    }
  }
  for (const order of (Array.isArray(payload.orders) ? payload.orders : []).slice(0, 50)) {
    const orderId = cleanText(order?.id, 100)
    if (orderId) {
      statements.push(
        db.prepare('INSERT OR IGNORE INTO orders (id, payload_json, created_at) VALUES (?, ?, ?)')
          .bind(orderId, JSON.stringify(order), updatedAt),
      )
    }
  }
  statements.push(sharedUpdateStatement(db, updatedAt))
  await db.batch(statements)
  return json({ store: await snapshot(env), imported: true })
}

export async function handleStoreApi(request, env, currentUser, url) {
  try {
    if (url.pathname === '/api/store' && request.method === 'GET') {
      return json({ store: await snapshot(env) })
    }
    if (url.pathname === '/api/store/bootstrap' && request.method === 'POST') {
      return bootstrapLegacy(request, env)
    }
    if (url.pathname === '/api/products' && request.method === 'POST') {
      return createProduct(request, env, currentUser)
    }
    if (url.pathname.startsWith('/api/favorites/') && request.method === 'PUT') {
      return updateFavorite(
        request,
        env,
        decodeURIComponent(url.pathname.slice('/api/favorites/'.length)),
      )
    }
    if (url.pathname.startsWith('/api/cart/') && request.method === 'PUT') {
      return updateCart(
        request,
        env,
        decodeURIComponent(url.pathname.slice('/api/cart/'.length)),
      )
    }
    if (url.pathname === '/api/orders' && request.method === 'POST') {
      return createOrder(request, env)
    }
    return null
  } catch (error) {
    return json(
      { message: error instanceof Error ? error.message : '共享数据暂时无法处理。' },
      500,
    )
  }
}

export async function serveMedia(request, env, url) {
  if (!env.MEDIA) return json({ message: '图片存储尚未绑定。' }, 503)
  const key = decodeURIComponent(url.pathname.slice('/api/media/'.length))
  if (!/^[a-zA-Z0-9._-]+$/.test(key)) return json({ message: '图片地址无效。' }, 400)
  const object = await env.MEDIA.get(key)
  if (!object) return json({ message: '图片不存在。' }, 404)
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('ETag', object.httpEtag)
  headers.set('Cache-Control', 'private, max-age=3600')
  return new Response(object.body, { headers })
}
