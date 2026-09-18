# M0 exit checklist

**Priority change, 2026-09-18:** the owner directed delivery of a useful POC instead of further patch qualification. The scoped patch and remaining qualification work are deferred; they do not gate the [working local POC](../poc.md). Historical evidence below is retained, not a mandate to resume the patch.

Updated: 2026-09-18. **M0 qualification is complete with recorded limitations.** The [completion audit](completion-audit.md#closeout-decisions) contains the requirement-by-requirement closeout and evidence readback. The local POC is delivered; M1 and the multi-system alpha are not complete.

## Current scope and exit checklist

Codex-only alpha using ChatGPT subscription authentication. Claude Code, Ollama, iMessage and WhatsApp remain deferred. macOS, local browser, iOS, multiple Mac hosts and away-from-home control remain alpha requirements.

- [x] Pin Codex/base images and record authentication paths and installed licenses.
- [x] Exercise streamed answer, bounded tool call, model-facing tool error, allow/deny, interruption plus terminal cleanup, process replacement and unavailable account/model.
- [x] Verify scoped native process/file boundaries, protected host state and separate browser credentials.
- [x] Verify selected restricted egress and dedicated native credential approach; record the trusted-harness exception.
- [x] Demonstrate viewer/takeover/fresh resume; select Playwright/Chromium screenshot capture, native image rendering and the owned controller for the local workflow.
- [x] Record initial native/browser resource measurements and the tested VM envelope. Minimum-host installation promises remain prohibited until separately validated.
- [x] Verify the selected GPT-5.5 execution role and pinned app-server protocol.

## Explicit limitations and next work

The failed-command UI lifecycle event is still missing; the model-facing native error result is verified. The owner deferred the patch. Production event delivery, real-provider refresh/revocation, release notices/license, broader workload sizing and remote viewer transport are not qualified by M0.

Use the [working POC](../poc.md) for real tasks. Next product increments are conversational follow-up and integrated browser/computer interaction, then the M1 durable service and M2 native/cross-host clients. Do not restart deferred patch work automatically.

The entries below are preserved chronology, **not current next actions or additional exit gates**. Later evidence and the closeout audit supersede their pending statuses.

## Historical working checkpoints

Previous work is merged and verified on GitHub: [#18](https://github.com/DigitalMeld/agentmeld/pull/18) reconciled alpha scope and initial isolation/recovery, [#19](https://github.com/DigitalMeld/agentmeld/pull/19) extended native file-tool coverage, [#20](https://github.com/DigitalMeld/agentmeld/pull/20) added restricted provider egress, and [#21](https://github.com/DigitalMeld/agentmeld/pull/21) qualified synthetic dedicated credential storage. Their owning reports retain exact images, evidence and limitations.

The current [dedicated-store qualification](codex-auth-store.md) passes using synthetic data across two replacement containers. Native sandbox reads/writes to the direct canary, alias and configuration are denied; reinitializing nonempty storage fails. The owner authorized use of existing subscription credentials. The dedicated store and narrow single-file import are now verified; no personal settings or directory mounts were copied. This supersedes the earlier pending-storage checkpoint.

Native file-tool probes select pinned GPT-5.5 configuration with synthetic responses. Newer code-mode configurations remain unqualified; no product default has changed. The original egress probe qualified TLS and standalone sandbox network denial; the subscription follow-up now verifies native authentication transport and a live streamed answer. Its corrected host-bridge result supersedes the initial invalid input.

Next: complete the final audit and native error-event disposition; authenticated browser integration now passes; retain the native UI error-event finding. Live mediated approval and cancellation now pass. Authenticated bounded workspace integration now passes. Preserve the remaining recovery/browser qualification work; production volume management and alpha packaging remain later delivery obligations. Preserve the full checklist; fixture success does not close authenticated gates.

The [workspace disk-limit experiment](workspace-disk-limit.md) passes with a fixed-size 64 MiB ext4 fixture, preserved files after disk-full, recovered writes and replacement-container readback. The normal bind launcher remains unbounded; production quota integration is not claimed. The [offline resource baseline](resource-baseline.md) passed 51 verified native/browser cycles with zero OOM kills and 212.04 MiB peak charged memory; authenticated workload sizing remains open.

The active qualification image now installs only Codex and Playwright npm packages. Its [inventory and regression evidence](distribution-inventory.md#codex-only-rebuild-verification) replace the mixed runtime as the current baseline; historical provider experiments remain deferred.

The browser-isolation probe qualifies separate browser/harness containers and synthetic private-mode entry with session preservation. It does not add an owner login endpoint or complete the authenticated browser gate.

Live subscription streaming and managed device challenge/cancel now pass after adding the missing system CA bundle. See the [live checkpoint](codex-subscription.md#verified-live-subscription-checkpoint) for exact evidence, authorization and remaining gates.

Latest execution evidence: [native command-error follow-up](codex-subscription.md#native-command-error-evidence). Live command success, model-facing error and persisted continuation pass. The offline diagnostic still exits nonzero for missing UI error events. Neither result closes M0; the remaining browser, storage, recovery and packaging gates stay open.

The [native command-error follow-up](codex-subscription.md#native-command-error-evidence) now verifies the model-facing exit-23 result in live native history and reproduces the absent UI event offline. This supersedes the earlier unqualified tool-error result, while preserving the separate UI event gap. No production fallback or dependency patch was introduced.

The [live control qualification](live-control.md) verifies real subscription-backed approval allow/deny, cancellation with an outstanding approval, and interruption of a running native parent/child process tree. Owner-facing and remote approval UI are not claimed.

The [authenticated workspace integration](workspace-disk-limit.md#authenticated-worker-integration) verifies live native commands and conversation/file preservation across replacement workers using the bounded volume after disk-full recovery. Production volume management remains unqualified. Controlled dedicated-VM restart now passes as documented below.

Model admission now checks the native subscription account and exact catalog entry before live turns, verifies thread start/resume model responses, and rejects native rerouting. Empty-account and unavailable-model negative probes pass; see the [audit evidence](completion-audit.md#model-admission-verification).

The [live browser integration](live-browser.md) closes the authenticated browser-fixture gate with real subscription-backed callbacks, protected host authority, viewer HTTP takeover/resume and separate browser containment. Remote viewer delivery and real browser credential entry remain unqualified.

The [controlled VM-restart probe](workspace-disk-limit.md#controlled-vm-restart) preserves filesystem identity/bounds, native subscription availability, conversation nonce and workspace files across a new boot with explicit reattachment. Native lifecycle qualification now passes with synthetic tokens; next: native command-error event disposition and final M0 audit.

The [native lifecycle fixture](auth-lifecycle.md) uses the real pinned app-server with isolated synthetic credentials to verify refresh persistence, permanent expiry withholding, transient recovery and logout without touching the owner session. It does not claim provider-side refresh/revocation qualification.

The owner has now authorized a [scoped native command-event patch](codex-command-event-patch.md). Configuration changes and a separate 0.155.0 comparison did not fix the diagnostic. The patch compiles and passes offline command/boundary and live execution checks; the corrected upstream regression fails unpatched and passes patched. The broader unified-exec suite has three failures also present in baseline comparisons; full upstream qualification and reproducible runtime selection remain open. The selected runtime remains on unpatched 0.154.0.

Current local availability: the baseline is rebuilt as `sha256:12ed9904b4604148fec691c0d5a2a2e9ba6d41c4b24675c3c7d144dfc13591bc`. The same image and native/browser probe pass before and after a controlled VM restart; the credential volume remains present. The patched candidate still needs rebuilding. See [recovery evidence](build-storage.md#baseline-recovery-and-restart-verification).
