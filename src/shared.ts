// Pure modules shared with the oracle (api/), so the browser and the server agree byte-for-byte
// on goal tags and on the messages a wallet signs.
// @ts-expect-error plain JS module shared with the oracle
import * as T from '../api/_tiers.js'
// @ts-expect-error plain JS module shared with the oracle
import * as E from '../api/_evidence.js'

export type Tier = 0 | 1 | 2 | 3
export type Policy = { text: string; tier: Tier; steps?: number; sleepMin?: number; byMin?: number }
export type EvidenceRecord = { start: number; end: number; value?: number; method: 'automatic' | 'active' | 'manual' | 'unknown'; deviceType: 'watch' | 'phone' | 'ring' | 'band' | 'unknown'; source: string }
export type Evidence = {
  v: 1; poolId: string; member: string; day: number; platform: 'android' | 'ios'; kind: 'steps' | 'sleep'; collectedAt: number
  records: EvidenceRecord[]; attestation: { type: 'play-integrity' | 'app-attest' | 'none'; token?: string }
}

export const TIERS: Record<Tier, { key: string; name: string; short: string }> = T.TIERS
export const parseGoal: (goal: string) => Policy = T.parseGoal
export const encodeGoal: (text: string, tier: Tier, opts?: { steps?: number; sleepMin?: number; byMin?: number }) => string = T.encodeGoal
export const checkInMessage: (a: { poolId: string; day: number; nonce: string; answer: number }) => string = T.checkInMessage
export const evidenceMessage: (ev: Evidence) => string = E.evidenceMessage
export const goalBytes = (s: string) => new TextEncoder().encode(s).length
