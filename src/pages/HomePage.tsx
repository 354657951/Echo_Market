import { Link } from '../router/AppRouter'
import { HERO_VIDEO_URL } from '../config/media'
import { ProductCard } from '../components/market/ProductCard'
import { AnimatedHeading } from '../components/motion/AnimatedHeading'
import { FadeIn } from '../components/motion/FadeIn'
import { useAppStore } from '../state/AppStore'

export function HomePage() {
  // 首页精选最新三件商品，完整列表由集市页面承载。
  const { allProducts, orders } = useAppStore()
  const featured = allProducts.slice(0, 3)

  return (
    <main>
      <section className="home-hero">
        <video aria-label="校园旧物循环站背景影像" autoPlay loop muted playsInline src={HERO_VIDEO_URL} />
        <div className="home-hero-content">
          <div>
            <AnimatedHeading text={'让旧物留下回声\n让价值再次流动。'} />
            <FadeIn delay={800} duration={1000}>
              <p className="hero-subtitle">
                AI 辅助整理商品信息，让每一次发布更真实、更省力，也让校园里的闲置找到下一位需要它的人。
              </p>
            </FadeIn>
            <FadeIn delay={1200} duration={1000}>
              <div className="hero-actions">
                <Link className="primary-action" to="/market">进入校园集市</Link>
                <Link className="liquid-glass secondary-action" to="/publish">AI 帮我发布</Link>
              </div>
            </FadeIn>
          </div>
          <FadeIn className="hero-side-card liquid-glass" delay={1400} duration={1000}>
            <p>本周循环记录</p>
            <strong>{allProducts.length + orders.length}</strong>
            <span>件物品正在延续使用价值</span>
            <Link to="/story">查看循环故事</Link>
          </FadeIn>
        </div>
      </section>

      <section className="route-section home-intro">
        <div className="route-heading">
          <p className="eyebrow">START HERE</p>
          <h2>从一种明确的需求开始。</h2>
          <p>浏览、发布和交易不再挤在同一个页面，每一步都有独立空间与完整上下文。</p>
        </div>
        <div className="journey-grid">
          <Link to="/market">
            <span>01</span>
            <h3>寻找真正需要的物品</h3>
            <p>通过分类、关键词和价格排序筛选校园闲置。</p>
          </Link>
          <Link to="/publish">
            <span>02</span>
            <h3>发布一件闲置</h3>
            <p>让 AI 整理表达，所有事实仍由发布者确认。</p>
          </Link>
          <Link to="/cart">
            <span>03</span>
            <h3>规划线下交接</h3>
            <p>选择校内地点和联系时间，再生成交易确认单。</p>
          </Link>
        </div>
      </section>

      <section className="route-section featured-section">
        <div className="section-row-heading">
          <div>
            <p className="eyebrow">RECENT LISTINGS</p>
            <h2>刚刚留下的新回声</h2>
          </div>
          <Link to="/market">查看全部 {allProducts.length} 件</Link>
        </div>
        <div className="product-grid">
          {featured.map((product) => <ProductCard key={product.id} product={product} />)}
        </div>
      </section>
    </main>
  )
}
