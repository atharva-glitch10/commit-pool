import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classifyGoal, configFromGoal, defaultConfig, HABIT_KINDS } from '../src/data/habits.ts'
import type { DayEntry, HabitConfig, MorningRecord, MoveRecord, ScrollRecord, SleepRecord, StudyRecord } from '../src/data/habits.ts'
import { buildReport, currentStreak, evaluate, percentOf, percentWithin, sleepConsistency } from '../src/data/verification.ts'
import type { Verdict } from '../src/data/verification.ts'
import { demoProvider, simulateDay, simulateRange } from '../src/data/demoHealthData.ts'
import { getProvider } from '../src/data/providers.ts'
import { addDays, atLocal, lastDates, MIN_MS, parseClock } from '../src/data/time.ts'

const D = '2026-03-14' // the "morning" the night/day belongs to
const PREV = addDays(D, -1)
const at = (date: string, hhmm: string) => {
  const m = parseClock(hhmm)
  assert.notEqual(m, null)
  return atLocal(date, m as number)
}

// ───────── builders ─────────
const sleepRec = (bed: number, wake: number, awake = 0, date = D): SleepRecord => ({ kind: 'sleep', date, source: 'SIMULATED', bedAt: bed, wakeAt: wake, awakeMinutes: awake })
const moveRec = (steps: number, dist = steps * 0.00073, active = 40, date = D): MoveRecord => ({ kind: 'move', date, source: 'SIMULATED', steps, activeMinutes: active, distanceKm: dist })
const morningRec = (wake: number, done: boolean[], date = D): MorningRecord => ({ kind: 'morning', date, source: 'SIMULATED', wakeAt: wake, tasks: done.map((d, i) => ({ name: `t${i}`, done: d })) })
const scrollRec = (sessions: ScrollRecord['sessions'], unlocks: number[] = [], date = D): ScrollRecord => ({ kind: 'scroll', date, source: 'SIMULATED', sessions, unlocks })
const studyRec = (segments: StudyRecord['segments'], members = 3, date = D): StudyRecord => ({ kind: 'study', date, source: 'SIMULATED', segments, groupMembers: members, groupSize: 4 })
const ev = (cfg: HabitConfig, record: DayEntry['record'], date = D): Verdict => evaluate(cfg, { date, record })

// ───────── steps ─────────
test('steps: goal met, missed, and the exact boundary', () => {
  const cfg = { ...defaultConfig('move'), stepTarget: 8000 }
  const ok = ev(cfg, moveRec(8642, 6.3, 42))
  assert.equal(ok.status, 'completed')
  assert.equal(ok.measured, 8642)
  assert.equal(ok.progress, 100)
  assert.equal(ev(cfg, moveRec(8000)).status, 'completed')
  const miss = ev(cfg, moveRec(7999))
  assert.equal(miss.status, 'incomplete')
  assert.equal(miss.progress, 99) // floored, never rounds up to 100 while incomplete
  assert.match(miss.explanation, /1 short/)
})

test('steps: distance inconsistent with steps is rejected', () => {
  const cfg = defaultConfig('move')
  assert.equal(ev(cfg, moveRec(9000, 40)).status, 'unavailable') // 40 km from 9000 steps
  assert.equal(ev(cfg, moveRec(9000, 0.2)).status, 'unavailable')
})

// ───────── sleep ─────────
test('sleep: a night crossing midnight is measured by timestamps (23:20 → 07:25 = 485 min)', () => {
  const cfg = { ...defaultConfig('sleep'), targetBedMin: 23 * 60 + 30, targetWakeMin: 7 * 60 + 30 }
  const v = ev(cfg, sleepRec(at(PREV, '23:20'), at(D, '07:25')))
  assert.equal(v.measured, 485)
  assert.equal(v.status, 'completed')
  assert.equal(v.target, 480)
})

test('sleep: a bedtime after midnight is judged against the previous evening, not the same-day clock', () => {
  const cfg = defaultConfig('sleep') // 23:00 target, 30 min grace
  const v = ev(cfg, sleepRec(at(D, '00:40'), at(D, '07:40')))
  assert.equal(v.measured, 420)
  assert.equal(v.status, 'incomplete')
  assert.match(v.explanation, /100 min after/)
})

test('sleep: bedtime deadline is inclusive of the grace period', () => {
  const cfg = defaultConfig('sleep')
  assert.equal(ev(cfg, sleepRec(at(PREV, '23:30'), at(D, '07:30'))).status, 'completed')
  assert.equal(ev(cfg, sleepRec(at(PREV, '23:31'), at(D, '07:31'))).status, 'incomplete')
})

