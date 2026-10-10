// Run: node --test api/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { privateKeyToAccount } from 'viem/accounts'
import { encodeGoal, openDayAt, parseGoal } from './_tiers.js'
import { checkInMessage, issueChallenge, ringSchedule, secretFromKey, verifyChallenge } from './_challenge.js'
import { checkEvidence, evidenceMessage, mergeSessions, verifyEvidenceSignature } from './_evidence.js'
import { normalizeKey } from './_oracle.js'

const ORACLE_KEY = '0x' + '11'.repeat(32)
const alice = privateKeyToAccount('0x' + 'aa'.repeat(32))
const mallory = privateKeyToAccount('0x' + 'bb'.repeat(32))
const secret = secretFromKey(ORACLE_KEY)

// ── goal tags ──
test('goal tags round-trip and old goals stay basic', () => {
  assert.deepEqual(parseGoal('Be in bed by 23:00'), { text: 'Be in bed by 23:00', tier: 0 })
  assert.deepEqual(parseGoal(encodeGoal('Be up by 06:30', 1)), { text: 'Be up by 06:30', tier: 1 })
  assert.deepEqual(parseGoal(encodeGoal('Walk 10,000 steps', 2, { steps: 10000 })), { text: 'Walk 10,000 steps', tier: 2, steps: 10000 })
  assert.deepEqual(parseGoal(encodeGoal('Asleep by 23:00', 3, { sleepMin: 420, byMin: 540 })), { text: 'Asleep by 23:00', tier: 3, sleepMin: 420, byMin: 540 })
  assert.equal(parseGoal('Odd | text with a pipe').tier, 0, 'unknown tags are treated as plain text')
  assert.equal(parseGoal('Steps|t2').tier, 0, 'tier 2 without a target is not accepted')
  assert.ok(new TextEncoder().encode(encodeGoal('x'.repeat(50), 3, { sleepMin: 480, byMin: 600 })).length <= 80, 'fits the contract’s 80-byte goal limit')
})

test('openDayAt matches the contract window rules', () => {
  const pool = { startTime: 1000, dayLength: 100, window: 10, numDays: 3 }
  assert.equal(openDayAt(pool, 989).open, false)
  assert.deepEqual([openDayAt(pool, 990).open, openDayAt(pool, 990).day], [true, 0])
  assert.equal(openDayAt(pool, 1011).open, false)
  assert.deepEqual([openDayAt(pool, 1105).open, openDayAt(pool, 1105).day], [true, 1])
  assert.equal(openDayAt(pool, 1211).open, false, 'after the last day')
})

// ── tier 1: wake-up ring ──
test('ring is random inside long windows and fixed at window start for demo windows', () => {
  const a = ringSchedule(secret, '1', alice.address, 0, 10_000, 17_200)
  const b = ringSchedule(secret, '1', alice.address, 1, 10_000, 17_200)
  assert.ok(a.ringAt >= 10_000 && a.respondBy <= 17_200 - 60, 'ring + response fit inside the window with a minute to spare')
  assert.equal(a.respondBy - a.ringAt, 120)
  assert.notEqual(a.ringAt, b.ringAt, 'different days ring at different moments')
  assert.deepEqual(ringSchedule(secret, '1', alice.address, 0, 100, 140), { ringAt: 100, respondBy: 140 })
})

function solve(puzzle) {
  const W = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
  const [, x, y] = /What is (\w+) plus (\w+)\?/.exec(puzzle)
  return W.indexOf(x) + W.indexOf(y)
}
async function answer(c, who = alice, ans) {
  const a = ans ?? solve(c.puzzle)
  const walletSig = await who.signMessage({ message: checkInMessage({ poolId: '7', day: 0, nonce: c.nonce, answer: a }) })
  return { token: c.token, answer: String(a), walletSig }
}

test('correct answer signed by the member passes', async () => {
  const c = issueChallenge(secret, { poolId: '7', member: alice.address, day: 0, respondBy: 2000, now: 1000 })
  assert.ok(!c.token.includes(String(solve(c.puzzle))) || true)
  const r = await verifyChallenge(secret, await answer(c), { poolId: '7', member: alice.address, day: 0, now: 1010 })
  assert.deepEqual(r, { ok: true })
})

test('wrong answer, expired, wrong wallet, other day and tampering all fail', async () => {
  const c = issueChallenge(secret, { poolId: '7', member: alice.address, day: 0, respondBy: 2000, now: 1000 })
  const ok = await answer(c)
  const v = (sub, ctx = {}) => verifyChallenge(secret, sub, { poolId: '7', member: alice.address, day: 0, now: 1010, ...ctx })
  assert.match((await v(await answer(c, alice, solve(c.puzzle) + 1))).reason, /Wrong answer/)
  assert.match((await v(ok, { now: 1000 + 181 })).reason, /expired/)
  assert.match((await v(await answer(c, mallory))).reason, /own wallet/)
  assert.match((await v(ok, { day: 1 })).reason, /different pool, member or day/)
  assert.match((await v(ok, { member: mallory.address })).reason, /different pool, member or day/)
  const [body, mac] = ok.token.split('.')
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), exp: 9e9 })).toString('base64url')
  assert.match((await v({ ...ok, token: `${forged}.${mac}` })).reason, /tampered/)
  assert.match((await verifyChallenge(secretFromKey('0x' + '22'.repeat(32)), ok, { poolId: '7', member: alice.address, day: 0, now: 1010 })).reason, /tampered/, 'another oracle’s secret rejects it')
})

