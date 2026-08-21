import { TOKEN_STORAGE_KEY } from '../context/auth-context'

const API_URL = import.meta.env.VITE_API_URL

export class ApiError extends Error {
  status: number
  // Machine-readable discriminator for the rare error response that needs
  // more than "show this message" -- e.g. /login's email_not_verified,
  // which the caller needs to distinguish from a plain wrong-password 401
  // to offer a "resend verification" action instead of just an error
  // banner. Optional: most error bodies have no `code` field at all, and
  // this stays undefined for those, same as before this field existed.
  code?: string
  // Did THIS APP'S API produce this error, or did something in front of it?
  //
  // Every error response this API emits is `res.status(N).json({ error })`
  // -- an `error` field is universal across every route. Railway's edge
  // router, when a service has no reachable replica (mid-deploy, crash
  // loop, failed healthcheck, renamed domain), answers on its behalf with
  // `404 {"status":"error","code":404,"message":"Application not found"}`
  // and an `x-railway-fallback: true` header -- a 404 with NO `error`
  // field. Presence of that field is therefore the discriminator, and it
  // matters enormously: an app 404 means "this thing does not exist", an
  // edge 404 means "ask again in a minute". Conflating them is what took
  // the public intake page down (see REPORT.md, 2026-08-21).
  fromApi: boolean

  constructor(message: string, status: number, code?: string, fromApi = true) {
    super(message)
    this.status = status
    this.code = code
    this.fromApi = fromApi
  }
}

// "Should the caller retry, or is this answer final?"
//
// True for anything that is NOT this API deliberately saying no: an edge/
// proxy response (see ApiError.fromApi), any 5xx, and a network-level
// failure (fetch rejects with a TypeError, which is not an ApiError at
// all). Public, unauthenticated pages MUST branch on this before rendering
// any "we couldn't find it" state -- telling a visitor that a studio does
// not exist because a deploy was in flight is far worse than making them
// wait, and it is the kind of thing a carrier reviewer sees exactly once.
export function isTransientApiFailure(err: unknown): boolean {
  if (err instanceof ApiError) return !err.fromApi || err.status >= 500
  // A rejected fetch (offline, DNS, TLS, connection reset) never becomes an
  // ApiError -- it lands here.
  return err instanceof TypeError
}

// Retry wrapper for public page loads. Deliberately retries ONLY transient
// failures -- a genuine 404 resolves immediately as a real answer, with no
// artificial delay added to the common "bad link" case.
//
// Three attempts at 400ms/1200ms covers a Railway redeploy gap (the API's
// own start script runs `prisma migrate deploy` before listening, so the
// window is seconds, not milliseconds) without leaving a visitor staring at
// a spinner for anything like as long as the old failure mode cost them.
export async function fetchPublicWithRetry<T>(
  path: string,
  options: RequestInit = {},
  attempts = 3,
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await apiFetch<T>(path, options)
    } catch (err) {
      lastErr = err
      if (!isTransientApiFailure(err) || attempt === attempts - 1) throw err
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 400 : 1200))
    }
  }
  throw lastErr
}

// View As (admin impersonation): deliberately plain module state, not React
// state or localStorage -- it must live only in frontend memory so a page
// refresh drops back to the admin's own view, and apiFetch is a plain
// function (not a hook) called from far more places than could reasonably
// consume a context directly. ViewAsContext is the only thing that calls
// this setter.
let viewAsUserId: string | null = null

export function setViewAsUserId(id: string | null) {
  viewAsUserId = id
}

export function getViewAsUserId() {
  return viewAsUserId
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY)

  // A FormData body (Package R's CSV upload) needs the browser to set its
  // own multipart/form-data Content-Type with the correct boundary --
  // forcing application/json here would break the request. Every other
  // caller still gets the JSON default unchanged.
  const isFormData = options.body instanceof FormData

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(viewAsUserId ? { 'X-View-As-User': viewAsUserId } : {}),
      ...options.headers,
    },
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    // See ApiError.fromApi: an `error` field is the fingerprint of this
    // app's own error responses. A body without one (Railway's edge
    // fallback, a proxy's HTML error page, an empty body) did not come
    // from the API, whatever its status code says.
    const fromApi = typeof body?.error === 'string'
    throw new ApiError(
      body?.error ?? `Request failed with status ${response.status}`,
      response.status,
      body?.code,
      fromApi,
    )
  }

  if (response.status === 204) {
    return null as T
  }

  return response.json()
}

// Authenticated binary download (PDF export etc.) -- apiFetch always parses
// the response as JSON, which a file response isn't, so this is a separate,
// small sibling rather than trying to overload apiFetch's return type.
// Triggers a normal browser "Save As" via a throwaway <a download> element,
// same technique any static file link would use, just fed a blob: URL
// instead of a real one since the request needs the Bearer token apiFetch
// itself attaches.
export async function downloadFile(path: string, filename: string, options: RequestInit = {}): Promise<void> {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY)

  // options: additive, defaults to every existing caller's plain GET --
  // the CSV client-export feature is the first caller that needs a POST
  // body (a clientIds array/filter object too large to reasonably encode
  // as a query string).
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(viewAsUserId ? { 'X-View-As-User': viewAsUserId } : {}),
      ...options.headers,
    },
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    // See ApiError.fromApi: an `error` field is the fingerprint of this
    // app's own error responses. A body without one (Railway's edge
    // fallback, a proxy's HTML error page, an empty body) did not come
    // from the API, whatever its status code says.
    const fromApi = typeof body?.error === 'string'
    throw new ApiError(
      body?.error ?? `Request failed with status ${response.status}`,
      response.status,
      body?.code,
      fromApi,
    )
  }

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
