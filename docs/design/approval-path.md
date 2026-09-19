# Approval path (Phase 3 design)

Date: 2026-09-19. Status: **design for issue #84 — planned, not implemented.**

Read with: the [worker↔service seam](../specs/worker-service-seam.md) (§2 verb 2, the blocking approval path), the [data model](../specs/data-model.md) (`approvals` table, transaction rule 4 — tool/approval — and rule 6 — cancellation/restart), the [Rust service front](rust-service-front.md) (Phase 2: the contracts Phase 3 hangs off, especially §§8, 11, and the 501 decision endpoint in §2), the [control-core unification design](../research/control-core-unification.md) (§4 contract-map rows on the approval state machine, immediate revocation, and controller lease), the [unification decision](../decisions/2026-09-18-control-core-unification.md), and the [UI/UX contract](ui-ux-contract.md) (the Approvals surface and approval decision semantics).

Phase 2 made the Rust service the host's single writer and supervisor, with the approval endpoint deliberately stubbed (`501`) and the worker's `worker.approvals.request-decision` answered with an explicit rejection. Phase 3 is the first time anything in AgentMeld can actually approve anything. That is the highest-risk line to cross in the alpha, so this design keeps the semantics exactly where the locked decisions put them — in the service, in transactions, on server time — and leaves everything else for later phases.

## 1. What Phase 3 is

**In:**

- The `approvals` table migration (Phase 3 schema increment, §6), including whatever resolves the `superseded`-vs-`revoked` state question (§9).
- The decision endpoint `POST /api/v1/approvals/{id}/decision` with single-transaction consumption semantics (§3).
- The seam's blocking request-decision wiring: `worker.approvals.request-decision` → service creates the row → human decides via the API → `service.approval.decision` unblocks the worker's Codex `onRequest` callback (verb 2, §§3–4).
- The ChangedAction digest binding, recomputed service-side at propose, decision, and dispatch (§3).
- Server-time expiry: bounded TTLs at propose (1–300,000 ms, the M0 bound), expiry evaluated on the service clock, and a defined expiry-sweep policy (§3).
- Propose-while-pending rejection: the journal's structural guard as a protocol error (§4).
- Generation fencing on approvals: the decision transaction re-validates the run's lease generation; stale generations reject (§§3, 5).
- The controller lease: takeover → pausing → human → resume → resuming → observed → agent, including `PrivateBegin/End`, per the journal's sequence, now across runs and clients (§5).
- Revocation semantics: device revocation bumps the revocation version and terminally settles the device's pending approvals; "immediate" is honestly bounded as *on next contact* (§5).
- Fail-closed failure modes for every loss, timeout, and crash in the path (§7).
- The Approvals panel in the frozen UI populated from the new read surface, with the UI contract's states (§8).

**Out:**

- The SSE `/events` stream is Phase 4. Phase 3 rows are written to `run_events` (already done in Phase 2); approval decisions reach the browser by explicit reads, and cross-device arrival stays a Phase 4 problem. Nothing in Phase 3's schema or API makes Phase 4 harder, and nothing here depends on it.
- Artifact versions are a separate increment. Phase 3 does not consume or produce `artifact_versions` rows; a denied-then-revised tool path is recorded as a new proposal, not a version link.
- `tool_steps` stays uninstalled. Phase 3's audit trail is `run_events` + the `approvals` row; the queryable tool-step projection is a Phase 4 candidate.

## 2. The approval state machine

One row per proposal, host-owned, in the service's database — never in the worker, never in a client.

States: `pending` → `approved` | `denied` | `expired` | `revoked`. (`superseded` is the question in §9; until it is resolved the design uses `revoked` for both device revocation and superseding, with a `reason` column recording which.)

Transitions are issued exactly once, in one transaction, by the service only:

