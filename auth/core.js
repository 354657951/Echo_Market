import { jwtVerify, SignJWT } from 'jose'

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60
export const JWT_ISSUER = 'echo-market'
export const JWT_AUDIENCE = 'echo-market-web'

// Sites 运行时的 Web Crypto 对单次 PBKDF2 最多支持 100000 次迭代。
// 哈希结果会记录实际迭代次数，验证函数仍可识别旧版哈希格式。
export const PASSWORD_ITERATIONS = 100_000
const textEncoder = new TextEncoder()

function toBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
}

export function safeEqual(left, right) {
  const leftBytes = textEncoder.encode(String(left))
  const rightBytes = textEncoder.encode(String(right))
  const length = Math.max(leftBytes.length, rightBytes.length)
  let difference = leftBytes.length ^ rightBytes.length
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0)
  }
  return difference === 0
}

export function normalizeUsername(value) {
  const username = String(value || '').normalize('NFKC').trim()
  return { username, normalized: username.toLocaleLowerCase('zh-CN') }
}

export function validateUsername(value) {
  const result = normalizeUsername(value)
  if (!/^[\p{L}\p{N}_-]{3,24}$/u.test(result.username)) {
    throw new Error('用户名需为 3 到 24 个字，只能包含文字、数字、下划线或连字符。')
  }
  return result
}

export function validatePassword(value) {
  const password = typeof value === 'string' ? value : ''
  if (password.length < 8 || password.length > 128) {
    throw new Error('密码长度需为 8 到 128 个字符。')
  }
  return password
}

function randomBytes(length) {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

async function derivePassword(password, salt, iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  )
  return new Uint8Array(bits)
}

export async function hashPassword(password) {
  const validated = validatePassword(password)
  const salt = randomBytes(16)
  const hash = await derivePassword(validated, salt)
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(hash)}`
}

export async function verifyPassword(password, encodedHash) {
  try {
    const [algorithm, rawIterations, rawSalt, rawHash, ...rest] = String(encodedHash).split('$')
    const iterations = Number(rawIterations)
    if (
      algorithm !== 'pbkdf2-sha256'
      || rest.length > 0
      || !Number.isInteger(iterations)
      || iterations < 100_000
      || iterations > 1_000_000
    ) return false
    const expected = fromBase64Url(rawHash)
    const actual = await derivePassword(String(password || ''), fromBase64Url(rawSalt), iterations)
    return safeEqual(toBase64Url(actual), toBase64Url(expected))
  } catch {
    return false
  }
}

export function validateSessionSecret(secret) {
  const value = String(secret || '')
  if (textEncoder.encode(value).length < 32) {
    throw new Error('APP_SESSION_SECRET 必须至少包含 32 个字符。')
  }
  return value
}

function jwtKey(secret) {
  return textEncoder.encode(validateSessionSecret(secret))
}

export async function signAccessToken(user, sessionId, secret, ttlSeconds = ACCESS_TOKEN_TTL_SECONDS) {
  return new SignJWT({ username: user.username, sid: sessionId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(jwtKey(secret))
}

export async function verifyAccessToken(token, secret) {
  const { payload } = await jwtVerify(token, jwtKey(secret), {
    algorithms: ['HS256'],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  })
  if (!payload.sub || typeof payload.username !== 'string' || typeof payload.sid !== 'string') {
    throw new Error('访问令牌缺少必要声明。')
  }
  return {
    user: { id: payload.sub, username: payload.username },
    sessionId: payload.sid,
    expiresAt: Number(payload.exp || 0) * 1000,
  }
}

export async function hashRefreshSecret(secret) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(secret))
  return toBase64Url(new Uint8Array(digest))
}

export function createRefreshToken(sessionId = crypto.randomUUID()) {
  const secret = toBase64Url(randomBytes(32))
  return { sessionId, secret, token: `${sessionId}.${secret}` }
}

export function parseRefreshToken(token) {
  const [sessionId, secret, ...rest] = String(token || '').split('.')
  if (!sessionId || !secret || rest.length > 0) return null
  return { sessionId, secret }
}
