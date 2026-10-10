// node --experimental-strip-types --test companion/src/evidence.test.ts   (run from the repo root)
// Converts realistic Health Connect / HealthKit records and runs them through the REAL oracle rules.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { base64url, buildEvidence, fromHealthConnect, fromHealthKitSleep, fromHealthKitSteps, parseSyncUrl, returnLink, type HcSleep, type HcSteps } from './evidence.ts'
// @ts-ignore plain JS oracle modules
import { checkEvidence, canonical } from '../../api/_evidence.js'
// @ts-ignore
import { parseGoal } from '../../api/_tiers.js'

const MEMBER = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
const DEADLINE = 1_800_000_000 // check-in deadline (unix s)
const iso = (h: number) => new Date((DEADLINE - h * 3600) * 1000).toISOString()
const req = { pool: '12', day: 3, member: MEMBER, kind: 'steps' as const, returnUrl: 'https://app.example/#/pool/12' }
const ctx = { poolId: '12', member: MEMBER, day: 3, deadline: DEADLINE, window: 3600, now: DEADLINE }

test('parses the deep link the website shows', () => {
  const back = encodeURIComponent('https://commit-pool-wutn.vercel.app/#/pool/12')
  assert.deepEqual(parseSyncUrl(`commitpool://sync?pool=12&day=3&member=${MEMBER}&kind=steps&return=${back}`),
    { pool: '12', day: 3, member: MEMBER, kind: 'steps', returnUrl: 'https://commit-pool-wutn.vercel.app/#/pool/12' })
  assert.equal(parseSyncUrl('commitpool://sync?pool=12&day=3&member=bad&kind=steps&return=x'), null)
})

test('Health Connect steps → evidence the oracle accepts (manual entries ignored)', () => {
  const hc: HcSteps[] = [
    { startTime: iso(10), endTime: iso(9), count: 7000, metadata: { dataOrigin: 'com.google.android.apps.fitness', recordingMethod: 2, device: { type: 2 } } },
    { startTime: iso(4), endTime: iso(3), count: 3500, metadata: { dataOrigin: 'com.fitbit.FitbitMobile', recordingMethod: 2, device: { type: 6 } } },
    { startTime: iso(2), endTime: iso(1.5), count: 50000, metadata: { dataOrigin: 'com.cheater.app', recordingMethod: 3 } },
  ]
  const records = fromHealthConnect('steps', hc)
  assert.deepEqual(records.map((r) => [r.method, r.deviceType]), [['automatic', 'phone'], ['automatic', 'band'], ['manual', 'unknown']])
  const r = checkEvidence(buildEvidence(req, 'android', records, DEADLINE - 30), parseGoal('Walk|t2:steps=10000'), ctx)
  assert.equal(r.ok, true); assert.match(r.summary, /10,500 steps/)
})

test('Health Connect sleep from a watch passes Tier 3; the same sleep typed in by hand fails', () => {
  const night: HcSleep = { startTime: iso(9.5), endTime: iso(1.5), metadata: { dataOrigin: 'com.google.android.apps.fitness', recordingMethod: 2, device: { type: 1 } } }
  const policy = parseGoal('Sleep 7h|t3:sleep=420,by=540')
  const sreq = { ...req, kind: 'sleep' as const }
  assert.equal(checkEvidence(buildEvidence(sreq, 'android', fromHealthConnect('sleep', [night]), DEADLINE - 30), policy, ctx).ok, true)
  const typed = { ...night, metadata: { ...night.metadata, recordingMethod: 3 } }
  assert.equal(checkEvidence(buildEvidence(sreq, 'android', fromHealthConnect('sleep', [typed]), DEADLINE - 30), policy, ctx).ok, false)
})

test('HealthKit samples convert (in-bed and awake samples are dropped)', () => {
  const steps = fromHealthKitSteps([{ startDate: iso(10), endDate: iso(9), value: 12000, metadata: [{ sourceId: 'com.apple.health.81B4' }] }])
  assert.equal(steps[0].value, 12000)
  const sleep = fromHealthKitSleep([
    { startDate: iso(10), endDate: iso(9.5), value: 'INBED', sourceId: 'com.apple.health.81B4' },
    { startDate: iso(9.5), endDate: iso(6), value: 'CORE', sourceId: 'com.apple.health.81B4' },
    { startDate: iso(6), endDate: iso(5.8), value: 'AWAKE', sourceId: 'com.apple.health.81B4' },
    { startDate: iso(5.8), endDate: iso(1.5), value: 'DEEP', sourceId: 'com.apple.health.81B4' },
  ])
  assert.equal(sleep.length, 2)
  const r = checkEvidence(buildEvidence({ ...req, kind: 'sleep' }, 'ios', sleep, DEADLINE - 30), parseGoal('Sleep 7h|t3:sleep=420,by=540'), ctx)
  assert.equal(r.ok, true, r.reason)
})

test('return link carries evidence the website can decode byte-for-byte', () => {
  const ev = buildEvidence(req, 'android', [{ start: 1, end: 2, value: 3, method: 'automatic', deviceType: 'phone', source: 'ü-ñ 🚶' }], 5)
  const link = returnLink(req, ev)
  const enc = link.split('?ev=')[1]
  assert.equal(enc, Buffer.from(JSON.stringify(ev)).toString('base64url'), 'matches Node’s base64url')
  assert.equal(canonical(JSON.parse(Buffer.from(enc, 'base64url').toString('utf8'))), canonical(ev))
  assert.equal(base64url('a'), 'YQ')
})
