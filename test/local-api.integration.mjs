import assert from 'node:assert/strict'

const baseUrl = process.env.API_BASE_URL
if (!baseUrl) throw new Error('API_BASE_URL is required')

function createClient() {
  const cookies = new Map()
  return {
    cookies,
    async request(path, init = {}) {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          Origin: baseUrl,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(cookies.size ? { Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') } : {}),
          ...init.headers,
        },
      })
      const setCookies = response.headers.getSetCookie?.() || [response.headers.get('set-cookie')].filter(Boolean)
      for (const header of setCookies.flatMap((value) => value.split(/,(?=\s*[^;,]+=)/))) {
        const [pair] = header.trim().split(';')
        const separator = pair.indexOf('=')
        const name = pair.slice(0, separator)
        const value = pair.slice(separator + 1)
        if (value) cookies.set(name, value)
        else cookies.delete(name)
      }
      return { response, body: await response.json().catch(() => ({})) }
    },
  }
}

const suffix = Date.now().toString(36)
const alice = createClient()
const bob = createClient()

let result = await alice.request('/api/auth/register', {
  method: 'POST',
  body: JSON.stringify({ username: `alice_${suffix}`, password: 'password-alice', inviteCode: 'wrong' }),
})
assert.equal(result.response.status, 403)

result = await alice.request('/api/auth/register', {
  method: 'POST',
  body: JSON.stringify({ username: `alice_${suffix}`, password: 'password-alice', inviteCode: 'integration-invite' }),
})
assert.equal(result.response.status, 201)
assert.equal(result.body.authenticated, true)

result = await bob.request('/api/auth/register', {
  method: 'POST',
  body: JSON.stringify({ username: `bob_${suffix}`, password: 'password-bob', inviteCode: 'integration-invite' }),
})
assert.equal(result.response.status, 201)

result = await alice.request('/api/products', {
  method: 'POST',
  body: JSON.stringify({
    title: '隔离测试商品',
    description: '仅用于本地鉴权集成测试',
    category: '生活',
    condition: '九成新',
    price: 10,
    tags: [],
    flaws: '右下角有轻微划痕',
    accessories: '充电线',
    tradeNote: '当面验货',
  }),
})
assert.equal(result.response.status, 201)
assert.equal(result.body.product.flaws, '右下角有轻微划痕')
assert.equal(result.body.product.accessories, '充电线')
assert.equal(result.body.product.tradeNote, '当面验货')
const productId = result.body.product.id

result = await alice.request(`/api/favorites/${productId}`, { method: 'PUT', body: JSON.stringify({ favorite: true }) })
assert.equal(result.response.status, 200)
result = await bob.request('/api/store')
assert.equal(result.response.status, 200)
assert.equal(result.body.store.favorites.includes(productId), false)
const sharedProduct = result.body.store.products.find(
  (product) => product.id === productId,
)
assert.equal(Boolean(sharedProduct), true)
assert.equal(sharedProduct.flaws, '右下角有轻微划痕')
assert.equal(sharedProduct.accessories, '充电线')
assert.equal(sharedProduct.tradeNote, '当面验货')

result = await bob.request(`/api/products/${productId}`, { method: 'DELETE' })
assert.equal(result.response.status, 403)
result = await alice.request(`/api/products/${productId}`, { method: 'DELETE' })
assert.equal(result.response.status, 200)

const oldRefresh = alice.cookies.get('echo_market_refresh')
result = await alice.request('/api/auth/refresh', { method: 'POST' })
assert.equal(result.response.status, 200)
assert.notEqual(alice.cookies.get('echo_market_refresh'), oldRefresh)

result = await bob.request('/api/auth/logout', { method: 'POST' })
assert.equal(result.response.status, 200)
result = await bob.request('/api/store')
assert.equal(result.response.status, 401)

result = await bob.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: `bob_${suffix}`, password: 'password-bob' }) })
assert.equal(result.response.status, 200)
console.log('local auth integration passed')
