# iOS push and background behavior for alpha

Date: 2026-09-18. Decided by Brad.

## Decision

Build the approval wake hint during M2; keep it out of the alpha acceptance gate.

## What that means

- The alpha acceptance gate — all 17 device-qualification tests — runs with no APNs at all. The foreground reconnect contract must prove itself load-bearing: correctness never depends on push or an always-connected phone.
- The approval wake hint ships in M2 anyway: a content-free alert push ("Approval needed — open AgentMeld"), deep-linked to the approval, expiry-bounded, collapse-id'd, under provisional authorization (no permission dialog). It hangs off the notification-intent pipeline built in the Rust service during M2.
- No background modes are declared: strictly foreground + honest offline states.

## Why

- The iPhone's job in the alpha is approvals. A controller you have to remember to check is a broken-feeling controller; the pocket-buzz for approvals is the highest-value notification in the product.
- The cost is bounded and one-time, and the intent pipeline is being built regardless — a later "enhancement phase" would pay the context-switching tax twice.
- Keeping push out of the gate preserves the non-negotiable: if APNs breaks, throttles, or is unavailable, everything still works.

## Caveat

If qualification builds are sideloaded under free personal-team signing, the push entitlement likely isn't available (it requires a paid Apple Developer Program membership) — Astra to confirm against the distribution decision. In that case the hint waits for TestFlight and the alpha ships foreground-only. The push-free gate is exactly what makes this a scheduling question, not a design failure.

## Not selected

- Silent/background pushes as a wake or sync mechanism; background fetch / BGTasks polling; PushKit for non-VoIP; Notification Service Extension; in-process Tailscale; keepalive hacks; treating APNs acceptance as delivery.

## Analysis

See [iOS push and background behavior](../research/ios-background-push.md) and issue #72.

## What this does not authorize

No APNs provisioning, App Store / TestFlight setup, or device enrollment — those are separate actions requiring their own authorization.
