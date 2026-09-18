# M0 exit checklist

Updated: 2026-09-18. M0 remains incomplete. This is the current task checkpoint; older probe documents retain historical evidence and do not add exit gates.

## Current scope

Codex-only alpha using supported ChatGPT subscription login. Claude Code, Ollama, iMessage and WhatsApp are deferred. macOS, local browser, iOS, multiple Mac hosts and away-from-home control remain alpha requirements; full client delivery is M1/M2, not evidence already supplied by M0.

## Current work order

| Requirement | Evidence now | Next action |
| --- | --- | --- |
| Local baseline | 165 tests plus formatting, lint, build and docs checks passed on 2026-09-18 after implementation edits | Run relevant checks after changes |
| Codex subscription authentication | Pinned Linux native schemas and isolated logged-out account readback pass; no dedicated login yet | Settle protected dedicated credential storage and scoped egress, then owner login |
| Real native execution | Container startup and dynamic callbacks pass with synthetic inference | Run subscription-backed stream, tool error, allow/deny, cancellation and continuation |
| Process/file/network boundary | Offline container, Chromium sandbox and standalone/app-server command credential canaries pass | Qualify persistent credential storage and authenticated egress; expand native-tool coverage |
| Recovery | Durable journals, unsettled output review, worker termination and fresh-process engine-bound assessment pass | Live transport reattachment, whole-machine restart and production recovery remain unqualified |
| Storage and resources | Bounded temporary filesystem and result archive; initial samples | Enforce workspace disk limits and record sustained idle/active resource measurements |
| Browser workflow | Fixture viewer, takeover, resume and cancellation pass | Recheck in the authenticated harness workflow; protected credential-entry behavior remains unqualified |
| Versions and licenses | Pinned runtime/image and component notes exist | Finish distribution inventory and resolve AgentMeld source license before release |

## Working checkpoint

The installed Rust toolchain required a shell-local PATH adjustment; no global configuration changed. The existing dedicated `agentmeld-m0` Colima profile was started with automatic context activation disabled for explicit container probes. Its pre-work state was stopped. After checks the container inventory was empty and the profile was stopped again; the default Docker context was not switched.

The recovery-record implementation passed six focused tests, the local suite and real-container cancellation/reconstruction. The offline Codex subscription protocol probe also passed. Modified implementation files include the worker record/observer and tests, recovery CLI, cancellation probe, new native auth probe and container probe selector. Next: protected subscription credential storage and mediated egress before owner login and real Codex inference. Preserve all earlier uncommitted documentation. No publication has occurred in this batch.


The next batch qualified the [native command credential boundary](codex-credential-boundary.md) with synthetic credentials and a real app-server command tool. The separate named AppArmor profile preserves other upstream denials while allowing scoped nested sandbox setup. The 157-test default suite passed (18 Rust, 133 Node, 6 Python), including policy integrity checks. New implementation: policy preparation, explicit boundary probe and synthetic native command driver. This is offline qualification, not subscription inference. Next: test remaining native file-access paths, then implement bounded egress and a dedicated credential persistence design before owner login. No personal Codex credentials were used.

Cleanup verified for this batch: no probe containers remained; the temporary `agentmeld-m0-codex` AppArmor profile was unloaded and absent from the kernel profile list while `docker-default` remained enforced. The dedicated VM was stopped again. Changes and evidence remain local.


Publication resumed: [PR #18](https://github.com/DigitalMeld/agentmeld/pull/18) merged the accumulated scope documentation, fresh-worker recovery and initial command-boundary qualification. GitHub readback confirmed the merge and checklist blob. The follow-up native file probe adds protected command writes, patch deletion and image reads with successful workspace controls. It uses pinned GPT-5.5 tool configuration with synthetic responses. Newer code-mode model configurations still need their own protocol qualification; no product model default was changed. Next: bounded egress and dedicated storage, with code-mode coverage retained as an explicit gap.


[PR #19](https://github.com/DigitalMeld/agentmeld/pull/19) merged native file-boundary coverage; remote blob readback matched. The next [provider-egress experiment](provider-egress.md) adds eight local tests and an explicit isolated-network probe. The worker reaches an enrolled provider through TLS while tested direct routes, DNS and disallowed destinations fail. This is transport evidence only: native Codex proxy use, authenticated app-server tool network denial, dedicated login storage and subscription inference remain open. The gateway does not inspect encrypted application destinations on shared provider IPs.

The egress rerun also confirms standalone native sandbox commands cannot reach the proxy or public Internet while the parent can complete provider TLS. A missing gateway input in the first host-bridge test was corrected and rerun against the actual Docker bridge address; only the corrected result is authoritative.
