# Rust service front (Phase 2 design)

Date: 2026-09-18. Status: **design for issue #80 — planned, not implemented.**

Read with: the [control-core unification design](../research/control-core-unification.md) (§2 target architecture, §4 contract map, §6 Phase 2), the [unification decision](../decisions/2026-09-18-control-core-unification.md), the [worker↔service seam](../specs/worker-service-seam.md), the [data model](../specs/data-model.md) and its [core schema draft](../specs/data/core-schema.sql) and [migration plan](../specs/data/migration-plan.md), and the [worker-seam v1 schemas](../specs/schemas/worker-seam/v1/README.md).

Phase 2 is the first Rust component the product runs: a new `agentmeld-server` binary that replaces the Node front (`apps/poc/server.mjs` + `conversations.mjs`) while supervising the Phase 1 Node worker over `worker-seam/1`. The PoC browser UI must work unchanged at every step; `server.mjs` is retired only at the end. No flag day.

## 1. What Phase 2 is, in one paragraph

`agentmeld-server` (Rust, axum) becomes the host's single writer: it authenticates devices, admits work idempotently, persists conversations/messages/runs/events/artifacts in SQLite, serves the static web assets, and spawns and supervises the Node worker over a private Unix socket exactly the way `apps/poc/supervisor.mjs` does today — 256-bit per-spawn token, child-PID check, `service.turn.start`, event application, input serving, artifact acceptance, fail-closed cancellation. The `state.json` store is imported once with legacy IDs preserved; the JSON store is never dual-written. Approval semantics, the controller lease, revocation, and the SSE event stream are **not** Phase 2 — they are Phase 3 and Phase 4, which hang off contracts this phase establishes.

## 2. The `/api/v1` surface

`/api/v1` exists from the first Rust-served endpoint (locked decision). The shape ports `server.mjs`'s routes one-for-one; the PoC's unversioned paths are internal-only and disappear with it. Every response is JSON with `Cache-Control: no-store`; errors use the existing envelope `{"error": "<user-safe string>"}` — raw provider errors never reach the UI (the PoC rule survives).

