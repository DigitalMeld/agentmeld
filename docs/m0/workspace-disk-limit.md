# Workspace disk-limit qualification

Updated: 2026-09-18. Fixed-size filesystem experiment passes; the normal bind-mounted worker launcher is not yet replaced by a production volume manager.

## Boundary and evidence

The dedicated M0 VM creates a new 64 MiB sparse backing file, formats it as ext4, attaches one free loop device and mounts it through a uniquely named Docker local volume. This confines filesystem growth to the backing-file capacity. The trusted operator performs setup in the VM; the worker receives only `/workspace`, never a block device or mount capability. The volume uses `nodev,nosuid`; the root filesystem is read-only and `/tmp` is separately bounded.

A fixed offline initializer sets the volume directory's owner to UID/GID 1000. Only this initializer uses root and CHOWN; qualification workers remain non-root, offline and without capabilities. Formatting targets only the newly created task-owned backing file, never an existing host disk or retained workspace.

On image `sha256:3b205a247945f54798b053bf02cf1ca51b3f0145d5652319c2b55f16c15e1276`, the first worker persisted a marker, filled its own data file until the filesystem returned `ENOSPC`, read the marker unchanged, removed only the filler and successfully wrote a recovery marker. A second container read both retained files. The backing file remained exactly 67,108,864 bytes; ext4 reported 58,675,200 usable filesystem bytes and the filler reached 57,307,136 bytes before the limit. Filesystem metadata accounts for capacity below the raw backing-file size; do not promise the nominal size as usable document space.

The fixture write loop itself is capped at 128 MiB and the filesystem capacity is checked before filling. Evidence remains under ignored `.local/m0/quota/`; summary `.local/m0/workspace-quota.log`. Cleanup verifies the owned volume label, device and backing-file association before removing the fixture. Post-run inventory showed no Docker volumes or loop devices remaining in the dedicated VM.

## Reproduction

Start the dedicated M0 VM and build the [M0 image](README.md), then run:

```sh
node scripts/probe-workspace-quota.mjs --context colima-agentmeld-m0
```

The script intentionally accepts only this dedicated Colima context. It requires existing `mkfs.ext4`, `losetup` and `truncate` inside the VM; no packages or host services are installed. It owns and removes its synthetic data, containers, volume, loop mapping and temporary VM directory. Identity-check failures retain ambiguous resources for operator inspection rather than deleting them blindly.

## Remaining work

This establishes a hard filesystem bound and persistence across container replacement. It does not establish power-loss durability, filesystem repair, whole-VM restart recovery, encrypted storage, aggregate host admission or a production quota API. Extend the authenticated experiment below into a production lifecycle with explicit owner capacity selection, retained-data backup/restore and low-space reporting. Keep the existing bind-mounted launcher's unbounded-disk limitation visible until that integration is verified. Model output cannot resize a workspace or attach a block device.

## Authenticated worker integration

Verified 2026-09-18: the existing quota owner can now run the subscription worker against the same bounded filesystem. Use the explicit mode below; the default remains offline.

```sh
node scripts/probe-workspace-quota.mjs --context colima-agentmeld-m0 --subscription
```

The run first repeats disk-full, retained-file preservation, recovered writes and replacement readback. A live GPT-5.5 worker then writes a random workspace marker and persists its native conversation. That worker and its proxy/network are removed. A new worker with a new proxy/network mounts the same workspace and separate authorized credential volume, resumes the thread, reads the marker with a native command and returns a conversation-only nonce without receiving it in the new prompt. Native command events, host readback and exact response content are checked. The original disk-full/recovery files remain unchanged throughout.

Both authenticated workers verify ext4 capacity is above 32 MiB and no more than 64 MiB. The observed capacity remains 58,675,200 bytes inside a 67,108,864-byte backing file. The driver validates the exact generated volume name/instance label, local driver, ext4 loop-device source and `nodev,nosuid` options; worker inspection verifies only the workspace and dedicated credential mounts. Unit coverage rejects foreign identities, non-loop devices, different drivers and altered mount options.

The credential/home volume remains separate and denied to native child tools. Only synthetic thread identifiers and a nonce are stored in the protected home for the replacement check; no credential values enter reports. The quota owner removes only its disposable workspace volume/backing file after both workers finish, using the existing identity checks. It preserves the authorized credential store.

Evidence: `.local/m0/live-workspace.log` and the per-run records under `.local/m0/quota/` and `.local/m0/egress/`. Both live stages report `qualified: true`; the second reports `conversationPreserved: true`. Disk-full is induced by the bounded offline fixture before live inference, not by a model-controlled fill operation. This closes bounded workspace integration for the tested authenticated lifecycle, not whole-VM restart, power-loss durability or a production volume manager.

Authenticated integration image: `sha256:e3b83ac30199b998515fac528cd349a4b5b6b35b9e88df190d4ed2287ae26818`. All 185 default local tests plus formatting, lint, build and documentation checks pass.

## Controlled VM restart

Verified 2026-09-18 on image `sha256:5935ec3e3ede08620649e9aad2c657699f729233e3ce7d0c6b4149e47d03d754`: a live subscription-backed workspace and its native conversation survive a controlled restart of the dedicated M0 VM.

```sh
node scripts/probe-workspace-quota.mjs --context colima-agentmeld-m0 --subscription --restart-vm
```

The explicit flag requires subscription mode and the dedicated context. Before restart it requires zero running or stopped containers, verifies the prepared sandbox policies and the exact owned volume/backing-file association, and writes an ignored local recovery-intent record. It removes only disposable Docker mount metadata, detaches that fixture's loop device and preserves the ext4 backing file and separate native credential/home volume. The named AppArmor profile is unloaded for shutdown and the same verified policy is loaded after startup. No agent executes during that transition.

After restart, the VM boot ID must differ, while Docker engine ID, immutable image ID, ext4 UUID and 67,108,864-byte backing size must match. The driver explicitly reattaches the same backing filesystem to a loop device and recreates its owned volume metadata with the same instance label and constrained options. It does not assume that a loop-device number remains stable across boots. If this recovery sequence fails, it retains the fixture backing and recovery-intent record for inspection.

A new authenticated worker then resumes the original native conversation. Its command reads the retained marker, and its response reproduces the conversation-only nonce without receiving that nonce in the new prompt. Existing disk-full/recovery files remain intact and measured filesystem capacity remains 58,675,200 bytes. Native account/model admission, credential-file tool denial and restricted provider egress are rechecked by the replacement worker. The probe never logs out, reimports or removes the authorized credential store.

The explicit run passed both live stages and all six VM identity/reattachment assertions. Cleanup removed the disposable quota volume, loop mapping and backing file; direct Docker readback showed no containers and only the retained auth volume. Sanitized evidence is in ignored `.local/m0/vm-recovery.log` and `.local/m0/quota/`. All 194 local tests pass (18 Rust, 170 Node, six Python), including rejection of unchanged boot identity or changed engine/image/filesystem/bound, plus formatting, lint, build and documentation checks.

This supersedes the earlier unqualified whole-VM restart statement only for controlled shutdown and explicit reattachment. Sudden power loss, filesystem repair, unattended production recovery, an in-flight command at reboot, host macOS reboot and general backup/restore remain unqualified. The original container-replacement and resource measurements retain their original image bindings.
