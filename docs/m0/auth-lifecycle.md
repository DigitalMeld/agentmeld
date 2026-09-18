# Native authentication lifecycle qualification

Verified 2026-09-18. Codex 0.154.0 passes an offline native lifecycle fixture using synthetic credentials and loopback refresh/revocation endpoints. This complements live subscription login, inference and restart evidence; it does not claim a real provider refresh or owner-session revocation test.

## Method and evidence

The pinned [native auth manager](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/login/src/auth/manager.rs) exposes `CODEX_REFRESH_TOKEN_URL_OVERRIDE` and `CODEX_REVOKE_TOKEN_URL_OVERRIDE`. Its [app-server account processor](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server/src/request_processors/account_processor.rs) implements refresh and logout, and [upstream native tests](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server/tests/suite/auth.rs) exercise permanent refresh failures using synthetic auth. Those interfaces informed this explicit qualification fixture; no upstream dependency was patched.

The probe runs the real pinned app-server in an offline, non-root, read-only container using Docker's default seccomp profile. All homes and credential files are newly created in temporary storage. Environment inheritance is restricted to PATH and the fixture's own HOME/CODEX_HOME and endpoint overrides. No provider credential, retained auth volume, personal login directory, API key or external endpoint is used. Synthetic unsigned JWT metadata is test input, not accepted real-provider authentication.

Verified cases:

- Successful native refresh sends the synthetic refresh token to the loopback endpoint, returns the replacement access token internally, and persists the new access/refresh pair to the temporary native store.
- Native `account/logout` calls the loopback revocation endpoint, removes that temporary auth file and makes `account/read` return no account.
- Permanent HTTP 401 `refresh_token_expired` causes native status to withhold the access token. A second refresh request remains unusable without another endpoint attempt.
- Transient HTTP 429 preserves the existing usable synthetic session and stored refresh token. A later successful explicit refresh recovers and returns the replacement access token.

The probe uses legacy native `getAuthStatus` with token inclusion only for synthetic values, so it can assert withholding and replacement without printing them. Account readback/logout use the v2 methods. No turn, model fallback or inference request is started. This is evidence about native auth lifecycle, not inference rate-limit handling or proof that an account/catalog presence check alone guarantees a usable session.

## Reproduction

```sh
python3 scripts/probe-container.py --context colima-agentmeld-m0 --probe codex-auth-lifecycle --seccomp-profile docker-default --workspace auth-lifecycle
```

The explicit run passed on `sha256:64ca70099c076f09630ac1ba2e006b70a21eeaf220ba1377859d89120c4f9471`, taking approximately 0.36 seconds inside the launcher measurement. Sanitized evidence is retained under ignored `.local/m0/auth-lifecycle-final.log` and `.local/m0/evidence/`. The default suite remains 194 passing tests plus formatting, lint, build and documentation checks; this separate native probe is not counted as a default unit test.

The dedicated owner subscription store was not mounted or altered. Real-provider refresh/expiry behavior, provider-side revocation and the future owner reconnect UI remain unqualified. Production must delegate credential refresh to Codex, represent authentication failures explicitly and never silently switch to API billing. Do not use these endpoint overrides in the production provider path.
