import seedProducts from '../data/seed-products.json'

const legacyUserId = 'legacy-campus'
const categories = new Set(['数码', '学习', '生活', '运动', '影音'])
const imageTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
])
const schema = [
  `CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    price INTEGER NOT NULL,
    condition TEXT NOT NULL,
    campus TEXT NOT NULL,
    seller TEXT NOT NULL,
    seller_id TEXT,
    image TEXT NOT NULL,
    tags_json TEXT NOT NULL,
    posted_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'shared'
  )`,
  `CREATE TABLE IF NOT EXISTS user_favorites (
    user_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(user_id, product_id)
  )`,
  `CREATE TABLE IF NOT EXISTS user_cart_items (
    user_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(user_id, product_id)
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS store_meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
]

const now = () => new Date().toISOString()
const cleanText = (value, length) =>
  String(value || '').trim().slice(0, length)

function parseTags(value) {
  return (Array.isArray(value)
    ? value
    : String(value || '').split(/[·、,，]/))
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, 4)
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  })
}

function isManagedMediaKey(key) {
  return /^listing-[0-9a-f-]{36}\.(jpg|png|webp|gif)$/i.test(key)
}

function validateProduct(payload) {
  const product = {
    title: cleanText(payload.title, 80),
    description: cleanText(payload.description, 1000),
    category: cleanText(payload.category, 10),
    condition: cleanText(payload.condition, 30) || '成色待确认',
    price: Math.round(Number(payload.price)),
    tags: parseTags(payload.tags),
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

function mapProduct(row, userId) {
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
    isOwner: row.seller_id === userId,
  }
}

function insertProductStatement(db, product, source) {
  return db.prepare(
    `INSERT OR IGNORE INTO products (
      id,title,category,description,price,condition,campus,seller,seller_id,
      image,tags_json,posted_at,created_at,source
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    product.id,
    product.title,
    product.category,
    product.description,
    product.price,
    product.condition,
    product.campus,
    product.seller,
    product.sellerId || null,
    product.image,
    JSON.stringify(product.tags),
    product.postedAt,
    product.createdAt || now(),
    source,
  )
}

function touchStatement(db, timestamp = now()) {
  return db.prepare(
    `INSERT INTO store_meta(key,value,updated_at)
     VALUES('shared_updated_at',?,?)
     ON CONFLICT(key) DO UPDATE SET
       value=excluded.value,
       updated_at=excluded.updated_at`,
  ).bind(timestamp, timestamp)
}

async function ensureColumn(db, table, column, definition) {
  const columns = await db.prepare(`PRAGMA table_info(${table})`).all()
  if (columns.results.some((item) => item.name === column)) return
  try {
    await db.prepare(`ALTER TABLE ${table} ADD ${column} ${definition}`).run()
  } catch (error) {
    // 多个 Worker 同时首次访问时，另一请求可能已经完成相同升级。
    if (!String(error).toLowerCase().includes('duplicate column')) throw error
  }
}

async function migrateSingleUserData(db) {
  const migrated = await db
    .prepare("SELECT value FROM store_meta WHERE key='multi_user_migration_v1'")
    .first()
  if (migrated) return

  const tableRows = await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
  const tableNames = new Set(tableRows.results.map((row) => row.name))
  const timestamp = now()
  const statements = [
    db.prepare(
      `UPDATE products
       SET seller_id=?
       WHERE seller_id IS NULL AND source IN ('shared','legacy')`,
    ).bind(legacyUserId),
    db.prepare(
      'UPDATE orders SET user_id=? WHERE user_id IS NULL',
    ).bind(legacyUserId),
  ]

  if (tableNames.has('favorites')) {
    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO user_favorites(user_id,product_id,updated_at)
         SELECT ?,product_id,updated_at FROM favorites`,
      ).bind(legacyUserId),
    )
  }
  if (tableNames.has('cart_items')) {
    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO user_cart_items(
          user_id,product_id,quantity,updated_at
        )
        SELECT ?,product_id,quantity,updated_at FROM cart_items`,
      ).bind(legacyUserId),
    )
  }
  statements.push(
    db.prepare(
      `INSERT INTO store_meta(key,value,updated_at)
       VALUES('multi_user_migration_v1','done',?)`,
    ).bind(timestamp),
  )
  await db.batch(statements)
}

