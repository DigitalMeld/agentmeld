# Native failed-command lifecycle patch

## Decision and current state

On 2026-09-18 the owner authorized preparing a scoped Codex dependency patch for
the missing failed-command UI event. The artifact is prepared against Codex
0.154.0 revision `6b9826e3aa83b1a5947db50f4332cb9c65f1b340` in
[`infra/m0/patches`](../../infra/m0/patches/README.md). **It is compiled and partially qualified, but not
selected by the runtime image. M0 remains incomplete.**

No sandbox or approval bypass and no reconstruction of product events from
conversation history is introduced. The exception ends when an upstream release
passes this regression and the existing boundary checks.

## Alternatives tested

The native offline diagnostic ran successful exit 0 and failed exit 23 commands
with `features.unified_exec` both true and false. Codex 0.154.0 and the separately
built stable 0.155.0 comparison image both delivered exit 23 to the model without
a corresponding command-result UI item. Both configurations still used
`exec_command`; the false flag did not establish a different shell execution
path. Both matrices correctly exited nonzero. No version upgrade was adopted.

Ignored local evidence: `.local/m0/command-comparison.log` and
`.local/m0/codex155-comparison.log`. The 0.155.0 comparison image is
`sha256:45db963d8fd0d7fe8440912514d11d2a0078f35ba502a11ec07f87821770c5a4`.

## Proposed owning-boundary correction

A fast nonzero sandboxed process can return `SandboxDenied` with captured output
before the normal unified-execution startup event is emitted. The proposed
change uses the existing native event emitter to deliver begin and failure/end
with that captured output, then preserves the existing process-ID cleanup and
error return. Other startup errors are unchanged.

The added upstream regression requires exactly one begin event, one end event
with exit 23, and a model-facing tool result with exit 23. Source inspection is
not proof that the test or live diagnostic passes.

## Build evidence

Upstream `just fmt` completed. The first locked Linux source build stopped before
compilation because the release manifest uses workspace version 0.154.0 while
the checked-in lockfile uses 0.0.0. A disposable offline metadata resolution
changed only 150 workspace package versions among 1,481 package records; all
external dependencies, sources, checksums and dependency lists were unchanged.
The fully regenerated lockfile from an earlier diagnostic was discarded.

After that narrow normalization, `cargo build --locked -p codex-cli --bin codex`
entered compilation in a disposable Linux builder using Rust 1.95.0, two jobs,
no incremental compilation and no debug symbols. Compilation completed successfully in 5m 14s. A stripped binary was packaged
and qualified as described below. The first test-builder snapshot exhausted
Docker storage; subsequent builds reused one disposable cache without snapshots.

## Remaining qualification

The corrected upstream regression now has verified unpatched failure and patched
success. The broader targeted suite retains three baseline failures detailed
below; the full upstream workspace suite has not been run. Before activation,
finish reproducible source-build/runtime pinning and the remaining M0 audit.
The selected runtime stays unpatched. Temporary build resources are removed
after qualification; see [build storage](build-storage.md).

## Verified patched runtime evidence

Experimental image: `sha256:fdd0e186168169deb31435a37bbe11771960804a40b3193149bbe996c750bc26`.
Stripped binary SHA-256: `cf2131e5cc8a444fea6d610d46082e600f270d8ba33a724b92adc678f9516887`.
The last selected `agentmeld-m0:local` image was unpatched. After build cleanup and VM restart, neither baseline nor candidate is present locally; see [storage readback](build-storage.md#regression-build-cleanup-readback). The hashes below identify tested historical artifacts.

- Offline command matrix: all four exit 0/23 and feature-flag cases pass. Each
  case reports exactly one command-result item with the expected exit code and
  the unchanged model-facing result. This is red/green evidence against the
  unpatched 0.154.0 and 0.155.0 matrices above.
- Existing native file/credential boundary fixture passes.
- Live GPT-5.5 subscription execution passes: successful command, exit-23 event
  and model result, process replacement and conversation continuation.
- These probes use the existing named AppArmor policy and seccomp digest
  `f83a12f2118b84e27e85c075a587d655d3538df0e52762414f2ba808c9af3225`.
  No sandbox or approval setting was weakened.

Sanitized logs remain in ignored `.local/m0/patch-build/`: `build.log`,
`command-patched.log`, `boundary-patched.log`, `live-execution-patched.log`.
The provider probe now accepts an explicit `--image` argument so experimental
qualification does not require retagging the selected runtime. Example:

```sh
node scripts/probe-provider-egress.mjs --context colima-agentmeld-m0 \
  --image agentmeld-m0:codex-event-patch --execution
```

AgentMeld's default local checks pass (194 tests plus formatting, lint, build and
documentation checks). They do not substitute for full upstream qualification.

## Control-check evidence and limitation

The first patched live control probe failed during running-command interruption,
while an immediate unpatched comparison passed. Its exact failure checkpoint
cannot be recovered. Two subsequent instrumented interruption-only runs passed.

Source inspection then established that Codex intentionally preserves background
terminals across turn interruption. The corrected [control probe](live-control.md#explicit-terminal-cleanup-follow-up)
requests explicit terminal cleanup and verifies stopped processes and stable
heartbeats. All four live control cases pass in `control-clean.log`.
This establishes the required cancellation protocol, not the cause of the
earlier unclassified failure. No selected runtime was activated.

## Upstream regression evidence

The integration-test compilation exceeded a 3 GiB container limit (one OOM kill).
Reusing the same cache with a temporary 7 GiB limit completed compilation.
The first sandboxed tests aborted because Cargo had not installed the bundled
`codex-resources/bwrap` beside the test executable. The existing upstream sandbox
test also failed. Supplying the retained runtime's exact helper resolved that
harness issue without changing sandbox policy. Helper SHA-256:
`58bd88f39d02a0b5ac553c2f334edfff1ec74afb9b8f4233dfc5b69225038f92`.

An initial plain exit-23 test passed on unpatched source and was insufficient.
The final test, `sandboxed_startup_denial_emits_complete_command_lifecycle`,
attempts a forbidden write under read-only permissions, then exits 23. It
asserts the write was prevented, exactly one begin/end pair with exit 23, and
the unchanged model-facing exit result.

- Unpatched production source: regression fails with an empty lifecycle list.
- Patched production source: regression passes (0.224 seconds).
- Tests ran as UID 1000 on Linux aarch64 with neither sandbox skip environment
  variable present. The selected regression exercised its assertions.
- Broader patched unified-exec suite: **40 passed, 3 failed** across 43 tests.
  The baseline comparison also reports 40/3, using the earlier plain-exit test.
  The separate final denied-write baseline run provides the actual red proof.
- Both broader comparisons fail `unified_exec_enforces_glob_deny_read_policy`,
  `unified_exec_network_denial_emits_failed_background_end_event`, and
  `unified_exec_short_lived_network_denial_emits_failed_end_event`.
  The network failures differ: baseline times out waiting for events; patched
  events report exit 1 where those fixtures expect -1. These remain limitations,
  not a green suite.
- Some platform-specific cases return early on Linux. Counts do not establish
  Windows coverage. The full upstream workspace suite has not been run.

Ignored evidence in `.local/m0/patch-build/`:
`upstream-denial-baseline.log`, `upstream-denial-patched-suite.log`,
`upstream-unified-exec-baseline.log`, and `upstream-regression-with-bwrap.log`.
The latter separately verifies the existing sandbox and interrupt-preserves-session
tests; its original plain-exit test is superseded by the final regression.
