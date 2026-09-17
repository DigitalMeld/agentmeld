# M0 durable Rust control authority

Date: 2026-09-17. Scope: trusted fixture ownership and recovery, exercised both through local subprocess tests and the isolated browser experiment. This is not yet a production supervisor or a boundary against malicious agent code.

## Implemented

The Rust `supervise JOURNAL` command holds an exclusive OS file lock for its process lifetime. It reads a bounded append-only journal, validates sequential records, and acknowledges each change only after writing and syncing that record. Startup also syncs the containing directory. It refuses incomplete final records, malformed history, oversized journals and concurrent owners.

Control state includes a monotonically increasing generation, mode, pending action ticket, uncertainty flag and last accepted observation digest. The worker must obtain a ticket before submitting agent or human browser input, and settle that ticket only after the action returns successfully. Takeover fences new/queued agent dispatch before waiting for admitted work. Human control is acknowledged only after pending input settles. Resume captures an observation in the browser worker and commits its digest in Rust before admitting new agent input.

Rust owns those transitions; `rust-browser-control.mjs` owns the serialized browser I/O and bounded stdio transport. The earlier in-memory Node controller remains a reference fixture for race tests, but the container browser probe now uses the Rust authority. The approval-only `RunControl` fixture has not been merged into the durable controller; durable approvals remain separate work.

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

## Trust and packaging limits

For this synthetic experiment, journal files live in the disposable fixture workspace and are accessible to its trusted worker. They are not protected from an agent running under the same account. Production must keep control storage outside the agent mount and expose only an authenticated, scoped worker protocol. A caller-supplied actor string is not authentication; the stdio bridge is currently a trusted caller. The observation digest records what that caller reported, not independent proof of screenshot freshness.

Filesystem durability and locks were exercised on the local macOS filesystem and the Linux ARM64 VM's mounted fixture workspace. Network filesystems, power-loss behavior and cross-host ownership are unqualified. Path checks assume an operator-owned directory and do not prevent a malicious directory owner from replacing files. Journal integrity is structural, not a cryptographic tamper guarantee.

The builder image is pinned to Linux ARM64 Rust 1.95.0. Multi-architecture packaging remains unqualified. The final runtime contains the compiled executable, not the Rust build toolchain. Source dependencies remain the existing locked Rust packages; no new library or production service was added.

Next: separate supervisor storage from agent execution, bind admission to actual tool payloads and worker identity, then qualify a native provider's approval/cancellation path through that boundary. Keep restart and uncertainty checks as regression gates.
