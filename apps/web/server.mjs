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
// OG/Twitter link previews (this file's second reason for existing,
// added alongside the original /inquiry SSR fix): a link-preview
// crawler doesn't execute JS, so it sees whatever's already in
// dist/index.html's static <head> -- nothing route-specific unless this
// server injects it first. PUBLIC_ROUTE_HANDLERS below covers every
// public route that gets shared as a link (deposit/estimate/intake/
// waiver/gift-card/self-schedule/flash-gallery/artist-page), each
// fetching only what's needed for a generic, privacy-safe preview (see
// PRIVACY note below) from the same public API endpoints the client
// itself already calls. /s/:code gets its own handling: it's not a page
// at all, it's the ACTUAL url every deposit/waiver/estimate/gift-card
// text message points at (lib/shortLinks.ts), and until this fix it did
// a pure client-side JS redirect with nothing for a non-JS crawler to
// see at all -- now resolved server-side into a real HTTP redirect, so
// a crawler follows it straight to the destination route's own tags
// rather than stopping dead at an empty shell.
//
// PRIVACY (hard rule, do not relax): tags built here NEVER include a
// client's name, an amount, or appointment details -- these previews
// render in message threads and get cached by the crawler/platform
// itself, well outside this app's own access control. Every resolver
// below picks out only studio/artist-level fields (name, logo/avatar)
// from each verify response, never passing the raw response through.
// The one deliberate exception is the artist's own public page: real
// name and photo are fine there specifically because that page is
// public by the artist's own choice (see resolveArtistPage).
//
// Studio.logoUrl / User.avatarUrl are stored as base64 data: URLs
// (lib/images.ts), not hosted files -- no preview crawler fetches a
// data: URI for og:image. /public-assets/studio-logo/:slug and
// /public-assets/artist-avatar/:publicSlug (routes/publicAssets.ts,
// API-side) decode and re-serve them as real image responses purely so
// there's an actual URL to point at; imageUrlFor() below builds those
// URLs and falls back to the platform's own mark when a studio/artist
// has no image set at all.
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
// path for content a crawler doesn't need. The phone field's label and
// helper line ARE mirrored, for the same reason the checkbox is: a carrier
// reviewer fetching this URL with no JS must see that a phone number is
// not itself consent -- the implied-consent sentence that used to sit
// there is exactly what the review flagged. This snapshot mirrors the real
// form and adds nothing of its own; both the helper line and the checkbox
// disclosure are byte-identical to IntakeForm.tsx's en.ts strings, and
// must stay that way. index.html uses
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
// correctly with zero new config. Every resolver below falls back to
// skipping SSR/OG injection entirely (plain SPA shell, today's default
// behavior) if it's ever missing, rather than throwing and taking the
// whole route down.
const API_URL = process.env.VITE_API_URL

const SITE_NAME = 'Ink Manager'
const DEFAULT_OG_IMAGE_PATH = '/branding/logo-black-512.png'

const LEGAL_REDIRECTS = {
  '/privacy': 'https://inkmanager.app/privacy',
  '/terms': 'https://inkmanager.app/terms',
}
const SPA_REWRITES = [{ source: '**', destination: '/index.html' }]

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

function absoluteUrl(req, pathOrUrl) {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl
  const proto = req.headers['x-forwarded-proto'] || 'http'
  const host = req.headers.host
  return `${proto}://${host}${pathOrUrl}`
}

