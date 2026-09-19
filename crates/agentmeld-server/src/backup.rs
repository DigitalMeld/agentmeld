//! Online backup and restore for the SQLite journal.
//!
//! The journal lives at `<state-dir>/agentmeld.db` (WAL mode). `backup_db`
//! takes a consistent snapshot via `VACUUM INTO` without stopping the
//! server; `restore_db` validates a backup (readable + `integrity_check`)
//! and swaps it in, refusing while a server holds the startup lock.

use rusqlite::Connection;
use std::path::{Path, PathBuf};

/// Format a UTC timestamp as YYYYMMDD-HHMMSS for backup filenames, without
/// pulling in a date/time dependency.
pub fn utc_stamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    utc_stamp_for(secs)
}

fn utc_stamp_for(secs: u64) -> String {
    // Days since epoch -> civil date (Howard Hinnant's algorithm).
    let days = (secs / 86400) as i64;
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    let sod = secs % 86400;
    format!(
        "{:04}{:02}{:02}-{:02}{:02}{:02}",
        y,
        m,
        d,
        sod / 3600,
        (sod % 3600) / 60,
        sod % 60
    )
}

/// Default backup path: `<state-dir>/backups/agentmeld-<stamp>.db`.
pub fn default_backup_path(dir: &Path) -> Result<PathBuf, String> {
    let backups = dir.join("backups");
    std::fs::create_dir_all(&backups).map_err(|e| format!("create backups dir: {e}"))?;
    Ok(backups.join(format!("agentmeld-{}.db", utc_stamp())))
}

/// Take a consistent online snapshot of the database at `db_path` into `out`.
/// Safe to run while the server is serving: `VACUUM INTO` reads a consistent
/// snapshot including WAL content.
pub fn backup_db(db_path: &Path, out: &Path) -> Result<(), String> {
    if !db_path.exists() {
        return Err(format!(
            "no database at {}; nothing to back up",
            db_path.display()
        ));
    }
    if let Some(parent) = out.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create backup parent dir: {e}"))?;
        }
    }
    let conn = Connection::open(db_path).map_err(|e| format!("open database for backup: {e}"))?;
    let out_str = out
        .to_str()
        .ok_or_else(|| "backup path is not valid UTF-8".to_string())?;
    conn.execute("VACUUM INTO ?1", rusqlite::params![out_str])
        .map_err(|e| format!("backup failed: {e}"))?;
    Ok(())
}

/// Validate that `from` is a restorable backup: opens as SQLite and passes
/// `integrity_check`.
pub fn validate_backup(from: &Path) -> Result<(), String> {
    let check = Connection::open(from)
        .map_err(|e| format!("backup is not a readable SQLite database: {e}"))?;
    let ok: String = check
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|e| format!("integrity check failed: {e}"))?;
    if ok != "ok" {
        return Err(format!("backup failed integrity check: {ok}"));
    }
    Ok(())
}

/// Swap a validated backup into the state dir. Drops `-wal`/`-shm` sidecars
/// from the previous database incarnation. The caller must ensure no server
/// is running against `dir` first.
pub fn restore_db(dir: &Path, from: &Path) -> Result<PathBuf, String> {
    if !from.exists() {
        return Err(format!("backup not found: {}", from.display()));
    }
    validate_backup(from)?;
    let db_path = dir.join("agentmeld.db");
    std::fs::copy(from, &db_path).map_err(|e| format!("copy backup: {e}"))?;
    for ext in ["-wal", "-shm"] {
        let sidecar = db_path.with_extension(format!("db{ext}"));
        if sidecar.exists() {
            std::fs::remove_file(&sidecar).map_err(|e| format!("remove {ext}: {e}"))?;
        }
    }
    Ok(db_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stamp_format() {
        // 2026-09-19 14:43:50 UTC
        assert_eq!(utc_stamp_for(1789829030), "20260919-144350");
        // Epoch
        assert_eq!(utc_stamp_for(0), "19700101-000000");
        // Leap day
        assert_eq!(utc_stamp_for(1709251200), "20240301-000000");
    }

    fn seed_db(path: &Path) {
        let conn = Connection::open(path).unwrap();
        conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)", [])
            .unwrap();
        conn.execute("INSERT INTO t (v) VALUES ('hello')", [])
            .unwrap();
    }

    #[test]
    fn backup_roundtrip() {
        let dir = std::env::temp_dir().join(format!("am-backup-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("agentmeld.db");
        seed_db(&db_path);
        let out = dir.join("snap.db");
        backup_db(&db_path, &out).unwrap();
        // Backup is a valid, independent copy.
        validate_backup(&out).unwrap();
        let conn = Connection::open(&out).unwrap();
        let v: String = conn
            .query_row("SELECT v FROM t WHERE id = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, "hello");
        // Mutating the original doesn't affect the snapshot.
        let orig = Connection::open(&db_path).unwrap();
        orig.execute("DELETE FROM t", []).unwrap();
        let v2: String = conn
            .query_row("SELECT v FROM t WHERE id = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v2, "hello");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn backup_missing_db() {
        let dir = std::env::temp_dir();
        let err = backup_db(&dir.join("does-not-exist.db"), &dir.join("out.db")).unwrap_err();
        assert!(err.contains("nothing to back up"), "{err}");
    }

    #[test]
    fn restore_validates_before_copy() {
        let dir = std::env::temp_dir().join(format!("am-restore-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let bad = dir.join("bad.db");
        std::fs::write(&bad, b"not a database").unwrap();
        let err = restore_db(&dir, &bad).unwrap_err();
        assert!(
            err.contains("readable") || err.contains("integrity"),
            "{err}"
        );
        assert!(!dir.join("agentmeld.db").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn restore_roundtrip() {
        let dir = std::env::temp_dir().join(format!("am-restore2-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("src.db");
        seed_db(&src);
        let snap = dir.join("snap.db");
        backup_db(&src, &snap).unwrap();
        // Simulate a live db, then restore over it.
        let live = dir.join("agentmeld.db");
        seed_db(&live);
        let restored = restore_db(&dir, &snap).unwrap();
        assert_eq!(restored, live);
        let conn = Connection::open(&live).unwrap();
        let v: String = conn
            .query_row("SELECT v FROM t WHERE id = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, "hello");
        validate_backup(&live).unwrap();
        std::fs::remove_dir_all(&dir).ok();
    }
}
