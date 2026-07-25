function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

const sessionCookieName = 'echo_market_session'
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function appCredentials(env) {
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
  if (left.length !== right.length) return false
  let result = 0
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return result === 0
}

async function signSession(value, secret) {
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

async function login(request, env) {
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
    const upstream = await fetch(env.AI_API_URL || 'https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.AI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.AI_MODEL,
        input: prompt,
      }),
    })
    const payload = await upstream.json()

    if (!upstream.ok) {
      return json({ message: payload?.error?.message || 'AI 服务暂时不可用。' }, 502)
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
    const url = new URL(request.url)

    if (url.pathname === '/api/health') {
      return json({ ok: true, aiConfigured: Boolean(env.AI_API_KEY && env.AI_MODEL) })
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
    if (request.method === 'GET' && assetResponse.status === 404 && acceptsHtml) {
      const indexRequest = new Request(new URL('/index.html', request.url), request)
      return env.ASSETS.fetch(indexRequest)
    }
    return assetResponse
  },
}
