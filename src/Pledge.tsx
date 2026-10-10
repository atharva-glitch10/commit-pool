import { useState } from 'react'
import { useConnection } from 'wagmi'
import { parseEther, parseEventLogs } from 'viem'
import { abi } from './abi'
import { TxLine, useTx } from './lib'
import { go } from './router'
import { encodeGoal, goalBytes, type Tier } from './shared'

const TEMPLATES: { goal: string; note: string; tier: Tier }[] = [
  { goal: 'be up by 06:30', note: 'Win the morning', tier: 1 },
  { goal: 'be in bed by 23:00', note: 'Fix your sleep', tier: 1 },
  { goal: 'put my phone away by 22:00', note: 'Less late-night scrolling', tier: 0 },
  { goal: 'walk 10,000 steps', note: 'Move every day', tier: 2 },
  { goal: 'sleep 7 hours, in bed by 23:00', note: 'Sleep tracked by a watch', tier: 3 },
]
const TIMINGS = [
  { v: '60:20', label: '60-second demo days (basic only)', demo: true },
  { v: '120:30', label: '2-minute demo days', demo: true },
  { v: '86400:3600', label: 'real days (±1 hour window)', demo: false },
]
const TIER_UI: { tier: Tier; title: string; body: string; beta?: boolean }[] = [
  { tier: 0, title: 'Basic', body: 'Tap check in inside the window. For casual pools between friends.' },
  { tier: 1, title: 'Wake-up ring', body: 'Rings at a random moment in the window. Answer a quick question and sign it with your wallet in time.' },
  { tier: 2, title: 'Phone health app', body: 'Counts device-recorded steps from Health Connect or Apple Health. Manual entries don’t count.', beta: true },
  { tier: 3, title: 'Smartwatch', body: 'Sleep must be recorded by a watch, ring or band, started on time and long enough.', beta: true },
]

/** Next occurrence of HH:MM local time that is at least `minAhead` seconds away. */
function nextAt(hhmm: string, minAhead: number) {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date(); d.setSeconds(0, 0); d.setHours(h, m)
  let t = Math.floor(d.getTime() / 1000)
  while (t < Math.floor(Date.now() / 1000) + minAhead) t += 86400
  return t
}
const minutesBetween = (fromHHMM: string, toHHMM: string) => {
  const [a, b] = fromHHMM.split(':').map(Number), [c, d] = toHHMM.split(':').map(Number)
  return (((c * 60 + d) - (a * 60 + b)) % 1440 + 1440) % 1440
}

