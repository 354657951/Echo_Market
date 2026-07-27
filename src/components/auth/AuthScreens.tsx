import { useState, type FormEvent } from 'react'
import { HERO_VIDEO_URL } from '../../config/media'

export function LoginScreen({ onSignedIn }: { onSignedIn: (username: string) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('使用项目账号进入校园旧物循环站。')
  const [submitting, setSubmitting] = useState(false)

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    // 账号密码只发送到同源服务端，前端不保存明文密码。
    event.preventDefault()
    setSubmitting(true)
    setMessage('正在验证账号…')
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || '登录失败，请重试。')
      onSignedIn(String(payload.user))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '登录失败，请重试。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-shell">
      <video aria-hidden="true" autoPlay className="auth-video" loop muted playsInline src={HERO_VIDEO_URL} />
      <div className="auth-brand">
        <strong>回声集</strong>
        <span>AI 校园旧物循环站</span>
      </div>
      <section className="liquid-glass auth-panel" aria-labelledby="login-title">
        <p className="auth-eyebrow">WELCOME BACK / 2026</p>
        <h1 id="login-title">让旧物继续流动。</h1>
        <p className="auth-intro">登录后浏览、收藏和发布校园闲置物品。</p>
        <form className="auth-form" onSubmit={handleLogin}>
          <label htmlFor="login-username">账号</label>
          <input
            autoComplete="username"
            id="login-username"
            onChange={(event) => setUsername(event.target.value)}
            placeholder="请输入账号"
            required
            value={username}
          />
          <label htmlFor="login-password">密码</label>
          <input
            autoComplete="current-password"
            id="login-password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="请输入密码"
            required
            type="password"
            value={password}
          />
          <button disabled={submitting} type="submit">
            {submitting ? '登录中…' : '登录进入'}
          </button>
        </form>
        <p className="auth-message" role="status">{message}</p>
      </section>
      <p className="auth-footnote">记录 · 流转 · 再出发</p>
    </main>
  )
}

export function AuthChecking() {
  return (
    <main className="auth-shell auth-checking">
      <video aria-hidden="true" autoPlay className="auth-video" loop muted playsInline src={HERO_VIDEO_URL} />
      <div className="liquid-glass auth-loader" role="status">
        <strong>回声集</strong>
        <span>正在确认登录状态</span>
      </div>
    </main>
  )
}
