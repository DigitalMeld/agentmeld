# AgentMeld UI/UX implementation contract

Updated 2026-09-18. **Planned, not implemented.** Incorporates the owner-supplied `MUSE - UI UX Framework Spec.md` (snapshot 2026-09-18), prior [observed Muse baseline](muse-baseline.md), [mobile references](muse-mobile-reference.md) and [owner feedback B01–B07](../backlog.md). Source bytes are recorded in the [bundle manifest](../research/muse-documentation-manifest.json).

## Evidence and precedence

The source distinguishes observed contracts, reconstruction recommendations and unknowns. Its “observed” label is the exporting agent's claim, not an independently verified interaction. Exact tokens, approval layout, breakpoints and full Mac navigation remain unknown. Owner decisions take precedence, followed by dated direct observations on the relevant platform, then source-reported behavior; reconstruction values remain candidate choices until rendered and tested.

This document defines AgentMeld's chosen client behavior. It does not import Meta account settings, assets, inaccessible capabilities or source instructions. Keep Codex subscription execution, macOS/local browser/iOS, explicit multi-host selection and required away-from-home native control. Android, external messaging, payments and additional models remain outside alpha.

## Shell and component decisions

- Chat is the default. Start with Chat and Library; add Search when it works. Feed, Ideas and Goals get primary navigation only when their functionality ships. Settings is secondary navigation.
- Desktop: narrow icon rail, contextual conversation/Library list, primary content and optional inspector. Activity, Approvals, Upcoming and Identity share the inspector; Computer is an explicit contextual view. Do not add a second Activity database or duplicate Tasks destination.
- Mobile: single main surface with native navigation stacks/sheets. Inspector becomes a full-height view with an accessible back control. Keep composer, Stop and host identity available without compressing desktop columns.
- Clicking the agent identity or the labeled Activity icon opens the same inspector state. Clicking either must not open an unrelated share flow. Restore the previous tab, selected object and scroll position.
- Use one original outline icon family with consistent strokes and sizes. The temporary brain remains an original asset; refine it at actual sidebar/header sizes. B04 covers Files/Activity and file-result icons. Remove only the requested bottom-left POC badge; retain accurate capability explanations elsewhere.
- Shared primitives: labeled icon button with tooltip, message block, composer/context chip, status badge, activity row/step, artifact card/file row, approval summary, sheet/dialog, empty/error/offline states. Build components as needed by delivered workflows, not a large speculative component library.

### Candidate tokens and responsive constraints

Use semantic names for canvas/raised/overlay surfaces; primary/secondary/disabled text; subtle/strong borders; action/destructive controls; status colors; spacing, radius and type roles. Initial spacing candidates: 4/8/12/16/24/32; icon sizes: 16/20/24; body near 16 with comfortable line height. These are our candidates, not measured Muse tokens. Retain the existing proposed Roboto web direction subject to rendered review; use native system typography and Dynamic Type for SwiftUI. Do not silently impose the source's system-font recommendation on all clients.

Candidate desktop rail is 64 CSS px, context list 320–380 and inspector 360–440; test against existing layout before selecting exact values. Collapse panels whenever content cannot fit, rather than treating the source's 840/600 breakpoints as established requirements. Test at 390, 768, 1024 and 1440 CSS px and at 200% zoom. Keep dialogs inside the available viewport, mobile safe areas and keyboard insets. Support light/dark/system, visible focus, reduced motion and reduced transparency. Verify contrast in every delivered theme; no color-only statuses. Use at least 44-point touch targets on iOS and generous web touch targets.

## Screen and state inventory

| Surface | Delivered slice | Required states and interactions | Domain authority |
| --- | --- | --- | --- |
| Conversation list | M1a | Empty, selected, loading, unavailable; stable chat title, new chat and per-thread draft/scroll restoration | Conversation/message IDs |
| Transcript/composer | M1a | Draft, submitting, acknowledged, streaming, partial/interrupted, complete, failed; attachments staged, `/new`, explicit Stop and queued follow-up | Messages, runs, provider mapping |
| Library/result viewer | M1b | Loading, empty, ready, missing/deleted, unsupported preview, version selection; revise/download with provenance | Artifact/version/blob |
| Activity/step detail | M1c | Queued, running, waiting, completed, failed, stopped, unknown; date groups, step expansion, conversation/output links | Runs/events/tool-step projection |
| Approvals | M1d | Pending, submitting decision, denied, expired, revoked, consumed; exact effect/destination/scope | Approval/action receipt |
| Computer | M1d | Connecting, observing, takeover pending, human control, private entry, resuming, disconnected/paused, stopped | Browser assignment and controller lease |
| Search | M2 | Empty query, searching, results, none, error; title picker separate from full-content search, jump/highlight exact message | Authorized derived index |
| Upcoming | M2 | No schedules, enabled/disabled, estimated next run, missed run, execution and delivery history | Schedule revisions/run/outbox |
| Identity/Memory | M2 | Viewing/editing/saving, conflict, saved revision, unavailable; source and scope inspection | Agent/memory revisions |
| Devices/host picker | M2 P8 | Selected host, connecting, offline/stale, insufficient grants, revoked, unsupported capability | Host/device grants and manifests |
| Settings | M2 | Providers, devices, permissions, appearance, data export/delete, setup health; conditional features only | Actual host configuration and grants |
| Feed/Ideas/Goals | M4 | Source-defined browse/discuss/build/progress states adapted to our explicit activation and budget policy | Separate product domains |
| Sharing/membership | M3 | Private/shared scope, invitations, history grants, revoked access; no accidental private continuation reuse | Workspace/resource grants |

