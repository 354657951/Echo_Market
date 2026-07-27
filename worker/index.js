function json(data, status = 200) {
  // 所有 API 统一返回 UTF-8 JSON，方便前端集中处理。
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

const sessionCookieName = 'echo_market_session'
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
const defaultAiApiUrl = 'https://api.siliconflow.cn/v1/chat/completions'

function appCredentials(env) {
  // 生产账号、密码和签名密钥均优先读取 Sites 环境变量。
  return {
    username: env.APP_USERNAME || 'campus',
    password: env.APP_PASSWORD || 'Echo@2026',
    secret: env.APP_SESSION_SECRET || 'echo-market-demo-session-secret-2026',
  }
}

function toBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
}

function safeEqual(left, right) {
  // 逐字符比较，避免普通字符串比较过早退出造成的时序差异。
  if (left.length !== right.length) return false
  let result = 0
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return result === 0
}

async function signSession(value, secret) {
  // 使用 HMAC-SHA256 签名会话，Worker 无需保存服务端会话表。
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(value))
  return toBase64Url(new Uint8Array(signature))
}

function readCookie(request, name) {
  const cookieHeader = request.headers.get('Cookie') || ''
  const prefix = `${name}=`
  const entry = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix))
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : ''
}

async function createSession(username, env) {
  const expiresAt = Date.now() + 12 * 60 * 60 * 1000
  const encodedUser = toBase64Url(textEncoder.encode(username))
  const payload = `${encodedUser}.${expiresAt}`
  const signature = await signSession(payload, appCredentials(env).secret)
  return `${payload}.${signature}`
}

async function authenticatedUser(request, env) {
  // 校验签名与过期时间后才返回用户名。
  const token = readCookie(request, sessionCookieName)
  const [encodedUser, expiresAt, signature, ...rest] = token.split('.')
  if (!encodedUser || !expiresAt || !signature || rest.length > 0) return null
  if (!Number.isFinite(Number(expiresAt)) || Number(expiresAt) <= Date.now()) return null
  const expected = await signSession(`${encodedUser}.${expiresAt}`, appCredentials(env).secret)
  if (!safeEqual(signature, expected)) return null

  try {
    return textDecoder.decode(fromBase64Url(encodedUser))
  } catch {
    return null
  }
}

function sessionCookie(token, maxAge) {
  return `${sessionCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
}

function createAiRequestBody(apiUrl, model, prompt) {
  // SiliconFlow 走 Chat Completions；其他兼容服务仍可使用 input 请求。
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
  if (typeof payload === 'string') return payload
  return payload?.error?.message || payload?.message || 'AI 服务暂时不可用。'
}

async function login(request, env) {
  // 登录成功后下发 HttpOnly、Secure、SameSite=Lax 的签名 Cookie。
  let body
  try {
    body = await request.json()
  } catch {
    return json({ message: '请输入账号和密码。' }, 400)
  }

  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const credentials = appCredentials(env)

  if (!safeEqual(username, credentials.username) || !safeEqual(password, credentials.password)) {
    return json({ message: '账号或密码不正确。' }, 401)
  }

  const token = await createSession(username, env)
  return new Response(JSON.stringify({ authenticated: true, user: username }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': sessionCookie(token, 12 * 60 * 60),
    },
  })
}

async function polishListing(request, env) {
  // 未配置密钥时保留人工发布流程，并向页面返回明确状态。
  if (!env.AI_API_KEY || !env.AI_MODEL) {
    return json(
      {
        configured: false,
        message: 'AI 接口尚未配置。请填写 AI_API_KEY 与 AI_MODEL。',
      },
      503,
    )
  }

  const body = await request.json()
  const rawDescription = typeof body.rawDescription === 'string' ? body.rawDescription.trim() : ''

  if (rawDescription.length < 8) {
    return json({ message: '请至少输入 8 个字的物品信息。' }, 400)
  }

  const prompt = [
    // 约束输出字段和可选分类，降低前端解析失败概率。
    '你是校园二手交易平台的商品编辑。',
    '请把用户提供的信息整理为可信、克制、无夸张承诺的商品资料。',
    '只返回合法 JSON，不要使用 Markdown。',
    '字段必须为 title、category、tags、description、priceSuggestion、safetyNote。',
    'category 只能是 数码、学习、生活、运动、影音 之一。',
    'tags 必须是 2 到 4 个简短中文字符串组成的数组。',
    `原始描述：${rawDescription}`,
    `成色：${body.condition || '未说明'}`,
    `期望价格：${body.expectedPrice || '未说明'}`,
  ].join('\n')

  try {
    // 真实密钥只存在于 Worker 运行环境，不进入静态资源。
    const apiUrl = env.AI_API_URL || defaultAiApiUrl
    const upstream = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.AI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(createAiRequestBody(apiUrl, env.AI_MODEL, prompt)),
    })
    const payload = await upstream.json()

    if (!upstream.ok) {
      return json({ message: upstreamErrorMessage(payload) }, 502)
    }

    const text =
      payload.output_text ||
      payload.choices?.[0]?.message?.content ||
      payload.output?.flatMap((item) => item.content || []).find((item) => item.type === 'output_text')?.text

    if (typeof text !== 'string') {
      return json({ message: 'AI 返回内容无法解析。' }, 502)
    }

    const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
    return json({ configured: true, listing: JSON.parse(cleaned) })
  } catch {
    return json({ message: '连接 AI 服务失败，请检查接口地址与网络。' }, 502)
  }
}

export default {
  async fetch(request, env) {
    // API 路由优先处理，其余请求交给静态资源服务。
    const url = new URL(request.url)

    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        aiConfigured: Boolean(env.AI_API_KEY && env.AI_MODEL),
        aiProvider: (env.AI_API_URL || defaultAiApiUrl).includes('siliconflow.cn')
          ? 'siliconflow'
          : 'compatible',
      })
    }

    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      return login(request, env)
    }

    if (url.pathname === '/api/auth/session') {
      const user = await authenticatedUser(request, env)
      return json({ authenticated: Boolean(user), user })
    }

    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
      return new Response(JSON.stringify({ authenticated: false }), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': sessionCookie('', 0),
        },
      })
    }

    if (url.pathname === '/api/ai-polish' && request.method === 'POST') {
      if (!(await authenticatedUser(request, env))) {
        return json({ message: '请先登录后再使用 AI 发布功能。' }, 401)
      }
      return polishListing(request, env)
    }

    const assetResponse = await env.ASSETS.fetch(request)
    const acceptsHtml = request.headers.get('Accept')?.includes('text/html')
    // 单页应用的深层地址统一回退到 index.html，再由前端路由决定页面。
    if (request.method === 'GET' && assetResponse.status === 404 && acceptsHtml) {
      const indexRequest = new Request(new URL('/index.html', request.url), request)
      return env.ASSETS.fetch(indexRequest)
    }
    return assetResponse
  },
}
