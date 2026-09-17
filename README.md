# AgentMeld

An open-source workspace for persistent AI agents that work in isolated computers, using the models and agent harnesses you choose.

**Status: M0 local experiments in progress.** The repository contains a Rust conformance harness, fixture tool loop, and offline container probes. It is not yet an installable agent application. See [M0 setup](docs/m0/README.md) and [verified results and limitations](docs/m0/results.md).

The intended product combines a simple conversational interface and two-way iMessage access with observable agent work, durable files and memory, scheduled tasks, and explicit permissions. Self-hosting will be free; a managed service and a custom model are on the roadmap. Model inference and infrastructure can still have costs. The proposed iMessage option uses a paired Mac bridge, separate from the agent's isolated computer.

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
