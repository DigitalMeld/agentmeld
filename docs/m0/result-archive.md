# M0 durable tool result archive

Date: 2026-09-17. Scope: trusted host storage for validated native-tool results, tested with synthetic data. This is not a production artifact service or an atomic database transaction.

## Storage and ordering

Rust now implements a content-addressed archive using the existing standard library and SHA-256 dependency. `artifact-put DIRECTORY` consumes bounded bytes from stdin and returns a digest/size receipt. `artifact-get DIRECTORY SHA256` verifies the stored hash before returning bytes. Neither command invokes a provider or tool.

New directories use mode 0700 and files use 0600. A process-lifetime exclusive lock serializes archive operations. Writes stage and sync bytes, promote with a hard link that cannot replace an existing destination, sync the directory, remove the successful staging file, and sync again before acknowledgement. Exact repeated content reuses verified bytes; changed content has a different digest. Corrupt existing content is rejected rather than overwritten.

Admission limits are 512 KiB per result envelope, 16 MiB per archive and 256 retained entries. Interrupted staging files count against quotas and are preserved. Unknown entries and symlinks prevent new writes. There is no automatic cleanup, eviction or repair of retained results.

The host adapter stores a versioned JSON envelope containing the validated value, exact action, full approval scope and dispatch ticket. Readback checks the receipt, schema, tool result and every expected scope field. The native probe places the archive under its protected host control directory, outside container mounts. Its nine callback scenarios save and read back each successful result through separate Rust processes; denied/invalid outcomes produce no success receipt.

The broker orders operations as dispatch, execution, result validation, archive acknowledgement, then journal settlement. Archive failure withholds success and pauses the controller with an unsettled dispatch. A saved result followed by failed settlement remains evidence of returned output, not proof of completion. `lastResult` is populated only after settlement and cleared at the next decision. Older fixture callers without an archive retain their original behavior; the native probe always configures one.

## Settled-result index and recovery

Journal format 5 persists the archive receipt, dispatch ticket, canonical action digest and scope digest in the same synced snapshot that clears the pending action. Archive-enabled proposals set `result_required`; Rust rejects settlement without a bounded, well-formed reference. The index retains at most 64 entries and blocks further approval proposals at capacity without evicting history. Existing request-ledger and journal-byte limits also remain in force.

`ResultArchive.readSettled(authority, scope)` locates the result from the durable index, reads and verifies its bytes, and checks its envelope against the persisted ticket, action and full scope. It works after supervisor replacement without an in-memory receipt. The Rust journal trusts the host adapter to save the blob; it validates reference shape and transition binding, not blob existence. Retrieval refuses missing, corrupt or mismatched content.

Crash before settlement leaves saved bytes as unresolved evidence and does not expose them through settled retrieval. Crash after settlement, including a lost acknowledgement, retains the index entry and allows readback without tool re-execution. Result history is append-only; reopening rejects removal, replacement or additions without a preceding matching dispatched action. These are structural checks, not protection against a malicious storage owner.

Seven new subprocess tests cover SIGKILL/retrieval, required references, unsettled output, lost acknowledgements, history corruption and old-format rejection, capacity, and action/ticket mismatches. The native probe now replaces the supervisor after each successful tool and verifies its output through the index.

## Verification

The default suite passes 107 tests (18 Rust, 87 Node, 2 Python), formatting, Clippy, build and documentation checks. Five new Rust tests cover versions/readback, corruption and symlinks, exclusive ownership, quotas and preserved staging evidence. Five new subprocess tests cover replacement/scope checks, save-before-settle ordering, storage failure, lost settlement and denied/invalid output.

The five archive subprocess cases and seven settlement-index cases also pass against the Linux ARM64 binary with Docker-default seccomp:

```sh
python3 scripts/probe-container.py --context YOUR_CONTEXT --probe archive --seccomp-profile docker-default --workspace archive-linux
node scripts/probe-native.mjs --context YOUR_CONTEXT
```

Linux qualification exposed and fixed a read-only subprocess pipe-close race; write-side input errors still fail the operation. Native callback qualification, native startup/browser, separated supervisor, cancellation and Linux recovery also pass on local image `sha256:edcb333300d04fb0a1f2b766d42d9fcd9e729ca4d12b3923733fbf0593424db3`. No image was published, model invoked or personal file accessed. Evidence remains under ignored `.local/m0/control/` and `.local/m0/evidence/`.

## Limits and next action

The directory and its parents must be owned by the trusted supervisor. Symlink checks do not protect against a malicious directory owner racing path replacement. Scope checks are binding checks for trusted callers, not user authentication or an ACL. Content hashes detect corruption but do not authenticate a compromised worker or host. Files are immutable through this interface, not against their OS owner.

Journal format 5 is intentionally incompatible with earlier fixture journals. Old files are preserved and rejected; no automatic migration is attempted. Archive envelopes remain version 1 and can still be inspected separately. Archive bytes and journal writes are not one filesystem transaction, but settlement and its reference share one journal record. There is no production artifact API, authenticated retrieval endpoint, automatic reconciliation, retention workflow or backup/restore service. A lost acknowledgement must not trigger tool re-execution. Preserve staged/unsettled evidence for explicit reconciliation.

Power-loss durability and filesystem fault injection remain unqualified. Linux subprocess tests use tmpfs; protected native-probe archives use the host filesystem. Unix file locking and permissions are tested on macOS and Linux only. The archive stores all tool-result data supplied by the configured trusted caller, so production privacy/retention and artifact authorization need separate design before use with personal data.

Next: authenticated artifact retrieval, explicit reconciliation and task/event integration. Preserve existing approval/restart boundaries and retain unresolved archive evidence.
