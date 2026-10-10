import { useEffect, useState } from 'react'
import { usePublicClient, useReadContract, useReadContracts, useWriteContract } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { BaseError, formatEther } from 'viem'
import { abi } from './abi'
import { EXPLORER, POOL_ADDRESS } from './config'

export const base = { address: POOL_ADDRESS, abi } as const

export const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '')
export const mon = (v: bigint) => Number(formatEther(v)).toLocaleString(undefined, { maximumFractionDigits: 4 })
export const errMsg = (e: unknown) => {
  const m = e instanceof BaseError ? e.shortMessage : (e as Error)?.message ?? String(e)
  if (/User rejected|denied/i.test(m)) return 'You cancelled the transaction in your wallet.'
  if (/insufficient funds/i.test(m)) return 'Not enough MON in this wallet for the stake plus network fee.'
  if (/OutsideWindow/.test(m)) return 'The check-in window for today isn’t open right now.'
  if (/JoinClosed/.test(m)) return 'Joining has closed for this pool.'
  if (/PoolFull/.test(m)) return 'This pool is full.'
  if (/AlreadyMember/.test(m)) return 'You’re already in this pool.'
  if (/WrongStake/.test(m)) return 'The amount doesn’t match the pool’s stake.'
  if (/BadParams/.test(m)) return 'Those pledge settings aren’t allowed. Check the goal, days and start time.'
  return m
}

export function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}
export function clock(s: number) {
  if (s <= 0) return '0:00'
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (d) return `${d}d ${h}h`
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}
export const dur = (s: number) => (s >= 86400 ? `${s / 86400} day${s === 86400 ? '' : 's'}` : s >= 3600 ? `${s / 3600} h` : s >= 60 ? `${s / 60} min` : `${s}s`)

// ───────── tx helper ─────────
export type TxState = { kind: 'idle' | 'pending' | 'ok' | 'err'; msg?: string; hash?: string; ms?: number }
export function useTx() {
  const { mutateAsync } = useWriteContract()
  const client = usePublicClient()
  const qc = useQueryClient()
  const [status, setStatus] = useState<TxState>({ kind: 'idle' })
  async function send(functionName: string, args: readonly unknown[], value?: bigint, label?: string) {
    try {
      setStatus({ kind: 'pending', msg: 'Approve it in your wallet…' })
      const hash = await mutateAsync({ ...base, functionName, args, value } as never)
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
export function TxLine({ s }: { s: TxState }) {
  if (s.kind === 'idle') return null
  return (
    <p className={`txline ${s.kind}`} role="status">
      {s.msg}
      {s.ms !== undefined && <> · confirmed in <strong>{(s.ms / 1000).toFixed(2)}s</strong></>}
      {s.hash && <> · <a href={`${EXPLORER}/tx/${s.hash}`} target="_blank" rel="noreferrer">see transaction</a></>}
    </p>
  )
}

// ───────── pool model ─────────
export type PoolRow = {
  id: bigint; creator: `0x${string}`; stake: bigint; start: number; day: number; win: number; days: number
  maxMembers: number; memberCount: number; winners: number; settled: boolean; cancelled: boolean; payout: bigint; goal: string
}
export function toPool(id: bigint, r: readonly unknown[]): PoolRow {
  const [creator, stake, startTime, dayLength, window_, numDays, maxMembers, memberCount, winners, settled, cancelled, payout, goal] =
    r as [`0x${string}`, bigint, bigint, number, number, number, number, number, number, boolean, boolean, bigint, string]
  return {
    id, creator, stake, start: Number(startTime), day: Number(dayLength), win: Number(window_), days: Number(numDays),
    maxMembers: Number(maxMembers), memberCount: Number(memberCount), winners: Number(winners), settled, cancelled, payout, goal,
  }
}
export const deadlineOf = (p: PoolRow, d: number) => p.start + d * p.day
export const allMask = (p: PoolRow) => (1 << p.days) - 1
export function phaseOf(p: PoolRow, now: number) {
  const joinBy = p.start - p.win
  const end = deadlineOf(p, p.days - 1) + p.win
  if (p.cancelled) return { key: 'cancelled', label: 'Cancelled' }
  if (p.settled) return { key: 'settled', label: 'Paid out' }
  if (now < joinBy) return { key: 'joining', label: `Joining · ${clock(joinBy - now)} left` }
  if (p.memberCount < 2) return { key: 'underfilled', label: 'Too few joined' }
  if (now <= end) {
    for (let d = 0; d < p.days; d++) if (now >= deadlineOf(p, d) - p.win && now <= deadlineOf(p, d) + p.win) return { key: 'open', label: `Day ${d + 1} check-in open` }
    return { key: 'running', label: 'In progress' }
  }
  return { key: 'ready', label: 'Ready to pay out' }
}

/** Reads the most recent `n` pools plus their member lists. */
export function useRecentPools(n = 20) {
  const { data: count } = useReadContract({ ...base, functionName: 'poolCount', query: { refetchInterval: 5000 } })
  const ids = count ? Array.from({ length: Math.min(n, Number(count)) }, (_, i) => count - BigInt(i)) : []
  const { data: rows } = useReadContracts({
    contracts: ids.flatMap((id) => [{ ...base, functionName: 'pools', args: [id] } as const, { ...base, functionName: 'getMembers', args: [id] } as const]),
    query: { enabled: ids.length > 0, refetchInterval: 5000 },
  })
  const pools = ids.map((id, i) => {
    const p = rows?.[i * 2]?.result as readonly unknown[] | undefined
    const m = rows?.[i * 2 + 1]?.result as readonly `0x${string}`[] | undefined
    return p ? { pool: toPool(id, p), members: m ?? [] } : null
  }).filter(Boolean) as { pool: PoolRow; members: readonly `0x${string}`[] }[]
  return { count, pools }
}
