# Worker↔service seam schemas — v1

Normative JSON Schemas (draft 2020-12) for the worker↔service protocol defined in
[worker-service-seam.md](../../../worker-service-seam.md). The Rust service validates every
inbound frame against these; the Node worker constructs every outbound frame to satisfy
them. `additionalProperties: false` throughout is the `deny_unknown_fields` spirit from
the M0 journal: unknown fields are rejected, never ignored.

## Message inventory

Worker → service (the four verbs, plus the session handshake):

| File | Message | Verb |
| --- | --- | --- |
| `worker-session-hello.schema.json` | `worker.session.hello` | session handshake |
| `worker-events-append.schema.json` | `worker.events.append` | 1 — append run events |
| `worker-approvals-request-decision.schema.json` | `worker.approvals.request-decision` | 2 — request approval decisions |
| `worker-inputs-fetch.schema.json` | `worker.inputs.fetch` | 3 — fetch inputs |
| `worker-artifacts-deliver.schema.json` | `worker.artifacts.deliver` | 4 — deliver artifact bytes |

Service → worker:

| File | Message |
| --- | --- |
| `service-session-welcome.schema.json` | `service.session.welcome` |
| `service-events-stored.schema.json` | `service.events.stored` |
| `service-approval-decision.schema.json` | `service.approval.decision` |
| `service-inputs-data.schema.json` | `service.inputs.data` |
| `service-artifacts-stored.schema.json` | `service.artifacts.stored` |
| `service-turn-start.schema.json` | `service.turn.start` |
| `service-turn-cancel.schema.json` | `service.turn.cancel` |
| `service-lease-command.schema.json` | `service.lease.command` |
| `service-error.schema.json` | `service.error` |

## Versioning policy

- Every message carries `"protocol": "worker-seam/1"`. The version is a whole-protocol
  version, not per-message: both sides speak exactly one version per connection.
- **Negotiation:** the worker proposes its preferred version in `worker.session.hello`;
  the service answers with `negotiated_protocol` in `service.session.welcome`, which may
  be lower, never higher. A version the service does not speak is rejected explicitly
  with `service.error` code `unsupported_protocol_version` (carrying
  `max_supported_protocol`) — never silently accepted, never silently downgraded.
- **Additive changes** (new optional fields, new `event_type` values) do **not** change the
  version: a v1 receiver ignores optional fields and enum values it does not understand.
  New *message types* the other side must understand are a new protocol version, not an
  additive change — an unknown message type is rejected with `unknown_message`, never
  silently absorbed.
- **v2** gets its own directory, `schemas/worker-seam/v2/`, with its own `$id`s and a
  changelog in its README describing every breaking change and the migration path.
  v1 remains valid until the service drops it; dropping a version is announced one
  milestone ahead in the roadmap, and the service keeps speaking the old version until
  then. The service may speak multiple versions concurrently; the worker pins the
  negotiated version for the life of its connection.
- Schemas are frozen once an implementation ships against them. Fixes before that are
  edits, not versions.

## Conventions used in every schema

- `$id` points at the raw GitHub URL of the file on `main`.
- `uuid`: RFC 4122 text form. `hex64`: lowercase sha256 hex.
- Sizes are bounded everywhere: 1 MiB max frame, 256 KiB max fetch chunk, 8 MiB max
  artifact total (the PoC's output cap, now service-enforced), 4096 chars max per
  streamed text batch.
- Timestamps: only the service stamps time (`server_time_ms`, `decided_at_ms`).
  Worker-supplied times are never authoritative.
