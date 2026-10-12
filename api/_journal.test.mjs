import test from 'node:test'
import assert from 'node:assert/strict'
import { privateKeyToAccount } from 'viem/accounts'
import { journal } from './_journal.js'

const alice = privateKeyToAccount(`0x${'1'.repeat(64)}`)
const bob = privateKeyToAccount(`0x${'2'.repeat(64)}`)
const env = { UPSTASH_REDIS_REST_URL: 'https://example.test', UPSTASH_REDIS_REST_TOKEN: 'test', JOURNAL_ORIGIN: 'https://commitpool.test' }
const origin = env.JOURNAL_ORIGIN
const entry = { v: 1, id: '12345678-1234-4123-8123-123456789abc', iv: Buffer.alloc(12, 7).toString('base64'), ciphertext: Buffer.alloc(48, 8).toString('base64') }
function memory() {
  const strings = new Map(), hashes = new Map()
  return async (command, ...args) => {
    const [key, value] = args
    if (command === 'SET') { strings.set(key, value); return 'OK' }
    if (command === 'GET') return strings.get(key) ?? null
    if (command === 'GETDEL') { const result = strings.get(key) ?? null; strings.delete(key); return result }
    if (command === 'INCR') { const result = Number(strings.get(key) ?? 0) + 1; strings.set(key, result); return result }
    if (command === 'EXPIRE') return 1
    if (command === 'HVALS') return [...(hashes.get(key) ?? new Map()).values()]
    if (command === 'HDEL') return hashes.get(key)?.delete(value) ? 1 : 0
    if (command === 'EVAL') { const [, , hashKey, field, data] = args; const hash = hashes.get(hashKey) ?? new Map(); if (!hash.has(field) && hash.size >= 100) return 0; hash.set(field, data); hashes.set(hashKey, hash); return 1 }
    throw new Error(command)
  }
}
async function authorized(store, operation, signer = alice, now = 1000) {
  const challenge = await journal({ action: 'challenge', member: signer.address, operation }, env, origin, store, now)
  assert.equal(challenge.status, 200)
  return { action: 'execute', member: signer.address, operation, nonce: challenge.body.nonce, signature: await signer.signMessage({ message: challenge.body.message }) }
}
test('encrypted save/list/delete works and accounts cannot read each other’s entries', async () => {
  const store = memory()
  assert.equal((await journal(await authorized(store, { action: 'save', entry }), env, origin, store, 1001)).status, 200)
  const own = await journal(await authorized(store, { action: 'list' }), env, origin, store, 1001)
  assert.deepEqual(own.body.entries, [entry])
  const other = await journal(await authorized(store, { action: 'list' }, bob), env, origin, store, 1001)
  assert.deepEqual(other.body.entries, [])
  await journal(await authorized(store, { action: 'delete', id: entry.id }), env, origin, store, 1001)
  assert.deepEqual((await journal(await authorized(store, { action: 'list' }), env, origin, store, 1001)).body.entries, [])
})
test('signed journal requests reject replay, action changes and ciphertext substitution', async () => {
  const store = memory(), request = await authorized(store, { action: 'save', entry })
  assert.equal((await journal({ ...request, operation: { action: 'delete', id: entry.id } }, env, origin, store, 1001)).status, 401)
  assert.equal((await journal({ ...request, operation: { action: 'save', entry: { ...entry, ciphertext: Buffer.alloc(48, 9).toString('base64') } } }, env, origin, store, 1001)).status, 401)
  assert.equal((await journal(request, env, origin, store, 1001)).status, 200)
  assert.equal((await journal(request, env, origin, store, 1001)).status, 401)
})
test('concurrent requests can consume an authorization only once', async () => {
  const store = memory(), request = await authorized(store, { action: 'save', entry })
  const results = await Promise.all([journal(request, env, origin, store, 1001), journal(request, env, origin, store, 1001)])
  assert.deepEqual(results.map(r => r.status).sort(), [200, 401])
})
test('wrong wallet, expired authorization, and wrong or missing origin fail', async () => {
  const store = memory(), request = await authorized(store, { action: 'list' })
  assert.equal((await journal({ ...request, signature: await bob.signMessage({ message: 'forged' }) }, env, origin, store, 1001)).status, 401)
  assert.equal((await journal({ ...request, member: bob.address }, env, origin, store, 1001)).status, 401)
  assert.equal((await journal(request, env, origin, store, 301000)).status, 401)
  assert.equal((await journal(request, env, 'https://evil.test', store)).status, 403)
  assert.equal((await journal(request, env, undefined, store)).status, 403)
})
test('unconfigured storage is explicit and malformed envelopes are refused', async () => {
  assert.deepEqual((await journal({ action: 'status' }, {}, origin)).body, { configured: false })
  assert.equal((await journal({ action: 'challenge' }, {}, origin)).status, 503)
  const store = memory()
  for (const bad of [{ ...entry, iv: 'short' }, { ...entry, id: '../../other-user' }, { ...entry, ciphertext: 'plaintext' }]) {
    assert.equal((await journal({ action: 'challenge', member: alice.address, operation: { action: 'save', entry: bad } }, env, origin, store)).status, 400)
  }
})
test('challenge requests are rate-limited and provider errors do not leak secrets', async () => {
  const store = memory()
  for (let i = 0; i < 20; i++) assert.equal((await journal({ action: 'challenge', member: alice.address, operation: { action: 'list' } }, env, origin, store, 1000)).status, 200)
  assert.equal((await journal({ action: 'challenge', member: alice.address, operation: { action: 'list' } }, env, origin, store, 1000)).status, 429)
  const result = await journal({ action: 'challenge', member: alice.address, operation: { action: 'list' } }, env, origin, async () => { throw new Error('secret-token') })
  assert.equal(result.status, 503); assert.doesNotMatch(JSON.stringify(result), /secret-token/)
})
