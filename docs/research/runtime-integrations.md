# Runtime and model integration research

Current scope note (2026-09-18): alpha is Codex-only with ChatGPT subscription authentication. Claude Code, Ollama and messaging research below is retained for post-alpha; it does not impose an M0 exit gate. See the [current checklist](../m0/exit-checklist.md).
Research date: 2026-09-17. Status: architecture evidence and recommendations only. No dependencies installed, agent runs started, credentials accessed, or runtime behavior tested. Local inspection used `codex --version`, `codex app-server --help`, and `codex exec --help`; installed CLI reports **0.154.0**. Vendor pages are mutable; implementation must pin versions and verify the selected interfaces.

## Main recommendation

Separate **agent harness**, **model provider**, and **execution environment**. Claude Code and Codex supply agent loops, tools, and conversation handling. Ollama supplies inference and tool-call generation; an application still executes tools and manages its loop. Make these independent choices in the architecture, even if the initial UI offers three simple presets.

Use a Rust control plane and worker supervisor, a small TypeScript Claude Agent SDK bridge, Codex app-server over private stdio, and an Ollama HTTP adapter. Start with isolated Linux containers for a trusted self-hosted owner; qualify a VM boundary before accepting unrelated tenants. Rust does not eliminate model inference, browser, desktop, or virtualization costs.

## Verified integration surfaces

| Integration | Verified interface | State and approvals | Proposed AgentMeld adapter |
| --- | --- | --- | --- |
| Claude Code | Agent SDK exposes Claude Code's loop and tools in TypeScript/Python; other languages can invoke CLI subprocesses. | SDK session resume/fork, permission rules/hooks, runtime approval callbacks, optional partial response events. | Small pinned TypeScript bridge inside the worker boundary; keep lifecycle/policy in Rust. |
| Codex | App-server supports bidirectional JSON-RPC, preferably stdio; CLI also exposes JSONL execution. | Thread start/resume/fork, item and turn events, server-initiated approvals, interruption. | Rust protocol client over stdio; persist both AgentMeld run ID and Codex thread ID. |
| Ollama | `/api/chat` accepts message history and tool definitions, returns streaming responses/tool calls. | AgentMeld must own history, approvals, execution, bounded looping, and resumability. | Native Rust HTTP integration for the product's small tool loop; optional Codex + Ollama preset for coding. |

