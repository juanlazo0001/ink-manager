// The Progress stepper shows the same model web shows, for the same record.
//
// ─── THE DEFECT THIS PINS ───────────────────────────────────────────
//
// Web switches models: an INQUIRY gets the intake lifecycle, a converted
// PROJECT (SCHEDULING / WAITLISTED / CONFIRMED) gets the five-stage
// project timeline. Mobile showed the intake lifecycle unconditionally,
// so for every scheduled or confirmed project the two clients described
// the same record differently — mobile still saying "Deposit requested"
// while web tracked waiver, session and project completion.
//
// Session BH's parity run measured it: none of web's five project stage
// labels appeared anywhere on mobile.
//
// ─── HOW IT FAILS ───────────────────────────────────────────────────
//
// Both models are asserted, against the same function. Under the old
// implementation every PROJECT case below returns the intake labels and
// goes red; a fix that returned project stages for EVERYTHING would go
// red on the inquiry cases instead. Neither half passes alone.

import { test } from "node:test";
import assert from "node:assert/strict";

import { pipelineStages } from "./staffInquiry";
import type { StaffInquiryDetail } from "./staffInquiry";

function inquiry(over: Partial<StaffInquiryDetail> = {}): StaffInquiryDetail {
  return {
    status: "NEW",
    assignedArtistId: null,
    estimateSentAt: null,
    appointmentId: null,
    depositForms: [],
    ...over,
  } as unknown as StaffInquiryDetail;
}

const labels = (inq: StaffInquiryDetail) => pipelineStages(inq).map((s) => s.label);
const PROJECT = ["Needs Scheduling", "Scheduled", "Waiver Verified", "Session Complete", "Project Complete"];
const INTAKE = ["Inquiry received", "Artist assigned", "Estimate sent", "Deposit requested", "Scheduled"];

test("an un-converted inquiry keeps the intake lifecycle", () => {
  for (const status of ["NEW", "ARTIST_ASSIGNED", "AWAITING_CLIENT_RESPONSE", "DEPOSIT_PENDING"] as const) {
    assert.deepEqual(labels(inquiry({ status })), INTAKE, status);
  }
});

test("a converted project gets web's five project stages", () => {
  // DEPOSIT_PENDING is deliberately absent above and here: web's own
  // comment says it is still the Inquiries tab, not Projects.
  for (const status of ["SCHEDULING", "WAITLISTED", "CONFIRMED"] as const) {
    assert.deepEqual(labels(inquiry({ status })), PROJECT, status);
  }
});

test("stage derivation matches web's, milestone by milestone", () => {
  const at = (over: Partial<StaffInquiryDetail>) => {
    const stages = pipelineStages(inquiry({ status: "SCHEDULING", ...over }));
    return stages.filter((s) => s.done).length - 1; // index of last done
  };

  // Nothing booked at all.
  assert.equal(at({}), 0, "needs scheduling");
  /*
   * Booked via the older 1:1 link with NO sessions row lands on SESSION
   * COMPLETE (3), not Scheduled — because web's derivation, ported
   * verbatim, falls through to `if (!current) return 'SESSION_COMPLETE'`
   * when the sessions array is empty.
   *
   * That reads wrong, and it is asserted anyway: this session's job is
   * parity, and encoding a "better" answer here would put the two
   * clients back out of step while looking like a fix. Flagged in the
   * report as an inherited web behaviour worth its own look — the record
   * shape that reaches it is a project booked before the 1:many sessions
   * model existed.
   */
  assert.equal(at({ appointmentId: "a1" }), 3, "appointment with no sessions — web's own answer");
  // Booked via the newer 1:many link.
  assert.equal(at({ sessions: [{ id: "s1", checkedOutAt: null }] }), 1, "scheduled via session");
  // Waiver verified on the session being worked toward.
  assert.equal(
    at({ sessions: [{ id: "s1", checkedOutAt: null, liabilityWaiver: { status: "VERIFIED" } }] }),
    2,
    "waiver verified",
  );
  // Every session checked out.
  assert.equal(at({ sessions: [{ id: "s1", checkedOutAt: "2026-09-01T00:00:00Z" }] }), 3, "session complete");
  // Explicitly completed wins over everything.
  assert.equal(at({ projectCompletedAt: "2026-09-01T00:00:00Z", sessions: [] }), 4, "project complete");
});

test("the current stage is the next goal, not the last milestone", () => {
  // Web bolds what is being worked toward. At NEEDS_SCHEDULING that is
  // "Scheduled"; at the end nothing is, because there is no next.
  const early = pipelineStages(inquiry({ status: "SCHEDULING" }));
  assert.equal(early.find((s) => s.current)?.label, "Scheduled");

  const finished = pipelineStages(
    inquiry({ status: "CONFIRMED", projectCompletedAt: "2026-09-01T00:00:00Z" }),
  );
  assert.equal(finished.every((s) => s.done), true);
  assert.equal(finished.some((s) => s.current), false, "a finished project has no next goal");
});
