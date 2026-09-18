# Scoped Codex qualification patch

Status: **compiled and partially qualified; not enabled in the selected runtime image**.

The owner authorized this dependency exception on 2026-09-18. The patch targets
`openai/codex` tag `rust-v0.154.0`, revision
`6b9826e3aa83b1a5947db50f4332cb9c65f1b340`. Its checksum and removal condition are
in the adjacent JSON manifest. See [qualification evidence](../../../docs/m0/codex-command-event-patch.md).

Apply only to that revision with `git apply --check` followed by `git apply`.
The patch adds native lifecycle emission when unified execution returns a
startup `SandboxDenied` containing actual process output. It does not change
execution, sandbox, approval or model-facing error decisions. A regression test
requires exactly one begin/end pair, exit 23 and the same model-facing result.

The release source sets workspace version `0.154.0`, but the upstream Cargo.lock
retains `0.0.0` for 150 workspace packages. In a disposable builder, normalize
only those workspace version records before a locked build. Reject any change
to external packages, checksums, dependency lists or sources. Do not regenerate
or upgrade the dependency set to work around a locked build failure.

Upstream source is Apache-2.0 licensed. `codex-LICENSE` preserves its license;
`codex-NOTICE` preserves its notice. Changed upstream files are listed in the
patch. This does not select a license for the AgentMeld project.

Before activation, compile and run the added upstream test (verify it did not
skip), demonstrate the native diagnostic fails without the patch and passes
with it, then rerun applicable isolation, approval, cancellation and continuation
probes. Preserve the failing diagnostic until the patch qualifies. Remove this
exception when an upstream release passes the same tests and boundary checks.
