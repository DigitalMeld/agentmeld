# Separate browser and native harness qualification

Updated: 2026-09-18. An offline two-container fixture passes. This is browser/profile separation and private-observation evidence, not production credential-entry UI, real authentication or a general sandbox-escape assessment.

## Why this boundary is required

Hiding screenshots cannot protect a browser profile from arbitrary native code in the same container. The existing all-in-one probe remains a UI/startup fixture only. The [architecture](../specs/architecture.md) requires a separate browser service and private profile; this probe exercises that topology with the existing host Rust authority.

## Verified flow

On image `sha256:fd9aed760a4aa7a904c2dc3e72e5a88204bb8d7490b6682d602f6ab149b96b9d`, the host starts a browser-only fixture container, without shared mounts, published ports or external networking. Playwright launches Chromium with renderer sandboxing enabled and a private temporary profile. The host reaches it only through a bounded stdio bridge; the native harness receives neither that bridge nor its supervisor journal.

1. The host takes human control and persists private mode through Rust before entering any synthetic data.
2. Inside the browser service, the fixture generates a random secret, fills a password field, creates an HttpOnly session cookie and writes a private-profile canary. It returns only success booleans, never the secret. No owner data is used.
3. Private mode rejects both observation and resume through the trusted control path.
4. A second, separately launched container runs a real Codex command tool using synthetic model responses. Direct profile access, `/proc/1/root` profile access and Docker-socket reads/writes all fail. A workspace result file proves that the command actually ran. Browser and command PID/network namespace identities differ.
5. The browser service confirms its original profile canary and session cookie remain intact. Its trusted fixture removes the credential form and checks that the DOM contains neither the input nor its secret before the host reveals the screen.
6. Resume obtains a fresh observation of the signed-in fixture. The session remains intact afterward. Both disposable containers are removed; browser profile data lives only in their bounded temporary storage.

The recorded report is `.local/m0/browser-isolation.log`, with a per-run report and supervisor journal under ignored `.local/m0/browser-isolation/`. The fixture does not save a screenshot artifact or credential value. Container roots are read-only, processes are non-root, capabilities are dropped, no-new-privileges is enabled, and explicit Codex seccomp/AppArmor policies remain enforced.

## Reproduction

Build the [M0 image](README.md), prepare/load the [Codex sandbox policy](codex-credential-boundary.md#reproduction), build the local Rust authority, then run:

```sh
node scripts/probe-browser-isolation.mjs --context colima-agentmeld-m0
```

This is an explicit container probe, excluded from default checks. The browser fixture accepts only fixed synthetic operations over private stdin. It is not a secret-input endpoint. Native inference uses the existing GPT-5.5 fixture configuration; no live provider request or credentials are involved.

## Remaining acceptance work

Qualify an authenticated owner-only input transport, including keyboard/clipboard handling, reconnection and cancellation, before accepting real browser credentials. Keep native execution unable to address the browser service or read its profile. Integrate this topology into the authenticated worker lifecycle and qualify browser egress separately. The current provider egress gateway is not a browser egress policy.

The trusted host can observe/control the browser; this boundary does not protect secrets from a compromised supervisor, browser service or visited site. The fixed synthetic form-clear step is not a detector for secrets rendered by arbitrary websites. Previously delivered images and browser-held session credentials are not erased by private mode. Multi-user access and persistent-profile backup/restart are still unqualified. Do not mark the full browser credential-entry gate complete from this fixture.
