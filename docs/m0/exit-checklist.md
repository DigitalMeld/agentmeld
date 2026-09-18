# M0 exit checklist

Updated: 2026-09-18. M0 remains incomplete. This is the current task checkpoint; older probe documents retain historical evidence and do not add exit gates.

## Current scope

Codex-only alpha using supported ChatGPT subscription login. Claude Code, Ollama, iMessage and WhatsApp are deferred. macOS, local browser, iOS, multiple Mac hosts and away-from-home control remain alpha requirements; full client delivery is M1/M2, not evidence already supplied by M0.

The [completion audit](completion-audit.md) maps these entries to the roadmap and separates qualification gaps from later product/release work.

## Current work order

| Requirement | Evidence now | Next action |
| --- | --- | --- |
| Local baseline | 190 tests plus formatting, lint, build and docs checks passed on 2026-09-18 after implementation edits | Run relevant checks after changes |
| Codex subscription authentication | Dedicated store/import verified; subscription recognized; native device challenge/cancel and live GPT-5.5 streaming pass | Qualify refresh/session lifecycle without revoking the shared owner session |
| Real native execution | Live streamed answer, command success and conversation continuation after native process replacement pass; live tool error is verified by correlated native history; its UI command-result event remains missing | Live mediated allow/deny and both pending/running cancellation pass; resolve remaining native UI error-event delivery |
| Process/file/network boundary | Command read/write, native patch/image canaries, provider TLS gateway and standalone tool network denial pass | Expand live native-tool coverage and session lifecycle checks |
| Recovery | Durable journals, unsettled output review, worker termination and fresh-process engine-bound assessment pass | Native process replacement and persisted nonce continuation pass; whole-machine restart and production recovery remain unqualified |
| Storage and resources | Bounded temporary filesystem/archive; fixed-size persistent workspace passes disk-full/replacement tests; 150-second offline resource baseline passes | Authenticated bounded workspace and replacement-worker continuation pass; qualify broader live workloads and longer soaks |
| Browser workflow | Fixture viewer, takeover, resume and cancellation pass; [separate-browser private login fixture](browser-isolation.md) passes | Recheck in the authenticated harness workflow; real owner credential-entry transport remains unqualified |
| Versions and licenses | [Installed runtime inventory](distribution-inventory.md) verified: 4 npm / 199 Debian packages and local Rust resolution | Codex-only image verified; finish embedded notices and resolve source license before release |

## Working checkpoint

Previous work is merged and verified on GitHub: [#18](https://github.com/DigitalMeld/agentmeld/pull/18) reconciled alpha scope and initial isolation/recovery, [#19](https://github.com/DigitalMeld/agentmeld/pull/19) extended native file-tool coverage, [#20](https://github.com/DigitalMeld/agentmeld/pull/20) added restricted provider egress, and [#21](https://github.com/DigitalMeld/agentmeld/pull/21) qualified synthetic dedicated credential storage. Their owning reports retain exact images, evidence and limitations.

The current [dedicated-store qualification](codex-auth-store.md) passes using synthetic data across two replacement containers. Native sandbox reads/writes to the direct canary, alias and configuration are denied; reinitializing nonempty storage fails. The owner authorized use of existing subscription credentials. The dedicated store and narrow single-file import are now verified; no personal settings or directory mounts were copied. This supersedes the earlier pending-storage checkpoint.

Native file-tool probes select pinned GPT-5.5 configuration with synthetic responses. Newer code-mode configurations remain unqualified; no product default has changed. The original egress probe qualified TLS and standalone sandbox network denial; the subscription follow-up now verifies native authentication transport and a live streamed answer. Its corrected host-bridge result supersedes the initial invalid input.

Next: finish authenticated browser integration and remaining recovery evidence; retain the native UI error-event finding. Live mediated approval and cancellation now pass. Authenticated bounded workspace integration now passes. Preserve the remaining recovery/browser qualification work; production volume management and alpha packaging remain later delivery obligations. Preserve the full checklist; fixture success does not close authenticated gates.

The [workspace disk-limit experiment](workspace-disk-limit.md) passes with a fixed-size 64 MiB ext4 fixture, preserved files after disk-full, recovered writes and replacement-container readback. The normal bind launcher remains unbounded; production quota integration is not claimed. The [offline resource baseline](resource-baseline.md) passed 51 verified native/browser cycles with zero OOM kills and 212.04 MiB peak charged memory; authenticated workload sizing remains open.

The active qualification image now installs only Codex and Playwright npm packages. Its [inventory and regression evidence](distribution-inventory.md#codex-only-rebuild-verification) replace the mixed runtime as the current baseline; historical provider experiments remain deferred.

The browser-isolation probe qualifies separate browser/harness containers and synthetic private-mode entry with session preservation. It does not add an owner login endpoint or complete the authenticated browser gate.

Live subscription streaming and managed device challenge/cancel now pass after adding the missing system CA bundle. See the [live checkpoint](codex-subscription.md#verified-live-subscription-checkpoint) for exact evidence, authorization and remaining gates.

Latest execution evidence: [native command-error follow-up](codex-subscription.md#native-command-error-evidence). Live command success, model-facing error and persisted continuation pass. The offline diagnostic still exits nonzero for missing UI error events. Neither result closes M0; the remaining browser, storage, recovery and packaging gates stay open.

The [native command-error follow-up](codex-subscription.md#native-command-error-evidence) now verifies the model-facing exit-23 result in live native history and reproduces the absent UI event offline. This supersedes the earlier unqualified tool-error result, while preserving the separate UI event gap. No production fallback or dependency patch was introduced.

The [live control qualification](live-control.md) verifies real subscription-backed approval allow/deny, cancellation with an outstanding approval, and interruption of a running native parent/child process tree. Owner-facing and remote approval UI are not claimed.

The [authenticated workspace integration](workspace-disk-limit.md#authenticated-worker-integration) verifies live native commands and conversation/file preservation across replacement workers using the bounded volume after disk-full recovery. Production volume management and whole-VM recovery are not claimed.

Model admission now checks the native subscription account and exact catalog entry before live turns, verifies thread start/resume model responses, and rejects native rerouting. Empty-account and unavailable-model negative probes pass; see the [audit evidence](completion-audit.md#model-admission-verification).
