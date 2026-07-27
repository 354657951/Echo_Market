import { authFetch } from '../api/authClient'
import { useState, type ChangeEvent, type FormEvent } from 'react'
import { IS_GITHUB_PAGES_DEMO, withBase } from '../config/runtime'
import { categories } from '../data/products'
import { useNavigate } from '../router/AppRouter'
import { useAppStore } from '../state/AppStore'
import type { ListingDraft } from '../types/market'

const emptyDraft: ListingDraft = {
  rawDescription: '',
  title: '',
  category: '生活',
  description: '',
  price: '',
  condition: '九成新',
  tags: '',
  image: '',
}

export function PublishPage() {
  const navigate = useNavigate()
  const { publishProduct } = useAppStore()
  const [draft, setDraft] = useState<ListingDraft>(emptyDraft)
  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [publishing, setPublishing] = useState(false)
  const [aiMessage, setAiMessage] = useState(
    IS_GITHUB_PAGES_DEMO
      ? '当前为 GitHub Pages 静态演示版，可手动填写并发布；AI 整理请使用完整在线版。'
      : '输入物品现状，AI 将整理标题、分类、标签和可信描述。',
  )

  // 使用泛型更新单个字段，保证字段名和值类型一致。
  function updateDraft<K extends keyof ListingDraft>(key: K, value: ListingDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function handleImage(event: ChangeEvent<HTMLInputElement>) {
    // 图片仅在浏览器中转为预览，不上传到第三方服务；大小限制为 2.5 MB。
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 2.5 * 1024 * 1024) {
      setAiStatus('error')
      setAiMessage('图片请控制在 2.5 MB 以内。')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      updateDraft('image', String(reader.result))
      setAiStatus('success')
      setAiMessage('商品照片已载入，发布后会同步给其他组员。')
    }
    reader.readAsDataURL(file)
  }

  async function polishWithAi() {
    // AI 只整理表达，用户仍可修改每个字段并确认真实性。
    if (IS_GITHUB_PAGES_DEMO) {
      setAiStatus('error')
      setAiMessage('静态演示版不连接服务端 AI。你仍可手动填写下方字段并完成发布。')
      return
    }
    if (draft.rawDescription.trim().length < 8) {
      setAiStatus('error')
      setAiMessage('请先输入至少 8 个字的物品信息。')
      return
    }
    setAiStatus('loading')
    setAiMessage('正在整理商品信息…')
    try {
      const response = await authFetch('/api/ai-polish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawDescription: draft.rawDescription,
          condition: draft.condition,
          expectedPrice: draft.price,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || 'AI 服务暂时不可用。')
      const listing = payload.listing
      setDraft((current) => ({
        ...current,
        title: String(listing.title || ''),
        category: (listing.category || '生活') as ListingDraft['category'],
        description: String(listing.description || ''),
        price: String(listing.priceSuggestion || current.price || ''),
        tags: Array.isArray(listing.tags) ? listing.tags.join(' · ') : '',
      }))
      setAiStatus('success')
      setAiMessage(String(listing.safetyNote || '已完成整理，请确认后发布。'))
    } catch (error) {
      setAiStatus('error')
      setAiMessage(error instanceof Error ? error.message : 'AI 服务暂时不可用。')
    }
  }

  async function submitListing(event: FormEvent<HTMLFormElement>) {
    // 发布前再次校验关键字段，防止绕过表单约束写入无效数据。
    event.preventDefault()
    const price = Number(draft.price)
    if (!draft.title.trim() || !draft.description.trim() || !Number.isFinite(price) || price <= 0) {
      setAiStatus('error')
      setAiMessage('请补全商品标题、描述和有效价格。')
      return
    }
    setPublishing(true)
    setAiStatus('loading')
    setAiMessage('正在保存商品和照片到共享空间…')
    try {
      const product = await publishProduct(draft)
      navigate(`/product/${product.id}`, { replace: true })
    } catch (error) {
      setAiStatus('error')
      setAiMessage(error instanceof Error ? error.message : '发布失败，请稍后重试。')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <main className="route-main publish-page">
      <section className="route-hero compact light">
        <p className="eyebrow">AI LISTING STUDIO</p>
        <h1>发布一件闲置</h1>
        <p>AI 负责整理表达，你负责确认每一条事实。</p>
      </section>

      <section className="route-section publish-layout">
        <form className="publish-form" onSubmit={submitListing}>
          <div className="field full">
            <label htmlFor="raw-description">物品的真实情况</label>
            <textarea
              id="raw-description"
              onChange={(event) => updateDraft('rawDescription', event.target.value)}
              placeholder="例如：用了一个学期的无线键盘，功能正常，宿舍自提，希望 200 左右出…"
              rows={5}
              value={draft.rawDescription}
            />
          </div>
          <div className="field">
            <label htmlFor="condition">物品成色</label>
            <select id="condition" onChange={(event) => updateDraft('condition', event.target.value)} value={draft.condition}>
              <option>全新未拆</option>
              <option>九成新</option>
              <option>八成新</option>
              <option>七成新</option>
              <option>明显使用痕迹</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="expected-price">期望价格</label>
            <input
              id="expected-price"
              min="1"
              onChange={(event) => updateDraft('price', event.target.value)}
              placeholder="¥"
              type="number"
              value={draft.price}
            />
          </div>
          <button
            className="ai-button full"
            disabled={aiStatus === 'loading' || IS_GITHUB_PAGES_DEMO}
            onClick={polishWithAi}
            type="button"
          >
            {IS_GITHUB_PAGES_DEMO
              ? 'AI 整理仅在完整在线版可用'
              : aiStatus === 'loading' ? 'AI 正在整理…' : '用 AI 整理商品信息'}
          </button>
          <div className="status-row full" data-status={aiStatus}>
            <span>{aiStatus === 'success' ? '已完成' : aiStatus === 'error' ? '需要处理' : '准备就绪'}</span>
            <p>{aiMessage}</p>
          </div>
          <div className="field full">
            <label htmlFor="listing-title">商品标题</label>
            <input
              id="listing-title"
              onChange={(event) => updateDraft('title', event.target.value)}
              placeholder="简洁说明物品名称和特征"
              value={draft.title}
            />
          </div>
          <div className="field">
            <label htmlFor="listing-category">分类</label>
            <select
              id="listing-category"
              onChange={(event) => updateDraft('category', event.target.value as ListingDraft['category'])}
              value={draft.category}
            >
              {categories.filter((item) => item !== '全部').map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="listing-tags">标签</label>
            <input
              id="listing-tags"
              onChange={(event) => updateDraft('tags', event.target.value)}
              placeholder="自提 · 可试用"
              value={draft.tags}
            />
          </div>
          <div className="field full">
            <label htmlFor="listing-description">商品描述</label>
            <textarea
              id="listing-description"
              onChange={(event) => updateDraft('description', event.target.value)}
              placeholder="写清楚功能、瑕疵、配件和交易方式"
              rows={5}
              value={draft.description}
            />
          </div>
          <div className="field full">
            <label htmlFor="listing-image">商品照片</label>
            <input accept="image/*" id="listing-image" onChange={handleImage} type="file" />
          </div>
          <label className="truth-check full">
            <input required type="checkbox" />
            <span>我确认标题、价格、成色和瑕疵描述均与实物一致。</span>
          </label>
          <button className="publish-button full" disabled={publishing} type="submit">
            {publishing ? '正在发布并同步…' : '确认信息并发布'}
          </button>
        </form>

        <aside className="listing-preview">
          <p className="preview-label">LIVE PREVIEW</p>
          <div className="preview-image">
            <img alt="待发布商品预览" src={draft.image || withBase('/products/lamp.jpg')} />
          </div>
          <div className="preview-content">
            <p>{draft.category} · {draft.condition}</p>
            <h3>{draft.title || '你的商品标题会出现在这里'}</h3>
            <strong>{draft.price ? `¥${draft.price}` : '价格待填写'}</strong>
            <p>{draft.description || '一段克制、真实、方便买家判断的商品描述。'}</p>
            <div className="tag-row">
              {(draft.tags ? draft.tags.split(/[·、,，]/) : ['真实描述', '当面验货'])
                .map((tag) => tag.trim())
                .filter(Boolean)
                .slice(0, 4)
                .map((tag) => <span key={tag}>{tag}</span>)}
            </div>
          </div>
        </aside>
      </section>
    </main>
  )
}
