import { QueryClient } from '@tanstack/react-query'
import { isTransientApiFailure } from './api'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      // React Query's default is `retry: 3` with exponential backoff,
      // applied to EVERY failure -- including a 403 or 404, which are this
      // API deliberately saying no and will say exactly the same thing
      // three more times. The visible cost was roughly seven seconds of
      // "Loading project…" before a permission error finally surfaced, on
      // every detail page in the app; long enough to read as a hang rather
      // than as a wait, which is what it was reported as.
      //
      // isTransientApiFailure (lib/api.ts) already encodes exactly the
      // distinction this needs, and encodes it for a reason that cost this
      // repo a production incident: a Railway edge 404 (no reachable
      // replica, mid-deploy) means "ask again in a minute", an app 404
      // means "this does not exist", and the two are told apart by whether
      // the body carries an `error` field. Retry the first, never the
      // second. 5xx and network-level failures (a rejected fetch, which is
      // not an ApiError at all) stay retried, same as before.
      retry: (failureCount, error) => isTransientApiFailure(error) && failureCount < 3,
    },
  },
})
