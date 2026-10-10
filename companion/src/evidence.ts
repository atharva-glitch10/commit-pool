// Pure conversion from Health Connect (Android) / Apple Health (iOS) records to the oracle's evidence format.
// No React Native imports here, so it can be unit-tested with plain Node against the real oracle rules.
//
// Health Connect enums (verified against androidx Device.kt and react-native-health-connect metadata.types.ts):
//   recordingMethod: 0 unknown, 1 actively recorded, 2 automatically recorded, 3 manual entry
//   device.type:     0 unknown, 1 watch, 2 phone, 4 ring, 6 fitness band (others → unknown)

export type Method = 'automatic' | 'active' | 'manual' | 'unknown'
export type DeviceKind = 'watch' | 'phone' | 'ring' | 'band' | 'unknown'
export type EvidenceRecord = { start: number; end: number; value?: number; method: Method; deviceType: DeviceKind; source: string }
export type Evidence = {
  v: 1; poolId: string; member: string; day: number; platform: 'android' | 'ios'; kind: 'steps' | 'sleep'; collectedAt: number
  records: EvidenceRecord[]; attestation: { type: 'play-integrity' | 'app-attest' | 'none'; token?: string }
}
export type SyncRequest = { pool: string; day: number; member: string; kind: 'steps' | 'sleep'; returnUrl: string }

const secs = (iso: string) => Math.floor(Date.parse(iso) / 1000)

export function hcMethod(m?: number): Method {
  return m === 1 ? 'active' : m === 2 ? 'automatic' : m === 3 ? 'manual' : 'unknown'
}
export function hcDevice(t?: number): DeviceKind {
  return t === 1 ? 'watch' : t === 2 ? 'phone' : t === 4 ? 'ring' : t === 6 ? 'band' : 'unknown'
}

/** Minimal shapes of the Health Connect records we read (subset of the library's StepsRecord / SleepSessionRecord). */
type HcMeta = { dataOrigin?: string; recordingMethod?: number; device?: { type?: number } }
export type HcSteps = { startTime: string; endTime: string; count: number; metadata?: HcMeta }
export type HcSleep = { startTime: string; endTime: string; metadata?: HcMeta }

export function fromHealthConnect(kind: 'steps' | 'sleep', records: (HcSteps | HcSleep)[]): EvidenceRecord[] {
  return records.map((r) => ({
    start: secs(r.startTime),
    end: secs(r.endTime),
    ...(kind === 'steps' ? { value: (r as HcSteps).count } : {}),
    method: hcMethod(r.metadata?.recordingMethod),
    deviceType: hcDevice(r.metadata?.device?.type),
    source: r.metadata?.dataOrigin ?? '',
  }))
}

/** react-native-health shapes. getDailyStepCountSamples already excludes user-entered samples (library source). */
export type HkSteps = { startDate: string; endDate: string; value: number; metadata?: { sourceId?: string }[] }
export type HkSleep = { startDate: string; endDate: string; value: string; sourceId?: string }
const ASLEEP = new Set(['ASLEEP', 'CORE', 'DEEP', 'REM'])

export function fromHealthKitSteps(samples: HkSteps[]): EvidenceRecord[] {
  return samples.filter((s) => s.value > 0).map((s) => ({
    start: secs(s.startDate), end: secs(s.endDate), value: Math.floor(s.value),
    method: 'automatic', deviceType: 'unknown', source: s.metadata?.[0]?.sourceId ?? 'healthkit',
  }))
}
export function fromHealthKitSleep(samples: HkSleep[]): EvidenceRecord[] {
  return samples.filter((s) => ASLEEP.has(s.value)).map((s) => ({
    start: secs(s.startDate), end: secs(s.endDate), method: 'unknown', deviceType: 'unknown', source: s.sourceId ?? '',
  }))
}

export function buildEvidence(req: SyncRequest, platform: 'android' | 'ios', records: EvidenceRecord[], now = Math.floor(Date.now() / 1000)): Evidence {
  return {
    v: 1, poolId: req.pool, member: req.member, day: req.day, platform, kind: req.kind, collectedAt: now, records,
    // Device attestation (Play Integrity / App Attest) is not wired yet; the oracle reports this evidence as unverified.
    attestation: { type: 'none' },
  }
}

/** Parse commitpool://sync?pool=..&day=..&member=..&kind=..&return=.. */
export function parseSyncUrl(url: string): SyncRequest | null {
  const q = url.split('?')[1]
  if (!q) return null
  const p = new URLSearchParams(q)
  const pool = p.get('pool') ?? '', day = Number(p.get('day')), member = p.get('member') ?? '', kind = p.get('kind'), ret = p.get('return') ?? ''
  if (!/^\d+$/.test(pool) || !Number.isInteger(day) || day < 0 || !/^0x[0-9a-fA-F]{40}$/.test(member) || (kind !== 'steps' && kind !== 'sleep') || !/^https?:\/\//.test(ret)) return null
  return { pool, day, member, kind, returnUrl: ret }
}

/** UTF-8 → base64url without relying on btoa/Buffer (works on any JS engine). */
export function base64url(s: string): string {
  const bytes: number[] = []
  for (const ch of s) {
    let c = ch.codePointAt(0)!
    if (c < 0x80) bytes.push(c)
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i], bytes[i + 1], bytes[i + 2]]
    out += A[a >> 2] + A[((a & 3) << 4) | ((b ?? 0) >> 4)]
    if (b !== undefined) out += A[((b & 15) << 2) | ((c ?? 0) >> 6)]
    if (c !== undefined) out += A[c & 63]
  }
  return out
}

/** Where to send the user back: the pool page with the evidence attached. */
export const returnLink = (req: SyncRequest, ev: Evidence) => `${req.returnUrl}?ev=${base64url(JSON.stringify(ev))}`
