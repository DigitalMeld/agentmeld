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
no incremental compilation and no debug symbols. Compilation completed successfully in 5m 14s. The upstream regression test
has not been compiled or run: creating a reusable test-builder snapshot and an
initial runtime packaging attempt exhausted the VM Docker disk. Failed packaging
artifacts were removed; the public source and compiled experimental runtime remain
available locally. The disposable compilation cache was later removed. A smaller stripped binary was packaged successfully. Host free
space had also fallen to approximately 3 GiB, so further compilation stopped.
The subsequent documented cleanup restored approximately 17 GiB of host space;
the upstream test has not yet been resumed. The dedicated VM temporarily used 8 GiB rather than
4 GiB for this build. Cleanup restored the original configuration from the
recorded settings; byte comparison against the backup under ignored
`.local/m0/config-backups/` shows no differences.

## Remaining qualification

1. Provide sufficient build space and run the upstream targeted regression through its
   `just test` harness; verify execution rather than a skip.
2. Completed: identical native command diagnostic passes on the patched binary.
3. Credential isolation, process replacement and live command delivery pass.
   Investigate the running-command interruption failure described below.
4. Exact binary/image hashes and upstream notices are recorded; do not change
   runtime pins until the upstream regression and remaining checks pass.
5. VM configuration restoration is verified; finish the remaining qualification
   before updating M0 completion status.

## Verified patched runtime evidence

Experimental image: `sha256:fdd0e186168169deb31435a37bbe11771960804a40b3193149bbe996c750bc26`.
Stripped binary SHA-256: `cf2131e5cc8a444fea6d610d46082e600f270d8ba33a724b92adc678f9516887`.
The selected `agentmeld-m0:local` tag remains unpatched.

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
documentation checks). They do not substitute for the unrun upstream test.

## Control-check limitation

The patched image passed allow, deny and interruption while awaiting approval,
but failed the running-command interruption stage. An immediate unpatched
baseline comparison passed all four stages. The coarse report does not establish
the cause; treat this as an unresolved qualification failure, not a proven patch
regression or a pass. Added sanitized `runningCheckpoint` labels distinguish
waiting for a child, process tracking, interruption and stopped-process checks
on the next run. That refined diagnostic has not yet been executed.

Evidence: `live-control-patched.log` and `live-control-baseline.log` under ignored
`.local/m0/patch-build/`. No runtime activation is authorized by these results.

## Build storage follow-up

The owner requested immediate cleanup after the build attempts increased disk
usage. Qualification was stopped. Cleanup targets only inventoried AgentMeld
images, disposable Codex builder containers and duplicate binaries. The selected
runtime, one compiled patch candidate, credential store, retained workspaces,
source patch and compact evidence are preserved. See [build storage](build-storage.md)
for the verified cleanup result and the policy for subsequent build cycles.
