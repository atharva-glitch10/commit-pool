// Verification engine: evaluates one day's habit record against a goal configuration.
// Pure and deterministic. It knows nothing about wallets, the oracle or the contract: a Verdict is a
// LOCAL PREVIEW and is never an attestation. `onChain` is the literal `false` for that reason.
import type {
  DataSource, DayEntry, HabitConfig, HabitKind, HabitRecord, MorningConfig, MoveConfig, MoveRecord,
  MorningRecord, ScrollConfig, ScrollRecord, SleepConfig, SleepRecord, StudyConfig, StudyRecord,
} from './habits.ts'
import { atLocal, fmtClock, fmtClockMin, fmtDuration, MIN_MS, minutesBetween, overlapMs, wrapMinutes } from './time.ts'

export type Status = 'completed' | 'incomplete' | 'unavailable'
export type Unit = 'minutes' | 'steps' | 'tasks'

export interface Verdict {
  kind: HabitKind
  date: string
  source: DataSource | null // null when there was no record
  status: Status
  measured: number | null
  target: number
  unit: Unit
  /** atLeast: reach the target. atMost: stay at or under the limit. */
  direction: 'atLeast' | 'atMost'
  /** 0–100. For atLeast goals it is measured/target; for atMost goals 100 while within the limit, falling as you exceed it. 100 only when completed. */
  progress: number
  explanation: string
  details: { label: string; value: string }[]
  /** Always false: nothing here is, or implies, a confirmed on-chain event. */
  onChain: false
}

// ───────── small pure helpers ─────────
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const nonNeg = (n: unknown): n is number => isNum(n) && n >= 0

/** Percentage 0–100, floored so 100 is only reached when measured >= target. */
export function percentOf(measured: number, target: number): number {
  if (!isNum(measured) || !isNum(target)) return 0
  if (target <= 0) return measured >= 0 ? 100 : 0
  return Math.max(0, Math.min(100, Math.floor((measured / target) * 100)))
}
/** For "stay under" goals: 100 within the limit, otherwise limit/measured. */
export function percentWithin(measured: number, limit: number): number {
  if (!isNum(measured) || !isNum(limit) || measured < 0) return 0
  if (measured <= limit) return 100
  return Math.max(0, Math.min(99, Math.floor((limit / measured) * 100)))
}

export function formatMeasure(kind: HabitKind, unit: Unit, v: number): string {
  if (unit === 'steps') return Math.round(v).toLocaleString('en-US')
  if (unit === 'tasks') return String(Math.round(v))
  return kind === 'sleep' ? fmtDuration(v) : `${Math.round(v)} min`
}

function base(config: HabitConfig, date: string, record: HabitRecord | null): Verdict {
  const common = { kind: config.kind, date, source: record?.source ?? null, onChain: false as const, details: [] }
  switch (config.kind) {
    case 'sleep': return { ...common, status: 'unavailable', measured: null, target: wrapMinutes(config.targetWakeMin - config.targetBedMin) || 1440, unit: 'minutes', direction: 'atLeast', progress: 0, explanation: '' }
    case 'scroll': return { ...common, status: 'unavailable', measured: null, target: config.maxSocialMinutes, unit: 'minutes', direction: 'atMost', progress: 0, explanation: '' }
    case 'move': return { ...common, status: 'unavailable', measured: null, target: config.stepTarget, unit: 'steps', direction: 'atLeast', progress: 0, explanation: '' }
    case 'morning': return { ...common, status: 'unavailable', measured: null, target: config.requiredTasks, unit: 'tasks', direction: 'atLeast', progress: 0, explanation: '' }
    case 'study': return { ...common, status: 'unavailable', measured: null, target: config.targetFocusMinutes, unit: 'minutes', direction: 'atLeast', progress: 0, explanation: '' }
  }
}
const unavailable = (v: Verdict, why: string): Verdict => ({ ...v, status: 'unavailable', measured: null, progress: 0, explanation: why })

/** Finalises a verdict. Invariant: progress is 100 only when completed. */
function conclude(v: Verdict, completed: boolean, progress: number, explanation: string): Verdict {
  return { ...v, status: completed ? 'completed' : 'incomplete', progress: completed ? 100 : Math.min(progress, 99), explanation }
}

