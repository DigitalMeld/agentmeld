# M0 supervisor outside the agent container

Date: 2026-09-17. Scope: local host control, offline Linux ARM64 browser computer, and payload-bound fixture dispatch. Two bounded Codex dynamic tools are now qualified separately in [native tools](native-tools.md); general native-tool mediation and hostile-tenant isolation remain open.

## Boundary

The separated probe runs Rust journal ownership, the trusted browser dispatcher and the authenticated viewer on the host. Its journal and synthetic canary live under `.local/m0/control/<run-id>/`, with an owner-only containing directory. The container receives only a newly created `.local/m0/workspaces/split-<run-id>/` mount. It receives no journal, supervisor handle, viewer capability, Docker socket, host credentials or network access.

The host sends browser requests over Docker stdin and accepts bounded, correlated responses over stdout. Container responses are never deserialized as supervisor commands. Unsolicited requests, mismatched response IDs and oversized output close the transport. Screenshot responses must match the expected data types, size limit, PNG header and fixed 640 by 360 dimensions before reaching the viewer. This is limited framing/image validation, not proof a compromised browser reports truthfully.

Docker inspection verifies the exact workspace mount and nonprivileged, read-only, network-disabled runtime. The worker attempts to read and append to a synthetic canary beside the real host journal; both attempts fail, and the host reads back unchanged canary bytes. The canary path is test metadata, not a secret. Only the trusted host can issue ownership transitions. These checks establish the tested mount/process separation, not resistance to a Docker or kernel escape.

## Payload-bound admission

Journal format 4 retains the SHA-256 digest of canonical JSON action content alongside the pending ticket. The host obtains admission, then consumes a one-time dispatch authorization for the same actor, generation, ticket and payload before sending the computer operation. Settlement must match that ticket and payload. Altered payloads and duplicate dispatch/settlement attempts are rejected.

Takeover, cancellation and disconnect revoke an admission that has not dispatched. Already-dispatched actions remain pending until settled or reconciled; their side effects cannot be undone by changing a generation. A crash after dispatch authorization but before receiving the result remains uncertain, including when the computer operation may never have started.

Old M0 journal records are rejected because they lack the new required format fields. Existing evidence is preserved. There is no silent migration, truncation or overwrite path. New fixture runs use fresh directories. Payload binding does not itself authorize tools: the trusted caller still selects the allowed fixture operations. Model-supplied actor names or direct access to supervisor stdin must never be exposed.

## Verified workflow

The separated probe exercises the host viewer HTTP endpoints with an ephemeral capability: unauthenticated access is denied, the agent reaches counter 1, takeover fences stale agent input, human input reaches 2, resume captures that observation, and new-generation agent input reaches 3. Disconnect revokes access and leaves the controller paused. After shutting down the computer, Rust process replacement reads back paused state and rejects the old generation.

The existing all-in-one Chromium viewer probe remains a visual/UI comparator; it is explicitly not evidence of protected journal storage. The separated probe uses HTTP requests for the viewer controls and inspects the browser image. Cross-host browser access, remote TLS, public authentication and mobile interaction remain unqualified.

## Reproduce

Build the local binary/image and prepare the browser seccomp profile as described in the [M0 guide](README.md), then run:

```sh
node scripts/probe-separated.mjs --context YOUR_CONTEXT
```

The runner retains its report, journal, canary and computer screenshot in its run-specific control directory, and stops only its uniquely named container. It does not publish a Docker port or persist a viewer credential. A total deadline and request deadlines bound the experiment; failures preserve evidence and exit nonzero.

## Remaining work

- Native Codex/Claude approval and tool dispatch must route through an authenticated, scoped interface. Their native tools are not automatically governed by this browser broker.
- The Codex dynamic-tool fixture now uses durable scoped approvals. The local probes now bind immutable runtime identity and explicit tool grants. Production requests still need remote identity, broader tool coverage and a reviewer UI.
- A compromised computer can alter its own workspace or lie about results. Its OS-level tool access and network policy still need qualification, including effects outside the broker.
- Worker identity, process-replacement fencing across machines, secret brokering, mediated egress, resource quotas and credential-entry suppression remain open.
- The host itself and its configured Docker context are trusted. Another host process running as the owner can read control files; this design does not isolate malicious peers sharing that account.
