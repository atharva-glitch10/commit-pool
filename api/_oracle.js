// Device oracle core — shared by the Vercel functions (api/attest.js, api/challenge.js) and the Vite dev server.
// It decides whether a member kept today's goal and, if so, signs the attestation the contract checks with ecrecover.
// The rules depend on the pool's verification tier, which is written into the pool's on-chain goal text (see _tiers.js):
//   basic  — member + open window (the original hackathon behaviour; old pools keep working)
//   tier 1 — wake-up ring: answer a short-lived puzzle after a random ring moment, signed by the member's wallet
//   tier 2 — device-recorded steps from Health Connect / Apple Health, sent by the companion app
//   tier 3 — sleep recorded by a watch / ring / band, sent by the companion app
import { createPublicClient, http, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { monadTestnet } from 'viem/chains'
import { openDayAt, parseGoal } from './_tiers.js'
import { issueChallenge, ringSchedule, secretFromKey, verifyChallenge } from './_challenge.js'
import { attestationStatus, checkEvidence, verifyEvidenceSignature } from './_evidence.js'

export const DEFAULT_POOL = '0x59747B1A995EF0Cb01CA6A97CE0aaeA38b2474F4'

const poolAbi = parseAbi([
  'function memberState(uint256,address) view returns (bool joined, bool claimed, uint32 doneMask)',
  'function pools(uint256) view returns (address creator, uint128 stake, uint64 startTime, uint32 dayLength, uint32 window, uint8 numDays, uint8 maxMembers, uint8 memberCount, uint8 winners, bool settled, bool cancelled, uint256 payout, string goal)',
  'function attestationHash(uint256,address,uint8) view returns (bytes32)',
  'function oracle() view returns (address)',
])

/** Accepts the key with or without 0x, with stray quotes/spaces/newlines (common copy-paste issues). */
export function normalizeKey(raw) {
  if (!raw) return null
  let k = String(raw).trim().replace(/^['"]|['"]$/g, '').trim()
  if (!k.startsWith('0x') && !k.startsWith('0X')) k = '0x' + k
  k = '0x' + k.slice(2)
  return /^0x[0-9a-fA-F]{64}$/.test(k) ? k : 'invalid'
}

const err = (status, error, extra = {}) => ({ status, body: { error, ...extra } })

/** Shared checks: config, input, pool, membership, open window. */
async function load({ poolId, member }, env) {
  const key = normalizeKey(env.ORACLE_PRIVATE_KEY)
  if (key === 'invalid') return { fail: err(500, 'ORACLE_PRIVATE_KEY is not a valid private key: it must be 64 hex characters (optionally starting with 0x). Re-copy it from MetaMask → Oracle account → Account details → Show private key.') }
  if (!key) return { fail: err(500, 'Oracle not configured (set ORACLE_PRIVATE_KEY in Vercel).') }
  const address = env.VITE_POOL_ADDRESS || env.POOL_ADDRESS || DEFAULT_POOL
  if (!/^0x[0-9a-fA-F]{40}$/.test(member || '') || !/^\d+$/.test(String(poolId ?? ''))) return { fail: err(400, 'Bad poolId or member') }
  const account = privateKeyToAccount(key)
  const client = createPublicClient({ chain: monadTestnet, transport: http(env.VITE_RPC_URL || env.RPC_URL || 'https://testnet-rpc.monad.xyz') })
  const id = BigInt(poolId)
  const [oracle, state, pool] = await Promise.all([
    client.readContract({ address, abi: poolAbi, functionName: 'oracle' }),
    client.readContract({ address, abi: poolAbi, functionName: 'memberState', args: [id, member] }),
    client.readContract({ address, abi: poolAbi, functionName: 'pools', args: [id] }),
  ])
  if (oracle.toLowerCase() !== account.address.toLowerCase()) return { fail: err(500, 'Oracle key does not match contract oracle') }
  if (!state[0]) return { fail: err(403, 'Not a member of this pool') }
  const [, , startTime, dayLength, window, numDays, , , , settled, cancelled, , goal] = pool
  if (settled || cancelled) return { fail: err(409, 'This pool is closed.') }
  const now = Math.floor(Date.now() / 1000)
  const w = openDayAt({ startTime, dayLength, window, numDays }, now)
  if (!w.open) return { fail: err(409, 'No check-in window is open right now') }
  if ((state[2] & (1 << w.day)) !== 0) return { fail: err(409, 'Already verified today') }
  return { key, account, client, address, id, now, policy: parseGoal(goal), win: Number(window), ...w }
}

async function sign(ctx, member, extra = {}) {
  const hash = await ctx.client.readContract({ address: ctx.address, abi: poolAbi, functionName: 'attestationHash', args: [ctx.id, member, ctx.day] })
  const signature = await ctx.account.signMessage({ message: { raw: hash } })
  return { status: 200, body: { signature, day: ctx.day, tier: ctx.policy.tier, ...extra } }
}

/** POST /api/attest — returns the oracle signature if today's goal is proven for this pool's tier. */
export async function attest(body, env) {
  const { poolId, member } = body ?? {}
  const ctx = await load({ poolId, member }, env)
  if (ctx.fail) return ctx.fail
  const tier = ctx.policy.tier

  if (tier === 0) return sign(ctx, member, { verified: 'basic: member + open window' })

  if (tier === 1) {
    const r = await verifyChallenge(secretFromKey(ctx.key), body.challenge ?? {}, { poolId, member, day: ctx.day, now: ctx.now })
    if (!r.ok) return err(422, r.reason)
    return sign(ctx, member, { verified: 'wake-up ring answered in time and signed by the member' })
  }

  // tiers 2 & 3: evidence from the companion app, signed by the member's wallet
  const ev = body.evidence
  const att = attestationStatus(ev, env)
  if (att.required && !att.verified) return err(422, 'Device attestation is required but no verifier is configured on this server.')
  if (!(await verifyEvidenceSignature(ev, body.evidenceSig, member))) return err(422, 'The health data must be signed by the member’s own wallet.')
  const r = checkEvidence(ev, ctx.policy, { poolId, member, day: ctx.day, deadline: ctx.deadline, window: ctx.win, now: ctx.now })
  if (!r.ok) return err(422, r.reason)
  return sign(ctx, member, { verified: r.summary, attestation: att.verified ? 'verified' : `unverified (${att.type})` })
}

/** POST /api/challenge — Tier 1 only. Says when the ring is, or issues the puzzle once it has rung. */
export async function challenge(body, env) {
  const { poolId, member } = body ?? {}
  const ctx = await load({ poolId, member }, env)
  if (ctx.fail) return ctx.fail
  if (ctx.policy.tier !== 1) return err(400, 'This pool does not use the wake-up ring.')
  const secret = secretFromKey(ctx.key)
  const { ringAt, respondBy } = ringSchedule(secret, String(poolId), member, ctx.day, ctx.windowStart, ctx.windowEnd)
  if (ctx.now < ringAt) return { status: 200, body: { ringing: false, ringsIn: ringAt - ctx.now } }
  if (ctx.now > respondBy) return err(409, 'You missed today’s ring.')
  return { status: 200, body: { ringing: true, ...issueChallenge(secret, { poolId, member, day: ctx.day, respondBy, now: ctx.now }) } }
}
