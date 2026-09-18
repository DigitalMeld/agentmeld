# Muse mobile visual reference

Reviewed: 2026-09-18. Evidence: 22 screenshots supplied by Brad in this conversation, plus the public [Muse App Store gallery](https://apps.apple.com/us/app/muse-from-meta/id6760173601), inspected in the browser. This supplements the [cross-platform baseline](muse-baseline.md). These are visual references, not a claim that AgentMeld implements these features.

## Provenance and coverage

The numbered inventory follows the attachment order in Brad's “Mobile app screenshots” message. All 22 images were visually reviewed. User-supplied screenshots supersede the incomplete earlier mobile capture for the surfaces below. Raw screenshots, private conversation content, account details, device names and custom artwork are not copied into this repository. Original temporary attachments were not modified.

The earlier live capture was interrupted by assistant navigation errors that repeatedly opened sharing. The previous explanation that the phone became unavailable was unsupported. No phone interaction was needed for this review.

| Image | Surface | Visible design evidence |
| --- | --- | --- |
| 1 | Main chat | Centered avatar/name, circular menu, invite pill, rounded message bubbles, muted timestamps, inline image; attachment/message/microphone composer above floating five-icon navigation |
| 2 | Feed | Edition headings, icon-led stories with text, links and imagery; reaction, discussion and information actions; thin separators |
| 3 | Ideas | Flat list with expressive icons, bold titles and muted multiline previews; generous spacing rather than a card grid |
| 4 | Goals | Tracking empty state, create action and category rows with icons and trailing plus controls |
| 5 | Library: Artifacts | Wide Artifacts/Media segmented control, centered icon/title/explanation empty state |
| 6 | Library: Media | Same shell with populated thumbnail tiles, title/status and an edit affordance |
| 7 | System Files | Back/title/overflow header, sort control and folder rows with name, type and chevron; bottom navigation retained |
| 8 | Chat switcher | Selected Main chat row, Side chats section and archive affordance; centered empty state; bottom search and separate compose control |
| 9 | Settings, top | Tall rounded sheet, prominent title and circular close button; usage block and grouped destinations |
| 10 | Appearance | Miniature conversation preview, accent swatches, avatar-size selector and System/Light/Dark choices |
| 11 | Notifications | Single switch row and short explanatory helper text |
| 12 | Messaging channels | Explanation, availability section and WhatsApp destination |
| 13 | Permissions | Separate connector and web defaults; descriptive choices with checkmarks; management rows with counts and chevrons |
| 14 | Credentials store | Back/title/add header; centered empty state and a single primary action |
| 15 | Wallet | Prominent icon/title/explanation and one add-payment action |
| 16 | Devices | This device and Other devices groups with icon/name/chevron rows |
| 17 | Connectors | Search above Connected and Available groups; chevrons for connected entries, explicit Connect actions for available entries |
| 18 | Settings, lower | Grouped appearance, support, data and account destinations; close control remains visible in this captured scroll position; separated red logout action |
| 19 | Legal | Explanatory block and grouped policy links with external-link indicators |
| 20 | Help and support | Help link, feedback destination and separate shake-to-report switch |
| 21 | Report issue | Labeled multiline field, counter, attachment tile, wrapping category chips and prominent bottom submit action |
| 22 | Data controls | Privacy explanation, training preference, memory import and data export destinations; isolated destructive reset with consequence text |

## Visual language

The supplied images show dark neutral surfaces, bright primary text, subdued secondary text and limited accent color. Main content sits directly on the background; settings use rounded grouped rows. Circular back/close/overflow controls, pill-shaped search/composer fields and a floating translucent navigation bar provide consistent chrome. The active navigation item has a darker capsule. Chat uses an accent for outgoing messages and neutral incoming bubbles.

Identity is prominent on primary destinations; detail screens replace it with a compact title and back control. Empty states explain the next action without filling the screen with sample data. Chat switching has its own mobile surface. Settings provide progressive disclosure rather than an infrastructure dashboard.

These observations do not establish exact fonts, point sizes, radii, color values, blur parameters or animation timing. The captures include device framing and surrounding display content; screenshot pixels must not be treated as native layout points.

## Public App Store examples

The gallery was visually inspected on 2026-09-18. Seven promotional panels show light-theme chat with a document, an inline purchase approval, a browser task preview, connector discovery, Ideas, a spending artifact in chat and populated Goals. The approval example includes context and distinct Deny/Allow controls. The browser example includes a preview and an Open browser action. Goals separate ongoing tracking from goals and creation.

These add light-theme and populated-state references missing from the supplied dark-mode set. They are published illustrations, not independently exercised workflows. In particular, they do not prove approval enforcement, successful purchases, browser takeover, or background execution. No promotional artwork was downloaded or imported into AgentMeld.

## Application to AgentMeld

Preserve the conversational hierarchy, restrained chrome, grouped settings, dedicated chat switching and artifact discoverability. Keep agent identity, conversation and execution host distinct. Add a compact host selector near task context, with the target repeated on approvals and computer-control screens. Device management should distinguish this client from execution hosts and expose connection state, grants and revocation. The Muse device list alone does not establish those semantics.

An approval should be a structured action card with the target host, exact proposed action, relevant resource and explicit decision controls. Show pending, expired and resolved states consistently across clients. A browser/computer preview can open task detail; it must not imply that viewing grants control. Offline and reconnecting states must remain visible, and remote cancellation requires host acknowledgement.

Alpha uses Codex subscription authentication. Keep model selection in task or agent detail; add Claude Code and Ollama provider choices only after their post-alpha qualification. Later guest access should add participant and resource visibility context where relevant, without introducing unused team controls into the owner-only alpha.

This reference does not expand alpha scope. macOS, local web, iOS, multiple Mac hosts and away-from-home control remain required. Feed, generated Ideas, broader goal coaching, wallet/purchases and messaging channels retain their roadmap scope. Only implemented destinations should appear in navigation. The credentials-store illustration does not authorize a new credential storage design. File browsing must use explicitly granted resources; visible Muse folder names are not evidence of its backend architecture or an AgentMeld filesystem contract.

## Remaining validation

Static screenshots do not verify keyboard behavior, attachment picking, avatar-to-inspector transitions, back gestures, accessibility, safe-area behavior during scrolling, motion, notification delivery, account synchronization or security enforcement. A selected preference is not proof of a product default. Public approval and browser examples do not replace live approval or takeover acceptance tests.

Next: render one original AgentMeld mobile conversation with host selection and idle, running, approval, artifact, offline and reconnecting states. Review its hierarchy against these references before expanding the UI; validate touch targets, readable contrast, Dynamic Type, VoiceOver labels and keyboard clearance on the implemented app. Keep live interaction checks separate from visual comparison.
