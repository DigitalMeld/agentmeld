# Goal prompt for Astra — AgentMeld audit follow-through to MVP

Paste the block below into a fresh Astra session. It is self-contained.

---

You are taking over the AgentMeld project from a completed audit. AgentMeld (github.com/DigitalMeld/agentmeld) is an open-source, self-hosted personal AI agent: persistent named agents that work in isolated computers (VM/container), driven by the owner's own model subscriptions. You have a working copy of the repo. A previous agent audited it end-to-end, wrote the findings to the repo, and made documentation fixes. No production code was changed.

## Your goal

Execute the recommendations in `docs/audit/2026-09-18-agent-handoff.md` and carry the project through to **MVP**, defined as:

- **M2 (public alpha)** per `docs/specs/roadmap.md`, with the acceptance ledger in `docs/mvp-progress.md`: **P1–P5 and P8–P10** ordinary-user journeys, denied actions, restart/failure tests, rendered review, and limitations readback. The ledger explicitly does not reduce MVP to the local POC.
- Apple-first, Codex-only (owner's ChatGPT subscription). macOS app, local browser, iOS app controlling enrolled Mac hosts. iPhone-over-cellular control of the home Mac is an alpha gate. iMessage is an alpha stretch goal ("hopefully") — best effort, must not block alpha.

## Read first, in this order

1. `AGENTS.md` (repo root) — hard constraints; they outrank everything below except the owner's direct instructions.
2. `docs/audit/2026-09-18-comprehensive-audit.md` — what the audit found, including the four headline findings.
3. `docs/audit/2026-09-18-agent-handoff.md` — your ordered task list (7 tasks), constraints, and open questions.
4. `docs/mvp-progress.md` — the MVP ledger; keep it current at each functional checkpoint.
5. `docs/specs/product-spec.md`, `docs/specs/roadmap.md`, `docs/decisions/2026-09-18-apple-first-alpha.md` (including the 2026-09-18 addendum).

## Settled decisions — do not reopen without the owner

- The project will be open source; **license selection is deferred** and is not your work. Do not select, draft, or add a license.
- North star: the best of both worlds — the assistant bundle's behavioral architecture/personality, Muse's product breadth and restraint, Grok Bot's collaboration model.
- Local-first = self-hosted infrastructure and data; best models in the cloud via the owner's subscriptions; local models are roadmap, not alpha.
- Feed is deferred to M4 with its definition already recorded. Do not redesign it now.

## How to work

- Follow the handoff's task order (1–7). Tasks 2–5 are **design/decision first, code after** — write the design or decision doc, get it reviewed, then implement.
- The single most important engineering task: the three divergent control cores (`crates/agentmeld-m0/src/control.rs`, `crates/agentmeld-m0/src/durable.rs`, and the Node live path in `apps/poc/` + `experiments/`) must become one authoritative, durable, tested control plane. Do not "fix" one in isolation — that deepens the divergence.
- The two hidden alpha gates need decisions before they become code: remote transport selection (private route vs Nostr — compare, then commit) and iOS push (APNs relay vs polling vs deferred).
- Update `docs/` as part of every meaningful change. Distinguish planned / implemented / verified / shipped in every report. Never describe planned functionality as shipped.
- Verify with `sh scripts/check-local.sh` (and `python3 scripts/check-docs.py` for doc changes). The default suite must not send messages, invoke a paid model, start a container, or read user files — container and provider probes are explicit separate commands.
- Follow the repo SOP: open a GitHub issue for the work, work on a branch, submit a PR for review. Do not push to main without the owner's explicit approval. Use GitHub account `BradGroux` and email `3053586+BradGroux@users.noreply.github.com`.
- Report progress at each task boundary: what changed, what was verified, what remains. Bring decisions to the owner with concrete options — do not guess at: remote transport selection, iOS push approach, whether the first release can be same-network-only, or any product-economics question.

## Hard constraints

- No GitHub Actions, no third-party CI, no workflow files, no automated releases. Ever.
- Never weaken browser sandboxing, seccomp, macOS SIP, or approval checks to make a probe pass. Record failures; investigate the owning boundary.
- Never mount host credentials, browser profiles, the Docker socket, or the user home into agent containers. Provider credentials need an explicitly authorized setup path.
- Do not copy proprietary assets, private account exports, or separately licensed enterprise code.
- Do not claim macOS isolation is qualified because Linux was. It is not — re-qualification on macOS is an alpha gate.
- Keep build storage bounded; no global prune commands. Preserve the running POC and its session during each server update; no competing canonical stores.
