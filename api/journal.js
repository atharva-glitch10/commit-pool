import { journal } from './_journal.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    if (JSON.stringify(body).length > 32000) return res.status(413).json({ error: 'Journal request too large.' })
    const result = await journal(body, process.env, req.headers.origin)
    return res.status(result.status).json(result.body)
  } catch { return res.status(400).json({ error: 'Invalid journal request.' }) }
}
