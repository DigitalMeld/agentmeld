# Decision: one durable control plane for M2

Date: 2026-09-18. Status: decided. Closes issue #74.

## Problem

Three divergent control cores existed, none of them the product:

1. `crates/agentmeld-m0/src/control.rs` — in-memory approval state machine; loses everything on restart.
2. `crates/agentmeld-m0/src/durable.rs` — trusted-owner per-run journal; durable but one run, no devices, no policy, no scheduler.
3. `apps/poc/runtime.mjs` + `experiments/codex-live-client.mjs` — the only code that ever drove real Codex work, but with no approval flow, no journaling, no leases. (Its `approvalPolicy: 'on-request'` passes to Codex while the protocol client refuses approval callbacks — an AgentMeld-side approval was never exercised.)

The de facto fourth core, `apps/poc/server.mjs` + `conversations.mjs`, owned the UI's idempotent admission but with a shared bearer token and in-place task mutation.

Two approval state machines with incompatible scope types cannot both live. The M2 service must be one authoritative durable control plane.

## Decision

**`durable.rs` is the semantic base. The PoC server is the API-shape base. `control.rs` is retired. The Node runtime survives as the supervised worker.**

The full design is in [docs/research/control-core-unification.md](../research/control-core-unification.md).

## Why

- The M0 journal's *discipline* — generation fencing on every mutation, digest-bound actions from propose to settle, server-time expiry, single-unit approval consumption, poison-on-persistence-failure, paranoid input validation — is the DNA the product needs. Its *format* (per-run JSON-lines snapshots, file-lock single writer) cannot survive: approval consumption needs real multi-row atomicity and the product needs a multi-run host service. So the journal becomes SQLite tables (`run_events`, `approvals`, `runs`, `delivery_outbox`) per the data-model spec, with the format retired.
- The PoC server already implements the outer API shape the product needs — idempotent admission by request key, single-flight pump, atomic store writes — so that shape ports into the Rust service while the JSON store is imported once and retired.
- `control.rs` is fully subsumed by the journal's richer model (including its propose-while-pending guard and bounded TTLs); its error taxonomy (`StaleLease`, `ChangedAction`, `WrongScope`) ports as vocabulary, nothing executable.
- The Node execution path is the only qualified Codex driver. Rewriting it in Rust would risk the one part that provably works to satisfy a spec table entry; the architecture spec's own rule ("avoid a pure-Rust requirement that leads to reimplementing vendor protocols without evidence of savings") settles it. The worker keeps the Codex app-server protocol and Docker orchestration, holds no authorization state, and talks to the service over a versioned private seam (Unix socket, boot-issued credential).
- The migration runs in five phases with the PoC browser UI working at every step — seam definition, PoC split, Rust service front, control semantics, event contracts. No flag day.

## Locked decisions

1. Journal = SQLite WAL at host-owned `~/.agentmeld/` (default); backup via the SQLite backup API plus a content-hash manifest.
2. No materialized snapshots (SQLite is the snapshot); no time-based event deletion in alpha; per-run event caps and an operator-visible size budget.
3. The Node worker is the long-term shape for the Codex adapter. The architecture spec's component table will be updated to match when implementation begins.
4. No trusted-owner model at the client boundary — devices authenticate, the service derives identity from sessions. One trusted-local link remains: worker↔service over the Unix socket.
5. `/api/v1` from the first Rust-served endpoint.
6. TLS inside the Tailscale mesh is explicitly deferred — device auth is the boundary; hardening for later.

## Explicit non-goals

Multi-host failover, a distributed database, a Rust Codex client, a second model loop in the service, a PoC UI framework change, and any post-alpha capability (remote web access, messaging transports, collaboration, multi-tenancy).

## What this does not authorize

Implementation. The design specifies boundaries and contracts; the Rust service, the worker split, and the migration phases are follow-up work, each verified before merging.
