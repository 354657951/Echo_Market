import 'dotenv/config'
import express from 'express'

const app = express()
const port = Number(process.env.PORT || 8787)

app.use(express.json({ limit: '1mb' }))

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, aiConfigured: Boolean(process.env.AI_API_KEY && process.env.AI_MODEL) })
})

app.post('/api/ai-polish', async (request, response) => {
  const apiKey = process.env.AI_API_KEY
  const model = process.env.AI_MODEL
  const apiUrl = process.env.AI_API_URL || 'https://api.openai.com/v1/responses'

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
    const upstream = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: prompt,
      }),
    })

    const payload = await upstream.json()

    if (!upstream.ok) {
      response.status(502).json({
        message: payload?.error?.message || 'AI 服务暂时不可用。',
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
    const listing = JSON.parse(cleaned)
    response.json({ configured: true, listing })
  } catch {
    response.status(502).json({ message: '连接 AI 服务失败，请检查接口地址与网络。' })
  }
})

app.listen(port, '127.0.0.1', () => {
  console.log(`Echo Market API listening on http://127.0.0.1:${port}`)
})
