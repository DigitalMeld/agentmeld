# Codex subscription qualification

Updated: 2026-09-18. Status: first authenticated isolated stream and native device challenge/cancel verified; the broader live tool/session matrix remains open.

## Scope and decision

Brad reconfirmed that alpha is Codex-only and uses his ChatGPT subscription, not API-key billing. Claude Code and Ollama are post-alpha. Prefer supported subscription authentication for later providers where available; this does not establish compatibility for every vendor. This decision supersedes earlier three-provider launch wording.

Existing Claude/Ollama fixtures are retained as historical experiments. The briefly authorized local Ollama download was interrupted when alpha scope was corrected; no Ollama inference was run in this work. Downloaded partial cache data was not deleted.

## Supported interface and remaining boundary

The installed and container-pinned Codex 0.154.0 CLI exposes `login --device-auth`. Official [authentication documentation](https://developers.openai.com/codex/auth) describes ChatGPT sign-in and device-code login for headless environments. Device login may require an account setting. No account setting has been changed here.

The official [app-server reference](https://developers.openai.com/codex/app-server) describes managed ChatGPT login through `account/login/start`, including `chatgptDeviceCode`, login completion/cancellation and account readback. Codex manages token persistence and refresh. Although the public reference describes experimental external-token mode, the pinned 0.154.0 generated schema marks it internal use only. AgentMeld excludes that path and does not extract desktop tokens.

Candidate: a dedicated AgentMeld login context using the official flow. Never copy or mount the personal Codex directory. Before starting login, define exactly where dedicated credentials persist, how the native harness receives access, and how untrusted child tools are prevented from reading them. Keep secrets and device codes out of retained qualification reports. Login alone will not qualify this boundary.

The current offline container profile has no network and no credentials. It cannot perform subscription inference unchanged. Qualify narrowly scoped login/inference egress, protected credential storage and refresh without disabling the browser sandbox or granting arbitrary host access. The final packaging is unresolved; do not substitute host execution or an API key to mark M0 complete.

## Exit evidence

- Pinned native protocol supports the managed subscription login surface.
- Owner completes a dedicated official login; sanitized account readback confirms the intended auth mode.
- Real streamed turn and bounded tool success/error, allow/deny, cancellation and continuation after native process replacement pass.
- Native child processes stay inside the intended execution boundary; credential, host-file and cross-workspace canaries remain inaccessible.
- Egress rejects unapproved destinations; expiry/logout and rate-limit failures are explicit and do not trigger fallback billing.
- Reports retain versions, case results and measurements, not tokens or private account content.

See the [M0 exit checklist](exit-checklist.md) for the current work order and evidence status.

## Offline protocol evidence

The rebuilt Linux ARM64 image passed `codex-auth` on 2026-09-18. Generated schemas from its native binary contain managed browser/device login and the device response fields. A real app-server launched with an empty temporary home reported no account and required OpenAI authentication. It received no login request or credentials; networking remained disabled. This establishes protocol availability, not successful subscription authentication.

```sh
python3 scripts/probe-container.py --context YOUR_CONTEXT \
  --probe codex-auth --seccomp-profile docker-default --workspace auth-schema
```

Image: `sha256:4445999cd5f837ecfee6f6d7f9131ccfda629bfb0dad1ace7fccaac642932028`. The report explicitly records `loginStarted: false` and `liveInferenceQualified: false`. Raw reports remain under ignored `.local/m0/evidence/`; the summary is `.local/m0/codex-auth-probe.log`.

## Native tool credential boundary

The offline canary qualification now passes both standalone Codex sandbox execution and a real app-server `exec_command` requested through a synthetic model stream. The parent probe can read its synthetic credential file; sandboxed commands cannot read it directly, through a workspace symlink, or through the two tested proc-root paths. Workspace writes still succeed. No real credentials, subscription login or live inference were used.

See [credential boundary evidence](codex-credential-boundary.md) for the separate named AppArmor/seccomp policy, reproduction, limitations and next steps. This qualifies those command paths only. Persistent credential storage, other native tools, mediated egress and authenticated inference remain open.

The [dedicated store proposal](codex-auth-store.md) now specifies the exact VM-local volume, native token-file path, permissions, setup command and recovery behavior. Synthetic persistence and tool denial pass; the dedicated store and narrowly scoped existing-subscription import are now verified under explicit owner authorization. Live inference and managed login remain separately qualified.

## Verified live subscription checkpoint

On 2026-09-18, after the owner explicitly authorized the existing subscription token, the dedicated-store importer copied only native authentication fields and preserved the source file. Image `sha256:6a7748f493b8b9f27b2abbd4f47ebb117670b6f93f195618954e7589d5349223` then passed real app-server account recognition, model availability and a streamed GPT-5.5 turn through the restricted gateway. The exact synthetic reply was verified without retaining raw model output or account details. No API key or fallback billing path was used. The report is `.local/m0/subscription-smoke.log`.

The same image separately requested an official managed device-login challenge in an empty temporary home and canceled it immediately. A second cancel returned `notFound`; account readback stayed logged out and no auth file was created. The challenge code/URL were never printed or retained. This proves the native challenge/cancel transport, not owner completion of that new login. Report: `.local/m0/device-egress.log`.

The first live attempts failed because the slim image lacked `/etc/ssl/certs/ca-certificates.crt`. Node's earlier TLS probe used its bundled roots and did not catch the native client's missing system trust store. Installing Debian's standard `ca-certificates` package resolved both native device authentication transport and live streaming with certificate verification enabled. The Dockerfile now checks the bundle exists. No verification bypass, custom root injection, proxy allowlist expansion or sandbox relaxation was used.

The dedicated native home denies tool access to the actual authentication file; preflight checks both read and read/write opens without reading or modifying credential bytes. Native `thread/start` adds the exact `/workspace` trust entry to config. The runtime verifier permits that one observed suffix while rejecting changes to login mode, home denial or network permissions.

```sh
# Requires the owner-authorized dedicated store; this consumes subscription usage.
node scripts/probe-provider-egress.mjs --context colima-agentmeld-m0 --subscription
# Separate unauthenticated challenge/cancel test; never presents a code to a user.
node scripts/probe-provider-egress.mjs --context colima-agentmeld-m0 --device-login
```

Each mode uses the same isolated network, explicit proxy, disabled upstream DNS and enforced native sandbox. The subscription worker mounts only the verified auth volume and uses a bounded temporary workspace. Cleanup removes its worker/proxy/network and preserves the dedicated credential volume. Ordinary default checks use neither mode.

This closes the first live subscription stream and native login-egress gaps. Tool success/error, allow/deny, interruption, continuation after process replacement, refresh/logout behavior and recovery remain open. The imported token is not proof of independently issued login sessions. No logout test may revoke the owner's shared session without explicit authorization.

## Live execution follow-up

The explicit `--execution` probe uses the authorized store and isolated gateway. It checks a native command event plus an independent workspace file readback, an intentional exit-23 fixture plus its execution marker, and persisted conversation recovery after replacing the native app-server process. Reports contain only bounded status fields; synthetic native conversation history remains in the protected dedicated home. No account content, token values or raw provider errors are copied into reports.

The protocol client binds events to both thread and turn identifiers, accepts completion arriving before the RPC response, denies server callbacks and bounds output and execution time. Offline tests cover cross-thread/stale-turn exclusion, unexpected approval callbacks, malformed output and process loss. This probe does not qualify approval grants or interruption.

Initial live observations: thread creation needs the pinned protocol's experimental capability negotiation for its explicit permission-profile parameters. With that negotiation enabled, the workspace command succeeds. Asking the model to run bare `exit 23` completed without a native command item, so it did not qualify tool failure. The real fixture script writes an independent execution marker and exits 23. Its marker exists, but the native stream still has no command item, including in a fresh conversation. No approval callbacks were requested. The probe does not treat the model mentioning exit 23 as native exit-code evidence.


Image `sha256:234693db10bda5e3c547ab3c644d4f47ebb117670b6f93f195618954e7589d5349223` verified:

- Subscription recognition and actual workspace command success (native exit 0 plus random marker readback).
- Full native process shutdown/replacement, persisted thread resume by ID, and a streamed exact conversation-only nonce without supplying it again or requesting tools.
- The failure fixture's execution marker, but **not** its native error event. The failure turn completed with user/agent message items only; both streamed command items and the completed turn's command items were absent. Therefore `commandFailure: false` and `qualified: false`; the explicit command exits nonzero.

Evidence: `.local/m0/live-execution.log`, with immutable-image metadata and sanitized diagnostics in `.local/m0/egress/`. Five new offline client tests bring the default suite to 177 tests. The probe preserves synthetic history in the protected dedicated home; it does not prove whole-container/machine recovery or perform session logout. No native error-event workaround or upstream dependency patch was applied.

```sh
node scripts/probe-provider-egress.mjs --context colima-agentmeld-m0 --execution
```

Next: reproduce the missing command-result lifecycle with an offline native stream, inspect pinned native history/event handling, and qualify live error reporting before calling this matrix complete. Approval allow/deny and interruption remain separate gates. Persisted-thread nonce recovery is verified even though the error gate remains open.
