// Post-build step: emits real, static, JavaScript-free HTML for /privacy
// and /terms into dist/privacy/index.html and dist/terms/index.html.
//
// Why this exists: this app is a client-side-only Vite SPA (`serve -s
// dist` in production -- confirmed via `content-disposition: inline;
// filename="index.html"` on every path, including /privacy, in the raw
// production response). A crawler that doesn't execute JavaScript -- e.g.
// Twilio's A2P 10DLC carrier-review crawler -- only ever sees the empty
// `<div id="root"></div>` shell at those URLs, never the real policy
// text. That was flagged as a residual risk when /privacy and /terms
// were first built (see REPORT.md) and is the confirmed cause of a
// carrier rejection citing "a compliant privacy policy can not be
// verified."
//
// Fix: generate literal static files at build time so the *server*
// resolves /privacy and /terms to real HTML directly -- no SPA fallback,
// no JS execution required to read them.
//
// This alone is NOT sufficient with `serve -s` (single-page-app mode):
// verified directly against the real `serve`/serve-handler internals
// (not assumed) that `-s`/`--single` prepends an unconditional
// `{source: "**", destination: "/index.html"}` rewrite, and that
// serve-handler's rewrite resolution is RECURSIVE -- even a more
// specific rule listed earlier in a serve.json `rewrites` array still
// gets re-matched against the catch-all immediately after being applied
// (each successful match recurses on the remaining rules against the
// NEWLY rewritten path), so "/privacy" -> "/privacy/index.html" gets
// re-checked against "**" and rewritten AGAIN to "/index.html". A
// serve.json with /privacy/terms listed before "**" does not survive
// this. apps/web's production start script was replaced with a small
// custom server (apps/web/server.mjs) that only ever applies the SPA
// catch-all rewrite to paths other than /privacy and /terms -- see that
// file's own header comment for the full reasoning and the debug trail
// that found this.
//
// Content source: src/content/platformPolicies.ts -- the exact same
// HTML-string constants PlatformPolicyPage.tsx renders client-side for
// in-app navigation. One content source, two render paths (this static
// file for the first/direct hit, the React route for anyone already
// inside the loaded SPA) -- not a second copy to keep in sync by hand.
// That file has zero TypeScript-specific syntax (no type annotations),
// so it's loaded here via esbuild's transform (already a transitive
// dependency of Vite, no new package needed) rather than requiring a
// dedicated TS-execution toolchain for one small build script.
//
// No DOMPurify pass here (unlike the React render path) -- this content
// is fixed, developer-authored copy, not user input, and DOMPurify is a
// browser/DOM API with no meaningful Node equivalent available in this
// project. Trusted at the source, same as it already is in
// platformPolicies.ts itself.

import { transformSync } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Module from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(__dirname, '..')
const contentPath = path.join(webRoot, 'src/content/platformPolicies.ts')
const distDir = path.join(webRoot, 'dist')

function loadPlatformPolicies() {
  const source = fs.readFileSync(contentPath, 'utf8')
  const { code } = transformSync(source, { loader: 'ts', format: 'cjs' })
  const mod = new Module(contentPath)
  mod.filename = contentPath
  mod.paths = Module._nodeModulePaths(path.dirname(contentPath))
  mod._compile(code, contentPath)
  return mod.exports
}

function renderPage(title, bodyHtml) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="index, follow" />
    <title>${title} — Ink Manager</title>
    <link rel="icon" type="image/x-icon" href="/favicon.ico" />
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        background: #0e0b08;
        color: #f2ece0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      }
      main {
        max-width: 42rem;
        margin: 0 auto;
        padding: 2.5rem 1.5rem 4rem;
      }
      .byline {
        margin: 0;
        font-size: 0.875rem;
        font-weight: 500;
        color: #c7bea9;
      }
      h1 {
        margin: 0.25rem 0 0;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 1.75rem;
        font-weight: 700;
        color: #f2ece0;
      }
      .policy-body {
        margin-top: 1.5rem;
        font-size: 0.9375rem;
        line-height: 1.6;
        color: #c7bea9;
      }
      .policy-body h2 {
        margin: 1.5rem 0 0.375rem;
        font-size: 1.0625rem;
        font-weight: 600;
        color: #f2ece0;
      }
      .policy-body h2:first-child { margin-top: 0; }
      .policy-body p { margin: 0.5rem 0; }
      .policy-body ul, .policy-body ol { margin: 0.5rem 0; padding-left: 1.5rem; }
      .policy-body li { margin: 0.2rem 0; }
      .policy-body a { color: #c99a5b; }
      .policy-body strong { color: #f2ece0; }
    </style>
  </head>
  <body>
    <main>
      <p class="byline">Ink Manager</p>
      <h1>${title}</h1>
      <div class="policy-body">
${bodyHtml}
      </div>
    </main>
  </body>
</html>
`
}

function writePage(routeDir, title, bodyHtml) {
  const outDir = path.join(distDir, routeDir)
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'index.html'), renderPage(title, bodyHtml), 'utf8')
  console.log(`wrote dist/${routeDir}/index.html`)
}

if (!fs.existsSync(distDir)) {
  throw new Error(`dist/ not found at ${distDir} -- run vite build before this script`)
}

const { PLATFORM_PRIVACY_POLICY_HTML, PLATFORM_TERMS_HTML } = loadPlatformPolicies()
writePage('privacy', 'Privacy Policy', PLATFORM_PRIVACY_POLICY_HTML)
writePage('terms', 'Terms & Conditions', PLATFORM_TERMS_HTML)