// Null on anything short of a clean 2xx JSON response -- every caller
// treats that as "fall back to the plain SPA shell / default meta tags",
// never a hard failure. A non-JS crawler getting the platform's generic
// preview instead of a studio-specific one is a fine degradation; taking
// the route down over it is not.
async function fetchJson(url) {
  if (!API_URL) return null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

// data.studioLogoUrl is a base64 data: URL or null -- never usable
// directly as og:image (see file header). If present at all, the real
// image lives at the decode-and-serve endpoint keyed by studioSlug;
// otherwise fall back to the platform mark.
function studioImageUrl(req, data) {
  if (data.studioLogoUrl && data.studioSlug) {
    return absoluteUrl(req, `${strippedApiOrigin()}/public-assets/studio-logo/${encodeURIComponent(data.studioSlug)}`)
  }
  return absoluteUrl(req, DEFAULT_OG_IMAGE_PATH)
}

// og:image must be this app's own reachable URL, not a relative path
// against the API's separate domain -- API_URL is already absolute
// (e.g. https://api.inkmanager.app), used as-is rather than rebuilt
// against this server's own host.
function strippedApiOrigin() {
  return API_URL ? API_URL.replace(/\/+$/, '') : ''
}

function buildHeadTags({ title, description, image, siteName = SITE_NAME }) {
  return `
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${escapeHtml(siteName)}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${escapeHtml(image)}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(image)}" />`
}

// Replaces the default <title> and strips index.html's own static
// og:*/twitter:* fallback tags before inserting route-specific ones --
// most crawlers (Facebook's own documented behavior, and the OG spec's
// general convention) use the FIRST tag of a given property they find,
// so leaving the static defaults in place ahead of these would make
// them win over the real ones rather than just sitting there unused.
function injectHeadTags(template, tags) {
  let out = template
  if (tags.title) {
    out = out.replace(/<title>.*?<\/title>/, `<title>${escapeHtml(tags.title)}</title>`)
  }
  out = out.replace(/\s*<meta (?:property="og:|name="twitter:)[^>]*>/g, '')
  return out.replace('</head>', `${buildHeadTags(tags)}\n  </head>`)
}

function injectRootContent(template, html) {
  return template.replace('<div id="root"></div>', `<div id="root">${html}</div>`)
}

// --- Per-route-type OG tag resolvers -------------------------------
// Each takes (req, ...params) and returns { title, description, image }
// or null (unknown/expired/fetch failed -- caller falls back to the
// plain SPA shell, which now carries index.html's own clean defaults).

async function resolveDeposit(req, token) {
  const data = await fetchJson(`${API_URL}/deposits/verify/${encodeURIComponent(token)}`)
  if (!data?.studioName) return null
  return {
    title: `${data.studioName} — Secure Deposit Form`,
    description: 'Review and pay your deposit securely to confirm your appointment.',
    image: studioImageUrl(req, data),
  }
}

async function resolveEstimate(req, token, { revision = false } = {}) {
  const url = revision
    ? `${API_URL}/estimates/revision/verify/${encodeURIComponent(token)}`
    : `${API_URL}/estimates/verify/${encodeURIComponent(token)}`
  const data = await fetchJson(url)
  if (!data?.studioName) return null
  return {
    title: `${data.studioName} — Your Tattoo Estimate`,
    description: 'View your estimate and next steps.',
    image: studioImageUrl(req, data),
  }
}

async function resolveWaiver(req, token) {
  const data = await fetchJson(`${API_URL}/waivers/verify/${encodeURIComponent(token)}`)
  if (!data?.studioName) return null
  return {
    title: `${data.studioName} — Liability Waiver`,
    description: 'Review and sign your waiver before your appointment.',
    image: studioImageUrl(req, data),
  }
}

async function resolveGiftCard(req, code) {
  const data = await fetchJson(`${API_URL}/gift-cards/view/${encodeURIComponent(code)}`)
  if (!data?.studioName) return null
  return {
    // Deliberately no amount -- see file header PRIVACY note.
    title: `${data.studioName} — Gift Card`,
    description: 'View your Ink Manager gift card.',
    image: studioImageUrl(req, data),
  }
}

// Part 2: had no resolver at all before this -- a shared flash-payment link
// fell back to the generic default OG tags, unlike every other public
// route's own studio-branded preview. Same shape/privacy posture as
// resolveDeposit right above (studio logo only, via studioImageUrl -- the
// personalized reference-image background this page can now show is never
// eligible for og:image, same as every other route here).
async function resolveFlashPayment(req, token) {
  const data = await fetchJson(`${API_URL}/flash-payment/verify/${encodeURIComponent(token)}`)
  if (!data?.studioName) return null
  return {
    title: `${data.studioName} — Flash Booking Payment`,
    description: 'Complete your payment to lock in your flash booking.',
    image: studioImageUrl(req, data),
  }
}

async function resolveSelfSchedule(req, token) {
  const data = await fetchJson(`${API_URL}/self-schedule/verify/${encodeURIComponent(token)}`)
  if (!data?.studioName) return null
  return {
    title: `${data.studioName} — Book Your Appointment`,
    description: 'Pick a time that works for you.',
    image: studioImageUrl(req, data),
  }
}

async function resolveFlashGallery(req, studioSlug, artistId) {
  const query = new URLSearchParams({ studioSlug, artistId })
  const data = await fetchJson(`${API_URL}/flash-pieces/public?${query}`)
  if (!data?.studioName) return null
  return {
    title: `${data.artistName ?? 'Flash'} at ${data.studioName}`,
    description: 'Browse available flash designs and request a booking.',
    image: studioImageUrl(req, data),
  }
}

// The one route allowed to use a real person's own name/photo -- an
// artist's public page is public by the artist's own deliberate choice
// (they set publicSlug/publishedAt themselves), not client-facing data
// that happened to leak into a link. avatarUrl here is still a data:
// URL under the hood, so it still routes through the decode-and-serve
// endpoint, just keyed by publicSlug instead of studioSlug.
async function resolveArtistPage(req, publicSlug) {
  const data = await fetchJson(`${API_URL}/artists/public/${encodeURIComponent(publicSlug)}`)
  if (!data?.name) return null
  const image = data.avatarUrl
    ? absoluteUrl(req, `${strippedApiOrigin()}/public-assets/artist-avatar/${encodeURIComponent(publicSlug)}`)
    : absoluteUrl(req, DEFAULT_OG_IMAGE_PATH)
  return {
    title: `${data.name} — Tattoo Artist`,
    description: data.homeStudio?.name
      ? `Book with ${data.name} at ${data.homeStudio.name}.`
      : `Book with ${data.name}.`,
    image,
  }
}

// Mirrors IntakeForm.tsx's own fixed disclosure copy -- see this file's
// header comment for why only studioName is fetched here, not the full
// dynamic field list.
async function resolveIntake(req, studioSlug, formSlug) {
  const query = new URLSearchParams({ studioSlug })
  if (formSlug) query.set('formSlug', formSlug)
  const data = await fetchJson(`${API_URL}/studio-settings/public?${query}`)
  const studioName = typeof data?.studioName === 'string' && data.studioName ? data.studioName : null
  if (!studioName) return null
  return {
    studioName,
    tags: {
      title: `${studioName} — Tattoo Inquiry`,
      description: `Tell ${studioName} about the tattoo you have in mind.`,
      image: studioImageUrl(req, { studioName, studioLogoUrl: data.studioLogoUrl, studioSlug }),
    },
  }
}

// path: [RegExp, resolver] pairs, checked in order. Each resolver's
// captured groups are spread as its own arguments (after req).
const PUBLIC_ROUTE_HANDLERS = [
  [/^\/deposit\/([^/]+)$/, (req, m) => resolveDeposit(req, m[1])],
  [/^\/flash-payment\/([^/]+)$/, (req, m) => resolveFlashPayment(req, m[1])],
  [/^\/estimate\/([^/]+)$/, (req, m) => resolveEstimate(req, m[1])],
  [/^\/estimate-revision\/([^/]+)$/, (req, m) => resolveEstimate(req, m[1], { revision: true })],
  [/^\/waiver\/([^/]+)$/, (req, m) => resolveWaiver(req, m[1])],
  [/^\/gift-card\/([^/]+)$/, (req, m) => resolveGiftCard(req, m[1])],
  [/^\/schedule\/([^/]+)$/, (req, m) => resolveSelfSchedule(req, m[1])],
  [/^\/flash\/([^/]+)\/([^/]+)$/, (req, m) => resolveFlashGallery(req, m[1], m[2])],
  [/^\/artist\/([^/]+)$/, (req, m) => resolveArtistPage(req, m[1])],
]

const INQUIRY_ROUTE = /^\/inquiry\/([^/]+)(?:\/([^/]+))?$/
const SHORT_LINK_ROUTE = /^\/s\/([^/]+)$/

async function renderInquirySsr(req, studioSlug, formSlug) {
  const resolved = await resolveIntake(req, studioSlug, formSlug)
  if (!resolved) return null

  const safeName = escapeHtml(resolved.studioName)
  const content = `
      <div style="max-width:42rem;margin:0 auto;padding:2.5rem 1.5rem 4rem;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#f2ece0">
        <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:1.75rem;margin:0 0 0.5rem">${safeName} — Tattoo Inquiry</h1>
        <p style="color:#c7bea9;font-size:0.9375rem">Tell us about the tattoo you have in mind.</p>
        <p style="color:#c7bea9;font-size:0.8125rem">You must be 18 years or older to receive a tattoo. Submitting this form does not confirm an appointment — it starts a conversation with the studio.</p>
        <p style="color:#f2ece0;font-size:0.8125rem;font-weight:600;margin:1.5rem 0 0.25rem">Phone</p>
        <p style="color:#c7bea9;font-size:0.8125rem;margin:0">Optional — used to contact you about your inquiry. Text-message updates require the consent box below.</p>
        <label style="display:flex;gap:0.5rem;align-items:flex-start;color:#c7bea9;font-size:0.875rem;margin-top:0.75rem">
          <input type="checkbox" disabled />
          <span>I agree to receive text messages from ${safeName} regarding my appointment, including reminders, estimate follow-ups, and updates. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help. Reply START to rejoin at any time. View our
            <a href="https://inkmanager.app/privacy" style="color:#c99a5b">Privacy Policy</a> and
            <a href="https://inkmanager.app/terms" style="color:#c99a5b">Terms</a>.</span>
        </label>
      </div>`

  let template = loadIndexHtmlTemplate()
  template = template.replace(
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <meta name="robots" content="index, follow" />',
  )
  template = injectHeadTags(template, resolved.tags)
  return injectRootContent(template, content)
}

async function renderOgOnly(req, resolver, match) {
  const tags = await resolver(req, match)
  if (!tags) return null
  return injectHeadTags(loadIndexHtmlTemplate(), tags)
}

async function resolveShortLinkRedirect(code) {
  const data = await fetchJson(`${API_URL}/s/${encodeURIComponent(code)}`)
  if (!data?.targetUrl) return null
  return data.targetUrl
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

  // The actual URL every deposit/waiver/estimate/gift-card text message
  // points at (lib/shortLinks.ts) -- resolved server-side into a real
  // redirect so a non-JS crawler follows it to the destination route's
  // own OG tags instead of stopping dead at the client-side-only
  // redirect page. A miss (bad/expired code) falls through to the plain
  // SPA shell, which still shows ShortLinkRedirect.tsx's own "link not
  // found" state for a real visitor.
  const shortLinkMatch = pathname.match(SHORT_LINK_ROUTE)
  if (shortLinkMatch) {
    resolveShortLinkRedirect(shortLinkMatch[1])
      .then((targetUrl) => {
        if (!targetUrl) {
          return handler(req, res, { public: PUBLIC_DIR, rewrites: SPA_REWRITES })
        }
        res.statusCode = 302
        res.setHeader('Location', targetUrl)
        res.end()
      })
      .catch((err) => {
        console.error(err)
        res.statusCode = 500
        res.end('Internal Server Error')
      })
    return
  }

  const inquiryMatch = pathname.match(INQUIRY_ROUTE)
  if (inquiryMatch) {
    const [, studioSlug, formSlug] = inquiryMatch
    renderInquirySsr(req, studioSlug, formSlug)
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

  for (const [pattern, resolver] of PUBLIC_ROUTE_HANDLERS) {
    const match = pathname.match(pattern)
    if (!match) continue
    renderOgOnly(req, resolver, match)
      .then((html) => {
        if (html === null) {
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
