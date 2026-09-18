# Worker evidence after process replacement

Date: 2026-09-18. Status: qualified local experiment; not whole-machine recovery or remote worker authentication.

## Change

Previously, recovery assessment obtained inventory through an `OwnedWorker` object retained in the original host process. The new host-owned record stores a version, immutable container ID, workspace and Docker engine ID before dispatch. A separate process can load this record and observe the original worker without inheriting the old object. The observer cannot execute tools, stop workers or grant access.

Engine identity is checked before and after each fresh inventory lookup. An unavailable engine, wrong engine, changing identity or malformed inventory yields `unavailable`, never `absent`. Presence uses the full immutable container ID, not a name. A matching engine's absent worker still says nothing about an external action's outcome; existing recovery review remains required.

The record is create-only, mode 0600, flushed before use and stored outside the worker mount. Loading rejects symlinks, hard links, non-regular files, other owners, broad permissions, oversized input and invalid schema. These checks assume trusted host storage and Docker transport. This is not cryptographic runtime attestation, protection from the host owner, or power-loss durability; parent directory durability and storage rollback remain unqualified. No new dispatch authority is reconstructed.

## Commands

The explicit cancellation probe saves the binding before dispatch, starts uncooperative child/grandchild heartbeat fixtures, and calls the recovery CLI in a fresh process before and after cancellation:

```sh
node scripts/probe-cancellation.mjs --context YOUR_CONTEXT
```

An existing record can be assessed explicitly:

```sh
node scripts/review-recovery.mjs --recover \
  --journal EXISTING_JOURNAL --archive EXISTING_ARCHIVE \
  --request RECOVERY_REQUEST_JSON \
  --worker-record WORKER_RECORD_JSON --context YOUR_CONTEXT
```

Both optional worker arguments are required together. Scope mismatch is rejected before acquiring the journal. The CLI acquires exclusive journal ownership and appends the normal recovery snapshot; it does not settle, retry, resume or stop work. It can still operate without a worker record, reporting worker evidence as not checked.

## Evidence

Six new local tests cover engine changes, malformed inventories, scope binding and record preservation/validation. The explicit real-container probe passed with reconstructed `present` evidence before stop and `absent` afterward. Pending saved output remained pending; cancelled state survived reconstruction; reviewed output remained distinct from normal settlement after a further restart.

The run on rebuilt image `sha256:4445999cd5f837ecfee6f6d7f9131ccfda629bfb0dad1ace7fccaac642932028` is retained under ignored `.local/m0/control/`, with the latest summary in `.local/m0/fresh-recovery-probe.log`. No inference, credentials or user documents were involved. This replaces the in-memory observation dependency for this assessment path; it does not recover a live browser transport or authenticate a remote worker.
