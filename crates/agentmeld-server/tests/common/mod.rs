// Shared test harness: a throwaway Db with migrations + bootstrap rows.
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use agentmeld_server::db::Db;

static COUNTER: AtomicU64 = AtomicU64::new(0);

pub fn test_db() -> (Arc<Db>, PathBuf) {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir: PathBuf =
        std::env::temp_dir().join(format!("agentmeld-test-{}-{}", std::process::id(), n));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let blob_root = dir.join("blobs");
    let db = Db::open(&dir.join("test.db"), &blob_root).expect("open db");
    db.run_migrations().expect("migrations");
    db.seed_bootstrap().expect("bootstrap");
    (Arc::new(db), dir)
}

#[allow(dead_code)]
pub fn cleanup(dir: &PathBuf) {
    let _ = std::fs::remove_dir_all(dir);
}
