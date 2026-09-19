# Server robustness: backup/restore CLI, corruption, shutdown, lease contention (issue #115)

## What changed

**Backup/restore CLI** (`crates/agentmeld-server/src/backup.rs`, wired in `main.rs`):
- `agentmeld-server backup [--dir DIR] [--out FILE]` — online snapshot via
  `VACUUM INTO`, safe while the server is serving (consistent snapshot
  including WAL content). Default: `<dir>/backups/agentmeld-YYYYMMDD-HHMMSS.db`.
- `agentmeld-server restore --from FILE [--dir DIR]` — validates the backup
  first (`PRAGMA integrity_check`; refuses to touch the live DB on failure),
  refuses while a server holds the startup lock (live PID check), swaps the
  file in and drops stale `-wal`/`-shm` sidecars.
- Core logic lives in the `backup` lib module with 5 unit tests
  (roundtrip, snapshot isolation, missing DB, corrupt-backup refusal).

**Corruption behavior**: `Db::open` already failed loudly instead of
starting empty; `cmd_serve` now wraps the error with the DB path and the
exact restore command. Verified: corrupt byte at offset 100 →
`agentmeld-server: open database ...: set WAL: database disk image is malformed`
+ restore hint, non-zero exit, no silent empty start.

**Graceful shutdown**: `axum::serve(...).with_graceful_shutdown(...)` drains
in-flight requests on SIGTERM/SIGINT, then `Db::checkpoint()`
(`PRAGMA wal_checkpoint(TRUNCATE)`) runs and a `[serve] WAL checkpointed;
shutdown complete` line is logged. Verified: no `-wal`/`-shm` left behind.

**Lease contention** (`scripts/e2e_lease_contention.py`, 5/5 green in
headless Firefox):
- Browser A pairs and takes the controller lease.
- Browser B pairs and seizes it via takeover — succeeds, generation bumps.
- Browser A learns about the takeover over the live SSE stream
  (`lease.takeover` → `pollLease()`); its pill flips from "Controlling on
  this device" to "Controlled by another device" with no manual refresh.

## Verification

- `cargo test -p agentmeld-server --lib backup`: 5/5 green.
- Manual disaster-recovery cycle: seed → backup (online) → corrupt DB →
  clear error → restore → boot with identical state (runs, conversations,
  integrity ok).
- `scripts/e2e_lease_contention.py`: 5/5 green.
- `sh scripts/check-local.sh`: green.

## Notes / traps

- `VACUUM INTO` on the live DB is the right primitive: it blocks writers
  briefly but yields a consistent snapshot; no need to stop the server.
- `restore` refuses on a *live* lock only; a stale lock file (dead PID) is
  treated as no server, matching `acquire_startup_lock`'s reclaim behavior.
- The `utc_stamp` helper avoids a chrono dependency (Howard Hinnant's
  civil-date algorithm over `SystemTime`).
