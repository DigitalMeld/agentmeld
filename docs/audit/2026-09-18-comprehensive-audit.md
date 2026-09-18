# Comprehensive audit — 2026-09-18

Status: audit complete. No code changes were made. Documentation updates listed in §4 were applied the same day; everything else is a recommendation for the next agent (see [agent handoff](2026-09-18-agent-handoff.md)).

Audited: `github.com/DigitalMeld/agentmeld` at `f203ca0` (~230 files). Three focused deep dives covered M0 qualification + security posture, product/UX design, and the Rust/Node implementation; this document synthesizes them with the owner's decisions.

## 1. What exists

- **Working Node POC** (`apps/poc/`): a localhost web app (127.0.0.1, bearer token, Host/Origin checks) that runs one Codex task at a time in a hardened Docker container — isolated network, provider-egress CONNECT proxy, seccomp/AppArmor/no-new-privileges, 256 MB — driven over stdio against the owner's real ChatGPT subscription. Streamed output, stop, artifacts, workspace snapshots, JSON-file persistence.
- **Rust M0 crate** (`crates/agentmeld-m0/`): qualification contracts, not production services — approval state machine (`control.rs`), append-only durable journal (`durable.rs`), content-addressed artifact store (`artifact.rs`), sandbox arg builder (`sandbox.rs`), provider event normalizers (`protocol.rs`), channel binding gate (`channel.rs`). 18 integration tests, substantive edge-case coverage.
- **Docs corpus**: product spec, architecture, roadmap, data model, design contracts, research reviews (Muse docs, Muse prototype, OpenInstinct, Grok Bot), dated M0 evidence with negative controls, Apple-first alpha decision.
- **Not implemented**: the production Rust API server, SQLite migration, auth/identity, scheduler, memory service, skills runtime, notifications/outbox, browser service, computer provider, native clients, pairing, remote transport.

## 2. Headline findings

### 2.1. No license while marketed as open source — PARKED
The GitHub page says "Open-source persistent agents" but the repo has no LICENSE; the README admits public visibility grants no reuse rights. Owner decision: the project **will be open source**, but license selection is **weeks out** and is not part of current work. Do not select or draft a license until the owner says so.

### 2.2. Alpha is Apple-first; all isolation evidence is Linux ARM64 — ALPHA GATE
Every isolation probe (seccomp, AppArmor, namespaces, browser sandbox) ran on Linux ARM64. The alpha ships on macOS/iOS, where none of it has been re-qualified. Porting and re-qualifying the supervisor/isolation boundary on macOS is an **alpha gate**, not a later hardening task. The one trust assumption that transfers — "a host process running as the owner can read control files" — is worse on a Mac that also runs the owner's everyday apps.

### 2.3. Three divergent control cores — CALL ATTENTION
The safety-critical control flow exists in **three parallel implementations** that are not wired together:
1. `control.rs` — in-memory approval state machine (generation-based lease fencing).
2. `durable.rs` — journal-based supervisor state machine (the most complex module, ~700 lines, with **zero in-crate unit tests**; its coverage lives behind a Node harness).
3. `apps/poc/runtime.mjs` + `experiments/codex-live-client.mjs` — the **actually working** agent path, with its own third approval/cancellation flow touching neither Rust module.

Known footguns: `control.rs::propose` silently overwrites a pending approval without bumping generation; `durable.rs::Command::Reconcile` hardcodes `provider == "codex"`; the journal poisons all-or-nothing on one bad line with no recovery tooling. Unifying these into one authoritative, durable, tested control plane is the **central engineering task of M1** — extension of what's here will not do it. The SQLite cutover (§7 of the architecture) is effectively a rewrite of this code.

### 2.4. The alpha gate hides two unmade architecture decisions — CALL ATTENTION
The confirmed alpha gate — iPhone over cellular and MacBook Air on an external network controlling the home Mac mini — depends on:
1. **Remote transport, unselected.** The decision doc says to compare a conventional secure private route/reverse connection against a Nostr event transport before committing. No selection, no qualification.
2. **iOS push, unaddressed.** Away-from-home control plus change-only notifications imply notifying a phone, but APNs/push appears nowhere in the docs. A self-hosted open-source app cannot do APNs without a hosted relay (which contradicts "no Digital Meld account" at alpha) or polling (battery/latency costs, undisclosed). "Background notifications are a separately qualified enhancement" hand-waves the largest unacknowledged architectural dependency inside the alpha gate.