test('sleep: on-time bedtime but too little sleep is incomplete, and awake time is subtracted', () => {
  const cfg = defaultConfig('sleep') // minimum 7h
  assert.equal(ev(cfg, sleepRec(at(PREV, '23:00'), at(D, '05:59'))).status, 'incomplete') // 6h59m, one minute under
  assert.equal(ev(cfg, sleepRec(at(PREV, '23:00'), at(D, '06:00'))).status, 'completed') // exactly the 7h minimum
  assert.equal(ev(cfg, sleepRec(at(PREV, '23:00'), at(D, '07:00'), 61)).status, 'incomplete') // 7h in bed - 61 awake
  assert.equal(ev(cfg, sleepRec(at(PREV, '23:00'), at(D, '07:00'), 60)).status, 'completed')
})

test('sleep: impossible or unrelated sessions are unavailable', () => {
  const cfg = defaultConfig('sleep')
  assert.equal(ev(cfg, sleepRec(at(D, '07:00'), at(PREV, '23:00'))).status, 'unavailable') // wake before bed
  assert.equal(ev(cfg, sleepRec(at(PREV, '23:00'), at(D, '07:00'), 600)).status, 'unavailable') // awake > in bed
  assert.equal(ev(cfg, sleepRec(at(addDays(D, -5), '23:00'), at(addDays(D, -4), '07:00'))).status, 'unavailable') // wrong night
})

test('sleep: consistency is 100 for identical bedtimes and drops with spread', () => {
  const cfg = defaultConfig('sleep')
  const night = (i: number, bed: string): DayEntry => {
    const d = addDays(D, -i)
    return { date: d, record: sleepRec(at(addDays(d, -1), bed), at(d, '07:00'), 0, d) }
  }
  const steady = sleepConsistency(cfg, [night(0, '23:00'), night(1, '23:00'), night(2, '23:00')])
  assert.equal(steady?.score, 100)
  const ragged = sleepConsistency(cfg, [night(0, '22:00'), night(1, '23:50'), night(2, '23:00')])
  assert.ok(ragged && ragged.score < 100)
  assert.equal(sleepConsistency(cfg, [night(0, '23:00')]), null)
})

// ───────── morning ─────────
test('morning: wake-up deadline is inclusive and tasks are required', () => {
  const cfg = { ...defaultConfig('morning'), targetWakeMin: 7 * 60, requiredTasks: 3 }
  const early = ev(cfg, morningRec(at(D, '06:45'), [true, true, true]))
  assert.equal(early.status, 'completed')
  assert.equal(early.measured, 3)
  assert.equal(ev(cfg, morningRec(at(D, '07:00'), [true, true, true])).status, 'completed')
  const late = ev(cfg, morningRec(at(D, '07:01'), [true, true, true]))
  assert.equal(late.status, 'incomplete')
  assert.match(late.explanation, /1 min after the deadline/)
  assert.equal(ev(cfg, morningRec(at(D, '06:30'), [true, true, false])).status, 'incomplete')
})

test('morning: no tasks recorded is unavailable', () => {
  assert.equal(ev(defaultConfig('morning'), morningRec(at(D, '06:30'), [])).status, 'unavailable')
})

// ───────── late-night scrolling ─────────
test('scroll: only the part of a session inside quiet hours counts', () => {
  const cfg = { ...defaultConfig('scroll'), quietStartMin: 23 * 60, quietEndMin: 7 * 60, maxSocialMinutes: 15 }
  const v = ev(cfg, scrollRec([
    { startAt: at(PREV, '22:50'), endAt: at(PREV, '23:10'), category: 'social' }, // 10 of 20 min inside
    { startAt: at(D, '06:50'), endAt: at(D, '07:20'), category: 'social' }, // 10 of 30 min inside
    { startAt: at(PREV, '21:00'), endAt: at(PREV, '21:45'), category: 'social' }, // fully outside
  ]))
  assert.equal(v.measured, 20)
  assert.equal(v.status, 'incomplete')
})

