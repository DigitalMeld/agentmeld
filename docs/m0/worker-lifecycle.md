# M0 local worker identity, grants and cancellation

Current scope: Codex subscription alpha only. Earlier Claude/Ollama/messaging next steps below are historical and deferred. The [M0 exit checklist](exit-checklist.md) owns current gates.
Date: 2026-09-17. Scope: trusted local Docker runtime, host-owned control files, three explicit Codex dynamic tools and authenticated viewer cancellation. This is not remote worker authentication, a production grant service or live inference.

## Local identity binding

The host Docker client writes an immutable container ID to a fresh cidfile in the owner-only control directory. The worker cannot access that directory. Before binding tool execution, the host inspects that ID through the explicitly selected Docker context. It requires the exact image ID, running state, M0 ownership label, UID/GID 1000, nonprivileged read-only root, disabled network and exactly one bind mount at `/workspace` with the expected source. It also requires the launcher’s exact 1 GiB memory, one CPU and 256-PID limits, an init process, all capabilities dropped with none added, no-new-privileges, private IPC, no shared PID namespace and no passed-through devices. Explicit unconfined seccomp/AppArmor options are rejected. These checks use Docker inspection metadata; they do not authenticate a policy file or independently prove kernel enforcement.

The owned worker uses this immutable ID for scope checks and termination. A claimed name or identity in model output is not accepted as runtime identity. Native approval scope now records the verified container ID and full workspace path. A replacement container has a different scope and requires explicit new binding. Reconnecting to the same worker/journal retains the existing replay fence.

This establishes the tested local launch binding through a trusted Docker client, cidfile and dedicated stdio connection. It does not authenticate a remote machine, user, native process inside the container or an independently supplied transport. The host account, Docker daemon and launch code remain trusted. The existing sandbox/renderer probes separately verify the full execution policy; binding checks are not an exhaustive runtime security audit.

## Explicit tool grants

The native broker defaults to no grants and checks its host-configured tool set before creating an approval. The owned worker independently checks that the tool is granted and that workspace and worker scope match. These checks run again before dispatch. Revocation after review prevents execution and leaves the unused ticket revoked. Cancellation permanently revokes that owned-worker object's grants, even if runtime shutdown cannot be confirmed.

Three tools are implemented:

| Tool | Arguments | Result and limits |
| --- | --- | --- |
| `fixture_sum` | Exactly two safe integers | Validated safe-integer sum |
| `workspace_list` | Empty object; no path selection | Sorted immediate workspace entry names, at most 128 entries, at most 255 bytes each |
| `workspace_read` | One immediate filename | Up to 64 KiB of UTF-8 text, byte count and SHA-256; requires filename-bound approval |

The listing implementation iterates the bound workspace root, does not recurse, does not follow entry symlinks and does not read file contents. It rejects an oversized listing rather than silently truncating it. The broker rejects malformed names, control characters, duplicates, path separators and additional result fields. Filenames are still untrusted data. A compromised worker can lie about its workspace; schema checks cannot prove filesystem truth.

Grant configuration is supplied by trusted host code. No model-supplied grant, shell operation, arbitrary path or control-plane command is admitted through this adapter. File contents are available only through the [bounded text-read contract](workspace-read.md). Codex built-in tools and arbitrary code running in the container remain outside this narrow dynamic-tool broker. The older fixture-only callers can still use an explicitly trusted raw computer; the native container probe uses the owned-worker binding.

## Confirmed cancellation

The separated browser control now accepts an owned-worker lifecycle handler. Its existing authenticated `/cancel` endpoint first persists cancellation in Rust, then terminates that immutable container ID. Success includes `termination: stopped` only after a successful runtime inventory confirms the ID is absent. The transport is then invalidated and queued work cannot obtain fresh journal admission.

If stop fails and the container remains present, or runtime inventory fails, the endpoint rejects the operation. Cancellation remains durable and grants remain revoked, but termination is unconfirmed. A subsequent cancellation can reconcile a lost stop response using fresh inventory. Concurrent termination attempts share one operation. A durable cancelled state alone is not proof of process termination; the stop receipt is a live runtime observation and is not persisted in this journal format.

The cancellation probe now uses the viewer HTTP endpoint instead of calling Docker stop directly as its tested action. Its child and grandchild ignore SIGTERM, produce heartbeats before cancellation, then stop producing them after the endpoint confirms container absence. Rust replacement still reads cancelled state. Failure cleanup remains scoped to that probe's unique container.

