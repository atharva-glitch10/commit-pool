import type { ReactNode } from 'react'
import { useBalance, useConnection, useDisconnect, useSwitchChain } from 'wagmi'
import { monadTestnet } from 'viem/chains'
import { EXPLORER, POOL_ADDRESS } from './config'
import { mon, short } from './lib'
import { go, type Route } from './router'
import { displayName } from './names'

export function WalletChip({ next }: { next?: string }) {
  const { address, isConnected, chainId } = useConnection()
  const { mutate: disconnect } = useDisconnect()
  const { mutate: switchChain } = useSwitchChain()
  const { data: bal } = useBalance({ address, chainId: monadTestnet.id, query: { refetchInterval: 6000 } })
  if (!isConnected) return <a className="btn ink" href={`#/start${next ? `?next=${encodeURIComponent(next)}` : ''}`}>Connect wallet</a>
  if (chainId !== monadTestnet.id) return <button className="btn flare" onClick={() => switchChain({ chainId: monadTestnet.id })}>Switch to Monad Testnet</button>
  return (
    <button className="walletchip" onClick={() => disconnect()} title="Disconnect wallet">
      <span className="dot" aria-hidden /><span title={address}>{displayName(address)}</span><span className="addr" title={address}>{short(address)}</span>
      {bal && <span className="bal">{mon(bal.value)} MON</span>}
    </button>
  )
}

export function TopBar({ route }: { route: Route }) {
  const inApp = route.name !== 'home' && route.name !== 'start'
  const here = location.hash.replace(/^#/, '')
  return (
    <header className="top">
      <a className="mark" href="#/" aria-label="CommitPool home">
        <svg className="markicon" viewBox="0 0 32 32" aria-hidden>
          <circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" strokeWidth="3.5" />
          <circle cx="24" cy="8.2" r="5" fill="var(--sun)" stroke="currentColor" strokeWidth="2.5" />
        </svg>
        <span>commitpool</span>
      </a>
      {inApp && (
        <nav className="tabs" aria-label="App">
          <a href="#/app" aria-current={route.name === 'app' ? 'page' : undefined}>Pools</a>
          <a href="#/new" aria-current={route.name === 'new' ? 'page' : undefined}>New pledge</a>
          <a href="#/leaderboard" aria-current={route.name === 'board' ? 'page' : undefined}>Leaderboard</a>
          <a href="#/journal" aria-current={route.name === 'journal' ? 'page' : undefined}>Private journal</a>
          <a href="#/trust" aria-current={route.name === 'trust' ? 'page' : undefined}>How it’s verified</a>
        </nav>
      )}
      <div className="topright">
        {!inApp && route.name !== 'start' && <a className="textlink quiet" href="#/trust">How it’s verified</a>}
        {!inApp && route.name !== 'start' && <a className="textlink" href="#/app">Open the app</a>}
        {route.name !== 'start' && <WalletChip next={here && !here.startsWith('/start') ? here : '/app'} />}
      </div>
    </header>
  )
}

export function Footer() {
  return (
    <footer>
      <p>
        CommitPool runs on Monad Testnet. Contract{' '}
        <a href={`${EXPLORER}/address/${POOL_ADDRESS}`} target="_blank" rel="noreferrer">{short(POOL_ADDRESS)}</a>.
        Check-ins are verified by our oracle: basic and wake-up-ring pools are live; step and sleep pools are in beta. <a href="#/trust">How it works</a>. Not audited.
      </p>
    </footer>
  )
}

export type Ring = { mask: number; me: boolean }
export function Dial({ rings, days, now, deadline, win, center, size = 360 }: {
  rings: Ring[]; days: number; now: number; deadline: (d: number) => number; win: number; center?: ReactNode; size?: number
}) {
  const c = size / 2
  const outer = size * 0.467, gap = 4, n = Math.max(rings.length, 1)
  const thick = Math.max(6, Math.min(22, (outer - size * 0.22) / n - gap))
  const segGap = days > 1 ? Math.min(4, 60 / days) : 0
  const per = 360 / days
  const rad = (a: number) => ((a - 90) * Math.PI) / 180
  const arc = (r: number, a0: number, a1: number) => {
    const x0 = c + r * Math.cos(rad(a0)), y0 = c + r * Math.sin(rad(a0))
    const x1 = c + r * Math.cos(rad(a1)), y1 = c + r * Math.sin(rad(a1))
    return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`
  }
  const shown = rings.length ? rings : [{ mask: 0, me: false }]
  return (
    <div className="dial" style={{ width: `min(100%, ${size}px)` }}>
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Progress: one ring per member, one arc per day">
        {shown.map((ring, i) => {
          const r = outer - i * (thick + gap) - thick / 2
          return Array.from({ length: days }, (_, d) => {
            const a0 = d * per + segGap / 2, a1 = (d + 1) * per - segGap / 2 - (days === 1 ? 0.01 : 0)
            const ok = (ring.mask & (1 << d)) !== 0
            const past = now > deadline(d) + win
            const open = now >= deadline(d) - win && now <= deadline(d) + win
            const cls = ok ? 'seg kept' : past ? 'seg broke' : open ? 'seg open' : 'seg ahead'
            return <path key={`${i}-${d}`} d={arc(r, a0, a1)} className={cls + (ring.me ? ' me' : '')} strokeWidth={thick} fill="none" />
          })
        })}
      </svg>
      {center && <div className="dialcenter">{center}</div>}
    </div>
  )
}

export function Empty({ title, children, cta }: { title: string; children?: ReactNode; cta?: { label: string; to: string } }) {
  return (
    <div className="empty">
      <p className="emptytitle">{title}</p>
      {children}
      {cta && <button className="btn sun" onClick={() => go(cta.to)}>{cta.label}</button>}
    </div>
  )
}
