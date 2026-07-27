/**
 * GitHub Pages 只能托管静态文件，因此单独提供不依赖服务端的演示模式。
 * 完整版继续使用原有登录、会话和 AI 接口，两种构建互不影响。
 */
export const IS_GITHUB_PAGES_DEMO = import.meta.env.MODE === 'github-pages'

export const FULL_SITE_URL = 'https://echo-market-campus.ldwmrbcilqkbv.chatgpt.site'

/**
 * 为 public 目录资源补上当前部署基路径。
 * 本地与完整版基路径为 `/`，GitHub Pages 则为 `/Echo_Market/`。
 */
export function withBase(path: string) {
  const normalizedPath = path.replace(/^\/+/, '')
  return `${import.meta.env.BASE_URL}${normalizedPath}`
}
