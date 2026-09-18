# Muse documentation bundle review

Reviewed 2026-09-18. Source: the owner's 13-file `MUSE-Complete-Documentation` export. This is a planning review, not implementation or independent verification of Muse internals. It incorporates the [UI observations](../design/muse-baseline.md), [owner feedback](../backlog.md) and current [working POC](../poc.md).

## Conclusion and evidence boundary

The bundle is detailed enough to define an independent implementation of Muse-like product behavior. It does not supply Meta's source, model weights, actual service contracts, ranking algorithms or operational guarantees. Its own master index distinguishes observed, documented, proposed and estimated material. Treat “observed” as the exporting agent's reported observation, not a fact independently reproduced by AgentMeld. The PRD explicitly calls itself a thought experiment/build blueprint; its launch targets are proposals. We can reproduce the intended workflows and visual hierarchy with our own implementation, then verify each journey.

Review covered all 13 documents at the domain/contract level, including the complete relation inventory and static ERD content; detailed field inspection concentrated on requests/events, work, sessions, activity, browser continuation, device capabilities, memory claims, artifacts and scheduler delivery. This is not a column-by-column certification of every field's meaning. The HTML was inspected as source, not executed. Raw exports, account-specific examples, prompts and proprietary assets are not imported into the repository.

The catalog has 195 relation sections across 17 namespaces, 1,952 column rows within those sections and 100 declared foreign-key entries. The ERD also states 195/1,952 but displays 98 declared foreign keys; the addendum says 100. This discrepancy is retained, not explained away as a soft-reference count. Neither representation establishes the full production schema. Many meanings are blank or inferred; names alone do not prove behavior, authorization or live data access.

## Source inventory and reading roles

Names below refer to the owner's local bundle; hashes in the companion manifest identify the reviewed bytes without publishing the private documents.

| Document | Use in this review | Evidence boundary |
| --- | --- | --- |
| Documentation Master Index | Source precedence and evidence labels | Navigation, not independent corroboration |
| Glossary | Separate agent/persona/session/request/work identities | Definitions from this bundle |
| How My Architecture Works | Context assembly, native tools, persistent computer, background work, devices | Reported runtime/product observations; private topology excluded |
| How My Memory System Works | Transcript vs active context vs curated memory; correction and background upkeep | Cadences and file behaviors reported, not requirements to copy |
| How My Storage System Works | Inputs, working sources, final deliverables, artifact-local state and deletion | Filesystem report, not a backup or durability guarantee |
| Security & Privacy Deep-Dive | Capability/scope/permission separation, secret boundaries and object-specific deletion | Agent account of protections; not a security audit or policy authority |
| How My Data Is Stored | Event/execution/personal-state/product/protected-service separation | Inspection schema is not deployment topology |
| Muse Database Table Catalog | Relation inventory and selected field-level lifecycle evidence | 195 relations are a reference, not our migration plan |
| My Data — Entity Relationship Diagram.html | Core relationships and schema domains | Static reference; foreign-key count discrepancy above |
| Everything Else About Me | Execution lineage, projections, recovery and multiple sources of truth | Schema-based interpretation, not proof of operational behavior |
| What I Had Not Yet Shared | Remaining unknowns and distinction between local adaptation and model training | Explicit limits on completeness |
| Personal AI Agent Platform — PRD | Product coverage, proposed API concepts and acceptance journeys | Proposed independent recreation, not leaked implementation |
| Platform Cost Model | Usage categories and foreground/background accounting | Assumed rates and hypothetical workloads, not Muse economics |

Source traceability: [bundle manifest](muse-documentation-manifest.json).

## What changes in AgentMeld's plan