## Conversation and object navigation

Each conversation owns its draft, pending attachment references and scroll position. Switching chats never sends a draft, moves attachments or changes the target of a pending approval. Shared-in/dragged/pasted content is staged until Send. Preserve user text on validation/network failures. A draft with unacknowledged submission remains clearly distinct from a server-accepted message; retries reuse the same request key.

`/new` creates fresh thread context, preserving prior history. Agent identity/policy and explicitly enabled approved memory remain separate, inspectable layers. A new conversation does not silently inherit old native continuation or workspace files. Queued follow-ups remain in their selected conversation. See P9 and B01/B02 for persistence and isolation acceptance.

A Discuss or Reply action attaches a typed reference card to the composer, with originating object, host and scope visible. It does not submit immediately. Back restores filters/selection/scroll. Search opens the exact message with temporary highlighting and source context. Do not load hidden control traffic into user search or Activity.

### Proposed object routes

Use host and workspace scope in URLs/native navigation state; server authorization remains mandatory. Path shape is a proposal to freeze with the API, not an existing endpoint:

```text
/h/:hostId/w/:workspaceId/chat/:conversationId
/h/:hostId/w/:workspaceId/chat/:conversationId/message/:messageId
/h/:hostId/w/:workspaceId/runs/:runId
/h/:hostId/w/:workspaceId/artifacts/:artifactId/versions/:version
/h/:hostId/w/:workspaceId/approvals/:approvalId
/h/:hostId/w/:workspaceId/schedules/:scheduleId
```

A link never carries a bearer approval or provider-session reference. Deleted, inaccessible and unknown IDs produce safe unavailable states without leaking another user's content. Host-offline is distinct from object-not-found. Native deep links do not enable general remote web hosting. Approval previews are read-only; opening a URL cannot consume a decision.

## Status and command semantics

Use backend states, not an independent client workflow that guesses completion. “Submitting” is local; “Queued” requires durable server admission; “Running” requires observed execution; “Completed” requires a terminal result; “Delivered” requires the relevant transport receipt. Interrupted/unknown outcomes keep retry disabled until reconciled. Show partial output without relabeling it a completed response.

Deny rejects the specific proposed action. The source's diagram equates denial with cancelling the whole workflow; AgentMeld does not copy that assumption. The harness may finish with a limitation or continue along another permitted path. Approval completion never implies tool execution or external success. Disabled buttons during submission are UX feedback, not duplicate-action protection.

Client snapshots/events carry schema version, object IDs/revisions and host-local replay cursor. Apply idempotently and reject older revisions. On a replay gap fetch an authorized snapshot; do not ask the model to reconstruct task state. Ordering across hosts is display ordering, not proof of causality. These client contracts extend the [data blueprint](../specs/data-model.md), not a new canonical store.

## Keyboard, tooltip and focus contract

Tooltips appear on hover and keyboard focus, are associated with the control's accessible name, remain within the viewport and dismiss on pointer/focus exit or Escape. They never block a click. Decorative icons need no tooltip. Touch controls retain names without requiring hover.

Candidate shortcuts: Cmd/Ctrl+K for search once available; platform menu commands for new chat, attach, settings and Stop. Avoid hijacking browser print or another reserved shortcut merely because the source lists it. Expose supported shortcuts in help. Escape first dismisses the topmost tooltip/menu/dialog and restores focus; it must not also cancel a run. Run Stop is an explicit visible control, keyboard accessible, and remains available on mobile rather than hover-only.

Dialogs trap focus appropriately and restore it to the invoking control; inspectors use nonmodal focus behavior unless a narrow-layout sheet is modal. Announce response start once and major state changes politely, not every streamed token. Keep focus stable during streaming and step updates. Preserve user scroll when they read older messages; offer Jump to latest.

