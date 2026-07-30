// Production static server. Replaces the `serve -s dist` CLI shortcut
// previously used for `npm start` -- `-s`/`--single` unconditionally
// prepends a `{source: "**", destination: "/index.html"}` rewrite ahead
// of anything else, and serve-handler's rewrite resolution is
// recursive: even a *more specific* rule listed earlier in a serve.json
// `rewrites` array still gets re-matched against the catch-all
// immediately after being applied (see serve-handler's applyRewrites --
// each successful match recurses on the REMAINING rules against the
// NEW rewritten path, so "/privacy" -> "/privacy/index.html" -> (now
// re-checked against "**") -> "/index.html"). Verified this directly
// against the real serve-handler internals with debug logging before
// concluding a plain serve.json couldn't do this -- a `/privacy`-before-
// `**` ordering in serve.json still lost to the catch-all in testing.
//
// Real fix: never hand /privacy or /terms a rewrite at all. Without any
// matching rewrite rule, serve-handler's cleanUrls resolution (on by
// default) already finds dist/privacy/index.html / dist/terms/index.html
// on its own, since those real files exist on disk -- generated at
// build time by scripts/generate-static-policies.mjs. This is what
// makes those two routes readable by a crawler that doesn't execute
// JavaScript (e.g. Twilio's A2P 10DLC carrier review), which was the
// actual point of this file existing. Every other path still gets the
// standard single-page-app catch-all rewrite, unchanged from `-s`'s
// prior behavior.
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import handler from 'serve-handler'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.join(__dirname, 'dist')
const PORT = Number(process.env.PORT) || 3000

const STATIC_ROUTES = new Set(['/privacy', '/terms'])
const SPA_REWRITES = [{ source: '**', destination: '/index.html' }]

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://placeholder').pathname).replace(/\/+$/, '') || '/'
  const rewrites = STATIC_ROUTES.has(pathname) ? [] : SPA_REWRITES

  handler(req, res, { public: PUBLIC_DIR, rewrites }).catch((err) => {
    console.error(err)
    res.statusCode = 500
    res.end('Internal Server Error')
  })
})

server.listen(PORT, () => {
  console.log(`Serving ${PUBLIC_DIR} on port ${PORT}`)
})
