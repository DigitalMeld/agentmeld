# Nostr and Buzz for private multi-system control

Date: 2026-09-18. Status: research and proposed qualification, no transport selected or installed. Buzz documentation inspected at `779af8886caae1317b4de962082429867ab61503`. This is a documentation/protocol review, not a Buzz runtime or security audit. No private Buzz configuration or keys accessed.

## Requirement

An owner uses iPhone over cellular or MacBook Air away from home to control an enrolled Mac mini. Multiple named Mac hosts are supported. Agent execution, authorization and durable results remain on the selected host. Messaging integrations and general remote browser access are deferred; one secure native-client connection is an alpha requirement.

## What Buzz establishes

Buzz documents a Rust/Axum relay with NIP-01 events, NIP-29 groups, NIP-42 connection authentication and HTTP endpoints. Its deployment also uses Postgres, Redis and media storage. It is a substantial communication application rather than a minimal remote tunnel. Its architecture makes the relay authoritative for its community state. AgentMeld should not transplant this into authority over local agent execution. [Pinned architecture](https://github.com/block/buzz/blob/779af8886caae1317b4de962082429867ab61503/ARCHITECTURE.md)

The interoperability guide distinguishes standard Nostr behavior, Buzz-specific events and incomplete features. It describes accepting NIP-17 gift wraps but separately lists NIP-04/NIP-44 as not implemented in its DM compatibility row. This does not establish client-side encryption coverage for all Buzz traffic. Do not equate Nostr adoption, private group membership, gift-wrap acceptance or signed events with universal end-to-end encryption. [Pinned interoperability guide](https://github.com/block/buzz/blob/779af8886caae1317b4de962082429867ab61503/NOSTR.md)

Its root source license is Apache-2.0. Component reuse would still require checking dependencies, notices and fit; no code or full infrastructure stack is selected by this review. [License](https://github.com/block/buzz/blob/779af8886caae1317b4de962082429867ab61503/LICENSE)

## Protocol implications

NIP-01 gives signed events, filters, subscriptions and relay acknowledgements over WebSocket. Connecting clients and hosts outward to a reachable relay is a plausible NAT-friendly design. It does not guarantee ordered, durable, exactly-once command execution, nor supply AgentMeld permissions. [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md)

NIP-42 authenticates a relay connection. It does not mean the key may approve a task or control a specific host. NIP-29 describes relay-managed groups; relay access control is not end-to-end content encryption. [NIP-42](https://github.com/nostr-protocol/nips/blob/master/42.md), [NIP-29](https://github.com/nostr-protocol/nips/blob/master/29.md)

NIP-44 specifies payload encryption, with explicit limits including no forward secrecy or post-compromise security in that scheme alone. NIP-17 adds a private messaging construction using NIP-59 wrappers. If used, pin compatible maintained libraries and verify the exact construction; do not invent cryptography or claim encryption hides all traffic metadata. Key compromise, recovery, rotation and retained relay ciphertext need an explicit threat model. [NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md), [NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md), [NIP-59](https://github.com/nostr-protocol/nips/blob/master/59.md)

## Recommended boundary

Nostr is a candidate transport for bounded commands, status and connection signaling. Keep the Rust host service authoritative for policy, command admission, sequencing, results and recovery. The relay must not mint grants or interpret model text as control authority. Default to explicit relay enrollment and encrypted private content, not public discovery or publishing user work to arbitrary relays.

Each command needs a request ID, target host/workspace, device identity, current grant version, expiry and expected state/lease where applicable. The host verifies these, deduplicates durably and emits an acceptance or rejection receipt. Relay acceptance is a distinct state. Replayed cancellation/approval and expired commands must not run after reconnection; a stale host cannot accept commands under revoked authority. Use host-issued sequence/cursor replay rather than trusting client timestamps as authoritative order. Stop remains pending/unknown when the host is unreachable.

Keep viewer frames and large artifacts off the durable event log. Use a separately authenticated encrypted stream/file path with host grants, quotas, integrity checks and reconnect rules. A Nostr proof that only sends chat messages does not satisfy the remote-control alpha requirement. The chosen design must also solve the stream/file path across NAT without silently requiring a second unqualified service. Do not assert WebRTC, TURN or a particular proxy implementation is selected yet.

Multiple native clients and hosts do not require federation or a shared distributed database. Per-device keys must be independently revocable; ownership/grants live in AgentMeld, not a single key copied across all machines. Friendly pairing hides protocol details from normal UI while allowing inspectable configuration.

## Comparison and selection gate

| Candidate | Benefit | Cost or unresolved requirement |
| --- | --- | --- |
| Existing private network plus authenticated AgentMeld API | Can carry commands, viewer and artifacts over one reachable endpoint | External installation/network setup and access policy; no vendor selected |
| Outbound secure reverse connection to a self-hostable relay | Purpose-built connection for native apps without home inbound ports | Operate the relay, select reviewed transport/security libraries, qualify encrypted content and bandwidth |
| Nostr adapter plus private relay | Open signed event format, subscriptions and potential future Buzz interop | Encryption/key lifecycle, command semantics, relay retention and separate stream/file transport still need qualification |

Tailscale is an example of a private network, a different layer from Nostr's event protocol; it remains a candidate rather than a product requirement. Neither is automatically free to operate in every deployment. [Tailscale overview](https://tailscale.com/docs/concepts/what-is-tailscale)

Before choosing, compare one conventional secure path with a bounded Nostr prototype on the same workload. Measure setup steps, idle/active resources, command latency, reconnect behavior, viewer responsiveness, transfer throughput and operating dependencies. Require paired real devices across networks, revoked-device rejection, forged/wrong-host requests, duplicate/out-of-order events, relay/host restarts, expired approvals, offline stop, simultaneous clients and one active browser controller. Inspect relay storage/logs for private-content exposure. Verify self-hosted deployment and backup/key recovery procedures.

Recommendation: keep Nostr in the alpha transport evaluation, not as a committed foundation or prerequisite for product work. Adopt it if it simplifies the complete cross-network journey and passes these gates; otherwise ship the simpler qualified secure connection and retain a later adapter seam. Choosing Nostr would not itself provide Buzz interoperability: event schemas, grants and supported NIPs must match.
