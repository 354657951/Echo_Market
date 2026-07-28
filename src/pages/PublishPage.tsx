import { useState, type ChangeEvent, type FormEvent } from 'react'
import { authFetch } from '../api/authClient'
import { IS_GITHUB_PAGES_DEMO } from '../config/runtime'
import { categories } from '../data/products'
import { useNavigate } from '../router/AppRouter'
import { useAppStore } from '../state/AppStore'
import type { ListingDraft } from '../types/market'

const supportedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
const maxOriginalImageBytes = 2.5 * 1024 * 1024
const maxProcessedImageEdge = 1200

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

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('无法读取这张图片，请重新选择。'))
    reader.readAsDataURL(file)
  })
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片内容无法识别，请换一张商品照片。'))
    image.src = source
  })
}

async function prepareProductImage(file: File) {
  // 统一缩放并转成 JPEG，降低读图请求体、视觉 token 与共享图片的体积。
  const source = await readFileAsDataUrl(file)
  const image = await loadImage(source)
  const scale = Math.min(
    1,
    maxProcessedImageEdge / Math.max(image.naturalWidth, image.naturalHeight),
  )
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器暂时无法处理图片，请重新选择。')
  context.fillStyle = '#f7f5ef'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  return canvas.toDataURL('image/jpeg', 0.84)
}

export function PublishPage() {
  const navigate = useNavigate()
  const { publishProduct } = useAppStore()
  const [draft, setDraft] = useState<ListingDraft>(emptyDraft)
  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [imageLoading, setImageLoading] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [aiMessage, setAiMessage] = useState(
    IS_GITHUB_PAGES_DEMO
      ? '当前为 GitHub Pages 静态演示版，可手动填写并发布；AI 整理请使用完整在线版。'
      : '先上传商品照片并说明真实情况，AI 会结合图片整理标题、分类、标签和可信描述。',
  )

  // 使用泛型更新单个字段，保证字段名和值类型一致。
  function updateDraft<K extends keyof ListingDraft>(key: K, value: ListingDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  async function handleImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!supportedImageTypes.has(file.type)) {
      event.target.value = ''
      setAiStatus('error')
      setAiMessage('请上传 JPG、PNG 或 WebP 格式的商品照片。')
      return
    }
    if (file.size > maxOriginalImageBytes) {
      event.target.value = ''
      setAiStatus('error')
      setAiMessage('图片请控制在 2.5 MB 以内。')
      return
    }

    setImageLoading(true)
    setAiStatus('loading')
    setAiMessage('正在处理商品照片…')
    try {
      const processedImage = await prepareProductImage(file)
      updateDraft('image', processedImage)
      setAiStatus('success')
      setAiMessage('商品照片已载入。补充真实情况后，可以让 AI 读图并整理信息。')
    } catch (error) {
      event.target.value = ''
      updateDraft('image', '')
      setAiStatus('error')
      setAiMessage(error instanceof Error ? error.message : '图片处理失败，请重新选择。')
    } finally {
      setImageLoading(false)
    }
  }

  async function polishWithAi() {
    // AI 同时读取图片与文字，但用户仍需确认成色、功能和隐藏瑕疵。
    if (IS_GITHUB_PAGES_DEMO) {
      setAiStatus('error')
      setAiMessage('静态演示版不连接服务端 AI。你仍可手动填写下方字段并完成发布。')
      return
    }
    if (!draft.image) {
      setAiStatus('error')
      setAiMessage('请先上传一张清晰的商品照片，AI 需要结合图片整理信息。')
      return
    }
    if (draft.rawDescription.trim().length < 8) {
      setAiStatus('error')
      setAiMessage('请先输入至少 8 个字的物品信息。')
      return
    }
    setAiStatus('loading')
    setAiMessage('AI 正在读取照片并整理商品信息…')
    try {
      const response = await authFetch('/api/ai-polish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawDescription: draft.rawDescription,
          condition: draft.condition,
          expectedPrice: draft.price,
          image: draft.image,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || 'AI 服务暂时不可用。')
      const listing = payload.listing
      setDraft((current) => ({
        ...current,
        title: String(listing.title || ''),
        category: categories.includes(listing.category) && listing.category !== '全部'
          ? listing.category as ListingDraft['category']
          : '生活',
        description: String(listing.description || ''),
        price: Number(listing.priceSuggestion) > 0
          ? String(listing.priceSuggestion)
          : current.price,
        tags: Array.isArray(listing.tags) ? listing.tags.join(' · ') : '',
      }))
      setAiStatus('success')
      const uncertainties = Array.isArray(listing.uncertainties)
        ? listing.uncertainties.filter(Boolean).slice(0, 3)
        : []
      setAiMessage([
        listing.imageSummary ? `已识别：${String(listing.imageSummary)}` : '',
        listing.safetyNote ? String(listing.safetyNote) : '已完成整理，请确认后发布。',
        uncertainties.length > 0 ? `仍需确认：${uncertainties.join('、')}。` : '',
      ].filter(Boolean).join(' '))
    } catch (error) {
      setAiStatus('error')
      setAiMessage(error instanceof Error ? error.message : 'AI 服务暂时不可用。')
    }
  }

  async function submitListing(event: FormEvent<HTMLFormElement>) {
    // 发布前再次校验关键字段，防止绕过表单约束写入无效数据。
    event.preventDefault()
    const price = Number(draft.price)
    if (!draft.image) {
      setAiStatus('error')
      setAiMessage('请先上传一张清晰的商品照片再发布。')
      return
    }
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
        <p>AI 结合照片与说明整理信息，你负责确认每一条事实。</p>
      </section>

      <section className="route-section publish-layout">
        <form className="publish-form" onSubmit={submitListing}>
          <div className="field full">
            <label htmlFor="listing-image">商品照片</label>
            <input
              accept="image/jpeg,image/png,image/webp"
              id="listing-image"
              onChange={handleImage}
              required
              type="file"
            />
          </div>
          <div className="field full">
            <label htmlFor="raw-description">物品的真实情况</label>
            <textarea
              id="raw-description"
              onChange={(event) => updateDraft('rawDescription', event.target.value)}
              placeholder="例如：用了一个学期的无线键盘，功能正常，宿舍自提，希望 200 左右出…"
              required
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
            disabled={aiStatus === 'loading' || imageLoading || IS_GITHUB_PAGES_DEMO}
            onClick={polishWithAi}
            type="button"
          >
            {IS_GITHUB_PAGES_DEMO
              ? 'AI 整理仅在完整在线版可用'
              : aiStatus === 'loading' ? 'AI 正在读图并整理…' : '用 AI 读图并整理商品信息'}
          </button>
          <div
            aria-live="polite"
            className="status-row full"
            data-status={aiStatus}
            id="ai-status"
            role="status"
          >
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
            {draft.image
              ? <img alt="待发布商品预览" src={draft.image} />
              : (
                <div className="preview-empty">
                  <span>商品照片</span>
                  <p>上传后在这里核对公开效果</p>
                </div>
              )}
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
