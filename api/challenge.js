// Vercel serverless function: POST /api/challenge  { poolId, member }  (Tier 1 wake-up ring)
import { challenge } from './_oracle.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    const r = await challenge(body, process.env)
    res.status(r.status).json(r.body)
  } catch (e) {
    res.status(500).json({ error: e?.shortMessage || e?.message || 'oracle error' })
  }
}
