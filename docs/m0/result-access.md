# M0 scoped result access

Date: 2026-09-17. Scope: read-only loopback HTTP access to one settled synthetic tool result. This is a capability prototype for trusted host callers, not owner accounts, remote authentication or multiuser authorization.

## Contract

`startResultServer({ authority, archive, scope, ttlMs })` in `experiments/result-server.mjs` binds an ephemeral port on `127.0.0.1`. Trusted setup supplies and fixes the complete workspace, worker, thread, turn and request scope. The caller receives the origin, a random 256-bit bearer token, and explicit revoke/close controls. Keep that token out of logs and URLs; it is returned only to the trusted setup caller.

Only `GET /result` is accepted, with the token in the Authorization header. Host must match the bound origin; an Origin header, when supplied, must also match. Query parameters cannot select a different result. Responses contain only the validated tool name and result value as JSON, with no-store, nosniff and restrictive content-security headers. The server never renders result content as HTML or exposes archive paths.

Access expires after an absolute monotonic lifetime: 60 seconds by default, at most five minutes. Reads do not renew it. Revocation is permanent for that endpoint. Expiry and revocation are checked both before lookup and immediately before sending the result, so an outstanding read cannot deliver newly revoked data. Already delivered bytes cannot be recalled. Close revokes access and closes connections; the trusted owner must close unused endpoints to release the listener.

Only one archive read can be pending per endpoint. A competing request receives 429. Missing credentials receive 401, wrong host/origin 403, expired/revoked access 410, unsupported methods 405, and unknown paths 404. Missing, unsettled, foreign-scope or corrupt results return generic 409 errors without archive diagnostics. The endpoint uses the existing [settled-result index](result-archive.md#settled-result-index-and-recovery), verifies the stored bytes and binding, and cannot approve tools or resume execution.

## Verification

The default suite passes 115 tests: 18 Rust, 95 Node and two Python, plus formatting, Clippy, build and documentation checks. Seven HTTP tests cover authentication, host/origin binding, immutable scope, endpoint-specific tokens, absolute expiry, revocation during pending reads, contention and error redaction. One Rust-backed integration test covers orphan rejection, actual settlement, supervisor replacement, paused-state preservation, foreign scope, corruption and revocation.

Run the default suite with `sh scripts/check-local.sh`. The explicit native probe also passed all nine scenarios:

```sh
node scripts/probe-native.mjs --context YOUR_CONTEXT
```

Its three successful tools (sum, listing and text read) each passed HTTP retrieval after supervisor replacement, unauthenticated denial and revoked denial. This host-only change reused local image `sha256:edcb333300d04fb0a1f2b766d42d9fcd9e729ca4d12b3923733fbf0593424db3`; the worker and Rust binary were unchanged. Other runtime probes were not rerun in this batch. The probe used synthetic model responses, no personal data or live inference. Raw evidence remains under ignored `.local/m0/control/`.

## Limits and next action

The trusted host decides who receives a token and when to revoke it. Possession authorizes this one result until expiry or revocation; there is no account identity, membership lookup, persistent grant, remote listener, TLS deployment or production artifact API. This prototype does not establish a boundary against other hostile processes running as the host owner. It neither deletes archived data nor reconciles uncertain dispatches. The endpoint still exposes only ordinary settlement. Current journal format 6 adds a separate [reviewed recovery history](reviewed-recovery.md); reviewed outputs do not become ordinary HTTP results. Archive envelopes remain version 1.

Next: owner/task integration and production retrieval authorization, including a distinct presentation for reviewed output. Keep live-provider, iMessage identity and license decisions as separate qualification gates.
