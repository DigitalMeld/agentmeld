# Provider egress qualification

Updated: 2026-09-18. Status: isolated transport experiment passes. Live subscription authentication and inference were qualified separately (see [codex-subscription.md](codex-subscription.md) and [completion-audit.md](completion-audit.md)); this probe covers only the egress transport boundary.

## Boundary

The worker joins one disposable Docker network with `--internal` and `com.docker.network.bridge.gateway_mode_ipv4=isolated`. Unlike an ordinary internal network, isolated mode does not assign the bridge an address on the Docker host. A separate trusted proxy joins that network and an outbound bridge. Neither container publishes ports or mounts host data. Both use non-root UID, read-only root, dropped capabilities, no-new-privileges and explicit CPU/memory/PID/tmpfs limits. [Docker gateway modes](https://docs.docker.com/engine/network/port-publishing/#gateway-modes)

The worker uses a numeric proxy address and loopback-only upstream DNS configuration. Its ordinary external DNS lookup is tested to fail. Only the proxy resolves provider hostnames. The CONNECT handler accepts exact `auth.openai.com:443` and `chatgpt.com:443` authorities, with no wildcard, alternate port, IP literal or URL syntax. It rejects private/special-use IPv4 and all IPv6 answers, including mixed public/private responses, then dials the checked numeric address without a second lookup. DNS errors and late completion fail closed.

Default limits are eight connections, 8 KiB HTTP headers, five-second connect deadline, fifteen-second idle timeout, sixty-second tunnel lifetime and 16 MiB per direction. Plain HTTP requests are rejected. The proxy does not terminate TLS, read authentication headers or log request bodies. The client must validate the provider certificate and hostname. These are experimental defaults, not production performance settings.

The proxy confines TCP destinations to validated addresses for enrolled hosts. It does not inspect TLS SNI or encrypted HTTP authority/path; therefore it does not establish application-level separation between services sharing an approved IP. Only the trusted native harness should reach it. Untrusted native tools must retain denied networking, and the standalone native sandbox command now passes that combined network check. App-server tools under authenticated execution still need qualification. This is not a general web-browsing gateway, public proxy, credential broker or malicious-harness containment claim.

## Evidence

Eight default tests exercise exact destination syntax, address classification, successful opaque traffic, checked-IP pinning, denied hosts/pipelining, mixed/private/malformed DNS, late DNS resolution, byte bounds and absolute timeout. Their dialer uses a loopback echo fixture; no public services are contacted by default checks.

The explicit container probe uses the real resolver/dialer and validates a TLS connection to `auth.openai.com` without logging in or sending credentials. Five denied proxy destinations return 403. Direct public TCP, external DNS and the tested bridge-address SSH connection fail. Network inspection confirms isolated mode and a single worker attachment; no worker mounts or published ports exist. The negative SSH result alone would not prove isolation; it accompanies the enforced network topology and successful proxy control.

Observed Docker Engine: 29.5.2, Linux ARM64 in the dedicated Colima VM. Latest qualified image: `sha256:b14d81cfb0e0a5b2612059e09985f009554f8b9b272dc3a5e92c57da27fe2751`. Run evidence lives under ignored `.local/m0/egress/<run-id>/`; summary `.local/m0/provider-egress.log`. Owned containers and network are removed after the probe. No provider account or stored credentials were used.

## Reproduce explicitly

Build the [M0 image](README.md) first. This command contacts the public provider TLS endpoint; it is separate from default tests:

```sh
node scripts/probe-provider-egress.mjs --context colima-agentmeld-m0
```

The script owns uniquely named containers/network, verifies topology, retains a sanitized result and attempts cleanup of every created resource even after failure. It does not start the VM or select a global Docker context. Start/stop the dedicated VM explicitly and restore its prior state after the qualification batch. Prepare and load the separate [Codex sandbox policy](codex-credential-boundary.md#reproduction) first; the worker uses that enforced profile and the script verifies prepared policy bytes.

## Next gates

Qualify native Codex's supported proxy configuration, managed device login, token refresh, streaming and cancellation through this topology. Persist credentials only through a reviewed, explicitly authorized dedicated setup, with the native filesystem-denial profile protecting them from tools. Test native tool networking while the harness has proxy access. Add persistent workspace disk quotas and sustained resource measurements. Account endpoints may require additional exact destinations; discover them with credential-free failures, record why, and never expand to wildcard access merely to make login pass.

No API-key fallback, host authentication-directory import or model invocation is introduced by this experiment. Newer code-mode models remain separately unqualified.


The extended run also invokes the pinned native `codex sandbox` command with tool networking disabled while its parent has the provider gateway path. The child fails to connect to both proxy and public address, while the parent TLS control succeeds. This is a standalone native sandbox check, not authenticated app-server execution.

Review correction: the first run tried to probe an isolated-network gateway that does not exist in Docker's network metadata, so that particular negative result was invalid. The script now asserts the absence of that gateway, resolves the real default-bridge host address, validates it before dispatch and tests that address. The successful rerun above supersedes the initial host-bridge claim. No rules were relaxed.
