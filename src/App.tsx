import { useEffect, useState } from 'react'
import {
  useBalance, useConnect, useConnection, useConnectors, useDisconnect,
  usePublicClient, useReadContract, useReadContracts, useSwitchChain, useWatchContractEvent, useWriteContract,
} from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { BaseError, formatEther, parseEther, parseEventLogs, zeroAddress } from 'viem'
import { monadTestnet } from 'viem/chains'
import { abi } from './abi'
import { EXPLORER, POOL_ADDRESS } from './config'

const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '')
const errMsg = (e: unknown) => {
  const m = e instanceof BaseError ? e.shortMessage : (e as Error)?.message ?? String(e)
  if (/User rejected|denied/i.test(m)) return 'You cancelled the transaction in your wallet.'
  if (/insufficient funds/i.test(m)) return 'Not enough MON in this wallet for the stake plus gas.'
  return m
}
const mon = (v: bigint) => Number(formatEther(v)).toLocaleString(undefined, { maximumFractionDigits: 4 })

function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}
function clock(s: number) {
  if (s <= 0) return '0:00'
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

type TxState = { kind: 'idle' | 'pending' | 'ok' | 'err'; msg?: string; hash?: string; ms?: number }

function useTx() {
  const { mutateAsync } = useWriteContract()
  const client = usePublicClient()
  const qc = useQueryClient()
  const [status, setStatus] = useState<TxState>({ kind: 'idle' })
  async function send(functionName: string, args: readonly unknown[], value?: bigint, label?: string) {
    if (!POOL_ADDRESS) return
    try {
      setStatus({ kind: 'pending', msg: 'Approve it in your wallet…' })
      const hash = await mutateAsync({ address: POOL_ADDRESS, abi, functionName, args, value } as never)
      const t0 = performance.now()
      setStatus({ kind: 'pending', msg: 'Sent. Waiting for the block…', hash })
      const receipt = await client!.waitForTransactionReceipt({ hash, pollingInterval: 250 })
      const ms = Math.round(performance.now() - t0)
      if (receipt.status !== 'success') throw new Error('The transaction was reverted by the contract.')
      setStatus({ kind: 'ok', msg: label ?? 'Done', hash, ms })
      await qc.invalidateQueries()
      return receipt
    } catch (e) {
      setStatus({ kind: 'err', msg: errMsg(e) })
    }
  }
  return { send, status, setStatus }
}

function TxLine({ s }: { s: TxState }) {
  if (s.kind === 'idle') return null
  return (
    <p className={`txline ${s.kind}`} role="status">
      {s.msg}
      {s.ms !== undefined && <> · confirmed in <strong>{(s.ms / 1000).toFixed(2)}s</strong></>}
      {s.hash && <> · <a href={`${EXPLORER}/tx/${s.hash}`} target="_blank" rel="noreferrer">see transaction</a></>}
    </p>
  )
}

// ─────────────── wallet ───────────────
function Wallet() {
  const { address, isConnected, chainId } = useConnection()
  const connectors = useConnectors()
  const { mutate: connect } = useConnect()
  const { mutate: disconnect } = useDisconnect()
  const { mutate: switchChain } = useSwitchChain()
  const { data: bal } = useBalance({ address, chainId: monadTestnet.id, query: { refetchInterval: 6000 } })
  if (!isConnected) {
    const hasWallet = !!(window as { ethereum?: unknown }).ethereum
    return hasWallet
      ? <button className="btn ink" onClick={() => connect({ connector: connectors[0] })}>Connect wallet</button>
      : <a className="btn ink" href="https://metamask.io/download/" target="_blank" rel="noreferrer">Install MetaMask</a>
  }
  if (chainId !== monadTestnet.id) return <button className="btn flare" onClick={() => switchChain({ chainId: monadTestnet.id })}>Switch to Monad Testnet</button>
  return (
    <button className="walletchip" onClick={() => disconnect()} title="Disconnect">
      <span className="dot" aria-hidden />{short(address)}
      {bal && <span className="bal">{mon(bal.value)} MON</span>}
    </button>
  )
}

// ─────────────── the dial ───────────────
type Ring = { label: string; mask: number; me: boolean }
function Dial({ rings, days, now, deadline, win, center }: {
  rings: Ring[]; days: number; now: number; deadline: (d: number) => number; win: number; center: React.ReactNode
}) {
  const size = 360, c = size / 2
  const outer = 168, gap = 4, n = Math.max(rings.length, 1)
  const thick = Math.min(22, (outer - 78) / n - gap)
  const segGap = days > 1 ? 4 : 0 // degrees
  const arc = (r: number, a0: number, a1: number) => {
    const rad = (a: number) => ((a - 90) * Math.PI) / 180
    const x0 = c + r * Math.cos(rad(a0)), y0 = c + r * Math.sin(rad(a0))
    const x1 = c + r * Math.cos(rad(a1)), y1 = c + r * Math.sin(rad(a1))
    return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`
  }
  const per = 360 / days
  return (
    <div className="dial">
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Progress of each member, one ring per member, one arc per day">
        {rings.map((ring, i) => {
          const r = outer - i * (thick + gap) - thick / 2
          return Array.from({ length: days }, (_, d) => {
            const a0 = d * per + segGap / 2, a1 = (d + 1) * per - segGap / 2 - (days === 1 ? 0.01 : 0)
            const ok = (ring.mask & (1 << d)) !== 0
            const past = now > deadline(d) + win
            const open = now >= deadline(d) - win && now <= deadline(d) + win
            const cls = ok ? 'seg kept' : past ? 'seg broke' : open ? 'seg open' : 'seg ahead'
            return <path key={`${i}-${d}`} d={arc(r, a0, a1)} className={cls} strokeWidth={thick} fill="none" strokeLinecap="butt" />
          })
        })}
      </svg>
      <div className="dialcenter">{center}</div>
    </div>
  )
}

// ─────────────── pool ───────────────
function Pool({ id }: { id: bigint }) {
  const { address } = useConnection()
  const now = useNow()
  const { send, status, setStatus } = useTx()
  const base = { address: POOL_ADDRESS!, abi } as const
  const poll = { refetchInterval: 2500 }
  const { data: pool } = useReadContract({ ...base, functionName: 'pools', args: [id], query: poll })
  const { data: members = [] } = useReadContract({ ...base, functionName: 'getMembers', args: [id], query: poll })
  const { data: states } = useReadContracts({
    contracts: members.map((m) => ({ ...base, functionName: 'memberState', args: [id, m] }) as const),
    query: poll,
  })

  if (!pool) return <div className="pool loading">Reading pool {id.toString()} from the chain…</div>
  const [creator, stake, startTime, dayLength, window_, numDays, maxMembers, memberCount, winners, settled, cancelled, payout, goal] = pool
  if (creator === zeroAddress) return <div className="pool loading">There is no pool {id.toString()} yet. Start one below.</div>

  const start = Number(startTime), day = Number(dayLength), win = Number(window_), nd = Number(numDays)
  const deadline = (d: number) => start + d * day
  const joinBy = start - win
  const end = deadline(nd - 1) + win
  const all = (1 << nd) - 1
  let openDay = -1
  for (let d = 0; d < nd; d++) if (now >= deadline(d) - win && now <= deadline(d) + win) openDay = d
  const nextDay = Array.from({ length: nd }, (_, d) => d).find((d) => deadline(d) + win >= now)
  const meIdx = address ? members.findIndex((m) => m.toLowerCase() === address.toLowerCase()) : -1
  const mine = meIdx >= 0 ? states?.[meIdx]?.result : undefined
  const isMember = meIdx >= 0
  const pot = stake * BigInt(memberCount)
  const demo = day < 86400

  // centre of the dial
  let big: string, small: string
  if (cancelled) { big = 'Off'; small = 'Not enough people joined. Everyone gets refunded.' }
  else if (settled) { big = `${winners}/${memberCount}`; small = winners > 0 ? `kept their word and get ${mon(payout)} MON each` : `kept it, so everyone gets ${mon(payout)} MON back` }
  else if (now < joinBy) { big = clock(joinBy - now); small = 'until joining closes' }
  else if (memberCount < 2) { big = 'Too few'; small = 'Cancel to refund the stake' }
  else if (openDay >= 0) { big = clock(deadline(openDay) + win - now); small = `left to check in for day ${openDay + 1}` }
  else if (nextDay !== undefined) { big = clock(deadline(nextDay) - win - now); small = `until day ${nextDay + 1} opens` }
  else if (now <= end) { big = '…'; small = 'Closing the last day' }
  else { big = 'Done'; small = 'Ready to pay out' }

  const rings: Ring[] = members.map((m, i) => ({ label: short(m), mask: states?.[i]?.result?.[2] ?? 0, me: i === meIdx }))
  const canClaim = isMember && mine && !mine[1] && (cancelled || (settled && (winners > 0 ? mine[2] === all : payout > 0n)))
  const needsCheckIn = isMember && openDay >= 0 && mine && (mine[2] & (1 << openDay)) === 0 && !cancelled && memberCount >= 2
  const checkedToday = isMember && openDay >= 0 && mine && (mine[2] & (1 << openDay)) !== 0

  async function checkIn() {
    setStatus({ kind: 'pending', msg: 'Reading your device and asking the oracle to sign…' })
    try {
      const r = await fetch('/api/attest', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ poolId: id.toString(), member: address, device: { source: 'phone', at: Math.floor(Date.now() / 1000) } }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'The oracle refused this check-in.')
      await send('submit', [id, j.signature], undefined, `Day ${openDay + 1} kept. It's on-chain.`)
    } catch (e) {
      setStatus({ kind: 'err', msg: errMsg(e) })
    }
  }

  let action: React.ReactNode = null
  if (!address) action = <p className="hint">Connect a wallet to join or check in.</p>
  else if (!isMember && !cancelled && now < joinBy && memberCount < maxMembers)
    action = <button className="btn sun big" onClick={() => send('joinPool', [id], stake, 'You’re in. Your stake is locked.')} disabled={status.kind === 'pending'}>Join with {mon(stake)} MON</button>
  else if (needsCheckIn)
    action = <button className="btn sun big" onClick={checkIn} disabled={status.kind === 'pending'}>Check in for day {openDay + 1}</button>
  else if (checkedToday) action = <p className="hint ok">Day {openDay + 1} is kept. See you at the next deadline.</p>
  else if (!cancelled && memberCount < 2 && now >= joinBy)
    action = <button className="btn ink big" onClick={() => send('cancelUnderfilled', [id], undefined, 'Pool cancelled. Claim your refund.')}>Cancel and refund</button>
  else if (!settled && !cancelled && memberCount >= 2 && now > end)
    action = <button className="btn ink big" onClick={() => send('settle', [id], undefined, 'Paid out. Winners can claim now.')}>Pay out the pool</button>
  else if (canClaim)
    action = <button className="btn sun big" onClick={() => send('claim', [id], undefined, 'Sent to your wallet.')}>Claim {mon(cancelled ? stake : payout)} MON</button>
  else if (isMember && mine?.[1]) action = <p className="hint ok">You’ve claimed your payout.</p>
  else if (isMember && settled && winners > 0) action = <p className="hint broke">You missed a day, so your stake went to the people who didn’t.</p>
  else if (!isMember) action = <p className="hint">This pool is already underway. <a href="#start">Make your own pledge</a> to start one.</p>

  return (
    <div className="pool">
      <div className="poolhead">
        <p className="poolid">Pool {id.toString()}{demo && <span className="demo">demo days of {day}s</span>}</p>
        <h2 className="goal">{goal}</h2>
        <p className="terms">
          {memberCount} of {maxMembers} people, {mon(stake)} MON each, {nd} {nd === 1 ? 'day' : 'days'}.
          {' '}<strong>{mon(pot)} MON</strong> locked in the contract.
        </p>
      </div>
      <Dial rings={rings} days={nd} now={now} deadline={deadline} win={win} center={<><span className="big">{big}</span><span className="small">{small}</span></>} />
      <ol className="people">
        {members.map((m, i) => {
          const mask = states?.[i]?.result?.[2] ?? 0
          const kept = Array.from({ length: nd }, (_, d) => (mask & (1 << d)) !== 0).filter(Boolean).length
          const missed = Array.from({ length: nd }, (_, d) => now > deadline(d) + win && !(mask & (1 << d))).some(Boolean)
          return (
            <li key={m} className={missed ? 'broke' : mask === all ? 'kept' : ''}>
              <span className="who">{i === meIdx ? 'You' : short(m)}{m === creator && <span className="tag">started it</span>}</span>
              <span className="score">{kept}/{nd} kept{missed ? ', stake forfeited' : mask === all && settled ? ', winner' : ''}</span>
            </li>
          )
        })}
      </ol>
      <div className="act">{action}</div>
      <TxLine s={status} />
      <p className="share">Invite friends: <span className="url">{location.origin}/?pool={id.toString()}</span></p>
    </div>
  )
}

