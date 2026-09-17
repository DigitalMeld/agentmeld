# M0 recovery evidence assessment

Date: 2026-09-17. Scope: trusted host assessment of one scoped native-tool action. This is the evidence-gathering step before explicit reconciliation, not permission to retry, resume or mark an uncertain action complete.

## What the report establishes

`assessRecovery(authority, archive, request)` reads a paused or cancelled supervisor and checks one full scope and ticket. It issues only state queries. It cannot execute a tool, change journal state, stop a worker or delete evidence. The caller supplies the workspace, worker, thread, turn and request identifiers and the original ticket. An optional saved archive receipt lets it assess output that was saved before a crash interrupted settlement.

| Status | Evidence | Consequence |
| --- | --- | --- |
| `settled_verified` | Durable settlement and matching verified archive bytes | Completion was recorded; normal scoped retrieval can read the result |
| `settled_output_unavailable` | Durable settlement exists but bytes cannot be verified | Preserve settlement; investigate missing/corrupt/unavailable storage without rerunning the tool |
| `pending_output_verified` | Dispatched action and supplied output match scope, ticket and action digest | Returned output is evidence only; no settlement is created |
| `pending_output_unavailable` | Supplied receipt cannot be verified against the dispatched action | Retain uncertainty and preserve evidence |
| `pending_outcome_unknown` | Dispatch exists without a supplied result receipt | No conclusion about returned output or external effects |
| `pending_not_dispatched` | Pending action has no recorded dispatch | Report the journal fact; do not grant retry or resume |

Settled actions use their journal receipt, ignoring a supplied replacement. Pending evidence must pass the archive's byte/hash/schema/tool-result checks and match the exact persisted action, scope and ticket. Reports contain status, sequence/generation, controller mode, ticket and verified receipt, but no tool arguments, output contents, archive paths or subprocess errors. All reports explicitly leave retry and resume unauthorized. A dispatched pending action requires worker reconciliation; that flag is not proof that a settled action's worker has stopped.

The assessor checks journal sequence and generation again after reading storage and rejects a changed state. Reports are point-in-time evidence, not reusable authorization. Scope and request inputs are copied before asynchronous operations. An unavailable archive does not imply the original action failed or never ran.

## Local command

Build the host binary with `cargo build --locked`. Create a request JSON file in operator-owned storage using the actual scope and ticket from the failed action:

```json
{
  "scope": {
    "workspace": "fixture-workspace",
    "worker": "fixture-worker",
    "thread": "fixture-thread",
    "turn": "fixture-turn",
    "request": "fixture-call"
  },
  "ticket": 4
}
```

For a saved but unsettled output, add `receipt` containing the exact `sha256` and `bytes` returned by the archive. No receipt scan or automatic candidate selection occurs. Without that receipt, the assessment cannot discover orphaned bytes.

```sh
node scripts/review-recovery.mjs --recover --journal PATH_TO_EXISTING_JOURNAL --archive PATH_TO_EXISTING_ARCHIVE --request PATH_TO_REQUEST_JSON
```

**The command is not a read-only journal opener.** The required `--recover` flag acknowledges that it acquires the existing journal exclusively and appends the normal recovery snapshot, increasing generation and pausing execution; cancelled journals remain cancelled. It refuses a journal owned by another supervisor. Use the adapter directly with an already paused supervisor to assess without a recovery write. A failed assessment after opening may still have appended that recovery snapshot.

The command refuses missing, empty or non-regular journals and missing/non-directory archives. It validates the request before opening the journal, rejects request symlinks and special files, and bounds request input to 64 KiB with strict UTF-8 decoding. Normal archive locking still applies. Parent directories remain trusted; this does not defend against a malicious storage owner racing file replacement.

A successful command exits zero with a JSON report, including unresolved/unavailable statuses. Consumers must inspect `status` and `settlementRecorded`; exit zero does not mean the task completed. Invalid input, ownership conflicts and changed/mismatched state exit nonzero with a generic diagnostic. There is no model, Docker, messaging or remote-service call.

## Verification and remaining work

The local suite passes 127 tests (18 Rust, 107 Node, two Python), formatting, Clippy, build and documentation checks. Eleven recovery tests cover actual Rust subprocesses, SIGKILL, settled/uncertain/missing/corrupt output, action/ticket/all-scope mismatches, cancelled and active controllers, concurrent state changes, CLI ownership and recovery writes, input bounds and FIFO/symlink rejection. A separate archive regression test verifies scope preservation across an asynchronous journal lookup.

The Rust implementation, journal format 5 and archive envelope version 1 are unchanged. Container probes were not rerun for this host-only batch; earlier Linux/native evidence remains in the linked [archive](result-archive.md) and [result access](result-access.md) reports. No live inference, personal data or iMessage access was used.

Next: qualify worker termination/reconciliation evidence, design a durable reviewed disposition for uncertain actions, then connect recovery to owner/task state. This batch deliberately leaves pending tickets and uncertainty intact. No reconciliation commit, task/event service, account authentication or production recovery workflow is implemented.
