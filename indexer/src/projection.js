export const poolKey = e => `${e.chainId}-${e.srcAddress.toLowerCase()}-${e.params.poolId}`
const memberKey = (e, member) => `${poolKey(e)}-${member.toLowerCase()}`
const fields = { transaction: ['hash'], block: ['timestamp'] }

export function registerHandlers(indexer) {
  function on(name, fn) {
    indexer.onEvent({ contract: 'CommitPool', event: name, fields }, async ({ event: e, context: c }) => {
      await fn(e, c)
      c.Activity.set({ id: `${e.chainId}-${e.block.number}-${e.logIndex}`, chainId: e.chainId, contract: e.srcAddress.toLowerCase(), poolId: e.params.poolId, kind: name, member: e.params.member?.toLowerCase() ?? e.params.creator?.toLowerCase(), day: e.params.day === undefined ? undefined : Number(e.params.day), amount: e.params.amount ?? e.params.stake, timestamp: BigInt(e.block.timestamp), blockNumber: BigInt(e.block.number), txHash: e.transaction.hash })
    })
  }
  on('PoolCreated', async (e, c) => {
    const p = e.params
    c.Pool.set({ id: poolKey(e), poolId: p.poolId, chainId: e.chainId, contract: e.srcAddress.toLowerCase(), creator: p.creator.toLowerCase(), goal: p.goal, stake: p.stake, startTime: p.startTime, dayLength: Number(p.dayLength), window: Number(p.window), numDays: Number(p.numDays), maxMembers: Number(p.maxMembers), members: [], memberCount: 0, winners: 0, settled: false, cancelled: false, payout: 0n, fee: 0n, createdAt: BigInt(e.block.timestamp) })
  })
  on('Joined', async (e, c) => {
    const p = await c.Pool.getOrThrow(poolKey(e)), member = e.params.member.toLowerCase()
    // The contract emits Joined for the creator too, immediately after PoolCreated.
    const members = p.members.includes(member) ? p.members : [...p.members, member]
    c.Pool.set({ ...p, members, memberCount: members.length })
    c.Membership.set({ id: memberKey(e, member), poolKey: p.id, poolId: e.params.poolId, chainId: e.chainId, contract: p.contract, member, doneMask: 0, claimed: false })
  })
  on('DayVerified', async (e, c) => {
    const m = await c.Membership.getOrThrow(memberKey(e, e.params.member))
    c.Membership.set({ ...m, doneMask: m.doneMask | (1 << Number(e.params.day)) })
  })
  on('PoolCancelled', async (e, c) => {
    const p = await c.Pool.getOrThrow(poolKey(e)); c.Pool.set({ ...p, cancelled: true })
  })
  on('PoolSettled', async (e, c) => {
    const p = await c.Pool.getOrThrow(poolKey(e)); c.Pool.set({ ...p, settled: true, winners: Number(e.params.winners), payout: e.params.payout, fee: e.params.fee })
  })
  on('Claimed', async (e, c) => {
    const m = await c.Membership.getOrThrow(memberKey(e, e.params.member)); c.Membership.set({ ...m, claimed: true })
  })
}