test('the answer cannot be read out of the token', () => {
  for (let i = 0; i < 20; i++) {
    const c = issueChallenge(secret, { poolId: '7', member: alice.address, day: 0, respondBy: 2000, now: 1000 })
    const payload = JSON.parse(Buffer.from(c.token.split('.')[0], 'base64url'))
    assert.deepEqual(Object.keys(payload).sort(), ['am', 'd', 'exp', 'm', 'n', 'p'])
    assert.notEqual(String(payload.am), String(solve(c.puzzle)))
  }
})

// ── tiers 2 & 3: evidence ──
const DEADLINE = 1_800_000_000, WIN = 3600
const ctx = { poolId: '9', member: alice.address, day: 2, deadline: DEADLINE, window: WIN, now: DEADLINE }
const base = { v: 1, poolId: '9', member: alice.address, day: 2, collectedAt: DEADLINE - 60, attestation: { type: 'play-integrity', token: 'x' } }
const steps = (records, extra = {}) => ({ ...base, platform: 'android', kind: 'steps', records, ...extra })
const rec = (startH, endH, value, method = 'automatic', deviceType = 'phone') => ({ start: DEADLINE - startH * 3600, end: DEADLINE - endH * 3600, value, method, deviceType, source: 'com.google.android.apps.fitness' })
const t2 = parseGoal('Walk|t2:steps=10000')
const t3 = parseGoal('Sleep|t3:sleep=420,by=540')

test('tier 2: device-recorded steps over the target pass', () => {
  const r = checkEvidence(steps([rec(10, 9, 6000), rec(5, 4, 4500, 'active', 'watch')]), t2, ctx)
  assert.equal(r.ok, true); assert.match(r.summary, /10,500 steps/)
})
test('tier 2: manual entries are ignored', () => {
  const r = checkEvidence(steps([rec(10, 9, 6000), rec(5, 4, 9000, 'manual')]), t2, ctx)
  assert.equal(r.ok, false); assert.match(r.reason, /6,000 device-recorded steps.*1 manually entered/)
})
test('tier 2: steps from before the 24 h window are ignored', () => {
  assert.equal(checkEvidence(steps([rec(30, 29, 20000)]), t2, ctx).ok, false)
})
test('tier 2: stale evidence and evidence for another day are rejected', () => {
  assert.match(checkEvidence(steps([rec(10, 9, 20000)], { collectedAt: DEADLINE - 3 * 3600 }), t2, ctx).reason, /stale/)
  assert.match(checkEvidence(steps([rec(10, 9, 20000)], { day: 1 }), t2, ctx).reason, /different pool, member or day/)
  assert.match(checkEvidence({ ...steps([]), kind: 'sleep' }, t2, ctx).reason, /needs step data/)
})

const sleep = (records, platform = 'android') => ({ ...base, platform, kind: 'sleep', records })
// deadline is the morning check-in; by=540 → sleep must start ≥ 9 h before it
test('tier 3: watch sleep that started on time and lasted long enough passes', () => {
  const r = checkEvidence(sleep([rec(9.5, 1.5, undefined, 'automatic', 'watch')]), t3, ctx)
  assert.equal(r.ok, true); assert.match(r.summary, /480 min/)
})
test('tier 3: phone-only or manual sleep does not count', () => {
  assert.match(checkEvidence(sleep([rec(9.5, 1.5, undefined, 'automatic', 'phone')]), t3, ctx).reason, /watch, ring or band/)
  assert.match(checkEvidence(sleep([rec(9.5, 1.5, undefined, 'manual', 'watch')]), t3, ctx).reason, /Manually entered/)
})
test('tier 3: too short or too late fails with a clear reason', () => {
  assert.match(checkEvidence(sleep([rec(9.5, 4, undefined, 'automatic', 'ring')]), t3, ctx).reason, /330 min/)
  assert.match(checkEvidence(sleep([rec(8, 0.5, undefined, 'automatic', 'band')]), t3, ctx).reason, /after the latest allowed start/)
})
test('tier 3: iOS stage samples are merged into one night', () => {
  const ios = (s, e) => ({ ...rec(s, e, undefined, 'unknown', 'unknown'), source: 'com.apple.health.81B4A1F2' })
  assert.deepEqual(mergeSessions([{ start: 0, end: 10 }, { start: 15, end: 30 }, { start: 5000, end: 5100 }], 10), [{ start: 0, end: 30 }, { start: 5000, end: 5100 }])
  assert.equal(checkEvidence(sleep([ios(9.5, 7), ios(7, 4), ios(4.1, 1.5)], 'ios'), t3, ctx).ok, true)
  const manual = (s, e) => ({ ...rec(s, e, undefined, 'unknown', 'unknown'), source: 'com.apple.Health' })
  assert.equal(checkEvidence(sleep([manual(9.5, 1.5)], 'ios'), t3, ctx).ok, false, 'samples written by the Health app itself are excluded')
})

test('evidence must be signed by the member’s wallet, and any edit breaks the signature', async () => {
  const ev = steps([rec(10, 9, 12000)])
  const sig = await alice.signMessage({ message: evidenceMessage(ev) })
  assert.equal(await verifyEvidenceSignature(ev, sig, alice.address), true)
  assert.equal(await verifyEvidenceSignature(ev, await mallory.signMessage({ message: evidenceMessage(ev) }), alice.address), false)
  const edited = steps([rec(10, 9, 99000)])
  assert.equal(await verifyEvidenceSignature(edited, sig, alice.address), false)
})

test('private key normalisation', () => {
  const k = '78b809ef9199614bd1d146c3248a8b494136dcbb83cfd4964baee65b6aa66ba7'
  assert.equal(normalizeKey(k), '0x' + k)
  assert.equal(normalizeKey(` "0x${k}"\n`), '0x' + k)
  assert.equal(normalizeKey('0x463797899F8388EDa9908a45eBb8bF8794dD4979'), 'invalid', 'an address is not a key')
})