## 3. Owner decisions recorded 2026-09-18

- **North star:** the best of both worlds — the assistant bundle's behavioral architecture and personality, Muse's product breadth and restraint, Grok Bot's collaboration model. (Recorded in product-spec §1 and the Apple-first decision addendum.)
- **Local-first definition:** infrastructure and data are yours and self-hosted; the best models run in the cloud through your own subscriptions; local models are a roadmap item, not an alpha requirement. (Recorded in product-spec §2.)
- **iMessage:** alpha stretch goal ("hopefully"), not post-alpha. macOS app + iOS app are the committed alpha clients. WhatsApp stays post-alpha. (Recorded in the Apple-first decision addendum, product-spec §2/§6/P7, roadmap, docs index.)
- **Feed:** not needed for alpha (already an M4 milestone — agreed). Definition contradiction resolved with one canonical sentence: Feed is a configurable generative surface produced within a strict background budget, distinct from Activity. (Recorded in product-spec §5.)
- **License:** will be open source; selection deferred weeks out. Not current work.

## 4. Contradictions found and remediation

| # | Contradiction | Locations | Remediation | Status |
|---|---|---|---|---|
| 1 | Roadmap says "M0 qualification is complete" at top and "M0 has not exited" later; `m0/results.md` said "started, not complete" | `specs/roadmap.md` L3/L171, `m0/results.md` L3 | One canonical status: **M0 closed 2026-09-18 with recorded limitations** | Fixed 2026-09-18 |
| 2 | `provider-egress.md` header said subscription auth "unqualified" while `exit-checklist.md` records live passes | `m0/provider-egress.md` | Header now points at the separate live qualification | Fixed 2026-09-18 |
| 3 | Feed: spec §5 "later views of persisted work" vs roadmap M4 "generated within a budget" | `specs/product-spec.md` §5, `specs/roadmap.md` M4 | Canonical sentence adopted (generative, budgeted, M4) | Fixed 2026-09-18 |
| 4 | "Local-first" undefined; architecture is self-hosted client-server with no sync story | Owner's framing vs `specs/architecture.md` | Owner's definition recorded in product-spec §2 | Fixed 2026-09-18 |
| 5 | iMessage post-alpha in five places vs owner's alpha stretch goal | decision doc, product-spec §2/§6/P7, roadmap, docs index | Addendum + scope lines updated | Fixed 2026-09-18 |
| 6 | Roadmap mixes current plan, historical qualification narrative, and implementation checkpoints; P9 straddles M1c/M2 | `specs/roadmap.md` | **Recommended:** split into a short canonical roadmap + archived `docs/m0/` history; ledger which half of P9 is M1 vs M2 | Open — next agent |
| 7 | `docs/specs/product-spec.md` says M0 "delivered" while M0 docs listed live-provider/recovery blockers | product-spec §2, m0 docs | Covered by canonical M0 status in #1; no further edit needed | Fixed via #1 |

## 5. What's strong (keep)

- Negative controls are built into the M0 method (Docker-default seccomp reproduces the browser failure; unpatched Codex reproduces the missing UI event).
- Supply-chain pinning: digest-pinned images, commit-pinned + SHA-256-verified Playwright seccomp profile, pinned AppArmor template, no vendored upstream source (Codex fix ships as a 92-line diff with LICENSE/NOTICE preserved).
- Credential hygiene in fixtures: AGENTS.md forbids mounting host credentials/docker socket/home; the one real-token import was owner-authorized via container stdin.
- Recovery design preserves uncertainty (`pending_outcome_unknown` is terminal; no silent auto-healing, no silent journal migration).
- The docs distinguish fixtures from live inference and planned from verified more honestly than most pre-alpha repos.

## 6. Missing or underdeveloped (priority order)

