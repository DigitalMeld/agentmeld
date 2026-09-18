# Native command approvals

The local app now connects supported Codex command approval callbacks to authenticated owner review. This is the command-review slice of P3, not completion of browser takeover or general external-write approval.

## Boundary

A callback must bind to an observed native turn on the current thread, include the complete bounded command, and target `/workspace`. Additional permissions, managed-network requests, environment changes, stdin approval and other callback types are unsupported and declined. The response is only one-time `accept` or `decline`; session caching and policy amendments are never sent. Existing container isolation, mounts, egress and native sandbox configuration remain unchanged.

The trusted host opens the existing Rust authority for each request. Its durable proposal/decision binds command, scope, expiry and a single-use decision. The app's canonical store retains the owner-visible history projection. Private native identifiers stay in the authority journal rather than the public history. History includes the command supplied for review, so it is owner-only data and is not exported to diagnostics.

The Approvals sidebar shows the exact command, directory, reason and decision history with conversation links. A pending request also displays a review notice near the composer and marks the Approvals tab. Review expires after two minutes. Concurrent decisions cannot both succeed. A successful history save is required before returning acceptance to the native process. Failure denies the request.

Stop, shutdown, completed tasks and stale callbacks cannot grant further approval. On restart, pending reviews become Interrupted; their old callbacks are not replayed and cannot be approved. Visible history survives. Approved means the owner decision was recorded, not proof the command executed or succeeded. The native run outcome remains separate. This slice does not claim that a waiting native callback can be resumed after process replacement; fresh review/continuation recovery remains required for full P3 acceptance.

## Storage and verification

Approval history is an optional additive `approvals` field in the existing canonical format-2 store. Authority journals are private files under that store's `approvals/` directory, outside agent containers. Keep both in future backup and SQLite migration plans. There are at most 1,000 history entries; reaching the bound declines new requests without deleting history. No credential format changes or new dependencies.

- Five focused tests cover native scope validation, changed digests, concurrent decisions/callbacks, single use, expiry, shutdown, failed persistence, API authentication and restart history.
- The disposable browser fixture verifies inline review, exact command rendering, approve/deny results and reload with no reusable decision buttons.
- The existing authentication/file fixture now waits for terminal state rather than a fixed 30 ms delay.
- Full local checks: Rust format/Clippy/build and 18 Rust tests; 212 Node tests; six seccomp tests; docs validation. Browser rendering inspected separately.

Live native command-approval generation is not yet qualified. The UI/integration tests use an injected execution callback and the real Rust decision authority. No external write or actual fixture command is dispatched by those tests. General browser access and protected takeover remain the next functional gap.
