# M0 evidence and remaining qualification

Date: 2026-09-18. Status: **started, not complete**. These are experimental contracts and explicit native/live qualification probes, not an installable agent product. The current checklist and reports below supersede historical pending statuses.

## Current qualification checkpoint

The [exit checklist](exit-checklist.md) owns current status. Codex-only subscription qualification now includes [live streaming and native tool results](codex-subscription.md), [allow/deny and pending/running cancellation](live-control.md), and [bounded workspace integration across replacement workers](workspace-disk-limit.md#authenticated-worker-integration). The failed-command UI event gap remains open even though model-facing error delivery is verified. The default local suite now has 190 tests.

M0 remains incomplete with the [requirement-by-requirement completion audit](completion-audit.md) recorded and qualification gaps still open. Whole-product UI, production persistence/recovery and self-hosted packaging are not supplied by these experiments. The entries below preserve historical batch evidence; their provider scope, test counts and next-action statements are not the current roadmap.

## Historical verified batches

| Check | Result | Limit |
| --- | --- | --- |
| Rust conformance and archive | 18 tests passed | Synthetic protocol/policy/channel inputs and trusted-owner archive fixtures |
| Python policy integrity | 6 tests passed | Rejects unverified upstream bytes and locally modified policy |
| Ollama readiness and loop | 13 tests passed: preflight, streaming budgets, stalled HTTP, interruption, durable approvals and CLI workflow | Injected and loopback synthetic HTTP; no real local inference |
| Browser control and viewer HTTP | 7 tests passed | In-process queue and local HTTP authentication; no native harness mediation |
| Durable Rust subprocess integration | 10 tests passed, including private-screen restart and capture fencing: replacement, exclusive lock, SIGKILL with unfinished action, corruption, fencing, cancellation, payload binding and one-time dispatch | Trusted host caller/storage; production identity remains open |
| Crash boundaries and journal validation | 16 tests passed: six SIGKILL boundaries through two restarts, fresh observation and deduplication, eight invalid-history cases, four torn-record offsets | Host macOS and Linux ARM64 tmpfs; no power-loss or worker reconciliation proof |
| Native tool approval | 13 tests passed; filename-bound read grants/approvals and result withholding, reconnect replay and ledger exhaustion, scope/payload binding, expiry, duplicates, concurrent proposals, revocation and uncertain recovery | Three bounded Codex tools; fixture reviewer, no production grant service |
| Result archive integration | 6 tests passed: scope/readback, asynchronous scope preservation, ordering, failure, lost settlement and denial | Trusted host archive; no atomic archive/journal transaction |
| Settled result index | 7 tests passed: restart lookup, required references, crash timing, history integrity, capacity and binding | Format 6 retains this index; earlier fixture journals preserved and rejected |
| Scoped result HTTP access | 8 tests passed: capability, scope, expiry, revocation during reads, restart, orphan rejection and corruption | Trusted host pairing; no account or remote authentication |
| Recovery evidence assessment | 13 tests passed: exact evidence binding, SIGKILL, state races, CLI ownership, input bounds, worker observations and preserved uncertainty | Assessment is non-mutating; review commit is a separate trusted host interface |
| Reviewed recovery | 15 tests passed on host and Linux: crash timing, provenance, stale/replayed/racing reviews, history integrity and capacity | Trusted host review labels; no account authentication |
| Owned worker | 8 tests passed: resource and process limits, identity/scope/grants, termination readback failures, fresh scoped inventory and reconciliation | Trusted local runtime; no remote authentication |
| Workspace tools | 7 tests passed: listing bounds plus UTF-8 text reads, path/result binding, file-type/link/size rejection and nonblocking FIFO handling | Immediate files only; no immutable snapshot or durable content archive |
| Computer response boundary | 4 tests passed: unsolicited commands, unmatched/oversized responses, malformed images and invalid dimensions | No malicious-browser or kernel-escape certification |
| Rust formatting and Clippy | Passed with warnings denied | Local checks only |
| Codex 0.154.0 app-server | Real container process initialized; empty thread list; nonexistent continuation rejected | Dynamic-tool allow/deny/revoke also passed with a synthetic model; no authenticated inference or successful resume |
| Claude Agent SDK 0.3.274 | Real container startup rejected missing credentials through SDK exception | No authenticated turn or native permission callback |
| Container OS boundary | UID 1000, zero effective capabilities, no-new-privileges, seccomp, read-only root, loopback only | Not an escape test or hostile-tenant qualification |
| Workspace replacement | Marker advanced from 0 to 1 to 2 to 3 across disposable containers | No hard workspace disk quota |
| Chromium renderer sandbox | **Passed with explicit browser seccomp policy**; button click and screenshot verified; renderer has 2 seccomp filters and PID namespace depth 3 | Headless synthetic fixture only |
| Browser viewer/takeover | Real Chromium UI completed counter 1 → human 2 → resumed agent 3; displayed frame verified, stale input rejected, disconnect paused | Rust journal authority and paused process replacement verified; all-in-one comparator has no protected control storage; private-screen suppression does not provide credential entry |
| Separated supervisor | Host journal excluded from container mounts; canary read/write denied; host viewer HTTP workflow and paused recovery passed | Host account and Docker context trusted; general native tools not mediated |
| iMessage | Identity, echo, duplicate and revocation fixtures passed | No Mac bridge connected and no messages sent |

The original default-profile failure is now reproduced and resolved for this offline fixture. Namespace creation failed under Docker defaults. The Playwright profile then exposed a `chroot` denial after dropping capabilities. An explicit browser policy permits that syscall while the outer container still has no effective capabilities and cannot chroot. The normal probe now exits 0; the Docker-default comparison still exits 1. See [diagnosis and policy](browser-sandbox.md).

The probe ran in a dedicated Colima Linux VM on an Apple Silicon Mac, configured with 2 vCPUs, 4 GiB memory and 20 GiB disk. Each probe container was limited to 1 CPU, 1 GiB RAM, 256 PIDs and a 256 MiB temporary filesystem. An earlier probe took about 2.64 seconds with the viewer fixture and container startup; this is a single offline sample, not an inference benchmark or sizing recommendation. The [native-tool report](native-tools.md) now records Rust latency/RSS, Codex peak RSS and native/browser cgroup memory samples.

The earlier local image ID was `sha256:b588c24b989f6119444f002fe7433a8ed14f5528866a8c6e2085ca3e035b4c17`. It is not published. Raw machine-local evidence is retained under ignored `.local/m0/evidence/`. No host credentials or browser profiles were mounted.

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

Current scope: Codex-only with ChatGPT subscription authentication. Claude, Ollama and messaging qualification are deferred; their existing results above are retained as historical experiments.

1. Extend the [qualified Codex dynamic-tool adapter](native-tools.md) beyond its verified local worker identity and tool grants to remote authentication and broader native tool coverage; extend private-screen suppression to secure credential entry and qualify worker recovery. Keep the renderer sandbox and control-ordering checks as regression gates.
2. Qualify dedicated Codex subscription login and mediated egress. Run actual Codex streamed answers, native tools, allow/deny, cancellation and process-replacement continuation. Do not import personal host auth directories.
3. Extend the qualified reconnect ledger and whole-container stop probe and integrated HTTP cancellation to production recovery, workspace quotas and sustained resource measurements.

M1 remains gated on these integration results. Only an experimental fixture viewer UI exists; no application control plane, hosted service, training pipeline or production deployment has been created.

The separated supervisor probe passed in 0.63 seconds in one local sample using that earlier image. Its run-specific report and protected fixture files remain under ignored `.local/m0/control/`. This is not a performance benchmark.

The default suite now passes 147 tests (18 Rust, 127 Node, 2 Python), plus formatting, Clippy, build and documentation checks. The separated native probe completed allow, deny, revoke, granted listing and ungranted listing through actual Codex callbacks with a synthetic model stream. See [native approvals and measurements](native-tools.md) for scope and reproduction.

[Reconnect, private screen and cancellation](recovery-privacy.md) adds durable logical-call replay protection, screenshot suppression across restart, and a whole-container termination probe with uncooperative child/grandchild processes. The four container probes remain offline and synthetic.

[Local worker lifecycle](worker-lifecycle.md) verifies container IDs from host-owned cidfiles, enforces explicit dynamic-tool grants, and confirms termination through the viewer HTTP cancellation path.

The Ollama readiness batch rechecked the installed 0.34.1 service and rejected a cloud alias without inference. Its new runner is fully exercised against a synthetic HTTP server. The four earlier container probes were not rerun for this host-only adapter change; their image evidence above is retained from the prior batch.

The [crash-boundary batch](durable-control.md#crash-boundary-qualification) strengthens journal validation and tests actual supervisor process loss. Its checks run against the freshly built host Rust binary. The container image above predates this validator change and was not rebuilt or requalified in this batch.

The subsequent [Linux runtime requalification](worker-lifecycle.md#linux-runtime-requalification) rebuilt the image, passed all 16 recovery cases inside Linux, and reran all four existing container probes with stricter worker resource/process binding. Its image ID and samples supersede the earlier image evidence above for the current runtime. No live inference was performed.

[Approved workspace text reads](workspace-read.md) adds a third granted native tool and four Codex callback scenarios. The rebuilt image passes all six explicit container probes, including Linux workspace and recovery suites. That checkpoint passed 90 default tests; no live inference or personal file access occurred.

The [Rust result archive](result-archive.md) now persists validated native-tool output before settlement and verifies scoped readback. The Linux archive suite and five other runtime probes pass on the newer image recorded there. Workspace code was unchanged; its earlier dedicated Linux suite evidence is retained. No inference or production artifact service is qualified.

Journal format 5 now commits result references with settlement. The [archive report](result-archive.md#settled-result-index-and-recovery) records 12 passing Linux archive/index cases, nine native callback scenarios with supervisor-replacement readback, and the current image. Six selected container probes passed; old fixture journals were not migrated or deleted.

[Scoped result access](result-access.md) adds read-only loopback capabilities with absolute expiry and revocation. All nine native scenarios passed on the unchanged image; three successful results were retrieved over HTTP after supervisor replacement. Other container probes were not rerun for this host-only change.

[Recovery evidence assessment](recovery-assessment.md) now distinguishes recorded settlement from verified but unsettled output, unavailable output and unknown execution. Its explicit CLI recovers an existing journal under exclusive ownership; assessment never retries or clears pending work. Container probes were not rerun for this host-only change.

[Fresh termination evidence](worker-lifecycle.md#fresh-termination-evidence) now feeds recovery report version 2. The extended cancellation probe verifies worker absence after Rust supervisor replacement while saved but unsettled output still requires outcome review. Cached stop results cannot bypass fresh inventory.

[Durable reviewed recovery](reviewed-recovery.md) now records accepted output or an explicitly closed unknown outcome separately from normal settlement. Journal format 6 is qualified on the rebuilt image through seven selected container probes. Reviewed output survives restart with provenance; cancelled controllers stay cancelled. This supersedes the earlier runtime image for current journal experiments.

## Current Codex-only batch

On 2026-09-18 the local suite passed 153 tests (18 Rust, 133 Node, 2 Python), formatting, Clippy, build and documentation checks. [Fresh-process worker recovery](recovery-worker.md) adds engine-bound read-only reconstruction and passes the real-container cancellation probe. The [Codex subscription protocol probe](codex-subscription.md) confirms managed login schemas and an isolated logged-out native app-server. Neither probe performs authenticated inference. The rebuilt image is recorded in those reports. Alpha gates are maintained in the [exit checklist](exit-checklist.md), which supersedes earlier three-provider and messaging requirements.


The [native credential boundary batch](codex-credential-boundary.md) passes standalone sandbox and app-server `exec_command` canary checks on Codex 0.154.0. The isolated profile retains enforced AppArmor, deny-default seccomp, zero outer capabilities and no-new-privileges. The current image and policy hashes are recorded in that report; this does not requalify unrelated probes on the new image. All 157 default tests, formatting, Clippy, build and documentation checks pass. No subscription login, real credentials or live inference occurred.

The [native file-tool extension](codex-credential-boundary.md#native-file-tool-extension) adds command-write, patch and image canaries with positive workspace controls. All pass offline under the pinned GPT-5.5 tool configuration. Code-mode model configurations and live subscription access remain separate gates.

The [provider-egress experiment](provider-egress.md) adds eight deterministic local tests and an explicit unauthenticated public TLS probe from an isolated container network. It does not qualify native authentication or inference.

The [dedicated auth-store experiment](codex-auth-store.md) adds three local checks and qualifies synthetic volume persistence across two replacement containers with protected configuration/canary read-write denials. Real owner storage and login are not yet created. The default suite now has 168 tests.

The [workspace disk-limit experiment](workspace-disk-limit.md) enforces a 64 MiB backing-file ceiling, verifies `ENOSPC` without loss of existing fixture data, recovers writes and preserves results across container replacement. It is not yet integrated into the default bind-mounted worker launcher.

The [sustained offline resource baseline](resource-baseline.md) passed 51 verified native command/browser cycles over idle, active and cooldown phases, with zero OOM kills and 212.04 MiB peak charged memory. These synthetic measurements do not establish live inference performance or minimum host sizing.

The [Codex-only runtime rebuild](distribution-inventory.md#codex-only-rebuild-verification) removes the historical Claude SDK and platform binary from active packaging. Installed npm packages fall from 107 to four; native/browser, credential-boundary, synthetic auth-store and provider-egress regressions pass on the new immutable image. Historical evidence above remains tied to its original versions and images.

The [live subscription checkpoint](codex-subscription.md#verified-live-subscription-checkpoint) now verifies owner-authorized credential import, native account recognition, an actual streamed GPT-5.5 response and separate managed device challenge/cancel through the restricted gateway. The missing system CA bundle was fixed without disabling TLS verification. Four additional deterministic checks bring the default suite to 172 tests. M0 still needs live tools, approval/error, interruption and continuation evidence.
