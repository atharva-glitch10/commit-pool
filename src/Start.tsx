import { useEffect } from 'react'
import { useBalance, useConnect, useConnection, useConnectors, useSwitchChain, useDisconnect } from 'wagmi'
import { monadTestnet } from 'viem/chains'
import { errMsg, mon, short } from './lib'
import { go } from './router'
import { displayName } from './names'
import { hasSavedPasskey, passkeySupported, setPasskeyIntent } from './mera'

/** Onboarding: wallet → connect → Monad Testnet → funds → continue. */
export function Start({ next }: { next?: string }) {
  const hasWallet = typeof window !== 'undefined' && !!(window as { ethereum?: unknown }).ethereum
  const { address, isConnected, chainId, connector } = useConnection()
  const { mutateAsync: disconnect } = useDisconnect()
  const connectors = useConnectors()
  const { mutate: connect, error: connErr, isPending: connecting } = useConnect()
  const { mutate: switchChain, error: switchErr, isPending: switching } = useSwitchChain()
  const onMonad = chainId === monadTestnet.id
  const { data: bal } = useBalance({ address, chainId: monadTestnet.id, query: { enabled: isConnected, refetchInterval: 4000 } })
  const funded = !!bal && bal.value > 0n
  const target = next && next.startsWith('/') ? `#${next}` : '#/app'

  const needsPasskey = next?.startsWith('/journal') && connector?.id !== 'mera'
  const step = !isConnected || needsPasskey ? 1 : !onMonad ? 2 : !funded ? 3 : 4
  useEffect(() => {
    if (step === 4) {
      const t = setTimeout(() => go(target), 900)
      return () => clearTimeout(t)
    }
  }, [step, target])

  const steps = ['Choose an account', 'Connect it', 'Use Monad Testnet', 'Get test MON']
  async function connectPasskey(mode: 'create' | 'unlock') {
    const connector = connectors.find(c => c.id === 'mera')
    if (!connector) return
    setPasskeyIntent(mode)
    if (isConnected) await disconnect()
    connect({ connector })
  }
  return (
    <section className="start">
      <h1 className="h2">Let’s get you ready</h1>
      <p className="lede">Use a passkey on your phone or connect an existing wallet. Test MON has no real-world value.</p>
      <ol className="wizard">
        {steps.map((s, i) => (
          <li key={s} className={i < step ? 'done' : i === step ? 'now' : ''} aria-current={i === step ? 'step' : undefined}>
            <span className="n" aria-hidden>{i < step ? '✓' : i + 1}</span>
            <span className="t">{s}</span>
          </li>
        ))}
      </ol>

      <div className="wizbody">
        {step === 1 && (
          <>
            <h2 className="h3">Your account, one passkey</h2>
            <p>Create an account with your device’s passkey prompt. No browser extension is needed. Your signing session lasts 15 minutes; each signature or transaction asks for your approval.</p>
            <div className="row2">
              <button className="btn sun big" disabled={connecting || !passkeySupported()} onClick={() => connectPasskey('create')}>{connecting ? 'Check your device…' : 'Create a passkey account'}</button>
              <button className="btn ghost" disabled={connecting || !passkeySupported()} onClick={() => connectPasskey('unlock')}>{hasSavedPasskey() ? 'Unlock my passkey' : 'I already have a passkey'}</button>
            </div>
            <p className="hint fine">Creating another passkey creates another account. To recover an account, select its existing passkey at this same website. Keep access to that passkey; we cannot recover it for you.</p>
            {!passkeySupported() && <p className="txline err">This browser needs HTTPS or localhost and passkey support. An existing wallet is still available below.</p>}
            <details className="manual"><summary>Use an existing browser wallet</summary>
              <p>This keeps your existing wallet address. The encrypted journal currently requires a Mera passkey account.</p>
              {hasWallet || connectors.some(c => c.id !== 'mera') ? <button className="btn ink" disabled={connecting} onClick={() => { const connector = connectors.find(c => c.id !== 'mera'); if (connector) connect({ connector }) }}>Connect browser wallet</button> : <a className="btn ink" href="https://metamask.io/download/" target="_blank" rel="noreferrer">Get a browser wallet</a>}
            </details>
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
            <p className="hint fine"><a href={target}>Continue without funds</a>. You can use your private journal and look around without MON; joining a pool requires the stake plus network fees.</p>
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
