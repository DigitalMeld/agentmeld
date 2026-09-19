# Remote transport selection for alpha

Date: 2026-09-18. Decided by Brad.

## Decision

Ship the alpha on vendor-hosted **Tailscale Personal** (WireGuard private-route family). The control API, event stream, and viewer run over the mesh exactly as on the LAN; no transport-specific protocol work.

## Why

- Zero setup friction for users: install the Tailscale app, sign in, done — the lowest-friction option of everything compared.
- Zero new infrastructure to qualify the alpha gate: the owner's devices are already enrolled, so the cross-network tests (iPhone on cellular, MacBook Air off-network → Mac mini at home) can start immediately.
- Best available iOS background story: the OS-managed VPN tunnel survives app suspension; reconnect on foreground is one TLS handshake.
- NAT traversal solved (DERP fallback), not hand-rolled.
- Reversible: the AgentMeld layer is identical under a self-hosted control plane, so the choice can be revisited without rework.
- Grows toward the MVP: Tailscale's team/org support (ACLs, user and device management) means the transport doesn't need replacing when we go beyond owner-only — the same mesh extends to a team.

## Accepted trade-offs

- Requires a Tailscale account (a vendor identity); coordination metadata is trusted to Tailscale. Content stays end-to-end encrypted WireGuard.
- Strict "no required vendor account" is deferred: the documented self-host path is Headscale on owner-operated infrastructure, to be written up as part of this work.

## Not selected

- Nostr event transport: more protocol work without removing operational burden; keep as a future adapter seam.
- Cloudflare Tunnel: vendor terminates TLS at its edge — wrong trust shape for a control plane.
- Plain HTTPS ingress as the required path: fails under CGNAT.
- WebRTC data channels: real-time machinery for a problem plain TLS already solves; dies in iOS background.
- Reverse SSH: acceptable emergency fallback during development, too hand-rolled to qualify.

## What this does not authorize

No installation, signing, account enrollment, network exposure, or deployment. Those are separate actions requiring their own authorization. Qualification (paired real devices across networks, revocation, forged requests, reconnect storms) must produce latency measurements before alpha exit.

## Analysis

See the [remote transport comparison](../research/remote-transport-comparison.md) and issue #70.
