import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Serves /api/attest during `npm run dev` with the same code Vercel runs in production.
function oracleDevApi(env: Record<string, string>): Plugin {
  return {
    name: 'oracle-dev-api',
    configureServer(server) {
      const route = (path: string, fn: 'attest' | 'challenge') => server.middlewares.use(path, async (req, res) => {
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', async () => {
          try {
            // @ts-expect-error plain JS module
            const mod = await import('./api/_oracle.js')
            const r = await mod[fn](JSON.parse(raw || '{}'), env)
            res.statusCode = r.status
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify(r.body))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: (e as Error).message }))
          }
        })
      })
      route('/api/attest', 'attest')
      route('/api/challenge', 'challenge')
      server.middlewares.use('/api/journal', (req, res) => {
        res.setHeader('Cache-Control', 'no-store')
        if (req.method !== 'POST') { res.statusCode = 405; res.end(JSON.stringify({ error: 'POST only' })); return }
        let raw = ''
        req.on('data', c => { raw += c; if (raw.length > 32000) req.destroy() })
        req.on('end', async () => {
          res.setHeader('content-type', 'application/json')
          try {
            // @ts-expect-error plain JS module
            const { journal } = await import('./api/_journal.js')
            const result = await journal(JSON.parse(raw || '{}'), env, req.headers.origin)
            res.statusCode = result.status; res.end(JSON.stringify(result.body))
          } catch { res.statusCode = 400; res.end(JSON.stringify({ error: 'Invalid journal request.' })) }
        })
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return { plugins: [react(), oracleDevApi(env)] }
})
