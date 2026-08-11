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

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
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
    throw new ApiError(body?.error ?? `Request failed with status ${response.status}`, response.status, body?.code)
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
    throw new ApiError(body?.error ?? `Request failed with status ${response.status}`, response.status, body?.code)
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
