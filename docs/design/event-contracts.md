# Event contracts (Phase 4 design)

Date: 2026-09-19. Status: **design for issue #88 — planned, not implemented.**

Read with: the [Phase 3 approval-path design](approval-path.md) (the approval/lease/revocation semantics this stream must carry; note its §10 proof-plan style and §12 resolved-questions pattern), the [Phase 2 Rust-service-front design](rust-service-front.md) (the crate layout; `/events` is the intentional 501 stub this phase replaces), the [worker↔service seam](../specs/worker-service-seam.md) (§1 verb 1 — the append path and its 18 event types; §4 version negotiation; the v1 [versioning policy](../specs/schemas/worker-seam/v1/README.md)), the [data model](../specs/data-model.md) and its [core schema draft](../specs/data/core-schema.sql) (`tool_steps`, `run_events`), the [control-core unification design](../research/control-core-unification.md) (§3 the event envelope, §4 the contract-map rows on cursors/replay/at-least-once), the [architecture](../specs/architecture.md) (§8 the envelope and delivery rules), the [iOS background/push design](../research/ios-background-push.md) (Recommendations 3–4: the reconnect contract this stream must satisfy), and the [UI/UX contract](ui-ux-contract.md) (Activity/step detail is `Runs/events/tool-step projection`; "Do not load hidden control traffic into user search or Activity").

Phases 2 and 3 built the journal but no way to watch it live: `run_events` accumulates every fact, `approvals` and `computer_leases`/`lease_events` hold the control plane, and the browser learns about any of it only by polling REST endpoints. Phase 4 opens the read side — the SSE stream — and installs the queryable `tool_steps` projection the UI contract's Activity surface needs. It changes no control semantics: approvals, leases, and revocation work exactly as Phase 3 built them. What changes is that clients can finally observe them as they happen.

## 1. What Phase 4 is

**In:**

- The SSE stream `GET /api/v1/events`: the envelope (§2), cursor and `Last-Event-ID` reconnect semantics, heartbeat, bounded replay, backpressure, auth, and restart behavior.
- The event taxonomy: exactly which journal rows become stream events, the closed exclusion list, approval-lifecycle and lease events, and the two new `worker-seam/2` tool event types (§3).
- The `tool_steps` table (migration v5, adapted from the core-schema draft), the worker→seam→service write path, and the coexistence invariants with the approvals audit trail (§4).
- The client-observable ordering and idempotency guarantees (§5).
- The security rules for the stream: no secret material, per-device scoping (§6).
- A deterministic proof plan for the implementation (§7).

**Out:**

