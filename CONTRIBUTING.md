# Contributing

AgentMeld is in the M0 qualification stage. Start with the [roadmap](docs/specs/roadmap.md) and [M0 guide](docs/m0/README.md). The public repository currently contains design documents and experimental contracts, not a production agent service.

## Local checks

Install the pinned Rust toolchain and Node.js 24 or newer, then run:

```sh
sh scripts/check-local.sh
```

The default suite uses disposable fixtures and requires no provider credentials, Docker daemon, paid inference, or messaging account. Container probes are separate, opt-in experiments. Do not add GitHub Actions or external GitHub-connected CI.

## Changes

Keep changes scoped to a stated behavior. Include local verification evidence, dependency/license changes, and limitations in the pull request. Never include credentials, personal conversations, browser state, generated `.local/` evidence, or runtime volumes. Native harness versions and schemas must be qualified together.

Do not claim model, browser, or tenant isolation from a mocked transport. Do not weaken a failed security control to get a successful demonstration. Prefer a small reproducible failure report and a fix at the correct boundary.

The project license is awaiting owner selection. Resolve that before accepting outside code contributions; no contributor license terms are established by this document.
