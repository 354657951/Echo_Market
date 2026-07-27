import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import express from 'express'

// 本地开发服务：提供账号会话和 AI 商品信息整理接口。
const app = express()
const port = Number(process.env.PORT || 8787)
const sessionCookieName = 'echo_market_session'
const sessions = new Map()
const appUsername = process.env.APP_USERNAME || 'campus'
const appPassword = process.env.APP_PASSWORD || 'Echo@2026'
const defaultAiApiUrl = 'https://api.siliconflow.cn/v1/chat/completions'

app.use(express.json({ limit: '1mb' }))

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

function createAiRequestBody(apiUrl, model, prompt) {
  // SiliconFlow 使用 Chat Completions；同时保留其他兼容接口的 input 形式。
  if (apiUrl.includes('/chat/completions')) {
    return {
      model,
      messages: [
        {
          role: 'system',
          content: '你是校园二手交易平台的商品编辑。请严格返回一个 JSON 对象，不要输出 Markdown。',
        },
        { role: 'user', content: prompt },
      ],
      stream: false,
      temperature: 0.2,
      max_tokens: 800,
      enable_thinking: false,
      response_format: { type: 'json_object' },
    }
  }

  return { model, input: prompt }
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

  const { rawDescription, condition, expectedPrice } = request.body ?? {}

  if (typeof rawDescription !== 'string' || rawDescription.trim().length < 8) {
    response.status(400).json({ message: '请至少输入 8 个字的物品信息。' })
    return
  }

  const prompt = [
    // 提示词强调事实、字段约束和安全交易，避免生成夸张营销文案。
    '你是校园二手交易平台的商品编辑。',
    '请把用户提供的信息整理为可信、克制、无夸张承诺的商品资料。',
    '只返回合法 JSON，不要使用 Markdown。',
    '字段必须为 title、category、tags、description、priceSuggestion、safetyNote。',
    'category 只能是 数码、学习、生活、运动、影音 之一。',
    'tags 必须是 2 到 4 个简短中文字符串组成的数组。',
    `原始描述：${rawDescription.trim()}`,
    `成色：${condition || '未说明'}`,
    `期望价格：${expectedPrice || '未说明'}`,
  ].join('\n')

  try {
    // API Key 仅在服务端请求头中使用，不返回给浏览器。
    const upstream = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(createAiRequestBody(apiUrl, model, prompt)),
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
    const listing = JSON.parse(cleaned)
    response.json({ configured: true, listing })
  } catch {
    response.status(502).json({ message: '连接 AI 服务失败，请检查接口地址与网络。' })
  }
})

app.listen(port, '127.0.0.1', () => {
  console.log(`Echo Market API listening on http://127.0.0.1:${port}`)
})
