# Codex subscription qualification

Updated: 2026-09-18. Status: required alpha path; authenticated isolated inference not yet qualified.

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

The [dedicated store proposal](codex-auth-store.md) now specifies the exact VM-local volume, native token-file path, permissions, setup command and recovery behavior. Synthetic persistence and tool denial pass; real creation and login remain pending explicit authorization.
