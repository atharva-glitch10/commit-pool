import { useEffect, useState } from 'react'
import { useConnection, useReadContract, useReadContracts } from 'wagmi'
import QRCode from 'qrcode'
import { abi } from './abi'
import { POOL_ADDRESS } from './config'
import { allMask, base, clock, deadlineOf, dur, errMsg, mon, toPool, TxLine, useNow, useTx, type PoolRow } from './lib'
import { poolLink } from './router'
import { Dial } from './ui'
import { Feed } from './Feed'
import { HabitPanel } from './HabitPanel'
import { displayName } from './names'

export function PoolPage({ id }: { id: bigint }) {
  return (
    <div className="poolpage">
      <div className="poolmain">
        <PoolPanel id={id} />
        <HabitPanel id={id} />
      </div>
      <aside className="side">
        <Invite id={id} />
        <Feed poolId={id} title="This pool, live" />
      </aside>
    </div>
  )
}

export function PoolPanel({ id, compact = false }: { id: bigint; compact?: boolean }) {
  const { address } = useConnection()
  const now = useNow()
  const { send, status, setStatus } = useTx()
  const poll = { refetchInterval: 2500 }
  const { data: raw } = useReadContract({ ...base, functionName: 'pools', args: [id], query: poll })
  const { data: members = [] } = useReadContract({ ...base, functionName: 'getMembers', args: [id], query: poll })
  const { data: states } = useReadContracts({
    contracts: members.map((m) => ({ address: POOL_ADDRESS, abi, functionName: 'memberState', args: [id, m] }) as const),
    query: poll,
  })
  if (!raw) return <div className="pool loading">Reading pool {id.toString()} from Monad…</div>
  const p = toPool(id, raw)
  if (p.creator === '0x0000000000000000000000000000000000000000') return <div className="pool loading">There’s no pool {id.toString()} yet.</div>

  const deadline = (d: number) => deadlineOf(p, d)
  const joinBy = p.start - p.win
  const end = deadline(p.days - 1) + p.win
  const all = allMask(p)
  let openDay = -1
  for (let d = 0; d < p.days; d++) if (now >= deadline(d) - p.win && now <= deadline(d) + p.win) openDay = d
  const nextDay = Array.from({ length: p.days }, (_, d) => d).find((d) => deadline(d) + p.win >= now)
  const meIdx = address ? members.findIndex((m) => m.toLowerCase() === address.toLowerCase()) : -1
  const mine = meIdx >= 0 ? states?.[meIdx]?.result : undefined
  const isMember = meIdx >= 0
  const pot = p.stake * BigInt(p.memberCount)

  let big: string, small: string
  if (p.cancelled) { big = 'Off'; small = 'Not enough people joined. Everyone is refunded.' }
  else if (p.settled) { big = `${p.winners}/${p.memberCount}`; small = p.winners > 0 ? `kept their word and get ${mon(p.payout)} MON each` : `kept it, so everyone gets ${mon(p.payout)} MON back` }
  else if (now < joinBy) { big = clock(joinBy - now); small = 'until joining closes' }
  else if (p.memberCount < 2) { big = 'Too few'; small = 'Cancel to refund the stake' }
  else if (openDay >= 0) { big = clock(deadline(openDay) + p.win - now); small = `left to check in for day ${openDay + 1}` }
  else if (nextDay !== undefined) { big = clock(deadline(nextDay) - p.win - now); small = `until day ${nextDay + 1} opens` }
  else if (now <= end) { big = '…'; small = 'Closing the last day' }
  else { big = 'Done'; small = 'Ready to pay out' }

  const canClaim = isMember && mine && !mine[1] && (p.cancelled || (p.settled && (p.winners > 0 ? mine[2] === all : p.payout > 0n)))
  const needsCheckIn = isMember && openDay >= 0 && mine && (mine[2] & (1 << openDay)) === 0 && !p.cancelled && p.memberCount >= 2
  const checkedToday = isMember && openDay >= 0 && mine && (mine[2] & (1 << openDay)) !== 0
  const busy = status.kind === 'pending'

  async function checkIn() {
    setStatus({ kind: 'pending', msg: 'Reading your device and asking the oracle to sign…' })
    try {
      const r = await fetch('/api/attest', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ poolId: id.toString(), member: address, device: { source: 'phone', at: Math.floor(Date.now() / 1000) } }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `The oracle refused this check-in (${r.status}).`)
      await send('submit', [id, j.signature], undefined, `Day ${openDay + 1} kept. It’s on-chain.`)
    } catch (e) {
      setStatus({ kind: 'err', msg: errMsg(e) })
    }
  }

  let action: React.ReactNode = null
  if (!address) action = <a className="btn ink big" href={`#/start?next=${encodeURIComponent(`/pool/${id}`)}`}>Connect a wallet to join or check in</a>
  else if (!isMember && !p.cancelled && now < joinBy && p.memberCount < p.maxMembers)
    action = <button className="btn sun big" disabled={busy} onClick={() => send('joinPool', [id], p.stake, 'You’re in. Your stake is locked in the contract.')}>Join with {mon(p.stake)} MON</button>
  else if (needsCheckIn) action = <button className="btn sun big" disabled={busy} onClick={checkIn}>Check in for day {openDay + 1}</button>
  else if (checkedToday) action = <p className="hint ok">Day {openDay + 1} is kept. See you at the next deadline.</p>
  else if (!p.cancelled && p.memberCount < 2 && now >= joinBy)
    action = <button className="btn ink big" disabled={busy} onClick={() => send('cancelUnderfilled', [id], undefined, 'Pool cancelled. Claim your refund.')}>Cancel and refund</button>
  else if (!p.settled && !p.cancelled && p.memberCount >= 2 && now > end)
    action = <button className="btn ink big" disabled={busy} onClick={() => send('settle', [id], undefined, 'Paid out. Winners can claim now.')}>Pay out the pool</button>
  else if (canClaim) action = <button className="btn sun big" disabled={busy} onClick={() => send('claim', [id], undefined, 'Sent to your wallet.')}>Claim {mon(p.cancelled ? p.stake : p.payout)} MON</button>
  else if (isMember && mine?.[1]) action = <p className="hint ok">You’ve claimed your payout.</p>
  else if (isMember && p.settled && p.winners > 0) action = <p className="hint broke">You missed a day, so your stake went to the people who didn’t.</p>
  else if (isMember && nextDay !== undefined && !p.settled) action = <p className="hint">You’re in. Day {nextDay + 1} opens in {clock(deadline(nextDay) - p.win - now)}.</p>
  else if (!isMember) action = <p className="hint">This pool is already underway. <a href="#/new">Make your own pledge</a>.</p>

  return (
    <section className={`pool${compact ? ' compact' : ''}`} aria-label={`Pool ${id}`}>
      <div className="poolhead">
        <p className="poolid">
          <a href={`#/pool/${id}`}>Pool {id.toString()}</a>
          {p.day < 86400 && <span className="demo">demo days of {dur(p.day)}</span>}
        </p>
        <h2 className="goal">{p.goal}</h2>
        <p className="terms">
          {p.memberCount} of {p.maxMembers} people, {mon(p.stake)} MON each, {p.days} {p.days === 1 ? 'day' : 'days'}.
          {' '}<strong>{mon(pot)} MON</strong> locked in the contract.
        </p>
      </div>
      <Dial
        rings={members.map((_, i) => ({ mask: states?.[i]?.result?.[2] ?? 0, me: i === meIdx }))}
        days={p.days} now={now} deadline={deadline} win={p.win}
        size={compact ? 300 : 360}
        center={<><span className="big">{big}</span><span className="small">{small}</span></>}
      />
      {!compact && (
        <ol className="people">
          {members.map((m, i) => {
            const mask = states?.[i]?.result?.[2] ?? 0
            const kept = Array.from({ length: p.days }, (_, d) => (mask & (1 << d)) !== 0).filter(Boolean).length
            const missed = Array.from({ length: p.days }, (_, d) => now > deadline(d) + p.win && !(mask & (1 << d))).some(Boolean)
            return (
              <li key={m} className={missed ? 'broke' : mask === all ? 'kept' : ''}>
                <span className="who" title={m}>{i === meIdx ? `You (${displayName(m)})` : displayName(m)}{m === p.creator && <span className="tag">started it</span>}</span>
                <span className="score">{kept}/{p.days} kept{missed ? ', stake forfeited' : mask === all && p.settled ? ', winner' : ''}</span>
              </li>
            )
          })}
        </ol>
      )}
      <div className="act">{action}</div>
      <TxLine s={status} />
      {!compact && p.settled && <Receipt p={p} />}
    </section>
  )
}