// ─────────────── live feed ───────────────
type FeedItem = { key: string; text: string; tx: string; tone: string }
function toItems(logs: readonly unknown[]): FeedItem[] {
  return logs.map((raw) => {
        const l = raw as { args: Record<string, unknown>; eventName: string; transactionHash: string; logIndex: number }
        const { args: a, eventName: ev } = l
        const p = String(a.poolId ?? '')
        let text = `${ev} in pool ${p}`, tone = ''
        if (ev === 'DayVerified') { text = `${short(a.member as string)} kept day ${Number(a.day) + 1} in pool ${p}`; tone = 'kept' }
        else if (ev === 'Joined') text = `${short(a.member as string)} put money on pool ${p}`
        else if (ev === 'PoolCreated') text = `New pool ${p}: “${a.goal}”`
        else if (ev === 'PoolSettled') { text = `Pool ${p} paid out to ${a.winners} ${Number(a.winners) === 1 ? 'person' : 'people'}`; tone = 'kept' }
        else if (ev === 'Claimed') text = `${short(a.member as string)} withdrew ${mon(a.amount as bigint)} MON`
        else if (ev === 'FeesWithdrawn') text = `${mon(a.amount as bigint)} MON in fees went to the treasury`
        return { key: `${l.transactionHash}-${l.logIndex}`, text, tx: l.transactionHash, tone }
      })
}
function Feed() {
  const [items, setItems] = useState<FeedItem[]>([])
  const client = usePublicClient()
  useEffect(() => {
    // show the last few minutes of history on load (best effort: some RPCs limit log ranges)
    let off = false
    ;(async () => {
      try {
        const latest = await client!.getBlockNumber()
        const logs = await client!.getContractEvents({ address: POOL_ADDRESS!, abi, fromBlock: latest > 900n ? latest - 900n : 0n, toBlock: latest })
        if (!off) setItems((prev) => (prev.length ? prev : toItems(logs).reverse().slice(0, 9)))
      } catch { /* live updates still work */ }
    })()
    return () => { off = true }
  }, [client])
  useWatchContractEvent({
    address: POOL_ADDRESS, abi, pollingInterval: 1000,
    onLogs(logs) {
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.key))
        return [...toItems(logs).reverse().filter((i) => !seen.has(i.key)), ...prev].slice(0, 9)
      })
    },
  })
  return (
    <section className="feed" aria-live="polite">
      <h3>Happening on Monad right now</h3>
      {items.length === 0
        ? <p className="hint">Every check-in, join and payout shows up here the moment its block lands.</p>
        : <ul>{items.map((i) => <li key={i.key} className={i.tone}><a href={`${EXPLORER}/tx/${i.tx}`} target="_blank" rel="noreferrer">{i.text}</a></li>)}</ul>}
    </section>
  )
}

