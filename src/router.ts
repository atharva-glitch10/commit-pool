import { useEffect, useState } from 'react'

export type Route =
  | { name: 'home' }
  | { name: 'start'; next?: string }
  | { name: 'app' }
  | { name: 'new' }
  | { name: 'pool'; id: bigint }
  | { name: 'board' }
  | { name: 'trust' }

export function parse(hash: string): Route {
  const h = hash.replace(/^#/, '')
  const [path, q = ''] = h.split('?')
  const parts = path.split('/').filter(Boolean)
  const params = new URLSearchParams(q)
  if (parts[0] === 'start') return { name: 'start', next: params.get('next') ?? undefined }
  if (parts[0] === 'app') return { name: 'app' }
  if (parts[0] === 'new') return { name: 'new' }
  if (parts[0] === 'leaderboard') return { name: 'board' }
  if (parts[0] === 'trust') return { name: 'trust' }
  if (parts[0] === 'pool' && /^\d+$/.test(parts[1] ?? '')) return { name: 'pool', id: BigInt(parts[1]) }
  return { name: 'home' }
}

export function go(to: string) {
  if (location.hash !== to) location.hash = to
  window.scrollTo({ top: 0 })
}

export function useRoute(): Route {
  const [hash, setHash] = useState(() => {
    // old share links: /?pool=12 → #/pool/12
    const legacy = new URLSearchParams(location.search).get('pool')
    if (legacy && /^\d+$/.test(legacy) && !location.hash) {
      history.replaceState(null, '', `${location.pathname}#/pool/${legacy}`)
    }
    return location.hash
  })
  useEffect(() => {
    const f = () => setHash(location.hash)
    addEventListener('hashchange', f)
    return () => removeEventListener('hashchange', f)
  }, [])
  return parse(hash)
}

export const poolLink = (id: bigint | string) => `${location.origin}${location.pathname}#/pool/${id}`
