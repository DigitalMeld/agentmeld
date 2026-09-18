# P0 first-run onboarding journey

Date: 2026-09-18. Status: **proposed, not implemented**. For: M1/M2 client and service work.
Prior gap: the [agent handoff](../audit/2026-09-18-agent-handoff.md) Task 1 — no first-run journey existed.
Companion: [p0-onboarding-prototype.html](p0-onboarding-prototype.html), a clickable prototype of this flow (prototype only, not production code).

## 1. What P0 onboarding is

The first-run journey takes a new owner from installed app to first useful agent task, establishing the three things every later interaction depends on: a running service on an identified host, a connected provider subscription, and an understood approval boundary. It is the P1 journey's front door: the owner in [product-spec §7](../specs/product-spec.md) "starts the instance, completes owner setup, selects a provider, creates an agent" — this document designs "completes owner setup."

Scope follows the settled alpha decisions: macOS app first, local browser as the fallback entry point, iOS app as a paired client; Codex-only via the owner's ChatGPT subscription; no Feed, no WhatsApp, no second provider, no collaboration. iMessage is an alpha stretch goal with its own P7 journey and does not appear in onboarding.

### Explicitly NOT in P0 onboarding

- iMessage or any messaging-channel setup (P7, stretch).
- Feed, Ideas, Goals navigation or setup (M4/later).
- Claude Code / Ollama provider choice (post-alpha).
- Invites, members, guests, shared agents (M3).
- Scheduling/Upcoming setup (M2 capability, not a first-run step).
- Connector/MCP catalog setup (the tested reference seam is an alpha platform requirement, not a first-run task).
- Memory or chat-history import (promised later, undesigned).
- Payments, wallet, usage purchase flows.
- A bulk permissions screen. Approvals are introduced progressively (§5), never as a toggle dump.

## 2. Design principles

1. **Progressive disclosure, not a setup wizard gauntlet.** Each step earns the next. Anything deferrable is skippable with a clear path back (Settings → the same surface, same copy).
2. **Honest states before happy paths.** Every step defines its waiting, failed, and offline states first ([ui-ux-contract](ui-ux-contract.md) degraded-state acceptance). A capability that is not connected is shown as not connected, never greyed-out-mysterious or fake-enabled.
3. **The subscription stays the owner's.** Sign-in happens in the owner's browser via the provider's managed device flow; AgentMeld never sees the password. No API-key fallback, no copied tokens — per the [Codex auth store](../m0/codex-auth-store.md) qualification.
4. **Provider readiness is checked without starting billable work.** Connection verification is a capability probe, not a task. Nothing billable runs until the owner sends a message.
5. **Approvals are taught at the moment of use.** One plain-language screen states the boundary; the real UI is met inline in chat when it first fires (§5).
6. **Resumable by construction.** Setup state is durable server-side. Closing the app mid-onboarding returns to the exact step; completed steps are never repeated; nothing half-configured is presented as done.
7. **No promises about unqualified behavior.** Onboarding copy must not claim away-from-home control, iMessage, or local models before those are qualified. Where a step depends on an open decision (remote transport, iOS push), the UI says what is available now and what comes next.

## 3. The journey, step by step

Entry points: the macOS app (primary) and the local browser client (fallback; same flow, served by the same Mac control service). Steps 1–4 are required; Step 5 is skippable; Step 6 is the landing state, not a step.

### Step 0 — Install and first launch

The installer places the Mac control service and registers it as a launchd service; the app opens to onboarding, not to an empty chat. First-run checks run in order and each reports its own state:

1. Control service reachable (starts it if needed; reports a port conflict or permission problem specifically).
2. Isolated worker runtime available (the Mac's VM/container backend; if missing, this is a blocker with a concrete fix, not a spinner).
3. Local storage initialized (state directory created owner-only; existing state from a previous install is detected and offered as "resume previous setup" rather than overwritten).

Failure here is a setup-health screen, not a crash: each check names what failed, why it matters, and the fix. This surface persists after onboarding as Settings → Setup health.

### Step 1 — Connect the provider (the riskiest moment)

This is the handoff's flagged risk: the owner must complete a ChatGPT sign-in outside the app and return to a UI that knows exactly what happened. The flow:

1. **What-happens screen (one screen, no scrolling).** Plain copy: "AgentMeld runs on your ChatGPT subscription. You'll sign in to ChatGPT in your browser — we never see your password. Your subscription stays yours; only this Mac's agent service can use it, and only when you ask it to work." One primary action: **Connect ChatGPT subscription.** Secondary: "Do this later" → enters degraded mode (§7).
2. **Device-flow waiting screen.** Shows the user code (large, copyable), the provider URL, and a live expiry countdown. States:
   - *Waiting for sign-in* — polling the restricted gateway; cancel returns to step 1 without residue.
   - *Sign-in seen, verifying* — code redeemed; the service verifies the subscription is usable (sanitized account readback, capability probe). This is where "no billable work" is enforced.
   - *Connected* — shows "Connected · subscription active · verified just now". Never shows raw account identifiers beyond what the owner needs to recognize the account.
3. **Failure states (each with its own copy and recovery):**
   - *You denied the sign-in* → "No problem — nothing was connected." [Try again]
   - *Code expired* → new code issued inline, no restart of the flow.
   - *No usable subscription found* → "This ChatGPT account doesn't have a subscription Codex can use." Explains the requirement; offers to sign in with a different account. This is the most likely real-world failure and gets the clearest copy.
   - *Network error reaching the provider* → retry with backoff; distinguishes "your Mac is offline" from "the provider didn't answer."
   - *Unexpected error* → retry plus a diagnostics reference; raw provider errors are never shown (per POC runtime behavior).
4. **Token lifecycle, disclosed once.** "AgentMeld refreshes this connection quietly. If it ever can't, you'll see a 'needs attention' banner here — work waits, it never silently switches providers." Refresh failure later surfaces as a non-blocking banner with one-tap reconnect, and queued work holds rather than failing.

### Step 2 — How approvals work (one screen + one labeled example)

No toggles, no scopes list. Three sentences:

1. "Your agent works inside its own isolated computer — it can't see your Mac's files or accounts."
2. "Anything that reaches outside — sending a message, changing a file you didn't attach, using a connection — asks you first, right in the chat, naming exactly what and where."
3. "You approve each action as it comes. You can allow once, set a standing rule for a specific action, or deny. Every decision is recorded and you can revoke a rule anytime in Settings."

Below the copy, a **clearly labeled sample approval card** ("Example — nothing will run") showing the exact card anatomy: acting agent/host, exact action, destination, scope, Allow once / Deny. Per the UI/UX contract, synthetic fixtures are only for unavailable states and must be labeled; this card is labeled and never resembles a live request (no pulsing "pending" treatment, example destination text). The first *real* approval later arrives inline in chat per [product-spec P3](../specs/product-spec.md); onboarding's job is recognition, not consent harvesting.

### Step 3 — Create the first agent

Minimal: a name field prefilled with "Assistant", one line explaining "This is the agent you'll talk to. You can rename it, edit how it describes itself, and add approved memories later in Settings." [Create agent] → the agent exists with the default identity; persona/profile editing is discoverable, not required. No agent switcher, no team concepts — single owner at alpha.

### Step 4 — First useful task (guided P1)

The canonical first task is the P1 fixture: "Find the story in my sales data." The onboarding screen presents it as a suggestion card (per prototype refinements, cards prefill — here, one tap sends): the sample CSV is already attached, the prompt is shown, and the owner taps **Run my first task**.

- The run streams honest states (Thinking → Working on your files → Saving results) with Stop available throughout.
- Completion lands on a success screen: the report previewed, "Saved to Library", what happened in one line ("Read 24 rows, computed totals, wrote report.md"), and two next actions: "Ask a follow-up" and "Try your own file".
- **This is where time-to-first-useful-task stops** (§8).

If the task fails, the failure copy from the POC applies ("The task could not finish… Earlier saved files remain available. Start a new chat."), plus a "Try again" that reuses the same inputs — never an auto-retry of a half-finished run.

### Step 5 — Pair iPhone (skippable)

"Take AgentMeld with you." The pairing ceremony, per the Apple-first decision: the Mac shows a short-lived pairing code; the iPhone app (same network) confirms; the owner sees the device identity and exactly what it may do (chat, approvals, artifacts, computer view — not host administration). Test ping optional.

- *Pairing code expired / phone can't reach this Mac*: fresh code inline; the error distinguishes "not on the same network" from "this Mac isn't reachable."
- **Honest boundary:** away-from-home control requires the remote-transport decision (handoff Task 2), which is still open. Onboarding pairs on the local network and says so: "Away-from-home access is set up separately once the secure connection is qualified — your paired phone will pick it up automatically." No promise, no greyed-out "coming soon" toggle that implies a date.
- Skipping lands in the same done state; Devices in Settings reopens this exact flow.

### Step 6 — Done: the landed state

Not a tour, not a checklist of everything. The owner lands in Chat with their agent, the completed first task in history, and a single quiet confirmation: "You're set up — [agent name] is ready." A "What can I do?" entry point (one menu, not a modal tour) lists: attach a file, approve actions inline, open the Computer view, pair a phone, connect iMessage (marked stretch/best-effort when the P7 flow exists). Empty states elsewhere explain their next action per the mobile reference.

## 4. Resumability and state

- Setup progress is stored server-side per host: `not-started → service-ready → provider-{pending,connected,deferred} → agent-created → first-task-{pending,done} → pairing-{pending,done,skipped} → complete`.
- Relaunch resumes at the first incomplete required step. Completed steps show a checkmark and are re-enterable from Settings, never forced again.
- "Do this later" choices (provider, pairing) are first-class states with banners in the relevant surfaces, not dead ends.

## 5. Failure and recovery catalog

| Failure | User-visible state | Recovery |
|---|---|---|
| Service won't start / port conflict | Setup-health screen names the conflict | Fix guidance; retry |
| Worker runtime missing | Blocker screen: what the runtime is, how to install | Install → re-check |
| Provider sign-in denied | "Nothing was connected." | Try again |
| Device code expired | Inline new code | Continue flow |
| No usable subscription on the account | Plain-language explanation + different-account option | Re-sign-in |
| Provider unreachable / Mac offline | Distinguishes local offline vs provider fault | Retry; queued nothing |
| Token refresh fails (later) | Non-blocking "needs attention" banner | One-tap reconnect; work waits |
| Pairing code expired | Fresh code inline | Re-pair |
| Phone can't reach Mac | "Same network?" vs "Mac unreachable" diagnosis | Network fix; retry |
| First task fails | POC failure copy; nothing half-run is presented as done | Retry with same inputs; start new chat |
| App closed mid-onboarding | Resume at exact step on relaunch | Automatic |

## 6. Degraded mode: no provider connected

Choosing "Do this later" (or a failed connection the owner abandons) must not strand the user in a dead app:

- The shell is fully navigable: Settings, Devices, Library (empty state explains what will appear), agent identity editing.
- Chat is present but honest: the composer is replaced by a "Connect a provider to start" state — never an enabled input that fails on send.
- A persistent, dismissible banner: "No provider connected — connect your ChatGPT subscription to run tasks." One tap returns to Step 1.
- Nothing in degraded mode implies capability: no sample tasks that pretend to run, no fake approvals.

## 7. Acceptance criteria

1. Every step implements loading, waiting, success, error, and offline states; copy reviewed against §2.7 (no unqualified promises).
2. Provider connection completes through the managed device flow with zero credential material visible to or storable by the client UI; verification performs no billable work.
3. Approvals are introduced before the first task; no bulk-permission screen exists anywhere in the flow.
4. Setup is resumable after app close, service restart, and host reboot, returning to the exact step with completed steps intact.
5. Time-to-first-useful-task (§8) is measured in the shipped flow, not estimated.
6. The clickable prototype ([p0-onboarding-prototype.html](p0-onboarding-prototype.html)) walks the full journey including one failure branch and the degraded path.

## 8. Success metrics

- **Time-to-first-useful-task:** from first app launch to first artifact in Library. Target: p50 ≤ 15 minutes on a machine meeting the prerequisites. Provider sign-in time is measured separately (owner-dominated) and excluded from the product target — but its drop-off is tracked per step.
- **Setup completion rate:** fraction of first launches reaching Step 6 within 7 days; drop-off measured per step to find the actual friction (expected: Step 1).
- **First-task success rate:** fraction of first tasks completing without an error state.
- **Zero silent misconfigurations:** any instance reporting "set up" must have a verified provider connection or an explicit deferred state — audited, not asserted.

## 9. Dependencies on other handoff tasks

- **Task 2 (remote transport):** Step 5's away-from-home copy and the Devices surface depend on the selected transport. Onboarding ships with local-network pairing; the remote leg is added when the transport is qualified — the flow is built to accept it, not blocked by it.
- **Task 3 (iOS push):** determines what the phone experience promises during pairing (polling vs push vs deferred). Onboarding must not promise notification behavior before this lands.
- **Task 4 (control-core unification):** the approval card anatomy in Step 2 and the inline approval contract must match the unified control plane's approval model exactly. If the unified model changes approval semantics, this doc's §5-equivalent copy changes with it.
- **Task 6 (golden-task evals):** the guided first task should become eval #1 — the same fixture, the same success criteria.

## 10. Open questions for the owner

1. **Browser-open vs copy-paste for sign-in:** is the app opening the system browser to the provider's device page acceptable, or should the owner copy the code and URL manually? (Some owners distrust app-opened sign-in windows.)
2. **First-task choice:** is the sample CSV analysis the right canonical first task, or should the first run be an open prompt with the CSV as a suggestion card?
3. **Pairing placement:** keep iPhone pairing as the final onboarding step, or move it to a post-setup "next steps" surface once the transport decision lands?
4. **Entry order:** Mac app and local browser share this flow — should the local browser remain a supported first-run path for alpha, or is it explicitly a fallback with reduced ceremony?
5. **Setup imports:** should first-run offer to import anything (files, prior chats)? Memory import is undesigned and out of scope — confirm it stays out for alpha.