// ───────── per-habit evaluation ─────────
/** Target bedtime for the night that ended on `date` (a 23:00 bedtime is the evening BEFORE). */
export function targetBedAt(cfg: SleepConfig, date: string): number {
  return atLocal(date, cfg.targetBedMin, cfg.targetBedMin >= 12 * 60 ? -1 : 0)
}
/** Quiet-hours window for the night that ended on `date`. */
export function quietWindow(cfg: ScrollConfig, date: string): { start: number; end: number } {
  const start = atLocal(date, cfg.quietStartMin, cfg.quietStartMin >= 12 * 60 ? -1 : 0)
  let end = atLocal(date, cfg.quietEndMin)
  if (end <= start) end = atLocal(date, cfg.quietEndMin, 1)
  return { start, end }
}

function evalSleep(cfg: SleepConfig, r: SleepRecord, v: Verdict): Verdict {
  const inBed = minutesBetween(r.bedAt, r.wakeAt)
  if (!isNum(r.bedAt) || !isNum(r.wakeAt) || inBed <= 0 || inBed > 18 * 60) return unavailable(v, 'The sleep record has an impossible bedtime/wake-up pair, so it was ignored.')
  if (!nonNeg(r.awakeMinutes) || r.awakeMinutes >= inBed) return unavailable(v, 'The sleep record has an invalid awake time, so it was ignored.')
  const targetBed = targetBedAt(cfg, r.date)
  const bedDelta = minutesBetween(targetBed, r.bedAt) // + = later than target
  if (Math.abs(bedDelta) > 12 * 60) return unavailable(v, 'This sleep session does not belong to the night before this date, so it was ignored.')
  const asleep = inBed - r.awakeMinutes
  const bedOk = bedDelta <= cfg.bedtimeGraceMin
  const durOk = asleep >= cfg.minSleepMinutes
  const out: Verdict = {
    ...v, measured: asleep,
    details: [
      { label: 'Bedtime', value: `${fmtClock(r.bedAt)} (target ${fmtClockMin(cfg.targetBedMin)})` },
      { label: 'Wake-up', value: `${fmtClock(r.wakeAt)} (target ${fmtClockMin(cfg.targetWakeMin)})` },
      { label: 'In bed', value: fmtDuration(inBed) },
    ],
  }
  const bedTxt = bedDelta <= 0 ? `${-bedDelta} min before` : `${bedDelta} min after`
  const why = bedOk && durOk
    ? `In bed ${bedTxt} the ${fmtClockMin(cfg.targetBedMin)} target and slept ${fmtDuration(asleep)}.`
    : !bedOk
      ? `In bed ${bedTxt} the ${fmtClockMin(cfg.targetBedMin)} target; the grace period is ${cfg.bedtimeGraceMin} min.`
      : `Slept ${fmtDuration(asleep)}, under the ${fmtDuration(cfg.minSleepMinutes)} minimum.`
  return conclude(out, bedOk && durOk, percentOf(asleep, v.target), why)
}

function evalScroll(cfg: ScrollConfig, r: ScrollRecord, v: Verdict): Verdict {
  if (!Array.isArray(r.sessions) || !Array.isArray(r.unlocks)) return unavailable(v, 'The phone-usage record is malformed, so it was ignored.')
  const w = quietWindow(cfg, r.date)
  let social = 0, other = 0
  for (const s of r.sessions) {
    if (!isNum(s.startAt) || !isNum(s.endAt) || s.endAt < s.startAt) return unavailable(v, 'A phone session has an invalid time range, so the record was ignored.')
    const ms = overlapMs(s.startAt, s.endAt, w.start, w.end)
    if (s.category === 'social') social += ms
    else other += ms
  }
  if (r.unlocks.some((u) => !isNum(u))) return unavailable(v, 'An unlock has an invalid timestamp, so the record was ignored.')
  const unlocks = r.unlocks.filter((u) => u >= w.start && u < w.end).length
  const socialMin = Math.round(social / MIN_MS)
  const totalMin = Math.round((social + other) / MIN_MS)
  const out: Verdict = {
    ...v, measured: socialMin,
    details: [
      { label: 'Social media in quiet hours', value: `${socialMin} min` },
      { label: 'All phone use in quiet hours', value: `${totalMin} min` },
      { label: 'Unlocks in quiet hours', value: String(unlocks) },
      { label: 'Quiet hours', value: `${fmtClockMin(cfg.quietStartMin)} to ${fmtClockMin(cfg.quietEndMin)}` },
    ],
  }
  const ok = socialMin <= cfg.maxSocialMinutes
  return conclude(out, ok, percentWithin(socialMin, cfg.maxSocialMinutes),
    ok ? `${socialMin} min of social media in quiet hours, within the ${cfg.maxSocialMinutes} min limit.`
      : `${socialMin} min of social media in quiet hours, ${socialMin - cfg.maxSocialMinutes} min over the ${cfg.maxSocialMinutes} min limit.`)
}

