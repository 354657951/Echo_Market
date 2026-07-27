import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import express from 'express'
import {
  bootstrapLocalStore,
  createLocalOrder,
  createLocalProduct,
  getLocalStore,
  resolveLocalMedia,
  updateLocalCart,
  updateLocalFavorite,
} from './server-store.mjs'
import {
  createAiRequestBody,
  createListingPrompt,
  normalizeAiListing,
  validateAiImage,
} from './shared/ai-listing.js'

// 本地开发服务：提供账号会话和 AI 商品信息整理接口。
const app = express()
const port = Number(process.env.PORT || 8787)
const sessionCookieName = 'echo_market_session'
const sessions = new Map()
const appUsername = process.env.APP_USERNAME || 'campus'
const appPassword = process.env.APP_PASSWORD || 'Echo@2026'
const defaultAiApiUrl = 'https://api.siliconflow.cn/v1/chat/completions'

app.use(express.json({ limit: '4mb' }))

// 从 Cookie 字符串中读取指定字段，避免额外引入解析依赖。
function readCookie(request, name) {
  const prefix = `${name}=`
  const entry = String(request.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : ''
}

function sessionUser(request) {
  // 内存会话仅用于本地开发；生产环境使用 Worker 的签名 Cookie。
  const token = readCookie(request, sessionCookieName)
  const session = sessions.get(token)
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token)
    return null
  }
  return session.username
}

function upstreamErrorMessage(payload) {
  // 兼容不同供应商的字符串、顶层 message 和 error.message 错误结构。
  if (typeof payload === 'string') return payload
  return payload?.error?.message || payload?.message || 'AI 服务暂时不可用。'
}

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    aiConfigured: Boolean(process.env.AI_API_KEY && process.env.AI_MODEL),
    aiProvider: (process.env.AI_API_URL || defaultAiApiUrl).includes('siliconflow.cn')
      ? 'siliconflow'
      : 'compatible',
    sharedStoreConfigured: true,
    mediaStoreConfigured: true,
  })
})

app.post('/api/auth/login', (request, response) => {
  // 课程演示账号可通过环境变量覆盖，源码中不保存生产密码。
  const username = typeof request.body?.username === 'string' ? request.body.username.trim() : ''
  const password = typeof request.body?.password === 'string' ? request.body.password : ''

  if (username !== appUsername || password !== appPassword) {
    response.status(401).json({ message: '账号或密码不正确。' })
    return
  }

  const token = randomBytes(24).toString('base64url')
  sessions.set(token, { username, expiresAt: Date.now() + 12 * 60 * 60 * 1000 })
  response.setHeader(
    'Set-Cookie',
    `${sessionCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${12 * 60 * 60}`,
  )
  response.json({ authenticated: true, user: username })
})

app.get('/api/auth/session', (request, response) => {
  const user = sessionUser(request)
  response.json({ authenticated: Boolean(user), user })
})