Claude facts: [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview), [sessions](https://code.claude.com/docs/en/agent-sdk/sessions), [permissions](https://code.claude.com/docs/en/agent-sdk/permissions), [streaming](https://code.claude.com/docs/en/agent-sdk/streaming-output). Codex facts: [app-server protocol](https://developers.openai.com/codex/app-server). Ollama facts: [chat API](https://docs.ollama.com/api/chat), [tool calling](https://docs.ollama.com/capabilities/tool-calling).

### Claude Code details and authentication boundary

The SDK provides built-in file/shell tools, MCP, hooks, and session handling. Use `canUseTool` to bridge unresolved decisions into AgentMeld approvals; do not interpret a callback as a universal interceptor because SDK rules can resolve calls before it. Use explicit deny/ask rules and an external tool boundary for critical actions. Partial output requires `includePartialMessages` (TypeScript), yielding `stream_event` messages. Sessions persist conversation history, **not filesystem state**. [Permission evaluation](https://code.claude.com/docs/en/agent-sdk/permissions), [streaming events](https://code.claude.com/docs/en/agent-sdk/streaming-output), [session persistence](https://code.claude.com/docs/en/agent-sdk/sessions).

**Ship API-key or supported cloud-provider authentication as the documented product path.** The SDK overview says third-party Claude.ai login/rate-limit access requires prior approval. The legal page says third-party developers cannot offer Claude.ai login or route Free/Pro/Max credentials for users. A separate help-center update says the proposed June 15 SDK billing changes were paused and SDK/`claude -p`/third-party usage still draws from subscription limits. These are different billing and authorization claims; they do not establish permission for AgentMeld to offer subscription passthrough. Record personal local subscription support as unresolved pending vendor clarification, not a launch promise. [SDK authorization](https://code.claude.com/docs/en/agent-sdk/overview), [credential rules](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use), [paused billing change](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan).

### Codex details and authentication boundary

App-server stdio uses newline-delimited JSON-RPC messages with the `jsonrpc` header omitted. It exposes command/file approval requests and supports generating schemas from the installed CLI. Pin the binary and generated schema together. Remote WebSocket is explicitly experimental/unsupported; do not expose an app-server listener directly to the internet. Use AgentMeld's authenticated transport around a worker-local process. [App-server](https://developers.openai.com/codex/app-server).

Official authentication docs distinguish ChatGPT subscription access from usage-billed API keys and recommend API-key authentication for programmatic CLI workflows. Support an owner-controlled Codex installation where permitted; use per-user credentials, never a pooled personal account. Hosted resale/subscription delegation is not established by CLI login support. [Codex authentication](https://developers.openai.com/codex/auth).

Locally inspected `codex exec` supports `--json`, resume, fork, `--oss`, `--local-provider ollama`, and configurable sandboxes. This is a useful batch fallback, but app-server is the stronger fit for a live UI that must respond to approval requests. No execution was performed.

### Ollama details and capability limits

Ollama streams NDJSON and its tool-calling examples explicitly require the caller to execute functions, append tool results, and continue the loop. The chat endpoint requires conversation messages and returns token and duration measurements. Native Ollama support therefore includes a real AgentMeld harness; a model dropdown alone is insufficient. [Streaming](https://docs.ollama.com/api/streaming), [tool loop](https://docs.ollama.com/capabilities/tool-calling), [chat API](https://docs.ollama.com/api/chat).

The local API requires no authentication; direct cloud API access requires a key. Local endpoints can also relay cloud models. Do not label a task private/local solely because its URL is localhost. Provide an explicit local-only mode and verify the selected model; Ollama documents `OLLAMA_NO_CLOUD=1`. Keep an exposed inference endpoint behind the worker network or an authenticated proxy. [Authentication](https://docs.ollama.com/api/authentication), [local-only mode](https://docs.ollama.com/faq).

Codex + Ollama is officially documented, including a recommended context window of at least 64k tokens. It can reduce duplicate coding-harness work but should not hide that selected models have different tool and visual capabilities. Qualify model/version combinations rather than promising every Ollama model can use a desktop. [Ollama's Codex integration](https://docs.ollama.com/integrations/codex).

## Computer use is its own product subsystem

Both Anthropic and OpenAI require the integrator to provide an environment, translate tool requests into actions, capture results, and return screenshots. A vision model, Codex login, or Claude Code installation alone does not provide the AgentMeld desktop. Vendor reference environments demonstrate feasibility, not complete tenancy controls. [Anthropic computer use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool), [OpenAI computer use](https://developers.openai.com/api/docs/guides/tools-computer-use).

Proposed capability contract: `shell`, `files`, `browser_dom`, `desktop_pixels`, `vision`, `tool_calling`, `streaming`, `session_resume`, `human_approval`, and `usage_reporting`. Advertise only tested combinations. Offer a browser/desktop tool service inside each workspace environment; use MCP where a harness supports it. A Linux desktop image can contain a virtual display, lightweight window manager, browser, file tools, and a viewing/takeover channel. Own the viewer separately from model screenshots so neither becomes a public unauthenticated VNC endpoint.

Use structured/browser tools for tasks they handle reliably; use pixel actions when needed. Define one active controller lease for mouse/keyboard/browser state. Human takeover pauses agent actions, then returns an updated observation before resumption. Supporting generic tools through MCP is a proposed integration approach, not a claim that each vendor's native computer-use schema maps perfectly onto its coding harness.

## Isolation and platform choices

| Stage | Recommended boundary | Why and limit |
| --- | --- | --- |
| Trusted self-hosted alpha | One constrained Linux container per active workspace trust boundary | Practical packaging and recovery. Shared host kernel is not a strong hostile-tenant boundary. Rootless mode mitigates daemon/runtime privilege risk where supported. |
| Mac/Windows development | Linux containers through a supported VM-backed engine, or remote Linux worker | Docker Desktop documents Linux VMs on both platforms. A shared engine VM does not make each workspace a separate VM. |
| Unrelated contributors or paid multi-tenant hosting | Dedicated VM/microVM per tenant/workspace trust boundary, qualified before launch | Firecracker uses Linux KVM and a minimal device model. Linux host/KVM availability and host kernel configuration are deployment prerequisites, not a portable Mac backend. |

Sources: [Docker isolation and daemon attack surface](https://docs.docker.com/engine/security/), [rootless execution](https://docs.docker.com/engine/security/rootless/), [desktop VM backends](https://docs.docker.com/desktop/features/vmm/), [Firecracker architecture and platforms](https://github.com/firecracker-microvm/firecracker).

Proposed minimum worker controls: non-root execution, dropped capabilities, no privileged mode or Docker socket mount, bounded CPU/memory/PIDs/storage, constrained writable volumes, explicit egress policy, and no ambient host credentials. Keep the worker's narrow management API inaccessible to generated code. Rootless mode and seccomp complement isolation; neither turns a shared-kernel container into a VM. External account actions remain sensitive even when the operating system is isolated.

Keep model inference separate from the disposable desktop when practical. On Apple Silicon, a native Ollama service can use documented Metal acceleration; do not assume a Linux guest preserves that acceleration. Avoid loading a separate model copy for every worker. [Ollama hardware support](https://docs.ollama.com/gpu).

## Rust boundary and efficiency

Proposed Rust scope: authenticated API, task state machine, durable events, scheduler, budgets, supervisor, worker control, artifact indexes, and Ollama loop. Tokio covers async processes/networking/timers; Axum is designed around Tokio/Hyper and Tower middleware. A thin TypeScript sidecar preserves access to the supported Claude SDK without porting its internals. [Tokio](https://docs.rs/tokio/latest/tokio/), [Axum](https://docs.rs/axum/latest/axum/).

Begin with one service, SQLite, and filesystem artifacts for a single node. Treat Postgres/object storage as a later multi-node milestone. These are design recommendations, not evaluated performance results. Avoid Kubernetes, a message broker, or a custom VMM until a measured need appears.

Measure control-plane idle RSS, warm/cold worker startup, desktop RSS, inference latency, tokens per successful task, tool retries, screenshot traffic, cancellation latency, and p50/p95/max end-to-end task time. Bound event queues and coalesce transient text updates while retaining durable lifecycle/approval records. Start browser/desktop components lazily. Ollama's `keep_alive` trades reload time against memory; concurrent requests increase memory requirements. [Ollama resource controls](https://docs.ollama.com/faq).

## Persistence and admission rules

These are recommended requirements, not vendor-provided guarantees:

- AgentMeld owns project/run identity, participant roles, event ordering, artifact provenance, budget, and approval records; vendor session IDs remain adapter details.
- An approval is bound to actor, workspace, run, proposed action, expiry, and current controller state. Stale approval replies cannot unblock a newer action.
- Restart recovery resumes from verified state. Never replay a tool with external side effects merely because a completion event is missing; mark it unknown and reconcile.
- Cancellation must stop the harness and all worker-owned child processes. Closing a browser stream does not prove a task stopped.
- Keep provider secrets outside browser code, artifacts, logs, and general shell environments. Prefer a narrowly authenticated broker where a harness supports it; otherwise document the limited, scoped credential exposure honestly.
- Shared access grants do not automatically grant another user's credentials. An external contributor starts with a separate workspace and explicit capabilities. A fork copies only authorized history/files, not credentials.

## Pragmatic milestones

1. **Contract spike:** pin one version of each integration; validate streaming, tool success/failure, approval deny/allow, interruption, resume, credential errors, usage limits, and unsupported capabilities against a fixture workspace. All checks local; no GitHub CI.
2. **Single-owner alpha:** container worker, terminal/files/browser, one selected harness, live task events, artifacts, approval UI, cancellation, and restart recovery. Qualify Claude Code, Codex, and Ollama presets before calling the initial provider requirement complete.
3. **Desktop parity:** viewer/takeover, capability-tested vision models, persistent workspace disks, safe idle shutdown, and an end-to-end task suite spanning research, files, and GUI work.
4. **Trusted collaboration:** role-scoped access, separate contribution workspaces, audit/readback, credential ownership, deterministic controller handoff, and malicious-input testing.
5. **Hosted readiness:** VM isolation, tenant admission limits, metering, backups/restore, deletion policy, private credential broker, and independent boundary review. Add a trained hosted model only after a rights-cleared evaluation/training dataset and measured baseline exist.

Unresolved launch questions: vendor subscription delegation, runtime redistribution licenses, exact minimum host/GPU requirements, approved model capability matrix, and the chosen VM backend. “Open-source and free to self-host” describes AgentMeld licensing; it does not eliminate provider charges, hardware costs, or model-license obligations.
