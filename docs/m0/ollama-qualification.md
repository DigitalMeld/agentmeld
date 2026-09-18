# M0 local Ollama readiness and qualification runner

Current scope: Codex subscription alpha only. Earlier Claude/Ollama/messaging next steps below are historical and deferred. The [M0 exit checklist](exit-checklist.md) owns current gates.
Date: 2026-09-17. Scope: read-only local-model preflight, bounded streaming, durable Rust fixture execution and a reproducible opt-in inference runner. No real local model has been qualified in this batch. The installed Ollama 0.34.1 service currently exposes only `glm-5.2:cloud` and `kimi-k2.7-code:cloud`; neither is accepted as a local model.

## Readiness before inference

The runner accepts only an explicit HTTP origin using literal `127.0.0.1`, with no credentials, path, query or fragment. It disables redirects. Preflight reads `/api/version` and `/api/tags`, requires one exact installed model tag with a 64-character digest, positive weight size, GGUF format and no remote-model/remote-host fields, then checks `/api/show` for local format and tool capability. Cloud names, remote metadata, absent models and missing tool capabilities fail before `/api/chat` is called. Metadata responses are limited to 1 MiB and each request has a five-second deadline.

Before each qualification case and after the run, the selected digest is checked again. This detects ordinary model-tag changes; it does not make tag resolution atomic or attest to a model's provenance. The local Ollama service and operator configuration remain trusted. A loopback URL and metadata checks are not an egress sandbox or proof that a compromised service cannot contact another host.

The preflight follows Ollama's [model inventory API](https://docs.ollama.com/api/tags). A small proposed qualification target is [qwen3:4b](https://ollama.com/library/qwen3:4b), listed with tool support and a roughly 2.5 GB download. Its suitability for these tests is unverified until actual inference passes. Model installation is a separate operator action; the runner never pulls a model or falls back to a cloud alias.

## Bounded tool loop

The loop limits a run to at most eight turns (four by default), a configured overall deadline, 1 MiB of output and 4,096 frames per turn, and eight tool calls per turn. The qualification runner uses a 120-second deadline for each case. It requests deterministic sampling, disables thinking, caps generated tokens at 512 and sets `keep_alive: 0`. These are request parameters, not proof of immediate model unload or service resource isolation.

The complete streamed tool batch must validate before any execution. Only `sum` with exactly two safe integers is accepted; extra arguments, unsafe integers and malformed results are rejected. Calls are withheld until the terminal frame and complete stream validate. Abort checks run before stream processing, before tools and after tool execution. A hanging HTTP stream is aborted by the overall deadline. An executor is also expected to honor its supplied abort signal; the supplied Rust fixture executor does.

The synthetic arithmetic executor records proposal, allow/deny, dispatch and settlement through the existing Rust journal. A denied request executes no tool. Execution failures or interruption after dispatch preserve the unresolved ticket and pause the authority, without automatic retry. The compiled Rust arithmetic subprocess receives only synthetic input and a restricted environment. This host-side arithmetic test does not qualify arbitrary code execution or replace the container worker boundary.

## Commands

After the normal local Rust build, inspect a model without inference:

```sh
node scripts/probe-ollama.mjs --endpoint http://127.0.0.1:11434 --model EXACT_INSTALLED_TAG
```

Explicitly run real inference against that selected local model:

```sh
node scripts/probe-ollama.mjs --endpoint http://127.0.0.1:11434 --model EXACT_INSTALLED_TAG --run
```

The three cases require: a real tool call whose approved Rust execution returns 5 and a final answer containing 5; a tool request denied before execution; and caller cancellation at the first response chunk with no tool execution and durable cancelled state. Failure in any case fails qualification. Stream cancellation proves that this caller stops consuming output and dispatching tools, not that server-side GPU work has stopped.

The reviewer decisions are automated fixture decisions, not a human approval UI. Reports contain model/runtime identity, case outcomes and durations, with no saved credential values or general conversation transcripts. Each run preserves its report and journal under ignored `.local/m0/control/<run-id>/`.

`--run-fixture` is reserved for a synthetic loopback provider in the default test harness. Its report explicitly says `fixtureTransport: true` and `liveInferenceQualified: false`, even when all transport checks pass. Default tests never access the user's Ollama service, pull a model or send paid-provider requests.

## Evidence and remaining boundaries

The actual installed cloud alias was rejected with `explicit local model required`; no inference request was sent. Local tests cover exact model selection, remote metadata rejection, response bounds, stalled HTTP, mid-stream abort, full-batch validation, durable allow/deny execution and the CLI's complete three-case workflow against a synthetic HTTP provider.

Verified: 67 default tests (13 Rust, 52 Node, 2 Python), formatting, Clippy, build and documentation checks pass. This batch changes host-local Ollama qualification; previous container image/probe evidence remains unchanged.

Live qualification is pending a selected installed local model. The download question is separate from the repository implementation. No personal provider authentication or existing model configuration was imported or modified. Scoped Claude/Codex credentials, mediated provider egress, real harness continuation and remote worker authentication remain open M0 tasks.