1. **Remote transport selection** — alpha gate, unmade. Compare private route/reverse connection vs Nostr per the decision doc, then qualify.
2. **iOS push design** — alpha gate, unaddressed. Decide APNs relay vs polling vs deferred notifications before committing to the away-from-home gate.
3. **P0 onboarding journey** — no first-run design exists (install → provider login → first agent → iPhone pairing → first task). The provider-login UX is the riskiest undesigned moment. Write it with acceptance criteria before M1 slices.
4. **Control-core unification plan** — §2.3. Needs a design doc before M1 code: one authoritative state machine, shared tests, migration of the Node live path.
5. **macOS isolation re-qualification** — §2.2. Plan the macOS supervisor boundary (sandbox profile, SIP interaction, host-side journal protection) as an alpha workstream.
6. **Evals before M6** — no product-quality eval plan exists for what's being built now. Adopt a small deterministic golden-task suite (P1–P5 journeys as runnable fixtures) gating M1/M2.
7. **Secret lifecycle** — token refresh/logout unqualified; store is plaintext file permissions, not a vault; no credential broker; no owner approval UI claimed. Design before alpha enrollment of a real subscription.
8. **Telemetry/crash-reporting default** — zero mentions in the docs. Specify (recommended: zero phone-home, opt-in crash reports) before alpha; the audience is privacy-sensitive.
9. **Retention/backup policy** — backup/restore is an M2 exit item but no backup *format* is specified; the JSON transcript is explicitly "not an import/backup format."
10. **Grok-side interaction design** — groups, mentions, threads, visible agent-to-agent delegation, wake-loop prevention: currently a bullet list. Needs a design spike before M3 planning.
11. **Muse importer** — promised in spec §6 as later coverage; no format, design, or milestone owner. Users arriving with Muse history need it.
12. **Onboarding-adjacent**: cost-attribution UX (per-run spend), update mechanism (no auto-update/release story; compounds the no-CI rule), support/community story for the open-source launch.

## 7. Engineering notes for the next agent

- The live path is pinned to moving external targets: `@openai/codex@0.154.0`'s private app-server stdio protocol is parsed by hand-rolled `experiments/codex-live-client.mjs` with **zero abstraction** between provider protocol and agent. A Codex release that renames a frame method breaks the product. The architecture names "provider protocol drift" as a top risk; the code does not mitigate it.
- `experiments/` modules are load-bearing production dependencies of the POC (`runtime.mjs` imports across the boundary). Either promote them out of `experiments/` or stop treating that directory as throwaway.
- Node POC trust boundary is localhost-and-hope: bearer token on the console, Host-header check, single promise-chain mutation queue (one stalled request blocks the UI). Promoting this to multi-client + cross-network means replacing the server layer; the Rust core has no HTTP/auth layer at all.
- Codex `mount`/`umount2`/`pivot_root` seccomp additions "require further security qualification before production use." AppArmor source hash is not an attestation of loaded kernel rules. Disk quota is unqualified outside the 64 MiB fixture. Browser credential entry (real secrets into the browser) is unqualified by the project's own standard.
- Live evidence is pinned to historical image digests; any image, Codex version, or protocol change should re-run the full probe matrix rather than inheriting hashes.

## 8. Course of action (recommended order)

1. P0 onboarding journey design (install → provider login → first agent → iPhone pairing → first task), with acceptance criteria.
2. Remote transport decision: run the private-route vs Nostr comparison, select, and qualify.
3. iOS push decision: APNs relay vs polling vs deferred — before the away-from-home gate is promised.
4. Control-core unification design doc: one authoritative state machine, shared tests, Node live-path migration plan.
5. macOS isolation re-qualification plan as an alpha workstream.
6. Golden-task eval suite (P1–P5) gating M1/M2.
7. Secret lifecycle design (vault, refresh/rotation/revocation, approval UI).
8. Roadmap split: short canonical roadmap + archived history; P9 M1/M2 ledger.
9. Grok-side interaction design spike (mentions, threads, delegation visibility, wake-loop prevention) ahead of M3.
10. Telemetry default, retention/backup format, cost-attribution UX, update mechanism, importer design — before alpha ships.
