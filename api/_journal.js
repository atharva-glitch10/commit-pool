import { randomBytes, createHash } from 'node:crypto'
import { verifyMessage, isAddress } from 'viem'

const fail = (status, error) => ({ status, body: { error } })
const ok = (body) => ({ status: 200, body })
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const b64 = /^[A-Za-z0-9+/]+={0,2}$/
export function operationOf(op) {
  if (op?.action === 'list') return { action: 'list' }
  if (op?.action === 'delete' && uuid.test(op.id ?? '')) return { action: 'delete', id: op.id }
  const e = op?.entry
  if (op?.action === 'save' && e?.v === 1 && uuid.test(e.id ?? '') && typeof e.iv === 'string' && b64.test(e.iv) && Buffer.from(e.iv, 'base64').length === 12 && typeof e.ciphertext === 'string' && b64.test(e.ciphertext) && e.ciphertext.length >= 24 && e.ciphertext.length <= 24000) {
    return { action: 'save', entry: { v: 1, id: e.id, iv: e.iv, ciphertext: e.ciphertext } }
  }
  throw new Error('Invalid journal operation or encrypted entry.')
}
const digest = (op) => createHash('sha256').update(JSON.stringify(op)).digest('hex')
export function redisStore(env) {
  return async (...command) => {
    const res = await fetch(env.UPSTASH_REDIS_REST_URL, { method: 'POST', headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(command), signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error('Journal storage unavailable.')
    const body = await res.json()
    if (body.error) throw new Error('Journal storage unavailable.')
    return body.result
  }
}

// One-use wallet signatures bind every read/write/delete to the origin and exact encrypted payload.
export async function journal(body, env, origin, store = redisStore(env), now = Date.now()) {
  const configured = !!(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN && env.JOURNAL_ORIGIN)
  if (body?.action === 'status') return ok({ configured })
  if (!configured) return fail(503, 'Cloud journal is not configured. Your encrypted journal can still stay on this device.')
  if (origin !== env.JOURNAL_ORIGIN) return fail(403, 'Journal requests must come from the configured application origin.')
  if (!isAddress(body?.member ?? '')) return fail(400, 'A valid account address is required.')
  const member = body.member.toLowerCase()
  let operation
  try { operation = operationOf(body.operation) } catch (e) { return fail(400, e.message) }
  const hash = digest(operation)
  try {
    if (body.action === 'challenge') {
      const rateKey = `cp:journal:rate:${member}:${Math.floor(now / 60000)}`
      const rate = await store('INCR', rateKey)
      if (rate === 1) await store('EXPIRE', rateKey, 120)
      if (rate > 20) return fail(429, 'Too many journal requests. Try again in a minute.')
      const nonce = randomBytes(24).toString('hex')
      const expiresAt = now + 5 * 60000
      const message = `CommitPool encrypted journal\nOrigin: ${origin}\nAccount: ${member}\nAction: ${operation.action}\nPayload SHA-256: ${hash}\nNonce: ${nonce}\nExpires: ${new Date(expiresAt).toISOString()}\nThis signature does not authorize a payment.`
      await store('SET', `cp:journal:nonce:${nonce}`, JSON.stringify({ member, hash, message, expiresAt }), 'EX', 300)
      return ok({ nonce, message })
    }
    if (body.action !== 'execute' || !/^[0-9a-f]{48}$/.test(body.nonce ?? '') || typeof body.signature !== 'string') return fail(400, 'A journal challenge and signature are required.')
    const nonceKey = `cp:journal:nonce:${body.nonce}`
    const raw = await store('GET', nonceKey)
    if (!raw) return fail(401, 'Journal authorization expired or was already used. Please sign again.')
    const challenge = JSON.parse(raw)
    if (challenge.expiresAt <= now || challenge.member !== member || challenge.hash !== hash) return fail(401, 'Journal authorization does not match this request.')
    if (!await verifyMessage({ address: body.member, message: challenge.message, signature: body.signature }).catch(() => false)) return fail(401, 'Journal signature is invalid.')
    // Atomic consumption prevents two valid concurrent requests using the same authorization.
    if (await store('GETDEL', nonceKey) !== raw) return fail(401, 'Journal authorization was already used.')
    const key = `cp:journal:entries:${member}`
    if (operation.action === 'list') return ok({ entries: (await store('HVALS', key) ?? []).map(value => JSON.parse(value)) })
    if (operation.action === 'delete') { await store('HDEL', key, operation.id); return ok({ deleted: true }) }
    const result = await store('EVAL', "if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 0 and redis.call('HLEN', KEYS[1]) >= 100 then return 0 end redis.call('HSET', KEYS[1], ARGV[1], ARGV[2]) return 1", 1, key, operation.entry.id, JSON.stringify(operation.entry))
    if (!result) return fail(409, 'Journal is limited to 100 entries. Delete an old entry first.')
    return ok({ saved: true })
  } catch { return fail(503, 'Journal storage is unavailable. Please try again; your unsaved text is still on this page.') }
}
