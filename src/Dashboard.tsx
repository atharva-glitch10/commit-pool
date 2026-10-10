import { useConnection, useReadContracts } from 'wagmi'
import { abi } from './abi'
import { POOL_ADDRESS } from './config'
import { allMask, mon, phaseOf, useNow, useRecentPools, type PoolRow } from './lib'
import { Empty } from './ui'
import { Feed, Ledger } from './Feed'
import { displayName } from './names'

function PoolCard({ p, mask, mine }: { p: PoolRow; mask?: number; mine?: boolean }) {
  const now = useNow()
  const ph = phaseOf(p, now)
  const kept = mask === undefined ? null : Array.from({ length: p.days }, (_, d) => (mask & (1 << d)) !== 0).filter(Boolean).length
  return (
    <a className={`poolcard ph-${ph.key}`} href={`#/pool/${p.id}`}>
      <span className="pc-goal">{p.goal}</span>
      <span className="pc-meta">{p.memberCount}/{p.maxMembers} people · {mon(p.stake)} MON each · {p.days} {p.days === 1 ? 'day' : 'days'}</span>
      <span className="pc-foot">
        <span className={`pill ph-${ph.key}`}>{ph.label}</span>
        {mine && kept !== null && <span className="pc-mine">You: {kept}/{p.days}{p.settled ? (mask === allMask(p) ? ', won' : ', forfeited') : ''}</span>}
      </span>
    </a>
  )
}

export function Dashboard() {
  const { address } = useConnection()
  const now = useNow()
  const { count, pools } = useRecentPools(24)
  const me = address?.toLowerCase()
  const minePools = pools.filter(({ members }) => me && members.some((m) => m.toLowerCase() === me))
  const { data: myStates } = useReadContracts({
    contracts: minePools.map(({ pool }) => ({ address: POOL_ADDRESS, abi, functionName: 'memberState', args: [pool.id, address!] }) as const),
    query: { enabled: !!address && minePools.length > 0, refetchInterval: 4000 },
  })
  const open = pools.filter(({ pool, members }) => phaseOf(pool, now).key === 'joining' && pool.memberCount < pool.maxMembers && !(me && members.some((m) => m.toLowerCase() === me)))
  const others = pools.filter((x) => !minePools.includes(x) && !open.includes(x)).slice(0, 8)

  return (
    <div className="dash">
      <div className="dashmain">
        <div className="dashhead">
          <h1 className="h2">Pools</h1>
          <a className="btn sun" href="#/new">New pledge</a>
        </div>
        <Ledger />

        <h2 className="h3">Your pools</h2>
        {!address ? (
          <Empty title="Connect a wallet to see the pools you’re in."><a className="btn ink" href="#/start?next=%2Fapp">Connect wallet</a></Empty>
        ) : minePools.length === 0 ? (
          <Empty title="You’re not in any pool yet." cta={{ label: 'Make your first pledge', to: '#/new' }}>
            <p className="hint">Or join one of the open pools below.</p>
          </Empty>
        ) : (
          <div className="cards">{minePools.map(({ pool }, i) => <PoolCard key={String(pool.id)} p={pool} mine mask={myStates?.[i]?.result?.[2]} />)}</div>
        )}

        <h2 className="h3">Open to join</h2>
        {open.length === 0
          ? <p className="hint">No pools are taking new members right now. Start one and share the link.</p>
          : <div className="cards">{open.map(({ pool }) => <PoolCard key={String(pool.id)} p={pool} />)}</div>}

        {others.length > 0 && (
          <>
            <h2 className="h3">Recently on CommitPool</h2>
            <div className="cards">{others.map(({ pool }) => <PoolCard key={String(pool.id)} p={pool} />)}</div>
          </>
        )}
        {count === 0n && <Empty title="No pools exist yet." cta={{ label: 'Make the first pledge', to: '#/new' }} />}
      </div>
      <aside className="side"><Feed /></aside>
    </div>
  )
}

export function Leaderboard() {
  const { address } = useConnection()
  const { pools } = useRecentPools(30)
  const pairs = pools.flatMap(({ pool, members }) => members.map((m) => ({ pool, m })))
  const { data: states } = useReadContracts({
    contracts: pairs.map(({ pool, m }) => ({ address: POOL_ADDRESS, abi, functionName: 'memberState', args: [pool.id, m] }) as const),
    query: { enabled: pairs.length > 0, refetchInterval: 6000 },
  })
  const table = new Map<string, { addr: string; kept: number; finished: number; lost: number; net: bigint }>()
  pairs.forEach(({ pool, m }, i) => {
    const mask = states?.[i]?.result?.[2] ?? 0
    const row = table.get(m) ?? { addr: m, kept: 0, finished: 0, lost: 0, net: 0n }
    row.kept += Array.from({ length: pool.days }, (_, d) => (mask & (1 << d)) !== 0).filter(Boolean).length
    if (pool.settled) {
      if (pool.winners > 0 && mask === allMask(pool)) { row.finished++; row.net += pool.payout - pool.stake }
      else if (pool.winners > 0) { row.lost++; row.net -= pool.stake }
      else row.net += pool.payout - pool.stake
    }
    table.set(m, row)
  })
  const rows = [...table.values()].sort((a, b) => b.finished - a.finished || b.kept - a.kept || Number(b.net - a.net)).slice(0, 15)
  return (
    <div className="dash">
      <div className="dashmain">
        <h1 className="h2">Who keeps their word</h1>
        <p className="lede">Ranked by challenges finished, then days kept, across the last 30 pools. Read straight from the contract.</p>
        {rows.length === 0 ? <Empty title="Nobody has checked in yet." cta={{ label: 'Be the first', to: '#/new' }} /> : (
          <table className="board">
            <thead><tr><th scope="col">#</th><th scope="col">Member</th><th scope="col">Finished</th><th scope="col">Days kept</th><th scope="col">Forfeited</th><th scope="col">Net MON</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.addr} className={address && r.addr.toLowerCase() === address.toLowerCase() ? 'me' : ''}>
                  <td>{i + 1}</td>
                  <td title={r.addr}>{address && r.addr.toLowerCase() === address.toLowerCase() ? `You (${displayName(r.addr)})` : displayName(r.addr)}</td>
                  <td>{r.finished}</td>
                  <td>{r.kept}</td>
                  <td>{r.lost}</td>
                  <td className={r.net > 0n ? 'pos' : r.net < 0n ? 'neg' : ''}>{r.net > 0n ? '+' : r.net < 0n ? '−' : ''}{mon(r.net < 0n ? -r.net : r.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <aside className="side"><Feed /></aside>
    </div>
  )
}
