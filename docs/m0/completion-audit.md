# M0 completion audit and capability matrix

**Priority change, 2026-09-18:** the owner directed delivery of a useful POC instead of further patch qualification. The scoped patch and remaining qualification work are deferred; they do not gate the [working local POC](../poc.md). Historical evidence below is retained, not a mandate to resume the patch.

Updated: 2026-09-18. M0 risk-reduction qualification is complete with the explicit limitations below. This is not M1 or alpha completion. This audit maps evidence to the seven requirements in the [roadmap](../specs/roadmap.md#m0-prove-codex-subscription-execution-and-its-isolation-boundary); it does not replace the [exit checklist](exit-checklist.md) or convert experiments into product claims.

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

## Closeout decisions

The original seven roadmap requirements were reviewed against the reports above and their retained sanitized local logs on 2026-09-18. The exit is evidence of feasibility with explicit limitations, not a production-readiness certificate. Historical image IDs remain attached to their own runs; no claim is made that every probe ran against the latest rebuilt image.

1. **Authentication and versions:** Codex 0.154.0, Playwright 1.63.0 and digest-pinned base images are selected. Live subscription recognition/inference and missing-account rejection are verified; installed licenses are inventoried. Real-provider refresh/revocation, embedded redistribution notices and AgentMeld license selection remain release/setup work. The owner session was not revoked.
2. **Adapter cases:** streaming, native command success, model-facing exit-23 failure, allow/deny, interruption with explicit terminal cleanup, process replacement, and unavailable-model rejection are verified. The owner explicitly deferred the failed-command UI-event patch. The missing event remains a product timeline limitation, not a failed model-facing tool-error test. Do not resume patch qualification automatically or claim repaired event delivery.
3. **Boundaries:** native tool canaries, exact mount inspection, host-owned supervisor storage and separate browser containers establish the scoped file/process boundary. Only the owned workspace and explicitly authorized provider store are attached; sibling workspaces and host application state are not mounted. This is not hostile-tenant or kernel-escape certification.
4. **Egress and credentials:** the restricted provider gateway and protected dedicated native store are the selected approach. Live inference uses this path; tool network denial and protected credential access are verified. The trusted harness necessarily reads its own credential store. No general web/secret broker or host-execution fallback is implied.
5. **Viewer selection:** retain maintained Playwright 1.63.0 with sandboxed Chromium for screenshot capture and input, browser-native PNG rendering, and the existing small owned HTTP/controller layer. This selects the demonstrated screenshot viewer for the next local workflow. Takeover, generation fencing, disconnect and fresh-observation resume have offline UI and live callback evidence. No video library is needed for this bounded viewer; production video, remote transport and keyboard/clipboard support remain later decisions.
6. **Resources:** the initial native/browser measurements satisfy the measurement requirement: 51 cycles, 212.04 MiB peak charged worker memory, zero OOM kills, in the recorded 2-vCPU/4-GiB VM. This is the tested fixture envelope, not a minimum supported Mac specification. No installation sizing promise is authorized from it; broader workload/host validation is required before publishing one.
7. **Roles and protocol:** the sole selected execution role uses GPT-5.5 through native app-server 0.154.0. Exact account/catalog/start/resume checks and rerouting rejection are verified. The browser is a controlled tool, not an independently selected model role. Additional planner/subagent models are not enabled or qualified.

### Evidence readback at closeout

Retained local reports inspected: `model-gates-empty-auth.log`, `model-gates-live.log`, `live-error-evidence.log`, `restored-live-control.log`, `native-file-boundary.log`, `browser-isolation.log`, `auth-store.log`, `live-browser-egress-regression.log`, `live-browser-final.log`, `auth-lifecycle-final.log`, `vm-recovery.log`, `resource-baseline.log`, and `restored-native-after.log`, under ignored `.local/m0/`. The owning linked reports describe assertions, reproduction commands and immutable images. These logs contain fixture status, not provider credentials.

The current unpatched image is `sha256:12ed9904b4604148fec691c0d5a2a2e9ba6d41c4b24675c3c7d144dfc13591bc`. Native/browser regression passed before and after its controlled VM restart, and live control passed on this image. Its local inventory confirms four npm packages, 199 Debian packages with copyright files and 22 Rust resolution entries. Earlier resource and integration evidence retains earlier image bindings.

The [local POC](../poc.md) additionally proves real uploaded CSV analysis, report preview/download, owned-worker Stop and saved results after a service restart. It is delivered and merged in [PR #38](https://github.com/DigitalMeld/agentmeld/pull/38). It does not complete the M1 acceptance scenario: conversational continuation, integrated browser takeover, durable production recovery and the Rust service remain work ahead.

Production API/state management, broad client UI, remote owner access, installable packaging, final release notices and source-license application remain M1/M2 delivery work. Next: evaluate the working POC on representative tasks, then implement conversational follow-up and the browser/computer workflow. The patch remains deferred unless an observed product need changes that decision.
