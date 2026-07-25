function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
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

    if (url.pathname === '/api/ai-polish' && request.method === 'POST') {
      return polishListing(request, env)
    }

    return env.ASSETS.fetch(request)
  },
}
