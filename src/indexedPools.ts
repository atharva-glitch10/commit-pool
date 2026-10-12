import { POOL_ADDRESS } from './config'

export type IndexedPool = {
  id: string; poolId: string; creator: `0x${string}`; goal: string; stake: string; startTime: string;
  dayLength: number; window: number; numDays: number; maxMembers: number; memberCount: number;
  members: `0x${string}`[]; winners: number; settled: boolean; cancelled: boolean; payout: string;
}
export type IndexedMember = { poolId: string; member: string; doneMask: number; claimed: boolean }
export async function fetchIndexedPools(url: string, count: bigint, limit: number) {
  const min = count > BigInt(limit) ? count - BigInt(limit) + 1n : 1n
  const query = `query CommitPoolDashboard($contract: String!, $min: numeric!, $limit: Int!) {
    Pool(where: {chainId: {_eq: 10143}, contract: {_eq: $contract}, poolId: {_gte: $min}}, order_by: {poolId: desc}, limit: $limit) {
      id poolId creator goal stake startTime dayLength window numDays maxMembers memberCount members winners settled cancelled payout
    }
    Membership(where: {chainId: {_eq: 10143}, contract: {_eq: $contract}, poolId: {_gte: $min}}, limit: 600) { poolId member doneMask claimed }
  }`
  const result = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables: { contract: POOL_ADDRESS.toLowerCase(), min: min.toString(), limit } }), signal: AbortSignal.timeout(6000) })
  const response = await result.json()
  if (!result.ok || response.errors || !Array.isArray(response.data?.Pool) || !Array.isArray(response.data?.Membership)) throw new Error('Indexer unavailable; using contract reads.')
  const validNumber = (v: unknown) => /^\d+$/.test(String(v))
  const validAddress = (v: unknown) => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)
  for (const p of response.data.Pool) {
    if (![p.poolId, p.stake, p.startTime, p.payout].every(validNumber) || !validAddress(p.creator) || typeof p.goal !== 'string' || !Array.isArray(p.members) || !p.members.every(validAddress) || ![p.dayLength, p.window, p.numDays, p.maxMembers, p.memberCount, p.winners].every(Number.isInteger) || typeof p.settled !== 'boolean' || typeof p.cancelled !== 'boolean') throw new Error('Incomplete indexed pool; using contract reads.')
  }
  for (const m of response.data.Membership) {
    if (!validNumber(m.poolId) || !validAddress(m.member) || !Number.isInteger(m.doneMask) || typeof m.claimed !== 'boolean') throw new Error('Incomplete indexed membership; using contract reads.')
  }
  return response.data as { Pool: IndexedPool[]; Membership: IndexedMember[] }
}
