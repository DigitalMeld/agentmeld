# M0 durable reviewed recovery

Date: 2026-09-18. Scope: an explicit trusted-host disposition for an interrupted, archive-enabled Codex action after fresh worker absence. This qualifies fixture recovery, not authenticated human review or a production task service.

## Three implementation cycles

1. Rust journal format 6 adds a bounded append-only review history and one atomic disposition transition. Normal settlement history is unchanged.
2. The host review adapter prepares an inspectable decision, rechecks evidence at commit, and supports separately attributed output readback. Recovery reports distinguish normal settlement, reviewed output and closed unknown outcomes.
3. Crash, replay, tampered-history and Linux tests qualify the new path; the real cancellation probe verifies review readback after another supervisor replacement.

## Decisions and durable state

| Decision | Required evidence | Durable result |
| --- | --- | --- |
| `accept_output` | Matching archived bytes, exact action/scope/ticket, and fresh absence of the bound worker | An accepted-output review with an archive receipt; no normal settlement entry |
| `close_unknown` | Exact pending action/scope/ticket and fresh absence of the bound worker | A closed-unknown review with no result receipt; no claim that the action succeeded, failed or had no effects |

Both require a dispatched, archive-enabled action and a paused or cancelled controller. Unscoped browser actions and actions with no recorded dispatch are excluded. The chosen review includes its own random ID, reviewer label, reviewed journal sequence/generation, exact action and full scope. Commit compares sequence/generation again in Rust, checks the pending binding, and rejects reused review IDs. Active controllers, absent worker evidence, invalid references and capacity exhaustion fail without changing the journal.

One synced snapshot appends the review, clears the pending ticket and uncertainty, increments generation, and clears observation. A paused controller stays paused; a cancelled controller stays cancelled. The original request remains in the deduplication ledger. There is no tool execution, retry, worker start, automatic resume or normal settlement during this transition. Any later work still needs the existing controller/observation/approval flow, and the original logical request cannot be replayed.

History retains at most 16 dispositions, with no eviction or repair. The existing 64-result, 256-request and 16-MiB journal limits remain. Replay validates the entire expected disposition snapshot against its predecessor, so a review cannot remove history, rewrite an earlier decision, append without a matching pending action, or silently alter cancellation, generation, requests or normal results. These are integrity checks under trusted storage ownership, not protection against a malicious owner rewriting the entire journal.

## Host review interface

`prepareRecoveryReview(authority, archive, worker, { request, action, outcome, reviewer })` returns a plain plan for explicit host-side review. It checks that the displayed action matches the journal, the worker is absent, and accepted output is available. It does not commit anything. A close-unknown plan omits any supplied receipt so it cannot imply accepted output.

`commitRecoveryReview(authority, archive, worker, reviewedPlan)` is the separate mutation. The trusted caller must invoke it only after its review decision. It validates the plan, reads archive/runtime evidence again, rejects a changed sequence/generation, then sends the bounded reconciliation command. A plan is not an authentication credential or a cryptographic signature. The reviewer string is an operator-supplied label, not proof of account identity. Never expose these interfaces to a model, worker or provider callback.

Rust validates the transition and reference shape. It trusts the host assertion of worker absence and archive verification, just as ordinary settlement trusts the host to save its result first. The original worker binding and runtime transport must be trusted. Absence does not resolve external effects. A lost commit acknowledgement must be inspected through durable history; there is no automatic commit retry.

`ResultArchive.readReviewed(authority, scope)` returns `{ record, review }` with verified output and its review ID, reviewer label and outcome. It never treats closed-unknown work as output. `readSettled` and the existing result HTTP endpoint continue to expose only ordinary settlements. A reviewed output therefore cannot silently appear as normal completion. Production reviewed-output UI/HTTP authorization remains future work.

Recovery report version 3 adds `actionDigest` and `reviewRecorded`, plus statuses `reviewed_output_verified`, `reviewed_output_unavailable` and `closed_unknown`. `settlementRecorded` stays false for reviewed dispositions. Missing/corrupt output preserves the recorded review and produces an unavailable status, without rerunning anything. The existing [assessment CLI](recovery-assessment.md#local-command) can inspect these records, but has no commit option.

## Format compatibility

New journals use format 6. Existing format-5 and older journals are preserved and rejected; no automatic migration or deletion occurs. Keep retained fixture evidence with its corresponding older binary if separate inspection is needed. Archive envelopes remain version 1. Refresh the host binary and local fixture image together when running current probes.

## Verification

The default suite passes 147 tests (18 Rust, 127 Node, two Python), formatting, Clippy, build and documentation checks. Fifteen new subprocess cases cover accepted and unknown dispositions, SIGKILL before/after commit, lost acknowledgement, action/scope binding, stale/racing reviews, archive/runtime changes, duplicate IDs, tampered history, format-5 rejection and review capacity. All 15 also pass against the Linux ARM64 binary with Docker-default seccomp.

```sh
sh scripts/check-local.sh
python3 scripts/probe-container.py --context YOUR_CONTEXT --probe reconciliation --seccomp-profile docker-default --workspace review-linux
node scripts/probe-cancellation.mjs --context YOUR_CONTEXT
```

Local image `sha256:ff58474c923e18c8a5ec8604e0e2193c8528888db43af7cf2b2ed0ba79292077` passed seven selected container probes: 15 reconciliation, 16 recovery and 13 archive/index Linux tests; native startup/browser; separated supervisor; nine Codex callback scenarios; and extended cancellation/review recovery. The cancellation probe verifies child/grandchild heartbeat cessation, fresh worker absence, saved unsettled output, an explicit fixture review, and review readback after another Rust restart while cancellation persists. Its successful report is retained under ignored `.local/m0/control/4037ef8b-cc32-4771-b3b4-37a490215c3a/`; Linux evidence is under `.local/m0/evidence/`.

The first extended cancellation run found a variable-shadowing error in probe wiring. It was corrected and that probe rerun successfully. No personal files, provider credentials, live inference or Messages access were involved. No image was published. Power-loss durability and injected filesystem failures remain unqualified.

## Next action

Connect review decisions to an authenticated owner and durable task/event state, and qualify reconstruction of worker ownership after losing the whole host process. Retained in-memory worker bindings currently survive only replacement of the Rust subprocess. M0 live-provider, designated iMessage identity and license gates remain open; this batch does not start M1 UI or production deployment.
