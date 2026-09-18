# Dedicated Codex subscription store

Updated: 2026-09-18. Synthetic volume qualification, real store creation and owner-authorized existing-subscription import passed. Live streaming now passes; session lifecycle qualification remains open.

## Reviewable setup

Create one new Docker local volume named `agentmeld-m0-codex-auth` in the dedicated `colima-agentmeld-m0` VM. Mount it at `/agentmeld-home`; set native `HOME` there and `CODEX_HOME` to `/agentmeld-home/.codex`. Codex's supported file backend will save the new subscription session at `/agentmeld-home/.codex/auth.json`. No personal Codex directory, host home, keychain or browser profile is mounted or copied. The optional single-file import below was explicitly authorized by the owner; default setup does not import credentials.

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

Evidence is retained under ignored `.local/m0/auth-store/`; summary `.local/m0/auth-store.log`. The report records the immutable image and two passing replacement-container runs. No real credential bytes or provider calls occur. The real `--create` path and authorized single-file import have now executed successfully; see the owner authorization record below.

## Remaining gates

The specific storage setup and owner-authorized import are complete. Qualify native subscription inference and managed login through the gateway. Check token-file modes after native persistence, sanitized subscription-mode account readback, refresh/logout and continuation. Test authenticated app-server tools with both the protected home and provider network available. Broader code-mode configurations, disk quotas, whole-VM restart/recovery and credential-entry browser behavior remain separate open requirements. A synthetic canary does not establish successful authentication or every possible native access path.

Pinned source: [Codex configuration schema](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/config.schema.json) defines `forced_login_method = "chatgpt"` and `cli_auth_credentials_store = "file"`.

## Owner-authorized existing subscription import

On 2026-09-18 the owner explicitly authorized using the existing Codex authentication token. The dedicated `agentmeld-m0-codex-auth` volume was created and verified, then only the required fields from the private `~/.codex/auth.json` file were copied through container stdin. The source was native `chatgpt` authentication with no API key. No directory mount, settings, browser profile or unrelated files were imported.

The importer defaults to a plan and requires explicit `--import`. It refuses symlink/non-private source files, API-key authentication, missing tokens, oversized input, a foreign engine/store instance or an existing destination. It writes the native file as UID/GID 1000 mode 0600, syncs it, verifies exact readback, and confirms the source file is unchanged. It never prints token fields or account details. A disposable synthetic run verified the write/readback/private modes and existing-file refusal before the owner import. The store is retained, never removed by probe cleanup.

```sh
node scripts/import-codex-subscription.mjs --context colima-agentmeld-m0
# Only after owner authorization, add --import. An existing destination is not overwritten.
```

This is an explicitly authorized operator import, not the default product onboarding flow. Codex may refresh its dedicated copy; this does not establish independently issued sessions or automatic synchronization with the source. Preserve the original authentication file. The native managed login flow remains a separate qualification path.
