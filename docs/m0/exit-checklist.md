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
| Storage and resources | Bounded temporary filesystem/archive; fixed-size persistent workspace passes disk-full/replacement tests; 150-second offline resource baseline passes | Integrate bounded storage with authenticated workers; qualify live workloads and longer soaks |
| Browser workflow | Fixture viewer, takeover, resume and cancellation pass | Recheck in the authenticated harness workflow; protected credential-entry behavior remains unqualified |
| Versions and licenses | [Installed runtime inventory](distribution-inventory.md) verified: 4 npm / 197 Debian packages and local Rust resolution | Codex-only image verified; finish embedded notices and resolve source license before release |

## Working checkpoint

Previous work is merged and verified on GitHub: [#18](https://github.com/DigitalMeld/agentmeld/pull/18) reconciled alpha scope and initial isolation/recovery, [#19](https://github.com/DigitalMeld/agentmeld/pull/19) extended native file-tool coverage, [#20](https://github.com/DigitalMeld/agentmeld/pull/20) added restricted provider egress, and [#21](https://github.com/DigitalMeld/agentmeld/pull/21) qualified synthetic dedicated credential storage. Their owning reports retain exact images, evidence and limitations.

The current [dedicated-store qualification](codex-auth-store.md) passes using synthetic data across two replacement containers. Native sandbox reads/writes to the direct canary, alias and configuration are denied; reinitializing nonempty storage fails. The real setup tool defaults to a read-only plan and no owner credential store or login has been created. The proposed storage path is ready for explicit authorization under repository instructions.

Native file-tool probes select pinned GPT-5.5 configuration with synthetic responses. Newer code-mode configurations remain unqualified; no product default has changed. The egress probe qualifies TLS to an enrolled provider and standalone sandbox network denial, not native app-server authentication. Its corrected host-bridge result supersedes the initial invalid input.

Next: authorize/create the dedicated store, qualify native subscription login through the gateway, then live streaming/tool/error/approval/cancellation/continuation. Independently finish workspace integration, alpha packaging and the recovery/browser gates above. Preserve the full checklist; fixture success does not close authenticated gates.

The [workspace disk-limit experiment](workspace-disk-limit.md) passes with a fixed-size 64 MiB ext4 fixture, preserved files after disk-full, recovered writes and replacement-container readback. The normal bind launcher remains unbounded; production quota integration is not claimed. The [offline resource baseline](resource-baseline.md) passed 51 verified native/browser cycles with zero OOM kills and 212.04 MiB peak charged memory; authenticated workload sizing remains open.

The active qualification image now installs only Codex and Playwright npm packages. Its [inventory and regression evidence](distribution-inventory.md#codex-only-rebuild-verification) replace the mixed runtime as the current baseline; historical provider experiments remain deferred.