test('scroll: social media is measured separately from total phone use, and unlocks are clipped too', () => {
  const cfg = { ...defaultConfig('scroll'), maxSocialMinutes: 15 }
  const v = ev(cfg, scrollRec(
    [
      { startAt: at(PREV, '23:30'), endAt: at(PREV, '23:42'), category: 'social' },
      { startAt: at(D, '01:00'), endAt: at(D, '01:40'), category: 'other' },
    ],
    [at(PREV, '22:59'), at(PREV, '23:30'), at(D, '01:00'), at(D, '07:00')],
  ))
  assert.equal(v.measured, 12)
  assert.equal(v.status, 'completed') // heavy non-social use does not fail a social-media goal
  const byLabel = Object.fromEntries(v.details.map((d) => [d.label, d.value]))
  assert.equal(byLabel['Social media in quiet hours'], '12 min')
  assert.equal(byLabel['All phone use in quiet hours'], '52 min')
  assert.equal(byLabel['Unlocks in quiet hours'], '2') // 22:59 is before, 07:00 is at the (exclusive) end
})

test('scroll: limit boundary and malformed sessions', () => {
  const cfg = { ...defaultConfig('scroll'), maxSocialMinutes: 15 }
  const mk = (min: number) => scrollRec([{ startAt: at(PREV, '23:30'), endAt: at(PREV, '23:30') + min * MIN_MS, category: 'social' }])
  assert.equal(ev(cfg, mk(15)).status, 'completed')
  assert.equal(ev(cfg, mk(16)).status, 'incomplete')
  assert.equal(ev(cfg, scrollRec([{ startAt: 100, endAt: 50, category: 'social' }])).status, 'unavailable')
})

// ───────── study ─────────
test('study: breaks are excluded from focused time and Pomodoros are counted', () => {
  const cfg = { ...defaultConfig('study'), targetFocusMinutes: 100, pomodoroMinutes: 25 }
  const t = (m: number) => atLocal(D, 16 * 60) + m * MIN_MS
  const v = ev(cfg, studyRec([
    { startAt: t(0), endAt: t(25), type: 'focus' },
    { startAt: t(25), endAt: t(30), type: 'break' },
    { startAt: t(30), endAt: t(55), type: 'focus' },
    { startAt: t(55), endAt: t(70), type: 'break' },
    { startAt: t(70), endAt: t(80), type: 'focus' }, // cut short
  ]))
  assert.equal(v.measured, 60) // 25 + 25 + 10, not 80
  assert.equal(v.status, 'incomplete')
  assert.equal(v.details.find((d) => d.label === 'Pomodoros finished')?.value, '2')
  assert.equal(v.details.find((d) => d.label.startsWith('Breaks'))?.value, '20 min')
})

test('study: reaching the target exactly completes; overlapping segments are unavailable', () => {
  const cfg = { ...defaultConfig('study'), targetFocusMinutes: 100 }
  const t = (m: number) => atLocal(D, 16 * 60) + m * MIN_MS
  const four = [0, 30, 60, 90].map((s) => ({ startAt: t(s), endAt: t(s + 25), type: 'focus' as const }))
  assert.equal(ev(cfg, studyRec(four)).status, 'completed')
  assert.equal(ev(cfg, studyRec([{ startAt: t(0), endAt: t(30), type: 'focus' }, { startAt: t(20), endAt: t(40), type: 'focus' }])).status, 'unavailable')
})

// ───────── missing / invalid ─────────
test('missing and invalid records never crash and are never reported as completed', () => {
  for (const kind of HABIT_KINDS) {
    const cfg = defaultConfig(kind)
    const missing = evaluate(cfg, { date: D, record: null })
    assert.equal(missing.status, 'unavailable')
    assert.equal(missing.measured, null)
    assert.equal(missing.progress, 0)
    assert.equal(missing.source, null)
  }
  const move = defaultConfig('move')
  assert.equal(ev(move, moveRec(-5)).status, 'unavailable')
  assert.equal(ev(move, moveRec(Number.NaN)).status, 'unavailable')
  assert.equal(ev(move, moveRec(9000.5)).status, 'unavailable')
  assert.equal(ev(move, moveRec(250000, 180)).status, 'unavailable')
  // record for a different habit, or a different date, is ignored
  assert.equal(ev(move, sleepRec(at(PREV, '23:00'), at(D, '07:00'))).status, 'unavailable')
  assert.equal(ev(move, moveRec(9000, 6.5, 40, PREV)).status, 'unavailable')
})

// ───────── streaks ─────────
const done = (n: number): Verdict[] => {
  const cfg = defaultConfig('move')
  return lastDates(D, n).map((d) => evaluate(cfg, { date: d, record: moveRec(9000, 6.6, 45, d) }))
}
test('streak: counts consecutive completed days ending at the latest day', () => {
  assert.equal(currentStreak([]), 0)
  assert.equal(currentStreak(done(7)), 7)
  const broken = done(7)
  broken[3] = { ...broken[3], status: 'incomplete' }
  assert.equal(currentStreak(broken), 3) // days 4..6 after the break
  const gapAtEnd = done(7)
  gapAtEnd[6] = { ...gapAtEnd[6], status: 'unavailable' }
  assert.equal(currentStreak(gapAtEnd), 0)
})

