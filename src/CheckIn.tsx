import { useEffect, useRef, useState } from 'react'
import { useSignMessage } from 'wagmi'
import QRCode from 'qrcode'
import { clock, errMsg, useNow, type PoolRow, type TxState } from './lib'
import { checkInMessage, evidenceMessage, type Evidence } from './shared'

type Send = (fn: string, args: readonly unknown[], value?: bigint, label?: string) => Promise<unknown>
type Props = { p: PoolRow; day: number; member: `0x${string}`; send: Send; setStatus: (s: TxState) => void; busy: boolean }

async function post(path: string, body: unknown) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `The oracle refused (${r.status}).`)
  return j
}

/** Picks the right check-in flow for the pool's verification tier. */
export function CheckIn(props: Props) {
  const t = props.p.policy.tier
  if (t === 1) return <WakeRing {...props} />
  if (t === 2 || t === 3) return <DeviceEvidence {...props} />
  return <BasicCheckIn {...props} />
}

function BasicCheckIn({ p, day, member, send, setStatus, busy }: Props) {
  async function go() {
    setStatus({ kind: 'pending', msg: 'Asking the oracle to sign…' })
    try {
      const j = await post('/api/attest', { poolId: p.id.toString(), member, device: { source: 'web', at: Math.floor(Date.now() / 1000) } })
      await send('submit', [p.id, j.signature], undefined, `Day ${day + 1} kept. It’s on-chain.`)
    } catch (e) { setStatus({ kind: 'err', msg: errMsg(e) }) }
  }
  return <button className="btn sun big" disabled={busy} onClick={go}>Check in for day {day + 1}</button>
}

// ───────── Tier 1: wake-up ring ─────────
type Ring = { phase: 'idle' } | { phase: 'waiting'; until: number } | { phase: 'ringing'; token: string; puzzle: string; nonce: string; expiresAt: number }

function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    ;[0, 0.35, 0.7].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination)
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t)
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.25)
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.3)
    })
    navigator.vibrate?.([200, 100, 200])
  } catch { /* sound is a nice-to-have */ }
}

function WakeRing({ p, day, member, send, setStatus, busy }: Props) {
  const now = useNow()
  const [ring, setRing] = useState<Ring>({ phase: 'idle' })
  const [answer, setAnswer] = useState('')
  const { mutateAsync: signMessage } = useSignMessage()
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function listen() {
    setStatus({ kind: 'idle' })
    try {
      const j = await post('/api/challenge', { poolId: p.id.toString(), member })
      if (!j.ringing) {
        setRing({ phase: 'waiting', until: Math.floor(Date.now() / 1000) + j.ringsIn })
        timer.current = window.setTimeout(listen, Math.min(j.ringsIn * 1000 + 400, 60_000))
        return
      }
      setRing({ phase: 'ringing', token: j.token, puzzle: j.puzzle, nonce: j.nonce, expiresAt: j.expiresAt })
      setAnswer('')
      beep()
    } catch (e) { setRing({ phase: 'idle' }); setStatus({ kind: 'err', msg: errMsg(e) }) }
  }

  async function respond() {
    if (ring.phase !== 'ringing') return
    try {
      setStatus({ kind: 'pending', msg: 'Sign your answer in your wallet…' })
      const walletSig = await signMessage({ message: checkInMessage({ poolId: p.id.toString(), day, nonce: ring.nonce, answer: Number(answer) }) })
      setStatus({ kind: 'pending', msg: 'Checking your answer…' })
      const j = await post('/api/attest', { poolId: p.id.toString(), member, challenge: { token: ring.token, answer, walletSig } })
      setRing({ phase: 'idle' })
      await send('submit', [p.id, j.signature], undefined, `Awake and verified. Day ${day + 1} kept on-chain.`)
    } catch (e) { setStatus({ kind: 'err', msg: errMsg(e) }) }
  }

  if (ring.phase === 'idle')
    return (
      <div className="ringbox">
        <p className="hint">This pool uses the <strong>wake-up ring</strong>. Keep this page open: it rings at a random moment in the window, and you have a short time to answer.</p>
        <button className="btn sun big" disabled={busy} onClick={listen}>I’m up. Listen for the ring</button>
      </div>
    )
  if (ring.phase === 'waiting')
    return (
      <div className="ringbox">
        <p className="ringwait">Listening… the ring comes in <strong>{clock(Math.max(0, ring.until - now))}</strong></p>
        <p className="hint fine">Keep this tab open and your sound on. You can’t see the exact moment in advance.</p>
      </div>
    )
  const left = ring.expiresAt - now
  return (
    <form className="ringbox ringing" onSubmit={(e) => { e.preventDefault(); respond() }}>
      <p className="ringhead">🔔 Ringing. Answer within <strong>{clock(Math.max(0, left))}</strong></p>
      <label className="puzzle">{ring.puzzle}
        <input autoFocus inputMode="numeric" value={answer} onChange={(e) => setAnswer(e.target.value.replace(/\D/g, ''))} aria-label="Answer" />
      </label>
      <button className="btn sun big" disabled={busy || !answer || left <= 0}>Sign answer and check in</button>
    </form>
  )
}

