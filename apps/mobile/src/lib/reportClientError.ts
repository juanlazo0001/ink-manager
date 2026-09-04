import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { API_URL } from '@/lib/api';
import { getToken } from '@/lib/tokenStorage';

/**
 * Send a crash somewhere a human can read it.
 *
 * The web half of this shipped in Package BK and immediately paid for itself:
 * a crash nobody could reproduce across two engines and two builds was
 * diagnosed in minutes once the error text and the build commit arrived
 * instead of a screenshot. Mobile had no equivalent, which is why a launch
 * crash on the owner's phone reached us as a sentence.
 *
 * Posts to the SAME `POST /client-errors` route the web boundary uses -- one
 * table, one place to look, and `boundary` says which client and screen it
 * came from.
 *
 * Deliberately not using the app's `api()` helper: that throws on non-2xx,
 * clears the session on 401 and parses JSON. A reporter that can throw inside
 * an error handler turns one crash into two. Everything here is best-effort
 * and swallows its own failures.
 */
export interface ClientErrorReport {
  message: string;
  stack?: string | null;
  componentStack?: string | null;
  /** Which screen's boundary caught it. */
  boundary?: string | null;
}

// One report per distinct message per app run. A render loop that crashes
// repeatedly must not become a request loop; the first report says
// everything the thousandth would.
const alreadySent = new Set<string>();

function appVersion(): string {
  const c = Constants.expoConfig;
  const version = c?.version ?? 'unknown';
  // runtimeVersion pins what JS bundle is actually loaded, which matters more
  // than the marketing version when an OTA update is in play.
  const runtime = typeof c?.runtimeVersion === 'string' ? c.runtimeVersion : null;
  return runtime ? `${version} (runtime ${runtime})` : version;
}

export async function reportClientError(report: ClientErrorReport): Promise<void> {
  try {
    const key = `${report.boundary ?? ''}|${report.message}`;
    if (alreadySent.has(key)) return;
    alreadySent.add(key);

    let token: string | null = null;
    try {
      token = await getToken();
    } catch {
      // Secure store unavailable -- an anonymous report is still worth having.
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    await fetch(`${API_URL}/client-errors`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message: String(report.message ?? '').slice(0, 2000),
        stack: report.stack ? String(report.stack).slice(0, 8000) : null,
        componentStack: report.componentStack ? String(report.componentStack).slice(0, 8000) : null,
        // Prefixed so a report is attributable to the client it came from at
        // a glance -- the web boundary sends bare screen labels.
        boundary: report.boundary ? `mobile:${report.boundary}` : 'mobile',
        url: `app://${report.boundary ?? 'unknown'}`,
        userAgent: `${Platform.OS} ${String(Platform.Version)} · Ink Manager ${appVersion()}`,
        appCommit: appVersion(),
        appBuiltAt: null,
        viewport: null,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    // Offline, rate-limited, anything: the on-screen Details panel is the
    // fallback path to a human, and a failed report must never surface.
  }
}