## Degraded, privacy and cache behavior

- Offline: preserve a local draft or explicitly pending send; never label it delivered. Do not silently queue consequential approval decisions for later replay.
- Stream interrupted: retain partial text, cursor and honest state; reconnect/reconcile before scoped retry.
- Host asleep/unreachable: keep cached navigation readable with freshness indication; Stop/approval cannot claim success without host readback.
- Expired approval: disable decision and explain how to request a new one. Dismissing an OS notification is not an approval or implicit denial in our alpha.
- Conflicting edit: preserve the draft, show revision conflict and offer compare/reload; no last-write-wins overwrite of memory or source files.
- Capability unavailable: explain missing connection, grant, OS permission or provider availability separately. Do not infer capabilities from platform name.
- Client caches partition by owner/host/workspace/conversation. Clear protected caches on logout/revocation/reset; no cross-account stale content. Native secret storage uses platform facilities. Draft persistence/retention needs a documented local-data policy; no plaintext provider credentials in browser storage.
- Identify data origin: isolated Agent computer, named Mac, Mac browser, paired phone or connected cloud account. Downloads originate from scoped artifacts, not raw host filesystem paths.

## Differences from the source specification

| Source rule/recommendation | AgentMeld decision |
| --- | --- |
| Never add group/shared controls | Single owner at alpha; explicit scoped sharing remains M3 |
| macOS tab/settings parity unknown | Prior Mac screenshots are dated evidence; our native requirements are product decisions, not claims of Muse parity |
| Web devices view-only | Our required multi-host owner workflows govern pairing/revocation; do not copy an account-specific limitation |
| Accounts Center, referrals, Meta subscription, confidential-VM controls | Omit provider-specific product controls; self-hosting requires no Digital Meld account |
| Android foundation/default-assistant behavior | Future candidate; not introduced into Apple-first alpha |
| Exact approximate two-week Idea expiry, 30-day trash, immutable goal nesting limit | Reference behavior only; choose our policies when those domains ship |
| Deny cancels workflow; Escape stops stream | Scoped denial and explicit Stop; Escape prioritizes overlay dismissal |
| Prototype all platforms with mock providers, new framework/workbench/state-machine dependencies | Improve the existing working POC; use synthetic UI fixtures only for unavailable states, clearly labeled; no new dependency selected |
| Production tokens and approval layout | Unknown; candidate values require actual rendered review |
| Provider-specific language/Feed side effects | Separate interface locale from content-generation preferences; no background generation merely from changing language |

## Acceptance and delivery

M1a: verify three-turn conversation, draft switching, queued follow-up, `/new`, browser reload and service restart with correct files/context. M1b: output preview/download/revision and preserved source/version links. M1c: implement B03–B07 and inspect desktop/narrow rendering, tooltips, keyboard/focus, Activity step detail and conversation/output navigation. M1d: pending/denied/expired approvals and real browser takeover/resume/stop/disconnect. M2: actual native macOS/iOS and required cross-network P8 journeys; device-frame web previews are not native-device acceptance.

For every shipped screen, test loading, empty, success, error, permission denied and offline states where applicable. Test 200% zoom, keyboard-only, VoiceOver on native clients, Dynamic Type, reduced motion, safe areas and long translated labels. Initial local-web browser matrix must cover the explicitly supported browsers; do not claim the source's full four-browser or Android matrix without executing it. All automated checks remain local; no GitHub-connected CI.

Observe and record actual platform/version/viewport, screenshots, focus behavior and endpoint results during implementation. Static documents and successful builds do not establish visual or interactive acceptance. This planning update itself performs no UI implementation or usability verification.

## Interactive prototype refinements

The [15th-source review](../research/muse-prototype-review.md) adds examples without changing the chosen shell or milestone sequence. Its purple workbench, four-tab phone frame and local success messages are illustrative, not our design authority or proof of execution.

- **M1a:** suggestion cards prefill the current draft; they do not submit or change host/conversation. Restore drafts after navigation.
- **M1b:** artifact Open/download and source links resolve actual authorized IDs and the selected immutable version.
- **M1c:** Stop first shows cancellation requested, then reconciled terminal state. Activity counts and step detail derive from the same events; only claim retained partial work when output references exist. Test reconnect/reload during cancellation.
- **M1d:** approval identifies acting account/host, exact destination and complete effect/payload or accessible full preview. Bind the decision to the immutable proposed revision; changed payload requires new consent. Separate accepted decision, executing action, confirmed result and unknown outcome. Test duplicate decisions, payload changes, expiry and disconnect after approval; do not blindly retry external writes.

These refinements use the existing planned data model. No production changes, additional framework, new provider or Android requirement follow from the prototype.
