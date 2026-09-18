# AgentMeld documentation

Keep discoveries and consequential changes here as work proceeds. Update the owning document in the same change; link evidence and distinguish proposed, implemented, locally verified and shipped behavior. Do not retain personal messages, credentials or private screenshots.

## Current direction

Alpha is **Codex-only using ChatGPT subscription authentication**, with macOS, local web and iOS clients, multiple Mac hosts and required away-from-home control. Claude Code, Ollama and messaging integrations are post-alpha.

- [M0 exit checklist](m0/exit-checklist.md): current gates, evidence and next action.
- [Codex subscription qualification](m0/codex-subscription.md): supported login direction and unresolved execution boundary.

- [Muse design baseline](design/muse-baseline.md): observed Mac/web and supplied iPhone patterns, required adaptations and remaining interaction checks.

- [Muse mobile reference](design/muse-mobile-reference.md): inventory of 22 supplied screenshots, public App Store examples and mobile design implications.
- [Product specification](specs/product-spec.md): requirements and acceptance journeys.
- [Architecture](specs/architecture.md): system boundaries and proposed contracts.
- [Roadmap](specs/roadmap.md): sequence and exit criteria.
- [Apple-first alpha decision](decisions/2026-09-18-apple-first-alpha.md): macOS, local web, iOS, multiple hosts and required away-from-home control.

## Evidence and history

- [M0 evidence](m0/results.md) and [reproduction instructions](m0/README.md): completed checks and remaining limits.
- [Muse public design sources](research/muse-design-sources.md): first-party designer rationale and evidence limits.
- [Product references](research/product-reference.md): Muse/Grok Bot observations, not parity claims.
- [OpenInstinct audit](research/openinstinct-audit.md): pinned-source findings and architectural lessons.
- [Runtime research](research/runtime-integrations.md) and [reference projects](research/reference-projects.md).
- [Nostr/Buzz connectivity assessment](research/nostr-buzz-connectivity.md): remote transport options and alpha qualification gates.
- [Deferred iMessage research](research/imessage.md): retained evidence for post-alpha decisions.

## Documentation practice

Use `design/` for observed interaction patterns and visual acceptance, `specs/` for current intended behavior, `research/` for dated source-backed findings, `decisions/` for consequential choices and alternatives, and `m0/` for reproducible qualification evidence. Add an implementation/operations document only when there is a concrete feature or procedure to explain. Avoid duplicating task logs in every document.

For a meaningful change, record the reason, affected behavior, evidence/checks, limitations and next action. Update current specs when a decision changes; preserve older research with a clear supersession note. Documentation is part of completion, not a later cleanup task. Run `python3 scripts/check-docs.py` for documentation changes. Never describe planned functionality as shipped.
