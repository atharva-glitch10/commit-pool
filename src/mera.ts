import { createPasskeyWithPrfOutput, getPasskeyPrfOutput, createSecp256k1SigningSession, type PasskeyCredentialMetadata, type Secp256k1SigningSession } from '@category-labs/mera'
import { toViemAccount } from '@category-labs/mera/viem'
import { createConnector } from 'wagmi'
import { createWalletClient, createPublicClient, http, decodeFunctionData, formatEther, type LocalAccount } from 'viem'
import { monadTestnet } from 'viem/chains'
import { abi } from './abi'

// Versioned namespaces are part of the recovery format. Never change them for existing accounts.
export const WALLET_NAMESPACE = 'commitpool.wallet.v1'
export const JOURNAL_NAMESPACE = 'commitpool.journal.v1'
export const MERA_LOCK_EVENT = 'commitpool:locked'
const META_KEY = 'commitpool.passkey.v1'
let intent: 'create' | 'unlock' = 'unlock'
let session: Secp256k1SigningSession | undefined
let account: LocalAccount | undefined
let credential: PasskeyCredentialMetadata | undefined
let timeout: ReturnType<typeof setTimeout> | undefined
let notifyDisconnect: (() => void) | undefined

export async function namespaceSalt(namespace: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(namespace)))
}
export function passkeySupported() {
  return window.isSecureContext && !!window.PublicKeyCredential && !!navigator.credentials && !/^\d+\.\d+\.\d+\.\d+$/.test(location.hostname)
}
export function setPasskeyIntent(value: 'create' | 'unlock') { intent = value }
export function hasSavedPasskey() { return !!localStorage.getItem(META_KEY) }
export function activePasskey() { return credential }
export function lockPasskey() {
  clearTimeout(timeout)
  session?.end()
  session = undefined; account = undefined; credential = undefined
  window.dispatchEvent(new Event(MERA_LOCK_EVENT))
  notifyDisconnect?.()
}
function approve(message: string) {
  if (!window.confirm(message)) throw new Error('User rejected the signature.')
}
async function unlock() {
  if (!passkeySupported()) throw new Error('Passkeys need HTTPS on a domain or http://localhost and a compatible browser. IP-address URLs are not supported. You can still connect a browser wallet.')
  const prfSalt = await namespaceSalt(WALLET_NAMESPACE)
  const rpId = location.hostname
  const result = intent === 'create'
    ? await createPasskeyWithPrfOutput({ rp: { id: rpId, name: 'CommitPool' }, user: { name: 'CommitPool account', displayName: 'CommitPool account' }, prfSalt })
    : await getPasskeyPrfOutput({ rpId, prfSalt })
  session?.end()
  try { session = createSecp256k1SigningSession({ privateKey: result.prfOutput }) }
  finally { result.prfOutput.fill(0) }
  const metadata: PasskeyCredentialMetadata = { credentialId: result.credentialId }
  credential = metadata
  const raw = toViemAccount(session)
  account = {
    ...raw,
    async signMessage(parameters) {
      const message = typeof parameters.message === 'string' ? parameters.message : 'CommitPool signed data'
      approve(`Sign with your CommitPool account?\n\n${message}`)
      return raw.signMessage(parameters)
    },
    async signTransaction(transaction, options) {
      if (transaction.chainId !== monadTestnet.id) throw new Error('This account connection only signs Monad Testnet transactions.')
      const poolAddress = import.meta.env.VITE_POOL_ADDRESS || '0x59747B1A995EF0Cb01CA6A97CE0aaeA38b2474F4'
      if (transaction.to?.toLowerCase() !== poolAddress.toLowerCase()) throw new Error('This connection only sends transactions to the CommitPool contract.')
      const decoded = decodeFunctionData({ abi, data: transaction.data ?? '0x' })
      approve(`Approve ${decoded.functionName} on Monad Testnet?\n\nAccount: ${raw.address}\nAmount: ${formatEther(transaction.value ?? 0n)} test MON plus network fee\nContract: ${transaction.to}`)
      return raw.signTransaction(transaction, options)
    },
    async signTypedData() { throw new Error('Typed-data signing is not enabled in this connection.') },
    sign: undefined,
    signAuthorization: undefined,
  }
  try { localStorage.setItem(META_KEY, JSON.stringify({ credentialId: metadata.credentialId, address: raw.address, version: 1 })) } catch { /* public metadata is optional */ }
  clearTimeout(timeout)
  timeout = setTimeout(lockPasskey, 15 * 60_000)
  return account
}

export function meraConnector() {
  const chain = monadTestnet
  const rpc = () => http(import.meta.env.VITE_RPC_URL || 'https://testnet-rpc.monad.xyz')
  return createConnector((config) => ({
    id: 'mera', name: 'Passkey · Mera', type: 'mera',
    async connect({ isReconnecting, withCapabilities } = {}) {
      if (isReconnecting && !account) throw new Error('Unlock your passkey to reconnect.')
      const a = account ?? await unlock()
      notifyDisconnect = () => config.emitter.emit('disconnect')
      return { accounts: (withCapabilities ? [{ address: a.address, capabilities: {} }] : [a.address]) as never, chainId: chain.id }
    },
    async disconnect() { lockPasskey(); notifyDisconnect = undefined },
    async getAccounts() { return account ? [account.address] : [] },
    async getChainId() { return chain.id },
    async getClient() {
      if (!account) throw new Error('Your passkey session is locked. Unlock it again to continue.')
      return createWalletClient({ account, chain, transport: rpc() })
    },
    async getProvider() {
      return { request: async ({ method, params }: { method: string; params?: unknown }) => {
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return account ? [account.address] : []
        if (method === 'eth_chainId') return `0x${chain.id.toString(16)}`
        if (method.startsWith('eth_sign') || method === 'personal_sign' || method === 'eth_sendTransaction') throw new Error('Use the connected CommitPool signing client.')
        return createPublicClient({ chain, transport: rpc() }).request({ method, params } as never)
      } }
    },
    async isAuthorized() { return !!account },
    async switchChain({ chainId }) {
      if (chainId !== chain.id) throw new Error('CommitPool passkey accounts use Monad Testnet here.')
      return chain
    },
    onAccountsChanged(accounts) { config.emitter.emit('change', { accounts: accounts as `0x${string}`[] }) },
    onChainChanged() { config.emitter.emit('change', { chainId: chain.id }) },
    onDisconnect() { lockPasskey() },
  }))
}
