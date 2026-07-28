import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createRefreshToken,
  hashPassword,
  hashRefreshSecret,
  normalizeUsername,
  parseRefreshToken,
  signAccessToken,
  validateUsername,
  verifyAccessToken,
  verifyPassword,
} from '../auth/core.js'

const secret = 'test-session-secret-with-at-least-32-characters'

test('password hashes use random salts and verify safely', async () => {
  const first = await hashPassword('correct horse battery staple')
  const second = await hashPassword('correct horse battery staple')
  assert.notEqual(first, second)
  assert.equal(await verifyPassword('correct horse battery staple', first), true)
  assert.equal(await verifyPassword('wrong password', first), false)
  assert.equal(await verifyPassword('anything', 'broken'), false)
})

test('usernames normalize consistently and reject unsafe characters', () => {
  assert.deepEqual(normalizeUsername('  Campus_01  '), { username: 'Campus_01', normalized: 'campus_01' })
  assert.equal(validateUsername('张同学').normalized, '张同学')
  assert.throws(() => validateUsername('a!'))
})

test('access JWT verifies claims and rejects tampering', async () => {
  const token = await signAccessToken({ id: 'user-1', username: 'campus' }, 'session-1', secret)
  const value = await verifyAccessToken(token, secret)
  assert.deepEqual(value.user, { id: 'user-1', username: 'campus' })
  assert.equal(value.sessionId, 'session-1')
  const [header, payload, signature] = token.split('.')
  const tamperedSignature =
    `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`
  await assert.rejects(() =>
    verifyAccessToken(
      `${header}.${payload}.${tamperedSignature}`,
      secret,
    ))
})

test('refresh tokens expose only a selector and hashable secret', async () => {
  const value = createRefreshToken('session-1')
  assert.deepEqual(parseRefreshToken(value.token), { sessionId: 'session-1', secret: value.secret })
  assert.equal(parseRefreshToken('invalid'), null)
  assert.equal(await hashRefreshSecret(value.secret), await hashRefreshSecret(value.secret))
})
