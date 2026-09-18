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

This establishes a hard filesystem bound and persistence across container replacement. It does not establish power-loss durability, filesystem repair, whole-VM restart recovery, encrypted storage, aggregate host admission or a production quota API. Integrate the qualified storage boundary into the authenticated worker lifecycle with explicit owner capacity selection, retained-data backup/restore and low-space reporting. Keep the existing bind-mounted launcher's unbounded-disk limitation visible until that integration is verified. Model output cannot resize a workspace or attach a block device.
