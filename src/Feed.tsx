import { useEffect, useState } from 'react'
import { usePublicClient, useReadContracts, useWatchContractEvent } from 'wagmi'
import { abi } from './abi'
import { EXPLORER, POOL_ADDRESS } from './config'
import { base, mon } from './lib'
import { displayName } from './names'

type FeedItem = { key: string; text: string; tx: string; tone: string; pool: string; addr?: string }
function toItems(logs: readonly unknown[]): FeedItem[] {
  return logs.map((raw) => {
    const l = raw as { args: Record<string, unknown>; eventName: string; transactionHash: string; logIndex: number }
    const { args: a, eventName: ev } = l
    const p = String(a.poolId ?? '')
    const who = typeof a.member === 'string' ? a.member : undefined
    let text = `${ev} in pool ${p}`, tone = ''
    if (ev === 'DayVerified') { text = `${displayName(who)} kept day ${Number(a.day) + 1} in pool ${p}`; tone = 'kept' }
    else if (ev === 'Joined') text = `${displayName(who)} put money on pool ${p}`
    else if (ev === 'PoolCreated') text = `New pool ${p}: “${a.goal}”`
    else if (ev === 'PoolSettled') { text = `Pool ${p} paid out to ${a.winners} ${Number(a.winners) === 1 ? 'person' : 'people'}`; tone = 'kept' }
    else if (ev === 'Claimed') text = `${displayName(who)} withdrew ${mon(a.amount as bigint)} MON`
    else if (ev === 'PoolCancelled') text = `Pool ${p} was cancelled and refunded`
    else if (ev === 'FeesWithdrawn') text = `${mon(a.amount as bigint)} MON in fees went to the treasury`
    return { key: `${l.transactionHash}-${l.logIndex}`, text, tx: l.transactionHash, tone, pool: p, addr: who }
  })
}

export function Feed({ poolId, title = 'Happening on Monad right now', limit = 9 }: { poolId?: bigint; title?: string; limit?: number }) {
  const [items, setItems] = useState<FeedItem[]>([])
  const client = usePublicClient()
  const keep = (list: FeedItem[]) => (poolId === undefined ? list : list.filter((i) => i.pool === poolId.toString() || i.pool === ''))
  useEffect(() => {
    let off = false
    ;(async () => {
      try {
        const latest = await client!.getBlockNumber()
        const logs = await client!.getContractEvents({ address: POOL_ADDRESS, abi, fromBlock: latest > 900n ? latest - 900n : 0n, toBlock: latest })
        if (!off) setItems((prev) => (prev.length ? prev : keep(toItems(logs)).reverse().slice(0, limit)))
      } catch { /* some RPCs limit log ranges; live updates still work */ }
    })()
    return () => { off = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, poolId])
  useWatchContractEvent({
    address: POOL_ADDRESS, abi, pollingInterval: 1000,
    onLogs(logs) {
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.key))
        return [...keep(toItems(logs)).reverse().filter((i) => !seen.has(i.key)), ...prev].slice(0, limit)
      })
    },
  })
  return (
    <section className="feed" aria-live="polite">
      <h3>{title} <span className="pulse" aria-hidden /></h3>
      {items.length === 0
        ? <p className="hint">Every check-in, join and payout shows up here the moment its block lands.</p>
        : <ul>{items.map((i) => <li key={i.key} className={i.tone}><a href={`${EXPLORER}/tx/${i.tx}`} title={i.addr} target="_blank" rel="noreferrer">{i.text}</a></li>)}</ul>}
    </section>
  )
}

export function Ledger() {
  const { data } = useReadContracts({
    contracts: [{ ...base, functionName: 'poolCount' }, { ...base, functionName: 'totalStaked' }, { ...base, functionName: 'feesAccrued' }, { ...base, functionName: 'feeBps' }],
    query: { refetchInterval: 5000 },
  })
  const [count, staked, fees, bps] = data?.map((d) => d.result) ?? []
  if (count === undefined) return <p className="ledger">Reading the contract…</p>
  return (
    <p className="ledger">
      <strong>{String(count)}</strong> {count === 1n ? 'pool has' : 'pools have'} locked <strong>{mon(staked as bigint)} MON</strong> so far.
      The protocol has earned <strong>{mon(fees as bigint)} MON</strong>, all of it a {Number(bps) / 100}% cut of stakes from people who quit.
      People who keep their word never pay a fee.
    </p>
  )
}
