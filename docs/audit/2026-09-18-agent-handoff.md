# Agent handoff — pick up the AgentMeld audit follow-ups

Date: 2026-09-18. For: the agent continuing this work (expected: GPT-6 Astra on Medium).
Prior work: comprehensive audit complete; findings in [2026-09-18-comprehensive-audit.md](2026-09-18-comprehensive-audit.md). No code was changed. The doc fixes in §4 of the audit are already applied.

## 0. Read first, in this order

1. `AGENTS.md` (repo root) — hard constraints. They outrank everything below except the owner's direct instructions.
2. [2026-09-18-comprehensive-audit.md](2026-09-18-comprehensive-audit.md) — full findings and the recommended course of action.
3. `docs/specs/product-spec.md` — current intended behavior.
4. `docs/specs/roadmap.md` — milestones (long; see audit §4.6 about splitting it).
5. `docs/decisions/2026-09-18-apple-first-alpha.md` — alpha scope, including the 2026-09-18 addendum.
6. `docs/specs/architecture.md` — proposed design (status line is accurate: production system not implemented).

## 1. Settled decisions — do not reopen without the owner

- The project **will be open source**; license selection is **deferred weeks out**. Do not select, draft, or add a license.
- North star: best of both worlds — the assistant bundle's behavioral architecture/personality, Muse's product breadth/restraint, Grok Bot's collaboration model.
- Local-first = self-hosted infrastructure and data; best models in the cloud via the owner's subscriptions; local models are roadmap, not alpha.
- iMessage is an **alpha stretch goal** ("hopefully"); macOS + iOS apps are the committed alpha clients; WhatsApp is post-alpha.
- Feed is deferred to M4 with the canonical definition already in product-spec §5. Do not redesign it now.
- Apple-first, Codex-only alpha. Claude Code, Ollama, Windows, general remote web access, collaboration, hosted service, custom model are later milestones.

## 2. Task list (in order)

### Task 1 — P0 onboarding journey design
Write the missing first-run journey: install Mac service → provider (ChatGPT subscription) login → create first agent → pair iPhone → first useful task. Include acceptance criteria, failure fallbacks (provider login fails, pairing fails), and a time-to-first-useful-task success metric. Output: new doc under `docs/design/`. The provider-login UX is the riskiest undesigned moment — spend the effort there.

### Task 2 — Remote transport decision
Run the comparison the decision doc requires: conventional secure private route/reverse connection vs Nostr event transport (see `docs/research/nostr-buzz-connectivity.md`). Produce a decision record in `docs/decisions/` with selection rationale and a qualification plan. This is an alpha gate — do not let M1 code assume a transport before this lands.

### Task 3 — iOS push decision
Decide: hosted APNs relay vs client polling vs deferred notifications. Constraints: alpha promises no Digital Meld account; a relay must be operable by the owner. Record the decision and its consequences for the away-from-home alpha gate. If push is deferred, the alpha acceptance criteria must say what the phone experience is without it.

### Task 4 — Control-core unification design
Design doc first, no code yet. The three parallel implementations (`crates/agentmeld-m0/src/control.rs`, `crates/agentmeld-m0/src/durable.rs`, `apps/poc/runtime.mjs` + `experiments/codex-live-client.mjs`) must become one authoritative, durable, tested control plane. Address: the `propose`-while-pending overwrite footgun, the hardcoded `"codex"` in `Reconcile`, all-or-nothing journal poisoning (needs recovery tooling), and how the Node live path migrates onto the unified core without weakening any of the three. Output: design doc + ordered implementation plan.

### Task 5 — macOS isolation re-qualification plan
All M0 isolation evidence is Linux ARM64. Plan the macOS supervisor boundary: sandbox profile, SIP interaction, host-side journal protection on macOS, remote-viewer transport/TLS. Explicitly handle the "host process running as the owner can read control files" assumption, which is worse on a Mac running everyday apps. Output: qualification plan with pass/fail criteria per boundary.

### Task 6 — Golden-task eval suite
Small deterministic suite from the P1–P5 journeys as runnable fixtures, gating M1/M2. The existing verification matrix is excellent on failure behavior and measures no success quality — add task completion rate, tool-choice correctness, instruction-following. Do not wait for M6.

### Task 7 — Roadmap split
Split `docs/specs/roadmap.md` into a short canonical roadmap plus archived history under `docs/m0/`. Ledger which half of P9 is M1 vs M2. Keep every link in `docs/README.md` working.

## 3. Hard constraints (from AGENTS.md and the owner)

- No GitHub Actions, no third-party CI, no workflow files, no automated releases. Ever.
- Run `sh scripts/check-local.sh` locally to verify; `python3 scripts/check-docs.py` for doc changes.
- Never weaken browser sandboxing, seccomp, macOS SIP, or approval checks to make a probe pass. Record failures; investigate the owning boundary.
- Never mount host credentials, browser profiles, the Docker socket, or the user home into agent containers.
- The default test suite must not send messages, invoke a paid model, start a container, or read user files.
- Document meaningful findings in `docs/` as part of the work. Distinguish planned / implemented / verified / shipped in every report. Never describe planned functionality as shipped.
- Git author/committer: `BradGroux` / `3053586+BradGroux@users.noreply.github.com`. Repo SOP is issues + PRs: open a GitHub issue for the work, work on a branch, submit a PR for review. Never push directly to main. Inspect remote automation before publication.
- Keep build storage bounded; no global prune commands.

## 4. Do NOT do

- Do not select or add a license.
- Do not write production code for Tasks 2–5 until their design/decision docs are reviewed. Design first.
- Do not "fix" the three control cores by editing one in isolation — that deepens the divergence. Task 4 is a design task.
- Do not claim macOS isolation is qualified because Linux was. It is not.
- Do not copy proprietary assets, private account exports, or separately licensed enterprise code.

## 5. Still-open questions for the owner (do not guess)

- Remote transport selection (yours to recommend after Task 2's comparison, owner's to approve).
- iOS push approach and its cost/latency tradeoffs (Task 3).
- Whether the first public release can be same-network/local-only, or cross-network control stays an alpha blocker.
- Product economics: self-host resource requirements and the free-vs-paid boundary before M5.