// ─────────────── numbers as a sentence ───────────────
function Ledger() {
  const base = { address: POOL_ADDRESS!, abi } as const
  const { data } = useReadContracts({
    contracts: [{ ...base, functionName: 'poolCount' }, { ...base, functionName: 'totalStaked' }, { ...base, functionName: 'feesAccrued' }, { ...base, functionName: 'feeBps' }],
    query: { refetchInterval: 5000 },
  })
  const [count, staked, fees, bps] = data?.map((d) => d.result) ?? []
  if (count === undefined) return null
  return (
    <p className="ledger">
      <strong>{String(count)}</strong> {count === 1n ? 'pool has' : 'pools have'} locked <strong>{mon(staked as bigint)} MON</strong> so far.
      The protocol has earned <strong>{mon(fees as bigint)} MON</strong>, all of it a {Number(bps) / 100}% cut of stakes from people who quit.
      People who keep their word never pay a fee.
    </p>
  )
}

// ─────────────── pledge form ───────────────
const TIMINGS = [
  { v: '60:20', label: '60-second demo days' },
  { v: '120:30', label: '2-minute demo days' },
  { v: '86400:3600', label: 'real days (±1 hour)' },
]
function Pledge({ onCreated }: { onCreated: (id: bigint) => void }) {
  const { isConnected } = useConnection()
  const [goal, setGoal] = useState('be in bed by 23:00')
  const [days, setDays] = useState('3')
  const [stake, setStake] = useState('0.1')
  const [max, setMax] = useState('4')
  const [startIn, setStartIn] = useState('2')
  const [timing, setTiming] = useState(TIMINGS[0].v)
  const { send, status } = useTx()
  async function create() {
    const wei = parseEther(stake || '0')
    const [dl, win] = timing.split(':').map(Number)
    const start = BigInt(Math.floor(Date.now() / 1000) + Math.round(Number(startIn) * 60))
    const g = goal.charAt(0).toUpperCase() + goal.slice(1)
    const r = await send('createPool', [g, wei, start, dl, win, Number(days), Number(max)], wei, 'Pool created. Send the link to your friends.')
    if (r) {
      const ev = parseEventLogs({ abi, logs: r.logs, eventName: 'PoolCreated' })[0]
      if (ev) onCreated(ev.args.poolId)
    }
  }
  return (
    <section className="pledge" id="start">
      <h2>Make a pledge</h2>
      <p className="sentence">
        I will <input aria-label="Goal" className="w-goal" value={goal} maxLength={80} onChange={(e) => setGoal(e.target.value)} />
        {' '}for <select aria-label="Days" value={days} onChange={(e) => setDays(e.target.value)}>{[1, 2, 3, 5, 7, 14, 21, 30].map((d) => <option key={d}>{d}</option>)}</select> days,
        and I’ll put <input aria-label="Stake in MON" className="w-num" inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value)} /> MON on it.
        {' '}Up to <select aria-label="Max members" value={max} onChange={(e) => setMax(e.target.value)}>{[2, 3, 4, 5, 8, 10, 20].map((d) => <option key={d}>{d}</option>)}</select> friends can join me.
        {' '}The first check-in is in <input aria-label="Minutes until first check-in" className="w-num" inputMode="numeric" value={startIn} onChange={(e) => setStartIn(e.target.value)} /> minutes,
        using <select aria-label="Day length" value={timing} onChange={(e) => setTiming(e.target.value)}>{TIMINGS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}</select>.
      </p>
      {isConnected
        ? <button className="btn sun big" onClick={create} disabled={status.kind === 'pending'}>Sign the pledge and lock {stake || '0'} MON</button>
        : <p className="hint">Connect a wallet at the top to sign a pledge.</p>}
      <TxLine s={status} />
    </section>
  )
}

