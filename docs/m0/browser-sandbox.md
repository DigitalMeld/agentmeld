# M0 Chromium sandbox qualification

Date: 2026-09-17. Scope: pinned Linux ARM64 offline fixture in the dedicated development VM. This is not a hostile-workload or multi-tenant certification.

## Diagnosis

1. The original Docker-default run failed with `No usable sandbox`. A minimal `unshare --user --map-root-user true` invocation under the same non-root, no-capabilities, no-new-privileges controls failed with `Operation not permitted`.
2. The unmodified Playwright seccomp profile made that namespace invocation pass. Chromium then failed at `sys_chroot("/proc/self/fdinfo/")`. This separated the default namespace restriction from the capability-conditioned chroot filter.
3. Allowing the chroot syscall in the explicit browser policy made the complete fixture pass. All container capabilities remain dropped. A direct outer-container `chroot` still fails with `Operation not permitted`, while Chromium can establish its sandbox inside its own user namespace.
4. Reverting only the seccomp selection to Docker defaults reproduces the original browser failure. The same image and remaining runtime controls are used.

## Policy source and ownership

The [official Playwright guidance](https://playwright.dev/docs/docker) recommends a non-root user and a seccomp profile permitting namespace creation. The M0 setup downloads the upstream profile from [Playwright commit 1b025d7](https://github.com/microsoft/playwright/blob/1b025d7e20a026371cd5f98ba0cdce48892737c8/utils/docker/seccomp_profile.json), corresponding to version 1.63.0.

- Upstream SHA-256: `cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849`.
- Generated policy SHA-256: `1687636219aee3a7c27da967c7335bcc42ef6c0a93ec9597360f5ea8a2bff93d`.
- AgentMeld's one added rule permits the `chroot` syscall. Linux capability checks still apply. The rest of the upstream profile is preserved and default denial remains active.
- This configuration is owned by AgentMeld's experimental launcher; no installed dependency is patched and no upstream file is redistributed. Upstream has its own Apache-2.0 license.
- Reevaluate this rule whenever changing Chromium, Playwright, Docker, kernel, architecture or capabilities. Remove the local rule if an upstream profile satisfies the same tests with no capabilities. The generated file is not a general-purpose production security policy.

Permitting namespace syscalls increases the kernel interface reachable from a compromised container. Retaining the renderer sandbox provides another boundary, but the tradeoff needs review before processing untrusted content. No SYS_ADMIN or SYS_CHROOT container capability, privileged mode, host IPC, unconfined seccomp or `--no-sandbox` is used. The VM configuration is unchanged.

## Runtime checks

The probe obtains renderer process IDs through Chrome DevTools Protocol and reads their Linux status. For the observed renderer it asserts zero effective capabilities, no-new-privileges, seccomp filtering, more filters than the outer process, and a deeper PID namespace. The passing renderer had two filters and PID namespace depth three.

A DOM counter advances from zero to one after a real Playwright click. Its 1280 by 720 screenshot was visually inspected. The screenshot is an intentionally plain functional fixture, not proposed AgentMeld UI. Evidence is retained locally and ignored by Git.

The launcher verifies both the pinned upstream hash and exact generated policy before running. This guards accidental or deliberate file modification before validation; it does not protect against an attacker controlling the operator account or racing filesystem reads. The launcher remains a trusted-owner development tool.

## Reproduce

Follow the [M0 setup](README.md), including explicit policy preparation. Then run:

```sh
python3 scripts/probe-container.py --context YOUR_CONTEXT
python3 scripts/probe-container.py --context YOUR_CONTEXT --seccomp-profile docker-default
```

The first command should pass on the qualified environment; the second is the negative comparison and should fail at browser sandbox startup. Neither invokes inference or connects a messaging account.
