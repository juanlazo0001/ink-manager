import { TOKEN_STORAGE_KEY } from '../context/auth-context'
import { APP_BUILT_AT, APP_COMMIT } from './buildInfo'

// Package BK: send a crash somewhere a human can read it.
//
// The ErrorBoundary used to say "let us know" while capturing nothing, so a
// crash on someone else's phone was unreproducible by construction -- which is
// exactly the situation this package was opened to resolve (a specialties-field
// crash on production iOS Safari that four browsers and two builds could not
// reproduce).
//
// Deliberately NOT using apiFetch: that throws on non-2xx, redirects on 401,
// and JSON-parses the response. A reporter that can throw inside an error
// handler turns one crash into two. Everything here is best-effort and
// swallows its own failures.

const API_URL = import.meta.env.VITE_API_URL

export interface ClientErrorReport {
  message: string
  stack?: string | null
  componentStack?: string | null
  // Which boundary caught it (e.g. "App", "ClientDetail").
  boundary?: string | null
}

// One report per distinct message per page load. A render loop that crashes
// repeatedly must not turn into an outbound request loop -- the first report
// carries the same information as the thousandth.
const alreadySent = new Set<string>()

export function reportClientError(report: ClientErrorReport): void {
  try {
    if (!API_URL) return

    const key = `${report.boundary ?? ''}|${report.message}`
    if (alreadySent.has(key)) return
    alreadySent.add(key)

    const body = JSON.stringify({
      message: String(report.message ?? '').slice(0, 2000),
      stack: report.stack ? String(report.stack).slice(0, 8000) : null,
      componentStack: report.componentStack ? String(report.componentStack).slice(0, 8000) : null,
      boundary: report.boundary ?? null,
      url: window.location.href,
      userAgent: navigator.userAgent,
      appCommit: APP_COMMIT,
      appBuiltAt: APP_BUILT_AT,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      timestamp: new Date().toISOString(),
    })

    // Authenticated when we can be -- the server records who it happened to,
    // which is the difference between "someone" and "the artist who cannot
    // finish onboarding". The route accepts anonymous reports too, because a
    // crash on a public page (invite acceptance, waiver signing) has no token
    // and is exactly the kind we most need to see.
    let token: string | null = null
    try {
      token = localStorage.getItem(TOKEN_STORAGE_KEY)
    } catch {
      // Safari private mode throws on localStorage access.
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`

    // keepalive so the report still goes out if the crash is followed by a
    // reload or a tab close.
    void fetch(`${API_URL}/client-errors`, {
      method: 'POST',
      headers,
      body,
      keepalive: true,
    }).catch(() => {
      // Offline, blocked, rate-limited -- the Details panel on the crash
      // screen is the fallback path for getting this to a human.
    })
  } catch {
    // Never let the reporter throw. Whatever went wrong, the user is already
    // looking at a crash screen.
  }
}