- The frozen PoC UI gets no new surface. Phase 4 is server + contract only; the client track consumes the stream and the `tool_steps` projection later. (The UI contract's Activity/step-detail row is M1c and stays assigned there.)
- Artifact version history remains a separate increment. `tool_steps.output_blob_id` references blobs that already exist; versioning is untouched.
- The notification-intent outbox (`delivery_outbox`) is **not** installed in Phase 4. The SSE stream is the live path; durable push intents (APNs wake hints per the iOS design's Recommendation 1) are consumed from the journal by a future outbox increment. This supersedes the unification design's Phase 4 "push-ready" phrasing for scoping purposes — see open question §10.2.
- No new seam verbs. The two tool event types ride the existing `worker.events.append` verb under a protocol version bump (§4); the four-verb shape is unchanged.

## 2. The SSE stream contract

`GET /api/v1/events` replaces the 501 `future_stub` (the unversioned `/api/events` mount comes free per the Phase 2 router convention). It is a standard SSE stream: `Content-Type: text/event-stream`, `Cache-Control: no-store`, no buffering.

**Auth.** Device-session Bearer <redacted>, via the existing `Authed` extractor — the same realm as every Phase 2/3 endpoint. The worker's boot credential is not accepted here (the two-realms wall holds). A revoked device gets 401 at connect; mid-stream, the handler re-validates the session's revocation version on every heartbeat tick (§2, heartbeat) and closes the stream on revocation — the client reconnects, gets 401, and follows the re-pair flow. There is no unauthenticated stream, not even for "public" events.

**Envelope.** Every data frame is one JSON object:

```json
{
  "v": 1,
  "id": "<run_id>:<event_id>",
  "seq": 12345,
  "type": "run.completed",
  "workspace_id": "default",
  "conversation_id": "<uuid>",
  "run_id": "<uuid>",
  "ts": 1726712345678,
  "actor": "worker | device:<device_id> | service",
  "payload": { }
}
```

Field rules, no exceptions:

- `v` — the row's event-schema version (the `run_events.version` column; 1 today). A client that sees a `v` it does not understand must still advance its cursor past the event (dedupe by `id`, render nothing) — never stall the stream on an unknown version.
- `id` — the row's stable `run_events.id` (`{run_id}:{event_id}`). This is the client dedupe key: at-least-once delivery means the same `id` may arrive twice; the second arrival is dropped, never rendered twice.
- `seq` — the row's `run_events.sequence`: host-local, gapless-per-commit, strictly increasing. This is the cursor. Ordering across runs is sequence order — display order, not proof of causality (the UI contract's rule).
- `ts` — `created_at`, the service clock, milliseconds. Clients display it converted locally and never evaluate it (the Phase 3 clock-skew rule generalizes).
- `actor` — who caused the fact: `worker` for worker-appended events, `device:<device_id>` for human/service-on-behalf-of-device actions (admission, approval decisions, lease commands), `service` for autonomous service actions (expiry sweeps, restart recovery). Stored in a new nullable `run_events.actor` column (migration v5); rows written before v5 carry no actor and the envelope omits the field rather than inventing one.
- `payload` — the row's `payload_json`, verbatim. Bounded at write time by the existing per-type limits (4 KiB answer-delta batches, 512-char `description_user`, and the new tool-step bounds in §4). The stream never re-shapes payloads: what the journal holds is what the client gets, minus the §3 exclusions.

**Cursor and reconnection.** Two mechanisms, one meaning:

- `GET /api/v1/events?cursor=<seq>` — replay every streamed row with `sequence > <cursor>`, then go live. This is the contract-map row (`WHERE seq > ? ORDER BY seq LIMIT ?`) and the iOS Recommendation 3 contract.
- The `Last-Event-ID` request header — the EventSource native reconnect path. The server uses its value as the cursor. If both are present, `Last-Event-ID` wins (it is the fresher signal: the browser maintains it automatically).
- Omitted cursor: replay the **last 200** streamable rows, then go live. Rationale: a fresh client (no persisted cursor) wants recent context for the Activity surface, not an empty screen and not the whole journal. 200 is a bound, not a promise — fewer rows simply replay fewer.
- The server sends `retry: 3000` on connect (the SSE-standard reconnect delay).

**Bounded replay and the too-old cursor.** Replay is bounded: each catch-up batch is `ORDER BY sequence ASC LIMIT 1000`, and a client is "too old" when `max_seq - cursor > 5000`. A too-old cursor at connect time gets **410** with the JSON error envelope `{"error": "<user-safe>", "code": "cursor_too_old", "current_seq": N}` — not an event stream. The client then refetches authoritative state (`GET /api/v1/state`, run history) and resubscribes with the fresh cursor. The bound exists so a client that slept for a month does not ask the server to re-materialize a month of journal; the refetch path is the honest alternative, and the iOS design already specifies it ("On a replay gap fetch an authorized snapshot").

**Heartbeat.** The server emits an SSE comment (`:ping`) every 15 seconds on an otherwise idle stream. The client treats a stall longer than 45 seconds (no data frame, no comment) as a dead connection and reconnects with its persisted cursor. The 15s tick is also the revocation re-validation point.

**Backpressure.** Each connection gets a bounded outbound queue (256 frames). If the producer outruns a slow consumer and the queue fills, the server sends one control frame — `event: control` with `{"type": "stream.resync_required", "current_seq": N}` — and closes the stream. The client refetches state and resubscribes from its persisted cursor; at-least-once is preserved because the journal still holds everything and the client dedupes by `id`. The server never drops events silently and never grows an unbounded per-connection buffer: lagging out is explicit and recoverable, not a slow memory leak.

**Control frames.** `event: control` frames are not journal rows: they carry no `id`, and the client must not advance its cursor or dedupe on them. Two types exist: `stream.hello` (sent first on every connect: `{"type":"stream.hello","current_seq":N,"server_time_ms":T}` — lets the client calibrate "how far behind am I" before the first data frame) and `stream.resync_required` (above).

**Restart behavior.** The journal is the replay buffer — there is no in-memory buffer to lose. A restart kills live connections at the TCP level; clients reconnect with their persisted cursors and replay from `run_events`. Cursor continuity across restarts is a direct consequence of the sequence living in SQLite, not in process memory. (This is the unification design's "Restart needs no replay for state, only cursor-buffer continuity for the event stream," with the buffer identified: the table.)

**Delivery semantics.** At-least-once, always. The client contract, in order: (1) persist the cursor to durable storage on every data frame (iOS Rec 3 — kill-and-relaunch resumes from the true position); (2) dedupe by `id`; (3) apply idempotently — re-applying an event must not duplicate a message, a tool call, or a run. Retrying an entire run must not replay its completed writes (the architecture §8 rule, unchanged).

## 3. Event taxonomy

The stream serves **run_events rows only** — one sequence space, one cursor, no cross-table merge ordering. Which rows stream is a closed rule:

**Streamed:** every `run_events` row with `visibility = 'user'` **except** the exclusion list below.

**Excluded (never on the stream, even though journalled):**

| Kind | Why |
|---|---|
| `approval.dispatched` | Its payload carries the single-use execution ticket in plaintext (db.rs journals the worker's claim). The Phase 3 decision stands: the ticket travels service→worker over the seam only, never the browser stream. The client learns the decision from `approval.settled` and the REST receipt. |
| `provider_session.bound` | Its payload carries the native provider binding including the thread reference. The seam spec marks it "never a client-visible field" — but `apply_worker_events` stores it with `visibility = 'user'` today (discrepancy D1, §9). The kind-exclusion is the enforcement; the implementation should also correct the stored visibility to `'diagnostic'` going forward. |

The exclusion is by kind, not by visibility alone, because the visibility column's current assignment does not match the seam spec's intent. Both filters apply (`visibility = 'user'` AND kind not excluded): defense in depth for future kinds.

**The full taxonomy** (kind → source → stream → notes):

*Worker-appended, v1 (streamed unless excluded):* `run.started`, `run.restored`, `run.thinking` (milestone marker; the worker emits an empty payload today — no chain-of-thought content exists to leak), `run.answer_delta` (4 KiB bounded batches), `run.activity_changed`, `run.saving`, `run.artifacts_delivered`, `run.completed`, `run.failed` (`error_user` only — the no-raw-provider-errors rule), `run.cancelled`, `run.interrupted`, `run.terminated` (teardown evidence), `run.resumed` (fresh observation digest).

*Worker-appended, v2 (new in Phase 4, §4):* `tool.call_started`, `tool.call_finished`.

*Service-written (streamed):* `run.queued` (admission), `run.cancelled` / `run.interrupted` (stop, worker loss, restart recovery), `approval.requested`, `approval.settled`, `approval.request_timed_out`, `approval.revoked` (all terminal settlements, with `revoked_reason`), `lease.<kind>` for run-affecting lease transitions (new Phase 4 writes, below).

*Excluded:* `approval.dispatched`, `provider_session.bound` (above).

**Lease events on the stream.** `lease_events` is the lease audit trail (no sequence column, host-scoped rows); it does not stream directly. Instead, every lease transition that affects a run also journals a `lease.<kind>` row into `run_events` against that run, in the same lease transaction: `lease.takeover` and `lease.takeover_ack` (the cancelled run), `lease.private_begin` / `lease.private_end` (the paused run, if any), `lease.resume`, `lease.observed`, `lease.resumed` (the resumed run), `lease.released` / `lease.auto_released` (the attached run, if any). Payload: `{generation, device_id, reason}`. A transition with no affected run (e.g., takeover of an idle host) journals no stream row — the audit trail and `GET /api/v1/lease` remain the source of truth for it. Whether idle-host transitions should also appear on the stream (with `run_id: null`) is open question §10.3.

**`tool_steps` and the stream.** Tool events stream like any other journal rows (they are `run_events` rows first — §4 writes both atomically). The `tool_steps` table itself is not streamed; it is the queryable projection clients read via REST (a future client-track endpoint; the table's readers are out of Phase 4's server scope beyond the stream).

## 4. `tool_steps` installation

**Table** (migration v5, adapted from the core-schema draft — two refinements: `approval_id` links the execution record to its authorization, and the state set drops `proposed`, which belongs to approvals):

```sql
-- Migration v5: phase4-tool-steps (sketch for review; the DDL ships with the implementation)
CREATE TABLE tool_steps (
  workspace_id TEXT NOT NULL, run_id TEXT NOT NULL, id TEXT NOT NULL,
  call_key TEXT NOT NULL, parent_step_id TEXT,
  ordinal INTEGER NOT NULL CHECK(ordinal > 0),
  tool_name TEXT NOT NULL CHECK(length(tool_name) BETWEEN 1 AND 128),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 256),
  approval_id TEXT,
  state TEXT NOT NULL CHECK(state IN ('running','completed','failed','denied','cancelled','unknown')),
  result_json TEXT CHECK(result_json IS NULL
    OR (json_valid(result_json) AND length(result_json) <= 65536)),
  output_blob_id TEXT,
  started_at INTEGER NOT NULL, finished_at INTEGER,
  PRIMARY KEY(workspace_id, run_id, id),
  UNIQUE(workspace_id, run_id, call_key),
  FOREIGN KEY(workspace_id, run_id) REFERENCES runs(workspace_id, id),
  FOREIGN KEY(workspace_id, run_id, parent_step_id) REFERENCES tool_steps(workspace_id, run_id, id),
  FOREIGN KEY(workspace_id, output_blob_id) REFERENCES blobs(workspace_id, id)
);
CREATE INDEX tool_steps_run_ord ON tool_steps(workspace_id, run_id, ordinal);
```

**Write path: worker via seam, service writes the rows.** The worker is the only party that observes tool calls; the service is the only SQLite writer. The data crosses on the existing `worker.events.append` verb as two new event types — which, per the v1 versioning policy ("new message types the other side must understand are a new protocol version, not an additive change"), means **`worker-seam/2`**: v1 plus `tool.call_started` / `tool.call_finished`, nothing else changed. The service speaks both versions and negotiates down (never up); the worker the service spawns speaks v2. On a v1-negotiated connection the worker emits no tool events — steps are simply absent ("missing events remain unknown," per the data model), never fabricated.

- `tool.call_started`: `{call_key` (worker-stable UUID per call — the idempotency key), `parent_call_key?`, `tool_name`, `title` (user-safe, ≤256 chars), `approval_id?}`. The service inserts the row (`state='running'`, service-assigned `ordinal`, `started_at` on the server clock) **in the same transaction as the event append** — the journal row and the projection row commit atomically, so they can never diverge. A retried `call_started` with the same `call_key` returns the existing row (the `UNIQUE` constraint plus the existing dedupe discipline), exactly like event-id dedupe.
- `tool.call_finished`: `{call_key, state: 'completed'|'failed'|'cancelled', result_json?` (≤64 KiB inline; larger outputs go through `output_blob_id`), `output_blob_id?}`. Transitions the row; sets `finished_at`. A finish for an unknown `call_key` is rejected (`unknown_call_key`) — the worker must start before it finishes, and out-of-order frames are a worker bug, failed closed.
- The one service-written step kind: when an approval is **denied** (or expires/revoked while proposed), the service inserts a `tool_steps` row in state `'denied'` with the `approval_id`, at decision time, in the decision transaction. The worker never starts the tool, so the worker can never report it — without this, denied attempts would be invisible in step history. An expired/revoked approval maps to `'cancelled'` unless it was denied, in which case `'denied'`.

**Coexistence with the approvals audit trail (no double-bookkeeping).** The two tables record different facts, linked, never duplicated:

1. `approvals` is authoritative for **authorization** (was this action permitted, by whom, under which digest and lease generation). `tool_steps` is authoritative for **execution history** (what ran, in what order, with what result).
2. Every tool_step for an approval-gated action carries the `approval_id` of the consumed approval. Invariant: a `completed` step with a non-null `approval_id` must reference an approval in state `approved` whose ticket was consumed — enforced at `call_started` time (reject `approval_id` pointing at a non-approved row with `gated_step_without_approval`).
3. A denied approval produces exactly one `denied` step (service-written); it never produces a `running` step. The approval row is never updated with execution outcomes, and the step row never records authorization decisions — the `denied`/`cancelled` marker steps are projections of the approval row, not second decisions.
4. Non-gated tools (reads, searches) produce steps with null `approval_id`. The projection covers all tool calls, not just gated ones — that is the point of the Activity step-detail surface.

**Bounds.** `title` ≤256 chars (user-safe, never secrets — the same rule as `description_user`), `tool_name` ≤128, `result_json` ≤64 KiB inline with larger outputs referenced via `output_blob_id` (content-addressed blobs already exist). `ordinal` is per-run, service-assigned, strictly increasing — the display order for step detail. Retention follows the locked storage rule: no time-based deletion in alpha; growth bounded by per-run event caps and the operator-visible size budget (the unification decision's rule — tool_steps rows count against the same per-run budget as events).

## 5. Ordering and idempotency guarantees

The client contract, stated as invariants the implementation must hold under the §7 harness:

1. **Per-stream order is sequence order.** Frames arrive in strictly increasing `seq`. There are no gaps in what the client receives *from a single connection* — a gap means the connection died, and the reconnect replay fills it.
2. **At-least-once, dedupe by `id`.** The same `id` may arrive twice (reconnect replay racing a live frame, resync after `stream.resync_required`). The client drops the duplicate. Re-applying an event never duplicates a message, a tool call, or a run.
3. **The cursor is the truth.** The client persists the cursor on every data frame and reconnects from it. The server's only promise is: everything with `seq` greater than your cursor is in the journal and will be replayed (bounded by §2's too-old rule).
4. **Cross-run ordering is display order.** `seq` interleaves runs on one host journal; two frames' relative order proves nothing about causality. (The UI contract's rule, restated because it is easy to get wrong.)
5. **No phantom events.** Every streamed frame corresponds to a committed journal row. Control frames (`event: control`) are the only non-journal frames, and they never advance the cursor.
6. **Idempotent admission composes.** A retried admission returns the original run receipt (Phase 2); its `run.queued` event was journalled once, so the stream shows it once per cursor position — replays may resend it, and dedupe-by-`id` absorbs that.

## 6. Security

- **No secret material on the stream, by construction.** The exclusion list (§3) keeps the execution ticket (`approval.dispatched`) and the provider binding (`provider_session.bound`) out of every client's reach. The ticket decision from Phase 3 is restated as a stream invariant: no payload on the stream may contain ticket material, and the implementation asserts this with a harness scan (§7.7), not just code review.
- **Payloads are user-safe at write time.** `description_user` (≤512 chars, never secrets), step `title` (same rule), `error_user` (raw provider errors never reach the UI — the PoC rule, preserved through the schemas). The stream does not add a second sanitization layer; it relies on the write-time contracts and the exclusion list.
- **Per-device scoping is host scoping.** A device-session Bearer opens the stream of the host it enrolled on, and sees that host's `user`-visibility journal. There is no per-device content filtering in the alpha because there is no multi-principal data model — one owner, one host journal. This is stated plainly so a future multi-user design knows what it is changing.
- **Revocation kills the stream.** 401 at connect for a revoked device; mid-stream re-validation on every heartbeat tick, close on revocation. "Immediate" stays honestly bounded as *on next contact* (the Phase 2/3 bound, unchanged).
- **The worker realm stays out.** The worker's boot credential is rejected on the HTTP listener; the stream never carries seam-internal frames (handshakes, input chunks, artifact bytes).

## 7. Proof plan

One leg, deterministic, on this Linux VM: no Docker, no Codex, no paid models, no real user data. A fake `worker-seam/2` worker plus a scripted SSE client drive the real `agentmeld-server` binary against a temp SQLite file with an injected server clock — no wall-clock sleeps except where the heartbeat interval is explicitly configured down for the test.

1. **Envelope and order.** Connect with no cursor; assert the last ≤200 rows replay then live frames follow, every frame matching the §2 envelope (required fields, types, `seq` strictly increasing), `ts` on the injected clock.
2. **Live delivery.** Fake worker appends events across two runs; assert all arrive in sequence order with no drops and no cross-run reordering.
3. **Reconnect replay.** Kill the client mid-stream; reconnect with `Last-Event-ID`; assert exactly the missed frames replay, none duplicated, none missing. Repeat with `?cursor=` to prove the two mechanisms agree.
4. **Too-old cursor.** Advance the journal >5000 past the client's cursor; reconnect; assert 410 `cursor_too_old` with `current_seq`; assert the client refetch (`GET /api/v1/state`) + resubscribe path recovers.
5. **Heartbeat.** Configure a 1s heartbeat for the test; assert `:ping` comments arrive; simulate a stall (blackhole the socket); assert the client reconnects within its 45s-equivalent budget and resumes from its persisted cursor.
6. **Backpressure.** Configure a 4-frame queue; stall the client; flood events; assert the server sends `stream.resync_required` with the current seq and closes (never an unbounded buffer, never silent drops); assert the client resubscribes and dedupes the replayed tail by `id`.
7. **Exclusions.** Journal `approval.dispatched` (with a ticket) and `provider_session.bound` rows; assert neither ever appears on the stream; scan every streamed payload for ticket-shaped material and fail on any hit.
8. **Restart.** SIGKILL the server mid-stream with a live client; restart; assert the client reconnects with its cursor and replays exactly the frames journalled before the kill — no loss, no duplicates.
9. **tool_steps.** Fake worker emits `tool.call_started`/`finished` (nested parent/child, approval-gated and plain); assert rows with correct states, service-assigned ordinals, `call_key` idempotency (duplicate `started` returns the existing row), unknown-`call_key` finish rejected; deny an approval and assert the service-written `denied` step with the `approval_id` link; kill mid-append and assert journal row and projection row are atomically both-or-neither.
10. **Lease on the stream.** Takeover with an active run → `lease.takeover` frame on the stream against that run; resume cycle → `lease.resume`/`lease.observed`/`lease.resumed`; assert `lease_events` and the stream agree on generation ordering.

All assertions run against the real binary and the real SQLite file; the fake worker and SSE client are disposable harness code, never shipped.

## 8. What could go wrong

- **The exclusion list rots.** Every new event kind streams by default; a future kind carrying sensitive payload rides the stream until someone remembers the list. Mitigation: the harness's payload scan (§7.7) runs against *every* kind, and the stream handler keeps the exclusion list adjacent to the query — but the design is honest that this is a process dependency, not a structural guarantee. A structural alternative (default-deny with an allowlist) is rejected: it would silently drop new kinds from clients until the allowlist is updated, which fails the "new capability is visible" property the Activity surface needs.
- **Replay amplification.** A client that reconnects in a tight loop with a fresh cursor each time replays 200 rows per connect. Bound it: per-device connect rate limiting (the existing `rate_limited` discipline generalizes), and the 200-row default is small enough that the cost is a rounding error against the journal.
- **Clock-only ordering illusions.** `ts` is display-only, but clients will sort by it if `seq` handling has a bug. The envelope puts `seq` first and the client contract (§5) names sequence order the only order — defense in depth against a future client bug.
- **`Last-Event-ID` vs. `?cursor=` divergence.** Two mechanisms can disagree if a proxy strips headers. The precedence rule (header wins) is deterministic, and both feed the same `seq > ?` query — there is no second code path to diverge.
- **tool_steps vs. answer deltas.** A tool's streamed output (`run.answer_delta`) and its recorded result (`result_json`) can disagree if the worker summarizes. The design does not reconcile them: the step result is the worker's claim, the deltas are the transcript. If they ever conflict, the transcript wins for display and the conflict is visible — silent reconciliation would be worse.
- **v2 rollout skew.** A v2 worker frame hitting a v1 service fails the turn closed today (discrepancy D4, §9). In the alpha the service spawns its worker, so skew cannot happen — but the negotiation order (version agreed before any v2 frame) must be proved by the harness, not assumed.

## 9. Cross-doc discrepancies found

Honest discrepancies surfaced while grounding this design — the Phase 3 `superseded`-vs-`revoked` treatment applies: surface, resolve in the design where possible, ask where genuinely owner-level.

1. **`provider_session.bound` visibility.** The seam spec says "never a client-visible field"; `apply_worker_events` stores it with `visibility = 'user'`. **Resolved in this design:** the stream excludes it by kind (§3), and the implementation should correct the stored visibility to `'diagnostic'` going forward. The exclusion is the enforcement; the visibility fix is hygiene.
2. **Ticket in the journal.** `approval.dispatched` journals the plaintext execution ticket into `run_events.payload_json`. Phase 3 decided the ticket never travels the browser stream; the journal write predates the stream. **Resolved in this design:** the stream excludes `approval.dispatched` by kind (§3), and the harness scans every streamed payload for ticket material (§7.7). (Whether the ticket should be journalled at all — vs. claimed and redacted — is left to the implementation; the stream contract does not depend on it.)
3. **Stale `approvals` draft.** `docs/specs/data/core-schema.sql` still lists approval states `consumed` and `superseded`; Phase 3 resolved `revoked`-only (§12.1 of that design) and shipped v4 without them. The draft was never amended. **Not resolved here** (out of scope for the v5 migration) — flagged as a doc fix for the Phase 4 implementation to make alongside the migration.
4. **Unknown enum values: ignore vs. fail closed.** The v1 versioning policy says "a v1 receiver ignores optional fields and enum values it does not understand"; the shipped service fails the turn closed on unknown event types. **Resolved in this design by scoping:** the alpha never runs mixed versions (the service spawns its worker), and negotiation precedes any v2 frame — but the tension is real and the v2 harness must prove the negotiation order (§7, §8). A future multi-version deployment must pick one behavior deliberately.
5. **Cursor mechanism, refined.** The Phase 2 design documents `GET /api/v1/events?cursor=`; this design adds `Last-Event-ID` precedence, the default 200-row replay, and the 410 too-old path. A refinement, not a contradiction — recorded here so the Phase 2 doc's single line is not read as the whole contract.

## 10. Owner decisions (resolved 2026-09-19 UTC)

1. **Multi-host streams — one stream per host.** Confirmed this design's assumption: a device opens one SSE stream per selected host, with host-scoped cursors. Multiplexing is deferred; it would need a cross-host cursor story this phase deliberately avoids.
2. **`delivery_outbox` — out of Phase 4.** Confirmed: SSE is the live path; durable push intents (APNs) stay a separate increment. The unification doc's "push-ready" phrasing refers to that later increment, not this phase.
3. **Idle-host lease visibility — no stream row (TARS's call).** Lease transitions with no affected run stay silent on the stream; `GET /api/v1/lease` remains the source of truth. Idle takeovers are rare, clients poll on reconnect anyway, and host-level events with `run_id: null` would break the envelope invariant that every event belongs to a run. Revisit if a client ever needs instant takeover awareness without polling.

## 11. What was verified and what was not

**Verified by reading (2026-09-19):** the approval-path design in full (§§2–5 the semantics this stream carries; §9 the shipped v4 DDL; §10 the harness style; §12 the resolved questions, including `tool_steps` → Phase 4); the rust-service-front design (§2 the `/events?cursor=` stub and 501 shape; §4 the schema-slice boundary); the worker↔service seam spec (verb 1's 18 event types, the append reply's host-assigned `seq`, the versioning policy, the `provider_session.bound` "never client-visible" rule); the v1 schemas (`worker-events-append.schema.json` event enum); the shipped server code — `api.rs` (the `future_stub` route, the `Authed` extractor, the dual `/api/v1`+`/api` mount), `db.rs` (`apply_worker_events` visibility assignment and dedupe, `record_milestone_locked`, the service-written approval/lease event kinds, the `approval.dispatched` ticket journaling at line ~2473), `migrations/v1.sql` (`run_events`: `sequence` PK AUTOINCREMENT, `id` UNIQUE, `visibility` CHECK, `payload_json` json_valid) and `v4.sql` (`approvals`, `computer_leases`, `lease_events`); the core-schema draft's `tool_steps` table; the unification design (§3 envelope, §4 contract-map rows); architecture §8 (envelope, at-least-once, SSE with cursor replay); the iOS design's Recommendations 3–4 (cursor persistence, dedupe, refetch-on-gap); the UI contract (Activity/step detail = `Runs/events/tool-step projection`; client cursor contracts); and `apps/worker/runtime.mjs` (today's worker emits no structured tool data — only `run.activity_changed` text and `run.thinking` markers — which forces the §4 write-path decision).

**Not verified:** nothing here is implemented — the SSE endpoint is still the 501 stub, `tool_steps` is not installed, and `worker-seam/2` does not exist. The proof plan (§7) is a plan, not evidence. The three open questions (§10) are genuinely open.
