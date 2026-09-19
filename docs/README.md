# AgentMeld documentation

Keep discoveries and consequential changes here as work proceeds. Update the owning document in the same change; link evidence and distinguish proposed, implemented, locally verified and shipped behavior. Do not retain personal messages, credentials or private screenshots.

## Current direction

Alpha is **Codex-only using ChatGPT subscription authentication**, with macOS, local web and iOS clients, multiple Mac hosts and required away-from-home control. iMessage is an alpha stretch goal. Claude Code, Ollama, WhatsApp and other messaging integrations are post-alpha.

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
- [Comprehensive audit 2026-09-18](audit/2026-09-18-comprehensive-audit.md): findings, owner decisions, contradiction remediations and course of action.
- [Agent handoff 2026-09-18](audit/2026-09-18-agent-handoff.md): ordered follow-up tasks, constraints and open questions for the next agent.
- [Goal prompt for Astra 2026-09-18](audit/2026-09-18-astra-goal-prompt.md): paste-ready prompt to hand the audit follow-through to MVP to the next agent session.

## Evidence and history

- [Client branding UI check 2026-09-19](progress/2026-09-19-client-branding-ui-check.md): digitalmeld.io rebrand of the browser UI (issue #94) — vendored variable Roboto (offline-safe), violet token scale replacing all blue accents, `font/woff2` served by both servers; verified against a real server run with screenshots and zero external requests.
- [Client track UI check 2026-09-19](progress/2026-09-19-client-track-ui-check.md): browser UI wired to the approval + event-stream APIs (issue #92) — approval prompts with server-time countdown, live SSE run view, lease pill, inline tool steps; verified against a real server run with screenshots, including the `#`-selector no-op bug this check caught and fixed.
- [Phase 3 approval-path progress 2026-09-19](progress/2026-09-19-phase3-approval-path.md): approval semantics, controller lease, and revocation implemented in the Rust service (issue #86) — 13-test deterministic harness, full check suite green; semantically complete, callback-unproven.
- [Phase 2 UI progress check 2026-09-19](progress/2026-09-19-phase2-ui-check.md): screenshots of the frozen PoC UI served by the Rust service (chat, files, agent settings), plus the static-asset allowlist bug this check caught and fixed.
- [M0 evidence](m0/results.md) and [reproduction instructions](m0/README.md): completed checks and remaining limits.
- [Muse public design sources](research/muse-design-sources.md): first-party designer rationale and evidence limits.
- [Product references](research/product-reference.md): Muse/Grok Bot observations, not parity claims.
- [OpenInstinct audit](research/openinstinct-audit.md): pinned-source findings and architectural lessons.
- [Runtime research](research/runtime-integrations.md) and [reference projects](research/reference-projects.md).
- [Nostr/Buzz connectivity assessment](research/nostr-buzz-connectivity.md): remote transport options and alpha qualification gates.
- [Deferred iMessage research](research/imessage.md): retained evidence; iMessage is now an alpha stretch goal.

## Documentation practice

Use `design/` for observed interaction patterns and visual acceptance, `specs/` for current intended behavior, `research/` for dated source-backed findings, `decisions/` for consequential choices and alternatives, and `m0/` for reproducible qualification evidence. Add an implementation/operations document only when there is a concrete feature or procedure to explain. Avoid duplicating task logs in every document.

For a meaningful change, record the reason, affected behavior, evidence/checks, limitations and next action. Update current specs when a decision changes; preserve older research with a clear supersession note. Documentation is part of completion, not a later cleanup task. Run `python3 scripts/check-docs.py` for documentation changes. Never describe planned functionality as shipped.

- [Complete saved workspace browser and universal file layouts](design/workspace-browser.md)

- [Artifact actions and previews](design/artifact-actions.md): selection/export, latest versions and safe previews, with behavior and verification boundaries.

- [Conversation discovery and activity navigation](design/conversation-navigation.md): 24 improvements to search, reply formatting, request reuse and run inspection.

- [File reading and workspace navigation](design/file-reading.md): in-preview search, wrapping, load states, sortable workspace tables and keyboard navigation.

- [Activity inspection](design/activity-inspection.md): search, run alerts, Activity/Approvals/Schedule tabs and recorded run navigation.

- [Composer refinements](design/composer-refinements.md): clipboard attachments, removal undo, focus stability and unfinished new-chat draft recovery.

- [Run details polish](design/run-details-polish.md): contextual run navigation, compact controls, focus restoration and quieter history.

- [File preview recovery](design/preview-recovery.md): retry, cancellation, focus, media lifetime and workspace loading states.

- [MVP completion ledger](mvp-progress.md): current functional gaps, dependency order and acceptance evidence.

- [Agent context](design/agent-context.md): editable identity, approved memory, revisions, runtime context and deletion limits.
