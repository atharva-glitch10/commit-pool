// Verification tiers are written into the pool's on-chain goal text as a short tag after "|",
// so a pool's tier can never be changed after creation and needs no extra storage.
//
//   "Be up by 06:30"                       → basic (old pools; tap inside the window)
//   "Be up by 06:30|t1"                    → Tier 1: wake-up ring + challenge + wallet signature
//   "Walk 10,000 steps|t2:steps=10000"     → Tier 2: phone health app steps
//   "Asleep by 23:00, 7h|t3:sleep=420,by=540" → Tier 3: watch/ring sleep ≥420 min, started ≥540 min before the deadline

export const TIERS = {
  0: { key: 'basic', name: 'Basic', short: 'Tap to check in' },
  1: { key: 'challenge', name: 'Tier 1 · Wake-up ring', short: 'Random ring, answer within the time limit, signed by your wallet' },
  2: { key: 'phone', name: 'Tier 2 · Phone health app', short: 'Device-recorded steps from Health Connect or Apple Health' },
  3: { key: 'watch', name: 'Tier 3 · Smartwatch', short: 'Sleep recorded by a watch, ring or band' },
}

/** @returns {{ text: string, tier: 0|1|2|3, steps?: number, sleepMin?: number, byMin?: number }} */
export function parseGoal(goal) {
  const raw = String(goal ?? '')
  const i = raw.lastIndexOf('|')
  if (i < 0) return { text: raw, tier: 0 }
  const text = raw.slice(0, i).trim()
  const tag = raw.slice(i + 1).trim()
  const m = /^t([123])(?::(.*))?$/.exec(tag)
  if (!m) return { text: raw, tier: 0 }
  const tier = Number(m[1])
  const params = Object.fromEntries((m[2] ?? '').split(',').filter(Boolean).map((kv) => kv.split('=').map((s) => s.trim())))
  const num = (k) => (params[k] !== undefined && /^\d+$/.test(params[k]) ? Number(params[k]) : undefined)
  if (tier === 2) {
    const steps = num('steps')
    return steps ? { text, tier, steps } : { text: raw, tier: 0 }
  }
  if (tier === 3) {
    const sleepMin = num('sleep'), byMin = num('by')
    return sleepMin && byMin !== undefined ? { text, tier, sleepMin, byMin } : { text: raw, tier: 0 }
  }
  return { text, tier: 1 }
}

export function encodeGoal(text, tier, opts = {}) {
  const t = String(text).trim()
  if (tier === 1) return `${t}|t1`
  if (tier === 2) return `${t}|t2:steps=${Math.round(opts.steps)}`
  if (tier === 3) return `${t}|t3:sleep=${Math.round(opts.sleepMin)},by=${Math.round(opts.byMin)}`
  return t
}

/** Which day's window is open at `now` (seconds), by wall-clock time. The contract re-checks with block.timestamp. */
export function openDayAt(pool, now) {
  const start = Number(pool.startTime), dl = Number(pool.dayLength), w = Number(pool.window), n = Number(pool.numDays)
  if (!(dl > 0) || now + w < start) return { open: false, day: 0 }
  const day = Math.floor((now + w - start) / dl)
  const deadline = start + day * dl
  const open = day < n && now <= deadline + w
  return { open, day, deadline, windowStart: deadline - w, windowEnd: deadline + w }
}

/** The exact text a member's wallet signs to answer a Tier 1 wake-up ring. */
export function checkInMessage({ poolId, day, nonce, answer }) {
  return `CommitPool wake-up check\nPool ${poolId}, day ${Number(day) + 1}\nCode ${nonce}\nAnswer ${answer}`
}
