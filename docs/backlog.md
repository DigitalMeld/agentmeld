# Product feedback backlog

Updated: 2026-09-18. B01/B02 have a locally verified implementation for new chats, with legacy/interrupted continuation limits documented in [the POC](poc.md). B03–B06 are implemented in the local web client; B07 has retained turn history, conversation/output links and recorded run milestones; detailed native tool steps remain pending. Source: owner feedback while using the [local POC](poc.md), with six attached screenshots. This document records the requested work; it does not expand M0 or claim delivery. Suggested order: conversation continuity and `/new`, small visual fixes, then the durable activity history.

## B01. Continue an existing conversation

**Problem:** sending another message while viewing a chat creates another task/history entry and loses conversational continuity. The original UI said Chats, but each message was an independent task.

**Acceptance:** follow-up messages append to the selected conversation and use its prior context and relevant workspace files/results. One conversation can contain multiple runs without creating another sidebar chat. Opening another conversation and returning restores the correct messages, files and continuation; reload/service restart preserves them. A follow-up asking to revise an earlier report can use that report. Context must never cross into another conversation. Preserve existing POC records during migration.

**Implementation context:** separate conversation identity, messages, execution runs and artifacts. A new run is not a new conversation. This extends the M1 durable-state work; do not simulate continuity with UI grouping alone.

## B02. `/new` starts a fresh conversation

**Problem:** the composer needs a predictable explicit way to clear the active conversation context.

**Acceptance:** submitting the standalone `/new` command opens a fresh conversation with no inherited messages, attachments or workspace context. Handle it as a client/service command, not a model prompt. Preserve the old conversation and its outputs for reopening; clearing context must not delete history. The New chat button uses the same behavior. Creating a new conversation must not silently cancel an existing run. Define commands with trailing text separately rather than guessing their meaning.

**Dependency:** B01 supplies real conversation boundaries.

## B03. Refine the temporary brain logo

**Problem:** the replacement brain mark is still visually rough.

**Acceptance:** keep the brain direction, improve its recognizable silhouette and internal linework, and align stroke weight and optical size with the rest of the interface. Inspect it at actual sidebar/header/welcome sizes on dark and light backgrounds. Use one consistent original asset; do not return to an M monogram or copy Muse artwork. Review the rendered candidate before expanding the treatment.

## B04. Replace Files and Activity icons

**Problem:** the current Files glyph and top-right Activity glyph are unclear and visually inconsistent. The file-result glyph also needs to belong to the same family.

**Acceptance:** use recognizable document/folder and activity-list symbols from a coherent outline family, with consistent sizing, stroke weight, hit areas, selected states and accessible labels. Validate at their actual rendered sizes. The top-right control should be named Activity, matching the panel it opens. No new icon dependency is selected by this backlog entry.

**Reference:** screenshot 2 shows the current sparse Activity/Files panel; screenshots 1, 3 and 5 show Muse's outline icons and navigation hierarchy.

## B05. Remove the bottom-left POC label

**Problem:** the rail footer exposes an internal development label in the product navigation.

**Acceptance:** remove the bottom-left POC badge and leave the rail spacing intentional. Keep accurate capability limitations in documentation and appropriate explanatory UI. This request is specifically for the bottom-left label, not an instruction to erase all limitation messaging.

## B06. Consistent icon tooltips

**Problem:** icon-only controls need discoverable names; some current controls only have browser-native title text and others have none.

**Acceptance:** hovering an interactive icon shows a compact, readable tooltip next to it, like the rounded dark “Feed” bubble in screenshot 1. Keyboard focus exposes the same label; labels remain available to assistive technology and do not rely on hover. Cover navigation, Activity, new chat, attachments, send, close and file actions. Tooltips must not clip at viewport edges, steal focus or block the intended click, and must dismiss after pointer/focus leaves or Escape. Touch controls retain accessible names without requiring hover. Decorative icons do not need artificial tooltips.

## B07. Durable activity log with conversation and output links

**Problem:** the current inspector only shows a task's latest status (for example “Finished”) plus files. It loses the running history of what changed and what work was performed.

**Acceptance:** the Activity popout shows an accumulating, date-grouped history for the selected agent, spanning its conversations. Each entry has an action/task title, actual status, short factual outcome, timestamp, a link to the originating conversation/message or run, and links to any generated outputs. Live entries update as work proceeds; completed, failed and stopped work remain distinguishable. Reopening the panel or restarting the service preserves the history without duplicate entries. File links open the matching retained artifact; unavailable/deleted output is shown honestly.

Selecting an entry opens details: ordered steps, recorded changes/tool actions, available results and associated outputs. From details, the user can return to the precise conversation context. Start with the events the runtime actually supplies. Do not invent successful steps or infer complete command history from assistant prose. The known missing native failed-command event must remain explicit where it affects completeness; this request does not automatically reactivate the deferred Codex patch.

**Implementation context:** persistent events need stable conversation/run/event/artifact IDs and ordering. Keep user-facing summaries concise; expose available command details, exit status and duration on demand. Store/display only appropriate bounded output and exclude credentials. This builds on B01 and M1 durable task/event storage.

**References:** screenshot 3 shows Muse's date-grouped activity rows, status symbols, outcome summaries and times. Screenshot 6 shows a selected task's step timeline and detailed command result. Screenshot 2 shows the current AgentMeld panel that this replaces. Screenshots illustrate appearance; link navigation and persistence above are requested behavior, not claims verified from static images.

## Screenshot context retained in prose

