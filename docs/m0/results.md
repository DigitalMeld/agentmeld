# M0 evidence and remaining qualification

Date: 2026-09-17. Status: **started, not complete**. These are experimental contracts and offline integration probes, not an installable agent product.

## Verified locally

| Check | Result | Limit |
| --- | --- | --- |
| Rust conformance | 13 tests passed | Synthetic protocol/policy/channel inputs |
| Node Ollama loop | 4 tests passed, including invoking the Rust fixture tool | Injected HTTP transport; no model inference |
| Rust formatting and Clippy | Passed with warnings denied | Local checks only |
| Codex 0.154.0 app-server | Real container process initialized; empty thread list; nonexistent continuation rejected | No authenticated turn, native tool or successful resume |
| Claude Agent SDK 0.3.274 | Real container startup rejected missing credentials through SDK exception | No authenticated turn or native permission callback |
| Container OS boundary | UID 1000, zero effective capabilities, no-new-privileges, seccomp, read-only root, loopback only | Not an escape test or hostile-tenant qualification |
| Workspace replacement | Marker advanced from 0 to 1 to 2 to 3 across disposable containers | No hard workspace disk quota |
| Chromium renderer sandbox | **Failed: No usable sandbox** | No browser interaction, screenshot, viewer or takeover proof |
| iMessage | Identity, echo, duplicate and revocation fixtures passed | No Mac bridge connected and no messages sent |

The final offline probe intentionally exits 1 because browser qualification failed. It must remain a failing check until the environment supports Chromium's sandbox. Do not add `--no-sandbox`, privileged mode or disable seccomp to turn this result green. The precise user-namespace/seccomp interaction needs diagnosis; the browser error alone does not establish its cause.

The probe ran in a dedicated Colima Linux VM on an Apple Silicon Mac, configured with 2 vCPUs, 4 GiB memory and 20 GiB disk. Each probe container was limited to 1 CPU, 1 GiB RAM, 256 PIDs and a 256 MiB temporary filesystem. The last probe took about 0.69 seconds including container startup; this is a single offline sample, not an inference benchmark or sizing recommendation. Peak RSS and browser memory remain unmeasured.

The final local image ID was `sha256:8deee8f806620d55bc992582f0f1b00722578bece9be454321a7b2c4aee74f4e`. It is not published. Raw machine-local evidence is retained under ignored `.local/m0/evidence/`. No host credentials or browser profiles were mounted.

## Versions and distribution notes

| Component | Pinned version | Distribution note |
| --- | --- | --- |
| Rust | 1.95.0 | Rust tooling uses MIT/Apache-2.0 licensing |
| Codex npm package | 0.154.0 | Package metadata declares Apache-2.0; service/auth terms are separate |
| Claude Agent SDK | 0.3.274 | Package declares SEE LICENSE IN README; do not assume the bundled runtime shares AgentMeld's license |
| Playwright | 1.63.0 | Apache-2.0; downloaded Chromium and OS packages retain their own notices |
| Node base image | 24-bookworm-slim, digest in Dockerfile | Node and Debian packages have separate licenses |
| Ollama client target | Local service observed at 0.34.1 | Only cloud aliases were available; no local tool model selected or qualified |

Exact JavaScript resolution is recorded in `package-lock.json`; Rust resolution is in `Cargo.lock`. The browser installer resolved Chromium 153.0.8010.12 / Playwright build 1243 for Linux ARM64. Image redistribution requires a separate bundled-license inventory. AgentMeld's own license is awaiting the owner's choice; source visibility alone does not grant an open-source license.

## Next M0 work, in order

1. Diagnose and qualify Chromium sandbox support within a constrained runtime; then test browser interaction, viewer authentication, takeover and fresh observation on resume.
2. Define scoped provider credentials and mediated egress. Run actual Claude/Codex streamed answers, native tools, allow/deny, cancellation and process-replacement continuation. Do not import personal host auth directories.
3. Select a local Ollama tool model and run the bounded tool loop against real inference, including failures and cancellation. Current cloud aliases do not satisfy this check.
4. Add durable admission/replay protection, process-tree cancellation, workspace quotas and resource measurements before promoting experimental contracts into a service.
5. Configure an explicitly designated iMessage test identity and paired Mac bridge; qualify real correlation, attachments, reconnect and uncertain delivery.

M1 remains gated on these integration results. No application UI, hosted service, training pipeline or production deployment has been created.
