// GENERATED from src/data/demoHealthData.ts by scripts/gen-oracle-data.mjs. Do not edit.
import { atLocal, lastDates, MIN_MS } from './time.js';
import { quietWindow, targetBedAt } from './verification.js';
const SOURCE = 'SIMULATED';
const SALT = 'commitpool-demo-v1';
// ───────── seeded randomness ─────────
function hash32(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
// `subject` makes the data per person (e.g. wallet + pool + day). Empty keeps the original shared sequence.
const withSubject = (subject) => (subject ? `:${subject}` : '');
const rngFor = (kind, date, subject = '') => mulberry32(hash32(`${SALT}:${kind}:${date}${withSubject(subject)}`));
const between = (r, lo, hi) => lo + r() * (hi - lo);
const tri = (r) => r() + r() - 1; // −1..1, centred on 0
// ───────── generators (one day each) ─────────
function genSleep(cfg, date, r) {
    const bedAt = targetBedAt(cfg, date) + Math.round(tri(r) * 60 + 10) * MIN_MS;
    const targetSleep = (cfg.targetWakeMin - cfg.targetBedMin + 1440) % 1440;
    const wakeAt = atLocal(date, cfg.targetWakeMin) + Math.round(tri(r) * 35) * MIN_MS;
    // Never wake before a plausible minimum night, even after a very late bedtime.
    const minWake = bedAt + Math.min(targetSleep, 360) * MIN_MS;
    return { kind: 'sleep', date, source: SOURCE, bedAt, wakeAt: Math.max(wakeAt, minWake), awakeMinutes: Math.round(r() * r() * 30) };
}
function genScroll(cfg, date, r) {
    const w = quietWindow(cfg, date);
    const sessions = [];
    const unlocks = [];
    const place = (startAt, minutes, category) => {
        sessions.push({ startAt, endAt: startAt + Math.round(minutes * 60) * 1000, category });
        unlocks.push(startAt);
    };
    // Most evenings the phone is in use right up to bedtime: this session straddles the quiet-hours start
    // and only its tail counts.
    place(w.start - Math.round(between(r, 5, 15)) * MIN_MS, between(r, 12, 30), r() < 0.5 ? 'social' : 'other');
    const socialBudget = Math.round(Math.pow(r(), 1.5) * 26);
    const chunks = socialBudget === 0 ? 0 : 1 + Math.floor(r() * 3);
    let cursor = w.start + Math.round(between(r, 35, 80)) * MIN_MS; // clear of the straddling session
    for (let i = 0; i < chunks; i++) {
        const social = Math.max(1, Math.round(socialBudget / chunks));
        place(cursor, social, 'social');
        cursor += (social + Math.round(between(r, 10, 60))) * MIN_MS;
        if (r() < 0.6) {
            const other = Math.round(between(r, 2, 10));
            place(cursor, other, 'other');
            cursor += (other + Math.round(between(r, 10, 60))) * MIN_MS;
        }
    }
    const extra = Math.floor(r() * 4); // glances at notifications
    for (let i = 0; i < extra; i++)
        unlocks.push(w.start + Math.round(r() * (w.end - w.start - MIN_MS)));
    sessions.sort((a, b) => a.startAt - b.startAt);
    return { kind: 'scroll', date, source: SOURCE, sessions, unlocks: unlocks.sort((a, b) => a - b) };
}
function genMove(cfg, date, r) {
    const steps = Math.round(cfg.stepTarget * (0.8 + r() * 0.6));
    const strideM = between(r, 0.7, 0.78);
    return {
        kind: 'move', date, source: SOURCE, steps,
        activeMinutes: Math.round(steps / between(r, 190, 230)),
        distanceKm: Math.round(((steps * strideM) / 1000) * 10) / 10,
    };
}
const ROUTINE = ['Drink water', 'Stretch', 'Plan the day'];
function genMorning(cfg, date, r) {
    const wakeAt = atLocal(date, cfg.targetWakeMin) + Math.round(tri(r) * 35 - 10) * MIN_MS;
    return { kind: 'morning', date, source: SOURCE, wakeAt, tasks: ROUTINE.map((name) => ({ name, done: r() < 0.95 })) };
}
function genStudy(cfg, date, r) {
    const segments = [];
    let cursor = atLocal(date, 16 * 60 + Math.round(r() * 90));
    const rounds = 4 + Math.floor(r() * 3);
    for (let i = 0; i < rounds; i++) {
        // ~15% of Pomodoros are cut short.
        const mins = r() < 0.85 ? cfg.pomodoroMinutes : Math.max(5, cfg.pomodoroMinutes - Math.round(between(r, 5, 15)));
        segments.push({ startAt: cursor, endAt: cursor + mins * MIN_MS, type: 'focus' });
        cursor += mins * MIN_MS;
        if (i < rounds - 1) {
            const brk = (i + 1) % 4 === 0 ? 15 : 5;
            segments.push({ startAt: cursor, endAt: cursor + brk * MIN_MS, type: 'break' });
            cursor += brk * MIN_MS;
        }
    }
    return { kind: 'study', date, source: SOURCE, segments, groupSize: 4, groupMembers: 1 + Math.floor(r() * 4) };
}
/** The simulated record for one habit on one date, or null for the occasional day with no data. */
export function simulateDay(config, date, opts = {}) {
    const subject = opts.subject ?? '';
    const r = rngFor(config.kind, date, subject);
    // A gap is decided first, from its own hash, so it never shifts the values of other days.
    const gap = (opts.allowGap ?? true) && hash32(`${SALT}:gap:${config.kind}:${date}${withSubject(subject)}`) % 13 === 0;
    if (gap)
        return { date, record: null };
    switch (config.kind) {
        case 'sleep': return { date, record: genSleep(config, date, r) };
        case 'scroll': return { date, record: genScroll(config, date, r) };
        case 'move': return { date, record: genMove(config, date, r) };
        case 'morning': return { date, record: genMorning(config, date, r) };
        case 'study': return { date, record: genStudy(config, date, r) };
    }
}
/** Entries for the last `days` days ending at `endDate`. The most recent day always has a record. */
export function simulateRange(config, endDate, days = 7, subject = '') {
    return lastDates(endDate, days).map((d) => simulateDay(config, d, { allowGap: d !== endDate, subject }));
}
export const demoProvider = {
    source: 'SIMULATED',
    label: 'Simulated sample data',
    entries: simulateRange,
};
