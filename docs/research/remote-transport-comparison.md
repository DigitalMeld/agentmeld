# Remote transport comparison for alpha cross-network control

Date: 2026-09-18. Status: decided 2026-09-18 — vendor-hosted Tailscale for alpha, Headscale as the documented self-host path. Nothing installed or qualified yet. This document is the analysis behind issue #70; the owner's decision is recorded in the "Decision recorded" section and in [the transport selection decision](../decisions/2026-09-18-remote-transport-selection.md).

## Requirement

From the [Apple-first alpha decision](../decisions/2026-09-18-apple-first-alpha.md): an iPhone over cellular and a MacBook Air on an external network must control the Mac mini at home. Same-network-only use is insufficient. The transport must carry the control API (request/response with stable request IDs) plus a live event stream (task progress, approvals, live agent-browser control). Mandatory regardless of transport: device pairing, TLS/trust, revocation, replay-safe reconnect, honest offline reporting, and reconcile on reconnect. A reachable relay or private routing service must itself be operated somewhere; a documented self-host path is required without mandating a Digital Meld account.

Out of scope for this comparison: general remote web access, multiuser hosting, messaging transports (separate ChannelAdapter), and hosted-service economics.

## Rubric

Every candidate is scored on the same axes:

1. **Security model** — pairing story, TLS/trust, revocation, replay-safe reconnect support.
2. **Self-hostability** — documented self-host path, no required vendor account.
3. **Latency / reliability** for interactive control (commands, approvals, live viewer).
4. **NAT traversal** — works from cellular and hotel/café networks without home port forwarding.
5. **iOS background behavior** — what survives app suspension; what the foreground-reconnect cost is.
6. **Operational burden and cost** — what the owner installs, operates, updates, and pays.
7. **Local-first fit** — infrastructure and data are the owner's and self-hosted; cloud models run through the owner's own subscriptions.

## Candidate 1: Private route (WireGuard mesh) — the API stays identical

The Mac mini, the iPhone, and the MacBook Air join one private WireGuard mesh. AgentMeld's authenticated API, SSE event stream, and viewer/file channels run over it exactly as they do on the LAN. This is the decisive architectural property of this family: **no second protocol, no shadow semantics**. Pairing, request IDs, revocation versions, expiry, host-side replay protection, and reconcile-on-reconnect are implemented once in the Rust service and are transport-agnostic. The transport only provides IP reachability.

NAT traversal is handled by the mesh: direct WireGuard UDP hole-punching where possible, with DERP-style relays as fallback when both sides sit behind symmetric NAT (typical for cellular). Two control-plane options:

### 1a. Vendor-hosted control plane (Tailscale)

Tailscale runs the coordination server; the owner runs official clients on each device. Traffic is end-to-end encrypted WireGuard; Tailscale's servers never see packet contents, only connection metadata (which devices, when, relay usage). The free Personal plan covers 3 users and 100 devices with full ACLs — far more than an owner-only alpha needs. Paid plans (Personal Plus $5/mo, Starter $6/user/mo) are not required for this use. [Tailscale overview](https://tailscale.com/docs/concepts/what-is-tailscale)

Strengths: near-zero operational burden (install app, sign in, done); mature NAT traversal with a global DERP relay fleet; official iOS app using `NEPacketTunnelProvider`, so the tunnel is OS-managed and persists while the AgentMeld app is suspended — foreground reconnect is just a TCP/TLS handshake over an already-up interface; MagicDNS gives stable names; ACLs can restrict the phone to only the Mac mini's AgentMeld port.

Weaknesses: requires a Tailscale account (a vendor identity — Google, Microsoft, Apple, GitHub, etc.), which fails the strict "no required vendor account" criterion. The control plane is proprietary and vendor-operated: device metadata and coordination are trusted to Tailscale. If Tailscale has an outage or changes terms, the owner's remote access degrades. This is a trust and sovereignty trade, not a security-of-content trade (content stays E2E encrypted).

### 1b. Self-hosted control plane (Headscale-style)

