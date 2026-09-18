# M0 build storage

## Cleanup on 2026-09-18

The Codex patch build, builder snapshots and accumulated historical M0 images
exhausted the dedicated VM Docker disk and increased host disk use. This was
build-artifact accumulation, not credential or retained workspace data.
Qualification stopped for cleanup at the owner's request.

The cleanup inventoried 393 images in `colima-agentmeld-m0`. It selected 376
obsolete images whose history identified AgentMeld or the disposable Codex
builder. Non-forced removal succeeded for 360 entries; the remaining entries
were already removed through parent cleanup or protected by retained image
dependencies. No global prune or volume deletion was used.

Removed:

- All four stopped Codex lock/build diagnostic containers.
- Obsolete AgentMeld image histories, Codex 0.155.0 comparison and disposable
  source-builder images, including their unused Rust base.
- Failed packaging layers, disposable compilation cache and duplicate host
  binaries. The source patch and compact logs are retained.

Preserved and read back:

- Selected runtime: `sha256:298ed6c47730346bc6c563a9c9857302623e547ffccb4a869b735d0070bd1f68`.
- One experimental patch runtime: `sha256:fdd0e186168169deb31435a37bbe11771960804a40b3193149bbe996c750bc26`.
- `agentmeld-m0-codex-auth`, retained workspaces, source changes and evidence.

Docker reported zero containers and 4.05 GB of shared image storage before the
unused Rust base was removed. Trimming freed guest filesystem blocks returned
approximately 14 GiB to the host; host free space rose from approximately 3 GiB
to 17 GiB after trimming and approximately 19 GiB after cleanup settled.
The restored VM configuration exactly matches its original backup, including
4 GiB memory. Final readback: zero containers, 12 image records sharing 4.05 GB,
one preserved credential volume. Image sizes include shared layers and must not be added together.
Detailed inventory and deletion outcomes remain in ignored `.local/m0/cleanup/`.

## Subsequent build cycles

1. Check both host free space and VM Docker filesystem space before compilation,
   image export, packaging and tests. Budget for peak temporary copies and a
   reserve, not only the final binary size.
2. Use one reusable disposable build cache. Do not snapshot a compiled target
   directory into multiple images. Keep the selected runtime and at most one
   active qualification candidate.
3. Record container and image IDs when creating them. Remove obsolete task-owned
   artifacts at each build checkpoint and after failures, retaining compact logs,
   source revision, patch digest and reproducible commands.
4. Never remove credential volumes, retained workspaces, unrelated caches or
   ambiguous images to obtain space. Avoid global Docker prune commands.
5. Trim freed guest blocks so reclaimed VM space actually returns to the host.
   Read back disk usage and retained image/volume identity after cleanup.
6. Restore temporary VM resource changes after the build cycle. Retain a backup
   of the original configuration and verify unrelated settings are unchanged.

The [Codex patch](codex-command-event-patch.md) remains partially qualified. Cleanup
resolves the immediate storage pressure; it does not establish full upstream qualification or activate the candidate.
The corrected regression and explicit terminal-cleanup evidence are recorded
in the patch qualification document.

## Regression-build cleanup readback

After the final upstream regression run, the disposable regression container,
test-builder image and duplicate control-probe image were removed. The VM was
restored from 8 GiB to 4 GiB; its configuration byte-matches the original backup,
and the named AppArmor policy was reloaded. Host free space rose from about
20 GiB to 28 GiB during cleanup.

**Unexpected retention failure:** after the VM restart, Docker reports zero
images and zero containers, including the baseline and candidate intended to
remain. The credential volume `agentmeld-m0-codex-auth` remains present.
No global prune or volume deletion was issued in this cleanup. The precise
cause of the missing retained images is unestablished; do not count their space
as intentional reclamation or claim the local runtime is ready.

Source, final patch, digest and compact qualification logs remain. No local
image archive or retained standalone candidate binary was found in the inspected
patch-build directories. Restore the baseline and rebuild the pinned candidate
before further runtime qualification; verify image retention across VM restart.
This is an additional M0 operational gap.
