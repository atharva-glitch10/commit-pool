// Tier 1: wake-up ring + challenge.
// The oracle picks a secret random "ring" moment inside the day's window (unknown in advance).
// From the ring, the member has a short time to fetch a puzzle, answer it, and sign the answer with
// their wallet. Stateless: the challenge token is HMAC-protected, and the answer is never in the token.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { keccak256, toBytes, verifyMessage } from 'viem'
import { checkInMessage } from './_tiers.js'

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty']

export const secretFromKey = (key) => keccak256(toBytes(`${key}:commitpool-challenge-v1`))
const hmac = (secret, data) => createHmac('sha256', secret).update(data).digest('base64url')
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const unb64 = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'))

/**
 * Ring schedule for (pool, member, day). Real pools (window ≥ 10 min): random moment, 120 s to respond.
 * Demo pools (short windows): rings when the window opens and stays open until it closes.
 */
export function ringSchedule(secret, poolId, member, day, windowStart, windowEnd) {
  const len = windowEnd - windowStart
  if (len < 600) return { ringAt: windowStart, respondBy: windowEnd }
  const ttl = 120
  const span = len - ttl - 60 // leave a minute to get the transaction in before the window closes
  const h = createHmac('sha256', secret).update(`ring:${poolId}:${member.toLowerCase()}:${day}`).digest()
  const offset = h.readUInt32BE(0) % Math.max(1, span)
  return { ringAt: windowStart + offset, respondBy: windowStart + offset + ttl }
}

export { checkInMessage }

export function issueChallenge(secret, { poolId, member, day, respondBy, now }) {
  const a = 2 + (randomBytes(1)[0] % 9), b = 2 + (randomBytes(1)[0] % 9)
  const nonce = randomBytes(3).toString('hex').toUpperCase()
  const payload = { p: String(poolId), m: member.toLowerCase(), d: day, n: nonce, exp: Math.min(respondBy, now + 180), am: hmac(secret, `${nonce}:${a + b}`) }
  const body = b64(payload)
  return { token: `${body}.${hmac(secret, body)}`, puzzle: `What is ${WORDS[a]} plus ${WORDS[b]}?`, nonce, expiresAt: payload.exp }
}

/** @returns {Promise<{ ok: true } | { ok: false, reason: string }>} */
export async function verifyChallenge(secret, { token, answer, walletSig }, { poolId, member, day, now }) {
  if (typeof token !== 'string' || !token.includes('.')) return { ok: false, reason: 'Missing challenge. Tap “I’m awake” to get one.' }
  const [body, mac] = token.split('.')
  const expect = hmac(secret, body)
  if (mac.length !== expect.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return { ok: false, reason: 'Challenge was tampered with.' }
  let c
  try { c = unb64(body) } catch { return { ok: false, reason: 'Bad challenge.' } }
  if (c.p !== String(poolId) || c.m !== member.toLowerCase() || c.d !== day) return { ok: false, reason: 'This challenge belongs to a different pool, member or day.' }
  if (now > c.exp) return { ok: false, reason: 'Too slow: the challenge expired. Get a new one if the window is still open.' }
  const ans = String(answer ?? '').trim()
  if (!/^\d{1,3}$/.test(ans) || hmac(secret, `${c.n}:${Number(ans)}`) !== c.am) return { ok: false, reason: 'Wrong answer.' }
  const ok = await verifyMessage({ address: member, message: checkInMessage({ poolId, day, nonce: c.n, answer: Number(ans) }), signature: walletSig }).catch(() => false)
  if (!ok) return { ok: false, reason: 'The answer must be signed by the member’s own wallet.' }
  return { ok: true }
}
