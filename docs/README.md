# AgentMeld documentation

Keep discoveries and consequential changes here as work proceeds. Update the owning document in the same change; link evidence and distinguish proposed, implemented, locally verified and shipped behavior. Do not retain personal messages, credentials or private screenshots.

## Current direction

Alpha is **Codex-only using ChatGPT subscription authentication**, with macOS, local web and iOS clients, multiple Mac hosts and required away-from-home control. Claude Code, Ollama and messaging integrations are post-alpha.

- [Conversation organization and output workflow](design/workflow-organization.md): implemented chat management, exports, file/version navigation and keyboard behavior.
- [Working local POC](poc.md): chat, attached files, real subscription-backed work, results and Stop. This is the current priority.
- [Muse documentation bundle review](research/muse-documentation-review.md): source assessment, functional coverage and concrete plan changes.
- [Muse interactive prototype review](research/muse-prototype-review.md): simulated journeys, source conflicts and concrete acceptance additions.
- [Product feedback backlog](backlog.md): requested conversation, icon, tooltip and activity-history improvements with acceptance criteria.
- [Scoped Codex event patch](m0/codex-command-event-patch.md): deferred qualification; not a POC prerequisite.
- [M0 exit checklist](m0/exit-checklist.md): current gates, evidence and next action.
- [Codex subscription qualification](m0/codex-subscription.md): supported login direction and unresolved execution boundary.

- [UI/UX implementation contract](design/ui-ux-contract.md): screen/state inventory, navigation, proposed tokens, accessibility, client recovery and source adaptations.
- [Muse design baseline](design/muse-baseline.md): observed Mac/web and supplied iPhone patterns, required adaptations and remaining interaction checks.

- [Muse mobile reference](design/muse-mobile-reference.md): inventory of 22 supplied screenshots, public App Store examples and mobile design implications.
- [Product specification](specs/product-spec.md): requirements and acceptance journeys.
- [Architecture](specs/architecture.md): system boundaries and proposed contracts.
- [Data implementation blueprint](specs/data-model.md): core ERD, draft SQL, all 195 source-relation dispositions, persistence rules and POC migration.
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

- [Complete saved workspace browser and universal file layouts](design/workspace-browser.md)

- [Artifact actions and previews](design/artifact-actions.md): selection/export, latest versions and safe previews, with behavior and verification boundaries.

- [Conversation discovery and activity navigation](design/conversation-navigation.md): 24 improvements to search, reply formatting, request reuse and run inspection.

- [File reading and workspace navigation](design/file-reading.md): in-preview search, wrapping, load states, sortable workspace tables and keyboard navigation.

- [Activity inspection](design/activity-inspection.md): search, run alerts, Activity/Approvals/Schedule tabs and recorded run navigation.
