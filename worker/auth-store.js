import { hashPassword, normalizeUsername, verifyPassword } from '../auth/core.js'

export const LEGACY_USER_ID = 'legacy-campus'
const statements = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY NOT NULL, username TEXT NOT NULL, username_normalized TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS refresh_sessions (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS refresh_sessions_user_id_idx ON refresh_sessions(user_id)`,
]

export async function ensureAuthStore(env) {
  if (!env.DB) throw new Error('多用户登录要求绑定 D1 数据库。')
  await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)))
  return env.DB
}

export async function ensureLegacyUser(env) {
  const db = await ensureAuthStore(env)
  if (!env.APP_USERNAME || !env.APP_PASSWORD) return null
  const { username, normalized } = normalizeUsername(env.APP_USERNAME)
  const existing = await db.prepare('SELECT * FROM users WHERE id = ?').bind(LEGACY_USER_ID).first()
  // 旧管理员密码未变化时复用现有哈希，避免每次登录重复进行高成本 PBKDF2。
  if (
    existing
    && existing.username === username
    && existing.username_normalized === normalized
    && await verifyPassword(env.APP_PASSWORD, existing.password_hash)
  ) {
    return {
      id: LEGACY_USER_ID,
      username: existing.username,
      passwordHash: existing.password_hash,
    }
  }

  const passwordHash = await hashPassword(env.APP_PASSWORD)
  const now = new Date().toISOString()
  if (existing) {
    await db.prepare('UPDATE users SET username = ?, username_normalized = ?, password_hash = ?, updated_at = ? WHERE id = ?').bind(username, normalized, passwordHash, now, LEGACY_USER_ID).run()
  } else {
    await db.prepare('INSERT INTO users (id, username, username_normalized, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(LEGACY_USER_ID, username, normalized, passwordHash, now, now).run()
  }
  return { id: LEGACY_USER_ID, username, passwordHash }
}

export async function findUserByNormalized(env, normalized) {
  return (await ensureAuthStore(env)).prepare('SELECT id, username, password_hash AS passwordHash FROM users WHERE username_normalized = ?').bind(normalized).first()
}

export async function createUser(env, { username, normalized, passwordHash }) {
  const db = await ensureAuthStore(env)
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  try {
    await db.prepare('INSERT INTO users (id, username, username_normalized, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, username, normalized, passwordHash, now, now).run()
    return { id, username }
  } catch (error) {
    if (String(error).toLowerCase().includes('unique')) return null
    throw error
  }
}

export async function createRefreshSession(env, session) {
  const db = await ensureAuthStore(env)
  await db.prepare('INSERT INTO refresh_sessions (id, user_id, token_hash, expires_at, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)').bind(session.id, session.userId, session.tokenHash, session.expiresAt, session.createdAt, session.lastUsedAt).run()
}

export async function getRefreshSession(env, id) {
  return (await ensureAuthStore(env)).prepare('SELECT id, user_id AS userId, token_hash AS tokenHash, expires_at AS expiresAt FROM refresh_sessions WHERE id = ?').bind(id).first()
}

export async function getSessionUser(env, id) {
  return (await ensureAuthStore(env)).prepare('SELECT u.id, u.username FROM refresh_sessions s INNER JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?').bind(id, Date.now()).first()
}

export async function rotateRefreshSession(env, id, expectedHash, tokenHash) {
  const result = await (await ensureAuthStore(env)).prepare('UPDATE refresh_sessions SET token_hash = ?, last_used_at = ? WHERE id = ? AND token_hash = ? AND expires_at > ?').bind(tokenHash, new Date().toISOString(), id, expectedHash, Date.now()).run()
  return Number(result.meta?.changes || 0) > 0
}

export async function deleteRefreshSession(env, id) {
  await (await ensureAuthStore(env)).prepare('DELETE FROM refresh_sessions WHERE id = ?').bind(id).run()
}
