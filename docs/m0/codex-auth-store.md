# Dedicated Codex subscription store

Updated: 2026-09-18. Synthetic volume qualification passed. Real storage creation and owner login await explicit authorization.

## Reviewable setup

Create one new Docker local volume named `agentmeld-m0-codex-auth` in the dedicated `colima-agentmeld-m0` VM. Mount it at `/agentmeld-home`; set native `HOME` there and `CODEX_HOME` to `/agentmeld-home/.codex`. Codex's supported file backend will save the new subscription session at `/agentmeld-home/.codex/auth.json`. No personal Codex directory, host home, keychain, browser profile or existing credential file is imported.

The pinned configuration forces ChatGPT login, uses the explicit file backend, denies native tool access to the entire dedicated home and disables tool networking. The trusted native harness can read and refresh its own tokens. The store is not hidden from the trusted harness, Docker administrator or host owner. It uses private filesystem permissions, not a new application-level encrypted vault; host/VM disk protection and backup exposure must be considered separately. Never publish or include this volume in ordinary fixture exports.

Directories are initialized as mode 0700 and files as 0600, owned by UID/GID 1000. A temporary trusted initializer runs offline as root with only CHOWN added to otherwise dropped capabilities, before any credential exists. It executes fixed setup code, not a model or agent command. A non-root read-only verifier checks identity, configuration and modes afterward. Normal harness containers remain non-root with all capabilities dropped.

The volume carries purpose/version/instance labels and a matching internal marker. Initial creation refuses an existing volume or operator record; initialization refuses any nonempty store. Reuse must validate engine identity, volume labels and internal marker. Partial setup is retained for explicit recovery, never silently erased or overwritten. These owner-controlled labels are binding metadata, not cryptographic protection from Docker administrators.

The setup tool defaults to a read-only plan:

```sh
node scripts/setup-codex-auth-store.mjs --context colima-agentmeld-m0
```

Only after explicit authorization, add `--create`. Creation does not begin login or store tokens. It records initialization events without credentials in ignored `.local/m0/subscription/store.jsonl`. The later login step must use the [restricted gateway](provider-egress.md), official managed device flow and the same protected store. Owner approval in the provider's sign-in flow is a separate interaction. No API-key fallback or copied subscription token is permitted.

## Qualification

The disposable probe uses a uniquely named `agentmeld-m0-auth-fixture-<UUID>` volume, never the real name. Three default tests cover mount/name constraints, foreign/remapped/wrong-instance rejection and required configuration. The explicit container probe:

1. Initializes an empty fixture and rejects a second initialization attempt: after ownership changes, the root initializer without DAC override cannot even list the private directory. The program also has an explicit empty-directory guard.
2. Checks private modes, UID/GID and exact configuration as the non-root worker.
3. Writes one synthetic canary, then checks read/write denial through the native sandbox for the direct file, workspace symlink and configuration file.
4. Replaces the entire container and reads the same persisted canary before repeating the denials.
5. Removes the disposable fixture volume and any owned containers.

Prepare/load the [Codex sandbox profile](codex-credential-boundary.md#reproduction), build the M0 image, then explicitly run:

```sh
node scripts/probe-auth-store.mjs --context colima-agentmeld-m0
```

Evidence is retained under ignored `.local/m0/auth-store/`; summary `.local/m0/auth-store.log`. The report records the immutable image and two passing replacement-container runs. No real credential bytes or provider calls occur. The real `--create` path remains unexecuted pending authorization; its components are exercised by the disposable probe, but that is not a claim that the owner store exists.

## Remaining gates

Authorize the specific storage setup, create and verify it, then qualify managed login through the gateway. Check token-file modes after native persistence, sanitized subscription-mode account readback, refresh/logout and continuation. Test authenticated app-server tools with both the protected home and provider network available. Broader code-mode configurations, disk quotas, whole-VM restart/recovery and credential-entry browser behavior remain separate open requirements. A synthetic canary does not establish successful authentication or every possible native access path.

Pinned source: [Codex configuration schema](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/config.schema.json) defines `forced_login_method = "chatgpt"` and `cli_auth_credentials_store = "file"`.
