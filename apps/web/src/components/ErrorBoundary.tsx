import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  // Optional context label included in the console log (e.g. "ClientDetail")
  // so a crash reported from the console is easy to trace back to which
  // boundary caught it, without needing a full component stack read.
  label?: string
}

interface ErrorBoundaryState {
  hasError: boolean
}

// Render-time crashes (a null/undefined field a component assumes is always
// present, an unhandled shape mismatch after an API response changes, etc.)
// previously produced a silent blank page -- React unmounts the crashed
// subtree with nothing left to show. This is the one place a class
// component is required: React's error-boundary lifecycle methods
// (getDerivedStateFromError/componentDidCatch) have no hook equivalent.
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ''}]`, error, errorInfo.componentStack)
  }

  render() {
    if (this.state.hasError) {
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
        </div>
      )
    }

    return this.props.children
  }
}
