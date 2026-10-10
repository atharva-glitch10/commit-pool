// Device oracle core — shared by the Vercel function (api/attest.js) and the Vite dev server.
// MOCK ORACLE: in production this would verify wearable data (Apple Health / Google Fit / Oura)
// before signing. Here it verifies on-chain that the caller is a member and that today's window
// is open, then signs the attestation the contract checks with ecrecover.
import { createPublicClient, http, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { monadTestnet } from 'viem/chains'

const poolAbi = parseAbi([
  'function memberState(uint256,address) view returns (bool joined, bool claimed, uint32 doneMask)',
  'function pools(uint256) view returns (address creator, uint128 stake, uint64 startTime, uint32 dayLength, uint32 window, uint8 numDays, uint8 maxMembers, uint8 memberCount, uint8 winners, bool settled, bool cancelled, uint256 payout, string goal)',
  'function attestationHash(uint256,address,uint8) view returns (bytes32)',
  'function oracle() view returns (address)',
])

export async function attest({ poolId, member, device }, env) {
  const key = env.ORACLE_PRIVATE_KEY
  const address = env.VITE_POOL_ADDRESS || env.POOL_ADDRESS || '0x59747B1A995EF0Cb01CA6A97CE0aaeA38b2474F4'
  if (!key || !address) return { status: 500, body: { error: 'Oracle not configured (set ORACLE_PRIVATE_KEY in Vercel)' } }
  if (!/^0x[0-9a-fA-F]{40}$/.test(member || '') || !/^\d+$/.test(String(poolId ?? ''))) {
    return { status: 400, body: { error: 'Bad poolId or member' } }
  }
  const account = privateKeyToAccount(key)
  const client = createPublicClient({ chain: monadTestnet, transport: http(env.VITE_RPC_URL || env.RPC_URL || 'https://testnet-rpc.monad.xyz') })
  const id = BigInt(poolId)
  const [oracle, state, pool] = await Promise.all([
    client.readContract({ address, abi: poolAbi, functionName: 'oracle' }),
    client.readContract({ address, abi: poolAbi, functionName: 'memberState', args: [id, member] }),
    client.readContract({ address, abi: poolAbi, functionName: 'pools', args: [id] }),
  ])
  // Which day's window is open, by wall-clock time (the contract re-checks with block.timestamp).
  const [, , startTime, dayLength, window, numDays] = pool
  const now = Math.floor(Date.now() / 1000)
  const start = Number(startTime), dl = Number(dayLength), w = Number(window)
  let open = false, day = 0
  if (dl > 0 && now + w >= start) {
    day = Math.floor((now + w - start) / dl)
    open = day < Number(numDays) && now <= start + day * dl + w
  }
  if (oracle.toLowerCase() !== account.address.toLowerCase()) return { status: 500, body: { error: 'Oracle key does not match contract oracle' } }
  if (!state[0]) return { status: 403, body: { error: 'Not a member of this pool' } }
  if (!open) return { status: 409, body: { error: 'No check-in window is open right now' } }
  if ((state[2] & (1 << day)) !== 0) return { status: 409, body: { error: 'Already verified today' } }
  // Mock device check: a real oracle would validate `device` (e.g. sleep-onset time, step count) here.
  const hash = await client.readContract({ address, abi: poolAbi, functionName: 'attestationHash', args: [id, member, day] })
  const signature = await account.signMessage({ message: { raw: hash } })
  return { status: 200, body: { signature, day, device: device ?? null } }
}
