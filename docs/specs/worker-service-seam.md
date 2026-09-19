# Worker↔service protocol seam

Date: 2026-09-18. Status: **design spec for issue #76** — planned, not implemented.
Phase 0 of the [control-core unification migration](../research/control-core-unification.md#6-phased-migration-plan):
design only, no behavior change, no source modified.

Read with: the [unification design](../research/control-core-unification.md) (§2 target
architecture and the seam; §4 contract implementation map — every message below is
traceable to a row), the [data model](data-model.md) (event envelope, table contracts,
transaction rules), and the [architecture](architecture.md) (§6 identity, §7 execution,
§8 events).

## 0. What this is

The worker is a dumb executor with a supervised leash. This document defines the leash:
the exact JSON messages the Node worker and the Rust service exchange over a private
Unix socket, who may say what, and what a compromised worker provably cannot do. The
normative message shapes live as JSON Schemas in
[schemas/worker-seam/v1/](schemas/worker-seam/v1/) (draft 2020-12,
`additionalProperties: false` throughout — the M0 journal's `deny_unknown_fields`
spirit). This document is the human-readable companion: rationale, auth model,
blast radius, and the line-by-line mapping from today's PoC.

The seam is versioned JSON from day one (`"protocol": "worker-seam/1"` on every
message), so the worker could be reimplemented later if measurements ever demand it.
No rewrite is planned.

## 1. Transport and framing

- Private Unix socket at a service-owned path (mode 700 directory). The socket is the
  only channel; there is no TCP listener for the worker API.
- One JSON object per line (JSON-lines, matching the existing `LiveClient` convention).
- Every frame carries `msg_type`, the wire discriminator naming the message
  (e.g. `worker.events.append`, pinned as `const` in each schema). `service.error`
  keeps its human-readable `message` field — `message` is never a discriminator.
  (Phase 1 edit, 2026-09-18: the Phase 0 schemas pinned no discriminator, which
  made routing impossible.)
- Max 1 MiB per frame (`max_frame_bytes` in `service.session.welcome`). Larger frames
  are rejected with `service.error` / `payload_too_large` and the connection is closed.
- Every worker→service message carries `run_id` and, after turn assignment, the turn
  `generation`. The service rejects messages for runs the worker was not assigned
  (`wrong_run`) and messages under a stale generation (`stale_generation`) — rejected,
  never retried by the worker as-is.
- Rejection is always an explicit `service.error` frame, never silence. The one
  exception is a stale-generation `service.turn.cancel`, which the worker ignores
  (cancellation is idempotent; the terminal event is the evidence either way).

Message inventory:

| Direction | Message | Schema |
| --- | --- | --- |
| W→S | `worker.session.hello` | [schema](schemas/worker-seam/v1/worker-session-hello.schema.json) |
| S→W | `service.session.welcome` | [schema](schemas/worker-seam/v1/service-session-welcome.schema.json) |
| W→S | `worker.events.append` | [schema](schemas/worker-seam/v1/worker-events-append.schema.json) |
| S→W | `service.events.stored` | [schema](schemas/worker-seam/v1/service-events-stored.schema.json) |
| W→S | `worker.approvals.request-decision` | [schema](schemas/worker-seam/v1/worker-approvals-request-decision.schema.json) |
| S→W | `service.approval.decision` | [schema](schemas/worker-seam/v1/service-approval-decision.schema.json) |
| W→S | `worker.inputs.fetch` | [schema](schemas/worker-seam/v1/worker-inputs-fetch.schema.json) |
| S→W | `service.inputs.data` | [schema](schemas/worker-seam/v1/service-inputs-data.schema.json) |
| W→S | `worker.artifacts.deliver` | [schema](schemas/worker-seam/v1/worker-artifacts-deliver.schema.json) |
| S→W | `service.artifacts.stored` | [schema](schemas/worker-seam/v1/service-artifacts-stored.schema.json) |
| S→W | `service.turn.start` | [schema](schemas/worker-seam/v1/service-turn-start.schema.json) |
| S→W | `service.turn.cancel` | [schema](schemas/worker-seam/v1/service-turn-cancel.schema.json) |
| S→W | `service.lease.command` | [schema](schemas/worker-seam/v1/service-lease-command.schema.json) |
| S→W | `service.error` | [schema](schemas/worker-seam/v1/service-error.schema.json) |

## 2. The four worker verbs

The worker may say exactly four things. If a fifth verb tempts you, see §8.

### Verb 1 — append run events (`worker.events.append` → `service.events.stored`)

The worker reports everything it does as events. This replaces `changed()`,
`recordEvent()`, and every `task.*` mutation in the PoC.

- **Shape:** 1–64 events per frame. Each event: worker-generated `event_id` (UUID,
  stable across retries → idempotent append), `event_type` (closed enum of 18 types),
  optional `dedupe_key`, and a type-specific `payload` validated by `oneOf`.
- **Required fields:** `protocol`, `msg_id`, `run_id`, `generation`, `events[]`.
- **Reply:** `service.events.stored` lists each `event_id` with its host-assigned `seq`
  (the client replay cursor) and `duplicate: true` when a retry was absorbed.
  `server_time_ms` is the service clock — the only authoritative clock.
- **Error cases:** `stale_generation` (worker must stop and await re-assignment, not
  retry); `wrong_run`; `malformed` (schema violation — a worker bug, fail the turn);
  `payload_too_large`; `rate_limited` (back off; the PoC's 1/sec `notify()` throttle
  becomes the worker's batching policy).
- **Retry rule (judgment call, §7):** the PoC's `notify()` swallowed `changed()`
  errors and set `stopping = true` — persistence failure became cancellation. Across
  the seam that conflation is wrong: a failed append is retried with backoff because
  `event_id` dedupe makes retries safe. Only an *explicit rejection*
  (`service.error`) is fatal to the turn. Transient socket failure → retry; explicit
  rejection → stop.
- **Traceability:** `run_events` table and the streaming transaction rule (persist
  bounded batches before advertising the cursor); contract-map rows "host-issued
  cursors / bounded replay / at-least-once" and "honest offline".

The 18 event types cover the PoC's milestone labels (`run.started`, `run.restored`,
`run.thinking`, `run.saving`, `run.completed`, `run.failed`, `run.cancelled`,
`run.interrupted`) plus what the seam needs: `run.answer_delta` (bounded 4 KiB text
batches replacing the in-memory `task.answer +=` accumulation), `run.activity_changed`,
`run.artifacts_delivered`, `run.terminated` (teardown evidence),
`provider_session.bound` (the native reference the PoC persisted via `await changed()`,
now an event — never a client-visible field), the approval lifecycle
(`approval.requested`, `approval.dispatched` carrying the single-use ticket,
`approval.settled`, `approval.request_timed_out`), and `run.resumed` with a fresh
observation digest (the journal's `Observed`).

### Verb 2 — request approval decisions (`worker.approvals.request-decision` → `service.approval.decision`)

Blocking. This is where the worker's future `onRequest` callback hangs (Phase 3; the
PoC constructs `LiveClient` without one, so this path is specified now, exercised
later). The worker proposes; the service and the human decide.

- **Shape:** `approval.action` (`tool`, `target`, bounded `arguments`), a user-safe
  `description_user` (≤512 chars, never secrets or provider internals), and
  `ttl_ms` (1–300000, the M0 journal's bound).
- **Required fields:** `protocol`, `msg_id`, `run_id`, `generation`, `approval.*`.
- **Reply:** exactly one `service.approval.decision`: `approved` (with the single-use
  `ticket`), `denied`, or `expired`. The service creates the `approvals` row, computes
  expiry on the server clock, and runs the single-transaction consumption check from
  the contract map.
- **Digest binding at the seam:** the canonical action form is UTF-8 JSON with object
  keys sorted lexicographically and no insignificant whitespace; digest = sha256 hex.
  The service recomputes the digest from the action (it does not trust a worker-sent
  digest); the worker recomputes it too and verifies the echo in the decision. A
  mismatch is treated as denied and the turn fails — `ChangedAction` at the seam.
- **Propose-while-pending:** rejected with `service.error` / `propose_while_pending`
  (the journal's structural guard, now a protocol error).
- **Dead-man timer (judgment call, §7):** the worker sets a local timer at its
  proposed TTL plus a fixed 60s grace. If it fires, the worker treats the request as
  expired: deny the action at the Codex callback, append `approval.request_timed_out`,
  and fail the turn (an undecided approval mid-turn is uncertain side-effect
  territory). A late-arriving decision for an abandoned `approval_id` is ignored. The
  service's authoritative expiry is enforced service-side regardless.
- **Traceability:** `approvals` table and the tool/approval transaction rule;
  contract-map row "approval state machine, server-time expiry, single-transaction
  consumption".

### Verb 3 — fetch inputs (`worker.inputs.fetch` → `service.inputs.data`)

The worker pulls the bytes it restores into the container. Replaces the PoC's
in-process `[...conversation.workspace, ...task.inputs]`.

- **Shape:** `digest` (sha256, from the `service.turn.start` inputs manifest),
  `offset`, `length` (1 byte–256 KiB).
- **Reply:** `service.inputs.data` chunks until `eof`; the worker reassembles and
  verifies the digest before restoring.
- **Why bytes go over the socket:** the worker reads only what the service hands it.
  No shared-filesystem reads of service-owned paths — the trust boundary stays
  explicit even though both run on the same host. (Artifact *output* uses the staging
  dir because the data-model's result-ingestion rule stages bytes before promotion;
  input and output take deliberately asymmetric paths.)
- **Traceability:** `blobs`, `message_attachments`, `conversation_workspaces` table
  contracts.

### Verb 4 — deliver artifact bytes (`worker.artifacts.deliver` → `service.artifacts.stored`)

The worker writes snapshot bytes to the run's staging dir (issued in
`service.turn.start`) and delivers the manifest. Replaces the PoC's in-process
`task.artifacts = listing.filter(...)` block.

- **Shape:** `manifest` with `manifest_digest`, up to 64 files, 8 MiB total — the
  PoC's `outputBytes` cap, now service-enforced. Each file: top-level `name` (no `/`,
  the PoC's rule), `digest`, `size`, `staging_ref`.
- **Reply:** `service.artifacts.stored`. The service re-hashes every staged file,
  validates names and sizes, promotes on the same filesystem, then commits
  blob/version/event metadata. `accepted: false` carries a machine-readable
  `rejection.code` (`digest_mismatch`, `over_size_limit`, `unsafe_name`,
  `staging_missing`); a lying manifest is caught here, never promoted.
- **Ordering rule:** the worker must wait for `service.artifacts.stored` before
  appending `run.completed` — mirroring the data-model rule that the result reference
  and the notification intent commit together after required outputs exist.
- **Traceability:** `artifacts`, `artifact_versions`, `blobs`, `delivery_outbox`
  table contracts and the result-ingestion transaction rule; contract-map row
  "notification-intent pipeline".

## 3. Service→worker messages

- **`service.turn.start`** — assigns one turn. Carries `agent_context` (replaces
  `control.agentContext`), `expected_binding` (image digest, store instance, model,
  policy digest — the worker asserts these against its environment before driving
  the turn, fail-closed; the PoC's `assert` block moved across the seam, while
  verification against the recorded `provider_sessions` row happens service-side
  first), `lease_generation`, the `inputs_manifest`, the `staging_dir`, and
  `turn_timeout_ms`. One turn at a time per worker; a second start while a turn is
  active is rejected with `turn_in_progress` (the PoC's single-flight pump,
  preserved; parallelism via multiple workers is deferred).
- **`service.turn.cancel`** — replaces the `control.stop` assignment and the
  `control.cancelRequested` reads. `reason`: `user_requested`, `lease_takeover`, or
  `service_shutdown`. The worker sets its local cancel flag (the PoC `checkpoint()`
  shape survives locally — same throw-on-cancel semantics), tears down containers,
  and appends `run.cancelled` as termination evidence.
- **`service.lease.command`** — `pause` / `resume` with the new `lease_generation`,
  porting the journal's Takeover→pausing→human→resume→resuming→observed→agent
  sequence. The worker never initiates lease commands. On `resume` with
  `observation_required: true`, the worker re-observes the workspace and appends
  `run.resumed` with a fresh digest before the service treats the turn as live.
- **`service.events.stored` / `service.artifacts.stored` / `service.inputs.data` /
  `service.approval.decision`** — replies, described under each verb.
- **`service.error`** — explicit rejection; see §1. Codes: `unsupported_protocol_version`
  (with `max_supported_protocol`), `auth_failed`, `malformed`, `unknown_message`,
  `stale_generation`, `wrong_run`, `turn_in_progress`, `propose_while_pending`,
  `payload_too_large`, `rate_limited`, `internal`.

## 4. Version negotiation

Every message carries `"protocol": "worker-seam/1"`. The worker proposes its preferred
version in `worker.session.hello`; the service answers with `negotiated_protocol` in
`service.session.welcome` — it may negotiate down, never up. A version the service
does not speak is rejected with `unsupported_protocol_version`, never silently
accepted or silently downgraded. The full policy (additive vs breaking changes, how
v2 is introduced, schema freeze rules) is in
[schemas/worker-seam/v1/README.md](schemas/worker-seam/v1/README.md#versioning-policy).

## 5. Authentication: the boot-issued credential

- **Issuance:** when the service spawns the worker, it generates a fresh 256-bit
  random token per spawn and passes it in the spawn environment as
  `AGENTMELD_WORKER_TOKEN`. The first frame on the socket must be
  `worker.session.hello` carrying the token, within 5 seconds of connect, or the
  service closes the connection.
- **Defense in depth:** the socket directory is mode 700 (service user only), and the
  service cross-checks `worker_pid` from the hello frame against `SO_PEERCRED` on the
  accepted connection. The token is the primary credential; the pid check and the
  directory mode are independent second factors.
- **Scope:** exactly the four verbs plus the session handshake, scoped to runs
  assigned via `service.turn.start`. Every message carries `run_id`; anything for an
  unassigned run is rejected with `wrong_run`.
- **Rotation:** per-spawn. There is no in-life rotation because the worker is
  ephemeral: a new spawn gets a new token, and the old token dies with the old
  worker. Compromise response is kill-and-respawn — in-flight turns go to
  `interrupted`/`reconciling`, never silently resumed.
- **What it provably cannot reach:** the client API (separate listener, device-session
  bearer auth — the worker token is not accepted there), the SQLite database (no
  file path is ever disclosed to the worker, and there is no SQL verb), credential
  minting (no such verb exists), other runs' data (`wrong_run` on every message), and
  the execution domain's contents beyond what the turn legitimately produces.

## 6. Blast radius: what a compromised worker can and cannot do

Tied to the [contract implementation map](../research/control-core-unification.md#4-contract-implementation-map):

**It can:**
- Emit false events *for its assigned run only* — the activity feed of one run can be
  polluted, but `actor` is derived service-side from the session and server time is
  stamped service-side, so it cannot forge who did what or when. (Contract rows:
  event stream, honest offline — the service never invents state, and neither can
  the worker beyond its own run's feed.)
- Spam approval requests — bounded by propose-while-pending rejection and rate
  limiting; a request cannot approve itself, and the human sees the service-computed
  digest-bound action. (Contract row: approval state machine.)
- Deliver malicious bytes — caught at promotion: the service re-hashes, scans, and
  promotes; bytes never execute with service privilege, and execution happens only
  inside the worker's own containers. (Contract row: notification-intent pipeline.)
- Lie about termination — the service independently observes socket close and marks
  the turn `interrupted`; "a lost worker yields interrupted/reconciling, not invented
  cancellation." (Data-model cancellation rule.)

**It cannot:**
- Admit work (no request-key verb exists), decide approvals (no decision verb exists),
  or mint credentials — §8.
- Read or forge other runs' state (`wrong_run`), touch the database, or reach the
  client API.
- Bypass generation fencing: every verb carries the turn generation; stale is
  rejected with `stale_generation`. (Contract row: controller lease.)
- Escalate out of the execution domain: the M0 isolation boundary (read-only root,
  dropped capabilities, seccomp, AppArmor, quotas, no host mounts per AGENTS.md) is
  unchanged, and generated code never sees the supervisor socket.

## 7. Mapping from today's PoC

`executeTask(task, changed, control, conversation)` in `apps/poc/runtime.mjs` is the
draft the seam formalizes. Phase 1 moves the code verbatim and changes only these
call sites:

| PoC call site (`apps/poc/runtime.mjs`) | Seam equivalent |
| --- | --- |
| `changed()` via throttled `notify()` (1/sec, errors swallowed → `stopping=true`) | `worker.events.append` with the same 1/sec batching; errors go to a retry queue, not `stopping` — only explicit `service.error` is fatal (§2, verb 1) |
| `await changed()` after `conversation.session = {...}` ("persist the native reference before admitting a turn") | Acked `worker.events.append` with `provider_session.bound` carrying the binding; the binding *verification* moves service-side (it owns `provider_sessions`) |
| `recordEvent(task, kind)` (`events.mjs`: per-kind dedupe, throws on unknown kind) | `worker.events.append` with the closed `event_type` enum and explicit `dedupe_key` (`<run_id>:<kind>`) |
| `task.answer += …` / `task.activity = …` streaming mutations | `run.answer_delta` (bounded 4 KiB batches, `batch_seq` ordered) and `run.activity_changed` events |
| `control.stop = stopWorker` / `control.stop = null` | Removed; cancellation arrives as `service.turn.cancel`, completion returns the worker to idle |
| `control.cancelRequested` reads + `checkpoint()` | Local `cancelled` flag set by the cancel handler; `checkpoint()` keeps its exact throw-on-cancel shape against the local flag |
| `control.agentContext` in the prompt assembly | `turn.agent_context` from `service.turn.start` |
| Snapshot block: `task.artifacts = listing.filter(...)`, 8 MiB cap, `conversation.workspace = listing`, `await changed()` | Write bytes to `staging_dir`, `worker.artifacts.deliver` manifest, await `service.artifacts.stored`, then append `run.artifacts_delivered`; the 8 MiB cap is service-enforced |
| `task.status` / `task.error` assignments (incl. "never publish raw provider errors") | Terminal events (`run.completed`, `run.failed` with user-safe `error_user`, `run.cancelled`); the no-raw-errors rule is preserved in the schema descriptions |
| `finally` teardown: docker rm, cleanup-failure → `task.status='failed'` | `run.terminated` with `cleanup_ok` and evidence; socket close is independently observed service-side |
| Restore: `[...conversation.workspace, ...task.inputs]` handed in-process | `turn.inputs_manifest` + `worker.inputs.fetch` per digest, reassembled and digest-verified |
| Binding asserts (image digest, store instance, model, policy digest) | Worker asserts `turn.expected_binding` before driving the turn, fail-closed |
| (New in Phase 3) Codex approval callback via `LiveClient` `onRequest` | `worker.approvals.request-decision`, blocking; the callback answers from `service.approval.decision` |

### Judgment calls the PoC forced

1. **`notify()`'s error handling.** The PoC conflated "couldn't persist" with "should
   stop." Across the seam these are different failures: persistence is retried
   (idempotent append makes that safe); only explicit rejection stops the turn.
2. **Binding verification moves service-side.** The worker can no longer see
   `conversation.session`; it asserts the expected binding it's given. The
   continuation-safety check against the recorded `provider_sessions` row belongs to
   the service, which owns that table.
3. **`recordEvent`'s silent dedupe becomes explicit.** The per-kind "already recorded,
   return" behavior is now a visible `dedupe_key`, so the service and any future
   reader can see the dedupe contract instead of inheriting it from a JS closure.
4. **No separate "turn finished" verb.** Completion is expressed through the event
   verb's terminal types plus the `service.artifacts.stored` ack — the finished
   signal the service needs is already there. (See §8.)
5. **The approval reply is single, not double.** The worker does not need a separate
   "request accepted, expires at" message: the service guarantees the terminal
   decision arrives by expiry, and the worker's local timer is purely a dead-man's
  switch for total service loss.

## 8. Explicit non-goals

The worker will never: admit work, decide approvals, read the database, mint
credentials, initiate lease commands, address runs it was not assigned, or supply
authoritative timestamps. There is deliberately no fifth verb:

- **No `worker.status` / heartbeat verb.** Liveness comes from the socket itself: a
  closed socket is a dead worker, and the service marks its turns
  `interrupted`/`reconciling`. A heartbeat message would duplicate what the transport
  already says.
- **No `worker.session.persist` verb.** The native provider reference is just another
  event (`provider_session.bound`), persisted with an ack like any critical state.
- **No `worker.logs` verb.** Provider errors never reach the UI by PoC rule; worker
  diagnostics stay worker-local (stderr). What the service needs — termination
  evidence — arrives as events.
- **No multi-turn parallelism.** One turn per worker, single-flight, matching the
  PoC pump. Parallelism via multiple supervised workers is deferred, not designed
  here.

## 9. Open questions Phase 1 will likely answer

- Whether the 1/sec answer-delta throttle needs tuning against SSE replay behavior
  under reconnect storms (the iOS contract's at-least-once + dedupe makes this safe
  to adjust).
- Whether `inputs.fetch` chunking needs flow control beyond the 256 KiB cap for
  large workspaces.
- The exact UX shape of `observation_required` resume — what the worker re-observes
  and how the service displays it.
- `service.turn.start` will almost certainly grow one or two fields (locale/timezone
  for agent context is the obvious candidate). That's what the versioning policy is
  for — additive, no version bump.

## 10. What was verified and what was not

**Verified by reading (2026-09-18):** `apps/poc/runtime.mjs` (all 145 lines:
`executeTask` signature, `changed`/`control`/`recordEvent`/`checkpoint`/`notify`,
every `task.*` mutation site, the snapshot filter, the teardown path),
`experiments/codex-live-client.mjs` (the `onRequest` path this spec's verb 2 hangs
off, the `-32601` default-deny, byte/frame budgets), `apps/poc/events.mjs`
(`recordEvent`'s per-kind dedupe and label set), the unification design §§2–4, the
data-model table contracts and all seven transaction rules, and issue #76's
requirements. All 14 schemas parse as JSON and validate against draft 2020-12
meta-schema shape (checked with `python3 -c json.load`); `scripts/check-docs.py`
passes on all files including the new README.

**Not verified:** nothing here has been implemented — there is no Rust service and
no split worker yet, so no message has ever been exchanged. The schemas have not been
validated with a real JSON Schema validator on this VM (no network install
performed); structural check only. The approval flow (verb 2) is specified but, like
the PoC, unexercised against real Codex callbacks — Phase 3 owns that proof.

## 11. Phase 4 addendum: worker-seam/2 (2026-09-19)

Phase 4 introduces `worker-seam/2`, negotiated exactly as §4 describes: the worker
offers `worker-seam/2` in `worker.session.hello`, the service answers
`negotiated_protocol: "worker-seam/2"` in `service.session.welcome`, and every
subsequent frame of the session must carry `worker-seam/2` verbatim. A v1 worker
keeps working unchanged (the service still speaks v1); a future `worker-seam/N`
negotiates down to the service's max. The pinning is exact — a v2 session sending a
v1 frame (or vice versa) is rejected, so a worker cannot smuggle v2 event types
into a v1 session.

The only wire change in v2 is additive: two new worker event types, journalled
through `worker.events.append` like every other event:

- `tool.call_started` — `{call_key, parent_call_key?, tool_name, title, approval_id?}`.
  Projects a `running` row into `tool_steps`. Duplicate `call_key` returns the
  existing row (idempotent, no ordinal gap). A gated start (`approval_id` present)
  requires the approval to be `approved` **and** its execution ticket consumed
  (`consumed_at` non-null); otherwise the whole batch fails closed.
- `tool.call_finished` — `{call_key, state: completed|failed|cancelled,
  result_json?, output_blob_id?}`. Unknown `call_key` fails the batch closed.
  First terminal finish wins; later finishes are ignored. `result_json` is capped
  at 64 KiB inline (larger results belong in a blob referenced by
  `output_blob_id`, which must already exist).

The normative shapes are the v1 schemas plus the Phase 4 event contracts
(`docs/design/event-contracts.md` §4). The `tool_steps` projection, the SSE stream,
and the approval-gated execution record are Phase 4's implementation; this spec's
transport, framing, auth, and blast-radius sections are unchanged.
