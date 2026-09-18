# iMessage channel research

Current scope note (2026-09-18): alpha is Codex-only with ChatGPT subscription authentication. Claude Code, Ollama and messaging research below is retained for post-alpha; it does not impose an M0 exit gate. See the [current checklist](../m0/exit-checklist.md).

Scope update: [Apple-first alpha decision](../decisions/2026-09-18-apple-first-alpha.md) defers messaging and transport selection until after alpha. Earlier M0/M2 channel recommendations below are retained as research history, not current release gates.

Updated: 2026-09-18. Status: proposed design, supported by official Apple/BlueBubbles documentation and read-only source inspection. No messages sent, software installed, accounts changed, or host permissions modified. No end-to-end transport test has been performed.

## Recommendation

Support iMessage as an **optional communication channel through an owner-controlled Mac bridge**. Keep the agent's execution in its Linux container/VM. The Mac bridge receives approved conversations, forwards normalized messages to AgentMeld, and delivers replies. It does not execute model-generated commands or grant access to the Mac desktop.

Compare BlueBubbles and [imsg](https://github.com/openclaw/imsg) in SIP-enabled mode before selecting the first implementation: direct text messages, small supported attachments, status/completion notifications, and links to AgentMeld for consequential approvals. Group participation requires a separate qualification milestone. Do not make disabling System Integrity Protection part of normal installation.

## What the primary sources establish

### Apple platform and API boundary

Apple documents signing into Messages on Mac with an Apple Account and choosing reachable email/phone addresses. A phone number is not required for an email-address-based iMessage endpoint. SMS/MMS/RCS forwarding has additional iPhone/account requirements and is distinct from iMessage. [Apple Messages setup](https://support.apple.com/guide/messages/set-up-messages-ichte16154fb/mac).

Outbound replies use that configured Messages account's actual reachable identity. AgentMeld cannot invent an arbitrary sender number or make a renamed agent into a separately provisioned iMessage account. Multiple agents can initially share one bound transport identity with explicit chat-to-agent routing; independent identities require independently qualified account/session provisioning. [Apple sending identity settings](https://support.apple.com/guide/messages/set-up-messages-ichte16154fb/mac).

The public Apple Messages framework documents iOS app extensions that insert or send conversation content within the Messages experience. It does not document a general server-side bot API for reading a personal iMessage inbox. **No public general personal-inbox bot API was identified in the reviewed official documentation**; this is a scoped research conclusion, not proof that no private partnership API exists. [Messages framework](https://developer.apple.com/documentation/messages/).

Apple Messages for Business is an official alternative channel. Its current onboarding requires an Apple-approved Messaging Service Provider, business registration, testing, and Apple experience review. It supports automation but is not interchangeable with a self-hosted personal iMessage bridge. Treat it as a separate hosted-business investigation, with availability, policies, and commercial terms unresolved. [Apple Messages for Business](https://register.apple.com/resources/messages/messaging-documentation/).

### Instinct reference

Instinct's official site says users can text or call the assistant and that it connects to messaging and other applications/devices. The reviewed page does not name its iMessage backend or document a transport API. Use Instinct as an interaction reference, not evidence that AgentMeld can reuse its transport or that it uses BlueBubbles. [Instinct](https://instinct.com/).

### BlueBubbles integration

BlueBubbles says it polls the macOS Messages `chat.db` and uses AppleScript for basic sends/attachments and chat creation. It therefore runs on macOS, not as an ordinary Linux/Windows container. Its optional Private API uses macOS internals for deeper functionality. [Server architecture](https://docs.bluebubbles.app/server).

| Capability | Primary-source evidence | AgentMeld scope |
| --- | --- | --- |
| Receive/send text | Supported in the documented feature matrix; REST text-send handler and incoming-message events exist | Direct-message MVP, qualified on pinned Mac/server versions |
| Receive/send attachments | Documented support; API has attachment send/download handlers | Bounded images/documents first; unsupported or absent files show a clear result |
| Existing groups | Chat identity, participants, group events, and group operations exist | Off by default until membership and routing tests pass |
| Create/manage groups | macOS 11+ group creation and advanced membership operations use Private API | Outside SIP-enabled MVP |
| Reactions, typing, threaded replies, edits/unsend | Private API and OS-version dependent | Optional future capabilities, never inferred from basic message support |
| Delivered/read/error events | Documented webhook events and message metadata | Show reported status separately from queued/submitted/unknown |

Sources: [BlueBubbles feature matrix](https://bluebubbles.app/faq/), [REST and webhook documentation](https://docs.bluebubbles.app/server/developer-guides/rest-api-and-webhooks), [Private API capabilities](https://docs.bluebubbles.app/private-api/).

### Permissions and operational limits

Full Disk Access is needed to read the Messages database. Setup documents Accessibility as optional, and sending may prompt for System Events automation permission. Grant only what the qualified adapter needs. Permissions apply to the Mac bridge, not to the Linux agent. [Installation](https://bluebubbles.app/install/), [send troubleshooting](https://docs.bluebubbles.app/server/troubleshooting-guides/cant-send-messages-from-bluebubbles.md).

Private API installation explicitly requires disabling SIP and changing library validation. Exclude this path from the supported default. BlueBubbles' own docs also describe AppleScript send failures and dependence on the native Messages account working. A server upgrade/macOS upgrade requires regression testing. Some compatibility documentation names old macOS releases; do not recommend an obsolete OS merely from those pages. [Private API installation](https://docs.bluebubbles.app/private-api/installation), [send troubleshooting](https://docs.bluebubbles.app/server/troubleshooting-guides/cant-send-messages-from-bluebubbles.md).

The Mac must be reachable, awake, and running its signed-in Messages/bridge session. Sleep, reboot before login, revoked permissions, account problems, and network loss can interrupt delivery. BlueBubbles documents keep-awake behavior and its laptop-lid limitation. A healthy Linux agent server does not mean iMessage is online. [Sleep behavior](https://docs.bluebubbles.app/server/basic-guides/preventing-macos-from-sleeping.md).

## Pinned source findings

Inspected BlueBubbles `master` at **`f2e2286241a7c3b6617a82b37d4afaab4df3a6b9`**. GitHub metadata reports Apache-2.0. This records research provenance, not a production dependency selection.

- The [message router](https://github.com/BlueBubblesApp/bluebubbles-server/blob/f2e2286241a7c3b6617a82b37d4afaab4df3a6b9/packages/server/src/server/api/http/api/v1/routers/messageRouter.ts) exposes text/attachment sends, message GUIDs, optional temporary GUID correlation, and message queries. Temporary GUID support alone does not establish durable idempotent sending.
- The [attachment router](https://github.com/BlueBubblesApp/bluebubbles-server/blob/f2e2286241a7c3b6617a82b37d4afaab4df3a6b9/packages/server/src/server/api/http/api/v1/routers/attachmentRouter.ts) retrieves attachment metadata/files and has a separate Private API path for purged attachments. Treat a message arriving before its file is available as pending, not empty.
- The [chat router](https://github.com/BlueBubblesApp/bluebubbles-server/blob/f2e2286241a7c3b6617a82b37d4afaab4df3a6b9/packages/server/src/server/api/http/api/v1/routers/chatRouter.ts) supports chat-scoped history with pagination and time bounds. That permits bounded catch-up after missed events.
- The [webhook dispatcher](https://github.com/BlueBubblesApp/bluebubbles-server/blob/f2e2286241a7c3b6617a82b37d4afaab4df3a6b9/packages/server/src/server/services/webhookService/index.ts) posts JSON and logs failures. This inspected component adds neither a signature nor a durable retry queue. AgentMeld must not accept internet webhook claims as authenticated input or assume missed deliveries replay themselves.

## Proposed bridge boundary

```text
Owner's iMessage
    ↕ Apple delivery
Mac: Messages → BlueBubbles → narrowly scoped AgentMeld channel bridge
                                  ↕ authenticated outbound connection
                         AgentMeld ingress / durable queues / policy
                                  ↕
                         Agent inside Linux container or VM
```

The following are AgentMeld design requirements, not existing BlueBubbles guarantees:

1. **Enroll explicitly.** An authenticated owner pairs one bridge using a short-lived, one-use challenge. Issue a device-scoped credential; support revocation and rotation. The Mac initiates the connection to AgentMeld over TLS. Keep BlueBubbles bound/firewalled locally; do not publish its broad API.
2. **Keep Apple identity on the Mac.** Prefer a dedicated macOS account/device and separate agent messaging identity to reduce exposure to personal history and avoid same-account echo ambiguity. Account provisioning remains an explicit owner step. Never upload Apple login credentials or the full Messages database to AgentMeld.
3. **Filter before forwarding.** Bind bridge ID + messaging account + exact chat GUID + canonical sender handle to an AgentMeld actor/workspace/conversation. Require owner allowlisting and proof of control; display names are not identity. New senders, new groups, ambiguous addresses, and changed membership cannot obtain agent access automatically. Pin the service as iMessage; do not silently fall back to SMS/RCS.
4. **Suppress loops.** Drop outgoing self-echoes, delivery/read updates, and reactions as task input. Persist inbound message GUIDs and event revisions. Edits update the record but do not silently rerun a completed task. The official example uses `isFromMe` to avoid echo, but same-Apple-account messaging needs its own design and tests before support. [Webhook example](https://docs.bluebubbles.app/server/developer-guides/simple-web-server-for-webhooks/python-web-server.md).
5. **Recover offline honestly.** Persist ingress after filtering and acknowledge only after commit. Use overlapping, bounded per-chat history catch-up with GUID deduplication. Persist outgoing replies with expiry; stop commands and revoked grants must invalidate stale pending work. If a send times out after possible submission, mark it unknown and reconcile before retry. Distinguish queued, submitted, delivered, failed, and unknown; never claim exactly-once Apple delivery.
6. **Keep approvals in authenticated UI.** Send an HTTPS link to the exact pending action. Opening a link must not approve anything: require the signed-in authorized actor, current action digest, explicit decision, expiry and one-time consumption. Link previews must be read-only. Do not treat a bare “yes,” tapback, forwarded link, or group participant's reply as approval. The phone must have a supported private route or authenticated remote route to the instance; localhost links cannot work remotely.
7. **Constrain outbound scope.** Ordinary replies return only to the bound conversation. Sending to a different person/group is a separate external action and needs its own grant/approval. The model cannot choose an arbitrary BlueBubbles destination.
8. **Handle content deliberately.** Enforce attachment size/type quotas before downloading, retain original provenance, scan/parse in the execution sandbox, and never execute media on the bridge. Signed artifact links require normal access checks. iMessage encryption terminates at the Mac; forwarded content is processed under AgentMeld/provider data rules.

BlueBubbles REST documentation uses password/token query parameters. Isolate that credential within the local bridge and redact URLs; never send such URLs to browsers, models, telemetry, or iMessage. A local webhook should be only a wake-up hint; fetch/verify the referenced message through the local API before accepting it, then relay with AgentMeld authentication. [REST authentication](https://docs.bluebubbles.app/server/developer-guides/rest-api-and-webhooks).

## Qualification and rollout

**Channel spike:** choose a supported current macOS and pin each candidate before comparison; prove SIP-enabled text, inbound/outbound attachment, sender/chat identity, recovery, and documented permissions. Also establish whether the API-only setup can omit Android-specific Firebase notifications; the normal BlueBubbles install guide includes Firebase, so that omission is not yet verified.

**Optional personal channel:** one allowlisted owner DM, agent selection bound in settings, status/stop, final responses, attachment bounds, offline queue, and approval deep links. Run existing Claude/Codex/Ollama tasks through the same normalized ingress; the transport must not bypass normal policy.

**Group/collaboration milestone:** explicitly enrolled groups, participant checks on every inbound and outbound event, revocation on membership change, group-visible-only context, separate shared sessions, and bot-loop limits. Existing-group use and management operations are distinct capabilities. Do not require private API features for basic private messaging.

Required local tests: real owner-phone round trip; duplicate/reordered events; own-message echo; crash after send but before receipt; asleep/disconnected Mac; signed-out Messages; revoked permissions; API/webhook forgery; oversized and missing attachments; sender alias mismatch; group membership change; expired/replayed approval; revoked bridge; stop while a reply/run is queued. No installation or messaging is authorized by this research document.

## OpenInstinct audit update

The [pinned OpenInstinct audit](openinstinct-audit.md) confirms Linq and verified phone-to-user mapping in that project, not in the separate commercial Instinct product. Treat Linq as a managed-provider candidate, not a dependency of self-hosting. BlueBubbles and imsg remain unselected Mac candidates. imsg exposes a Swift CLI/JSON-RPC path; advanced private features do not belong in the SIP-enabled baseline. Its suitability and current permissions must be verified on the selected version, not inferred from its lighter packaging. [imsg source](https://github.com/openclaw/imsg)

Both candidates must pass the same identity, text, attachment, reconnect, uncertain-send and permission tests. Measure idle/active memory, startup and maintenance burden as well as capability. Preserve email-handle pairing; do not copy a phone-only identity model. Managed adapters must authenticate their actual forwarding path and fail closed on false/null/missing/error verifier outcomes. No generic public webhook is trusted merely because it contains a sender number.

Add report recovery tests: work completed but reply failed, crash after provider acceptance, partial chunk/attachment delivery, missing reply anchor, and revocation before queued send. A report retry must not replay agent execution. Keep stable IDs and exact chat binding; transport API acceptance is not a delivery receipt.
