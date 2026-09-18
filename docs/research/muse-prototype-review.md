# Muse interactive prototype review

Reviewed 2026-09-18. Source: owner-supplied `MUSE UI:UX Framework — Interactive Prototype.html`, recorded in the [bundle manifest](muse-documentation-manifest.json). This is a source inspection of HTML, CSS and JavaScript. Browser policy blocked opening the local HTML; rendered layout, keyboard behavior and interactive acceptance were not verified. Original source/assets are not copied into this repository.

## What the prototype adds

The file is an interactive documentation workbench containing Overview, Prototype, Components, UX spec and Platforms sections. Its five scenarios illustrate first run, chat, approval, artifact detail and background tasks. Six component demos cover composer, approval, progress, artifact, empty and recovery states. Platform controls change CSS classes for web, macOS, iOS and Android device frames; these are not native applications.

The useful implementation lessons are contextual access requests on first use, consequence-specific approval labels, durable artifact provenance, explicit current-step progress and recovery that identifies preserved work. These reinforce the existing [UI/UX contract](../design/ui-ux-contract.md), [data blueprint](../specs/data-model.md) and B01–B07 in the [backlog](../backlog.md).

## Behavior inventory from source

| Example | What the code does | AgentMeld implication |
| --- | --- | --- |
| Workbench navigation | Hash navigation selects a documentation page; component search filters buttons | Useful review tooling, not application routes or content search |
| First-run suggestions | Each suggestion replaces the demo body with the same canned chat | Stage a suggested prompt in the real composer; require Send, preserve selected conversation and host |
| Chat | Displays fixed messages, a working indicator and an input; Send has no handler | No demonstrated inference, streaming, thread continuation or `/new` behavior |
| Approval | Send/Keep as draft hide the card and set local text; Send immediately claims completion | Persist the decision separately from execution; require action receipt before claiming external success |
| Background task | Stop changes text, removes the button and claims partial work preserved | Request cancellation, reconcile terminal state and link actual retained outputs before claiming preservation |
| Artifact | Fixed preview/title/provenance text with an inert Open button | Resolve artifact/version and originating conversation IDs, authorized preview and download |
| Device switch | Changes frame CSS; retains the current DOM | No proof of native parity, cross-device sync, offline recovery or multi-host routing |
| Scenario switch | Replaces the scenario DOM from a template | Do not reproduce draft/state loss; retain per-conversation drafts, scroll and pending submissions |
| Download spec | Downloads an embedded condensed Markdown string through a Blob URL | This is a separate summary, not the complete 1,539-line framework specification |

No backend requests, persistence layer or execution adapter appear in the script. Fonts load from Google Fonts; a single HTML file is therefore not completely network-independent. Mock sidebar/bottom navigation and most component action buttons have no behavior. The prototype's claim of an AA accessibility target is a target, not a verified result.

## Conflicts resolved for AgentMeld

- **Navigation:** the mobile frame has Chat/Tasks/Files/More, while supplied Muse screenshots show Chat/Feed/Ideas/Goals/Library. The framework's own primary list differs again. Keep our decided Chat/Library-first delivery and eventual screenshot-informed hierarchy; Activity stays in the inspector instead of adding a duplicate Tasks destination.
- **Visual design:** the workbench uses a purple palette, large editorial hero, textual sidebar and decorative artifact gradient. These are reconstruction choices, not measured Muse tokens. Preserve the neutral Muse reference direction and original brain/icon work; do not transplant the documentation shell into the product.
- **Approval completeness:** the example displays a recipient label and subject but no exact address, email body, attachments or sending account. Real approval must identify the acting account/host, destination and complete effect/payload or an accessible full preview. Bind consent to its immutable revision; edits invalidate prior consent. Showing “Sent” after a button click is insufficient.
- **Cancellation:** the demo leaves the overall “1 active” header unchanged after Stop and reuses a generic status dot. Derive counts and row states from canonical events, with textual stopped/failed/waiting distinctions. Unknown execution outcomes remain unknown until reconciled.
- **Sizing/accessibility:** the 300px-wide phone frame and tiny simulated controls are illustration scale, not production touch-target guidance. Native Dynamic Type, safe areas, focus, screen-reader announcements and real-device checks remain delivery gates.
- **Scope:** Android, external email delivery and platform notification embellishments do not become alpha dependencies because a demo depicts them. Required Apple clients, Codex subscription and away-from-home multi-host control remain unchanged.

## Concrete additions to the implementation plan

1. M1a: suggestion cards prefill the selected composer's draft without sending; navigating away/back preserves it. Test pending-send retries with the same request key.
2. M1b: artifact rows show actual title/type/version and source conversation; previews and downloads resolve that exact version.
3. M1c: cancellation has a pending state until acknowledged; Activity counts, detail and retained-output links agree after reconnect/reload. Never invent progress percentages or output-preservation claims.
4. M1d: approve the precise proposed effect; separate decision accepted, execution underway, confirmed success and unknown outcome. Denial retains permissible draft work. Test double-clicks, edited payloads, expired approvals and lost connections after approval.

No extra framework, dependency, schema table or milestone is needed from this source. The existing runs/events, approvals, artifacts/versions and delivery receipts provide the planned authority. This review changes planning documents only; it does not establish product implementation or Muse feature parity.
