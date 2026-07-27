import { Link } from '../router/AppRouter'
import { useAppStore } from '../state/AppStore'

export function StoryPage() {
  // 循环故事中的数字来自当前浏览器的真实商品与确认记录。
  const { allProducts, orders } = useAppStore()

  return (
    <main className="route-main story-page">
      <section className="story-hero">
        <p className="eyebrow">CIRCULATION ARCHIVE / 2026</p>
        <h1>一件闲置，不必以被遗忘收场。</h1>
        <p>回声集把商品发布拆成可验证的信息，让物品的下一段旅程从诚实描述开始。</p>
      </section>

      <section className="route-section">
        <div className="metrics">
          <div><strong>{allProducts.length}</strong><span>件公开旧物档案</span></div>
          <div><strong>{orders.length}</strong><span>份交易确认记录</span></div>
          <div><strong>0</strong><span>条默认夸张文案</span></div>
        </div>
      </section>

      <section className="route-section story-process">
        <p className="eyebrow">HOW IT FLOWS</p>
        <div className="story-process-grid">
          <article>
            <span>01 / 记录</span>
            <h2>说明事实，而不是制造卖点。</h2>
            <p>发布者需要明确功能、使用痕迹、配件、成色和交接条件。</p>
          </article>
          <article>
            <span>02 / 连接</span>
            <h2>让真正需要的人找到它。</h2>
            <p>分类、搜索、收藏和价格排序帮助需求与物品更快匹配。</p>
          </article>
          <article>
            <span>03 / 再出发</span>
            <h2>在线规划，线下确认。</h2>
            <p>系统生成交接计划，但最终状态必须由双方当面核验。</p>
          </article>
        </div>
      </section>

      <section className="route-section story-cta">
        <div>
          <p className="eyebrow">MAKE THE NEXT ECHO</p>
          <h2>你也有一件正在等待的旧物吗？</h2>
        </div>
        <Link className="primary-action" to="/publish">开始发布</Link>
      </section>
    </main>
  )
}