function Receipt({ p }: { p: PoolRow }) {
  const pot = p.stake * BigInt(p.memberCount)
  const losers = p.memberCount - p.winners
  const forfeited = p.winners > 0 ? p.stake * BigInt(losers) : pot
  const paid = p.payout * BigInt(p.winners > 0 ? p.winners : p.memberCount)
  const fee = pot - paid
  return (
    <div className="receipt" aria-label="Settlement">
      <p className="rtitle">Settlement</p>
      <dl>
        <div><dt>Locked by {p.memberCount} people</dt><dd>{mon(pot)} MON</dd></div>
        <div><dt>Forfeited by {p.winners > 0 ? `${losers} who missed a day` : 'everyone'}</dt><dd>{mon(forfeited)} MON</dd></div>
        <div><dt>Protocol fee (only on forfeits)</dt><dd>{mon(fee)} MON</dd></div>
        <div className="total"><dt>Paid to {p.winners > 0 ? `${p.winners} who kept their word` : 'everyone as refunds'}</dt><dd>{mon(paid)} MON</dd></div>
      </dl>
    </div>
  )
}

function Invite({ id }: { id: bigint }) {
  const link = poolLink(id)
  const [qr, setQr] = useState('')
  const [copied, setCopied] = useState(false)
  const { data: raw } = useReadContract({ ...base, functionName: 'pools', args: [id] })
  useEffect(() => {
    QRCode.toString(link, { type: 'svg', margin: 0, color: { dark: '#13233A', light: '#00000000' } }).then(setQr).catch(() => setQr(''))
  }, [link])
  function copy() {
    navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600) }).catch(() => {})
  }
  function calendar() {
    if (!raw) return
    const p = toPool(id, raw)
    const fmt = (t: number) => new Date(t * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    const events = Array.from({ length: p.days }, (_, d) => [
      'BEGIN:VEVENT', `UID:commitpool-${id}-${d}@commitpool`, `DTSTAMP:${fmt(Math.floor(Date.now() / 1000))}`,
      `DTSTART:${fmt(deadlineOf(p, d) - p.win)}`, `DTEND:${fmt(deadlineOf(p, d) + p.win)}`,
      `SUMMARY:Check in: ${p.goal} (day ${d + 1}/${p.days})`, `DESCRIPTION:Open ${link} and tap Check in before the window closes.`, `URL:${link}`,
      'BEGIN:VALARM', 'TRIGGER:-PT5M', 'ACTION:DISPLAY', 'DESCRIPTION:CommitPool check-in opens soon', 'END:VALARM', 'END:VEVENT',
    ].join('\r\n'))
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CommitPool//EN', ...events, 'END:VCALENDAR'].join('\r\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }))
    a.download = `commitpool-${id}.ics`
    a.click()
  }
  return (
    <section className="invite">
      <h3>Bring your friends</h3>
      <div className="qr" aria-label="QR code for the invite link" dangerouslySetInnerHTML={{ __html: qr }} />
      <p className="url">{link}</p>
      <div className="row2">
        <button className="btn ghost" onClick={copy}>{copied ? 'Link copied' : 'Copy invite link'}</button>
        <button className="btn ghost" onClick={calendar} disabled={!raw}>Add check-ins to calendar</button>
      </div>
    </section>
  )
}
