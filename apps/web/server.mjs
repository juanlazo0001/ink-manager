// Production static server. Replaces the `serve -s dist` CLI shortcut
// previously used for `npm start` -- `-s`/`--single` unconditionally
// prepends a `{source: "**", destination: "/index.html"}` rewrite ahead
// of anything else, and serve-handler's rewrite resolution is
// recursive: even a *more specific* rule listed earlier in a serve.json
// `rewrites` array still gets re-matched against the catch-all
// immediately after being applied (see serve-handler's applyRewrites --
// each successful match recurses on the REMAINING rules against the
// NEW rewritten path). Every path other than the special cases below
// gets the standard single-page-app catch-all rewrite, unchanged from
// `-s`'s prior behavior.
//
// /privacy and /terms used to be served here directly (a build-time
// static-generation step, back when this file's whole reason for
// existing was making them readable to a non-JS crawler). Ink Manager's
// own Privacy Policy/Terms have since moved to the marketing site as
// their permanent canonical home -- these two paths are now plain HTTP
// 301 redirects there instead, so any stale reference to the old
// web.inkmanager.app URLs (Twilio's own registration, a bookmark,
// anything else) still lands somewhere real during the transition
// rather than 404ing. LEGAL_REDIRECTS is checked before SPA_REWRITES /
// cleanUrls resolution, so it doesn't matter that dist/privacy and
// dist/terms no longer exist on disk.
//
// Redirect target is the bare inkmanager.app domain, not
// www.inkmanager.app: as of this writing www isn't yet attached as a
// custom domain on the marketing Railway service (confirmed live --
// Railway edge fallback 404 -- see REPORT.md), even though DNS already
// points it at the same place. Redirecting to a hostname that itself
// 404s would be strictly worse than the old behavior. Switch back to
// the www hostname once it's attached; both serve identical content
// from the same Railway service either way.
//
// /inquiry/:studioSlug (and /inquiry/:studioSlug/:formSlug) needed the
// same "a non-JS crawler must see real content" fix but CAN'T use the
// same build-time approach -- this route is per-studio and reflects a
// studio's own live intake-form config, not fixed developer copy known
// at build time. Handled below with real request-time SSR instead: a
// server-side fetch to the same public API the client itself calls
// (GET /studio-settings/public), injected into dist/index.html's
// #root before it's served. Deliberately shallow -- only studioName is
// fetched, not the full field list -- because the SMS-consent checkbox
// and its disclosure language (the actual thing a carrier reviewer
// checks for) are fixed copy in IntakeForm.tsx, not studio-configurable;
// reproducing the full dynamic field list here would be a second render
// path for content a crawler doesn't need. index.html uses
// `createRoot(...).render(...)` (not hydrateRoot), so this is safe:
// React fully replaces #root's contents on mount rather than trying to
// reconcile against this server-rendered markup, no hydration-mismatch
// risk either way.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import handler from 'serve-handler'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.join(__dirname, 'dist')
const PORT = Number(process.env.PORT) || 3000

// Same env var Vite inlines into the client bundle at build time
// (import.meta.env.VITE_API_URL) -- Railway exposes service env vars to
// both the build step and this runtime process, so it's already set
// correctly with zero new config. Falls back to skipping SSR entirely
// (plain SPA shell, today's behavior) if it's ever missing, rather than
// throwing and taking the whole route down.
const API_URL = process.env.VITE_API_URL

const LEGAL_REDIRECTS = {
  '/privacy': 'https://inkmanager.app/privacy',
  '/terms': 'https://inkmanager.app/terms',
}
const SPA_REWRITES = [{ source: '**', destination: '/index.html' }]
const INQUIRY_ROUTE = /^\/inquiry\/([^/]+)(?:\/([^/]+))?$/