test('report: aggregates a week of entries', () => {
  const cfg = defaultConfig('move')
  const entries = lastDates(D, 7).map((d, i): DayEntry => ({ date: d, record: i === 2 ? null : moveRec(i === 4 ? 3000 : 9000, i === 4 ? 2.2 : 6.6, 40, d) }))
  const rep = buildReport(cfg, entries, 'SIMULATED')
  assert.equal(rep.verdicts.length, 7)
  assert.equal(rep.completedDays, 5)
  assert.equal(rep.trackedDays, 6)
  assert.equal(rep.streak, 2)
  assert.equal(rep.latest?.date, D)
})

// ───────── progress ─────────
test('progress: bounds, flooring and the 100 ⇔ completed invariant', () => {
  assert.equal(percentOf(0, 8000), 0)
  assert.equal(percentOf(4000, 8000), 50)
  assert.equal(percentOf(7999, 8000), 99)
  assert.equal(percentOf(8000, 8000), 100)
  assert.equal(percentOf(24000, 8000), 100) // capped
  assert.equal(percentOf(-3, 8000), 0)
  assert.equal(percentOf(Number.NaN, 8000), 0)
  assert.equal(percentOf(5, 0), 100)
  assert.equal(percentWithin(15, 15), 100)
  assert.equal(percentWithin(30, 15), 50)
  assert.ok(percentWithin(16, 15) < 100)
  assert.equal(percentWithin(5, 0), 0)

  for (const kind of HABIT_KINDS) {
    const cfg = defaultConfig(kind)
    for (const e of simulateRange(cfg, D, 30)) {
      const v = evaluate(cfg, e)
      assert.ok(v.progress >= 0 && v.progress <= 100, `${kind} ${e.date} progress ${v.progress}`)
      assert.equal(v.progress === 100, v.status === 'completed', `${kind} ${e.date} invariant`)
    }
  }
})

// ───────── simulated data ─────────
test('simulated data is deterministic and always labelled SIMULATED', () => {
  for (const kind of HABIT_KINDS) {
    const cfg = defaultConfig(kind)
    const a = simulateRange(cfg, D, 7)
    const b = simulateRange(cfg, D, 7)
    assert.deepEqual(a, b)
    assert.equal(a.length, 7)
    assert.ok(a[6].record, `${kind}: the latest day always has a record`)
    for (const e of a) if (e.record) assert.equal(e.record.source, 'SIMULATED')
    // a day's data does not depend on the window it was requested in
    assert.deepEqual(simulateRange(cfg, D, 14).slice(-7), a)
  }
})

test('simulated data is not the same result every day, and records are internally consistent', () => {
  for (const kind of HABIT_KINDS) {
    const cfg = defaultConfig(kind)
    const statuses = new Set(simulateRange(cfg, D, 40).map((e) => evaluate(cfg, e).status))
    assert.ok(statuses.has('completed'), `${kind} has completed days`)
    assert.ok(statuses.has('incomplete'), `${kind} has incomplete days`)
    for (const e of simulateRange(cfg, D, 40)) {
      const r = e.record
      if (!r) continue
      assert.notEqual(evaluate(cfg, e).status, 'unavailable', `${kind} ${e.date} should be a usable record`)
      if (r.kind === 'move') {
        const stride = (r.distanceKm * 1000) / r.steps
        assert.ok(stride > 0.65 && stride < 0.8, `stride ${stride}`)
        assert.ok(r.activeMinutes > 0 && r.activeMinutes < r.steps / 100)
      }
      if (r.kind === 'sleep') {
        const mins = (r.wakeAt - r.bedAt) / MIN_MS
        assert.ok(mins >= 300 && mins <= 700, `in bed ${mins}`)
      }
    }
  }
})

test('simulateDay with gaps disabled never returns an empty day', () => {
  const cfg = defaultConfig('sleep')
  for (const d of lastDates(D, 60)) assert.ok(simulateDay(cfg, d, { allowGap: false }).record)
})

