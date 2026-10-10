// GENERATED from src/data/habits.ts by scripts/gen-oracle-data.mjs. Do not edit.
// Shared types, per-habit configuration and goal → config mapping for CommitPool habit tracking.
// Pure TypeScript: no React, no wallet, no network. Safe to run under `node --test`.
import { parseClock } from './time.js';
export const HABIT_KINDS = ['sleep', 'scroll', 'move', 'morning', 'study'];
export function defaultConfig(kind) {
    switch (kind) {
        case 'sleep': return { kind, targetBedMin: 23 * 60, targetWakeMin: 7 * 60, bedtimeGraceMin: 30, minSleepMinutes: 7 * 60 };
        case 'scroll': return { kind, quietStartMin: 23 * 60, quietEndMin: 7 * 60, maxSocialMinutes: 15 };
        case 'move': return { kind, stepTarget: 8000 };
        case 'morning': return { kind, targetWakeMin: 7 * 60, requiredTasks: 3 };
        case 'study': return { kind, targetFocusMinutes: 100, pomodoroMinutes: 25 };
    }
}
/** Display metadata, kept next to the types so the UI never hardcodes copy per habit. */
export const HABIT_META = {
    sleep: {
        title: 'Fix your sleep schedule',
        method: 'Sleep is the time from lights-out to wake-up (dates included, so nights crossing midnight are exact) minus time awake in bed. A night counts when you were in bed by your bedtime deadline, plus a grace period, and slept at least the minimum.',
    },
    scroll: {
        title: 'Less late-night scrolling',
        method: 'Only phone sessions that overlap your quiet hours count, and a session that straddles the start is clipped to the part inside. Social-media minutes are measured separately from total phone time, and the goal is judged on social minutes.',
    },
    move: {
        title: 'Move every day',
        method: 'Steps for the day against your target. Distance and active minutes are shown for context and are checked for consistency with the step count.',
    },
    morning: {
        title: 'Win the morning',
        method: 'A day counts when your wake-up was at or before the deadline and you finished the required number of morning routine tasks.',
    },
    study: {
        title: 'Exam prep with friends',
        method: 'Only focus segments count. Breaks are excluded, and a Pomodoro is a focus segment that ran its full length. Group participation is shown but does not change the result.',
    },
};
// ───────── goal text → habit ─────────
/** Maps a pool's free-text goal to a habit kind, or null if it isn't one we can measure. */
export function classifyGoal(goal) {
    const g = goal.toLowerCase();
    if (/\bsteps?\b|\bwalk/.test(g))
        return 'move';
    if (/\bphone\b|scroll/.test(g))
        return 'scroll';
    if (/\bstudy|\bexam\b/.test(g))
        return 'study';
    if (/\bin bed\b|\bsleep/.test(g))
        return 'sleep';
    if (/\bbe up\b|\bwake|\bmorning\b/.test(g))
        return 'morning';
    return null;
}
/** Builds a verification config from the goal text, taking times/numbers from it where present. */
export function configFromGoal(goal) {
    const kind = classifyGoal(goal);
    if (!kind)
        return null;
    const g = goal.toLowerCase();
    const clock = /(\d{1,2}:\d{2})/.exec(g);
    const t = clock ? parseClock(clock[1]) : null;
    switch (kind) {
        case 'sleep': {
            const c = defaultConfig('sleep');
            return t === null ? c : { ...c, targetBedMin: t };
        }
        case 'scroll': {
            const c = defaultConfig('scroll');
            return t === null ? c : { ...c, quietStartMin: t };
        }
        case 'morning': {
            const c = defaultConfig('morning');
            return t === null ? c : { ...c, targetWakeMin: t };
        }
        case 'move': {
            const c = defaultConfig('move');
            const m = /(\d[\d,]*)\s*steps?/.exec(g);
            const n = m ? Number(m[1].replace(/,/g, '')) : NaN;
            return Number.isFinite(n) && n > 0 ? { ...c, stepTarget: n } : c;
        }
        case 'study': {
            const c = defaultConfig('study');
            const h = /(\d+(?:\.\d+)?)\s*hours?/.exec(g);
            const m = /(\d+)\s*min/.exec(g);
            const mins = h ? Math.round(Number(h[1]) * 60) : m ? Number(m[1]) : NaN;
            return Number.isFinite(mins) && mins > 0 ? { ...c, targetFocusMinutes: mins } : c;
        }
    }
}
