import { useMemo } from 'react'
import { useConnection, useReadContract } from 'wagmi'
import { base, toPool, useNow } from './lib'
import { configFromGoal, HABIT_META, type DataSource } from './data/habits'
import { getProvider } from './data/providers'
import { buildReport, formatMeasure, type Verdict } from './data/verification'
import { parseKey, utcDateKey } from './data/time'

// The only source wired up today. A real device integration would register another provider in
// src/data/providers.ts and switch this constant; nothing below depends on the source.
const SOURCE: DataSource = 'SIMULATED'
const DAYS = 7

const weekday = (date: string) => {
  const p = parseKey(date)
  return p ? new Date(p.y, p.m - 1, p.d, 12).toLocaleDateString('en-US', { weekday: 'short' }) : ''
}

/** Share of the bar to fill, 0–100. "Stay under" goals fill with how much of the allowance was used. */
function fill(v: Verdict): number {
  if (v.status === 'unavailable' || v.measured === null) return 0
  if (v.direction === 'atMost') return v.target <= 0 ? (v.measured > 0 ? 100 : 0) : Math.min(100, Math.round((v.measured / v.target) * 100))
  return v.progress
}

const STATUS_LABEL = { completed: 'Completed', incomplete: 'Not completed', unavailable: 'No data' } as const

function WeekChart({ verdicts, label }: { verdicts: Verdict[]; label: string }) {
  const W = 280, H = 96, top = 8, bar = 26, gap = (W - bar * verdicts.length) / Math.max(1, verdicts.length - 1)
  const plotH = H - top
  return (
    <svg className="habitchart" viewBox={`0 0 ${W} ${H + 22}`} role="img" aria-label={label}>
      <line x1="0" x2={W} y1={top} y2={top} className="goalline" />
      {verdicts.map((v, i) => {
        const x = i * (bar + gap)
        const h = Math.max(v.status === 'unavailable' ? 3 : 2, (fill(v) / 100) * plotH)
        return (
          <g key={v.date}>
            <rect x={x} y={top + plotH - h} width={bar} height={h} rx="4" className={`hbar ${v.status}`}>
              <title>{`${v.date}: ${STATUS_LABEL[v.status]}${v.measured !== null ? `, ${formatMeasure(v.kind, v.unit, v.measured)} of ${formatMeasure(v.kind, v.unit, v.target)}` : ''}`}</title>
            </rect>
            <text x={x + bar / 2} y={H + 14} textAnchor="middle" className="hday">{weekday(v.date).slice(0, 3)}</text>
          </g>
        )
      })}
    </svg>
  )
}

export function HabitPanel({ id }: { id: bigint }) {
  const now = useNow()
  const { address } = useConnection()
  const { data: raw } = useReadContract({ ...base, functionName: 'pools', args: [id] })
  const pool = raw ? toPool(id, raw) : null
  const goal = pool?.goal ?? ''

  // The pool day this proof is for: the open one, else the next one, else the last.
  let day = 0
  if (pool) {
    const dl = (d: number) => pool.start + d * pool.day
    const open = Array.from({ length: pool.days }, (_, d) => d).find((d) => now >= dl(d) - pool.win && now <= dl(d) + pool.win)
    const next = Array.from({ length: pool.days }, (_, d) => d).find((d) => dl(d) + pool.win >= now)
    day = open ?? next ?? pool.days - 1
  }
  const isOpen = !!pool && now >= pool.start + day * pool.day - pool.win && now <= pool.start + day * pool.day + pool.win
  const date = pool ? utcDateKey(pool.start + day * pool.day) : ''
  // Must match api/_oracle.js exactly: the oracle evaluates this same subject and date.
  const subject = address ? `${address.toLowerCase()}:${id}:${day}` : ''

  const report = useMemo(() => {
    const config = goal ? configFromGoal(goal) : null
    const provider = getProvider(SOURCE)
    if (!config || !provider || !date || !subject) return null
    return buildReport(config, provider.entries(config, date, DAYS, subject), SOURCE)
  }, [goal, date, subject])

  if (!pool || !goal || !configFromGoal(goal)) return null // goal isn't one of the measurable habits
  if (!address) {
    return (
      <section className="habit" aria-label="Your proof">
        <div className="habithead"><h3>Your proof</h3><span className="simbadge">DEMO DATA · SIMULATED</span></div>
        <p className="hint">Connect your wallet to see the data that proves your day. Each person’s check-in is signed only if their own data meets the goal.</p>
      </section>
    )
  }
  if (!report || !report.latest) return null
  const v = report.latest
  const meta = HABIT_META[report.kind]
  const measured = v.measured !== null ? formatMeasure(v.kind, v.unit, v.measured) : null
  const target = formatMeasure(v.kind, v.unit, v.target)
  const unitWord = v.unit === 'steps' ? ' steps' : v.unit === 'tasks' ? ' tasks' : ''
  const limit = v.direction === 'atMost'
  const verdictLine = v.status === 'completed'
    ? (isOpen ? `Proof accepted: you can check in for day ${day + 1}.` : `Proof accepted for day ${day + 1}. Check in when its window opens.`)
    : `Not enough to check in for day ${day + 1}: the oracle will refuse to sign.`

  return (
    <section className="habit" aria-label={`${meta.title}: your proof for day ${day + 1}`}>
      <div className="habithead">
        <h3>Your proof · day {day + 1}</h3>
        <span className="simbadge" title="These numbers are generated for the demo. They are not from a real device.">DEMO DATA · SIMULATED</span>
      </div>

      <p className="habitnow">
        <strong>{measured ?? '—'}</strong>
        <span className="of"> / {target}{unitWord}{limit ? ' max' : ''}</span>
        <span className={`hstatus ${v.status}`}>{STATUS_LABEL[v.status]}</span>
      </p>
      <div className="hprogress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={fill(v)} aria-label={limit ? 'Share of the limit used' : 'Progress to target'}>
        <span className={v.status} style={{ width: `${fill(v)}%` }} />
      </div>
      <p className={`hint habitwhy ${v.status === 'completed' ? 'ok' : 'broke'}`}>{verdictLine}</p>
      <p className="hint habitextra">{v.explanation}</p>

      {v.details.length > 0 && (
        <dl className="habitdetails">
          {v.details.map((d) => <div key={d.label}><dt>{d.label}</dt><dd>{d.value}</dd></div>)}
        </dl>
      )}

      <p className="habitweek">Last {report.verdicts.length} days · <strong>{report.completedDays}</strong> completed · streak <strong>{report.streak}</strong></p>
      <WeekChart verdicts={report.verdicts} label={`${meta.title}, last ${report.verdicts.length} days: ${report.completedDays} completed`} />
      {report.extras.map((x) => <p key={x.label} className="hint habitextra"><strong>{x.label}:</strong> {x.value}</p>)}

      <details className="habitmethod">
        <summary>How this is calculated</summary>
        <p>{meta.method}</p>
        <p>Source: <strong>{report.source}</strong>. The numbers are generated for the demo, per person and per day, not read from a real device. The oracle evaluates this same data and signs your check-in only when it is completed; the contract then verifies that signature, and only a confirmed transaction counts.</p>
      </details>
    </section>
  )
}
