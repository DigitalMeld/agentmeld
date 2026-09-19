# Progress 2026-09-19 — Phase 4 event stream + tool_steps implemented (issue #90)

Phase 4 (SSE event stream, `tool_steps` projection, worker-seam/2) is implemented
in the Rust service on branch `impl/2026-09-19-phase4-event-stream`, per
`docs/design/event-contracts.md`. The two 501 stubs Phase 2 left behind now answer:
`GET /api/v1/events` serves the host-local SSE stream, and the worker seam speaks
v2 with `tool.call_started` / `tool.call_finished` journaling into the queryable
`tool_steps` projection.

## What was built

- **Migration v5** (`crates/agentmeld-server/src/migrations/v5.sql`):
  `run_events.actor` (nullable; who caused the fact — `worker`, `device:<id>`, or
  `service`) and the `tool_steps` table (call key, parent linkage, service ordinal,
  tool name/title, approval link, six-state lifecycle, 64 KiB inline result cap,
  blob reference, timestamps).
- **New module** `src/events.rs`: the SSE producer — version-1 envelope (stable
  event id, sequence, type, workspace/conversation/run ids, timestamp, actor,
  payload), `Last-Event-ID` precedence over `?cursor=`, no-cursor replay of the
  latest 200 streamable rows, batch cap 1000, cursor-lag 410 (`cursor_too_old`
  with `current_seq`), `stream.hello` first frame, 15-second `:ping` heartbeat,
  heartbeat-time auth recheck, bounded queue (256) with `stream.resync_required`
  on overflow. Excludes diagnostic rows, `approval.dispatched` (plaintext ticket),
  and `provider_session.bound` by kind.
- **Tool-step projection** (`src/db.rs`): `apply_tool_event_locked`,
  `start_tool_step_locked` (idempotent on duplicate `call_key`, no ordinal gap;
  gated starts require `approved` + consumed ticket), `finish_tool_step_locked`
  (unknown `call_key` fails closed; first terminal finish wins), and
  service-written `denied`/`cancelled` steps for approval denial, expiry,
  revocation, takeover, restart recovery, and device revocation.
- **Lease stream projection**: run-affecting lease transitions
  (takeover, ack, private begin/end, resume, revoke) journal a stream row
  transactionally in the same commit. Idle-host auto-release stays
  lease-journal-only — clients use `GET /lease`.
- **worker-seam/2** (`src/seam.rs`, `src/supervisor.rs`): `negotiate_protocol`
  (v1→v1, v2→v2, future→negotiate-down-to-max, non-seam→reject), hello parsing
  separated from established-session parsing, exact post-handshake protocol
  pinning (a v1 frame in a v2 session is rejected and vice versa), duplicate
  hello rejection. The supervisor stores the negotiated protocol per turn and
  gates tool events on v2.

## Verification

- 62 Rust tests green (`cargo test --locked -p agentmeld-server`), including:
  - 10 SSE stream tests (`tests/event_stream.rs`): cursors, 410, envelope,
    hello, latest-200 replay, live delivery, heartbeat revocation, overflow
    resync, kind exclusions, ticket-plaintext scan, both routes.
  - 9 tool-step tests (`tests/tool_steps.rs`): start/finish, idempotency,
    unknown-finish rollback, first-terminal-wins, nesting, v1 rejection,
    approval gate (pending/unconsumed/consumed), denied projection, 64 KiB cap.
  - 7 seam negotiation tests (`tests/seam_negotiation.rs`): v1/v2 pinning,
    future negotiate-down, exact post-hello frame pinning.
  - 1 v2 stub-worker lifecycle (`tests/supervisor_seam.rs`): a Node worker
    negotiates `worker-seam/2` over the Unix socket, emits
    `tool.call_started`/`tool.call_finished`, and the completed step lands in
    `tool_steps`.
- `cargo fmt --check`, `cargo clippy -- -D warnings`, `scripts/check-docs.py`,
  `scripts/check-local.sh` all pass.

## Open questions and follow-ups

- **Callback-unproven (carried from Phase 3):** the approval flow is semantically
  complete but unproven against real Codex callbacks; the Apple-side test is
  still the gate. Phase 4's worker-emitted tool events are likewise proven only
  against the deterministic stub worker, not the real Codex worker.
- **SSE hardening:** the 45-second stalled-client threshold, guaranteed resync
  delivery under a full queue, and avoiding raw bearer retention across heartbeats
  are documented follow-ups, not implemented.
- **`delivery_outbox`** remains deferred per the owner's decision; SSE is the
  live path.

## Files changed

- `crates/agentmeld-server/src/migrations/v5.sql` (new), `src/events.rs` (new),
  `src/db.rs` (tool_steps projection, lease stream rows, `actor`, public
  `ToolStepRow`/`tool_steps_for_run`), `src/seam.rs` (v2 negotiation),
  `src/supervisor.rs` (per-turn protocol), `src/api.rs` (SSE routes),
  `src/lib.rs` (module export).
- Tests: `tests/event_stream.rs`, `tests/tool_steps.rs`,
  `tests/seam_negotiation.rs` (new); `tests/supervisor_seam.rs` (v2 worker).
- Docs: `docs/specs/data/core-schema.sql` (tool_steps/approvals state sets),
  `docs/specs/worker-service-seam.md` (§11 worker-seam/2 addendum), this report.
