# Progress 2026-09-19 — Phase 3 approval path implemented (issue #86)

Phase 3 (approval semantics, controller lease, revocation) is implemented in
the Rust service on branch `impl/2026-09-19-phase3-approval-path`, per
`docs/design/approval-path.md`. The decision endpoint Phase 2 stubbed with
501 now answers; the worker's `worker.approvals.request-decision` flows
through propose → human decision → `service.approval.decision`; the
controller lease runs its full takeover cycle; device revocation settles the
undecided surface.

## What was built

- **Migration v4** (`crates/agentmeld-server/src/migrations/v4.sql`):
  `approvals` (canonical action digest, `ticket_hash`, state machine
  `pending → approved | denied | expired | revoked`, revocation reasons,
  consumption timestamp, grant/lease generation fences) and
  `computer_leases` + `lease_events` (holder, monotonic generation, state,
  heartbeat, append-only transition audit).
- **New module** `src/approvals.rs`: canonical action digest (sha256 over
  sorted-key UTF-8 JSON), proposal validation (1–300,000 ms TTL), the
  `PendingApprovals` waiter registry, error codes, and the 1-second
  expiry/lease sweep.
- **Decision endpoint** `POST /api/v1/approvals/{id}/decision` with
  single-transaction consumption: lazy expiry, ChangedAction digest
  re-verification (mismatch → revoke, never decide), lease-generation and
  grant-revision fencing. The HTTP receipt carries state only — the raw
  execution ticket travels exclusively service → worker in
  `service.approval.decision`.
- **Lease endpoints**: takeover (with `pausing` state and explicit
  `/lease/takeover/ack`), private begin/end, resume, heartbeat, revoke —
  every holder mutation fenced on expected generation.
- **Device revocation** settles pending approvals in the same transaction
  and bumps the workspace grant revision; startup recovery terminally
  settles every pending approval (expired past deadline, revoked otherwise)
  and fences the lease generation.

## Bugs found and fixed during the work

1. `record_lease_event_locked` wrote to a `lease_events` table no migration
   created — added to v4.
2. The propose path checked run-state before the pending guard, so a second
   proposal surfaced as `run_not_active` instead of the design's
   `propose_while_pending` — reordered so the structural guard wins.
3. Startup recovery left fresh pending approvals pending-but-undecidable
   under the fenced lease generation — now revoked (`service_restart`)
   with their runs failed closed.
4. `main.rs` destructured the recovery tuple with swapped labels.
5. Waiter registration race: the supervisor committed the proposal before
   registering `PendingApprovals`, so an HTTP decision landing in the
   window dropped the outcome — including the unrecoverable raw ticket —
   and wedged the turn. Fixed structurally: the supervisor now mints the
   approval id and registers the waiter *before* the row is published
   (`Db::propose_approval` takes the id; new
   `PendingApprovals::wait_registered`), making publication and waiter
   readiness atomic by construction.

## Verification

`tests/approval_path.rs`: 14 deterministic tests (injected server clock, no
sleeps) covering propose/approve/deny/duplicate-decision, expiry, digest
mismatch, stale lease, propose-while-pending, device revocation, the full
takeover cycle, heartbeat fencing/auto-release, restart recovery,
exactly-once ticket redemption (double-present, wrong ticket, cross-run
ticket all rejected), and the register-before-propose waiter ordering. Full suite green: `cargo fmt --check`,
`cargo clippy --locked --workspace --all-targets -- -D warnings`,
`cargo test --locked --workspace` (47 tests), `cargo build --locked
--workspace`, `scripts/check-docs.py`, `scripts/check-local.sh`.

## Status

**Semantically complete, callback-unproven.** The service semantics are
proven; the worker's live Codex `onRequest` callback blocking on
`worker.approvals.request-decision` cannot be proven on this VM (no
Docker/Codex) and is the Apple-side gate.
