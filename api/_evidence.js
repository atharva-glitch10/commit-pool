// Tier 2 (steps) and Tier 3 (sleep): rules the oracle applies to evidence collected by the companion app
// from Health Connect (Android) or Apple Health (iOS). Evidence is normalised by the app to:
//
// { v: 1, poolId, member, day, platform: 'android'|'ios', kind: 'steps'|'sleep', collectedAt (unix s),
//   records: [{ start, end (unix s), value?: steps, method: 'automatic'|'active'|'manual'|'unknown',
//               deviceType: 'watch'|'phone'|'ring'|'band'|'unknown', source: 'package or bundle id' }],
//   attestation: { type: 'play-integrity'|'app-attest'|'none', token?: string } }
//
// Mapping (verified against library source): Health Connect recordingMethod 1=active, 2=automatic, 3=manual;
// Device.type 1=watch, 2=phone, 4=ring, 6=fitness band. On iOS, react-native-health's daily step totals already
// exclude user-entered samples; its sleep samples expose no manual flag or device type (see the iOS rule below).
import { keccak256, toBytes, verifyMessage } from 'viem'

export const MAX_EVIDENCE_AGE = 30 * 60 // evidence must be collected within 30 min of the check-in
const WEARABLE = new Set(['watch', 'ring', 'band'])

/** Deterministic JSON (sorted keys) so the app and the oracle hash the same bytes. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  return JSON.stringify(v)
}
export const evidenceHash = (ev) => keccak256(toBytes(canonical(ev)))
export const evidenceMessage = (ev) => `CommitPool evidence\nPool ${ev.poolId}, day ${Number(ev.day) + 1}\n${evidenceHash(ev)}`

/** Merge sleep segments separated by ≤ 30 min (iOS returns stages as separate samples). */
export function mergeSessions(records, gap = 30 * 60) {
  const s = [...records].sort((a, b) => a.start - b.start)
  const out = []
  for (const r of s) {
    const last = out[out.length - 1]
    if (last && r.start <= last.end + gap) last.end = Math.max(last.end, r.end)
    else out.push({ start: r.start, end: r.end })
  }
  return out
}

/**
 * @param ev evidence object (without walletSig)
 * @param policy parseGoal() result for the pool
 * @param ctx { poolId, member, day, deadline, window, now }
 * @returns {{ ok: boolean, reason?: string, summary?: string, attestation: string }}
 */
export function checkEvidence(ev, policy, ctx) {
  const fail = (reason) => ({ ok: false, reason, attestation: ev?.attestation?.type ?? 'none' })
  if (!ev || ev.v !== 1) return fail('Evidence missing or in an unknown format. Sync again from the companion app.')
  if (String(ev.poolId) !== String(ctx.poolId) || String(ev.member).toLowerCase() !== ctx.member.toLowerCase() || Number(ev.day) !== ctx.day)
    return fail('This evidence is for a different pool, member or day.')
  if (!(Number(ev.collectedAt) <= ctx.now + 60 && ctx.now - Number(ev.collectedAt) <= MAX_EVIDENCE_AGE))
    return fail('This evidence is stale. Sync again from the companion app.')
  const recs = Array.isArray(ev.records) ? ev.records.filter((r) => Number.isFinite(r?.start) && Number.isFinite(r?.end) && r.end > r.start) : []
  const manual = recs.filter((r) => r.method === 'manual').length

  if (policy.tier === 2) {
    if (ev.kind !== 'steps') return fail('This pool needs step data.')
    // steps in the 24 hours up to the end of today's window
    const to = ctx.deadline + ctx.window, from = to - 86400
    const counted = recs.filter((r) => r.method !== 'manual' && r.start >= from && r.end <= to && Number(r.value) > 0)
    const total = counted.reduce((s, r) => s + Math.floor(Number(r.value)), 0)
    if (total < policy.steps)
      return fail(`${total.toLocaleString('en')} device-recorded steps; the goal is ${policy.steps.toLocaleString('en')}.${manual ? ` ${manual} manually entered record(s) were ignored.` : ''}`)
    return { ok: true, summary: `${total.toLocaleString('en')} steps recorded by device`, attestation: ev.attestation?.type ?? 'none' }
  }

  if (policy.tier === 3) {
    if (ev.kind !== 'sleep') return fail('This pool needs sleep data.')
    // Android: Health Connect says which device type recorded it. iOS: the library exposes no device type or manual
    // flag for sleep, so we fall back to excluding samples written by the Health app itself (where manual entries
    // live). This iOS rule is a heuristic and is weaker than the Android check.
    const usable = recs.filter((r) => r.method !== 'manual' && (ev.platform === 'ios'
      ? typeof r.source === 'string' && r.source !== '' && r.source !== 'com.apple.Health'
      : WEARABLE.has(r.deviceType)))
    if (!usable.length) return fail(`No sleep recorded by a watch, ring or band.${manual ? ' Manually entered sleep does not count.' : ''}`)
    const latestStart = ctx.deadline - policy.byMin * 60
    const sessions = mergeSessions(usable).filter((s) => s.end > ctx.deadline - 86400)
    const good = sessions.find((s) => s.start <= latestStart && (s.end - s.start) / 60 >= policy.sleepMin)
    if (!good) {
      const best = sessions.sort((a, b) => b.end - b.start - (a.end - a.start))[0]
      return fail(best
        ? `Longest recorded sleep was ${Math.floor((best.end - best.start) / 60)} min, starting ${Math.round((best.start - latestStart) / 60)} min after the latest allowed start. The goal is ${policy.sleepMin} min, started on time.`
        : 'No sleep recorded last night.')
    }
    return { ok: true, summary: `${Math.floor((good.end - good.start) / 60)} min of sleep recorded by a wearable`, attestation: ev.attestation?.type ?? 'none' }
  }
  return fail('This pool does not use device evidence.')
}

export async function verifyEvidenceSignature(ev, walletSig, member) {
  return verifyMessage({ address: member, message: evidenceMessage(ev), signature: walletSig }).catch(() => false)
}

/**
 * Device attestation (Play Integrity / App Attest) proves the evidence came from the genuine app on a real device.
 * Verifying it needs Google / Apple server credentials, which this testnet deployment does not have, so tokens are
 * reported as "unverified". Set REQUIRE_DEVICE_ATTESTATION=1 to reject all evidence until a verifier is configured.
 */
export function attestationStatus(ev, env) {
  const required = env.REQUIRE_DEVICE_ATTESTATION === '1'
  return { required, verified: false, type: ev?.attestation?.type ?? 'none' }
}
