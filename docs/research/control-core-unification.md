# Control-core unification design

Date: 2026-09-18. Status: **decided** (issue #74, owner confirmed 2026-09-18). This document specifies one authoritative durable control plane to replace the three divergent cores. Implementation is separate follow-up work.

Read with: the [Apple-first alpha decision](../decisions/2026-09-18-apple-first-alpha.md) (one Rust control service owns authentication, policy, task state, scheduling, event replay, artifacts), the [architecture](../specs/architecture.md) and [data model](../specs/data-model.md) specs, the [transport selection](../decisions/2026-09-18-remote-transport-selection.md), and the [iOS background/push design](../research/ios-background-push.md) (its Recommendations 3–4 define contracts the unified plane must implement).

## 0. The core recommendation, up front

**`durable.rs` is the semantic base. The PoC server is the API-shape base. `control.rs` is retired. `runtime.mjs` + `codex-live-client.mjs` survive as the supervised Node worker.**

- The M0 journal's *discipline* — generation fencing on every mutation, digest-bound actions from propose to settle, server-time expiry, single-unit approval consumption, poison-on-persistence-failure, paranoid input validation — is the DNA of the unified plane. Its *format* (per-run JSON-lines snapshot journal, file-lock single writer) does not survive: the approval transaction needs real multi-row atomicity and the product needs a multi-run host service, so the journal becomes SQLite tables (`run_events`, `approvals`, `runs`, `delivery_outbox`) per the data-model spec.
- The PoC's `server.mjs`/`conversations.mjs` already implement the outer API shape the product needs — idempotent admission by request key, single-flight task pump, atomic store writes, interruption marking on restart. That shape is ported into the Rust service; the JSON store is not.
- `control.rs`'s concepts (Scope/Action/State vocabulary, `check_dispatch`, digest-checked `decide`) are fully subsumed by the journal's richer model. Shipping both would be two approval state machines disagreeing on scope identity. It retires.
- The Node execution path is the only code that has ever driven real Codex work. It is not a control plane and must stop pretending to be one — it becomes the supervised worker, holding no authorization state and making no policy decisions.

## 1. What each core does today

### 1a. `crates/agentmeld-m0/src/control.rs` — the in-memory approval machine (178 lines)

A pure, single-threaded state machine over one run. Owns: `Scope` (workspace, actor, run, policy_revision, credential_revision), `Action` (tool, target, arguments), `State` (Running, WaitingApproval, HumanControl, Cancelled, Completed), and a `RunControl` holding scope, state, a lease `generation`, and one pending approval (action digest, generation, expiry).

Invariants it maintains:
- **Digest binding:** `decide()` recomputes the SHA-256 of the presented action and compares it to the proposed digest (`ChangedAction` on mismatch). An approval can never be redeemed for a different action than was proposed.
- **Generation fencing:** every dispatch checks the presented generation against the current one (`StaleLease` on mismatch); `take_control`, `resume`, `cancel`, and `complete` bump the generation, invalidating outstanding holders.
- **Scope binding:** `decide()` requires the deciding scope to equal the run's scope (`WrongScope`).
- **Exactly-once admission:** a decision returns the admitted action exactly once; the doc comment puts the journaling burden on the caller ("The caller must journal admission before performing any side effect").

What it does *not* do: persist anything (a process restart loses the run), authenticate anyone (the `actor` is a caller-supplied string), or order anything (no sequences, no event log). Its own header is candid: "a production implementation needs transactional storage, authenticated actor resolution, monotonic lease fencing, and process supervision." Two trust gaps worth naming explicitly: `propose()` accepts a caller-supplied `expires_at` with no bounds, and `decide()` accepts a caller-supplied `now` — expiry is not evaluated on server time. The unified plane must not inherit either.

### 1b. `crates/agentmeld-m0/src/durable.rs` — the trusted-owner journal (748 lines)

An append-only, fsync'd JSON-lines journal modeling **one run's** lifecycle. Each line is a full `Snapshot` (version 6): monotonic `sequence`, lease `generation`, `mode` (agent / awaiting_approval / pausing / human / resuming / paused / cancelled), one pending ticket with its action digest and scope digest, one pending approval (id, generation, server-time `expires_at_ms`, scope, digest), settled results (ticket + digests + content-hash `ResultRef`), human `resolutions` for uncertain side effects, a scope-digest request ledger (max 256, append-only), and flags (`dispatched`, `uncertain`, `private`, `result_required`).

Commands (`Propose`, `Decide`, `Admit`, `Dispatch`, `Settle`, `Reconcile`, `Takeover`, `HumanReady`, `Resume`, `Observed`, `PrivateBegin/End`, `Disconnect`, `Cancel`) mutate the snapshot through a single `apply()` that enforces, before every mutation, the `require(mode, generation)` precondition: the journal must be in the expected mode, at the expected generation, and not `uncertain`.

Invariants it maintains (beyond 1a):
- **Durability with a poison discipline:** every mutation is appended and fsync'd; any persistence failure poisons the journal permanently ("journal persistence failed; stop worker"). Startup replays and re-validates the *entire* history — sequence increments by exactly 1 per line, generations never decrease, digests are well-formed hex, the request ledger is a proper prefix, resolutions re-execute to the recorded state. Corrupt history refuses to open.
- **Recovery semantics:** on open after a crash, generation bumps, the mode becomes `paused` (unless cancelled), `uncertain` is set iff an action was pending, and any pending approval is dropped. A restarted journal never resumes a run mid-dispatch as if nothing happened.
- **Approval lifecycle with server-time expiry:** `Propose` validates TTL bounds (1–300,000 ms) and computes expiry from the server clock; `Decide` checks id, scope, and digest binding, then records allow/deny/expired; expiry returns the run to `agent` mode rather than hanging.
- **Propose-while-pending is rejected** (`next.pending.is_some() || next.approval.is_some()` → error) — the guard `control.rs` lacks structurally.
- **Uncertain-side-effect reconciliation:** `Reconcile` admits only a reviewed human resolution (`AcceptOutput` with a valid result ref, or `CloseUnknown` with none), re-validated against the exact sequence and generation under review. Never blind replay.
- **Human-takeover lease sequence:** `Takeover` → `pausing` (undispatched work revoked, generation bumped) → `HumanReady` → `human` → `Resume` (generation bumped) → `resuming` → `Observed` (fresh observation digest required) → `agent`. `PrivateBegin/End` suspends observations for credential entry, also fencing the generation.

Trust model, stated in its own header: **trusted-owner**. The journal trusts its caller: `actor` is the string `"agent"` or `"human"`, there is no authentication, and single-writer discipline comes from an OS file lock. It is also **one journal per run** — there is no host, no device, no second run, no policy engine, no scheduler. The 16 MB cap poisons on overflow, and a poisoned journal has no recovery tooling (manual file surgery is the only path). `Reconcile` hardcodes `provider == "codex"` in its validation — provider identity baked into journal logic.

### 1c. `apps/poc/runtime.mjs` + `experiments/codex-live-client.mjs` — the live execution path

`runtime.mjs` (`executeTask`, 145 lines) is the only core that has ever done real work: it creates an isolated Docker network, starts a provider-egress proxy, creates and starts a locked-down worker container (read-only root, dropped capabilities, seccomp, AppArmor, memory/CPU/PID quotas), restores workspace files into it, drives a Codex session over stdio, streams agent messages into the task answer, snapshots changed workspace files into artifacts, and tears everything down. Its control surface is a `control` object (`stop`, `cancelRequested`, `agentContext`) and a `changed()` persistence callback — cancellation checkpoints, binding verification (image digest, store instance, model, policy digest), and fail-closed error handling that never publishes raw provider errors to the UI.

`codex-live-client.mjs` (`LiveClient`, 99 lines) is a bounded, fail-closed JSON-lines RPC client for the `codex app-server` protocol: request/response correlation, server→client callbacks **denied by default** (`-32601`), byte and frame budgets, and a `fail()` that poisons the whole client. It is a *vendor protocol adapter*, not a control plane.

What this core does not do — and this is the point — is anything the other two cores do: there is no approval flow (the PoC passes `approvalPolicy: 'on-request'` to Codex but constructs `LiveClient` **without** an `onRequest` handler, so Codex-native approval callbacks are refused at the protocol boundary with `-32601`; the PoC has never exercised an AgentMeld-side approval), no journaling, no generations, no leases, no idempotent admission (that lives one layer up, in `conversations.mjs`'s `requestKey` handling), no revocation. Task state is mutated on shared in-memory objects and persisted by the server's JSON store.

### 1d. Where they overlap and contradict

- **Two approval state machines.** `control.rs` and `durable.rs` both implement digest-bound propose/decide with generation fencing, but with incompatible scope types (`Scope{workspace, actor, run, …}` vs `ApprovalScope{workspace, worker, thread, turn, request}`), incompatible expiry units (seconds vs milliseconds), and different state models (5 states vs 7 modes). Only one can be authoritative.
- **Durability vs amnesia.** `durable.rs` survives crashes with fenced recovery; `control.rs` forgets everything; the JS path persists task *prose* (answers, artifacts) but no control *decisions*. A run approved in one core is unknown to the others.
- **Trust models disagree.** The journal assumes a trusted owner and a file lock; the PoC assumes a bearer token and loopback binding; `control.rs` assumes nothing and verifies nothing about identity. None of them knows about devices, pairing, or revocation.
- **Scope of "one".** The journal's "one" is one run; the product's "one" is one host owning many runs, conversations, devices, and artifacts.

### 1e. The de facto fourth core: `server.mjs` + `conversations.mjs`

Not named in the issue, but the migration must cover it because it is the control plane the PoC UI actually talks to: bearer-token auth (single random token, `timingSafeEqual`), loopback-only binding with Host/Origin checks, **idempotent admission** (`requestKey` UUID + SHA-256 request digest; duplicate key with same digest returns the original task, mismatched digest → 409), a single-flight task pump, atomic JSON store writes (write-temp + rename), and restart recovery that marks in-flight tasks `interrupted`. Its limits: one shared token (no device identity, no revocation, no expiry), milestone-only events (no sequence, no cursor, no replay), and task state mutated in place. The migration plan (§6) retires it in place, behind the UI.

## 2. Target architecture

One host, one service, one worker, three clients. The transport (Tailscale mesh) is below all of this — the service cannot tell a tailnet client from a loopback client except by source interface, and must not need to.

```
iOS / macOS (SwiftUI) ──┐
local browser (React) ───┼──► versioned API v1 + SSE cursor stream (device sessions)
                         │    loopback + tailnet interface; identical handlers
              ┌──────────▼──────────┐
              │ agentmeld-server    │  Rust. Owns: device auth & sessions,
              │ (Rust, axum)        │  admission, approvals, leases, run
              │                     │  events, artifacts metadata, outbox,
              │  SQLite WAL         │  scheduler. Single writer.
              │  (single writer)    │
              └──────────┬──────────┘
                         │ private worker API (Unix socket, boot-issued
                         │ credential; service-authenticated, never the DB)
              ┌──────────▼──────────┐
              │ agent-worker (Node) │  Owns: container lifecycle, Codex
              │                     │  app-server protocol, workspace
              │                     │  snapshot/restore, artifact bytes.
              │                     │  Holds NO auth/policy state.
              └──────────┬──────────┘
                         │ Docker / VM boundary (unchanged M0 isolation)
              ┌──────────▼──────────┐
              │ execution domain    │  codex app-server over private stdio;
              │                     │  generated code never sees the DB,
              └─────────────────────┘  supervisor socket, or master keys
```

**What lives in Rust and why.** Everything that decides: authenticating devices and deriving actor identity from the session (never from a request field — architecture §6); admitting work idempotently; the approval state machine and its single-transaction consumption; controller leases and generation fencing; the event journal and cursor replay; artifact metadata and the content-hash promotion; the notification-intent outbox; scheduling. These need transactions, concurrency, and long-lived supervision — the reasons the alpha decision and the architecture spec place them in Rust. Authorization logic appears exactly once, in the service; clients (Swift, TypeScript, and the worker) never duplicate it.

**What stays in JS and why.** The worker keeps the qualified execution path: Docker orchestration, the Codex app-server protocol client, workspace snapshot/restore. This is a deliberate deviation from the architecture spec's component table (which lists a Rust worker), justified by the spec's own rule: "Avoid a pure-Rust requirement that leads to reimplementing vendor protocols without evidence of savings." The Codex protocol client is exactly such a vendor protocol, and `runtime.mjs` is the only code with real execution evidence. Rewriting it in Rust would risk the one part that provably works, for no product benefit.

**The seam.** The worker is a *dumb executor with a supervised leash*. Over a private Unix socket, using a boot-issued credential that grants exactly the worker API (not the client API), it may only: append run events, request approval decisions (blocking), fetch inputs, and deliver artifact bytes. It may not admit work, decide approvals, read the database, or mint credentials. If the worker is compromised, the blast radius is bounded by what the service will accept from it — every state transition is still validated service-side. The seam is versioned JSON from day one, so the worker *could* be reimplemented later if measurements ever demand it; no rewrite is planned.

**Trust boundaries, restated.** Clients are untrusted beyond their device session. The worker is trusted-local but untrusted for decisions. Generated code inside the execution domain is untrusted, period — it never sees the DB, the supervisor socket, master keys, or another workspace's files (the M0 isolation boundary, unchanged).

## 3. Unified journal/event model

The M0 journal becomes the host's event log plus relational current state — the event-sourcing split the data-model spec already describes (`run_events` with host-local sequence; `runs`, `approvals`, `delivery_outbox` as current state).

**What carries over from the M0 trust model:**
- **Generation fencing on every mutation.** Every lease, approval, and dispatch carries the generation it was issued under; a stale generation is rejected, not retried. On service restart, generations bump and in-flight work goes to `interrupted`/`reconciling` — the journal's open-time recovery, now across all runs.
- **Digest binding end to end.** The action digest committed at proposal must match at decision, dispatch, and settle. `control.rs`'s `ChangedAction` and the journal's digest checks become columns, not code paths.
- **Server-time expiry.** Expiry is evaluated against the service clock, never a client-supplied timestamp (fixing `control.rs`'s caller-supplied `now`).
- **Propose-while-pending is rejected.** The journal's guard becomes a constraint, not a race.
- **Single-unit consumption.** Approval consumption and execution-ticket issuance happen in one SQLite transaction — the atomicity the journal approximated with a single append, now real.
- **Uncertain side effects reconcile; they never replay.** The `Reconcile`/`Resolution` model survives: an `unknown` receipt requires human review, never blind retry. The hardcoded `provider == "codex"` check does not survive — provider identity moves to the `provider_sessions` row (adapter/version/config binding), and the journal logic stays provider-agnostic.
- **Poison discipline, civilized.** The journal's "persist or die" becomes: a failed transaction fails *that* transaction; the service keeps serving reads; startup recovery reconciles interrupted work; and a dedicated inspection path (not manual file surgery) exists for the operator. All-or-nothing poisoning is retired in favor of per-transaction atomicity plus recovery tooling — answering the audit's recovery-tooling requirement.

**What changes and why:**
- **Per-run journal → per-host journal.** One `run_events` table with a host-local monotonic sequence serves all runs; current state lives in relational rows. The journal's beautiful full-history replay-on-open does not scale to a host journal and is replaced by schema constraints plus targeted invariant tests — a real loss of a nice property, mitigated by keeping the *validation discipline* at the API boundary (strict schemas, `deny_unknown_fields` spirit, hex-digest allowlists).
- **File lock → SQLite single writer.** WAL mode, one service writer, foreign keys on, bounded transactions. This is also what makes the approval-consumption transaction possible.
- **Full-snapshot lines → event rows.** The journal wrote O(state) bytes per command; the service writes one event row per fact. "Snapshots" are the current rows — SQLite *is* the snapshot. Restart needs no replay for state, only cursor-buffer continuity for the event stream.
- **Trusted-owner → authenticated devices.** The journal's caller-trust becomes device sessions with revocation versions. The only remaining trusted-local link is worker↔service over the Unix socket.

**The event envelope** (per architecture §8): schema version, event ID (stable, client-deduped), workspace/run IDs, host-local monotonic sequence, server time, actor (derived from the session), type, bounded payload. Streamed over SSE with `?cursor=`; bounded replay (`WHERE seq > ? ORDER BY seq LIMIT ?`); at-least-once delivery; clients dedupe by event ID and persist the cursor — the exact contract the iOS design's Recommendation 3 requires.

## 4. Contract implementation map

| Non-negotiable (issue #74) | Implemented by | How |
|---|---|---|
| Versioned authenticated API over tailnet = LAN | `agentmeld-server` (axum) | `/api/v1/*` served on loopback and the tailnet interface by identical handlers. Device-session bearer auth on every request; strict Host/Origin validation per interface; never bound to `0.0.0.0`. The PoC's single bearer token becomes per-device revocable sessions. (Whether to add TLS inside the WireGuard mesh is an open question — §8.) |
| Host-issued cursors, bounded replay, at-least-once + event-ID dedupe | `run_events` table + SSE endpoint | `seq` is the cursor (host-local, monotonic); `GET /api/v1/events?cursor=` replays with a bound; every event carries a stable `event_id`; clients dedupe and persist cursors (iOS design Rec. 3). |
| Idempotent admission by request ID | Admission transaction in the service | Client sends `request_key` (UUID) + payload digest. One transaction: existing key + same digest → return the original run receipt; same key + different digest → 409; new key → insert message, run, and admission event, return `202 accepted`. Receipts use the decided states `accepted`/`pending`/`unknown`. This ports `conversations.mjs`'s `admit()` semantics into the transaction the PoC couldn't do. |
| Approval state machine, server-time expiry, single-transaction consumption | `approvals` table + decision endpoint | `pending → approved \| denied \| expired \| superseded`. `POST /api/v1/approvals/{id}/decision` runs one transaction: re-read approval, run, and current grant/policy/lease versions; verify state is `pending`, `server_now < expires_at`, action digest matches, grant/policy/lease versions current, run still `waiting_approval`; then consume and issue the single-use execution ticket. Expiry is swept on server time; a terminal, expired, or superseded approval is unreusable by construction. This is `durable.rs`'s `Decide` + `control.rs`'s `decide()`, with the transaction both wanted. |
| Immediate revocation | `devices`/`sessions` + every request path | Revocation bumps the device's revocation version in one transaction and supersedes its pending approvals. Every request re-validates the session's revocation version (cached revocation list, invalidated on change): revoked → 401 and the re-pair flow; open SSE streams re-check on each flush/heartbeat. "Immediate" is honestly bounded as *on next contact* — the only bound a disconnected device permits. |
| Notification-intent pipeline | `delivery_outbox` table + sender loop | Result bytes are staged, hashed, and promoted; then the result reference **and** the notification intent commit in one transaction (architecture §8). Completion is tracked independently of delivery; a failed or suppressed notification cannot reopen or rerun a task. The M2 APNs wake-hint sender hangs off this table with stable delivery IDs and a grant recheck before send. |
| Controller lease, generation fencing, explicit re-acquire | `computer_leases` table + lease endpoints | One row per computer: holder device + generation. Acquire/takeover bumps the generation in a transaction and records the event; every browser-input command carries its generation and a stale one is rejected (`StaleLease`, as `control.rs` named it). The takeover → pausing → human → resume → resuming → observed → agent sequence is ported from the journal's `Takeover`/`HumanReady`/`Resume`/`Observed` commands, with fresh-observation required before the agent resumes. |
| Honest offline | Service behavior + client contract | The service never invents state: sleep/power/network loss means no response, which clients render as `offline` with the last-sync time (iOS design Rec. 3). Every payload carries server time; every screen's data carries its as-of time; no action enables without fresh revalidation — enforced server-side by the approval and lease transactions, not by client goodwill. |

## 5. File-by-file disposition

**`crates/agentmeld-m0/src/control.rs` — retire.** Its logic is fully subsumed by the journal's model plus transactions. Port the *vocabulary* (`Scope`/`Action`/`State`/`ControlError` naming, the `StaleLease`/`ChangedAction`/`WrongScope` error taxonomy) into the new service crate's domain types; port nothing executable. Its own header describes the production implementation this design specifies.

**`crates/agentmeld-m0/src/durable.rs` — semantic base; retire the format.** Port into `agentmeld-server`: the `require(mode, generation)` precondition discipline, digest binding across propose→decide→dispatch→settle, server-time expiry with bounded TTLs, generation fencing on every mutation, the takeover/human/resume/observed lease sequence (including `PrivateBegin/End` for credential-entry observation suspension), the resolution model for uncertain side effects, and the paranoid input validation. Retire: the JSON-lines snapshot journal, the per-run single-mode model, the file-lock writer, the 16 MB poison cap, the 256-entry scope ledger (superseded by the idempotency-key table), and the hardcoded Codex check in `Reconcile`. The `agentmeld-m0` crate remains as M0 qualification evidence; it stops being anything the product runs.

**`apps/poc/runtime.mjs` — survives as the worker.** Moves to `apps/worker/` (name TBD at implementation). Keeps: Docker orchestration, provider-egress proxy setup, workspace restore/snapshot, the turn-driving loop, binding verification, fail-closed error handling. Loses: all state ownership — `task.status = …` mutations and the `changed()` JSON-store callback become event appends to the service; the `control` object becomes the worker↔service IPC handle. Gains: a real `onRequest` approval path — the worker registers the callback `LiveClient` was built for, calls the service's approval endpoint, and blocks the turn until the service decides (this is where M0 approval semantics finally meet real execution).

**`experiments/codex-live-client.mjs` — survives as the adapter.** Moves with the worker. Keeps the fail-closed framing, byte/frame budgets, and default-deny callbacks. Gains no control-plane knowledge, ever — it stays a vendor protocol client, which is precisely why it is not rewritten in Rust.

**`apps/poc/server.mjs` + `conversations.mjs` — ported, then retired.** The HTTP shape (routes, idempotent admission, single-flight pump, atomic writes) is reimplemented in the Rust service; the static assets keep being served (by the Rust service in packaged builds, per architecture §11) until the React client exists. The JSON store is imported once into SQLite with public IDs preserved (`import_receipts` exists for exactly this). No two canonical stores coexist past Phase 2.

## 6. Phased migration plan

Every phase keeps the PoC browser UI working against the same screens; every phase is independently verifiable and reversible. No flag day.

**Phase 0 — Define the seam (design only, no behavior change).** Formalize the worker↔service protocol as versioned JSON schemas: events the worker may append, decisions it may request, inputs it may fetch, bytes it may deliver — and the service's side: turn start/cancel, approval decisions, lease commands. The PoC's `executeTask(task, changed, control, conversation)` signature is the draft: `changed()` becomes "emit event," `control` becomes "decision handle." *Verified by:* schema review against the contract map (§4). *What could go wrong:* an incomplete seam discovered mid-Phase-1 — mitigated by keeping the seam minimal (four worker verbs) and versioned.

**Phase 1 — Split the PoC along the seam (still Node).** Extract `apps/worker/` (`runtime.mjs`, `codex-live-client.mjs`, workspace snapshot/restore) out of `apps/poc/server.mjs`; the PoC server becomes service-front + worker-supervisor in one process, communicating over the Phase-0 protocol. The UI is untouched. *Verified by:* the existing PoC browser fixtures and the full local journey (upload → report → revise → restart → continue) passing unchanged. *What could go wrong:* behavior drift in the extraction — mitigated by moving code verbatim and changing only the state-call sites.

**Phase 2 — The Rust service replaces the Node front.** New `agentmeld-server` implements device auth, idempotent admission, SQLite state (conversations/messages/runs/events per the data-model schema), and supervises the Node worker over the Phase-0 protocol. One-time `state.json` import with public IDs preserved. Static assets served by Rust. `server.mjs`/`conversations.mjs` retired. *Verified by:* the same journey plus restart recovery (in-flight work reconciles, nothing replays); import fidelity checked by fixture readback. *What could go wrong:* import edge cases (legacy/interrupted conversations) — the data-model migration plan's backup + rollback applies.

**Phase 3 — Control semantics land.** The approval transaction, controller lease with generation fencing, revocation, idempotent admission receipts, and the worker's blocking `onRequest` approval path. The M0 journal's semantics, now in SQLite transactions, wired to real Codex execution. *Verified by:* propose→decide→dispatch→settle round-trips through a live run; stale-approval rejection, double-decision idempotency, and lease-fencing tests. *What could go wrong:* Codex-native approval timing vs the blocking worker call — bounded by the same TTLs the journal already qualifies.

**Phase 4 — Harden the event contracts.** SSE cursor stream with bounded replay, client cursor persistence interop, the notification-intent outbox (push-ready, no APNs sender — that's M2), honest-offline behavior under sleep/network loss. *Verified by:* the server-side pieces of the iOS reconnect contract (cursor replay, no duplicate events, as-of times) demonstrated against the browser client; reconnect-storm tests. *What could go wrong:* replay-buffer sizing under pathological disconnects — bounded by the documented limit, with the client contract (re-fetch on gap overflow) already specified.

## 7. Explicit non-goals

- **Multi-host failover and automatic task migration.** A disconnected host never triggers execution elsewhere — separate future capability per the alpha decision.
- **A distributed database.** One SQLite writer per host; no distributed SQLite, no second dialect at alpha.
- **Rewriting the Codex protocol client in Rust.** The adapter stays JS behind the versioned seam.
- **A second model loop in the service.** Codex owns its turn loop; the service owns admission, approvals, and lifecycle records (architecture §7).
- **Changing the PoC UI framework.** The browser UI keeps working as-is through every phase; the React client is a separate track.
- **General remote web access, messaging transports, collaboration, hosted multi-tenancy.** All post-alpha; none of them get a second control plane.

## 8. Decisions (locked in 2026-09-18)

1. **Journal storage format and location. DECIDED:** SQLite WAL at a host-owned path (default `~/.agentmeld/`, artifacts content-addressed beneath it), per the data-model spec — the "journal" is the `run_events` table, the "snapshot" is the current rows. Backup via the SQLite backup API plus a content-hash manifest (architecture §7).
2. **Snapshot cadence / event retention. DECIDED:** no materialized snapshots (SQLite *is* the snapshot) and no time-based event deletion in alpha; growth bounded by per-run event caps and an operator-visible size budget. Deletion/expiry policy is an explicit later decision, not a silent default.
3. **Worker language, permanently. DECIDED:** the Node worker is the long-term shape for the Codex adapter, not a stepping stone — the versioned seam permits replacement only if measurements ever demand it. The architecture spec's component table should be updated to match this decision when the implementation begins.
4. **How much of the trusted-owner model carries forward. DECIDED:** none at the client boundary (devices authenticate; the service derives identity from sessions), with exactly one trusted-local link remaining — worker↔service over the Unix socket with a boot-issued credential.
5. **API versioning. DECIDED:** `/api/v1` from the first Rust-served endpoint; the PoC's unversioned paths are internal-only until then.
6. **TLS inside the Tailscale mesh. DECIDED:** defer — device auth is the boundary, TLS-inside-mesh is hardening for later. Explicitly deferred, not overlooked.

## 9. What was verified and what was not

**Verified by reading (2026-09-18):** the complete source of all three cores — `control.rs` (178 lines), `durable.rs` (748 lines), `runtime.mjs` (145), `codex-live-client.mjs` (99) — plus `server.mjs` (120) and `conversations.mjs` (admission idempotency, atomic store, restart marking); the architecture, data-model, and roadmap specs; the three decision docs; the iOS background/push design; issue #74's contract list; and the audit's four unification requirements (propose-while-pending guard, hardcoded Codex provider check, all-or-nothing poisoning, Node-path migration) — each addressed above.

**Not verified:** the Rust sources were **not compiled on this VM** (no Rust toolchain installed) — all claims about their behavior come from full reading, not execution. The PoC was not run; claims about runtime behavior (e.g. Codex approval callbacks being refused with `-32601`, the single-flight pump, interruption marking on restart) are from code reading. The design ports the M0 journal's *semantics*, never its bytes; no journal-format compatibility is claimed or needed.