The all-in-one comparator has no external lifecycle owner and returns logical cancellation only, without a stopped receipt. The native `revoke` scenario also remains a logical approval-revocation test so the native callback can return a denial. Neither is represented as a whole-container stop. Automatic failure cleanup, remote runtime recovery and production lifecycle orchestration still need qualification.

## Verification and continuity

Use the commands in the [M0 guide](README.md) and [recovery probe guide](recovery-privacy.md). The native probe now completes five real Codex callback cases against its synthetic loopback provider: allow, deny, revoke, granted workspace listing and ungranted listing. The latter creates no approval. The listing case verifies a known synthetic workspace filename in the returned tool result.

New default tests cover runtime binding mismatches, foreign scope, missing/revoked grants, termination readback failures and retry, supervisor acknowledgement ordering, grant revocation after review, listing bounds and symlink behavior. No provider credentials, personal files or Messages account are used.

Verified: 58 default tests (13 Rust, 43 Node, 2 Python), formatting, Clippy, build and documentation checks passed. All four container probes passed against local image `sha256:b588c24b989f6119444f002fe7433a8ed14f5528866a8c6e2085ca3e035b4c17`, which is not published. The HTTP cancellation sample took 313 ms including a 200 ms post-stop heartbeat check. Run-specific evidence remains under ignored `.local/m0/control/` and `.local/m0/evidence/`. Remaining M0 work includes remote worker authentication, broader native-tool policy, scoped provider credentials and mediated egress, live provider/local-model qualification, workspace quotas and designated iMessage setup.

## Linux runtime requalification

Rebuilt local image `sha256:44333c79a16c24cb8fe09ff5c6afa23d7275d935fcc0a293a8b7218648d23e91` includes the stricter journal validator and recovery test runner. All 16 recovery cases pass inside Linux ARM64 under Docker-default seccomp. The four existing probes also pass on this image: native startup/browser, separated host supervisor, five Codex dynamic-tool callback scenarios with a synthetic provider, and HTTP whole-container cancellation. The separated viewer completed in 0.726 seconds; cancellation took 302 ms including the 200 ms heartbeat observation. These are single fixture samples, not performance guarantees.

The default suite passes 84 tests (13 Rust, 69 Node, 2 Python), plus formatting, Clippy, build and documentation checks. New worker-binding regressions reject removed/excess resource limits, missing capability drops, added capabilities, unconfined security options, shared host namespaces and device access. No dependencies or credentials were added. The dedicated VM was stopped after the probes and its container inventory was empty. The image remains local and unpublished.

The Linux recovery tests use tmpfs journals and do not establish power-loss durability. Real provider inference, remote-worker authentication, disk quotas and production recovery remain open. Reproduction commands and retained evidence locations are in the [M0 guide](README.md).

The subsequent [workspace-read batch](workspace-read.md) expands native qualification to nine scenarios and records the newer image and 90-test local suite.

## Fresh termination evidence

The host adapter now exposes a scope-bound observation of the original worker in a fresh runtime inventory. It checks full immutable IDs and rejects malformed/duplicate inventory entries. Failures return `unavailable`, not absence. Observation does not stop or revoke the worker. Every termination call now confirms inventory, including calls after a previously successful stop; cached success cannot hide a later inventory failure or contradictory presence. Concurrent stop requests still coalesce. Repeated successful calls avoid another stop command but obtain fresh readback.

The default suite passes 132 tests (18 Rust, 112 Node, two Python), including eight worker lifecycle tests and thirteen recovery assessment tests. New cases cover wrong worker/workspace, malformed inventories, stale stop evidence, and recovery state changes during runtime lookup.

The explicit cancellation probe passed on 2026-09-17 using unchanged local image `sha256:edcb333300d04fb0a1f2b766d42d9fcd9e729ca4d12b3923733fbf0593424db3`:

```sh
node scripts/probe-cancellation.mjs --context YOUR_CONTEXT
```

It verified present-before-stop, HTTP cancellation, container absence, child/grandchild heartbeat cessation, cancelled supervisor replacement, and a [recovery report](recovery-assessment.md) with verified unsettled output and fresh worker absence. The journal remained uncertain and settled retrieval still rejected that output. The cancellation/readback sequence took 338 ms in this one synthetic sample; this is not a benchmark. Evidence is retained under ignored `.local/m0/control/b1f67eb6-46f7-49db-bc55-8a564d3df181/`. No model, personal data or messaging was used. Other runtime probes were not rerun for this host-only change.

The original host binding and dedicated Docker transport must still be trusted. Inventory absence does not prove the absence of external effects, remote work or a compromised runtime. This qualifies Rust subprocess replacement while the host retains its worker binding, not reconstruction after losing the whole host process. Durable reviewed resolution of uncertain actions remains separate work.
