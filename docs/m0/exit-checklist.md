# M0 exit checklist

Updated: 2026-09-18. M0 remains incomplete. This is the current task checkpoint; older probe documents retain historical evidence and do not add exit gates.

## Current scope

Codex-only alpha using supported ChatGPT subscription login. Claude Code, Ollama, iMessage and WhatsApp are deferred. macOS, local browser, iOS, multiple Mac hosts and away-from-home control remain alpha requirements; full client delivery is M1/M2, not evidence already supplied by M0.

## Current work order

| Requirement | Evidence now | Next action |
| --- | --- | --- |
| Local baseline | 168 tests plus formatting, lint, build and docs checks passed on 2026-09-18 after implementation edits | Run relevant checks after changes |
| Codex subscription authentication | Managed login schemas, isolated logged-out readback and synthetic dedicated-volume persistence pass; no owner login yet | Authorize the reviewed dedicated store, qualify native proxy/login, then owner sign-in |
| Real native execution | Container startup and dynamic callbacks pass with synthetic inference | Run subscription-backed stream, tool error, allow/deny, cancellation and continuation |
| Process/file/network boundary | Command read/write, native patch/image canaries, provider TLS gateway and standalone tool network denial pass | Qualify persistent credential storage and authenticated egress; expand native-tool coverage |
| Recovery | Durable journals, unsettled output review, worker termination and fresh-process engine-bound assessment pass | Live transport reattachment, whole-machine restart and production recovery remain unqualified |
| Storage and resources | Bounded temporary filesystem and result archive; initial samples | Enforce workspace disk limits and record sustained idle/active resource measurements |
| Browser workflow | Fixture viewer, takeover, resume and cancellation pass | Recheck in the authenticated harness workflow; protected credential-entry behavior remains unqualified |
| Versions and licenses | Pinned runtime/image and component notes exist | Finish distribution inventory and resolve AgentMeld source license before release |

## Working checkpoint

Previous work is merged and verified on GitHub: [#18](https://github.com/DigitalMeld/agentmeld/pull/18) reconciled alpha scope and initial isolation/recovery, [#19](https://github.com/DigitalMeld/agentmeld/pull/19) extended native file-tool coverage, and [#20](https://github.com/DigitalMeld/agentmeld/pull/20) added restricted provider egress. Their owning reports retain exact images, evidence and limitations.

The current [dedicated-store qualification](codex-auth-store.md) passes using synthetic data across two replacement containers. Native sandbox reads/writes to the direct canary, alias and configuration are denied; reinitializing nonempty storage fails. The real setup tool defaults to a read-only plan and no owner credential store or login has been created. The proposed storage path is ready for explicit authorization under repository instructions.

Native file-tool probes select pinned GPT-5.5 configuration with synthetic responses. Newer code-mode configurations remain unqualified; no product default has changed. The egress probe qualifies TLS to an enrolled provider and standalone sandbox network denial, not native app-server authentication. Its corrected host-bridge result supersedes the initial invalid input.

Next: authorize/create the dedicated store, qualify native subscription login through the gateway, then live streaming/tool/error/approval/cancellation/continuation. Independently finish workspace quotas, resource measurements, inventory and the recovery/browser gates above. Preserve the full checklist; fixture success does not close authenticated gates.