function evalMove(cfg: MoveConfig, r: MoveRecord, v: Verdict): Verdict {
  if (!nonNeg(r.steps) || r.steps > 100_000 || !Number.isInteger(r.steps)) return unavailable(v, 'The step count is invalid, so the record was ignored.')
  if (!nonNeg(r.activeMinutes) || r.activeMinutes > 1440 || !nonNeg(r.distanceKm)) return unavailable(v, 'Active minutes or distance are invalid, so the record was ignored.')
  if (r.steps >= 500) {
    const stride = (r.distanceKm * 1000) / r.steps
    if (stride < 0.3 || stride > 1.3) return unavailable(v, 'Distance does not match the step count, so the record was ignored.')
  }
  const out: Verdict = {
    ...v, measured: r.steps,
    details: [
      { label: 'Active minutes', value: `${Math.round(r.activeMinutes)} min` },
      { label: 'Distance', value: `${r.distanceKm.toFixed(1)} km` },
    ],
  }
  const ok = r.steps >= cfg.stepTarget
  return conclude(out, ok, percentOf(r.steps, cfg.stepTarget),
    ok ? `${r.steps.toLocaleString('en-US')} steps, ${(r.steps - cfg.stepTarget).toLocaleString('en-US')} over the target.`
      : `${r.steps.toLocaleString('en-US')} steps, ${(cfg.stepTarget - r.steps).toLocaleString('en-US')} short of the target.`)
}

function evalMorning(cfg: MorningConfig, r: MorningRecord, v: Verdict): Verdict {
  if (!isNum(r.wakeAt) || !Array.isArray(r.tasks) || r.tasks.length === 0) return unavailable(v, 'The morning record is incomplete, so it was ignored.')
  const deadline = atLocal(r.date, cfg.targetWakeMin)
  const delta = minutesBetween(deadline, r.wakeAt) // + = after the deadline
  if (Math.abs(delta) > 12 * 60) return unavailable(v, 'This wake-up does not belong to this date, so it was ignored.')
  const done = r.tasks.filter((t) => t.done).length
  const required = Math.min(cfg.requiredTasks, r.tasks.length)
  const onTime = delta <= 0
  const out: Verdict = {
    ...v, measured: done, target: required,
    details: [
      { label: 'Wake-up', value: `${fmtClock(r.wakeAt)} (deadline ${fmtClockMin(cfg.targetWakeMin)})` },
      { label: 'Routine', value: r.tasks.map((t) => `${t.done ? '✓' : '✗'} ${t.name}`).join(', ') },
    ],
  }
  const timing = onTime ? `Up ${-delta} min before the deadline` : `Up ${delta} min after the deadline`
  const ok = onTime && done >= required
  return conclude(out, ok, percentOf(done, required), `${timing}; ${done} of ${r.tasks.length} routine tasks done (${required} needed).`)
}

