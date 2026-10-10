import { useState } from 'react'
import { useConnection } from 'wagmi'
import { parseEther, parseEventLogs } from 'viem'
import { abi } from './abi'
import { TxLine, useTx } from './lib'
import { go } from './router'

const TEMPLATES = [
  { goal: 'be in bed by 23:00', note: 'Fix your sleep schedule' },
  { goal: 'put my phone away by 22:00', note: 'Less late-night scrolling' },
  { goal: 'walk 10,000 steps', note: 'Move every day' },
  { goal: 'be up by 06:30', note: 'Win the morning' },
  { goal: 'study for 2 hours', note: 'Exam prep with friends' },
]
const TIMINGS = [
  { v: '60:20', label: '60-second demo days' },
  { v: '120:30', label: '2-minute demo days' },
  { v: '86400:3600', label: 'real days (±1 hour window)' },
]

export function Pledge() {
  const { isConnected } = useConnection()
  const [goal, setGoal] = useState(TEMPLATES[0].goal)
  const [days, setDays] = useState('3')
  const [stake, setStake] = useState('0.1')
  const [max, setMax] = useState('4')
  const [startIn, setStartIn] = useState('2')
  const [timing, setTiming] = useState(TIMINGS[0].v)
  const { send, status } = useTx()
  const [dl, win] = timing.split(':').map(Number)
  // the contract needs startTime > block.timestamp + window; keep a buffer for wallet and block latency
  const SAFETY = 30
  const cap = (g: string) => g.trim().charAt(0).toUpperCase() + g.trim().slice(1)
  const goalBytes = new TextEncoder().encode(cap(goal)).length // contract limit is 80 bytes, not characters
  const stakeOk = /^(\d+\.?\d{0,18}|\.\d{1,18})$/.test(stake) && Number(stake) > 0
  const valid = goalBytes > 0 && goalBytes <= 80 && stakeOk && Number(startIn) * 60 >= win + SAFETY

  async function create() {
    let wei: bigint
    try { wei = parseEther(stake) } catch { return }
    const start = BigInt(Math.floor(Date.now() / 1000) + Math.round(Number(startIn) * 60))
    const g = cap(goal)
    const r = await send('createPool', [g, wei, start, dl, win, Number(days), Number(max)], wei, 'Pool created. Share the invite with your friends.')
    if (r) {
      const ev = parseEventLogs({ abi, logs: r.logs, eventName: 'PoolCreated' })[0]
      if (ev) go(`#/pool/${ev.args.poolId}`)
    }
  }

  return (
    <section className="pledge" id="start">
      <h2>Make a pledge</h2>
      <div className="templates" role="list" aria-label="Pledge ideas">
        {TEMPLATES.map((t) => (
          <button key={t.goal} role="listitem" className={`chip${goal === t.goal ? ' on' : ''}`} onClick={() => setGoal(t.goal)}>
            {t.note}
          </button>
        ))}
      </div>
      <p className="sentence">
        I will <input aria-label="Goal" className="w-goal" value={goal} onChange={(e) => setGoal(e.target.value)} />
        {' '}for <select aria-label="Days" value={days} onChange={(e) => setDays(e.target.value)}>{[1, 2, 3, 5, 7, 14, 21, 30].map((d) => <option key={d}>{d}</option>)}</select> days,
        and I’ll put <input aria-label="Stake in MON" className="w-num" inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value)} /> MON on it.
        {' '}Up to <select aria-label="Max members" value={max} onChange={(e) => setMax(e.target.value)}>{[2, 3, 4, 5, 8, 10, 20].map((d) => <option key={d}>{d}</option>)}</select> friends can join me.
        {' '}The first check-in is in <input aria-label="Minutes until first check-in" className="w-num" inputMode="numeric" value={startIn} onChange={(e) => setStartIn(e.target.value)} /> minutes,
        using <select aria-label="Day length" value={timing} onChange={(e) => setTiming(e.target.value)}>{TIMINGS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}</select>.
      </p>
      <p className="hint fine">
        Friends can join until the first check-in window opens. Each day you have a window of ±{win >= 3600 ? `${win / 3600} hour` : `${win} seconds`} around the deadline.
        If you miss a day, your stake goes to the people who didn’t. If everyone finishes, everyone gets their stake back and nobody pays a fee.
      </p>
      {isConnected
        ? <button className="btn sun big" onClick={create} disabled={status.kind === 'pending' || !valid}>Sign the pledge and lock {stake || '0'} MON</button>
        : <a className="btn ink big" href="#/start?next=%2Fnew">Connect a wallet to sign the pledge</a>}
      {!valid && <p className="hint broke">Keep the goal under 80 bytes, use a plain positive stake like 0.1, and set the first check-in at least {Math.ceil((win + SAFETY) / 60 * 10) / 10} minutes away so friends have time to join.</p>}
      <TxLine s={status} />
    </section>
  )
}
