import test from 'node:test'
import assert from 'node:assert/strict'
import { journalKey, openEntry, sealEntry } from './journalCrypto.ts'

const owner = `0x${'1'.repeat(40)}`, origin = 'https://commitpool.test'
const text = { text: 'My private motivation 🌱', poolId: '12', createdAt: '2026-10-12', updatedAt: '2026-10-12' }
test('journal survives reload with the same key material; PRF bytes are wiped and CryptoKey is not exportable', async () => {
  const prf = new Uint8Array(32).fill(7)
  const key = await journalKey(prf)
  assert.ok(prf.every(n => n === 0))
  assert.equal(key.extractable, false)
  const sealed = await sealEntry(key, owner, text, undefined, origin)
  assert.doesNotMatch(JSON.stringify(sealed), /motivation/)
  const recovered = await journalKey(new Uint8Array(32).fill(7))
  assert.deepEqual(await openEntry(recovered, owner, sealed, origin), text)
})
test('wrong key, changed owner, changed origin, changed entry id, and ciphertext tampering fail authentication', async () => {
  const key = await journalKey(new Uint8Array(32).fill(7)), wrong = await journalKey(new Uint8Array(32).fill(8))
  const sealed = await sealEntry(key, owner, text, undefined, origin)
  await assert.rejects(openEntry(wrong, owner, sealed, origin))
  await assert.rejects(openEntry(key, `0x${'2'.repeat(40)}`, sealed, origin))
  await assert.rejects(openEntry(key, owner, sealed, 'https://other.test'))
  await assert.rejects(openEntry(key, owner, { ...sealed, id: crypto.randomUUID() }, origin))
  const changed = Buffer.from(sealed.ciphertext, 'base64'); changed[0] ^= 1
  await assert.rejects(openEntry(key, owner, { ...sealed, ciphertext: changed.toString('base64') }, origin))
})
test('editing an entry uses a fresh encryption nonce', async () => {
  const key = await journalKey(new Uint8Array(32).fill(7))
  const a = await sealEntry(key, owner, text, undefined, origin), b = await sealEntry(key, owner, text, a.id, origin)
  assert.notEqual(a.iv, b.iv); assert.notEqual(a.ciphertext, b.ciphertext)
})
