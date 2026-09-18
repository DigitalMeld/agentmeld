# AgentMeld

Alpha target: Codex with ChatGPT subscription authentication; macOS, local browser and iOS; multiple Mac hosts and away-from-home control. Claude Code, Ollama and messaging are post-alpha. See the [working POC](docs/poc.md) and [qualification history](docs/m0/exit-checklist.md).
An open-source workspace for persistent AI agents that work in isolated computers, using the models and agent harnesses you choose.

**Status: working local POC.** Run `npm run poc` in the prepared development environment and open the private local link it prints. Attach a CSV or try the sample, ask for a report, inspect the streamed work, open/download the results, and stop a running task. It uses the existing Codex subscription inside the qualified container. See [POC setup and limits](docs/poc.md). Native apps and remote access remain planned.

The alpha targets macOS, a local browser, and iOS clients controlling explicitly selected Mac-hosted agents, with observable isolated execution, durable files and memory, scheduled tasks, and explicit permissions. Self-hosting will be free; inference and infrastructure can still have costs. iMessage, WhatsApp, Windows, general remote browser access, managed hosting and a custom model are on the roadmap. Away-from-home iPhone and Mac-to-Mac control are alpha requirements; the secure connection path is being evaluated.

The [documentation index](docs/README.md) tracks current specifications, decisions, discoveries and verified evidence.

## Start here

1. [Product specification](docs/specs/product-spec.md): experience, feature scope, acceptance criteria, and open decisions.
2. [Architecture](docs/specs/architecture.md): Rust services, harness adapters, isolation, persistence, and shared access.
3. [Delivery roadmap](docs/specs/roadmap.md): sequential milestones and local verification gates.

## Research

- [Muse and Grok Bot product research](docs/research/product-reference.md)
- [Rakazo and OpenMausBot source research](docs/research/reference-projects.md)
- [Runtime integrations and isolation](docs/research/runtime-integrations.md)
- [iMessage transport research](docs/research/imessage.md)

These are proposed designs informed by primary documentation, a read-only Muse UI inspection, and reference source code. They are not claims of implemented functionality or benchmark results. No proprietary product assets or private account exports are included. The project license awaits the owner’s choice. Until a license is added, public source visibility does not grant open-source reuse rights.
