import { TOKEN_STORAGE_KEY } from '../context/auth-context'

const API_URL = import.meta.env.VITE_API_URL

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
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

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(viewAsUserId ? { 'X-View-As-User': viewAsUserId } : {}),
      ...options.headers,
    },
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(body?.error ?? `Request failed with status ${response.status}`, response.status)
  }

  if (response.status === 204) {
    return null as T
  }

  return response.json()
}
