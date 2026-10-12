export type JournalText = { text: string; poolId: string; createdAt: string; updatedAt: string }
export type SealedEntry = { v: 1; id: string; iv: string; ciphertext: string }
const enc = new TextEncoder()
const bytes = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))
const base64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)))
const context = (owner: string, id: string, origin: string) => enc.encode(`commitpool.journal.v1|${origin}|${owner.toLowerCase()}|${id}`)

export async function journalKey(prf: Uint8Array<ArrayBuffer>) {
  try { return await crypto.subtle.importKey('raw', prf, 'AES-GCM', false, ['encrypt', 'decrypt']) }
  finally { prf.fill(0) }
}
export async function sealEntry(key: CryptoKey, owner: string, entry: JournalText, id: string = crypto.randomUUID(), origin = location.origin): Promise<SealedEntry> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: context(owner, id, origin) }, key, enc.encode(JSON.stringify(entry)))
  return { v: 1, id, iv: base64(iv), ciphertext: base64(ciphertext) }
}
export async function openEntry(key: CryptoKey, owner: string, sealed: SealedEntry, origin = location.origin): Promise<JournalText> {
  if (sealed.v !== 1) throw new Error('Unknown journal format.')
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(sealed.iv), additionalData: context(owner, sealed.id, origin) }, key, bytes(sealed.ciphertext))
  const entry = JSON.parse(new TextDecoder().decode(plaintext))
  if (typeof entry.text !== 'string' || typeof entry.poolId !== 'string' || typeof entry.createdAt !== 'string' || typeof entry.updatedAt !== 'string') throw new Error('Invalid journal entry.')
  return entry
}
