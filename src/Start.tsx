import { useEffect } from 'react'
import { useBalance, useConnect, useConnection, useConnectors, useSwitchChain } from 'wagmi'
import { monadTestnet } from 'viem/chains'
import { errMsg, mon, short } from './lib'
import { go } from './router'
import { displayName } from './names'

/** Onboarding: wallet → connect → Monad Testnet → funds → continue. */
export function Start({ next }: { next?: string }) {
  const hasWallet = typeof window !== 'undefined' && !!(window as { ethereum?: unknown }).ethereum
  const { address, isConnected, chainId } = useConnection()
  const connectors = useConnectors()
  const { mutate: connect, error: connErr, isPending: connecting } = useConnect()
  const { mutate: switchChain, error: switchErr, isPending: switching } = useSwitchChain()
  const onMonad = chainId === monadTestnet.id
  const { data: bal } = useBalance({ address, chainId: monadTestnet.id, query: { enabled: isConnected, refetchInterval: 4000 } })
  const funded = !!bal && bal.value > 0n
  const target = next && next.startsWith('/') ? `#${next}` : '#/app'

  const step = !hasWallet ? 0 : !isConnected ? 1 : !onMonad ? 2 : !funded ? 3 : 4
  useEffect(() => {
    if (step === 4) {
      const t = setTimeout(() => go(target), 900)
      return () => clearTimeout(t)
    }
  }, [step, target])

  const steps = ['Get a wallet', 'Connect it', 'Use Monad Testnet', 'Get test MON']
  return (
    <section className="start">
      <h1 className="h2">Let’s get you ready</h1>
      <p className="lede">Four quick checks. The page moves on by itself when each one is done.</p>
      <ol className="wizard">
        {steps.map((s, i) => (
          <li key={s} className={i < step ? 'done' : i === step ? 'now' : ''} aria-current={i === step ? 'step' : undefined}>
            <span className="n" aria-hidden>{i < step ? '✓' : i + 1}</span>
            <span className="t">{s}</span>
          </li>
        ))}
      </ol>

      <div className="wizbody">
        {step === 0 && (
          <>
            <p>CommitPool works with MetaMask or any browser wallet. Install it, create a wallet, then come back to this page.</p>
            <a className="btn ink big" href="https://metamask.io/download/" target="_blank" rel="noreferrer">Install MetaMask</a>
          </>
        )}
        {step === 1 && (
          <>
            <p>Your wallet holds your stake and signs your check-ins. We never hold your keys.</p>
            <button className="btn sun big" disabled={connecting} onClick={() => connect({ connector: connectors[0] })}>{connecting ? 'Check your wallet…' : 'Connect wallet'}</button>
            {connErr && <p className="txline err">{errMsg(connErr)}</p>}
          </>
        )}
        {step === 2 && (
          <>
            <p>Connected as <strong>{short(address)}</strong>. Now switch to Monad Testnet. If your wallet doesn’t have it yet, it will offer to add it.</p>
            <button className="btn sun big" disabled={switching} onClick={() => switchChain({ chainId: monadTestnet.id })}>{switching ? 'Check your wallet…' : 'Switch to Monad Testnet'}</button>
            {switchErr && <p className="txline err">{errMsg(switchErr)}</p>}
            <details className="manual">
              <summary>Add it manually instead</summary>
              <table><tbody>
                <tr><th>Network name</th><td>Monad Testnet</td></tr>
                <tr><th>RPC URL</th><td><code>https://testnet-rpc.monad.xyz</code></td></tr>
                <tr><th>Chain ID</th><td><code>10143</code></td></tr>
                <tr><th>Currency</th><td>MON</td></tr>
                <tr><th>Explorer</th><td><code>https://testnet.monadvision.com</code></td></tr>
              </tbody></table>
            </details>
          </>
        )}
        {step === 3 && (
          <>
            <p>You’re on Monad Testnet with <strong>{bal ? mon(bal.value) : '0'} MON</strong>. Grab free test MON from the faucet. This page updates on its own when it arrives.</p>
            <div className="row2">
              <a className="btn sun big" href="https://faucet.monad.xyz" target="_blank" rel="noreferrer">Open the faucet</a>
              <button className="btn ghost" onClick={() => navigator.clipboard?.writeText(address ?? '')}>Copy my address</button>
            </div>
            <p className="hint fine"><a href={target}>Skip for now</a>. You can look around without MON; you’ll need it to join or start a pool.</p>
          </>
        )}
        {step === 4 && (
          <>
            <p className="ok">All set: <strong>{short(address)}</strong> with {bal ? mon(bal.value) : ''} MON on Monad Testnet.</p>
            <p className="hint">You’ll appear to others as <strong title={address}>{displayName(address)}</strong>. It’s generated from your wallet, so it’s the same on every device and doesn’t reveal who you are.</p>
            <a className="btn sun big" href={target}>Continue</a>
          </>
        )}
      </div>
    </section>
  )
}
