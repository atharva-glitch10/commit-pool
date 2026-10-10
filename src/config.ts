import { http, createConfig } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { monadTestnet } from 'viem/chains'

export const config = createConfig({
  chains: [monadTestnet],
  connectors: [injected()],
  transports: { [monadTestnet.id]: http(import.meta.env.VITE_RPC_URL || 'https://testnet-rpc.monad.xyz') },
})

// Deployed on Monad Testnet at Monad Blitz Pune V3. Override with VITE_POOL_ADDRESS if you redeploy.
export const DEPLOYED_POOL = '0x59747B1A995EF0Cb01CA6A97CE0aaeA38b2474F4' as const
export const POOL_ADDRESS = (import.meta.env.VITE_POOL_ADDRESS || DEPLOYED_POOL) as `0x${string}`
// Explorer per docs.monad.xyz
export const EXPLORER = 'https://testnet.monadvision.com'

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
