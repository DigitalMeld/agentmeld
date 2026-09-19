# User-initiated approval revocation (issue #105)

**Date:** 2026-09-19 UTC · **Branch:** `impl/2026-09-19-approval-revoke`

Approval history was visible but revocation was automatic-only (digest
mismatch, takeover, device revoke, restart). Users can now pull back a
granted approval.

## Server

- **New endpoint** `POST /api/v1/approvals/{id}/revoke` (device-authed,
  strict empty body — unknown fields rejected).
- `approved` → `revoked` (reason `user_revoked`). Enforcement is real,
  not cosmetic: `claim_ticket_locked` only honors `state='approved'` rows,
  so the worker's execution ticket dies with the grant. A dispatch after
  revocation fails `ticket_not_approved`.
- If the ticket was already consumed, the revocation is a recorded "I take
  it back" — the receipt reports `already_dispatched: true` and the UI says
  the action may have already run.
- `pending` → `revoked`; the API layer resolves the blocked worker's waiter
  with `ApprovalOutcome::Revoked` so the turn winds down instead of hanging
  (same contract as takeover revocation).
- Terminal states → 409 `already_settled`; unknown id → 404
  `unknown_approval`; a passed deadline expires first (lazy expiry, like
  decisions).
- Journals `approval.revoked` (SSE + history observe it) and records a
  `cancelled` tool step when the action can no longer run.
- **Deliberately not fenced on lease_generation:** revocation is
  retrospective, not turn-gated.
- **Migration v6:** `'user_revoked'` joins the `revoked_reason` CHECK enum
  (table rebuild — SQLite can't ALTER a CHECK). The reason column stays a
  closed enum; the actor is journalled in the event payload (`by`), so the
  endpoint takes no reason parameter.

## UI

- Granted approvals in the history panel get a **Revoke** button.
- Two-step: first click arms ("Confirm revoke", red) for six seconds,
  second click fires — the same pattern as the lease takeover control.
- Success notice: "Approval revoked." vs "Approval revoked. The action may
  have already run." History re-renders on the existing poll.

## Verification

- 4 new Rust tests in `tests/approval_path.rs` (18/18 in the file):
  pending revoke settles + journals; approved revoke kills the ticket
  (dispatch fails `ticket_not_approved`); post-dispatch revoke reports
  honestly; terminal/unknown fail cleanly.
- E2E extended: approve via the bar, open the Approvals tab, arm, confirm,
  assert the notice + `Revoked` history state — **26/26 green**.
- Headless-Firefox screenshots of the history Revoke button and the armed
  "Confirm revoke" state inspected at 1440×900.
- `sh scripts/check-local.sh` green (incl. `cargo fmt --check`).

## Honest notes

- Revoking a pending approval from the history UI is not offered (Deny
  covers it in the prompt bar); the endpoint accepts it for API
  completeness and waiter hygiene.
- A revoked-then-dispatched worker gets `ticket_not_approved` and fails
  the turn closed — the supervisor maps the seam code, same as a ticket
  mismatch.
