import { useState, type FormEvent } from 'react'
import { login, register, type AuthUser } from '../../api/authClient'
import { HERO_VIDEO_URL } from '../../config/media'

type Mode = 'login' | 'register'

export function LoginScreen({ onSignedIn, sessionExpired = false }: { onSignedIn: (user: AuthUser) => void; sessionExpired?: boolean }) {
  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [message, setMessage] = useState(sessionExpired ? '登录已过期，请重新登录。' : '使用项目账号进入校园旧物循环站。')
  const [submitting, setSubmitting] = useState(false)

  function switchMode(next: Mode) {
    setMode(next)
    setMessage(next === 'login' ? '使用已有账号登录。' : '使用邀请码创建你的校园账号。')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (mode === 'register' && password !== confirmPassword) {
      setMessage('两次输入的密码不一致。')
      return
    }
    setSubmitting(true)
    setMessage(mode === 'login' ? '正在验证账号…' : '正在创建账号…')
    try {
      const user = mode === 'login'
        ? await login(username, password)
        : await register(username, password, inviteCode)
      onSignedIn(user)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '认证失败，请重试。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-shell">
      <video aria-hidden="true" autoPlay className="auth-video" loop muted playsInline src={HERO_VIDEO_URL} />
      <div className="auth-brand"><strong>回声集</strong><span>AI 校园旧物循环站</span></div>
      <section className="liquid-glass auth-panel" aria-labelledby="login-title">
        <p className="auth-eyebrow">WELCOME BACK / 2026</p>
        <h1 id="login-title">让旧物继续流动。</h1>
        <p className="auth-intro">登录后浏览、收藏和发布校园闲置物品。</p>
        <div className="auth-mode-switch" role="tablist" aria-label="账号入口">
          <button aria-selected={mode === 'login'} className={mode === 'login' ? 'is-active' : ''} onClick={() => switchMode('login')} role="tab" type="button">登录</button>
          <button aria-selected={mode === 'register'} className={mode === 'register' ? 'is-active' : ''} onClick={() => switchMode('register')} role="tab" type="button">注册</button>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="login-username">用户名</label>
          <input autoComplete="username" id="login-username" onChange={(event) => setUsername(event.target.value)} placeholder="3-24 个字符" required value={username} />
          <label htmlFor="login-password">密码</label>
          <input autoComplete={mode === 'login' ? 'current-password' : 'new-password'} id="login-password" minLength={8} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 个字符" required type="password" value={password} />
          {mode === 'register' && <>
            <label htmlFor="register-confirm">确认密码</label>
            <input autoComplete="new-password" id="register-confirm" minLength={8} onChange={(event) => setConfirmPassword(event.target.value)} required type="password" value={confirmPassword} />
            <label htmlFor="register-invite">邀请码</label>
            <input autoComplete="off" id="register-invite" onChange={(event) => setInviteCode(event.target.value)} required value={inviteCode} />
          </>}
          <button disabled={submitting} type="submit">{submitting ? '请稍候…' : mode === 'login' ? '登录进入' : '注册并进入'}</button>
        </form>
        <p className="auth-message" role="status">{message}</p>
      </section>
      <p className="auth-footnote">记录 · 流转 · 再出发</p>
    </main>
  )
}

export function AuthChecking() {
  return <main className="auth-shell auth-checking"><video aria-hidden="true" autoPlay className="auth-video" loop muted playsInline src={HERO_VIDEO_URL} /><div className="liquid-glass auth-loader" role="status"><strong>回声集</strong><span>正在确认登录状态</span></div></main>
}
