# iOS push and background behavior for alpha

Date: 2026-09-18. Status: decided 2026-09-18 — approval wake hint built during M2, acceptance gate runs push-free. Nothing implemented or qualified. This document is the analysis behind issue #72; the owner's decision is recorded in the "Decision recorded" section and in [the push/background decision](../decisions/2026-09-18-ios-background-push.md). TARS owns this analysis and design; Astra (Apple hardware) owns implementation and real-device qualification.

## Requirement

From the [Apple-first alpha decision](../decisions/2026-09-18-apple-first-alpha.md): the iPhone is a client for the same agents, tasks, approvals, and artifacts — not a separate agent runtime. The M2 acceptance journey requires backgrounding the app, reopening it, and recovering state after interruption, with cross-client state agreeing. The non-negotiables:

- **Correctness cannot depend on an always-connected phone or push delivery.** Background notifications are a separately qualified enhancement.
- Sleep, power loss, and network loss appear as *offline*, never as successful control.
- Stale approvals must never auto-submit after reconnection.
- Client commands carry stable request IDs with explicit accepted/pending/unknown states; work persists server-side and reconciles on reconnect.

From the [transport selection](../decisions/2026-09-18-remote-transport-selection.md): the alpha ships on vendor-hosted Tailscale. The Tailscale iOS app's `NEPacketTunnelProvider` tunnel is OS-managed and persists while the AgentMeld app is suspended — foreground reconnect is one TLS handshake over an already-up interface, not tunnel re-establishment.

## Platform reality (verified)

**Suspension kills app sockets.** iOS moves an app from foreground to background to suspended within seconds; a suspended app executes no code and its sockets tear (Apple TN2277 / DTS guidance: maintaining a TCP connection across suspension is not supported — the question is suspension, not merely backgrounding). A `UIApplication` background task can delay suspension briefly (tens of seconds) to finish in-flight work or close a connection cleanly; it cannot keep a control channel alive. If the system needs memory, a suspended app is terminated with no callback — the next launch is cold.

**No background mode keeps a socket alive.** The relevant modes are `fetch` (system-scheduled background refresh), `remote-notification` (wake briefly on silent push), and the BackgroundTasks framework (`BGAppRefreshTask` / `BGProcessingTask`). All are discretionary, system-scheduled, throttled by energy budget and usage patterns, and grant ~30 seconds of CPU; exceeding it gets the app terminated. They are opportunistic maintenance windows, not a connection strategy. Declaring them also surfaces the app in the Background App Refresh settings list and invites App Store review questions, for zero control-plane benefit.

**APNs is best-effort, not guaranteed.** Apple's documentation states delivery of notifications is "best effort", not guaranteed, and is not intended to deliver data — only to notify that new data is available. If the device is off, only the *last* notification per app is retained. An HTTP 200 from APNs means Apple accepted the request, not that the device was woken.

**Alert pushes and silent pushes are different reliability classes.** Alert pushes (`apns-push-type: alert`, user-visible) are the reliable class in practice. Silent/background pushes (`content-available: 1`, no alert/badge/sound keys, `apns-push-type: background`, priority 5) are throttled to roughly 2–3 per hour per Apple's guidance — real-world reports put it at 1–2 per hour per device across all apps, degrading further for rarely-opened apps — and are not delivered at all when the app was force-quit, when Background App Refresh is off, or under Low Power Mode pressure. Real-world silent-push delivery rates around 70% or lower are commonly reported. Payload limit is 4KB either way.

**The VPN tunnel outlives the app.** A `NEPacketTunnelProvider` runs as a system network extension in its own OS-managed process, independent of the containing app's lifecycle. The Tailscale iOS app's tunnel therefore stays up while the AgentMeld app is suspended or even terminated. Two caveats, both user-visible and therefore honest-able: iOS allows exactly one VPN at a time — enabling a corporate or travel VPN disconnects Tailscale with no workaround — and the tunnel itself can drop on hostile networks, which must read as offline, not as control.

**Permission friction is optional.** Provisional notification authorization (iOS 12+) delivers notifications quietly to Notification Center without a permission prompt; the user can promote or disable them later. This matters when wake hints ship: no blocking dialog during onboarding.