// ─────────────── page ───────────────
export default function App() {
  const [poolId, setPoolId] = useState<bigint | null>(() => {
    const p = new URLSearchParams(location.search).get('pool')
    return p && /^\d+$/.test(p) ? BigInt(p) : null
  })
  const [jump, setJump] = useState('')
  const { data: count } = useReadContract({ address: POOL_ADDRESS, abi, functionName: 'poolCount', query: { enabled: !!POOL_ADDRESS, refetchInterval: 5000 } })
  const shown = poolId ?? (count && count > 0n ? count : null)
  const open = (id: bigint) => { setPoolId(id); history.replaceState(null, '', `?pool=${id}`) }

  return (
    <>
      <header className="top">
        <a className="mark" href="/">commitpool</a>
        <Wallet />
      </header>
      <main>
        <section className="hero">
          <div className="pitch">
            <h1>Keep your word, or pay the friends who kept theirs.</h1>
            <p className="lede">Pick a habit, put money on it with friends, and check in every day from your phone. A contract on Monad holds the pot and pays whoever finishes.</p>
            <ol className="steps">
              <li><strong>Lock a stake.</strong> Everyone in the pool puts in the same amount. Nobody, including us, can touch it.</li>
              <li><strong>Prove it daily.</strong> Your device vouches for you inside each day’s window. Friends can’t fake it for you.</li>
              <li><strong>Get paid.</strong> Finishers split the stakes of anyone who quit.</li>
            </ol>
            <a className="btn ink" href="#start">Make a pledge</a>
          </div>
          <div className="stage">
            {!POOL_ADDRESS
              ? <div className="pool loading">Set VITE_POOL_ADDRESS to the deployed contract.</div>
              : shown !== null ? <Pool id={shown} key={shown.toString()} /> : <div className="pool loading">No pools yet. Be the first to make a pledge.</div>}
            {count !== undefined && count > 0n && (
              <nav className="jump" aria-label="Other pools">
                <span>Other pools</span>
                {Array.from({ length: Math.min(6, Number(count)) }, (_, i) => count - BigInt(i)).map((id) => (
                  <button key={id.toString()} className={id === shown ? 'on' : ''} onClick={() => open(id)}>{id.toString()}</button>
                ))}
                <form onSubmit={(e) => { e.preventDefault(); if (jump) open(BigInt(jump)) }}>
                  <input aria-label="Pool number" placeholder="#" value={jump} onChange={(e) => setJump(e.target.value.replace(/\D/g, ''))} />
                </form>
              </nav>
            )}
          </div>
        </section>
        {POOL_ADDRESS && <Ledger />}
        <div className="lower">
          <Pledge onCreated={open} />
          {POOL_ADDRESS && <Feed />}
        </div>
      </main>
      <footer>
        <p>
          Contract <a href={`${EXPLORER}/address/${POOL_ADDRESS}`} target="_blank" rel="noreferrer">{short(POOL_ADDRESS)}</a> on Monad Testnet.
          The device oracle is simulated for this hackathon; in production it reads wearable and health-app data. Not audited.
        </p>
      </footer>
    </>
  )
}