app.post('/api/auth/logout', (request, response) => {
  const token = readCookie(request, sessionCookieName)
  if (token) sessions.delete(token)
  response.setHeader(
    'Set-Cookie',
    `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  )
  response.json({ authenticated: false })
})

app.post('/api/ai-polish', async (request, response) => {
  // AI 功能要求登录，防止公开接口被匿名批量调用。
  if (!sessionUser(request)) {
    response.status(401).json({ message: '请先登录后再使用 AI 发布功能。' })
    return
  }

  const apiKey = process.env.AI_API_KEY
  const model = process.env.AI_MODEL
  const apiUrl = process.env.AI_API_URL || defaultAiApiUrl

  if (!apiKey || !model) {
    response.status(503).json({
      configured: false,
      message: 'AI 接口尚未配置。请在 .env 中填写 AI_API_KEY 与 AI_MODEL。',
    })
    return
  }

  const { rawDescription, condition, expectedPrice, image } = request.body ?? {}

  const imageValidation = validateAiImage(image)
  if (!imageValidation.ok) {
    response.status(400).json({ message: imageValidation.message })
    return
  }

  if (typeof rawDescription !== 'string' || rawDescription.trim().length < 8) {
    response.status(400).json({ message: '请至少输入 8 个字的物品信息。' })
    return
  }

  const prompt = createListingPrompt({ rawDescription, condition, expectedPrice })

  try {
    // API Key 仅在服务端请求头中使用，不返回给浏览器。
    const upstream = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(createAiRequestBody(apiUrl, model, prompt, imageValidation.image)),
    })

    const payload = await upstream.json()

    if (!upstream.ok) {
      response.status(502).json({
        message: upstreamErrorMessage(payload),
      })
      return
    }

    const text =
      payload.output_text ||
      payload.choices?.[0]?.message?.content ||
      payload.output?.flatMap((item) => item.content || []).find((item) => item.type === 'output_text')?.text

    if (typeof text !== 'string') {
      response.status(502).json({ message: 'AI 返回内容无法解析。' })
      return
    }

    const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
    // 去除模型可能附带的 Markdown 围栏后再解析结构化商品数据。
    const listing = normalizeAiListing(
      JSON.parse(cleaned),
      { rawDescription, condition, expectedPrice },
    )
    response.json({ configured: true, listing })
  } catch {
    response.status(502).json({ message: '连接 AI 服务失败，请检查接口地址与网络。' })
  }
})

function requireLocalSession(request, response) {
  const user = sessionUser(request)
  if (!user) {
    response.status(401).json({ message: '请先登录后再操作共享数据。' })
    return null
  }
  return user
}

function storeError(response, error) {
  response.status(500).json({
    message: error instanceof Error ? error.message : '共享数据暂时无法处理。',
  })
}

app.get('/api/store', async (request, response) => {
  if (!requireLocalSession(request, response)) return
  try {
    response.json({ store: await getLocalStore() })
  } catch (error) {
    storeError(response, error)
  }
})

app.post('/api/store/bootstrap', async (request, response) => {
  if (!requireLocalSession(request, response)) return
  try {
    const { state } = await bootstrapLocalStore(request.body ?? {})
    response.json({ store: state, imported: true })
  } catch (error) {
    storeError(response, error)
  }
})

app.post('/api/products', async (request, response) => {
  const user = requireLocalSession(request, response)
  if (!user) return
  try {
    const { product, state } = await createLocalProduct(request.body ?? {}, user)
    response.status(201).json({ product, store: state })
  } catch (error) {
    storeError(response, error)
  }
})

app.put('/api/favorites/:productId', async (request, response) => {
  if (!requireLocalSession(request, response)) return
  try {
    const state = await updateLocalFavorite(request.params.productId, Boolean(request.body?.favorite))
    response.json({ store: state })
  } catch (error) {
    storeError(response, error)
  }
})

app.put('/api/cart/:productId', async (request, response) => {
  if (!requireLocalSession(request, response)) return
  try {
    const state = await updateLocalCart(request.params.productId, request.body?.quantity)
    response.json({ store: state })
  } catch (error) {
    storeError(response, error)
  }
})

app.post('/api/orders', async (request, response) => {
  if (!requireLocalSession(request, response)) return
  try {
    const { order, state } = await createLocalOrder(request.body ?? {})
    response.status(201).json({ order, store: state })
  } catch (error) {
    storeError(response, error)
  }
})

app.get('/api/media/:filename', (request, response) => {
  if (!requireLocalSession(request, response)) return
  const filePath = resolveLocalMedia(request.params.filename)
  if (!filePath) {
    response.status(400).json({ message: '图片地址无效。' })
    return
  }
  response.sendFile(filePath, (error) => {
    if (error && !response.headersSent) response.status(404).json({ message: '图片不存在。' })
  })
})

app.listen(port, '127.0.0.1', () => {
  console.log(`Echo Market API listening on http://127.0.0.1:${port}`)
})
