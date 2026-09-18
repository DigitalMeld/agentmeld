# M0 live approval and cancellation qualification

Verified 2026-09-18 with Codex 0.154.0, GPT-5.5 and the owner-authorized ChatGPT subscription. Image: `sha256:d3eff9a0d415b5f47293139997a8edc37d80805aae52bf7c815a8e4d4074ad01`. This is explicit qualification with synthetic data, not a delivered approval UI.

## Verified behavior

| Case | Evidence |
| --- | --- |
| Allow | The live model requests `fixture_sum` with exactly 2 and 3. The existing Rust authority records the scoped proposal, issues a single-use dispatch ticket, and settles the result. The fixture executes exactly once. A second decision is rejected. |
| Deny | The live request enters the same broker; a fixed test denial returns a failed tool result. Execution count stays zero, approval state clears, and the native turn completes without retry. |
| Cancel pending approval | Rust cancellation revokes the pending approval before native `turn/interrupt`. A stale allow attempt fails, the tool never executes, and the native turn reports interrupted. |
| Interrupt running command | A native shell tool starts a bounded Node process and its child. Both write separate heartbeat files. The probe waits for child readiness, identifies matching processes through `/proc`, then interrupts the native turn. Both files stop changing and all tracked processes are absent or zombies, not live. |

The arithmetic decision values are fixed test inputs supplied by the trusted qualification runner. They are not model-selected approvals. The broker validates native thread/turn/call identity and exact arguments. The supervisor journal stays in a unique file under the tool-denied dedicated home. No administrative handle is exposed as an agent tool.

The running-command case is distinct from the mediated dynamic-tool cases: the native harness owns its local workspace command. Interruption verifies a running process tree, not only an acknowledgement or interrupted status. The fixture has a 60-second lifetime backstop; checks occur shortly after readiness, before that natural exit.

## Reproduction and limits

```sh
node scripts/probe-provider-egress.mjs --context colima-agentmeld-m0 --control
```

Requires the authorized dedicated store and loaded named policies in the dedicated VM. Uses the same isolated internal network and restricted provider proxy as the subscription probes. No API-key fallback, host-home mount, native escalation grant, external message or production resource is involved. The driver removes its disposable containers/network and retains the authorized credential store and synthetic supervisor journals.

Sanitized report: `.local/m0/live-control.log`, with per-run immutable-image metadata in `.local/m0/egress/`. All four case booleans and `qualified` are true. Reports contain no raw model/account output or credentials.

The protocol client defaults to denying server requests. Explicit callback handlers are bounded, reject reused transport IDs, defer the response until the handler finishes, and terminate on handler failure. Four new offline tests cover asynchronous decisions, duplicate callbacks, handler failure and preventing queued work after protocol failure. All 184 default local tests plus formatting, lint, build and documentation checks pass.

This closes the tested live mediated allow/deny, pending-approval cancellation and running parent/child interruption gaps. It does not establish owner-facing approval presentation, remote client approval delivery, arbitrary daemon detachment, whole-machine recovery, or the separate failed-command UI event gap. Remaining M0 work stays in the [exit checklist](exit-checklist.md).
