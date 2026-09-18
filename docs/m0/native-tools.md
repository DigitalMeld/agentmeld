# M0 durable approval and native Codex tools

Date: 2026-09-17. Scope: the real Codex 0.154.0 process, a synthetic loopback Responses stream, integer-sum and bounded workspace-listing dynamic tools, and a trusted host reviewer fixture. No live model, provider credentials, user approval UI or production identity service is involved.

## Request path

`probe-native.mjs` launches the existing offline, non-root, read-only container with only its disposable workspace mounted. The container runs Codex with an empty temporary HOME/CODEX_HOME and a local synthetic Responses server. The server emits a `fixture_sum` function call, then a terminal message after receiving the tool output. No network interface other than loopback is available.

Codex emits its actual `item/tool/call` callback. The worker forwards it as response data over the bounded computer transport. The host adapter checks the expected thread and turn, rejects unsupported methods, tools, namespaces and malformed arguments, and binds workspace, worker, thread, turn and request identity into a proposal. `fixture_sum` accepts exactly two safe integers; `workspace_list` accepts no arguments and returns at most 128 immediate workspace names. Explicit grants and verified local worker binding are described in [worker lifecycle](worker-lifecycle.md). A maximum of 128 distinct requests is retained per broker instance; a repeated request or concurrent proposal is rejected. This is a qualification adapter, not a general tool registry.

Rust stores the approval before acknowledging it. The proposal includes an action digest, controller generation, expiry and scope. Allow requires every field to match and creates a one-time action ticket. The host obtains payload-bound dispatch authorization before executing the tool and records settlement only after a validated result. Denial or expiry creates no ticket. The native callback receives Codex's `success` and `contentItems` response shape, and the synthetic model receives the resulting tool output.

The installed Codex schema was inspected with `codex app-server generate-json-schema --out DIRECTORY --experimental`. Dynamic tools require experimental API negotiation and `type: "function"` in this pinned version. Generated schema files remain local evidence; no vendor source was copied into the repository.

## Persistence and revocation

Journal format **4** retains the approval and decision fields introduced in format 3 and adds a durable request ledger and private-screen state. Earlier formats are preserved and rejected, with no automatic migration. The host uses an owner-only control directory outside container mounts. Scope values identify this local launch; they are not cryptographic worker authentication.

Approval TTL must be between 1 and 300,000 milliseconds and is checked against the trusted host wall clock when the decision is made. It is a decision deadline, not a running-tool timeout. Clock rollback is outside the qualified model. Takeover, disconnect, cancellation and supervisor restart revoke pending approvals. Restart increments the generation and pauses the controller; it never restores an actionable approval.

An allowed action still requires the existing one-time dispatch check. If execution loses its response, the pending ticket remains, control pauses, and restart marks the outcome uncertain. Neither the adapter nor the journal retries it automatically. Already-dispatched effects cannot be undone by cancellation. Request identity now survives broker and supervisor replacement within the same journal and worker scope; see [reconnect qualification](recovery-privacy.md) for limits.

The Rust authority exposes administrative commands only to the trusted host. Its direct `admit` command remains available for trusted browser operations; it is not an interface for untrusted callers. The adapter's fixed tool allowlist and the Rust approval binding serve different purposes. This experiment does not establish policy enforcement over every native Codex tool. Other server-request callbacks receive an error; Codex's internal tools and read-only sandbox need separate qualification before live workloads. Claude's native tool path is still unqualified.

## Reproduce and evidence

After the local binary/image build and seccomp preparation in the [M0 guide](README.md):

```sh
node scripts/probe-native.mjs --context YOUR_CONTEXT
node scripts/measure-authority.mjs
```

The native probe makes automated fixture decisions for allow, deny and cancellation before approval, and separately tests granted and ungranted workspace listing. All five reach a completed Codex turn with the tool output returned to the fixture model. Only allowed tools execute. These are real native-process protocol checks with synthetic model output, not authenticated inference. Eleven native-broker default tests cover request validation, all scope fields, altered payloads, duplicate/concurrent requests, expiry, revocation, restart and uncertain execution using the actual host Rust process.

Reports and journals are retained under ignored `.local/m0/control/<run-id>/`. Each native run stops its uniquely named container, closes native children and preserves evidence. Unexpected supervisor loss stops the owned container. The separated viewer now qualifies whole-container cancellation through its HTTP endpoint; the all-in-one comparator and native logical-revocation case remain distinct. Cross-host recovery remains unqualified.

## Resource sample

Apple Silicon host, macOS ARM64; dedicated Linux ARM64 Colima VM with 2 vCPUs, 4 GiB memory and 20 GiB disk. Containers retain the existing 1 CPU, 1 GiB memory, 256 PID and 256 MiB temporary-filesystem limits.

| Measurement | Observed | Method and limitation |
| --- | --- | --- |
| Rust approval cycle | p50 15.983 ms, p95 17.180 ms, max 20.262 ms | 100 sequential cycles after 10 warmups; propose, allow, dispatch, settle with four synced writes; includes stdio, no tool I/O |
| Rust supervisor RSS | 2,752 KiB | Host `ps` snapshot after the sample; not peak RSS |
| Codex process peak RSS | 104,644–105,404 KiB | Linux `/proc/PID/status` VmHWM across three native Rust children, verified by executable path |
| Codex npm launcher peak RSS | 48,476–48,504 KiB | Node launcher measured separately from its native Rust child |
| Native container peak charged memory | 125,874,176 bytes, about 120.0 MiB | Cgroup `memory.peak`, sampled after all three fixture turns |
| Browser container peak charged memory | 157,913,088 bytes, about 150.6 MiB | Separate viewer/takeover probe, cgroup `memory.peak` before shutdown |
| Native case elapsed | allow 365 ms, deny 77 ms, revoke 72 ms | One ordered sample; first case includes container startup, later cases reuse the container |

Cgroup charged memory and process RSS use different accounting and must not be added or substituted for one another. The reports also retain a Node worker RSS snapshot. These samples exclude model weights, model inference, VM overhead, concurrent users and sustained workloads. They establish a reproducible baseline, not a performance target or capacity recommendation.

The resource baseline above used image `sha256:02e567c0d1e949a63de05888388d1277940c786dd9d920b36ec65a36fd8314da`, built locally and not published. Remaining work includes authenticated grant evaluation, production approval UI, credential-entry suppression, scoped provider credentials and egress, live provider cancellation/continuation, authenticated resource sizing and integration of the qualified bounded workspace. Claude, Ollama and messaging are post-alpha; the current M0 gates are in the [exit checklist](exit-checklist.md).
