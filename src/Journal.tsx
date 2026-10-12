import { useEffect, useRef, useState } from 'react'
import { useConnection, useSignMessage } from 'wagmi'
import { getPasskeyPrfOutput } from '@category-labs/mera'
import { activePasskey, JOURNAL_NAMESPACE, MERA_LOCK_EVENT, namespaceSalt } from './mera'
import { journalKey, openEntry, sealEntry, type JournalText, type SealedEntry } from './journalCrypto'
import { errMsg } from './lib'

type Opened = { sealed: SealedEntry; data: JournalText }
const storageKey = (address: string) => `commitpool.journal.v1:${address.toLowerCase()}`
function localEntries(address: string): SealedEntry[] {
  const raw = localStorage.getItem(storageKey(address))
  const parsed = raw ? JSON.parse(raw) : []
  if (!Array.isArray(parsed) || parsed.length > 100) throw new Error('Stored journal is invalid. Export a backup before changing this browser’s storage.')
  return parsed
}
async function post(body: unknown) {
  const response = await fetch('/api/journal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'Journal sync is unavailable.')
  return result
}

export function Journal({ poolId = '' }: { poolId?: string }) {
  const { address, connector } = useConnection()
  const { mutateAsync: signMessage } = useSignMessage()
  const [key, setKey] = useState<CryptoKey>()
  const [entries, setEntries] = useState<Opened[]>([])
  const [text, setText] = useState('')
  const [pool, setPool] = useState(poolId)
  const [editing, setEditing] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [cloudAvailable, setCloudAvailable] = useState(false)
  const [cloud, setCloud] = useState(false)
  const epoch = useRef(0)
  function lock() {
    epoch.current++
    setKey(undefined); setEntries([]); setText(''); setEditing(undefined); setBusy(false); setNotice('')
  }
  useEffect(() => {
    lock()
    const onLock = () => lock()
    window.addEventListener(MERA_LOCK_EVENT, onLock)
    const timer = setInterval(onLock, 5 * 60_000)
    return () => { epoch.current++; window.removeEventListener(MERA_LOCK_EVENT, onLock); clearInterval(timer) }
  }, [address, connector?.id])
  useEffect(() => { post({ action: 'status' }).then(r => setCloudAvailable(r.configured === true)).catch(() => setCloudAvailable(false)) }, [])

  async function cloudRequest(operation: unknown) {
    const challenge = await post({ action: 'challenge', member: address, operation })
    const signature = await signMessage({ message: challenge.message })
    return post({ action: 'execute', member: address, operation, nonce: challenge.nonce, signature })
  }
  async function decryptAll(k: CryptoKey, sealed: SealedEntry[]) {
    return Promise.all(sealed.map(async s => ({ sealed: s, data: await openEntry(k, address!, s) })))
  }
  async function unlock() {
    const operationEpoch = epoch.current
    setBusy(true); setNotice('')
    try {
      const credential = activePasskey()
      if (!credential) throw new Error('Unlock your Mera account first.')
      const result = await getPasskeyPrfOutput({ rpId: location.hostname, credential, prfSalt: await namespaceSalt(JOURNAL_NAMESPACE) })
      const k = await journalKey(result.prfOutput)
      const sealed = cloud ? (await cloudRequest({ action: 'list' })).entries : localEntries(address!)
      const opened = await decryptAll(k, sealed)
      if (epoch.current !== operationEpoch) return
      setKey(k); setEntries(opened)
    } catch (e) { if (epoch.current === operationEpoch) setNotice(`Could not unlock the journal. ${errMsg(e)} Your encrypted entries have not been changed.`) }
    finally { if (epoch.current === operationEpoch) setBusy(false) }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!key || !address) return
    const operationEpoch = epoch.current
    setBusy(true); setNotice('')
    try {
      const existing = entries.find(e => e.sealed.id === editing)
      const timestamp = new Date().toISOString()
      const data = { text: text.trim(), poolId: pool, createdAt: existing?.data.createdAt ?? timestamp, updatedAt: timestamp }
      const sealed = await sealEntry(key, address, data, editing)
      if (cloud) await cloudRequest({ action: 'save', entry: sealed })
      if (epoch.current !== operationEpoch) return
      const cached = localEntries(address).filter(e => e.id !== sealed.id)
      if (cached.length >= 100) throw new Error('Local journal holds 100 entries. Export a backup and delete an old entry first.')
      localStorage.setItem(storageKey(address), JSON.stringify([sealed, ...cached]))
      setEntries([{ sealed, data }, ...entries.filter(e => e.sealed.id !== sealed.id)])
      setText(''); setEditing(undefined); setNotice(cloud ? 'Encrypted entry synced. A local encrypted copy is also saved.' : 'Encrypted entry saved on this device.')
    } catch (e) { if (epoch.current === operationEpoch) setNotice(errMsg(e)) }
    finally { if (epoch.current === operationEpoch) setBusy(false) }
  }
  async function remove(id: string) {
    if (!address || !window.confirm('Delete this entry from the selected journal and its local encrypted copy? Export a backup first if you want to keep it.')) return
    const operationEpoch = epoch.current
    setBusy(true); setNotice('')
    try {
      if (cloud) await cloudRequest({ action: 'delete', id })
      if (epoch.current !== operationEpoch) return
      localStorage.setItem(storageKey(address), JSON.stringify(localEntries(address).filter(e => e.id !== id)))
      setEntries(entries.filter(e => e.sealed.id !== id))
      if (editing === id) { setEditing(undefined); setText('') }
      setNotice('Entry deleted. Any exported backups still contain it.')
    } catch (e) { if (epoch.current === operationEpoch) setNotice(errMsg(e)) }
    finally { if (epoch.current === operationEpoch) setBusy(false) }
  }
  function backup() {
    if (!address) return
    try {
      const sealed = key ? entries.map(e => e.sealed) : localEntries(address)
      const url = URL.createObjectURL(new Blob([JSON.stringify({ v: 1, origin: location.origin, owner: address.toLowerCase(), entries: sealed }, null, 2)], { type: 'application/json' }))
      const a = document.createElement('a'); a.href = url; a.download = 'commitpool-encrypted-journal.json'; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) { setNotice(errMsg(e)) }
  }
  async function restore(file?: File) {
    if (!file || !key || !address) return
    const operationEpoch = epoch.current
    setBusy(true); setNotice('')
    try {
      if (file.size > 3_000_000) throw new Error('Backup is too large.')
      const backup = JSON.parse(await file.text())
      if (backup.v !== 1 || backup.origin !== location.origin || backup.owner !== address.toLowerCase() || !Array.isArray(backup.entries) || backup.entries.length > 100) throw new Error('This backup belongs to another account, site, or format.')
      const opened = await decryptAll(key, backup.entries)
      if (epoch.current !== operationEpoch) return
      const merged = new Map(entries.map(e => [e.sealed.id, e]))
      for (const entry of opened) {
        const old = merged.get(entry.sealed.id)
        if (!old || old.data.updatedAt < entry.data.updatedAt) merged.set(entry.sealed.id, entry)
      }
      if (merged.size > 100) throw new Error('Restoring would exceed the 100-entry limit.')
      localStorage.setItem(storageKey(address), JSON.stringify([...merged.values()].map(e => e.sealed)))
      setEntries([...merged.values()]); setNotice('Backup restored locally. Cloud storage was not changed.')
    } catch (e) { if (epoch.current === operationEpoch) setNotice(`Backup was not restored. ${errMsg(e)}`) }
    finally { if (epoch.current === operationEpoch) setBusy(false) }
  }
  const mera = connector?.id === 'mera'
  return <section className="journal">
    <p className="eyebrow">Your reasons stay yours</p>
    <h1 className="h2">Private journal</h1>
    <p className="lede">Reflect on your pledge. Your passkey unlocks your account and, with a separate key, your journal.</p>
    <div className="journal-privacy"><strong>Private reflections. Public outcomes.</strong><p>Journal text is encrypted before storage. Pool goals, membership and check-ins remain public. Your journal is never sent to the oracle.</p></div>
    {!mera ? <div className="empty"><p>Connect a Mera passkey account to use the journal.</p><a className="btn ink" href={`#/start?next=${encodeURIComponent(`/journal${poolId ? `?pool=${poolId}` : ''}`)}`}>Use a passkey</a><p className="hint fine">An existing browser wallet stays separate; creating a passkey creates a new account.</p></div> : <>
      <div className="row2 journal-toolbar">
        <label><input type="checkbox" checked={cloud} disabled={busy || !cloudAvailable} onChange={e => { lock(); setCloud(e.target.checked) }} /> Cloud journal</label>
        <span className="hint fine">{cloud ? 'Signed sync · encrypted at rest' : 'This device only · encrypted in browser storage'}</span>
      </div>
      {!cloudAvailable && <p className="hint fine">Cloud sync is not configured. Export a backup before clearing browser data.</p>}
      {!key ? <div className="row2"><button className="btn sun big" disabled={busy} onClick={unlock}>{busy ? 'Unlocking…' : 'Unlock private journal'}</button>{!cloud && <button className="btn ghost" disabled={busy} onClick={backup}>Export encrypted backup</button>}</div> : <>
        <div className="row2 journal-toolbar"><button className="btn ghost" disabled={busy} onClick={lock}>Lock journal</button><button className="btn ghost" disabled={busy} onClick={backup}>Export encrypted backup</button>{!cloud && <label className="btn ghost">Restore backup<input type="file" accept="application/json" disabled={busy} onChange={e => { void restore(e.target.files?.[0]); e.target.value = '' }} hidden /></label>}</div>
        <form className="journal-form" onSubmit={save}>
          <label>Pool number (optional)<input inputMode="numeric" value={pool} onChange={e => setPool(e.target.value.replace(/\D/g, ''))} maxLength={40} disabled={busy} /></label>
          <label>{editing ? 'Edit your reflection' : 'Why did you commit? How did today go?'}<textarea value={text} onChange={e => setText(e.target.value)} maxLength={4000} rows={5} disabled={busy} required /></label>
          <div className="row2"><button className="btn sun" disabled={busy || !text.trim()}>{busy ? 'Saving…' : editing ? 'Save encrypted changes' : 'Save encrypted reflection'}</button>{editing && <button type="button" className="btn ghost" disabled={busy} onClick={() => { setEditing(undefined); setText('') }}>Cancel edit</button>}</div>
        </form>
        <div className="journal-entries">{entries.length === 0 ? <p className="hint">Your first reflection starts here.</p> : [...entries].sort((a, b) => b.data.updatedAt.localeCompare(a.data.updatedAt)).map(({ sealed, data }) => <article className="journal-entry" key={sealed.id}>
          <p className="hint fine">{new Date(data.updatedAt).toLocaleString()}{data.poolId && <> · <a href={`#/pool/${data.poolId}`}>Pool {data.poolId}</a></>}</p>
          <p className="journal-text">{data.text}</p>
          <div className="row2"><button className="btn ghost" disabled={busy} onClick={() => { setEditing(sealed.id); setText(data.text); setPool(data.poolId) }}>Edit</button><button className="btn ghost" disabled={busy} onClick={() => remove(sealed.id)}>Delete</button></div>
        </article>)}</div>
      </>}
      <p className="hint fine">The journal locks automatically within five minutes. Keep your passkey: losing it can make encrypted entries unrecoverable. A synced passkey can unlock cloud entries on compatible devices at this same website.</p>
    </>}
    {notice && <p className="txline" role="status">{notice}</p>}
  </section>
}
