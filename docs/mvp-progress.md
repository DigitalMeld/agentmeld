# MVP completion ledger

Objective: complete the app and backlog to MVP, using the existing Apple-first alpha scope as the acceptance baseline. M2/P1–P5 and P8–P10 remain required; this ledger does not reduce MVP to the local POC. Post-alpha providers, messaging, collaboration and hosted billing remain later scope.

## Verified starting point

Main includes PR64; the context qualification follow-up is recorded below. The local POC has Codex subscription-backed isolated execution, stable conversations, uploads, saved workspace snapshots, immutable per-run outputs, stop, chat organization, Library and recorded run milestones. Detailed evidence and limitations live in the linked design documents and POC report. No claim of complete tool event history, native apps, or full filesystem/live browser support.

## Dependency order and acceptance

| Delivery | Current evidence / remaining work |
| --- | --- |
| Agent identity and approved memory (P5/P10) | First local web slice implemented: revision-checked owner editing, runtime context, deletion/export, restart and UI fixtures. Two-turn live provider acceptance now passes across deletion and restart. Individual memory editing/provenance and full version history remain |
| Browser and exact-action approvals (M1d/P2/P3) | Command approval callback/UI slice now uses Rust authority and durable history; live callback qualification, restart continuation, general browser workflow and takeover remain |
| Service durability and storage (M1e) | Node format-2 store exists; Rust API, SQLite migration, supervision, replay/reconciliation and migration readback required |
| Reusable outputs and activity (M1b/c/P9/P10) | Working POC slices; complete tool events and lifecycle/deletion semantics remain |
| Scheduling and notifications (P4) | Sidebar placeholder; persistent schedules, timezone/DST, history, coalescing, cancellation and limits required |
| Skills and MCP connector | Qualification seams exist; user workflow and tested reference connector required |
| Native macOS/iOS and remote hosts (P8) | Missing clients, pairing, grants, secure remote route and physical-device/cross-network acceptance |
| Setup and operations | Installation, health, restart/session recovery, backup/restore, upgrades, resource measurements required |
| Final acceptance | P1–P5/P8–P10 ordinary-user journeys, denied actions, restart/failure tests, rendered review and limitations readback required |

Rust 1.95 is installed at `/Users/bradgroux/.rustup/toolchains/1.95.0-aarch64-apple-darwin/bin`; adding it to this shell’s PATH enables the complete local verification suite. No toolchain installation or system settings change was needed. No GitHub CI, new production dependency, credential-storage change, deployment, or public exposure is authorized implicitly by this ledger. Decisions needing explicit approval will be presented with concrete options after independent work is complete.

Keep this document current at each functional checkpoint. Owner data and credentials must not be included in evidence. Preserve the running POC during migration; no competing canonical stores.

## Current checkpoint

PR64 and PR65 delivered agent context and live acceptance. Branch `codex/native-approvals` connects supported native command requests to owner review using the existing Rust authority. Focused tests cover denial/replay/expiry/persistence failures and browser review. Full browser/takeover and waiting-run restart recovery remain open; no complete P3 claim. Next: live native callback qualification, browser runtime integration and durable service ownership. The full MVP scope above remains active.
