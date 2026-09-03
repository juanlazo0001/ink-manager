import { Component, type ErrorInfo, type ReactNode } from 'react'
import { APP_BUILT_AT, APP_COMMIT } from '../lib/buildInfo'
import { reportClientError } from '../lib/reportClientError'

interface ErrorBoundaryProps {
  children: ReactNode
  // Optional context label included in the console log (e.g. "ClientDetail")
  // so a crash reported from the console is easy to trace back to which
  // boundary caught it, without needing a full component stack read.
  label?: string
}

interface ErrorBoundaryState {
  hasError: boolean
  message: string
  componentStack: string
  showDetails: boolean
}

const EMPTY: ErrorBoundaryState = { hasError: false, message: '', componentStack: '', showDetails: false }

// Render-time crashes (a null/undefined field a component assumes is always
// present, an unhandled shape mismatch after an API response changes, etc.)
// previously produced a silent blank page -- React unmounts the crashed
// subtree with nothing left to show. This is the one place a class
// component is required: React's error-boundary lifecycle methods
// (getDerivedStateFromError/componentDidCatch) have no hook equivalent.
//
// Package BK made it say what happened. It previously rendered "let us know"
// while capturing nothing at all, so a crash on someone else's device was
// unreproducible by construction: a specialties-field crash on production iOS
// Safari survived a whole session of investigation across two engines and two
// builds precisely because no error text ever reached anyone. Now the message
// and component stack are shown on screen (screenshot-able by the person
// hitting it) AND posted to the server with the build commit attached.
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = EMPTY

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, message: error?.message ?? String(error) }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const componentStack = errorInfo.componentStack ?? ''
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ''}]`, error, componentStack)
    this.setState({ componentStack })

    reportClientError({
      message: error?.message ?? String(error),
      stack: error?.stack ?? null,
      componentStack,
      boundary: this.props.label ?? null,
    })
  }

  render() {
    if (this.state.hasError) {
      const { message, componentStack, showDetails } = this.state
      return (
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-lg font-semibold text-fg">Something went wrong</p>
          <p className="text-sm text-fg-secondary">Try reloading the page. If this keeps happening, let us know.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover"
          >
            Reload
          </button>

          <button
            type="button"
            onClick={() => this.setState((s) => ({ ...s, showDetails: !s.showDetails }))}
            aria-expanded={showDetails}
            className="mt-1 text-xs font-medium text-fg-muted underline underline-offset-4 transition hover:text-fg"
          >
            {showDetails ? 'Hide details' : 'Details'}
          </button>

          {showDetails && (
            // Left-aligned and scrollable: this exists to be screenshotted or
            // read aloud over the phone, so it has to be legible on a narrow
            // screen rather than centred and clipped.
            <div className="mt-2 w-full max-w-md overflow-x-auto rounded-xl border border-border bg-surface-inset p-3 text-left">
              <p className="break-words font-mono text-xs text-fg">{message || '(no message)'}</p>
              <p className="mt-2 font-mono text-[11px] text-fg-muted">
                build {APP_COMMIT} · {APP_BUILT_AT}
              </p>
              {componentStack && (
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-snug text-fg-secondary">
                  {componentStack.trim()}
                </pre>
              )}
            </div>
          )}
        </div>
      )
    }

    return this.props.children
  }
}
