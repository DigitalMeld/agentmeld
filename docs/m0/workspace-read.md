# M0 approved workspace text reads

Date: 2026-09-17. Scope: one bounded dynamic tool through the real Codex app-server with a synthetic model stream. This is not general native-tool mediation or live inference.

## Contract and execution

`workspace_read` accepts exactly `{ "name": "fixture.txt" }`. The name must be one immediate UTF-8 filename of at most 255 bytes. Absolute paths, separators, dot entries, malformed Unicode, control characters and extra arguments are rejected. The root is fixed to the container's trusted `/workspace` mount, not selected by the request.

The tool requires both an explicit host grant and a durable approval bound to the filename and worker/workspace/thread/turn/request scope. Missing grants create no approval. Denial causes no read. Approval authorizes reading that name at execution time, not a specific version of its contents.

The worker opens with `O_NOFOLLOW` and `O_NONBLOCK`, then inspects the opened descriptor. It requires a regular file with one link and at most 65,536 bytes. Symlinks, multiply linked files, directories and named pipes are rejected. It reads at most 65,537 bytes to detect overflow, compares descriptor size/timestamps/link count before and after, and rejects observed changes. The descriptor closes on success or failure.

Content must decode as strict UTF-8 without NUL characters. Empty files and a UTF-8 BOM are preserved. The response contains only `name`, `text`, `bytes` and `sha256`. The host independently validates the filename, byte count, content limit and hash before returning the result to Codex and settling the ticket. An invalid result or failed dispatched read leaves the controller paused with an unsettled ticket under the existing conservative recovery rules.

## Verification

The default suite passes 90 tests (13 Rust, 75 Node, 2 Python), plus formatting, Clippy, build and documentation checks. Six new tests cover text/byte preservation and result binding; invalid paths/arguments; symlinks, hard links, directories, oversized/invalid files; nonblocking FIFO rejection; grants and filename-bound approval; and withholding invalid results.

The seven workspace tests, including the existing listing tests, also pass inside Linux ARM64 under Docker-default seccomp:

```sh
python3 scripts/probe-container.py --context YOUR_CONTEXT --probe workspace --seccomp-profile docker-default --workspace read-linux
```

After rebuilding the local image, `node scripts/probe-native.mjs --context YOUR_CONTEXT` passes nine actual Codex callback scenarios. Four new ones cover allowed text reads, denied reads, ungranted reads and rejected symlinks. All use generated synthetic text; no user files or provider credentials are involved. Native startup/browser, separated viewer, whole-container cancellation and the Linux recovery suite also pass on image `sha256:c5b41f16374757ef0592fa4097b3f518a377b62fcea32eee47a4106e8df83cee`. The image is local and unpublished. Reports remain under ignored `.local/m0/control/` and `.local/m0/evidence/`.

## Limits and next action

Returned content remains untrusted tool data. A matching hash establishes internal consistency, not honesty of a compromised worker. Results and file versions are not yet archived durably. Descriptor checks detect ordinary concurrent changes but do not provide an atomic snapshot against a malicious writer. Parent directories and the mount are trusted; this is not a general host filesystem sandbox. General native built-in tools remain outside this adapter.

Next: versioned artifact storage and result persistence, broader native-tool policy, provider credentials/egress and actual model qualification. Do not advertise arbitrary file access, immutable snapshots or production artifact recovery from this fixture.
