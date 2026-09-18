# Muse design baseline

Date: 2026-09-18. Status: accepted visual/interaction direction; initial Mac/web observation and review of 22 supplied iPhone screenshots complete; deeper mobile interaction checks remain. Brad describes Muse as the preferred starting point, with later adaptation for guests and shared resources. This supersedes generic dashboard-style interpretations of “Muse-inspired.”

## Evidence and limits

Inspected the installed Muse Mac application (`com.meta.endo`) and the existing Muse tab in Brad's Chrome profile using accessibility trees and rendered screenshots. Screenshots were inspected in-session, not exported into this repository. Personal transcripts, agent identities, account details and proprietary assets are not reproduced here.

Observed native Mac chat, Feed and Library/Podcasts; browser chat, Library/All artifacts, the Activity inspector and Approvals empty state. Side-chat navigation exposed a searchable secondary panel and resize control. Read-only navigation only: no messages sent, tasks generated, invitations issued or settings/permissions changed. Account/agent contexts differ across the two surfaces; similarities establish a visual reference, not synchronization or feature parity. Exact font families, color tokens, spacing, animations, implementation framework and keyboard behavior were not measured or verified.

After Brad completed iPhone Mirroring setup, inspected the live mirrored phone: Settings, the main/side-chat switcher and the main conversation layout. The accessibility tree exposed the mirroring window but not individual iOS controls, so navigation used rendered screen coordinates. Assistant navigation errors repeatedly opened sharing; no share destination was selected. The earlier claim that the mirrored phone became unavailable was unsupported. This incomplete pass did not reliably verify deeper panels or keyboard behavior. No new mirroring permissions were granted in this pass. Public sources are recorded in [Muse design sources](../research/muse-design-sources.md); their claims are distinct from these live observations.

## Observed design patterns to preserve

| Surface | Observed pattern | AgentMeld application |
| --- | --- | --- |
| Global shell | Narrow icon rail, restrained selected backgrounds, fine separators, settings anchored low | Keep navigation compact; avoid a permanently expanded admin sidebar |
| Chat | Centered readable message column, generous margins, muted assistant bubbles and restrained accent on user messages | Conversation remains the primary work surface |
| Composer | Rounded bottom-anchored field with attachment and dictation affordances | Keep input visually simple; expose only implemented capabilities |
| Chat navigation | Compact Chats control and secondary searchable side-chat panel | Separate switching conversations from browsing system settings |
| Agent context | Avatar/name entry point; browser inspector shows connection status | Add a compact, explicit execution-host selector near agent/task context |
| Inspector | Optional right panel with Activity, Approvals, Upcoming and Identity; icon-led segmented switcher | Preserve this hierarchy; computer view is contextual rather than a default dashboard |
| Activity | Date-grouped rows with a status icon, short action title, muted result summary and time | Show verified outcomes and pending work, with detail on demand |
| Approvals | Quiet icon/title/short-message empty state | Keep “nothing waiting” distinct from loading, offline or denied access |
| Library | Global rail plus local category sidebar, search, heading, compact actions and spacious content area | Keep files/artifacts discoverable independently of conversation |
| Empty Library | Small central icon/message and a clear create action near the heading | Avoid promotional cards, fake examples or claiming unsupported output types |
| Feed | Readable editorial column, edition groupings, secondary discuss/reaction actions | Retain as a later feature reference; do not add its engine to alpha merely to fill navigation |
| Appearance | Dark neutral surfaces, subtle elevation, rounded controls, limited accent and little decoration | Use original AgentMeld assets while preserving hierarchy, density and restraint |

Mac chat was observed with the inspector closed and a centered avatar/name; browser chat with the inspector open. Treat this as observed state variation, not proof of a platform-exclusive rule. Native Mac accessibility exposes HTML content; that alone does not establish the app's framework or dictate AgentMeld's technology choice.

## Native iPhone observations

The [mobile reference](muse-mobile-reference.md) inventories all 22 screenshots subsequently supplied by Brad and the public App Store gallery. It supersedes the incomplete live capture for visual coverage of the photographed surfaces, including settings, permissions, devices, connectors and data controls.