async function ensureStore(env) {
  if (!env.DB) throw new Error('多用户数据服务要求绑定 D1 数据库。')
  const db = env.DB
  await db.batch(schema.map((sql) => db.prepare(sql)))

  // 运行时兜底使旧部署即使漏跑迁移，也不会因缺少列而直接报错。
  await ensureColumn(db, 'products', 'seller_id', 'TEXT')
  await ensureColumn(db, 'orders', 'user_id', 'TEXT')
  await migrateSingleUserData(db)

  const seeded = await db
    .prepare("SELECT value FROM store_meta WHERE key='seed_version'")
    .first()
  if (!seeded) {
    const timestamp = now()
    const statements = seedProducts.map((product) =>
      insertProductStatement(
        db,
        { ...product, sellerId: null, createdAt: timestamp },
        'seed',
      ))
    statements.push(
      db.prepare(
        `INSERT INTO store_meta(key,value,updated_at)
         VALUES('seed_version','1',?)`,
      ).bind(timestamp),
    )
    await db.batch(statements)
  }
  return db
}

async function snapshot(env, userId) {
  const db = await ensureStore(env)
  const [products, favorites, cart, orders, meta] = await Promise.all([
    db.prepare('SELECT * FROM products ORDER BY created_at DESC').all(),
    db.prepare(
      `SELECT product_id FROM user_favorites
       WHERE user_id=? ORDER BY updated_at DESC`,
    ).bind(userId).all(),
    db.prepare(
      `SELECT product_id,quantity FROM user_cart_items
       WHERE user_id=? ORDER BY updated_at DESC`,
    ).bind(userId).all(),
    db.prepare(
      `SELECT payload_json FROM orders
       WHERE user_id=? ORDER BY created_at DESC`,
    ).bind(userId).all(),
    db.prepare(
      "SELECT value FROM store_meta WHERE key='shared_updated_at'",
    ).first(),
  ])

  return {
    products: products.results.map((row) => mapProduct(row, userId)),
    favorites: favorites.results.map((row) => row.product_id),
    cart: Object.fromEntries(
      cart.results.map((row) => [row.product_id, Number(row.quantity)]),
    ),
    orders: orders.results
      .map((row) => {
        try {
          return JSON.parse(row.payload_json)
        } catch {
          return null
        }
      })
      .filter(Boolean),
    updatedAt: meta?.value || now(),
  }
}

async function persistImage(env, dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    return cleanText(dataUrl, 2000) || '/products/lamp.jpg'
  }

  const match = dataUrl.match(
    /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/,
  )
  if (!match || !imageTypes.has(match[1])) {
    throw new Error('图片格式无法识别。')
  }
  const binary = atob(match[2])
  if (binary.length > 2.5 * 1024 * 1024) {
    throw new Error('图片请控制在 2.5 MB 以内。')
  }
  if (!env.MEDIA) throw new Error('图片存储尚未绑定。')

  const key = `listing-${crypto.randomUUID()}.${imageTypes.get(match[1])}`
  await env.MEDIA.put(
    key,
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    { httpMetadata: { contentType: match[1] } },
  )
  return `/api/media/${encodeURIComponent(key)}`
}

