// Shared types, per-habit configuration and goal → config mapping for CommitPool habit tracking.
// Pure TypeScript: no React, no wallet, no network. Safe to run under `node --test`.
import { parseClock } from './time.ts'

export type HabitKind = 'sleep' | 'scroll' | 'move' | 'morning' | 'study'
export const HABIT_KINDS: readonly HabitKind[] = ['sleep', 'scroll', 'move', 'morning', 'study']

/** Where a record came from. Only SIMULATED exists today; the others are reserved for real integrations. */
export type DataSource = 'SIMULATED' | 'DEVICE' | 'MANUAL'

// ───────── records (what a data source produces) ─────────
interface RecordBase {
  /** Local calendar date the record belongs to. For overnight habits this is the MORNING the night ended. */
  date: string
  source: DataSource
}
export interface SleepRecord extends RecordBase {
  kind: 'sleep'
  bedAt: number // epoch ms, lights out
  wakeAt: number // epoch ms, final wake-up (may be on the next calendar date from bedAt)
  awakeMinutes: number // time awake in bed, not counted as sleep
}
export interface PhoneSession {
  startAt: number
  endAt: number
  category: 'social' | 'other'
}
export interface ScrollRecord extends RecordBase {
  kind: 'scroll'
  sessions: PhoneSession[] // may start before / end after quiet hours; the engine clips them
  unlocks: number[] // epoch ms of each screen unlock
}
export interface MoveRecord extends RecordBase {
  kind: 'move'
  steps: number
  activeMinutes: number
  distanceKm: number
}
export interface MorningTask {
  name: string
  done: boolean
}
export interface MorningRecord extends RecordBase {
  kind: 'morning'
  wakeAt: number
  tasks: MorningTask[]
}
export interface StudySegment {
  startAt: number
  endAt: number
  type: 'focus' | 'break'
}
export interface StudyRecord extends RecordBase {
  kind: 'study'
  segments: StudySegment[]
  groupMembers: number // people (including you) who studied with the group that day
  groupSize: number
}
export type HabitRecord = SleepRecord | ScrollRecord | MoveRecord | MorningRecord | StudyRecord
export type RecordOf<K extends HabitKind> = Extract<HabitRecord, { kind: K }>

/** One calendar day of data. `record: null` means the source had nothing for that day. */
export interface DayEntry {
  date: string
  record: HabitRecord | null
}

// ───────── configuration (the goal being verified) ─────────
export interface SleepConfig { kind: 'sleep'; targetBedMin: number; targetWakeMin: number; bedtimeGraceMin: number; minSleepMinutes: number }
export interface ScrollConfig { kind: 'scroll'; quietStartMin: number; quietEndMin: number; maxSocialMinutes: number }
export interface MoveConfig { kind: 'move'; stepTarget: number }
export interface MorningConfig { kind: 'morning'; targetWakeMin: number; requiredTasks: number }
export interface StudyConfig { kind: 'study'; targetFocusMinutes: number; pomodoroMinutes: number }
export type HabitConfig = SleepConfig | ScrollConfig | MoveConfig | MorningConfig | StudyConfig
export type ConfigOf<K extends HabitKind> = Extract<HabitConfig, { kind: K }>

export function defaultConfig<K extends HabitKind>(kind: K): ConfigOf<K>
export function defaultConfig(kind: HabitKind): HabitConfig {
  switch (kind) {
    case 'sleep': return { kind, targetBedMin: 23 * 60, targetWakeMin: 7 * 60, bedtimeGraceMin: 30, minSleepMinutes: 7 * 60 }
    case 'scroll': return { kind, quietStartMin: 23 * 60, quietEndMin: 7 * 60, maxSocialMinutes: 15 }
    case 'move': return { kind, stepTarget: 8000 }
    case 'morning': return { kind, targetWakeMin: 7 * 60, requiredTasks: 3 }
    case 'study': return { kind, targetFocusMinutes: 100, pomodoroMinutes: 25 }
  }
}

/** Display metadata, kept next to the types so the UI never hardcodes copy per habit. */
export const HABIT_META: Record<HabitKind, { title: string; method: string }> = {
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
}

// ───────── goal text → habit ─────────
/** Maps a pool's free-text goal to a habit kind, or null if it isn't one we can measure. */
export function classifyGoal(goal: string): HabitKind | null {
  const g = goal.toLowerCase()
  if (/\bsteps?\b|\bwalk/.test(g)) return 'move'
  if (/\bphone\b|scroll/.test(g)) return 'scroll'
  if (/\bstudy|\bexam\b/.test(g)) return 'study'
  if (/\bin bed\b|\bsleep/.test(g)) return 'sleep'
  if (/\bbe up\b|\bwake|\bmorning\b/.test(g)) return 'morning'
  return null
}

/** Builds a verification config from the goal text, taking times/numbers from it where present. */
export function configFromGoal(goal: string): HabitConfig | null {
  const kind = classifyGoal(goal)
  if (!kind) return null
  const g = goal.toLowerCase()
  const clock = /(\d{1,2}:\d{2})/.exec(g)
  const t = clock ? parseClock(clock[1]) : null
  switch (kind) {
    case 'sleep': {
      const c = defaultConfig('sleep')
      return t === null ? c : { ...c, targetBedMin: t }
    }
    case 'scroll': {
      const c = defaultConfig('scroll')
      return t === null ? c : { ...c, quietStartMin: t }
    }
    case 'morning': {
      const c = defaultConfig('morning')
      return t === null ? c : { ...c, targetWakeMin: t }
    }
    case 'move': {
      const c = defaultConfig('move')
      const m = /(\d[\d,]*)\s*steps?/.exec(g)
      const n = m ? Number(m[1].replace(/,/g, '')) : NaN
      return Number.isFinite(n) && n > 0 ? { ...c, stepTarget: n } : c
    }
    case 'study': {
      const c = defaultConfig('study')
      const h = /(\d+(?:\.\d+)?)\s*hours?/.exec(g)
      const m = /(\d+)\s*min/.exec(g)
      const mins = h ? Math.round(Number(h[1]) * 60) : m ? Number(m[1]) : NaN
      return Number.isFinite(mins) && mins > 0 ? { ...c, targetFocusMinutes: mins } : c
    }
  }
}

/** A source of habit records. Real integrations (Health Connect, HealthKit) implement this same shape. */
export interface HabitDataProvider {
  source: DataSource
  label: string
  /** `days` consecutive entries ending at `endDate`, oldest first. */
  /** `subject` identifies whose data this is (e.g. wallet + pool + day); the same subject always gets the same data. */
  entries(config: HabitConfig, endDate: string, days: number, subject?: string): DayEntry[]
}