| Finding | Previous plan or gap | Decision and owning work |
| --- | --- | --- |
| Requests, work, sessions and visible messages have separate identities | Architecture named Conversation/Run, but POC stores one task per message | Make conversation continuity the first delivery slice; persist provider session mapping and a conversation workspace. B01/B02, M1a |
| Activity has threads, sections, action records and links to runtime work | Inspector shows only the latest status and final files | Project a user-facing log from recorded events, with conversation and artifact deep links; step details on demand. B07, M1c |
| Files, artifact identity, sources, builds and shares are different objects | POC exports bounded top-level files | Preserve sources and inputs for revisions; immutable result versions; explicit validated/failed build status. M1b, M2 Library, M4 apps/publication |
| Context compaction and curated memory are different from the transcript | Memory/revision design existed but had little user-facing detail | Keep full visible transcript; native continuation is adapter-owned; memory has sources, revisions and inspect/correct/forget controls. M2 |
| Standing Markdown files expose personality and operational preferences | Agent revisions and portable memory already planned | Provide editable Identity, Persona, Profile, Memory and Proactivity surfaces with versioned Markdown export. Treat editable content as preferences, never policy. M2/M4 |
| Capabilities are advertised separately from device identity | Host selection/pairing already required | Add per-client rendering and per-device command manifests; distinguish local Mac tool target from isolated agent computer. M2 P8 |
| Schedule definition, job run, result and delivery are separate | Existing outbox plan already has this distinction | Preserve it; add versioned definitions, trigger identity and independently retryable delivery, all visible in Upcoming. M2 |
| Goals, Ideas and Feed have their own state, not merely chat prompts | M4 features loosely grouped | Specify separate activation, provenance, feedback and budget contracts; clicking an Idea admits a run; Goal creation alone does not dispatch. M4 |
| Background personalization can multiply work | Rust efficiency target did not constrain each maintenance family | Default automatic maintenance off; explicit enablement, signal-based admission, bounded cadence and budget, visible outcomes. M4 |
| Relationship memory and reflections are editable local state | Could be confused with fine-tuning or autonomous permission changes | Propose reviewed memory/skill revisions; no silent behavior-policy edits, no claims of retraining. M4; actual model training remains M6 |
| Many tables are projections, recovery aids or product-specific systems | Risk of copying a large schema before user value | Implement only entities required by the next acceptance journey; retain Rust modular monolith/SQLite, no new infrastructure dependency |

## Functional coverage map

The source PRD's full-parity list is a useful coverage checklist, not a replacement for the owner's alpha scope. Everything below beyond the current file-analysis POC is planned unless its owning report says otherwise. M0 fixtures prove selected contracts, not completed product surfaces.

| Source PRD §32 capability | AgentMeld destination and acceptance evidence |
| --- | --- |
| 1. Private agent onboarding and personalization | M2: subscription setup, named agents, inspectable identity; no Digital Meld account required for self-hosting |
| 2. Same agent across clients/channels | M2: macOS/local web/iOS and away-from-home multi-host tests; M4: external messaging, Windows/remote web; Android is a future candidate, not newly required for alpha |
| 3. Main/side chats and search | M1a continuity and `/new`; M2 archive/delete/search with deleted-content removal |
| 4. Research, tools, browser and connectors | M1d browser workflow; M2 reference MCP connector; M4 curated service catalog |
| 5. Paired device capabilities | M2 P8: capability discovery, explicit host/device target, permission denial, revoke/offline/reconnect |
| 6. Durable memory | M2 P5: inspect, correct, forget and export with source and retrieval tests |
| 7. Identity/persona/profile/preferences | M2 editable versioned agent preferences; M4 optional maintenance proposals |
| 8. Files and media Library | M1b source-preserving outputs; M2 versioned documents/web artifacts; M4 rich media generation |
| 9. Private pages/apps and public snapshots | M2 sandboxed web artifact preview; M4 isolated app data and separately approved static publication; no implicit public live-app hosting |
| 10. Goals, Ideas, Feed and personalization | M4 contracts below; not empty alpha navigation or always-running jobs |
| 11. Scheduling and run/delivery history | M2 P4: timezone/DST, restart, deduplication, missed-run policy, independent notification recovery |
| 12. Consequential approvals and protected secrets | M1 inline action review; M2 permission controls; M4 credential autofill/payments under separate qualification |
| 13. Reliable Activity and Stop | M1c/M1d: event-backed history, output links, verified cancellation and honest missing-event state |
| 14. Settings and administration | M2 devices, providers, permissions, appearance, data controls, setup health; M4 broader connectors/notifications; M5 hosted billing/support |
| 15. Export/disconnect/delete/reset | M2 documented per-object lifecycle and restore/export checks; no claim that deleting a chat erases every independent memory or backup |
| 16. Honest execution and delivery states | M1 state/event recovery; M2 scheduled delivery; maintain uncertainty without replaying side effects |
| 17. Cross-user protection | M2 single-owner/paired-device isolation; M3 guest/member negative tests and dedicated trust domains before invitations |

### Extensions retained beyond Muse's reported one-user model

Multiple named agents and multiple Mac hosts remain first-class. Guests, shared resources and contributors stay on M3: sharing an agent definition is separate from sharing live access, history, memory, files, browser state or connections. Start with a new shared context and explicit grants; never reuse private provider continuation. Future Claude Code/Ollama adapters and hosted custom models remain supported architectural directions, not alpha dependencies.

### Goals, Ideas, Feed and maintenance contracts for M4

- **Goal:** owner-created outcome, explicit completion criteria, status, linked conversations/runs/artifacts and progress evidence. Schedules are separate authorizations. Briefings are source-linked and dated.
- **Idea:** suggestion with rationale, required capabilities, provenance and estimated work where available. Accepting it creates a scoped request; displaying it does not execute. Record dismissed/accepted state and avoid duplicate suggestions. Do not copy an inferred bandit-ranking algorithm.
- **Feed:** bounded authored editions with source links, freshness, preferences, reactions and Discuss links to conversations. Separate generation failure from delivery. A personalized feed is not the execution audit log.
- **Maintenance:** memory/relationship/skill/reflection proposals with sources, revisions and rollback. Admission requires explicit enablement plus changed input; no hourly or nightly model calls solely because Muse describes that cadence. Bound attempts, concurrency and usage; foreground work has priority. Approval and connector policy cannot be rewritten by these jobs.