async function createProduct(request, env, user) {
  const payload = await request.json()
  const product = {
    id: `user-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    ...validateProduct(payload),
    campus: '待与买家协商',
    seller: user.username,
    sellerId: user.id,
    image: await persistImage(env, payload.image),
    postedAt: '刚刚发布',
    createdAt: now(),
  }
  const db = await ensureStore(env)
  await db.batch([
    insertProductStatement(db, product, 'shared'),
    touchStatement(db),
  ])
  const { sellerId: _sellerId, ...publicProduct } = product
  return json(
    {
      product: { ...publicProduct, isOwner: true },
      store: await snapshot(env, user.id),
    },
    201,
  )
}

async function removeProduct(env, id, user) {
  const db = await ensureStore(env)
  const product = await db
    .prepare('SELECT image,seller_id FROM products WHERE id=?')
    .bind(id)
    .first()
  if (!product) return json({ message: '商品不存在或已被删除。' }, 404)
  if (product.seller_id !== user.id) {
    return json({ message: '只能删除自己发布的商品。' }, 403)
  }

  const results = await db.batch([
    db.prepare(
      'DELETE FROM products WHERE id=? AND seller_id=?',
    ).bind(id, user.id),
    db.prepare(
      'DELETE FROM user_favorites WHERE product_id=?',
    ).bind(id),
    db.prepare(
      'DELETE FROM user_cart_items WHERE product_id=?',
    ).bind(id),
    touchStatement(db),
  ])
  if (Number(results[0]?.meta?.changes || 0) === 0) {
    return json({ message: '商品不存在或已被删除。' }, 404)
  }

  if (env.MEDIA && product.image?.startsWith('/api/media/')) {
    const key = decodeURIComponent(
      product.image.slice('/api/media/'.length),
    )
    // 数据删除已经成功；对象存储清理失败时不向用户报告“删除失败”。
    if (isManagedMediaKey(key)) {
      await env.MEDIA.delete(key).catch(() => undefined)
    }
  }
  return json({ store: await snapshot(env, user.id) })
}

async function updateFavorite(request, env, id, user) {
  const db = await ensureStore(env)
  const product = await db
    .prepare('SELECT id FROM products WHERE id=?')
    .bind(id)
    .first()
  if (!product) return json({ message: '商品不存在或已被删除。' }, 404)

  const enabled = Boolean((await request.json()).favorite)
  if (enabled) {
    await db.prepare(
      `INSERT INTO user_favorites(user_id,product_id,updated_at)
       VALUES(?,?,?)
       ON CONFLICT(user_id,product_id) DO UPDATE SET
         updated_at=excluded.updated_at`,
    ).bind(user.id, id, now()).run()
  } else {
    await db.prepare(
      'DELETE FROM user_favorites WHERE user_id=? AND product_id=?',
    ).bind(user.id, id).run()
  }
  await touchStatement(db).run()
  return json({ store: await snapshot(env, user.id) })
}

async function updateCart(request, env, id, user) {
  const quantity = Math.max(
    0,
    Math.min(5, Math.round(Number((await request.json()).quantity) || 0)),
  )
  const db = await ensureStore(env)
  if (quantity) {
    const product = await db
      .prepare('SELECT id FROM products WHERE id=?')
      .bind(id)
      .first()
    if (!product) return json({ message: '商品不存在或已被删除。' }, 404)
    await db.prepare(
      `INSERT INTO user_cart_items(
        user_id,product_id,quantity,updated_at
      ) VALUES(?,?,?,?)
      ON CONFLICT(user_id,product_id) DO UPDATE SET
        quantity=excluded.quantity,
        updated_at=excluded.updated_at`,
    ).bind(user.id, id, quantity, now()).run()
  } else {
    await db.prepare(
      'DELETE FROM user_cart_items WHERE user_id=? AND product_id=?',
    ).bind(user.id, id).run()
  }
  await touchStatement(db).run()
  return json({ store: await snapshot(env, user.id) })
}

async function createOrder(request, env, user) {
  const input = await request.json()
  const pickup = cleanText(input.pickup, 80)
  const contactTime = cleanText(input.contactTime, 80)
  if (!pickup || !contactTime) {
    return json({ message: '请补全交接地点和联系时间。' }, 400)
  }

  const db = await ensureStore(env)
  const rows = await db.prepare(
    `SELECT p.*,c.quantity
     FROM user_cart_items c
     INNER JOIN products p ON p.id=c.product_id
     WHERE c.user_id=?`,
  ).bind(user.id).all()
  const items = rows.results.map((row) => ({
    product: mapProduct(row, user.id),
    quantity: Number(row.quantity),
  }))
  if (!items.length) return json({ message: '交易清单为空。' }, 400)

  const createdAt = now()
  const order = {
    id: `ECHO-${Date.now().toString().slice(-8)}-${crypto.randomUUID()
      .slice(0, 4)
      .toUpperCase()}`,
    createdAt: new Date().toLocaleString('zh-CN', {
      hour12: false,
      timeZone: 'Asia/Shanghai',
    }),
    total: items.reduce(
      (total, item) => total + item.product.price * item.quantity,
      0,
    ),
    status: '待与卖家确认',
    pickup,
    contactTime,
    items,
  }
  await db.batch([
    db.prepare(
      `INSERT INTO orders(id,user_id,payload_json,created_at)
       VALUES(?,?,?,?)`,
    ).bind(order.id, user.id, JSON.stringify(order), createdAt),
    db.prepare(
      'DELETE FROM user_cart_items WHERE user_id=?',
    ).bind(user.id),
    touchStatement(db),
  ])
  return json(
    { order, store: await snapshot(env, user.id) },
    201,
  )
}

async function bootstrapLegacyData(request, env, user) {
  const payload = await request.json()
  const db = await ensureStore(env)
  const timestamp = now()

  // 先迁移旧发布，确保随后写入的收藏和清单都有有效商品目标。
  for (const rawProduct of (
    Array.isArray(payload.userProducts) ? payload.userProducts : []
  ).slice(0, 50)) {
    try {
      const id =
        cleanText(rawProduct?.id, 100)
        || `legacy-${crypto.randomUUID()}`
      const existing = await db
        .prepare('SELECT id FROM products WHERE id=?')
        .bind(id)
        .first()
      if (existing) continue

      const product = {
        id,
        ...validateProduct(rawProduct),
        campus: cleanText(rawProduct.campus, 100) || '待与买家协商',
        seller: user.username,
        sellerId: user.id,
        image: await persistImage(env, rawProduct.image),
        postedAt: cleanText(rawProduct.postedAt, 80) || '历史发布',
        createdAt: timestamp,
      }
      await insertProductStatement(db, product, 'legacy').run()
    } catch {
      // 单件旧商品异常时跳过，不阻断其他有效记录。
    }
  }

  const productRows = await db.prepare('SELECT id FROM products').all()
  const validProductIds = new Set(
    productRows.results.map((row) => row.id),
  )
  const statements = []

  for (const rawId of (
    Array.isArray(payload.favorites) ? payload.favorites : []
  ).slice(0, 200)) {
    const productId = cleanText(rawId, 100)
    if (!validProductIds.has(productId)) continue
    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO user_favorites(
          user_id,product_id,updated_at
        ) VALUES(?,?,?)`,
      ).bind(user.id, productId, timestamp),
    )
  }
  for (const [rawId, rawQuantity] of Object.entries(payload.cart || {}).slice(
    0,
    200,
  )) {
    const productId = cleanText(rawId, 100)
    const quantity = Math.max(
      0,
      Math.min(5, Math.round(Number(rawQuantity) || 0)),
    )
    if (!quantity || !validProductIds.has(productId)) continue
    statements.push(
      db.prepare(
        `INSERT INTO user_cart_items(
          user_id,product_id,quantity,updated_at
        ) VALUES(?,?,?,?)
        ON CONFLICT(user_id,product_id) DO UPDATE SET
          quantity=excluded.quantity,
          updated_at=excluded.updated_at`,
      ).bind(user.id, productId, quantity, timestamp),
    )
  }
  for (const order of (
    Array.isArray(payload.orders) ? payload.orders : []
  ).slice(0, 50)) {
    const orderId = cleanText(order?.id, 100)
    if (!orderId) continue
    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO orders(
          id,user_id,payload_json,created_at
        ) VALUES(?,?,?,?)`,
      ).bind(orderId, user.id, JSON.stringify(order), timestamp),
    )
  }

  if (statements.length) await db.batch(statements)
  await touchStatement(db).run()
  return json({ store: await snapshot(env, user.id), imported: true })
}

export async function handleStoreApi(request, env, user, url) {
  try {
    if (url.pathname === '/api/store' && request.method === 'GET') {
      return json({ store: await snapshot(env, user.id) })
    }
    if (
      url.pathname === '/api/store/bootstrap'
      && request.method === 'POST'
    ) {
      return bootstrapLegacyData(request, env, user)
    }
    if (url.pathname === '/api/products' && request.method === 'POST') {
      return createProduct(request, env, user)
    }
    if (
      url.pathname.startsWith('/api/products/')
      && request.method === 'DELETE'
    ) {
      return removeProduct(
        env,
        decodeURIComponent(url.pathname.slice('/api/products/'.length)),
        user,
      )
    }
    if (
      url.pathname.startsWith('/api/favorites/')
      && request.method === 'PUT'
    ) {
      return updateFavorite(
        request,
        env,
        decodeURIComponent(url.pathname.slice('/api/favorites/'.length)),
        user,
      )
    }
    if (
      url.pathname.startsWith('/api/cart/')
      && request.method === 'PUT'
    ) {
      return updateCart(
        request,
        env,
        decodeURIComponent(url.pathname.slice('/api/cart/'.length)),
        user,
      )
    }
    if (url.pathname === '/api/orders' && request.method === 'POST') {
      return createOrder(request, env, user)
    }
    return null
  } catch (error) {
    return json(
      {
        message:
          error instanceof Error
            ? error.message
            : '共享数据暂时无法处理。',
      },
      500,
    )
  }
}

export async function serveMedia(_request, env, url) {
  if (!env.MEDIA) return json({ message: '图片存储尚未绑定。' }, 503)
  const key = decodeURIComponent(url.pathname.slice('/api/media/'.length))
  if (!/^[a-zA-Z0-9._-]+$/.test(key)) {
    return json({ message: '图片地址无效。' }, 400)
  }
  const object = await env.MEDIA.get(key)
  if (!object) return json({ message: '图片不存在。' }, 404)

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('ETag', object.httpEtag)
  headers.set('Cache-Control', 'private, max-age=3600')
  return new Response(object.body, { headers })
}