- **Propose** (worker seam): `worker.approvals.request-decision` arrives with `approval.action` (`tool`, `target`, bounded `arguments`), `description_user` (≤512 chars, user-safe, never secrets), `ttl_ms`. The service validates shape, recomputes the action digest (sha256 hex over UTF-8 JSON with lexicographically sorted keys and no insignificant whitespace — the seam spec's canonical form; the service does not trust any worker-sent digest), inserts the row in state `pending` with `expires_at = server_now + ttl_ms`, and records the `run_events` `approval.requested` event in the same transaction. The human then decides through §3; the worker blocks.
- **Decide**: `POST /api/v1/approvals/{id}/decision` with `{"decision": "approve"|"deny"}`. The single transaction re-reads the approval, the run, and the current grant/policy/lease versions; it requires state `pending`, `server_now < expires_at`, the recomputed action digest to match, grant/policy/lease versions current, and the run still in its approval-waiting state. On success it consumes the row (`approved` or `denied`) and issues the single-use execution ticket; on any mismatch it rejects with 409 and a machine-readable error code. An approval is consumable exactly once — the journal's single-unit consumption, now a real transaction.
- **Expire**: evaluated on the service clock. The sweep (policy in §3) moves `pending` rows with `server_now ≥ expires_at` to `expired` and records `approval.request_timed_out`; expiry returns the run to the agent's control path rather than hanging it, per the journal's `Propose` semantics. The worker's dead-man timer (seam §2 verb 2: TTL + 60s grace, then deny locally, append `approval.request_timed_out`, fail the turn) is the local backstop; the service's expiry is authoritative.
- **Revoke**: device revocation (or, pending §9, supersession) terminally settles all `pending` approvals for that device in the revocation transaction: state → `revoked`, `revoked_reason` recorded. A revoked approval can never become `approved` afterward — the decision transaction's `state = pending` precondition enforces it, and a late worker `request-decision` under a revoked device is rejected at the seam, not queued.
- **Consume**: `approved` → ticket issued once. The worker redeems the ticket at the seam reply (`service.approval.decision` carries `approved` + ticket); redemption is single-use. A second presentation of the same ticket is rejected. The schema draft's states include `consumed` (the data-model row); whether ticket redemption is a row state transition or an event on the approval row is an implementation detail the design leaves to the implementer, with one rule: an approval in any terminal state is unreusable by construction.

Terminal states (`approved`, `denied`, `expired`, `revoked`, and eventually `consumed`) never leave their state. There is no path from terminal back to `pending` — a changed action is a new proposal, per the UI contract's "changed payload requires new consent."

## 3. The decision-endpoint contract

`POST /api/v1/approvals/{id}/decision` — the endpoint Phase 2 stubbed with 501.

**Auth.** Device-session Bearer <redacted>, same as every Phase 2 endpoint. The service derives the deciding actor from the session (the locked "no trusted-owner at the client boundary" decision) and records `decided_by` as the principal. Worker tokens are not accepted on this listener — the blast-radius wall is two auth realms.

**Request.** `{"decision": "approve" | "deny"}`. Strict JSON rejection: unknown fields → 400 (`deny_unknown_fields` discipline). The client submits the approval ID and the decision; it never submits the action payload, the digest, or the expiry — the server resolves current authorization and payload from its own row, per the architecture contract.

**Response.** `200 {"approval_id": …, "state": "approved"|"denied", "ticket": "<opaque, single-use>"}` on approval with ticket issuance (deny carries no ticket). Errors use the existing envelope `{"error": "<user-safe string>"}` plus a machine-readable `code`:

- `400 invalid_decision` — malformed body.
- `401` — unauthenticated (re-authenticate), per Phase 2's 401/403 split.
- `403 wrong_scope` — the deciding device is not authorized for this workspace/host (never 404: existence is not leaked to the wrong party).
- `404` — unknown approval ID *to an authorized device*.
- `409 already_settled` — the row is in any terminal state; the response includes the terminal `state` so the client can render it. A second decision is never a double-consume: the first decision wins, the second is reported, not applied.
- `409 expired` — `server_now ≥ expires_at`; the row is transitioned to `expired` as part of returning this (lazy expiry is safe because the `pending` precondition is checked inside the same transaction).
- `409 digest_mismatch` — the action digest recomputed from the proposed action does not match the stored digest (`ChangedAction`, ported as an error code). The row is failed closed: it moves to `revoked` with reason `digest_mismatch` rather than staying `pending` — an approval whose action cannot be verified must not linger as decidable.
- `409 stale_lease` — the run's lease generation moved under the approval; the proposal is no longer attached to the live turn (`StaleLease`, ported as an error code).

**Idempotency.** The endpoint is not idempotent in the naive sense — a decision is a one-shot state change. But it is safe under retry: a retried `approve` after the first `approve` returns `409 already_settled` with `state: "approved"` (not a second ticket); a retried request after a crash-before-response is either `200` (first decision landed) or `409` (row already terminal). The client treats `409 already_settled` as "read the state," never as a failure to report.

**Expiry behavior.** Expiry is evaluated on the service clock inside the transaction. There is also a background sweep so rows do not sit `pending` forever: the design leaves the mechanism (timer vs. lazy-on-next-decision plus a startup sweep) to the implementer, with the invariant that any read of an approval — by endpoint, by the worker's pending wait, by restart recovery — first applies expiry. Expired rows move to `expired` with `approval.request_timed_out` recorded, exactly as the journal's recovery did for dropped pending approvals.

## 4. The seam message flow

The sequence for one approval, wire-exact per `worker-seam/1` (the Phase 3 proof's harness target):

```
worker → service: worker.approvals.request-decision
                    (protocol, msg_id, run_id, generation,
                     approval.{action{tool,target,arguments}, description_user, ttl_ms})
    service: validates shape → rejects propose-while-pending with
             service.error / propose_while_pending (the journal's structural guard)
    service: recomputes action digest, bounds ttl_ms (1–300000),
             INSERT approvals row (pending, server-time expires_at)
             + run_events approval.requested — one transaction
    worker: blocks its Codex onRequest callback (no timeout shorter than the service's)

human → service: POST /api/v1/approvals/{id}/decision {"decision":"approve"}
    service: single transaction — re-read row/run/grant/policy/lease;
             all checks §3 → state approved, issue single-use ticket
             + run_events approval.settled
service → worker: service.approval.decision
                    (protocol, in_reply_to=msg_id, approval_id,
                     decision="approved", ticket, expires_at, action_digest echo)
    worker: verifies the digest echo against its own recomputation;
            mismatch → treat as denied, fail the turn (ChangedAction at the seam)
    worker: answers the Codex onRequest callback with the ticket

denial path: same shape, decision="denied", no ticket;
             the Codex callback denies; the run continues or fails per the turn's logic —
             denial of one action is not cancellation of the run (UI contract §"Status and command semantics").

expiry path: service sweeps to expired; if the worker is still blocked it gets
             service.approval.decision decision="expired"; the worker's dead-man timer
             (TTL + 60s) covers total service loss — deny locally, append
             approval.request_timed_out, fail the turn closed.
```

The worker never decides. There is no decision verb on the seam — the blast-radius wall from the seam spec (§6) holds: a compromised worker can spam proposals (bounded by propose-while-pending and rate limits) but cannot approve, and the human always sees the service-computed, digest-bound action.

**ChangedAction digest.** Canonical form: UTF-8 JSON, object keys sorted lexicographically, no insignificant whitespace; digest = sha256 hex. Computed service-side at propose, stored on the row, recomputed at decision, echoed to the worker, verified by the worker. Any mismatch at any point fails closed — denied, turn failed, row terminal — never retried.

## 5. Controller lease

The contract map requires a `computer_leases` table plus lease endpoints, porting the journal's `Takeover → pausing → human → resume → resuming → observed → agent` sequence with `PrivateBegin/End`. Phase 3 installs the minimum that makes approval-adjacent human control honest; the full "Computer" browser surface (ui-ux-contract M1d row) is a client track that consumes it.

**Lease row.** One row per computer (host): `holder_device`, `generation`, `state`, `held_since`, `last_heartbeat`. Acquire and takeover both bump the generation in a transaction and record the event. Every browser-input command and every approval decision carries the generation it was issued under; a stale generation is rejected (`stale_lease`), never retried as-is.

**Takeover sequence.** `takeover` (new human holder claims; generation bumps; the service sends `service.turn.cancel` with `lease_takeover` and the worker winds down through `run.cancelled` — undispatched work is revoked first, as the journal's `Takeover → pausing` did) → `pausing` → `human` (the human acts directly; `PrivateBegin/End` suspends observation recording for credential entry, fencing the generation on both sides) → `resume` (generation bumps again) → `resuming` → `observed` (the worker re-observes and appends `run.resumed` with a fresh digest, required before the service treats the turn as live — `service.lease.command` `resume` with `observation_required: true`) → `agent`. The worker never initiates lease commands; it only obeys `service.lease.command` `pause`/`resume`.

**Interaction with approvals.** An approval proposed under generation N is undecidable under generation N+1 (`stale_lease` in §3) — a takeover revokes the undecided surface, matching the journal's rule that generation bumps invalidate outstanding holders. Pending approvals at takeover are transitioned to `revoked` with reason `lease_takeover` in the takeover transaction, so no human can approve a proposal that predates their control.

## 6. Revocation semantics

Device revocation is the one revocation primitive Phase 3 installs (the M2 P8 device tables arrive in Phase 2's bootstrap-minimum form; Phase 3 uses them).

- Revocation bumps the device's `revocation_version` in one transaction and terminally settles (`revoked`) that device's `pending` approvals in the same transaction. No pending approval survives the revocation of the device that proposed — or that was about to decide — it.
- Every request path re-validates the session's revocation version against the cached revocation list (invalidated on change): revoked → 401 and the re-pair flow. "Immediate" is honestly bounded as *on next contact* — the contract map's bound, inherited from Phase 2 §11.
- Revocation is per-device, not per-approval: the row-level `revoked` state records *why* (`revoked_reason`: `device_revoked`, `lease_takeover`, `digest_mismatch`, or — pending §9 — `superseded`).
- A revoked approval is terminal and unreusable. Re-proposal after revocation is a new row with a new ID — the client never reuses IDs, and the UI contract's "bind the decision to the immutable proposed revision" holds across the boundary.

## 7. Fail-closed failure modes

Every loss in the approval path fails closed — the PoC's never-approved-anything behavior becomes a designed property instead of an accident:

- **Service restarts with a `pending` approval:** startup recovery applies the journal's open-time rule — the generation bumps, the in-flight run goes to `interrupted`/`reconciling`, and the pending approval is swept to `expired` (or `revoked` with reason `service_restart` if the device is gone). A restarted service never resumes a turn mid-approval as if nothing happened.
- **Worker dies while blocked on a decision:** the socket close is independently observed; the run goes to `interrupted`, the approval row stays `pending` until the human decides or expiry sweeps it — the decision is the human's, not the worker's, so worker death does not auto-deny. (This is deliberate: auto-deny on worker death would let a crashed worker silently kill a legitimate human decision in flight.)
- **Human's device disconnects mid-decision:** the decision either committed (durable) or it didn't (row still `pending`). There is no half-decision; the retry rule in §3 covers the ambiguity.
- **Unknown dispatch result:** the data-model's rule 4 holds — a failed connection cannot authorize retry of a completed action. Ticket redemption is exactly-once; if the worker cannot prove redemption, the turn reconciles, never blind-retries.
- **Clock skew:** expiry uses only the service clock. Clients display `expires_at` converted locally but never evaluate it; a client that thinks an approval is live while the server expired it gets `409 expired` with the terminal state.

## 8. UI contract

The frozen PoC UI keeps its shape; Phase 3 fills the Approvals panel that currently says "not connected yet" (`apps/poc/public/index.html`, the `approvalsPanel` tab).

States, per the ui-ux-contract M1d row: **pending, submitting decision, denied, expired, revoked, consumed** — plus the action receipt: the human sees the acting account/host, the exact destination, and the complete effect/payload (the service-computed `description_user` plus the digest-bound action detail), before deciding. Approval previews are read-only; opening a preview URL cannot consume a decision (deep-link rule).

Decision semantics, also from the UI contract: deny rejects the specific proposed action — it is not workflow cancellation. The run may finish with a limitation or continue along another permitted path. Approval completion never implies tool execution or external success. Disabled buttons during submission are UX feedback, not duplicate-action protection — the server's single-transaction consumption is the real guard. And the offline rule holds: never silently queue a consequential approval decision for later replay; Stop/approval cannot claim success without host readback.

## 9. Migration SQL sketch

Phase 3 installs `approvals` (adapted from the core-schema draft, not invented) and the lease table the contract map requires. This is a sketch for review, not final DDL:

```sql
-- Migration: phase3-approvals
CREATE TABLE approvals (
  workspace_id TEXT NOT NULL, run_id TEXT NOT NULL, id TEXT NOT NULL,
  action_digest TEXT NOT NULL CHECK(action_digest GLOB '[0-9a-f]*' AND length(action_digest) = 64),
  action_json TEXT NOT NULL CHECK(json_valid(action_json)),
  target_json TEXT NOT NULL CHECK(json_valid(target_json)),
  description_user TEXT NOT NULL CHECK(length(description_user) <= 512),
  ticket_hash TEXT,  -- sha256 of the issued single-use ticket; NULL until approved
  policy_revision INTEGER NOT NULL, grant_revision INTEGER NOT NULL,
  lease_generation INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','approved','denied','expired','revoked')),
  revoked_reason TEXT CHECK(revoked_reason IN ('device_revoked','lease_takeover','digest_mismatch','service_restart','superseded')),
  expires_at INTEGER NOT NULL, decided_by TEXT REFERENCES principals(id), decided_at INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(workspace_id,id),
  FOREIGN KEY(workspace_id,run_id) REFERENCES runs(workspace_id,id)
);
CREATE INDEX approvals_pending ON approvals(workspace_id, run_id, state, expires_at)
  WHERE state = 'pending';

CREATE TABLE computer_leases (
  workspace_id TEXT NOT NULL, host_id TEXT NOT NULL,
  holder_device_id TEXT REFERENCES devices(id),
  generation INTEGER NOT NULL DEFAULT 0 CHECK(generation >= 0),
  state TEXT NOT NULL CHECK(state IN ('agent','pausing','human','resuming','observed','paused')),
  held_since INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY(workspace_id, host_id)
);
```

Notes on the sketch vs. the draft schema: the draft's `approvals` has no `action_json` (this design stores the canonical proposed action so `decide` can recompute the digest rather than trusting a second copy), no `ticket_hash` (the contract map's single-use ticket needs a stored verifier), and no `revoked_reason`. Whether these columns belong or the implementer models them differently is a review point, not a mandate — the invariants (§2–§3) are the mandate.

## 10. Proof plan

Two legs. The first runs on this Linux VM with no Docker, no Codex, no paid models, and no real user data; the second is explicitly someone else's gate.

**(a) Deterministic harness on this VM.** A fixture harness drives the *real* `agentmeld-server` binary (temp state dir, loopback) through the full approval path with a scripted fake worker that speaks `worker-seam/1` over the Unix socket — the same technique as Phase 2's live smoke test, extended to the approval verbs:

1. Fake worker proposes via `worker.approvals.request-decision`; assert the `approvals` row is `pending`, digest recomputed service-side, `expires_at` on the server clock, `run_events` carries `approval.requested`.
2. Human decides `approve` via `POST /api/v1/approvals/{id}/decision`; assert the single transaction consumed exactly once, the ticket issued, `service.approval.decision` carries `approved` + ticket + digest echo, and the fake worker's echo verification passes.
3. Second `POST` with the same body → `409 already_settled`, no second ticket. Decision after TTL expiry → `409 expired` with the row swept to `expired`. Tampered action at decide time → `409 digest_mismatch`, row `revoked`. Decision under a bumped lease generation → `409 stale_lease`.
4. Propose-while-pending: second `request-decision` before the first settles → `service.error / propose_while_pending`.
5. Revocation: revoke the device mid-pending → 401 on next request, row `revoked` with `device_revoked`, in the same transaction as the revocation bump.
6. Takeover: issue a lease takeover while an approval is pending → row `revoked` with `lease_takeover`, worker receives `service.turn.cancel` (`lease_takeover`), generation bumped.
7. Restart recovery: SIGKILL the service with a `pending` approval and a blocked fake worker; on restart assert generation bumped, run `interrupted`, approval swept (expired/revoked), and no half-decision.
8. Exactly-once ticket redemption: present the ticket twice; second presentation rejected. Kill the connection after approval but before redemption; assert the turn reconciles rather than blind-retries.

All assertions run against the real binary and the real SQLite file; the fake worker is disposable fixture code in the harness, never shipped. Nothing in this leg touches a model, a container, or user data.

**(b) Real Codex callback proof (Apple-side owned).** The harness proves the service semantics; it cannot prove the worker's `onRequest` callback actually hangs off a live Codex turn — the VM has no Docker and no Codex, and the alpha's real-device work belongs to the Apple side per the standing division of labor. That proof is: on a real Mac host, drive a Codex turn that triggers an approval callback, confirm the worker blocks on `worker.approvals.request-decision`, the human decides in the UI, `service.approval.decision` unblocks the callback, and the tool executes exactly once. Until that runs, Phase 3 is *semantically complete, callback-unproven* — and this document says so plainly.

## 11. What could go wrong

- **The `superseded` question (§9) leaks into every client.** If the state set isn't settled before implementation, the UI renders a state the server never emits, or the server emits a state the UI can't render. Settle it in review, not in code.
- **Ticket transport.** The ticket travels service → worker over the Unix socket and human → service over HTTPS, but the approval decision the *browser* submits must not become a bearer credential for execution — the ticket is issued to the worker's seam reply, never to the client response, and the client response carries only the receipt. Keep that separation in the implementation or the ticket becomes a confused-deputy token.
- **Expiry sweep starvation.** If the sweep is lazy-only and nobody reads a stale `pending` row, rows linger `pending` past their TTL with the run blocked. The startup sweep plus the read-path expiry application (§3) close this, but the implementer must prove both exist — a `pending` row older than its TTL with a live server is a bug.
- **Lease UI before the client track.** Phase 3 defines lease semantics, but the frozen PoC has no "Computer" surface to trigger takeover. If no client can take over, the lease code is dead code that only the harness exercises — honest, but the design should say so rather than imply a UI exists.
- **Revocation vs. the pairing bootstrap.** Phase 2's bootstrap disables re-enrollment after the first device; the resolved re-pairing policy is explicit on-host CLI action (rust-service-front §13 Q1, resolved in the Phase 2 implementation — the `pair` CLI command). Phase 3's revocation can therefore strand the owner with zero devices, recoverable only via on-host CLI access. The design treats that as the honest lockout story and says so, rather than softening revocation.

## 12. Open questions for the owner

1. **State naming: `superseded` vs `revoked`.** The contract map says `pending → approved | denied | expired | superseded`; the core-schema draft's CHECK lists `revoked` (no `superseded`); the UI contract's Approvals row lists `revoked` (no `superseded`). Is revocation-of-device (and lease-takeover, digest-mismatch) the *same* terminal state as supersession, distinguished by `revoked_reason` — or is `superseded` its own state for "replaced by a newer proposal"? This design sketches `revoked` + reason; confirm or correct.
2. **Ticket storage shape.** The contract map requires a single-use execution ticket, but the schema draft has no ticket column. This design sketches `ticket_hash` on the row. Acceptable, or should the ticket be an event/metadata rather than a column?
3. **`tool_steps` timing.** Phase 3 leaves `tool_steps` uninstalled, with audit via `run_events` + `approvals`. Is the queryable tool-step projection a Phase 4 co-install with SSE, or does some alpha workflow need it earlier?
4. **Lease UI in Phase 3.** The design defines the lease sequence and endpoints but the frozen PoC has no Computer/takeover surface. Does Phase 3 ship a minimal takeover control in the frozen UI, or does the lease stay harness-only until the client track builds the surface?
5. **Re-pairing after self-revocation.** If the owner revokes their only device, Phase 2's disabled re-enrollment means the only way back in is the explicit on-host CLI re-pair (the resolved rust-service-front §13 Q1 policy). Confirm this lockout story is acceptable: revocation of the last device is recoverable only with host access, never remotely.

## 13. What was verified and what was not

**Verified by reading (2026-09-19):** the worker↔service seam spec in full (verb 2's blocking semantics, the digest-echo rule, propose-while-pending, the dead-man timer, the exact `service.error` code list), the data model's `approvals` row and transaction rules 4 and 6, the Phase 2 design's Phase 3 handoffs (the 501 decision endpoint, the schema slice boundary, the static-asset allowlist the UI work depends on, the §11 approval-shaped holes, the §8 durable.rs discipline list), the contract-map rows for approval/revocation/lease, the unification decision's locked list, the UI/UX contract's Approvals and Computer surface rows and decision semantics, and the frozen PoC UI (`index.html`'s Approvals tab copy, the supervisor's explicit approval-path rejection, the `onRequest`-less `LiveClient` construction).

**Not verified:** nothing here is implemented — no `approvals` table exists, no decision endpoint answers, no fake-worker harness has run, and the real Codex callback proof is explicitly out of reach on this VM (no Docker, no Codex). The migration SQL is a sketch for review, not DDL that has been applied. The issue #84 scope ("approval semantics, controller lease, revocation") matches the issue as filed.
