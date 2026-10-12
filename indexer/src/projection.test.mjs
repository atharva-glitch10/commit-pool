import test from 'node:test'
import assert from 'node:assert/strict'
import { poolKey, registerHandlers } from './projection.js'

function harness() {
  const handlers = new Map(), context = {}
  for (const name of ['Pool', 'Membership', 'Activity']) {
    const data = new Map()
    context[name] = { data, set: value => data.set(value.id, value), getOrThrow: async id => { if (!data.has(id)) throw new Error('Missing entity'); return data.get(id) } }
  }
  registerHandlers({ onEvent: (options, handler) => handlers.set(options.event, handler) })
  return { context, run: (name, event) => handlers.get(name)({ event, context }) }
}
const a = `0x${'1'.repeat(40)}`, b = `0x${'2'.repeat(40)}`
const event = (params, logIndex = 0, chainId = 10143) => ({ chainId, srcAddress: `0x${'a'.repeat(40)}`, params: { poolId: 1n, ...params }, block: { number: 1, timestamp: 1800000000 }, transaction: { hash: `0x${'f'.repeat(64)}` }, logIndex })
const creation = event({ creator: a, goal: 'Morning|t1', stake: 100n, startTime: 1800000001n, dayLength: 60n, window: 10n, numDays: 2n, maxMembers: 20n })
test('creator join, daily verification, settlement and claim project into the dashboard correctly', async () => {
  const h = harness()
  await h.run('PoolCreated', creation)
  await h.run('Joined', event({ member: a }, 1)); await h.run('Joined', event({ member: b }, 2))
  await h.run('DayVerified', event({ member: a, day: 0n }, 3)); await h.run('DayVerified', event({ member: a, day: 1n }, 4))
  await h.run('PoolSettled', event({ winners: 1n, payout: 190n, fee: 10n }, 5))
  await h.run('Claimed', event({ member: a, amount: 190n }, 6))
  const p = h.context.Pool.data.get(poolKey(creation)), m = [...h.context.Membership.data.values()].find(m => m.member === a)
  assert.deepEqual(p.members, [a, b]); assert.equal(p.memberCount, 2); assert.equal(p.payout, 190n)
  assert.equal(m.doneMask, 3); assert.equal(m.claimed, true); assert.equal(h.context.Activity.data.size, 7)
})
test('pool IDs are separated by chain and cancellation is represented', async () => {
  const h = harness(), other = { ...creation, chainId: 143 }
  await h.run('PoolCreated', creation); await h.run('PoolCreated', other)
  await h.run('PoolCancelled', event({}, 1))
  assert.equal(h.context.Pool.data.size, 2)
  assert.equal(h.context.Pool.data.get(poolKey(creation)).cancelled, true)
  assert.equal(h.context.Pool.data.get(poolKey(other)).cancelled, false)
})