// ───────── Tiers 2 & 3: evidence from the companion app ─────────
function readEvidence(poolId: bigint, day: number, member: string): Evidence | null {
  try {
    const q = location.hash.split('?')[1] ?? ''
    const raw = new URLSearchParams(q).get('ev')
    if (!raw) return null
    const json = atob(raw.replace(/-/g, '+').replace(/_/g, '/'))
    const ev = JSON.parse(decodeURIComponent(escape(json))) as Evidence
    if (String(ev.poolId) !== poolId.toString() || ev.day !== day || ev.member.toLowerCase() !== member.toLowerCase()) return null
    return ev
  } catch { return null }
}

function DeviceEvidence({ p, day, member, send, setStatus, busy }: Props) {
  const { mutateAsync: signMessage } = useSignMessage()
  const ev = readEvidence(p.id, day, member)
  const [qr, setQr] = useState('')
  const back = `${location.origin}${location.pathname}#/pool/${p.id}`
  const deep = `commitpool://sync?pool=${p.id}&day=${day}&member=${member}&kind=${p.policy.tier === 2 ? 'steps' : 'sleep'}&return=${encodeURIComponent(back)}`
  useEffect(() => {
    QRCode.toString(deep, { type: 'svg', margin: 0, color: { dark: '#13233A', light: '#00000000' } }).then(setQr).catch(() => setQr(''))
  }, [deep])

  async function submitEvidence() {
    if (!ev) return
    try {
      setStatus({ kind: 'pending', msg: 'Sign your health data in your wallet…' })
      const evidenceSig = await signMessage({ message: evidenceMessage(ev) })
      setStatus({ kind: 'pending', msg: 'The oracle is checking your data…' })
      const j = await post('/api/attest', { poolId: p.id.toString(), member, evidence: ev, evidenceSig })
      history.replaceState(null, '', back)
      await send('submit', [p.id, j.signature], undefined, `${j.verified}. Day ${day + 1} kept on-chain.`)
    } catch (e) { setStatus({ kind: 'err', msg: errMsg(e) }) }
  }

  if (ev) {
    const auto = ev.records.filter((r) => r.method !== 'manual')
    const total = ev.kind === 'steps' ? auto.reduce((s, r) => s + (r.value ?? 0), 0) : auto.reduce((s, r) => s + (r.end - r.start), 0) / 60
    return (
      <div className="ringbox">
        <p className="ringhead">Data from your phone is ready</p>
        <p className="hint">{ev.records.length} record(s) from {ev.platform === 'android' ? 'Health Connect' : 'Apple Health'}:{' '}
          <strong>{ev.kind === 'steps' ? `${Math.round(total).toLocaleString()} steps` : `${Math.round(total)} min of sleep`}</strong> not entered by hand.
          The oracle checks it against this pool’s goal before signing.</p>
        <button className="btn sun big" disabled={busy} onClick={submitEvidence}>Sign data and check in</button>
      </div>
    )
  }
  return (
    <div className="ringbox">
      <p className="ringhead">Sync from the CommitPool app</p>
      <p className="hint">This pool counts {p.policy.tier === 2 ? 'steps recorded by your phone or watch' : 'sleep recorded by your watch, ring or band'}.
        Open the companion app on your phone and tap <strong>Sync</strong>, or scan this code with it. It brings you back here with today’s data.</p>
      <div className="qr small" aria-label="QR code for the companion app" dangerouslySetInnerHTML={{ __html: qr }} />
      <p className="hint fine">The companion app is in beta (Android first).</p>
    </div>
  )
}
