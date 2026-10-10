// Date/time helpers for habit data. Everything is wall-clock local time, expressed as epoch ms,
// so a sleep session that crosses midnight is just two timestamps on different dates.

export const MIN_MS = 60_000
export const DAY_MS = 86_400_000

const pad = (n: number) => String(n).padStart(2, '0')

/** Local calendar date as YYYY-MM-DD. */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** UTC calendar date of a unix timestamp (seconds). Client and oracle both use this so they agree on the date. */
export function utcDateKey(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10)
}

export function parseKey(k: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k)
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  const t = new Date(y, mo - 1, d, 12)
  return t.getFullYear() === y && t.getMonth() === mo - 1 && t.getDate() === d ? { y, m: mo, d } : null
}

/** Calendar-day arithmetic (anchored at noon so DST shifts never skip or repeat a date). */
export function addDays(k: string, n: number): string {
  const p = parseKey(k)
  if (!p) throw new Error(`Bad date key: ${k}`)
  return dateKey(new Date(p.y, p.m - 1, p.d + n, 12))
}

/** `n` consecutive dates ending at `endKey`, oldest first. */
export function lastDates(endKey: string, n: number): string[] {
  return Array.from({ length: Math.max(0, n) }, (_, i) => addDays(endKey, i - (n - 1)))
}

/** Epoch ms of `minuteOfDay` (0–1439) on date `k`, shifted by `dayOffset` calendar days. */
export function atLocal(k: string, minuteOfDay: number, dayOffset = 0): number {
  const p = parseKey(k)
  if (!p) throw new Error(`Bad date key: ${k}`)
  return new Date(p.y, p.m - 1, p.d + dayOffset, 0, minuteOfDay).getTime()
}

/** "23:30" → 1410. Returns null for anything that isn't a valid 24h clock time. */
export function parseClock(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const h = Number(m[1]), mi = Number(m[2])
  return h < 24 && mi < 60 ? h * 60 + mi : null
}

export const minutesBetween = (a: number, b: number) => Math.round((b - a) / MIN_MS)

/** Overlap of [aStart,aEnd) and [bStart,bEnd), in ms. */
export const overlapMs = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart))

/** Positive modulo into 0–1439. */
export const wrapMinutes = (m: number) => ((m % 1440) + 1440) % 1440

export function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
export const fmtClockMin = (minuteOfDay: number) => fmtClock(atLocal('2000-01-03', minuteOfDay))

export function fmtDuration(min: number): string {
  const t = Math.max(0, Math.round(min))
  const h = Math.floor(t / 60), m = t % 60
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`
}
