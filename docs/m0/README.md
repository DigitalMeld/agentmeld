# M0 local qualification

This milestone has begun. The Rust crate contains experimental contracts and tests; it is not a deployed control plane. Full provider execution, credentials, production viewer control, and iMessage delivery remain separately qualified capabilities. A narrow browser viewer/takeover experiment now passes. See [results](results.md) for current evidence.

## What exists

- [Reconnect, private screen and cancellation](recovery-privacy.md): durable request IDs, screenshot suppression and an explicit whole-container stop probe.
- [Durable approvals and native Codex callback](native-tools.md), tested with a synthetic model stream and measured locally.
- [Separated supervisor probe](protected-supervisor.md) with host-owned journal/viewer, container-only workspace, bounded responses and payload-bound dispatch.
- [Durable Rust authority](durable-control.md) with exclusive journal ownership, persisted action admission, paused restart and unresolved-action recovery.
- Rust action approval/state fixture with payload binding, expiry, one-time admission, cancellation, and controller generations.
- Bounded JSONL decoding and initial Codex, Claude SDK, and Ollama event handling.
- Ollama tool-stream accumulation that withholds calls until a complete terminal frame, plus a strictly limited integer-sum fixture tool.
- A Node HTTP-loop experiment that executes the Rust tool and feeds the result into the next model turn. It uses an injected fixture transport in default tests; this is not the final native Rust inference client.
- Offline Docker argument generation using an immutable local image ID, one operator-owned workspace, non-root UID, read-only root, no network, an explicit seccomp policy, dropped capabilities, and CPU/memory/PID limits.
- A one-to-one iMessage routing fixture with explicit account/chat/sender binding, echo suppression, bounded deduplication and revocation. It is not a BlueBubbles client or a messaging connection.
- A capability-authenticated, container-loopback screenshot viewer with takeover, fresh-observation resume, stale-input rejection and disconnect expiry. See [scope and evidence](viewer-takeover.md).
- Pinned vendor binaries/SDK/browser dependencies in an explicit container experiment.

## Run deterministic checks

Requirements: Rust 1.95.0 with rustfmt/clippy, Node.js 24+, Python 3. No Node dependencies need installation for these tests.

```sh
sh scripts/check-local.sh
```

If an existing toolchain is installed but not on `PATH`, use its `bin` directory for this shell only. Do not overwrite system configuration merely to run checks.

Replay sample provider frames:

```sh
cargo run --locked -- replay ollama < experiments/fixtures/ollama-tool.jsonl
cargo run --locked -- replay codex < experiments/fixtures/codex.jsonl
cargo run --locked -- replay claude < experiments/fixtures/claude.jsonl
```

Replay is a protocol experiment and never sends messages to providers. The Ollama replay tool is limited to adding two integers; it does not run arbitrary commands.

## Offline runtime probe

The current pinned builder qualifies Linux ARM64 only. Use a dedicated local Docker context selected explicitly by the operator. Do not silently switch the global Docker context or start an unrelated runtime. The image is local development infrastructure; no image is published.

```sh
docker --context YOUR_CONTEXT build -f infra/m0/Dockerfile -t agentmeld-m0:local .
cargo build --locked
python3 scripts/prepare-seccomp.py
python3 scripts/probe-container.py --context YOUR_CONTEXT
```

The probe runs real Codex app-server initialization, empty-session readback and missing-resume rejection. It also checks real Claude SDK startup without credentials, tests an isolated Chromium fixture with renderer sandboxing enabled and an authenticated viewer/takeover flow, verifies in-container OS controls, and writes an owned workspace marker. All provider inference is unavailable in this offline image by design.

`prepare-seccomp.py` explicitly downloads a commit-pinned Playwright configuration over HTTPS, verifies its SHA-256, and generates the browser policy in ignored `.local/m0/seccomp/`. The launcher checks the prepared bytes before every browser-profile run. No upstream source is vendored. See [policy rationale and evidence](browser-sandbox.md).

Use `--seccomp-profile docker-default` to reproduce the original failing browser configuration. This comparison is intentionally expected to exit nonzero on the qualified Linux ARM64 environment. The normal browser profile must pass without adding capabilities or disabling renderer sandboxing.

Run it again to verify the workspace marker survives replacement of the container. A failed probe exits nonzero and retains details. The launcher records stdout, stderr, immutable image ID, exit code and elapsed time under `.local/m0/evidence/`; these files are ignored by Git. OS controls do not establish hostile-tenant isolation, and missing paths are not a general escape test.

The bind-mounted workspace has no hard disk quota in this experiment. The 256-MiB `/tmp` mount is bounded, but retained files can consume host disk space. Storage quotas, full process cancellation, egress mediation and a production secret broker remain M0 work. Never use the fixture launcher for untrusted workloads.

## Separated supervisor and computer

After the image build, local Rust build and seccomp preparation above, run:

```sh
node scripts/probe-separated.mjs --context YOUR_CONTEXT
```

This is the current storage-boundary qualification: Rust and the viewer stay on the host, and the browser stays in the container. See [evidence and limitations](protected-supervisor.md). The earlier all-in-one probe remains useful for native startup and viewer UI comparison, but its in-container journal is not protected from that same container.

Journal format 4 adds a durable request ledger and private-screen state to scoped approvals and payload-bound dispatch. Old M0 journals are preserved and rejected; there is no implicit migration. Each probe creates a fresh synthetic journal.

Run the separate native Codex callback and host measurement probes as described in [native tool qualification](native-tools.md).

## Intentional limits

The channel gate remains an in-memory experiment. Browser ownership and narrowly scoped tool approvals now use the durable Rust journal; production actor authentication remains open. The viewer mediates its own browser operations, and the native adapter mediates one Codex dynamic fixture tool. Native built-in tools, provider resume, live model-dependent tools, and task cancellation need further qualification before being advertised.

The container has no host credentials and no network. A real authenticated provider probe needs a separately configured, scoped credential path and reviewed egress. Do not copy a host's `.codex`, `.claude`, keychain, Messages database, or browser profile to bypass that requirement. Ollama cloud aliases are not local-model proof.

The iMessage transport still requires a designated test identity and explicit OS/account setup. Default checks use only `example.test` identities; no messages are sent.
