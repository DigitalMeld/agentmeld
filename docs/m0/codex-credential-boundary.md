# Native command credential boundary

Updated: 2026-09-18. Offline qualification passed for Codex 0.154.0 on Linux ARM64. Real credential storage and subscription inference remain unqualified.

## Problem and policy

The browser seccomp profile rejected Bubblewrap mount setup. Adding its required mount syscalls exposed Docker AppArmor's independent blanket mount denial. Disabling either control is not the solution.

`scripts/prepare-codex-policy.py` prepares a separate named `agentmeld-m0-codex` profile from the checksum-verified [Moby v28.0.4 template](https://github.com/moby/moby/blob/v28.0.4/profiles/apparmor/template.go). It retains other upstream denials and replaces blanket mount denial with rules for the pinned Bubblewrap setup paths and flags. Its paired deny-default seccomp adds `mount`, `umount2` and `pivot_root` to the existing verified browser policy. This expands the permitted syscall surface and requires further security qualification before production use. Docker's default profiles are unchanged.

The setup follows the pinned [Codex sandbox implementation](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/linux-sandbox/src/bwrap.rs) and [Bubblewrap source](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/vendor/bubblewrap/bubblewrap.c). Prepared policy bytes are verified before launch. The reported AppArmor source hash is not an attestation of loaded kernel rules; the trusted VM operator must load the matching source.

## Verified behavior

The probe creates a random synthetic canary under a temporary dedicated Codex home. A named filesystem permission profile denies that home, permits workspace writes and disables tool networking. The parent probe reads the canary as a positive control.

Both standalone `codex sandbox` and a real app-server `exec_command` then fail to read it through four paths: direct path, workspace symlink, outer-process proc-root path and self proc-root path. Each successfully writes a fresh result to the workspace. The synthetic model completes two Responses requests and receives native tool output. Unexpected approval/escalation requests are rejected.

The outer process reports the named AppArmor profile in enforce mode. Outer and child effective capabilities are zero, with no-new-privileges and seccomp filtering enabled. The entire container remains offline. No host credential directories are mounted, no login occurs and no model service is called.

Evidence remains ignored under `.local/m0/`: `codex-boundary-native.log`, `check-codex-boundary.log`, run-specific `evidence/` reports and disposable workspace fixtures.

| Input | Qualified value |
| --- | --- |
| Image | `sha256:1ae1b4d40db224d6bb56101e9c4d68393959e23a3bceb31a3a5c6a74b65d4388` |
| Seccomp bytes | `f83a12f2118b84e27e85c075a587d655d3538df0e52762414f2ba808c9af3225` |
| Prepared AppArmor bytes | `dff3fe377e911c14fc42803be051ae127623924464bf8225cc8b85ec9fa35645` |
| Default local checks | 18 Rust, 133 Node, 6 Python tests; formatting, Clippy, build and docs checks |

## Reproduction

Use only the dedicated M0 VM. Policy preparation does not load rules or change defaults. Build the image as documented in the [M0 guide](README.md) and then run:

```sh
python3 scripts/prepare-seccomp.py
python3 scripts/prepare-codex-policy.py
colima start agentmeld-m0 --activate=false
colima ssh --profile agentmeld-m0 -- sudo apparmor_parser -a < .local/m0/seccomp/agentmeld-m0-codex.apparmor
python3 scripts/probe-container.py --context colima-agentmeld-m0 --probe codex-boundary --seccomp-profile codex --workspace boundary-native
```

After verifying no remaining probe containers, unload only this temporary named profile and restore the VM's previously stopped state:

```sh
docker --context colima-agentmeld-m0 ps -a
colima ssh --profile agentmeld-m0 -- sudo apparmor_parser -R < .local/m0/seccomp/agentmeld-m0-codex.apparmor
colima stop agentmeld-m0
```

## Remaining gates

This is a bounded credential-read canary experiment, not an escape audit or proof for every built-in tool. Native file tools, credential modification/exfiltration paths, persistent login storage, token refresh/logout, login/inference egress and subscription-backed execution remain open. The command result proves workspace writes, not credential write protection. Do not introduce real credentials until the remaining access paths and storage design are qualified.

Next work: expand native-tool access tests, then implement the dedicated storage and bounded network path. Keep owner login as a separate explicit step and redact authentication material from all retained evidence. The [exit checklist](exit-checklist.md) remains the authoritative M0 status.
