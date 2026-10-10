// GENERATED from src/data/time.ts by scripts/gen-oracle-data.mjs. Do not edit.
// Date/time helpers for habit data. Everything is wall-clock local time, expressed as epoch ms,
// so a sleep session that crosses midnight is just two timestamps on different dates.
export const MIN_MS = 60_000;
export const DAY_MS = 86_400_000;
const pad = (n) => String(n).padStart(2, '0');
/** Local calendar date as YYYY-MM-DD. */
export function dateKey(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** UTC calendar date of a unix timestamp (seconds). Client and oracle both use this so they agree on the date. */
export function utcDateKey(unixSeconds) {
    return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}
export function parseKey(k) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k);
    if (!m)
        return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const t = new Date(y, mo - 1, d, 12);
    return t.getFullYear() === y && t.getMonth() === mo - 1 && t.getDate() === d ? { y, m: mo, d } : null;
}
/** Calendar-day arithmetic (anchored at noon so DST shifts never skip or repeat a date). */
export function addDays(k, n) {
    const p = parseKey(k);
    if (!p)
        throw new Error(`Bad date key: ${k}`);
    return dateKey(new Date(p.y, p.m - 1, p.d + n, 12));
}
/** `n` consecutive dates ending at `endKey`, oldest first. */
export function lastDates(endKey, n) {
    return Array.from({ length: Math.max(0, n) }, (_, i) => addDays(endKey, i - (n - 1)));
}
/** Epoch ms of `minuteOfDay` (0–1439) on date `k`, shifted by `dayOffset` calendar days. */
export function atLocal(k, minuteOfDay, dayOffset = 0) {
    const p = parseKey(k);
    if (!p)
        throw new Error(`Bad date key: ${k}`);
    return new Date(p.y, p.m - 1, p.d + dayOffset, 0, minuteOfDay).getTime();
}
/** "23:30" → 1410. Returns null for anything that isn't a valid 24h clock time. */
export function parseClock(s) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
    if (!m)
        return null;
    const h = Number(m[1]), mi = Number(m[2]);
    return h < 24 && mi < 60 ? h * 60 + mi : null;
}
export const minutesBetween = (a, b) => Math.round((b - a) / MIN_MS);
/** Overlap of [aStart,aEnd) and [bStart,bEnd), in ms. */
export const overlapMs = (aStart, aEnd, bStart, bEnd) => Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
/** Positive modulo into 0–1439. */
export const wrapMinutes = (m) => ((m % 1440) + 1440) % 1440;
export function fmtClock(ms) {
    return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
export const fmtClockMin = (minuteOfDay) => fmtClock(atLocal('2000-01-03', minuteOfDay));
export function fmtDuration(min) {
    const t = Math.max(0, Math.round(min));
    const h = Math.floor(t / 60), m = t % 60;
    return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
}
