# M0 completion audit and capability matrix

**Priority change, 2026-09-18:** the owner directed delivery of a useful POC instead of further patch qualification. The scoped patch and remaining qualification work are deferred; they do not gate the [working local POC](../poc.md). Historical evidence below is retained, not a mandate to resume the patch.

Updated: 2026-09-18. M0 is not complete. This audit maps evidence to the seven requirements in the [roadmap](../specs/roadmap.md#m0-prove-codex-subscription-execution-and-its-isolation-boundary); it does not replace the [exit checklist](exit-checklist.md) or convert experiments into product claims.

## Requirement coverage

| Roadmap requirement | Evidence and result | Remaining qualification or limit |
| --- | --- | --- |
| Pinned runtime, subscription authentication, licenses | Codex 0.154.0, pinned base images and [installed inventory](distribution-inventory.md); owner-authorized narrow native auth import, managed device challenge/cancel and live subscription pass in [auth report](codex-subscription.md) | [Native lifecycle](auth-lifecycle.md) now passes with synthetic tokens. Real-provider refresh/logout remains unqualified; do not revoke the imported owner session to test it. Embedded native notices and source-license selection remain release obligations. |
| Minimal adapter flow | Streamed answer, bounded dynamic call, allow/deny, pending/running interruption, native commands and process-replacement continuation pass in [execution](codex-subscription.md) and [control](live-control.md) reports. Missing account and unavailable model now reject before turns. | Failed native command exit 23 reaches the model and persisted native history, but the corresponding command-result UI event is absent. Keep the diagnostic and explicit limitation; no production event-repair shim is qualified. |
| Process, child-tool and file boundaries | [Credential canaries](codex-credential-boundary.md), [separate browser profile](browser-isolation.md), [protected supervisor](protected-supervisor.md), and [worker termination](worker-lifecycle.md) exercise the pinned sandbox boundary. | These are scoped canary and lifecycle tests, not kernel-escape certification. [Authenticated browser dispatch](live-browser.md) now passes through the protected controller. |
| Egress and credential approach | [Provider gateway](provider-egress.md) and [dedicated native credential store](codex-auth-store.md) pass; real native TLS/auth/inference use the restricted path. No host-execution fallback. | The native harness can access its own protected credentials; its tools cannot. No general credential broker, arbitrary website egress or owner browser-login transport is claimed. |
| Browser, viewer, takeover, fresh resume | Sandboxed Chromium and [viewer fixture](viewer-takeover.md) pass with Rust generation fencing, private-screen suppression and fresh observation before dispatch resumes. Playwright remains the pinned browser component; narrow screenshot HTTP transport is local experimental code. | [Live integration](live-browser.md) now passes. No final production video/remote-viewer component is selected; keyboard, clipboard and owner credential entry remain unqualified. |
| Initial resource measurements | [150-second offline baseline](resource-baseline.md): 51 native/browser cycles, zero OOM kills, peak charged memory 212.04 MiB. [64 MiB workspace](workspace-disk-limit.md) proves disk-full recovery and authenticated replacement-worker continuation. | Tested envelope is a 2-vCPU/4-GiB dedicated VM and bounded workers, not a published minimum-host recommendation. [Controlled VM restart](workspace-disk-limit.md#controlled-vm-restart) now passes with explicit reattachment. Live workload sizing, longer soaks and sudden power loss remain unqualified. |
| Exact role/model/protocol | Execution qualification uses native app-server 0.154.0 and explicitly selects GPT-5.5. Native account/catalog checks and thread start/resume model checks now pass. | No independently selected planner, browser-model or subagent role has been qualified. Do not infer support for other models, code-mode configurations or later protocols. |

## Current Codex capability matrix

| Capability | Evidence level | Result |
| --- | --- | --- |
| Subscription account and model availability | Real native account/catalog; no inference in negative cases | Pass, exact GPT-5.5 catalog admission; no API-key fallback |
| Streaming and command success | Live GPT-5.5 | Pass |
| Command failure | Live GPT-5.5 plus offline lifecycle reproduction | Model/history result passes; UI event missing |
| Dynamic tool allow/deny | Live GPT-5.5 with trusted fixture reviewer and Rust authority | Pass; no owner approval UI claim |
| Pending approval and running process interruption | Live GPT-5.5; native parent/child process readback | Pass |
| Conversation after process/worker replacement | Live GPT-5.5, protected native history and bounded persistent workspace | Pass across controlled dedicated-VM restart with explicit reattachment; not power-loss recovery |
| Browser takeover and fresh resume | Live GPT-5.5 callbacks, real Chromium, Rust authority, synthetic page | Pass; trusted HTTP fixture drives human input |
| Host/profile/credential boundaries | Native tools and separate-container canaries | Pass for recorded paths; not universal escape proof |

## Model admission verification

Image: `sha256:6859d1f90afaa16d963b865da526d24fa60f213092d2fccf7c0b4ce2b74154f6`. Codex 0.154.0, GPT-5.5, existing subscription store; no credentials are included in reports.

The shared live qualification client checks `account/read` for native ChatGPT authentication and checks the first bounded `model/list` page (up to 100 entries) for an exact configured model. A missing entry rejects admission; this is not a claim that the model is globally unavailable. Thread start/resume must return the requested model. A native `model/rerouted` notification terminates the probe. These checks verify native declarations, not the provider's internal implementation.

Five added deterministic tests cover missing subscription, unavailable model, exact admission, substituted thread models and rerouting. The complete default suite passes 190 tests: 18 Rust, 166 Node and six Python, plus formatting, lint, build and documentation checks.

Explicit container verification passed:

- Empty native account: `missingSubscriptionRejectedBeforeTurn=true`; no login, supplied credentials or inference.
- Authenticated execution: deliberately unavailable model rejected before a turn; GPT-5.5 then completed streamed native command success/error and process-replacement continuation.
- Authenticated control: approval allow/deny and pending/running interruption passed under the same exact-model checks.
- Authenticated bounded workspace: write/read stages passed in replacement workers, preserving the native conversation nonce and workspace files after disk-full recovery.

Reproduce with the existing dedicated M0 environment and policies:

```sh
python3 scripts/probe-container.py --context colima-agentmeld-m0 --probe codex-auth --seccomp-profile docker-default --workspace model-gates
node scripts/probe-provider-egress.mjs --context colima-agentmeld-m0 --execution
node scripts/probe-provider-egress.mjs --context colima-agentmeld-m0 --control
node scripts/probe-workspace-quota.mjs --context colima-agentmeld-m0 --subscription
```

Raw sanitized probe output stays in ignored `.local/m0/model-gates-*.log`; inventory is checked in separately. Negative model/account checks do not send inference requests; the live execution/control/workspace commands consume subscription usage.

## Next work without expanding the milestone

1. Completed: [live browser integration](live-browser.md) verifies real native callbacks, separate browser, takeover, stale dispatch denial and fresh-observation resume.
2. Resolve or explicitly disposition the native command-error UI notification finding before promising reliable product event delivery. The owner approved a scoped patch; see [preparation and qualification status](codex-command-event-patch.md). Preserve the failing diagnostic until the patch is qualified.
3. Controlled dedicated-VM recovery and [isolated native session lifecycle](auth-lifecycle.md) now pass. Preserve the separate real-provider lifecycle limitation. Record viewer selection and the supported test envelope before M0 sign-off.

Production API/state management, broad client UI, remote owner access, installable packaging, final release notices and source-license application remain M1/M2 delivery work. Existing recovery, quota and browser findings remain visible here; none are silently declared complete by this boundary distinction.