## Recommendation 1 — APNs scope: wake hint built in M2, kept out of the acceptance gate

**Position (decided 2026-09-18): the alpha acceptance gate runs with no APNs — every qualification test passes foreground-only. But the approval wake hint is built during M2, not deferred to a later enhancement phase.**

The trade, stated plainly:

- *For building it in M2:* the iPhone's job in the alpha is approvals — create work, observe progress, approve/deny. A controller you have to remember to open and check is a broken-feeling controller, and an agent run sitting in `waiting_approval` while the phone sits silent in a pocket is the exact loop the alpha is supposed to prove. The pocket-buzz for approvals is the highest-value notification in the entire product.
- *Against:* APNs costs real provisioning and code surface — a push entitlement, device-token registration and rotation, a push-sending component on the Mac service, separate sandbox vs production APNs environments, and token lifecycle management — all in service of a signal the architecture is *forbidden* from depending on.

Why build it anyway: the cost is bounded and one-time, and the Rust service's notification-intent pipeline is being built during M2 regardless (see below). Deferring the sender to a separate "enhancement phase" pays the context-switching tax twice for the product's single most valuable notification. And keeping it out of the gate preserves the non-negotiable: if APNs breaks, throttles, or is unavailable, everything still works — you just open the app.

The sequencing that keeps both: the Rust service persists notification *intent* atomically with results (see [architecture §8](../specs/architecture.md#8-run-lifecycle-and-recovery), "Result and notification lifecycle") — completion is tracked independently of delivery, and a failed or suppressed notification cannot reopen or rerun a task. Build that intent pipeline push-ready during M2 (outbox, immutable reply target, stable delivery IDs, grant recheck before send), and hang the APNs sender off it in the same milestone. The alpha acceptance criteria mention no push; keep it that way — the gate proves the foreground contract load-bearing, the hint is a convenience layered on top.

**Caveat — distribution path may force the timing.** If qualification builds are sideloaded under free personal-team signing, the push entitlement likely isn't available at all (it requires a paid Apple Developer Program membership). Astra to confirm against the distribution decision; in that case the hint genuinely waits for TestFlight and the alpha ships foreground-only. This is not a design failure — it's exactly what the push-free gate is for.

**When wake hints ship, the shape is fixed by this doc:**

- Alert pushes only. Never silent/background pushes as the wake mechanism (throttled, force-quit-hostile, idle-app-hostile).
- Content-free: "Approval needed — open AgentMeld." No task content, no payload data; Apple sees routing metadata only. The app fetches authoritative state on open.
- Deep link to the specific approval; the approval screen revalidates before enabling actions (see Recommendation 4).
- `apns-expiration` bounded by the approval's server-side expiry, so a late push never surfaces a dead approval; `apns-collapse-id` set to the approval ID so re-sends replace rather than stack.
- Provisional authorization at onboarding — no permission dialog; the user promotes or disables from Notification Center.

## Recommendation 2 — Background modes: declare none

**The app declares no `UIBackgroundModes` and uses no BackgroundTasks scheduling.** It is strictly foreground + honest offline states.

Rationale: no declared mode changes the suspension facts above — the socket still dies, and the modes only buy throttled 30-second CPU windows the design never uses. Declaring `fetch` or `remote-notification` "just in case" adds App Store review surface, a Background App Refresh settings entry that implies background work the app doesn't do, and a second code path (background fetch handler) that must be qualified for zero benefit. Alert-push wake hints need no background mode at all: the user taps, the app foregrounds, the normal reconnect contract runs. If a future design ever wants silent-push-triggered background sync, *that* is the moment to declare `remote-notification` — not now.

Corollaries Astra must respect: no silent-audio or location-mode keepalive hacks (App Store rejection and battery cost), no PushKit/VoIP push entitlement (it is for VoIP; misuse is a rejection risk), no Notification Service Extension in alpha (rich-notification machinery with no generic-hint use case), and no embedding Tailscale in-process via tsnet/libtailscale instead of the system app — an in-process node dies with the app exactly like the socket does, forfeiting the persistent-tunnel advantage that motivated the transport choice.

## Recommendation 3 — Foreground reconnect contract

This is the load-bearing design: everything the user experiences on reopening the app. It has three parts — what the app does, what the service guarantees, and the worst case the UI is allowed to show.

### App side (SwiftUI client)

**One connection state machine, single source of truth:** `live` → `reconnecting` → `offline`. The UI never renders stale data as live.

- On `scenePhase == .active` (and on network-path change while active), run the reconnect sequence. Tear down any dead stream first; never stack two streams.
- `reconnecting` is entered immediately on activation. The UI shows it with the last-sync timestamp ("Last synced 4m ago") — minimalist, honest, no spinners that imply progress.
- `offline` is entered after consecutive failures cross a small threshold or on explicit unreachable (no network, Tailscale disconnected, host refused). It names the cause when known and offers retry. Offline is a state, not an error.

**The activation sequence, in order:**

1. **Reachability, cheap and specific.** Confirm the tailnet path to the host (Tailscale status + a lightweight service endpoint such as `GET /health`). If the tunnel is down, show `offline` naming Tailscale — not a generic "connection failed." The single-VPN-slot conflict and hostile-network drops surface here, honestly.
2. **Re-authenticate.** Present the device credential. On 401/403 (revoked or expired device), route to the re-pairing flow; the cached UI stays visible but read-only with a banner — no actions enabled, nothing submittable.
3. **Re-subscribe with cursor.** Open the authenticated event stream passing the last persisted host-issued cursor. Dedupe by event ID — delivery is at-least-once by design.
4. **Revalidate everything actionable.** Refetch the approvals list and every pending item's server state before any Approve/Deny/Stop button enables. A button that cannot confirm freshness stays disabled with an "unknown — checking" label, never a cached enabled one.
5. **Re-acquire the controller lease explicitly.** If the app held the agent-browser control lease, it re-acquires it; lease generation fencing on the service side rejects the stale holder. Never assume the lease survived suspension.

Persist the stream cursor and last-sync timestamp to durable app storage on every received event, so kill-and-relaunch resumes from the true position, not from launch time.

### Service side (Rust)

- **Host-issued cursors and bounded replay.** Every event carries a monotonic host-issued sequence; the stream endpoint accepts a cursor and replays missed events from a bounded buffer. Reconnects must not duplicate messages or tool calls — dedupe is by event ID on the client, idempotency by request ID on admission.
- **Idempotent command admission.** Every command carries a client-generated stable request ID; retrying admission with the same ID returns the original receipt (`accepted` / `pending` / `unknown`) instead of creating a duplicate run. An `unknown` receipt (timed out after submission) requires human reconciliation, never blind retry.
- **Revocation is immediate.** A revoked device gets 401 on next contact; revocation also invalidates its pending approvals, stream subscriptions, and future dispatch (per [architecture §6](../specs/architecture.md#6-identity-authorization-and-secret-ownership)).
- **Approval state machine, server-side.** `pending → approved | denied | expired | superseded`. Expiry is evaluated on server time, never device time.

### Worst-case staleness

The UI may display data as old as the time since the last successful sync — unbounded if the phone was offline for days. The contract bounds the *harm*, not the age:

- Every screen carries its as-of time ("Updated 2h ago"). Staleness is visible, never silent.
- Nothing actionable enables without fresh revalidation against the service.
- Approval cards show remaining time computed from server-issued expiry; an approval whose state cannot be confirmed renders as unknown with actions disabled.
- The user can always distinguish "I have the latest state" (`live`), "I'm catching up" (`reconnecting` + last-sync time), and "I can't reach the host" (`offline` + cause).

## Recommendation 4 — Approval UX across suspension

**What the user sees.** While the phone is suspended, nothing happens in the app — there is no socket and (in alpha) no push. The run waits server-side; the approval's expiry ticks on server time. On reopen, the approvals view enters `reconnecting`, then each card resolves to exactly one terminal-or-pending truth fetched from the service:

- **Still pending** — Approve/Deny enabled, with the live countdown from server expiry.
- **Decided elsewhere** — approved or denied, by which device/client, and when. Actions gone.
- **Expired** — rendered as expired; actions gone.
- **Superseded** — the run moved on, was cancelled, or the grant narrowed; actions gone.

**The mechanism guaranteeing no stale auto-submit** is defense in depth, and every layer is required:

1. The client never submits from cached state. Approve enables only after a foreground sync confirms that approval ID is `pending` on the service.
2. The submission carries `(approval_id, decision, client_request_id)`. The client request ID makes double-taps and retried submissions idempotent.
3. The service consumes the approval in a single transaction that checks: state is still `pending`, not expired, credential-grant version current, policy version current, run still in `waiting_approval`, controller/lease generation current. Anything else returns the actual terminal state, which the UI renders — never a silent success.
4. A terminal, expired, or superseded approval cannot be reused, by construction of the state machine.
5. Revocation invalidates pending approvals outright.
6. No approval can be submitted while the app is suspended — there is no execution path in that state. The only writer is the foreground app after revalidation.

Note the asymmetry this preserves: *denying* a stale approval is safe to surface; *approving* one is what the transaction guards. The UI reflects that — a card that cannot confirm `pending` offers no Approve button.

## Recommendation 5 — Device-qualification test list (Astra, real hardware)

Every test runs against the real Mac mini host over the real tailnet (cellular and Wi-Fi), not the simulator. A failure is a design question returned to TARS, not a silent workaround.

**Reconnect correctness**
1. Suspend/resume storm: background and foreground the app 20 times in quick succession. Assert exactly one live stream, cursor continuity, no duplicate events, no duplicate runs.
2. Airplane mode mid-run: enable for 5 minutes during an active run, then disable. Assert the UI showed `offline` with the last-sync time, then `reconnecting`, then caught up with no duplicates and no missing events.
3. Cellular-to-Wi-Fi handoff mid-session. Assert the stream resumes and cursor replay covers the gap.
4. Kill and relaunch: force-quit mid-run, relaunch. Assert full state rebuild from the service, cursor restored from durable storage, no phantom pending actions.
5. Service restart mid-stream: restart the Rust service during an active session. Assert at-least-once dedupe by event ID and idempotent command admission (no double execution).

**Approval safety**
6. Approval requested while suspended: start a run needing approval, suspend the app for 10 minutes, foreground. Assert the approval card appears only after revalidation, with a correct server-based expiry countdown.
7. Two-client race: request approval, approve it in the Mac browser, then tap Approve on the stale phone card. Assert the service rejects (or returns the terminal state) and the phone renders "already decided" — never a second execution.
8. Expired while suspended: let an approval expire with the app suspended, foreground. Assert the card shows expired, Approve stays disabled, no submission is possible.
9. Revocation: revoke the phone's device credential from the Mac, then foreground the phone. Assert 401 routes to re-pairing, cached UI is read-only, and no cached action is submittable.

**Tunnel vs app vs host**
10. Tunnel down, app foregrounded: disconnect Tailscale with the app open. Assert the UI shows `offline` naming Tailscale specifically — distinct from `reconnecting`.
11. Single-VPN-slot conflict: enable a second VPN. Assert the honest "Tailscale disconnected" state, no silent failure, recovery when Tailscale is re-enabled.
12. Host asleep: sleep the Mac mini mid-session. Assert the phone shows the host as offline (not successful control), and shows fresh state on wake + reconnect.
13. Controller lease fencing: hold the browser-control lease on the phone, suspend, take over the lease from the Mac browser, foreground the phone. Assert the phone's stale lease cannot inject input (generation rejected) and the phone re-acquires or shows the new holder.

**Environment and edge**
14. Low Power Mode on, Background App Refresh off: assert the foreground contract is unaffected (it must be — no background modes are declared).
15. Clock skew: set the device clock ±30 minutes. Assert approval expiry and countdowns still follow server time.
16. Sideload expiry (if free signing is used for qualification builds): re-sign after 7 days and assert the Keychain-persisted device credential survives without re-pairing.
17. Cross-client agreement: after every test above, assert the Mac browser and the phone show the same task state for the same run.

**Performance to record** (not pass/fail, but required evidence before alpha exit): foreground-reconnect latency over direct and DERP-relayed paths, time from tap to `live`, and time from approval tap to service receipt — measured on the owner's actual networks.

## Explicit non-recommendations

- **Silent/background pushes as a wake or sync mechanism.** Throttled to ~2–3/hour, not delivered on force-quit or with Background App Refresh off, degrading for idle apps, and accepted-by-APNs is not delivered-to-app. The worst of both worlds: provisioning cost plus unreliability.
- **Background fetch / BGAppRefreshTask / BGProcessingTask for state polling.** Discretionary, throttled, ~30-second windows; adds nothing the foreground contract doesn't already do.
- **PushKit (VoIP) pushes for anything non-VoIP.** Entitlement misuse and App Store rejection risk.
- **Notification Service Extension.** Rich-notification machinery with no use case for content-free wake hints.
- **In-process Tailscale (tsnet/libtailscale) instead of the system app.** Dies with the app process; forfeits the persistent-tunnel advantage the transport decision was built on.
- **Keepalive hacks** (silent audio, location-mode abuse). Rejection risk and battery cost for a socket that still dies.
- **Treating APNs acceptance as delivery** anywhere in logic, logging, or UX copy.

## Division of labor

TARS owns this design and its revisions. Astra (Apple hardware) owns the SwiftUI implementation and the full qualification list above on real devices over the real tailnet. Anything in the test list that cannot be made to pass is a design question returned for a doc revision — not a local workaround in the client. In particular: if measured foreground-reconnect latency over DERP is poor on the owner's networks, or if the single-VPN-slot conflict proves disruptive in practice, those findings come back here before any transport or UX compensations are designed.

## Decision recorded

**2026-09-18, owner: build the approval wake hint during M2; keep it out of the alpha acceptance gate.** Every qualification test runs foreground-only with zero push — the foreground contract must prove itself load-bearing, and correctness never depends on push or an always-connected phone. The wake hint (content-free alert, deep link, expiry-bounded, collapse-id'd, provisional authorization) ships in M2 off the notification-intent pipeline. See [the push/background decision](../decisions/2026-09-18-ios-background-push.md).

Caveat: if qualification builds are free-signed sideloads, the push entitlement likely isn't available (paid developer account required) — Astra to confirm against the distribution decision. In that case the hint waits for TestFlight and the alpha ships foreground-only.

Still open:
- Confirm: no background modes declared (recommended — undisputed in review).
- When wake hints ship: provisional authorization (recommended) vs an explicit permission prompt at onboarding.
- iOS distribution path interplay (TestFlight vs sideload) — determines the APNs environment and the sideload caveat above.

## What was verified and what was not

Verified against current sources on 2026-09-18: iOS suspends apps within seconds of backgrounding and terminates suspended apps under memory pressure with no callback; app-held sockets die on suspension (Apple TN2277 / Apple DTS "The Eskimo"); `NEPacketTunnelProvider` runs as an OS-managed extension process independent of the containing app, so the system Tailscale app's tunnel persists across AgentMeld suspension; iOS permits exactly one VPN at a time; no background mode keeps a socket alive — `fetch`, `remote-notification`, and BackgroundTasks grants are discretionary, throttled, and ~30 seconds; APNs delivery is documented best-effort, not guaranteed, with per-app coalescing to the last notification when the device is off; silent pushes are throttled to ~2–3/hour (Apple guidance), require Background App Refresh and a non-force-quit app, and degrade for idle apps; APNs acceptance (HTTP 200) is not delivery; alert vs background push types and their headers (`apns-push-type`, `content-available`, priority 5 for background); 4KB payload limit; provisional notification authorization since iOS 12; free personal-team signing expires after 7 days.

Not verified: measured foreground-reconnect latency over direct and DERP-relayed paths on the owner's actual networks; real-world push delivery rates on the owner's devices; Tailscale iOS "Always On" / VPN On Demand default behavior specifics; App Store review outcome for the final entitlement set (low risk: no background modes, no PushKit, no special entitlements); whether the single-VPN-slot conflict is disruptive in the owner's daily use.