let indexHtmlTemplate = null
function loadIndexHtmlTemplate() {
  if (indexHtmlTemplate === null) {
    indexHtmlTemplate = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8')
  }
  return indexHtmlTemplate
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Null on anything short of a clean, real studio -- every caller treats
// that as "fall back to the plain SPA shell", never a hard failure.
async function fetchStudioName(studioSlug, formSlug) {
  if (!API_URL) return null

  const query = new URLSearchParams({ studioSlug })
  if (formSlug) query.set('formSlug', formSlug)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)

  try {
    const res = await fetch(`${API_URL}/studio-settings/public?${query}`, { signal: controller.signal })
    if (!res.ok) return null
    const data = await res.json()
    return typeof data.studioName === 'string' && data.studioName ? data.studioName : null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function renderInquirySsr(studioSlug, formSlug) {
  const studioName = await fetchStudioName(studioSlug, formSlug)
  if (!studioName) return null

  const safeName = escapeHtml(studioName)
  // Mirrors IntakeForm.tsx's own fixed copy (both the warning banner and
  // the consent-checkbox label) -- not a paraphrase, so a crawler and a
  // JS-rendered visitor see the same disclosure text. The Privacy/Terms
  // links point at Ink Manager's own platform policy pages, matching
  // IntakeForm.tsx's own links -- not a per-studio /privacy/:studioSlug
  // path, which is a different, separately-authored document this
  // consent copy deliberately doesn't link to. Bare inkmanager.app, not
  // www.inkmanager.app -- see this file's header comment for why.
  const content = `
      <div style="max-width:42rem;margin:0 auto;padding:2.5rem 1.5rem 4rem;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#f2ece0">
        <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:1.75rem;margin:0 0 0.5rem">${safeName} — Tattoo Inquiry</h1>
        <p style="color:#c7bea9;font-size:0.9375rem">Tell us about the tattoo you have in mind.</p>
        <p style="color:#c7bea9;font-size:0.8125rem">You must be 18 years or older to receive a tattoo. Submitting this form does not confirm an appointment — it starts a conversation with the studio.</p>
        <label style="display:flex;gap:0.5rem;align-items:flex-start;color:#c7bea9;font-size:0.875rem;margin-top:1.5rem">
          <input type="checkbox" disabled />
          <span>I agree to receive text messages from ${safeName} regarding my appointment, including reminders and updates. Message and data rates may apply. Reply STOP to opt out. View our
            <a href="https://inkmanager.app/privacy" style="color:#c99a5b">Privacy Policy</a> and
            <a href="https://inkmanager.app/terms" style="color:#c99a5b">Terms</a>.</span>
        </label>
      </div>`

  const template = loadIndexHtmlTemplate()
  return template
    .replace('<title>ink-manager</title>', `<title>${safeName} — Ink Manager</title>`)
    .replace(
      '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <meta name="robots" content="index, follow" />',
    )
    .replace('<div id="root"></div>', `<div id="root">${content}</div>`)
}

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://placeholder').pathname).replace(/\/+$/, '') || '/'

  const redirectTarget = LEGAL_REDIRECTS[pathname]
  if (redirectTarget) {
    res.statusCode = 301
    res.setHeader('Location', redirectTarget)
    res.end()
    return
  }

  const inquiryMatch = pathname.match(INQUIRY_ROUTE)
  if (inquiryMatch) {
    const [, studioSlug, formSlug] = inquiryMatch
    renderInquirySsr(studioSlug, formSlug)
      .then((html) => {
        if (html === null) {
          // Fetch failed/timed out/unknown studio -- same plain SPA shell
          // this route always served; the client-side "couldn't find this
          // studio" state still handles an invalid slug correctly.
          return handler(req, res, { public: PUBLIC_DIR, rewrites: SPA_REWRITES })
        }
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(html)
      })
      .catch((err) => {
        console.error(err)
        res.statusCode = 500
        res.end('Internal Server Error')
      })
    return
  }

  handler(req, res, { public: PUBLIC_DIR, rewrites: SPA_REWRITES }).catch((err) => {
    console.error(err)
    res.statusCode = 500
    res.end('Internal Server Error')
  })
})

server.listen(PORT, () => {
  console.log(`Serving ${PUBLIC_DIR} on port ${PORT}`)
})
