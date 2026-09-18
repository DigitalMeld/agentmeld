# Apple-first alpha and deferred messaging

Date: 2026-09-18. Status: Apple-first, multi-system and away-from-home alpha requirements confirmed by Brad; client technology and remote transport remain proposed.

## Accepted direction

Alpha targets macOS applications, a local browser, and an iOS application, with multiple named Mac hosts under one owner. Each enrolled Mac host owns its durable agent work and isolated Linux execution environment. A Mac may be a client, an execution host, or both. iPhone is a client for the same agents, tasks, approvals and artifacts, not a separate agent runtime. Alpha is Codex-only using the owner’s ChatGPT subscription, as reconfirmed by Brad on 2026-09-18. Claude Code and Ollama are post-alpha; earlier three-provider wording is superseded.

Move iMessage, WhatsApp, Windows, general remote-browser access and additional connectivity integrations after alpha. One secure cross-network connection for native clients is required in alpha, following Brad's explicit clarification. Linq, BlueBubbles, imsg and Tailscale remain research candidates, with no installation or provider selection authorized by this decision. This supersedes the earlier iMessage M0 gate and M2/P7 requirement, including those in the historical OpenInstinct audit.

Muse/Grok Bot breadth is the product direction. Alpha acceptance uses named workflows; complete vendor parity has not been established or scheduled. Retain the reference feature matrix to track verified observations, planned scope and deferred features without claiming all functions are implemented.

## Recommended application shape

- One Rust control service on the Mac owns authentication, policy, task state, scheduling, event replay and artifacts. Lifecycle supervision lets work continue when client windows close, while the Mac remains awake and connected.
- SwiftUI is the proposed native UI for macOS and iOS, sharing Swift API/event models and reusable views where practical. React remains the local browser client. Keep orchestration and authorization in the service rather than duplicating them in Swift or TypeScript. Apple's framework supports both Apple platforms; this is a design recommendation, not a packaging prototype. [SwiftUI](https://developer.apple.com/swiftui/)
- Native clients use the same versioned authenticated API as the local web client. Keep the browser viewer behind one authenticated control lease, with fresh observation on resume. A bounded web-based viewer inside a native screen is acceptable if qualified; do not build a remote-desktop protocol.
- Agent execution remains in the Mac's VM/container environment. “Control things on my Mac” initially means controlling this hosted agent workspace. Arbitrary macOS desktop automation or personal file access requires a separately scoped, explicitly granted host tool, not an unrestricted shell escape.

## Connectivity decision

An iPhone cannot reach a Mac's loopback address. Same-network use needs explicit authenticated pairing and a secured reachable endpoint. Away-from-home use additionally needs a private route or relay across networks. Deferring every remote connection while promising cellular control would be contradictory.

**Confirmed alpha gate:** an iPhone over cellular and a MacBook Air on an external network must control the Mac mini at home. Same-network-only use is insufficient. Deliver one owner-only secure connection path; defer general remote web access, multiuser hosting and a connectivity catalog. No transport provider is selected. Compare a conventional secure private route/reverse connection with a Nostr event transport before committing; see the [Nostr/Buzz assessment](../research/nostr-buzz-connectivity.md).

Device pairing, TLS/trust, revocation and replay-safe reconnect are mandatory. Hiding the web page is not an authorization boundary for the API. A reachable relay or private routing service must itself be operated somewhere; neither Nostr nor the native apps eliminate this dependency. Preserve a documented self-host path without requiring a Digital Meld account.

The Mac must be available; sleep, power loss and network loss appear as offline, not successful control. Do not promise wake-from-anywhere. Persist work server-side and reconcile on reconnect. Client commands need stable request IDs and explicit accepted/pending/unknown states; stale approvals must never auto-submit after reconnection. Background notifications are a separately qualified enhancement; correctness cannot depend on an always-connected phone or push delivery.

## Alpha acceptance and sequence

1. Finish outstanding M0 provider, isolation and recovery evidence. Remove messaging qualification from its exit gate.
2. M1: one Mac-hosted service and local browser workflow; establish authenticated API/event contracts and Mac service lifecycle.
3. M2: native macOS and iOS clients over the same service. Pair a physical phone, create work, observe progress, approve/deny, inspect artifacts, stop, background/reopen the app and recover state after interruption. Cross-client state must agree.
4. Qualify Mac install/start/stop, client-close behavior, sleep/offline reporting, device revocation, iOS distribution path and browser-control usability. Any action unavailable on the phone needs an explicit limitation rather than a parity claim.
5. Required: repeat the phone journey over cellular and the MacBook Air journey on a separate network, targeting the home Mac mini. Demonstrate chat, approvals, artifacts, live agent-browser control, cancellation and reconnect.

## Deferred work and remaining decisions

Post-alpha: iMessage/WhatsApp and transport selection; Windows packaging; general remote browser access; additional network providers; collaboration; hosted service and custom model. Existing richer media, proactive goals, payments and connector breadth remain staged in the roadmap.

Before implementation: select and qualify one remote transport; qualify SwiftUI/service/viewer integration; choose minimum OS versions and an iOS development/distribution path; establish Mac resource requirements. Installation, signing, account enrollment, network exposure and deployment are separate actions requiring their applicable authorization.

## Multiple systems and execution ownership

Register hosts independently from client devices. Every run, command, approval, artifact and browser lease binds to an immutable host ID plus workspace ID. Show the host in the composer/task header and require explicit selection when changing execution destination. Display host capabilities and freshness/offline state. A disconnected host never causes automatic execution on another Mac.

Each host remains authoritative for its own runs, credentials, files and recovery. Clients may aggregate authorized host summaries without creating two writers for a run. A host-local agent or browser profile does not become available on another machine merely because both share an owner. Automatic host-to-host workspace transfer, task migration, shared credentials, automatic failover and a distributed database are separate future capabilities. Authorized client uploads and artifact downloads remain in alpha. Alpha must support enrolling a second host and rejecting wrong-host commands; the MacBook Air must also work as a client without starting an execution VM locally.

Pairing distinguishes owner approval, device identity, host identity and granted capabilities. Use separately revocable device credentials rather than copying one owner master key to every endpoint. Concurrent clients see the same task state; one controller lease governs interactive browser input. Host-side policy rechecks apply even to correctly signed commands. A relay receipt is not host acceptance or execution completion.