function evalStudy(cfg: StudyConfig, r: StudyRecord, v: Verdict): Verdict {
  if (!Array.isArray(r.segments) || !nonNeg(r.groupMembers) || !nonNeg(r.groupSize)) return unavailable(v, 'The study record is malformed, so it was ignored.')
  const segs = [...r.segments].sort((a, b) => a.startAt - b.startAt)
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    if (!isNum(s.startAt) || !isNum(s.endAt) || s.endAt <= s.startAt) return unavailable(v, 'A study segment has an invalid time range, so the record was ignored.')
    if (i > 0 && s.startAt < segs[i - 1].endAt) return unavailable(v, 'Study segments overlap, so the record was ignored.')
  }
  const focus = segs.filter((s) => s.type === 'focus')
  const focusedMs = focus.reduce((sum, s) => sum + (s.endAt - s.startAt), 0)
  const focused = Math.round(focusedMs / MIN_MS)
  const breaks = Math.round(segs.filter((s) => s.type === 'break').reduce((sum, s) => sum + (s.endAt - s.startAt), 0) / MIN_MS)
  const sessions = focus.filter((s) => s.endAt - s.startAt >= cfg.pomodoroMinutes * MIN_MS).length
  const out: Verdict = {
    ...v, measured: focused,
    details: [
      { label: 'Pomodoros finished', value: String(sessions) },
      { label: 'Breaks (not counted)', value: `${breaks} min` },
      { label: 'Group', value: r.groupMembers >= 2 ? `studied with ${r.groupMembers - 1} of ${Math.max(0, r.groupSize - 1)} friends` : 'studied solo' },
    ],
  }
  const ok = focused >= cfg.targetFocusMinutes
  return conclude(out, ok, percentOf(focused, cfg.targetFocusMinutes),
    ok ? `${focused} focused min across ${sessions} full Pomodoros; breaks not counted.`
      : `${focused} focused min, ${cfg.targetFocusMinutes - focused} short of the target; breaks not counted.`)
}

/** Evaluates one day. A missing or malformed record yields `unavailable`, never a crash or a fake result. */
export function evaluate(config: HabitConfig, entry: DayEntry): Verdict {
  const v = base(config, entry.date, entry.record)
  const r = entry.record
  if (!r) return unavailable(v, 'No data for this day.')
  if (r.kind !== config.kind) return unavailable(v, 'The record is for a different habit, so it was ignored.')
  if (r.date !== entry.date) return unavailable(v, 'The record date does not match this day, so it was ignored.')
  switch (config.kind) {
    case 'sleep': return evalSleep(config, r as SleepRecord, v)
    case 'scroll': return evalScroll(config, r as ScrollRecord, v)
    case 'move': return evalMove(config, r as MoveRecord, v)
    case 'morning': return evalMorning(config, r as MorningRecord, v)
    case 'study': return evalStudy(config, r as StudyRecord, v)
  }
}

// ───────── aggregates ─────────
/** Consecutive completed days ending at the most recent day. Incomplete or unavailable days break it. */
export function currentStreak(verdicts: readonly Verdict[]): number {
  let n = 0
  for (let i = verdicts.length - 1; i >= 0 && verdicts[i].status === 'completed'; i--) n++
  return n
}

/** How steady bedtimes are: 100 = identical each night, 0 = 90+ minutes of spread. Null with fewer than two nights. */
export function sleepConsistency(cfg: SleepConfig, entries: readonly DayEntry[]): { score: number; stdDevMinutes: number; nights: number } | null {
  const offsets: number[] = []
  for (const e of entries) {
    const r = e.record
    if (!r || r.kind !== 'sleep' || r.date !== e.date || !isNum(r.bedAt)) continue
    const d = minutesBetween(targetBedAt(cfg, r.date), r.bedAt)
    if (Math.abs(d) <= 12 * 60) offsets.push(d)
  }
  if (offsets.length < 2) return null
  const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length
  const sd = Math.sqrt(offsets.reduce((a, b) => a + (b - mean) ** 2, 0) / offsets.length)
  return { score: Math.max(0, Math.min(100, Math.round(100 - (sd / 90) * 100))), stdDevMinutes: Math.round(sd), nights: offsets.length }
}

export interface HabitReport {
  kind: HabitKind
  config: HabitConfig
  source: DataSource
  verdicts: Verdict[] // oldest first
  latest: Verdict | null
  streak: number
  completedDays: number
  trackedDays: number // days with a usable record
  extras: { label: string; value: string }[]
}

export function buildReport(config: HabitConfig, entries: readonly DayEntry[], source: DataSource): HabitReport {
  const verdicts = entries.map((e) => evaluate(config, e))
  const extras: { label: string; value: string }[] = []
  if (config.kind === 'sleep') {
    const c = sleepConsistency(config, entries)
    if (c) extras.push({ label: 'Schedule consistency', value: `${c.score}/100 (bedtime varies by about ${c.stdDevMinutes} min)` })
  }
  return {
    kind: config.kind, config, source, verdicts,
    latest: verdicts.length ? verdicts[verdicts.length - 1] : null,
    streak: currentStreak(verdicts),
    completedDays: verdicts.filter((x) => x.status === 'completed').length,
    trackedDays: verdicts.filter((x) => x.status !== 'unavailable').length,
    extras,
  }
}