| Method + path | Ports | Behavior |
| --- | --- | --- |
| `GET /api/v1/state` | `server.mjs` `GET /api/state` | Agent name, public tasks, public conversations, active run ID. The single call that renders the whole PoC UI. |
| `GET /api/v1/agent` | `GET /api/agent` | Agent profile (name, revision, config summary). |
| `POST /api/v1/agent` | `POST /api/agent` | Update agent context. Serialized against admissions and the pump: rejected (409) while a run is queued or active, exactly like the PoC — changing the profile must not rewrite a live provider context. |
| `POST /api/v1/conversations` | `POST /api/conversations` | Create/update/archive conversation. Archive while a turn runs in it is 409 (the PoC's guard), and archive forbids new admissions until restored. |
| `POST /api/v1/tasks` | `POST /api/tasks` | Idempotent admission. Request body carries `request_key` (UUID) + payload SHA-256. One transaction (data-model rule 1): same key + same digest → return the original run receipt (202); same key + different digest → 409; new key → insert message, run, admission event, return 202. This is the transaction `conversations.mjs`'s `admit()` approximated in JS. |
| `POST /api/v1/stop` | `POST /api/stop` | Queued run → cancel immediately (202). Running run → mark `cancelling`, deliver `service.turn.cancel` (`user_requested`), return 202 and let the worker terminalize. Same guards as the PoC: not-found 404, not-stoppable 409. |
| `GET /api/v1/workspace?conversation=` | `GET /api/workspace` | Read-only projection of the conversation's retained workspace listing (no provider session data, per the workspace-browser contract). |
| `GET /api/v1/workspace/file?conversation=&name=` | `GET /api/workspace/file` | Single-file download, ownership- and access-rechecked per request. |
| `GET /api/v1/file?task=&kind=&name=` | `GET /api/file` | Input/output attachment download. Resolves through the import-compatibility lookup (see §7) so old UI links keep working. |

Two endpoints are **designed but stubbed in Phase 2**, returning 501 with a user-safe message, so the API shape is complete before the semantics land:

- `GET /api/v1/events?cursor=` — the host-issued cursor stream (Phase 4). Phase 2 writes the `run_events` rows it will replay; it just does not serve the stream yet.
- `POST /api/v1/approvals/{id}/decision` — the single-transaction consumption endpoint (Phase 3). Phase 2 has no approval rows to decide; the worker's `worker.approvals.request-decision` is answered with the same explicit rejection the Node supervisor gives today ("approval path not implemented"), never silence.

The static asset set (`/`, `/app.js`, `/style.css`, `/brain.svg`, the JS modules, `agent-settings.js`) is served unchanged, with the same CSP, `X-Content-Type-Options`, and `Referrer-Policy` headers the PoC sets (see §8).

## 3. Device auth

The PoC's single random bearer token becomes per-device sessions — but Phase 2 is the *bootstrap*, not the full pairing system. The data model's device tables (`Pairing/devices` slice) are an M2 P8 extension; Phase 2 installs the minimum needed to authenticate devices honestly and revoke them.

**Tables.** Two new tables alongside the core schema (§4): `devices` (`id`, `name`, `enrolled_at`, `revocation_version`, `last_seen`) and `device_sessions` (`id`, `device_id`, `token_hash`, `issued_at`, `expires_at`, `revoked_at`). Sessions are opaque bearer tokens, SHA-256-hashed at rest; lookup is by hash with `timingSafeEqual`-equivalent constant-time comparison. No device ever learns another device's token; the service derives actor identity (`initiator_id`) from the session, never from a request field — the locked "no trusted-owner at the client boundary" decision.

**Bootstrap.** On first run, the service prints a one-time pairing token (the direct descendant of the PoC's printed token) and binds loopback-only until at least one device is enrolled. The first browser to present the pairing token receives a device session; the pairing token is single-use and expires after 10 minutes. After bootstrap, the pairing endpoint is disabled — there is no unauthenticated re-enrollment path, because the trust model does not get one.

**Validation.** Every request re-checks the session's revocation version against a cached revocation list invalidated on change; a revoked device gets 401 and the re-pair flow. 401 = "re-authenticate"; 403 = "authenticated but not authorized for this host/workspace" — wrong-host and wrong-workspace IDs are 403, never 404, so existence is not leaked to the wrong party. Host/Origin checks survive the move to Rust, per interface: the loopback listener enforces `127.0.0.1` + origin; the tailnet listener enforces tailnet-source + origin. The service never binds `0.0.0.0`.

**Worker tokens are not device tokens.** The worker's boot-issued credential is accepted only on the Unix socket, never on the HTTP listener — the blast-radius wall from the seam spec, enforced as two separate auth realms in code.

## 4. SQLite schema slice

Phase 2 installs the continuity slice only (migration-plan increment A, adapted): the tables needed to admit, run, record, and retain work. Locked storage decisions: **SQLite WAL at host-owned `~/.agentmeld/`** (artifacts content-addressed beneath it), foreign keys on, one service writer, no materialized snapshots (SQLite *is* the snapshot), no time-based event deletion in alpha.

Installed in Phase 2: `schema_migrations`, `principals`, `hosts`, `workspaces`, `agents`, `conversations`, `messages`, `runs`, `provider_sessions`, `conversation_workspaces`, `run_events`, `blobs`, `message_attachments`, `import_receipts` — plus the two Phase-2 auth tables from §3.

Explicitly **not** installed: `approvals`, `tool_steps`, `artifacts`, `artifact_versions`, `delivery_outbox`. They arrive in the Phase 3 and Phase 4 increments with their own reviewed migrations. This matters for the design because of one consequence: Phase 2 has no artifact *versions* yet — the PoC's per-turn artifact replacement (`task.artifacts` overwritten each turn) is represented as plain blobs attached to the run plus the conversation workspace snapshot, not as versioned artifacts. Version history starts in the next increment; nothing Phase 2 writes will conflict with it.

Schema changes are ordered, checksummed migrations in `schema_migrations`; an unknown or changed checksum blocks startup (the core-schema draft's rule). The SQL draft in `docs/specs/data/core-schema.sql` remains the target contract; Phase 2 implements its subset and must not invent fields the draft does not define.

The single-writer discipline is enforced in-process (one writer handle, bounded transactions, WAL) and at startup (a lock file beside the DB — a second service instance refuses to start). Network calls never happen inside a transaction: the pump claims the run row, then spawns the worker outside the transaction.

## 5. Rust worker supervision

The supervisor is a Rust port of `apps/poc/supervisor.mjs` — not a redesign. Its message-handling responsibilities in Rust terms:

**Spawn and handshake.** On pump claim: create the mode-700 socket directory under the service state dir; remove any stale socket; generate the 256-bit base64url token; bind the Unix listener; spawn the worker with `AGENTMELD_WORKER_SOCKET`, `AGENTMELD_WORKER_TOKEN`, and the Phase 1 gap-fill `AGENTMELD_RESUME_THREAD_ID` (see §9) in its environment; await `worker.session.hello` within 15 seconds. Handshake validation: protocol discriminator must be `worker-seam/1`, the token must match in constant time, and `worker_pid` must equal the spawned child's PID. Any failure kills the child and fails the turn closed — same as the Node supervisor's `handshakeReject`. (Phase 1's documented future — `SO_PEERCRED`-level peer authentication and token rotation for a long-lived worker — is not Phase 2; the spawn-per-turn child PID check carries over as-is.)

**Turn start.** Before spawning, verify the execution environment binding against `readBinding()` and the recorded `provider_sessions` row: a changed binding invalidates the session (continuation is `unavailable`, exactly the PoC behavior). Then send `service.turn.start` with `turn.agent_context` (the assembled prompt string — §9 gap-fill), `expected_binding`, `lease_generation`, `inputs_manifest`, `staging_dir`, and `turn_timeout_ms` (10 min, the PoC's `LiveClient` whole-life timer). A pending user cancel arms a flag delivered back-to-back with `turn.start`, so the worker winds down through `run.cancelled` instead of running a doomed turn.

**Event application.** Each `worker.events.append` frame is schema-validated, then applied in one transaction: event-level dedupe by `event_id` (idempotent append — a retry returns the *original* sequence, mirroring `stored[].duplicate`), insert `run_events` rows, update the `runs` row and conversation state for lifecycle effects, and reply `service.events.stored` with host-assigned sequences and the server clock. `run.answer_delta` batches are appended to the response message; `provider_session.bound` is verified against `expected_binding` and persisted as a `provider_sessions` row; `run.completed`/`run.failed`/`run.cancelled` terminalize the run and promote the workspace snapshot. Unknown event types fail the turn closed. This is the transactional version of the Node supervisor's `applyEvent` — the state mutations are identical; only the store changed.

**Input serving.** `worker.inputs.fetch` resolves the digest against the turn's in-memory blob map (built from the conversation workspace + task inputs at spawn), serves 256 KiB chunks with `eof`, and rejects unknown digests and bad ranges explicitly. Bytes go over the socket — never a shared-filesystem read of service paths — preserving the seam's trust boundary.

**Artifact acceptance.** `worker.artifacts.deliver` follows the data-model's result-ingestion rule: validate the manifest digest and the 8 MiB total cap, confine staging refs to bare filenames, re-hash every staged file, promote on the same filesystem, then commit blob metadata and the `run.artifacts_delivered` event. Rejections carry the machine-readable `rejection.code`. The worker must await `service.artifacts.stored` before appending `run.completed` — enforced by rejecting a `run.completed` that names an unacked manifest (fail-closed, matching the Node supervisor's ordering rule).

**Fail-closed semantics.** Wrong `run_id` → explicit `service.error` / `wrong_run`; stale `generation` → `stale_generation`; oversized frames rejected at 1 MiB; a terminated socket is *independently observed*: the run goes to `interrupted` (never an invented `cancelled`), the child is reaped (SIGTERM then SIGKILL with a 5s grace, the Node supervisor's `reapChild`), and the staging dir and socket are cleaned up. Cancellation and completion are the only terminal evidence; a lost worker yields `interrupted`/`reconciling`, never silence.

## 6. The one-time `state.json` import

At cutover, the JSON store is imported once and retired. The procedure follows the [migration plan](../specs/data/migration-plan.md) exactly; this section is the Phase 2 operational design.

**Quiesce and backup.** Stop accepting new requests, let active work settle or obtain an explicit Stop, then stop the writer — never copy a changing JSON file and call it a backup. Create a private timestamped backup of `state.json` plus a SHA-256/size manifest, and record the old executable revision and file ownership/modes. Provider secrets are not part of this export.

**Staging import.** Apply the ordered checksummed migrations to a *new* staging database under `~/.agentmeld/` (staging sibling, not the live path), then import record by record with the source digest and deterministic mapping recorded in `import_receipts`. The mapping follows the migration plan's legacy table: completed→completed, stopped/cancelled→cancelled, failed→failed, running/interrupted→interrupted; unknown statuses halt that record for review, never coerce. Missing timestamps stay null; missing provider refs mean no `provider_sessions` row — imported history is shown honestly, continuation is `reconstructed` only from visible records with user authorization. Never automatically replay an imported interrupted run.

**Public-ID preservation.** This is the mechanism the plan demands and the one Phase 2 must get right: every legacy task keeps its ID as the run ID, and every legacy conversation keeps its ID as the conversation ID — no ID remapping. `import_receipts` records `(source_digest, legacy_task_id) → (workspace_id, conversation_id, run_id)` so that re-running the import is idempotent and any old deep link resolves to the canonical scoped ID. The old public download API (`/api/v1/file?task=&kind=&name=`) resolves legacy task IDs through this mapping, so the UI's artifact links keep working without a second store.

**Verification and cutover.** Fixture readback per the migration plan: compare prompt/answer/state/input-output counts/names/decoded sizes/SHA-256 for every task, check foreign keys, uniqueness, row counts, and artifact retrieval through the new service. Then switch exactly one store pointer to the staging database and start serving. There is no dual-writing: at any instant exactly one writer owns one store. Rollback before the first new write is pointer-restoration from the backup; after new writes it is forward-fix or explicit reverse migration — never deleting the new store to make rollback look clean.

## 7. Static assets

The Rust service serves `apps/poc/public/` unchanged — same files, same allowlist, same content types, same CSP/`X-Content-Type-Options`/`Referrer-Policy` headers. The UI is the primary design source of truth and Phase 2 changes no pixel: the browser cannot tell which language served it. The React client is a separate track; Phase 2 does not touch the assets' framework.

## 8. Crate layout vs `agentmeld-m0`

A new crate, `agentmeld-server`, at `crates/agentmeld-server`: binary + modules `api` (axum routes, `/api/v1`), `auth` (device sessions, revocation), `db` (SQLite single writer, migrations), `supervisor` (worker spawn, handshake, frame routing, event application, artifact/input handlers), `import` (one-time `state.json` import), and `domain` (run state vocabulary). `agentmeld-m0` stops being anything the product runs: it remains in the tree as M0 qualification evidence, retired in place.

What ports from `agentmeld-m0`, and what does not:

- From `durable.rs`: the *discipline*, in the exact order it applies — generation fencing on every mutation, digest binding from propose to settle, server-time expiry with bounded TTLs, propose-while-pending rejection, single-transaction approval consumption, the `Takeover → pausing → human → resume → resuming → observed → agent` lease sequence including `PrivateBegin/End` for credential entry. The JSON-lines snapshot journal, the per-run single-mode model, the file-lock writer, the 16 MB poison cap, the 256-entry scope ledger, and the hardcoded `provider == "codex"` check in `Reconcile` do not port.
- From `control.rs`: the *vocabulary* — `Scope`/`Action`/`State` naming and the `StaleLease`/`ChangedAction`/`WrongScope` error taxonomy become domain types and HTTP/service error codes. Nothing executable ports; its logic is subsumed.
- The `deny_unknown_fields` spirit ports as axum's strict JSON rejection: unknown fields are rejected with 400, never ignored — the same discipline the seam schemas enforce on the wire.

Rust dependencies stay minimal and boring: axum, tokio, rusqlite (bundled), serde, sha2, uuid. No framework experiments in the control plane.

## 9. Phase 1 gap-fills carried forward

Three documented Phase 1 gap-fills cross into Phase 2 unchanged — they are the cost of shipping against `worker-seam/1` as frozen:

1. **Resume-thread env var.** The seam has no resume-thread field, so the thread ID still travels as `AGENTMELD_RESUME_THREAD_ID` in the spawn environment. The Rust supervisor reads the `provider_sessions.native_ref`, passes it through, and the worker resumes from it. A seam v2 field replaces this when the protocol next versions — not before.
2. **`workspace-listing.json` sidecar.** The seam carries only changed artifacts, so the worker still writes the complete snapshot as `workspace-listing.json` in the staging dir, and the service replaces the conversation workspace from it on `run.completed` — exactly what the PoC's `conversation.workspace = listing` did. If the file is missing at completion, the turn fails closed.
3. **`agent_context` as the assembled prompt string.** The prompt is still assembled service-side (fixed instructions + profile context + attached-file names + request) and sent verbatim in `turn.agent_context`. The worker does not assemble prompts and does not see the profile.

Additionally, the known Phase 1 gaps the seam spec documents stay assigned: final-answer reconciliation (worker hash vs `run.answer_delta` reconstruction) and multi-delivery manifest naming are **not** solved in Phase 2 — they ride with the artifact-versions increment.

## 10. Verification plan

Three legs, each independently runnable on the VM. None sends messages, invokes a paid model, or starts a container unless the owner explicitly authorizes a live probe (AGENTS.md default-suite rule).

**Journey.** The same full local journey the Phase 1 verification used — upload → report → revise → restart → continue — now against the Rust service, driven through `/api/v1` with the PoC browser client. Assertions: identical admission receipts (request-key dedupe returns the original run; mismatched digest 409s), identical single-flight behavior (a second turn is rejected while one is active), stop semantics (queued → immediate cancel; running → `cancelling` → worker-delivered `run.cancelled`), and attachment/workspace downloads resolving through the import lookup.

**Restart recovery.** Kill the service at three durable boundaries and observe, never assert-then-assume: mid-turn (worker orphaned → run `interrupted`, child reaped, no invented cancellation); mid-admission (request-key row rolls back, retry admits cleanly — no duplicate run); mid-artifact-promotion (staged but uncommitted bytes are reconciled at startup and retained for review, never silently promoted). In every case the service restarts, bumps generations, marks interrupted work, and refuses to resume a turn as if nothing happened — the M0 journal's open-time recovery, now across all runs.

**Import fidelity via fixture readback.** Build synthetic `state.json` fixtures covering every terminal state, partial answers, Unicode and name edge cases, duplicate task IDs, and unknown statuses (per the migration plan). Run the importer and verify: prompt/answer text byte-identical, status mapping exact, input/output counts/names/decoded sizes/SHA-256 all match, `import_receipts` idempotency (run twice, no duplicates), legacy task IDs resolvable through `/api/v1/file`, and old UI links rendering. Reject-on-ambiguous is a *passing* behavior here: the fixture set must include records the importer refuses, with a precise report.

## 11. What could go wrong

- **Import edge cases.** The migration plan names this: legacy/interrupted conversations, format-1 records that predate conversation IDs, duplicate IDs across formats. The design answers with halt-and-report plus staging, but the honest risk is that the first real `state.json` contains something the fixtures did not — which is why cutover keeps the untouched backup and the old revision until the owner accepts the migration.
- **Answer reconstruction drift.** Phase 2 inherits the Phase 1 seam gap: the service rebuilds the answer from `run.answer_delta` batches while the worker hashes its own final string. If they ever disagree, the service's version is the one the UI shows — and there is no cross-check today. The artifact-versions increment must close this.
- **The 409 contract on `/api/v1/agent`.** Porting the PoC's "no profile edits while work is queued" rule into a transactional service is easy to get subtly wrong (admission racing a profile update). The admission transaction must hold the serialization the PoC got from its `admissions` promise chain — one mutex around the admission/profile path, documented, not hoped for.
- **Approval-shaped holes.** Phase 2 runs `approvalPolicy: 'on-request'` with no handler, exactly like the PoC — the `-32601` refusal moves from `LiveClient`'s default-deny into the service's explicit `service.error`. Any run that triggers a Codex approval callback will fail closed rather than hang. That is the correct Phase 2 behavior and it will look like a regression to anyone who didn't know the PoC never approved anything.
- **Revocation vs cached sessions.** "Immediate" revocation is honestly bounded as *on next contact* — a device holding a valid session token that never makes another request is unaffected until it does. The design documents this bound instead of claiming instant global revocation.
- **Single-writer lock file.** The startup lock prevents two writers but does nothing for a crashed predecessor that left the lock stale. The design needs the lock to be PID-checked and stale-lock reclaimed with a logged warning — a detail this draft names but the implementation must prove.
- **TLS inside the mesh is deferred.** The honest statement of the locked decision: on the tailnet, device auth is the boundary and traffic is inside WireGuard's encryption, but there is no application-layer TLS. If the threat model changes, this is the decision to revisit — it is documented, not overlooked.

## 12. Decisions made in this draft

1. `agentmeld-server` is a new crate; `agentmeld-m0` is retired in place as qualification evidence. Vocabulary ports from `control.rs`, discipline from `durable.rs`, nothing executable from either.
2. `/api/v1` ports the PoC routes one-for-one (plus two stubbed future endpoints, `/events` and `/approvals/{id}/decision`, returning 501) so the UI is unchanged.
3. Phase 2 device auth is a bootstrap minimum — pairing token, `devices`/`device_sessions` tables, revocation versions — not the full M2 P8 pairing system.
4. Only the continuity schema slice installs (`approvals`, `tool_steps`, `artifacts`, `artifact_versions`, `delivery_outbox` wait for their increments); artifact versioning explicitly starts later, so Phase 2 has no version history.
5. The Rust supervisor ports `supervisor.mjs` behavior-for-behavior, including the three gap-fills and the spawn-per-turn child-PID check; `SO_PEERCRED` and token rotation stay future work for a long-lived worker.
6. Public IDs are preserved verbatim (legacy task → run ID, legacy conversation → conversation ID) with `import_receipts` as the idempotency and lookup mechanism; no ID remapping, no dual-writing.
7. Static assets are served unchanged by Rust; `server.mjs` is retired only at the end.

## 13. Open questions for the owner

1. The pairing bootstrap in §3 uses a single-use 10-minute token and then disables re-enrollment. Is that the right permanence, or should re-pairing require an explicit on-host action (e.g. a CLI command) rather than being permanently disabled?
2. Phase 2 has no artifact version history — a revised report overwrites the previous output reference until the next increment. Is that acceptable for the interim, or should the artifact-versions increment move ahead of the approval increment?
3. The stale-lock reclaim behavior (§11) is named but not designed. Accept PID-checked reclaim with a logged warning, or require manual operator intervention (fail closed) on a stale lock?

## 14. What was verified and what was not

**Verified by reading (2026-09-18):** `apps/poc/supervisor.mjs` in full (handshake, event application, input serving, artifact delivery, cancel arming, fail-closed teardown, the three gap-fills), `apps/poc/server.mjs` in full (routes, idempotent admission, single-flight pump, asset allowlist, security headers), the worker↔service seam spec and its v1 README (message inventory, auth model, blast radius, versioning policy), the data model's core schema SQL (all 19 tables, transaction rules), the migration plan (legacy mapping, backup/rollback, rollout increments), and the `durable.rs` header and core types (semantic base only).

**Not verified:** the Rust service does not exist — nothing here has been implemented, compiled, or run (the VM has no Rust toolchain, and this design makes no claim about what compiles). No import has been executed; the fixture plan in §10 is a plan, not evidence. Claims about the PoC's behavior (e.g. admission semantics, pump behavior, `-32601` approval refusal) come from code reading, not execution.

## 15. Implementation log (Phase 2 build, 2026-09-19)

The Rust service now exists (`crates/agentmeld-server`, axum + rusqlite). This log records behavior changes and discoveries made during implementation; the crate's tests are the executable form of the same claims.

**Frozen-UI compatibility.** The frozen client calls `/api/*`, not `/api/v1/*`. The router mounts the identical route set at both prefixes (the pairing link stays `/api/v1/pair` since the server prints it). Profile writes use the PoC's action names `edit`/`remember`/`forget` (the PoC's `profile.mjs` contract, including the 100-memory cap, 24 KB total cap, and revision-guard 409); a `get` read action is a non-PoC convenience. Static assets remain byte-for-byte unchanged.

**Schema v3.** The pump's profile-revision sync selected `conversations.agent_revision` and `runs.agent_revision`, which did not exist (live smoke test caught this: the pump claimed runs and died before `run_turn`). Migration v3 adds both columns, matching the PoC's `conversation.agentRevision`/`task.agentRevision` semantics.

**Stop during setup.** The active turn is registered before environment/setup work; a stop that lands while the run is `starting` (supervisor-registered, no worker yet) returns 202-equivalent `RequestedRunning` and moves the run to `cancelling`; the supervisor's pre-spawn check resolves it as `cancelled` without spawning. A stop with no registered active turn is a 409 retry, not a phantom cancel.

**Worker seam strictness.** All wire message structs carry `deny_unknown_fields` (the seam spec's `additionalProperties: false` throughout). `FrameReader` enforces the 1 MiB cap on the drained line, not just the pre-read buffer. `run.terminated` is accepted after terminal states (`completed`/`failed`/`cancelled`) — the real worker always sends teardown evidence after the terminal event, exactly like the PoC's `applyEvent` which checked `sawTerminal` rather than status.

**Handshake crash detection.** The hello wait races `child.wait()` against both the socket accept and the frame read: a worker that exits before its hello fails the turn immediately with "worker exited during handshake (exit code N)" instead of waiting out the 15 s timeout.

**Startup lock.** Creation is atomic (`create_new`); a stale lock is removed and re-created atomically so two racing startups cannot double-claim. `kill(pid, 0)` returning EPERM now counts as alive. `pair` accepts `--port` and prints it in the link.

**API hardening.** Oversized bodies return the JSON error envelope (`413 {"error":"The request body is too large."}`) instead of axum's default rejection. `Cache-Control: no-store` covers every response including the pairing redirect (its Location fragment carries a device-session token).

**Live smoke evidence (2026-09-19, temp state dir, loopback :4317):** pairing token → 303 redirect → single-use enforced (second use 401); admission 202 with PoC-shaped receipt; request-key dedupe returns the original run; pump claimed → revision sync → `run_turn` → environment check failed closed (no Docker on the VM) → run `interrupted`; restart recovery marked the in-flight run `interrupted`; duplicate server refused by lock; SIGKILL'd server left a stale lock that the next startup reclaimed with a logged warning. Full turn execution is unverified here — no Docker/Codex on the VM — and remains the Phase 3 gate.

**Static-asset allowlist (visual check, 2026-09-19).** The first screenshot pass showed a dead UI — no icons, status stuck at "Connecting…", navigation and dialogs inert. The Rust `STATIC_ASSETS` allowlist had drifted from the PoC: 5 entries (`/`, `/app.js`, `/style.css`, `/icon.svg`, `/manifest.webmanifest`) against the PoC's 13. `app.js` statically imports 8 sibling modules, so the 404s failed the whole module graph. The allowlist now mirrors `apps/poc/server.mjs` exactly (13 entries, `brain.svg` included, the nonexistent `icon.svg`/`manifest.webmanifest` removed). Screenshots of the working UI are recorded in `docs/progress/2026-09-19-phase2-ui-check.md`.
