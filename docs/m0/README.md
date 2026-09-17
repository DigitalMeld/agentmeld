# M0 local qualification

This milestone has begun. The Rust crate contains experimental contracts and tests; it is not a deployed control plane. Full provider execution, credentials, persisted approvals, viewer takeover, and iMessage delivery remain separately qualified capabilities. See [results](results.md) for current evidence.

## What exists

- Rust action approval/state fixture with payload binding, expiry, one-time admission, cancellation, and controller generations.
- Bounded JSONL decoding and initial Codex, Claude SDK, and Ollama event handling.
- Ollama tool-stream accumulation that withholds calls until a complete terminal frame, plus a strictly limited integer-sum fixture tool.
- A Node HTTP-loop experiment that executes the Rust tool and feeds the result into the next model turn. It uses an injected fixture transport in default tests; this is not the final native Rust inference client.
- Offline Docker argument generation using an immutable local image ID, one operator-owned workspace, non-root UID, read-only root, no network, seccomp default, dropped capabilities, and CPU/memory/PID limits.
- A one-to-one iMessage routing fixture with explicit account/chat/sender binding, echo suppression, bounded deduplication and revocation. It is not a BlueBubbles client or a messaging connection.
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

Use a dedicated local Docker context selected explicitly by the operator. Do not silently switch the global Docker context or start an unrelated runtime. The image is local development infrastructure; no image is published.

```sh
docker --context YOUR_CONTEXT build -f infra/m0/Dockerfile -t agentmeld-m0:local .
cargo build --locked
python3 scripts/probe-container.py --context YOUR_CONTEXT
```

The probe runs real Codex app-server initialization, empty-session readback and missing-resume rejection. It also checks real Claude SDK startup without credentials, tests an isolated Chromium fixture with renderer sandboxing enabled, verifies in-container OS controls, and writes an owned workspace marker. All provider inference is unavailable in this offline image by design.

Run it again to verify the workspace marker survives replacement of the container. A failed probe exits nonzero and retains details. The launcher records stdout, stderr, immutable image ID, exit code and elapsed time under `.local/m0/evidence/`; these files are ignored by Git. OS controls do not establish hostile-tenant isolation, and missing paths are not a general escape test.

The bind-mounted workspace has no hard disk quota in this experiment. The 256-MiB `/tmp` mount is bounded, but retained files can consume host disk space. Storage quotas, full process cancellation, egress mediation and a production secret broker remain M0 work. Never use the fixture launcher for untrusted workloads.

## Intentional limits

The approval and channel gates are in-memory single-process experiments. They do not yet authenticate actors or persist decisions across restart. A controller generation does not prove that an actual browser has stopped receiving input. Native provider resume, approval callbacks, model-dependent tools, and task cancellation need live qualified tests before being advertised.

The container has no host credentials and no network. A real authenticated provider probe needs a separately configured, scoped credential path and reviewed egress. Do not copy a host's `.codex`, `.claude`, keychain, Messages database, or browser profile to bypass that requirement. Ollama cloud aliases are not local-model proof.

The iMessage transport still requires a designated test identity and explicit OS/account setup. Default checks use only `example.test` identities; no messages are sent.
