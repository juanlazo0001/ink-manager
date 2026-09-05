# Ink Manager — Marketing Site

Static marketing page served at https://inkmanager.app -- the apex IS the canonical
host, and every page sets `rel=canonical` to it. `www.inkmanager.app` has no service
mapped to it at Railway and returns an edge 404 on every path, so do not point
anything at www without mapping that host first.

- `index.html` — the homepage (self-contained; images in `assets/`)
- `privacy/index.html`, `terms/index.html` — Ink Manager's own platform-level Privacy
  Policy / Terms & Conditions, the canonical home for these since they moved here from
  the studio portal (`web.inkmanager.app/privacy` and `/terms` are now 301 redirects to
  these pages, not removed). Each is self-contained (own inline `<style>`), same
  zero-build-tool pattern as `index.html` -- no shared template, so a copy-paste diff
  between the two when editing shared chrome (header/footer) is expected, not a bug.
  `privacy-policy-platform.md` / `terms-platform.md` are the checked-in canonical
  drafts to edit first, then hand-convert into the matching `index.html`.
- No build step for any of these -- `serve .` (no `-s`/`--single`) resolves clean URLs
  like `/privacy` to `privacy/index.html` on its own, so a plain static file at that
  path is all "the route" is.
- Deployed as its own Railway service: Root Directory = `marketing`, start command from package.json (`npm start`).
- To update imagery: replace files in `assets/` keeping the same filenames.