// ───────── goal mapping ─────────
test('goals map to habits and take their numbers from the goal text', () => {
  assert.equal(classifyGoal('Be in bed by 23:00'), 'sleep')
  assert.equal(classifyGoal('Put my phone away by 22:00'), 'scroll')
  assert.equal(classifyGoal('Walk 10,000 steps'), 'move')
  assert.equal(classifyGoal('Be up by 06:30'), 'morning')
  assert.equal(classifyGoal('Study for 2 hours'), 'study')
  assert.equal(classifyGoal('Learn the guitar'), null)
  assert.equal(configFromGoal('Learn the guitar'), null)
  assert.deepEqual(configFromGoal('Be in bed by 22:45'), { ...defaultConfig('sleep'), targetBedMin: 22 * 60 + 45 })
  assert.deepEqual(configFromGoal('Put my phone away by 22:00'), { ...defaultConfig('scroll'), quietStartMin: 22 * 60 })
  assert.deepEqual(configFromGoal('Walk 10,000 steps'), { ...defaultConfig('move'), stepTarget: 10000 })
  assert.deepEqual(configFromGoal('Be up by 06:30'), { ...defaultConfig('morning'), targetWakeMin: 6 * 60 + 30 })
  assert.deepEqual(configFromGoal('Study for 2 hours'), { ...defaultConfig('study'), targetFocusMinutes: 120 })
})

// ───────── simulation vs real check-ins ─────────
test('simulated verdicts are never presented as on-chain or device-verified', () => {
  for (const kind of HABIT_KINDS) {
    const cfg = defaultConfig(kind)
    for (const e of simulateRange(cfg, D, 7)) {
      const v = evaluate(cfg, e)
      assert.equal(v.onChain, false)
      assert.ok(v.source === 'SIMULATED' || v.source === null)
    }
    assert.equal(buildReport(cfg, simulateRange(cfg, D, 7), 'SIMULATED').source, 'SIMULATED')
  }
})

test('only the SIMULATED provider is registered; DEVICE and MANUAL are not faked', () => {
  assert.equal(getProvider('SIMULATED'), demoProvider)
  assert.equal(getProvider('DEVICE'), null)
  assert.equal(getProvider('MANUAL'), null)
})

test('the data layer has no wallet, contract, oracle or network access', () => {
  const dir = join(import.meta.dirname, '..', 'src', 'data')
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'))
  assert.ok(files.length >= 5)
  for (const f of files) {
    const src = readFileSync(join(dir, f), 'utf8')
    const imports = [...src.matchAll(/^\s*import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1])
    for (const spec of imports) {
      assert.ok(spec.startsWith('./'), `${f} imports ${spec}: the data layer may only import its own modules`)
    }
    assert.doesNotMatch(src, /\bfetch\s*\(|writeContract|sendTransaction|\/api\/attest|ORACLE_PRIVATE_KEY|signMessage/, `${f} must not touch the oracle or send transactions`)
  }
})

test('per-person data: same subject is stable, different subjects differ, empty subject is the shared sequence', () => {
  const cfg = defaultConfig('move')
  const D = '2026-10-10'
  const a = simulateDay(cfg, D, { allowGap: false, subject: '0xaaa:1:0' })
  assert.deepEqual(a, simulateDay(cfg, D, { allowGap: false, subject: '0xaaa:1:0' }))
  const steps = new Set(Array.from({ length: 30 }, (_, i) => (simulateDay(cfg, D, { allowGap: false, subject: `0x${i}:1:0` }).record as MoveRecord).steps))
  assert.ok(steps.size > 10, 'different people should get different numbers')
  assert.deepEqual(simulateDay(cfg, D, { allowGap: false }), simulateDay(cfg, D, { allowGap: false, subject: '' }))
  assert.deepEqual(simulateRange(cfg, D, 7, 'x'), simulateRange(cfg, D, 7, 'x'))
})

test('utcDateKey is the UTC calendar date', async () => {
  const { utcDateKey } = await import('../src/data/time.ts')
  assert.equal(utcDateKey(Date.UTC(2026, 9, 10, 23, 59) / 1000), '2026-10-10')
  assert.equal(utcDateKey(Date.UTC(2026, 9, 11, 0, 0) / 1000), '2026-10-11')
})

test('api/_data (used by the oracle) is in sync with src/data', async () => {
  const ts = (await import('typescript')).default
  for (const f of ['habits', 'time', 'verification', 'demoHealthData']) {
    const src = readFileSync(join('src', 'data', `${f}.ts`), 'utf8')
    const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false } })
      .outputText.replace(/(from\s+['"]\.\/[^'"]+)\.ts(['"])/g, '$1.js$2')
    const gen = readFileSync(join('api', '_data', `${f}.js`), 'utf8').split('\n').slice(1).join('\n')
    assert.equal(gen, out, `api/_data/${f}.js is stale: run npm run gen:oracle`)
  }
})
