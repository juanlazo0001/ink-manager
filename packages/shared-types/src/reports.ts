/**
 * `GET /reports/dashboard` — one combined endpoint, deliberately, because
 * the dashboard loads every section at once.
 *
 * Requires `reports.viewDashboard`, which ARTIST holds by default.
 */
export interface DashboardFunnelStage {
  stage: 'received' | 'estimateSent' | 'responded' | 'depositPending' | 'scheduled' | 'completed';
  label: string;
  count: number;
  /** Percentage of `received`, to one decimal. `null` when nothing was received. */
  conversionFromReceived: number | null;
}

export interface DashboardResponse {
  /** The resolved window, echoed back as instants. */
  range: { start: string; end: string };
  /**
   * `"own"` means every number below is the CALLER's own assigned work,
   * not the studio's — the API scopes an ARTIST down automatically. It
   * drives the copy ("your work" vs "the studio") and whether a
   * cross-artist comparison means anything at all.
   */
  scope: 'own' | 'studio';
  funnel: { stages: DashboardFunnelStage[] };
  lostRate: {
    lost: number;
    cold: number;
    converted: number;
    /** `null` when none of the three has happened yet. */
    lostColdRate: number | null;
  };
  responseTime: {
    /** `null` when no estimate has been sent in the window. */
    avgHoursToEstimateSent: number | null;
    avgHoursToResponse: number | null;
    /** How many rows each average is built from. An average of one is not an average. */
    sampleSizeEstimateSent: number;
    sampleSizeResponse: number;
  };
  artistUtilization: { artistId: string; name: string; appointmentCount: number }[];
  /**
   * Projects with a paid deposit and no appointment yet — a right-now
   * snapshot, NOT filtered by the date range, because it is a current
   * state rather than a historical event.
   */
  needsSchedulingCount: number;
  /**
   * Both of these are OMITTED ENTIRELY — not zeroed — without
   * `reports.viewFinancial`, which is false for ARTIST by default. That
   * distinction is the point: a client can tell "not allowed to see this"
   * apart from "no money moved", and must hide the section rather than
   * render a misleading $0.
   */
  depositConversion?: {
    sent: number;
    paid: number;
    conversionRate: number | null;
    avgHoursToPayment: number | null;
  };
  giftCardLiability?: { activeCardCount: number; totalCents: number };
}

/**
 * The range parameters. Both are bare `"YYYY-MM-DD"` calendar dates, and
 * the API resolves them against the STUDIO's configured timezone — not
 * the server's clock and not the caller's. A client must therefore send
 * date keys computed in the studio's zone too, or "last 30 days" means a
 * different 30 days than the studio thinks it does.
 */
export interface DashboardQuery {
  start?: string;
  end?: string;
}