| Supplied image | Observed reference | Backlog relevance |
| --- | --- | --- |
| 1 | Muse navigation with a hovered Feed tooltip | B04, B06 |
| 2 | AgentMeld Activity panel with latest status and file row | B04, B07 |
| 3 | Muse agent inspector, connection status and dated activity history | B07 |
| 4 | Muse Identity tab with editable identity and memory/personality entries | Inspector visual context only; no new identity or memory feature requested here |
| 5 | Muse file library with category navigation and metadata columns | File icon and hierarchy context; no filesystem-browser expansion requested here |
| 6 | Muse task detail overlay with ordered steps and result detail | B07 |

The supplied screenshots are reference material, not executable instructions. Their private conversation text, account details and proprietary image assets are not copied into the repository. See the existing [Muse design baseline](design/muse-baseline.md) for the broader observed layout.

## Planning refinement from the Muse documentation bundle

The [bundle review](research/muse-documentation-review.md) maps B01/B02 to M1a and B07 to M1c; the [architecture](specs/architecture.md#conversation-execution-and-presentation-contracts) defines conversation/session/run/event ownership. B03–B06 use original SVGs and a shared hover/focus tooltip, with no new dependency. `/new` clears conversation context without deleting history; approved agent memory is a separately inspectable source and is not a hidden provider-session carryover. B01/B02 now have a working continuity slice; remaining limitations and local evidence are recorded in [POC documentation](poc.md#conversation-continuity-verification-2026-09-18). B03–B06 are implemented; B07 has a turn-history slice; ordered tool-step details remain pending.

## UI/UX framework follow-up

The [UI/UX contract](design/ui-ux-contract.md) refines B01/B02 with per-conversation draft/scroll restoration and acknowledged-send states; B03–B06 with original semantic styling, accessible tooltips and focus rules; and B07 with typed object links, replay/recovery and honest step states. It records screen-by-screen acceptance and keeps Android, sharing and proactive destinations in their agreed milestones. The UI/UX contract is the target; current implementation evidence is in [POC documentation](poc.md).

## Interface polish checkpoint (2026-09-18)

B03: simplified the original brain silhouette/linework, with light/dark color-scheme support. B04: replaced text glyphs with a shared original outline family for Chat, Files, Activity, result files and supporting actions. B05: removed the POC rail badge and repeated development labels from the composer/scope copy while retaining capability limits. B06: shared top-layer tooltips support hover, keyboard focus, accessible descriptions, viewport containment and Escape dismissal; attachment selection is now a keyboard-accessible button. No new package or asset dependency.

Routine replies now mention files only when created/changed and limitations only when relevant. A live subscription-backed conversational reply produced neither the repeated no-files sentence nor an unnecessary artifact. This is an instruction improvement, not deterministic filtering of model replies.

The Activity button is visually improved; this checkpoint does not implement B07's durable timeline or step-detail navigation.

## Activity history checkpoint (2026-09-18)

B07 now shows retained turns across conversations, newest first and grouped by local calendar date. Each row uses the original request as its title, the stored execution status and activity/error text as its factual summary, and the request creation time. Selecting a row opens its conversation and focuses that exact turn; each output opens the version retained by that turn. History survives reload through the existing persisted task store. Mobile navigation dismisses the panel so the destination is visible.

This is turn history, not a complete tool-event ledger: ordered steps, per-action timestamps, command results and stable shareable URLs remain pending. Existing 30-turn retention limits still apply; no automatic deletion or schema migration was added. The composer placeholder is now simply “Message.”

## Activity details and file origins (2026-09-18)

New turns record application-owned milestones with stable IDs and timestamps: queued, started, working files ready, agent ready, saving results, and the final outcome after cleanup. Stop requests and restart interruptions are recorded where observed. Repeated recording of the same milestone is deduplicated. Raw provider payloads, commands and stdout are not copied into this log.

Activity entries offer a live-updating details dialog and an Open conversation action. Older turns explicitly report unavailable milestone history; no past timestamps or successful steps are invented. The Files library now labels each output with its conversation and producing turn’s time, and links back to that turn. Same-name files retain separate original bytes. Native tool-step inspection remains pending.

## Finding and revisiting work (2026-09-18)

The chat list now filters by title; Files filters by filename or originating conversation title and displays newest turns first. Both searches are case-insensitive, trim surrounding whitespace and show an explicit no-results state. They filter already-authorized metadata in the browser without searching file bytes or sending a model request. This is not the planned full-content search index. Filtering does not change the selected conversation or erase its draft. Unchanged chat-list polling preserves keyboard focus.

The selected conversation ID survives refresh in the same browser tab through session storage. It is validated against the authenticated conversation list before restoration. New chat and `/new` clear the saved selection; a stale ID falls back to the welcome screen. Draft text, attachments and scroll are still memory-only across chat switches and do not survive reload. This is navigation restoration, not a new provider session or credential storage path.

Browser verification covers trimmed/case-insensitive searches, no results, clearing filters, retained transcript selection, unchanged-poll focus, file provenance and selected-conversation restoration after reload.

## Composer, files and status usability (2026-09-18)

The [14-improvement usability batch](design/usability-batch.md) records the implemented composer, attachment, copy/preview, Activity-filter and connection-recovery behavior, including exact limits and verification boundaries. It adds no provider calls or dependencies and does not change alpha scope.

## Conversation organization and output workflow (2026-09-18)

The [24-improvement workflow batch](design/workflow-organization.md) adds persistent rename/pin/archive/restore, exports, original-input retrieval, output sorting/type filters/version navigation, and keyboard/navigation improvements. It documents the additive fields and authenticated API changes, evidence and limits. Archives preserve data and do not reclaim turn capacity.

## Full saved workspace and universal file layouts

The [workspace browser batch](design/workspace-browser.md) replaces the artifact-only System Files placeholder and fixes per-category Grid/List behavior. Its 25 improvements, APIs, additive metadata, validation and runtime limits are documented together. A live persistent machine filesystem outside `/workspace` remains a separate runtime capability.