Headscale is an open-source (BSD-3) coordination server implementing the Tailscale control protocol; official Tailscale clients — including the iOS app — work against it. The iOS app has supported an alternate coordination server since v1.38.1, configured under iOS Settings → Tailscale → Alternate Coordination Server URL. The owner operates Headscale on infrastructure they control. [Headscale Apple client docs](https://github.com/nblock/headscale/blob/HEAD/docs/usage/connect/apple.md)

Strengths: no vendor account; control-plane metadata stays on owner-operated infrastructure; same WireGuard data plane, same official clients, same iOS background behavior as 1a; matches the local-first definition most literally ("the infrastructure and data are yours and self-hosted"). A small VPS (~$5/mo class) is sufficient; Headscale itself is a single static binary with a SQLite/Postgres store.

Weaknesses and honest costs:
- **The coordination/DERP endpoint must be publicly reachable.** Headscale's embedded DERP only helps peers that can both reach the Headscale server. A Headscale instance on the home Mac mini behind CGNAT does not satisfy the alpha gate for a cellular iPhone. In practice this means Headscale runs on an owner-operated VPS (or the home Headscale is itself exposed publicly, which reintroduces the inbound problem). "Self-hosted" still means operating public infrastructure somewhere — consistent with the decision doc, but it must be said plainly.
- **Community-maintained, not official.** Headscale tracks Tailscale's proprietary coordination protocol; if Tailscale breaks compatibility, Headscale must catch up. One maintainer is employed by Tailscale, which mitigates but does not eliminate this risk.
- **Rougher mobile onboarding.** The iOS alternate-server flow (Settings app, keychain reset if previously logged in, auth-key or OIDC login) is clunkier than Tailscale's sign-in. For an owner-only alpha this is acceptable; it would need polish before any broader release.
- The owner operates and updates one more service (Headscale, TLS certificates for its URL via Let's Encrypt, the VPS itself).

### 1a vs 1b

Same data plane, same clients, same iOS behavior, same AgentMeld API surface. The difference is purely who operates the control plane and what that costs: Tailscale trades a vendor account and metadata trust for zero operations; Headscale trades VPS operation and rougher onboarding for sovereignty and no vendor account. Both satisfy the alpha gate. The choice is the owner's (see "Decision needed").

## Candidate 2: Nostr event transport

Commands and status travel as signed Nostr events (NIP-01) through a relay the owner operates; clients and the Mac mini connect outward to the relay, which is NAT-friendly. The existing [Nostr/Buzz assessment](nostr-buzz-connectivity.md) already established the protocol facts; this comparison scores it against the alpha job:

- **Security model:** NIP-01 gives signed events and relay ACKs, NIP-42 authenticates the relay connection, NIP-17/59 gift wraps provide payload encryption — but NIP-44 (the underlying encryption) offers no forward secrecy or post-compromise security on its own. Key compromise, rotation, recovery, and retained relay ciphertext need an explicit threat model that does not exist yet. Per-device revocable keys are constructible but must be designed.
- **Self-hostability:** good in principle — strfry and other relays are open source and self-hostable. But a *private* relay is mandatory: publishing control traffic to public relays is unacceptable (metadata leakage, unknown retention, spam policies). So the owner still operates public infrastructure — the same operational fact as Headscale, with none of the client ecosystem.
- **Latency/reliability:** one WebSocket hop to the relay plus fan-out; adequate for commands. But Nostr provides no ordering, no durability, and no exactly-once semantics. The entire reconcile-on-reconnect machinery (stable request IDs, expiry, host-issued sequence/cursor replay, stale-approval rejection) must be built in AgentMeld on top of an unordered at-most-once log — the same machinery the private-route family gets nearly for free over its normal API.
- **Event size:** typical relays cap events around 64KB (strfry default); some operators set far lower. Viewer frames and artifacts do not fit. A separately authenticated encrypted stream/file path is required anyway — "a Nostr proof that only sends chat messages does not satisfy the remote-control alpha requirement," as the earlier assessment notes. So Nostr does not even remove the need for a second transport.
- **iOS background:** the app's WebSocket dies on suspension like any app socket; reconnect on foreground plus APNs wake hints. No system-level persistence advantage.
- **Operational burden:** operate a relay, manage relay storage/retention/backups, manage Nostr key lifecycle, *plus* operate the separate stream/file path. Strictly more moving parts than Candidate 1 for the same alpha gate.
- **Local-first fit:** fine if the relay is owner-operated; poor if it leans on public relays.

Nostr's genuine virtues — open signed event format, subscription fan-out, possible future Buzz interop — do not serve the alpha gate. It adds a protocol layer without removing any operational burden. Verdict: **not recommended as the alpha transport**. Keep it as a later adapter seam behind the control API (the API should not assume IP reachability, so a future Nostr adapter remains possible), and revisit only if a concrete interop or federation requirement appears.

## Candidate 3: Other serious options

**Reverse SSH tunnel (Mac mini → owner VPS; clients reach the mini through the VPS).** In: fully self-hostable (a VPS plus `sshd`), no vendor account, well-understood security (SSH keys), direct-TCP latency. Out as the primary: it is a DIY relay with real fragility — tunnels die on network flaps (autossh mitigates, not eliminates), TCP-over-TCP meltdown on lossy paths, manual key management and rotation, no built-in NAT traversal beyond the VPS meeting point, and multiplexing many clients through one tunnel is hand-rolled. It also splits the world into "SSH people" tooling rather than the product's own API surface. Verdict: **acceptable emergency fallback, not the pick**. If the owner already operates a VPS, it is the cheapest path to *a* working remote connection during development, but it should not be the qualified alpha path.

**Cloudflare-Tunnel-style ingress (`cloudflared` on the Mac mini, outbound to Cloudflare edge).** In: free and unmetered, trivially easy, QUIC by default, WebSockets work, Zero Trust Access free up to 50 users. Out: requires a Cloudflare account and a domain (fails "no required vendor account"); Cloudflare terminates client-facing TLS at its edge, so control traffic — including approvals — passes through vendor infrastructure that can technically inspect it; the edge is proprietary and not self-hostable (`cloudflared` itself is open source, the edge is not). Verdict: **not recommended**. It is the most convenient option and the worst local-first fit.

**WebRTC data channel (self-hosted signaling + STUN/TURN, e.g. coturn).** In: excellent NAT traversal, self-hostable pieces. Out: it buys a signaling server, ICE negotiation, and DTLS-SRTP session management to solve a problem that plain TLS-over-a-private-route already solves; iOS backgrounding kills peer connections when the app suspends (no system-persisted path, unlike a VPN tunnel); the live viewer does not need sub-second real-time media — screenshot-based observation over HTTPS/SSE is the qualified viewer path. Verdict: **not recommended** — complexity without a corresponding alpha requirement.

**Plain HTTPS ingress with owner-managed certificates (Let's Encrypt, home router port forward).** In: simplest possible, fully self-hosted, no extra software. Out as the primary path: it assumes the home network accepts inbound connections, which is false under CGNAT — now common on residential ISPs, where the router's WAN address is private and port forwarding is impossible. It also puts an authenticated API on the public internet, raising the stakes of every auth bug. Verdict: **out as the required path**; acceptable as an *optional* fallback for owners with a real public IP, never the qualified alpha route.

**NetBird / ZeroTier (noted, not separately scored).** NetBird is a genuine alternative in the 1b slot: open source with officially supported self-hosting (unlike Headscale's community status). ZeroTier's controller can also be self-hosted. Neither was researched as deeply as the Tailscale-protocol options; if the owner dislikes the Headscale maintenance-risk profile, NetBird deserves a second look before implementation. They do not change the family-level conclusion.

## Scoring summary

| Axis | 1a Tailscale (vendor) | 1b Headscale (self-hosted) | 2 Nostr | Reverse SSH | Cloudflare Tunnel | WebRTC | Plain HTTPS ingress |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Security model | Strong (E2E WireGuard; vendor sees metadata only) | Strong (same data plane; metadata stays local) | Needs designed key lifecycle; NIP-44 limits | Strong (SSH) but hand-rolled relay | Vendor terminates TLS at edge | Strong (DTLS-SRTP) | Strong only if auth is perfect; public surface |
| Self-hostability | ❌ vendor account required | ✅ owner-operated | ✅ private relay required | ✅ VPS + sshd | ❌ Cloudflare account required | ✅ but complex | ✅ where inbound works |
| Latency/reliability | Excellent (p2p; DERP fallback) | Excellent (same) | Adequate; no ordering/durability | Good; flappy tunnels | Excellent | Excellent | Excellent |
| NAT traversal | ✅ DERP fleet | ✅ own DERP/VPS | ✅ outbound WS | ✅ via VPS | ✅ via edge | ✅ TURN | ❌ fails under CGNAT |
| iOS background | ✅ OS-managed VPN persists | ✅ same | ❌ socket dies | ❌ socket dies | ❌ socket dies | ❌ PC dies | ❌ socket dies |
| Operational burden | Near zero; $0 (Personal free) | One VPS + Headscale + certs; ~$5/mo class | Relay + key lifecycle + separate stream path | VPS + autossh babysitting | Near zero; $0 | Signaling + TURN ops | Near zero where it works |
| Local-first fit | Weak (vendor control plane) | Strong | Strong if self-hosted | Strong | Weak (vendor edge) | Strong | Strong |

## Recommendation

**Ship the alpha on the private-route family (Candidate 1): one WireGuard mesh carrying the existing authenticated AgentMeld API, with no transport-specific protocol work.** The decisive reasons:

1. **One API surface.** Local browser, same-network clients, and cross-network clients all speak the same versioned authenticated API. Every mandatory semantic — pairing, request IDs, revocation, replay-safe reconnect — is built once and qualified once.
2. **The iOS background story is the best available.** A system-managed VPN tunnel (`NEPacketTunnelProvider`) survives app suspension; every app-socket alternative (Nostr, SSH, Cloudflare, WebRTC, HTTPS) must cold-reconnect on every foreground. For a control app the user opens dozens of times a day to check approvals, this dominates the UX.
3. **NAT traversal is solved, not hand-rolled.** DERP-style relaying handles cellular symmetric NAT; the team does not build or operate relay selection logic.
4. **Nostr does not reduce work.** It still requires operating a private relay *and* a separate stream/file path, while adding unsigned-ordering, key-lifecycle, and reconcile machinery the private route avoids.

**Decision (2026-09-18, owner): ship the alpha on 1a (vendor-hosted Tailscale Personal), with 1b (self-hosted Headscale) as the documented self-host path.** Three reasons tipped it: (1) zero setup friction for users — install the Tailscale app, sign in, done, the lowest-friction option of everything compared; (2) zero new infrastructure to qualify the alpha gate — the owner's devices are already enrolled, so the cross-network tests (iPhone on cellular, MacBook Air off-network → Mac mini at home) can start immediately; (3) the choice is reversible — the AgentMeld layer is identical either way, so it can be revisited without rework. The honest price of 1a is a Tailscale account and vendor-held coordination metadata; content stays end-to-end encrypted. Headscale remains documented for owners who want full sovereignty; revisit if Tailscale's terms, pricing, or reliability change.

## Explicit non-recommendations

- **Nostr as the alpha transport:** adds protocol work without removing operational burden; keep as a future adapter seam.
- **Cloudflare Tunnel:** convenient but requires a vendor account and terminates TLS at the vendor edge — wrong trust shape for a control plane.
- **Plain HTTPS ingress as the required path:** fails under CGNAT; fine as an optional fallback only.
- **WebRTC data channels:** real-time media machinery for a problem plain TLS already solves; dies in iOS background.
- **Reverse SSH as the qualified path:** fine as an emergency fallback during development, too hand-rolled to qualify.

## iOS background behavior (cross-cutting)

Verified against current platform behavior: iOS suspends apps shortly after backgrounding; app-held sockets (WebSocket, SSH, WebRTC, HTTPS) die with the suspension. The only transport whose *path* survives is a system VPN tunnel via `NEPacketTunnelProvider` — which is exactly what the Tailscale/Headscale iOS app provides. The AgentMeld iOS app itself still reconnects its API/event stream on foreground, but over an already-up interface, so the cost is one TLS handshake, not tunnel re-establishment. APNs remains a separately qualified enhancement for wake hints; per the alpha decision, correctness must never depend on push delivery or an always-connected phone. Any transport choice must therefore be paired with: fast foreground reconnect, host-issued cursor replay, and honest "offline/unknown" states — all of which live in the Rust service, not the transport.

## Open questions for the owner

1. ~~**Control plane: operate or trust?**~~ Decided 2026-09-18: vendor-hosted Tailscale for the alpha; Headscale as the documented self-host path.
2. **Headscale self-host documentation:** when the self-host path is written up, it will need a VPS and domain suitable for Headscale (or a relay). Not needed for the alpha path.
3. **iOS distribution path** (App Store / TestFlight / sideload): it determines whether requiring the separate Tailscale iOS app alongside the AgentMeld app is acceptable alpha UX.
4. **Mac mini's home uplink:** is it behind CGNAT (expected) or does it have a real public IP? This only affects whether the plain-HTTPS fallback is even worth documenting.
5. **APNs scope for alpha:** wake hints for approvals, or nothing until the notification enhancement is separately qualified?

## Decision recorded

**2026-09-18, owner: vendor-hosted Tailscale Personal for the alpha; Headscale as the documented self-host path.** See [the transport selection decision](../decisions/2026-09-18-remote-transport-selection.md).

Either choice carries the same AgentMeld API, the same qualification tests (pair across networks, revoke a device, forged/wrong-host requests, duplicate/out-of-order events, relay/host restarts, expired approvals, offline stop, simultaneous clients, one active browser controller), and the same iOS background behavior. No implementation begins until the qualification plan in the alpha decision is scheduled.

## What was verified and what was not

Verified via current sources during this research (2026-09-18): Tailscale Personal pricing (free, 3 users/100 devices) and plan lineup; Headscale's BSD-3 license, community-maintained status, and official-client compatibility including the iOS alternate-coordination-server flow (supported since iOS client v1.38.1); Cloudflare Tunnel's free unmetered offering and its account/domain requirement; CGNAT making residential port forwarding impossible on affected ISPs; typical Nostr relay event-size caps (~64KB strfry default); iOS background suspension killing app sockets while `NEPacketTunnelProvider` tunnels persist.

Not verified: measured DERP relay latency for the owner's networks (needs real devices); Headscale's exact protocol-drift exposure if Tailscale changes its coordination protocol; Tailscale's precise control-plane data retention terms; NetBird/ZeroTier depth (noted as alternatives, not fully scored); real-world Headscale iOS onboarding friction on current iOS. The qualification plan in the alpha decision (paired real devices across networks, revocation, forged requests, reconnect storms) must produce these measurements before alpha exit.