export function Pledge() {
  const { isConnected } = useConnection()
  const beta = /[?&]beta=1/.test(location.hash) || /[?&]beta=1/.test(location.search)
  const [tier, setTier] = useState<Tier>(1)
  const [goal, setGoal] = useState(TEMPLATES[0].goal)
  const [days, setDays] = useState('3')
  const [stake, setStake] = useState('0.1')
  const [max, setMax] = useState('4')
  const [startIn, setStartIn] = useState('2')
  const [timing, setTiming] = useState(TIMINGS[1].v)
  const [checkAt, setCheckAt] = useState('07:30')
  const [steps, setSteps] = useState('10000')
  const [sleepH, setSleepH] = useState('7')
  const [bedBy, setBedBy] = useState('23:00')
  const { send, status } = useTx()

  const realOnly = tier >= 2
  const t = realOnly ? '86400:3600' : timing
  const [dl, win] = t.split(':').map(Number)
  const isReal = dl >= 86400
  const opts = tier === 2 ? { steps: Number(steps) } : tier === 3 ? { sleepMin: Math.round(Number(sleepH) * 60), byMin: minutesBetween(bedBy, checkAt) } : {}
  const g = goal.trim().charAt(0).toUpperCase() + goal.trim().slice(1)
  const encoded = encodeGoal(g, tier, opts)
  const tooLong = goalBytes(encoded) > 80
  // the contract needs startTime > block.timestamp + window; keep a buffer for wallet and block latency
  const SAFETY = 30
  const stakeOk = /^(\d+\.?\d{0,18}|\.\d{1,18})$/.test(stake) && Number(stake) > 0
  const tier3Bad = tier === 3 && (opts.byMin! < opts.sleepMin! || opts.byMin! > 16 * 60)
  const valid = g.length > 0 && !tooLong && stakeOk && (isReal || Number(startIn) * 60 >= win + SAFETY) &&
    (tier !== 2 || Number(steps) >= 100) && !tier3Bad

  function pickTemplate(tpl: (typeof TEMPLATES)[number]) {
    setGoal(tpl.goal)
    if (tpl.tier !== 0 && timing === '60:20') setTiming('120:30')
    if (tpl.tier <= 1 || beta) setTier(tpl.tier)
    if (tpl.tier === 3) { setBedBy('23:00'); setSleepH('7'); setCheckAt('07:30') }
  }

  async function create() {
    let wei: bigint
    try { wei = parseEther(stake) } catch { return }
    const start = BigInt(isReal ? nextAt(checkAt, win + 120 + SAFETY) : Math.floor(Date.now() / 1000) + Math.round(Number(startIn) * 60))
    const r = await send('createPool', [encoded, wei, start, dl, win, Number(days), Number(max)], wei, 'Pool created. Share the invite with your friends.')
    if (r) {
      const ev = parseEventLogs({ abi, logs: r.logs, eventName: 'PoolCreated' })[0]
      if (ev) go(`#/pool/${ev.args.poolId}`)
    }
  }

  return (
    <section className="pledge" id="start">
      <h2>Make a pledge</h2>
      <div className="templates" role="list" aria-label="Pledge ideas">
        {TEMPLATES.filter((x) => x.tier <= 1 || beta).map((x) => (
          <button key={x.goal} role="listitem" className={`chip${goal === x.goal ? ' on' : ''}`} onClick={() => pickTemplate(x)}>{x.note}</button>
        ))}
      </div>

      <fieldset className="tiers">
        <legend>How should check-ins be verified?</legend>
        {TIER_UI.map((x) => {
          const locked = x.beta && !beta
          return (
            <label key={x.tier} className={`tiercard${tier === x.tier ? ' on' : ''}${locked ? ' locked' : ''}`}>
              <input type="radio" name="tier" value={x.tier} checked={tier === x.tier} disabled={locked} onChange={() => { setTier(x.tier); if (x.tier !== 0 && timing === '60:20') setTiming('120:30') }} />
              <span className="tt">{x.tier === 0 ? x.title : `Tier ${x.tier} · ${x.title}`}{x.beta && <span className="beta">{locked ? 'needs the companion app' : 'beta'}</span>}</span>
              <span className="tb">{x.body}</span>
            </label>
          )
        })}
      </fieldset>

      <p className="sentence">
        I will <input aria-label="Goal" className="w-goal" value={goal} maxLength={70} onChange={(e) => setGoal(e.target.value)} />
        {' '}for <select aria-label="Days" value={days} onChange={(e) => setDays(e.target.value)}>{[1, 2, 3, 5, 7, 14, 21, 30].map((d) => <option key={d}>{d}</option>)}</select> days,
        and I’ll put <input aria-label="Stake in MON" className="w-num" inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value)} /> MON on it.
        {' '}Up to <select aria-label="Max members" value={max} onChange={(e) => setMax(e.target.value)}>{[2, 3, 4, 5, 8, 10, 20].map((d) => <option key={d}>{d}</option>)}</select> friends can join me.
        {tier === 2 && <>{' '}A day counts when my phone or watch records at least <input aria-label="Steps per day" className="w-mid" inputMode="numeric" value={steps} onChange={(e) => setSteps(e.target.value.replace(/\D/g, ''))} /> steps.</>}
        {tier === 3 && <>{' '}A day counts when my wearable shows I was asleep by <input aria-label="Asleep by" type="time" className="w-time" value={bedBy} onChange={(e) => setBedBy(e.target.value)} /> for at least <input aria-label="Hours of sleep" className="w-num" inputMode="decimal" value={sleepH} onChange={(e) => setSleepH(e.target.value)} /> hours.</>}
        {isReal
          ? <>{' '}I’ll check in each day around <input aria-label="Daily check-in time" type="time" className="w-time" value={checkAt} onChange={(e) => setCheckAt(e.target.value)} />.</>
          : <>{' '}The first check-in is in <input aria-label="Minutes until first check-in" className="w-num" inputMode="numeric" value={startIn} onChange={(e) => setStartIn(e.target.value)} /> minutes,</>}
        {!realOnly && <>{' '}using <select aria-label="Day length" value={timing} onChange={(e) => setTiming(e.target.value)}>{TIMINGS.filter((x) => tier === 0 || x.v !== '60:20').map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}</select>.</>}
      </p>

      <p className="hint fine">
        Friends can join until the first check-in window opens. Each day you have ±{win >= 3600 ? `${win / 3600} hour` : `${win} seconds`} around the check-in time.
        {tier === 1 && ' The ring comes at a random moment inside that window, so keep the page open.'}
        {tier >= 2 && ' Health-data pools always use real days, because your phone records one day at a time.'}
        {' '}Miss a day and your stake goes to the people who didn’t. If everyone finishes, everyone gets their stake back and nobody pays a fee.
      </p>
      {isConnected
        ? <button className="btn sun big" onClick={create} disabled={status.kind === 'pending' || !valid}>Sign the pledge and lock {stake || '0'} MON</button>
        : <a className="btn ink big" href="#/start?next=%2Fnew">Connect a wallet to sign the pledge</a>}
      {tooLong && <p className="hint broke">That goal is too long to store on-chain. Shorten it a little.</p>}
      {tier3Bad && <p className="hint broke">The check-in time must come after your bedtime plus the hours of sleep (within 16 hours).</p>}
      {!isReal && !(Number(startIn) * 60 >= win + SAFETY) && <p className="hint broke">Set the first check-in at least {Math.ceil(((win + SAFETY) / 60) * 10) / 10} minutes away so friends have time to join.</p>}
      {!stakeOk && <p className="hint broke">Use a plain positive stake, like 0.1.</p>}
      <TxLine s={status} />
    </section>
  )
}
