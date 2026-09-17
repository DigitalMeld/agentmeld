# M0 durable Rust control authority

Date: 2026-09-17. Scope: trusted fixture ownership and recovery, exercised both through local subprocess tests and the isolated browser experiment. This is not yet a production supervisor. The newer [separated probe](protected-supervisor.md) keeps journal ownership outside the agent container.

## Implemented

The Rust `supervise JOURNAL` command holds an exclusive OS file lock for its process lifetime. It reads a bounded append-only journal, validates sequential records, and acknowledges each change only after writing and syncing that record. Startup also syncs the containing directory. It refuses incomplete final records, malformed history, oversized journals and concurrent owners. Recovery checks digest syntax, known decision values, approval scope bounds and membership in the durable request ledger. Later snapshots cannot clear cancellation or an uncertainty flag. These are structural checks, not authentication of journal contents.

Control state includes a monotonically increasing generation, mode, pending action ticket and payload digest, one-time dispatch status, uncertainty flag and last accepted observation digest. The worker must obtain a ticket before submitting agent or human browser input, and settle that ticket only after the action returns successfully. Takeover fences new/queued agent dispatch before waiting for admitted work. Human control is acknowledged only after pending input settles. Resume captures an observation in the browser worker and commits its digest in Rust before admitting new agent input.

Rust owns those transitions; `rust-browser-control.mjs` owns the serialized browser I/O and bounded stdio transport. The earlier in-memory Node controller remains a reference fixture for race tests, but the container browser probe now uses the Rust authority. The older approval-only `RunControl` remains a reference fixture. Journal format 4 persists scoped proposals, decisions, request identities and private-screen state; see [native approvals](native-tools.md) for binding, expiry and recovery semantics.

## Recovery semantics

- Restart increments the generation and leaves the controller paused. Cancellation remains terminal.
- An admitted action without a recorded settlement becomes uncertain after restart. Its ticket remains visible, and neither settlement replay nor takeover can clear it automatically.
- An action exception leaves its ticket pending and pauses the worker. Further actions cannot be admitted. The system does not infer failure means no side effect occurred.
- A truncated or corrupt journal prevents startup. There is deliberately no automatic truncation, replay, reset or deletion command.
- Loss of the supervisor rejects outstanding bridge requests and prevents new dispatch. In the container probe, unexpected supervisor loss also closes the browser. Clean authority shutdown is distinguished from failure.
- The Rust process does not prove that external effects stopped. Generation checks protect only cooperating dispatch paths; production cancellation still needs worker ownership, process-tree termination and result reconciliation.

The journal is capped at 16 MiB, stdio commands at 64 KiB, and pending bridge/browser queues at 32 operations. Bridge startup and command responses have five-second deadlines. This small experiment has no compaction, database migrations or retention workflow.

## Evidence

Five new subprocess tests run the actual compiled Rust executable: normal takeover/resume and process replacement, exclusive ownership plus SIGKILL during an admitted action, truncated-journal rejection, queued input during active takeover, and cancellation during fresh observation followed by restart.

The real Chromium probe uses the Linux ARM64 Rust executable built in the pinned multi-stage image. It repeats the authenticated viewer sequence, replaces the authority process, reads back paused state with a higher generation, and rejects the old generation. No inference, provider credentials or messaging account is involved.

### Crash-boundary qualification

The local suite now includes 16 additional subprocess recovery tests. Six kill the actual Rust supervisor with SIGKILL immediately after an acknowledged proposal, denial, approval, dispatch, settlement or cancellation. Each journal is reopened twice: generations advance, outstanding approvals disappear, pending tickets remain uncertain, stale dispatch is rejected and cancellation stays terminal. An approved but undispatched action is conservatively uncertain after process loss too.

A separate recovery path requires takeover and a fresh observation before new proposals, rejects the old request identity, and accepts a new one. Eight malformed-history cases cover invalid pending/observation/approval digests, invalid decisions, empty or unrecorded approval scopes, and attempts to clear cancellation or uncertainty. A torn-record test cuts the final record at four byte offsets. Every rejected open leaves the supplied evidence byte-for-byte unchanged.

Reproduce with `sh scripts/check-local.sh`, or after a Rust build, `node --test experiments/recovery-boundaries.test.mjs`. Fixtures use temporary directories owned by the test and remove only those directories. The default host checks access no provider, container, Messages account or user workspace.

These tests run on the host macOS filesystem and now also pass against the packaged Linux ARM64 binary in the offline container. Container test journals use the bounded `/tmp` tmpfs. They cover process loss after acknowledged writes and supplied torn records, not injected filesystem write failures, power loss, loss of a complete trailing record, external effect reconciliation or recovery of a live worker. The subsequent Linux requalification rebuilt the image and passed all 16 recovery cases; see [current runtime evidence](worker-lifecycle.md#linux-runtime-requalification).

## Trust and packaging limits

In the original all-in-one synthetic experiment, journal files live in the disposable fixture workspace and are accessible to its trusted worker. The newer separated probe stores them on the host, outside all container mounts. They are not protected from an agent running under the same account. Production must keep control storage outside the agent mount and expose only an authenticated, scoped worker protocol. A caller-supplied actor string is not authentication; the stdio bridge is currently a trusted caller. The observation digest records what that caller reported, not independent proof of screenshot freshness.

Filesystem durability and locks were exercised on the local macOS filesystem and the Linux ARM64 VM's mounted fixture workspace. Network filesystems, power-loss behavior and cross-host ownership are unqualified. Path checks assume an operator-owned directory and do not prevent a malicious directory owner from replacing files. Journal integrity is structural, not a cryptographic tamper guarantee.

The builder image is pinned to Linux ARM64 Rust 1.95.0. Multi-architecture packaging remains unqualified. The final runtime contains the compiled executable, not the Rust build toolchain. Source dependencies remain the existing locked Rust packages; no new library or production service was added.

Next: extend the qualified Codex dynamic-tool fixture to authenticated worker identity and live provider approval/cancellation. Keep restart and uncertainty checks as regression gates.