| Surface | Live observation | Design implication |
| --- | --- | --- |
| Settings | Tall rounded sheet, title and circular close control, grouped rows with icons/chevrons; Devices and Permissions are visible destinations | Keep setup and access controls in grouped settings rather than the main conversation |
| Chat switcher | Dedicated screen with agent name, Main chat selection, Side chats section, explanatory empty state, bottom search and compose affordance | Use a full mobile navigation surface rather than a compressed desktop sidebar |
| Main chat | Centered avatar/name, top conversation-menu and invite affordances, dark conversation surface, rounded message bubbles and inline media | Retain familiar messaging hierarchy and separate content from controls |
| Bottom controls | Rounded composer above an icon navigation bar with five visible destinations | Keep primary navigation within thumb reach; do not squeeze desktop inspector tabs alongside chat |
| State and density | Compact timestamp separators, restrained accent for user bubbles, neutral assistant messages | Avoid dense task tables or infrastructure labels in the default phone experience |

These are visual observations at the mirrored device's displayed scale, not measured layout tokens. Avatar-to-inspector behavior was not independently confirmed during the interrupted live pass or by the supplied static screenshots. Meta's published design article describes that interaction; label it as vendor-described until a live follow-up succeeds. No conclusion about touch responsiveness or motion should be drawn from delayed mirroring frames.

For AgentMeld, propose a compact host label beside/below agent identity that opens a host-selection sheet. Keep host selection distinct from chat selection, and retain the target host in approval and computer-control views. On a phone, an inspector may use a sheet or dedicated screen; the exact treatment remains subject to live reference verification and a rendered prototype. Distinguish these proposed additions from Muse observations.

## Necessary AgentMeld additions

- Keep agent, conversation and execution host distinct. Use a compact host control showing a friendly name and connection state. Make the chosen host visible when sending work and reviewing approvals.
- Present offline/reconnecting/pending acceptance explicitly without crowding ordinary chat. Never show an unacknowledged remote stop as completed.
- Use the existing inspector for task detail, permissions and computer state. Avoid exposing transport names, container IDs, protocol versions or model plumbing in ordinary flows.
- Native macOS, local web and iOS share information architecture and task semantics. SwiftUI remains a proposed implementation, not a reason to redesign the visual hierarchy.
- Guests/shared resources arrive later through explicit workspace and visibility controls. Reserve contextual locations for participant identity, resource owner, sharing scope and permission state. Do not show disabled team-management UI in the owner-only alpha.
- Keep AgentMeld branding and assets original. Preserve the observed interaction patterns rather than importing Muse code, avatars or proprietary artwork.

## Design acceptance before expanding the UI

Build and render one representative conversation first, with original fixture content: idle, running, waiting approval, completed artifact, cancelled, offline and reconnecting states. Compare the rail, chat width, typography hierarchy, composer and inspector directly with this reference. Include compact host selection without losing the quiet composition. Validate keyboard/focus/labels and contrast, not appearance alone.

Then validate Library and task detail, followed by native macOS/iOS equivalents and cross-device behavior. Exact dimensions and tokens should be recorded from the implemented design and rendered comparison, not invented as Muse measurements. Do not expose navigation for features that have not shipped.

## Remaining observation work

1. Native iPhone interaction follow-up: composer/keyboard, attachments, inspector transitions, safe areas, back gestures and small-screen approval/artifact flows. The supplied screenshots now cover the main destinations and settings; public gallery examples add light appearance and populated states. Neither source verifies these interactions.
2. Actual pending approval and active computer/takeover screens, using an explicitly authorized safe task or existing state. Empty-state inspection does not verify these workflows.
3. Window-width behavior, light appearance, keyboard focus, motion/reduced motion and error states without changing account settings unasked.

Next implementation remains the first end-to-end workflow. This reference refines its UI; it does not authorize a broader feature build or change the Apple-first alpha scope.