## Source ownership and data lifecycle

Keep the trusted database and event ledger outside generated-code workers. Store original uploads, working sources, immutable outputs, browser profiles, provider continuation and derived caches separately. A Library record is a catalog entry, not a second copy of authority. Derived search and activity projections must be rebuildable; task state and completed external writes must not be reconstructed by asking the model what happened.

Memory deletion, transcript deletion, artifact deletion, schedule removal, connector disconnection and full reset need separate user-facing descriptions and tests. Plan deletion tombstones and current-grant checks before cached retrieval or queued delivery. No invented 30-day trash/backup promise: choose and document our own retention before shipping. A future public snapshot pins an artifact version, requires reviewed publication and supports revocation without exposing sources or app databases.

## Efficiency and cost interpretation

The source model assumes blended input/output prices of $1.50/$6 per million tokens and produces illustrative low/mid/high totals. These are not quoted rates, verified Muse costs or an AgentMeld pricing basis. Our alpha uses the owner's Codex subscription: report available usage and limits, provider throttling and unavailable metrics honestly; do not turn tokens into a fabricated API bill or show unknown cost as zero.

Measure per-outcome foreground/background turns, tool calls, retries, duration, token usage where supplied, worker/browser active time and peak memory, retained bytes and cache growth. Keep idle inference at zero without an authorized due job. Suspend disposable workers when idle while retaining approved durable data. Bound screenshots/logs and distinguish disposable build caches from user outputs; no global pruning. Hosted economics and custom-model evaluation remain M5/M6 work using measured workloads.

## Decisions kept open, without blocking the next POC improvement

- Choose the secure cross-network path before P8 acceptance; Nostr remains a candidate, not selected by this bundle.
- Validate native client distribution and permissions on real devices; no claim that the model can access every Mac/iPhone capability.
- Resolve source license before an open-source release and redistribution notices before shipping images.
- Define feature-specific retention, backup/restore and optional public publishing contracts before enabling them.
- Qualify additional providers, media models, connector accounts and guest execution independently.

Next implementation: B01/B02 through the M1a acceptance scenario. No Codex patch build, model download, infrastructure installation or application rewrite is authorized merely by reading this bundle.

## Concrete planning artifacts produced

The first review added architecture contracts and feature sequencing but did not include a physical schema or migration plan. The follow-up closes that planning gap with the [data blueprint](../specs/data-model.md): a core ERD, a 19-table executable SQLite design draft, per-table ownership/lifecycle, write transactions, storage classes, future domain relationships and an exact migration from the current JSON POC. The [relation mapping](../specs/data/muse-schema-map.md) accounts for all 195 source relations once. The [migration plan](../specs/data/migration-plan.md#design-validation-performed) records the synthetic schema checks that actually passed.

These files are planned implementation contracts. No source data was imported, provider credentials accessed, application database installed, running service restarted or runtime behavior changed. Future domain DDL is intentionally deferred until its delivery slice; functional coverage is retained in the mapping.

## Fourteenth document: UI/UX framework

The owner added `MUSE - UI UX Framework Spec.md` after the initial 13-file review. Read its 27 sections, including screen/component inventories, navigation, design-token recommendations, platform-specific behavior, workflows, client/event contracts, accessibility, recovery, QA and unknowns. The manifest now identifies all 14 supplied files. The original 13-file review and catalog counts above remain historical scope, not a claim that the new file was present initially.

Its useful additions are captured in the [AgentMeld UI/UX contract](../design/ui-ux-contract.md): screen/state inventory by milestone, draft and navigation restoration, scoped object routes, semantic-token candidates, tooltip/focus/keyboard rules, client replay and offline states, and concrete acceptance. Important adaptations: preserve our M3 sharing direction, required multi-host native clients and existing POC; do not adopt Meta account controls, Android as an alpha requirement, proposed exact tokens as observations, denial as automatic whole-run cancellation, or a new mock-only framework project. Exact Muse approval layouts and full Mac parity remain unverified.

## Fifteenth document: interactive prototype

The owner subsequently supplied `MUSE UI:UX Framework — Interactive Prototype.html`. The manifest now records 15 files. The [prototype review](muse-prototype-review.md) distinguishes its functioning documentation controls from simulated product actions, resolves navigation/style differences against our existing contract and adds concrete approval/cancellation acceptance. Review was source-only: browser policy blocked the local HTML, so no rendered or interactive verification is claimed. Earlier file counts above retain their historical scope.
