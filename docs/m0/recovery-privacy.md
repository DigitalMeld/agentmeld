# M0 reconnect, private screen and cancellation

Current scope: Codex subscription alpha only. Earlier Claude/Ollama/messaging next steps below are historical and deferred. The [M0 exit checklist](exit-checklist.md) owns current gates.
Date: 2026-09-17. This batch extends local qualification without model credentials, personal browser data or messages. It does not add a production identity service or secure credential-entry transport.

## Durable request identity

Journal format 6 retains a bounded ledger of accepted proposal identities. Rust hashes the workspace, worker, thread, turn and logical tool-call ID, then records that key in the same synced snapshot as the proposal. The Codex adapter no longer includes the transport envelope ID in this identity. Reconnecting a broker or restarting the supervisor cannot obtain another approval for the same logical request by changing its transport ID or arguments.

The ledger retains proposals regardless of whether they were allowed, denied, expired, revoked or abandoned. It never evicts old keys: after 256 accepted proposals, new proposals fail closed. The existing 16 MiB journal cap can also stop writes. This small qualification journal has no compaction or reset API. Earlier formats are preserved and rejected, with no implicit migration.

Identity is scoped to the operator-owned journal and stable worker identity supplied by the trusted host. A new worker identity, a new journal or a different logical call is a different request. This is replay protection, not authentication, intent deduplication or exactly-once external effects. Production reconnect must retain this scope and reconcile uncertain effects before resuming.

## Private screen

After taking human control, the viewer can hide the screen. Rust persists a private flag, clears the prior observation digest and advances the generation. Agent resume and brokered human input are rejected while hidden. New screenshot requests are rejected before capture. A capture already in progress is discarded if its generation changes; the transition waits for queued observation work before acknowledging. The viewer removes its displayed image and stops polling frames while hidden.

Disconnect and supervisor restart retain the private flag. Recovery stays paused; taking human control again does not reveal the screen. Only an explicit reveal at the current generation clears it. Reveal stays in human control. Resuming the agent still requires a fresh observation.

This suppresses observation through the tested viewer/control path. It does not erase screenshots already delivered, memory held by a browser, or files captured through another path. It does not stop arbitrary native code in the container from reading its own browser state. There is no keyboard/password-entry transport, secret detector or secure credential-entry claim. The fixture uses a counter page and no sensitive data.

## Container cancellation

The explicit cancellation probe starts a child and grandchild that ignore SIGTERM and append synthetic heartbeat records to their disposable workspace. The authenticated viewer endpoint now persists cancellation and stops only the verified owned container ID with a one-second grace period, and verifies its immutable ID is absent from a successful Docker inventory. It also checks that heartbeat bytes remain unchanged and that supervisor replacement retains cancelled state.

Container absence is the completion condition in this probe. Killing the host-side Docker client alone is not proof of workload termination. Failure to stop or read back container state fails the probe; it must not be reported as completed cancellation. Docker and the host account remain trusted.

This qualifies whole-container termination on the dedicated local Linux ARM64 runtime, including uncooperative descendants. It is now wired into the separated viewer HTTP path through [owned-worker lifecycle](worker-lifecycle.md), does not undo external effects, and does not qualify remote runtime outages or stopping individual tasks inside a shared container.

## Reproduce

Use the binary/image build and seccomp preparation in the [M0 guide](README.md), then run:

```sh
sh scripts/check-local.sh
python3 scripts/probe-container.py --context YOUR_CONTEXT
node scripts/probe-separated.mjs --context YOUR_CONTEXT
node scripts/probe-native.mjs --context YOUR_CONTEXT
node scripts/probe-cancellation.mjs --context YOUR_CONTEXT
```

The all-in-one Chromium probe exercises the Hide screen/Show screen UI and writes a synthetic `viewer-private.png` alongside its usual screenshot. The separated probe verifies frame rejection over the authenticated host HTTP endpoint. The default suite covers restart persistence, stale reveal, blocked input/resume, in-flight screenshot revocation, reconnect deduplication and ledger exhaustion. No live inference or messaging is involved.

At the original recovery checkpoint, 48 default tests (13 Rust, 33 Node, 2 Python), formatting, Clippy, build and documentation checks passed. All four container probes passed. The hidden viewer rendering was visually inspected. Cancellation completed in 285 ms in one local sample, including the 200 ms post-stop heartbeat observation. The tested image is `sha256:391a6baf59845c75045e7115dd230b9001e5c429f1fb47e0b7b871a7e830d898`; it is not published. Reports, journals and screenshots remain under ignored `.local/m0/`. The newer worker-lifecycle qualification adds verified local worker identity, tool grants and HTTP cancellation. Next M0 work includes remote authentication, broader native tools, scoped provider credentials/egress, live inference, workspace quotas and designated iMessage setup.

## Separate-container follow-up

The [browser isolation qualification](browser-isolation.md) now exercises a separate browser service/profile and native Codex harness with synthetic private entry, denied native profile access, preserved session state and a fresh observation before resume. The original same-container warning above still applies to the older combined fixture. A real owner input transport remains open.
