use agentmeld_m0::artifact::{Archive, BLOB_LIMIT};
use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
static NEXT: AtomicU64 = AtomicU64::new(0);
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "agentmeld-artifact-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        Self(root)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}
#[test]
fn versions_reopen_with_verified_bytes_and_no_overwrite() {
    let f = Fixture::new();
    let root = f.0.join("archive");
    let store = Archive::open(&root).unwrap();
    let old = store.put(b"old").unwrap();
    let new = store.put(b"new").unwrap();
    assert_ne!(old.sha256, new.sha256);
    assert_eq!(old.sha256, store.put(b"old").unwrap().sha256);
    assert_eq!(
        fs::metadata(&root).unwrap().permissions().mode() & 0o777,
        0o700
    );
    assert_eq!(
        fs::metadata(root.join(&old.sha256))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    drop(store);
    let reopened = Archive::open(&root).unwrap();
    assert_eq!(reopened.get(&old.sha256).unwrap(), b"old");
    assert_eq!(reopened.get(&new.sha256).unwrap(), b"new");
    assert_eq!(fs::read_dir(root).unwrap().count(), 3); // two blobs and lock
}
#[test]
fn corrupt_and_symlinked_blobs_fail_without_replacement() {
    let f = Fixture::new();
    let root = f.0.join("archive");
    let store = Archive::open(&root).unwrap();
    let receipt = store.put(b"original").unwrap();
    fs::write(root.join(&receipt.sha256), b"changed").unwrap();
    assert!(store.get(&receipt.sha256).is_err());
    assert!(store.put(b"original").is_err());
    assert_eq!(fs::read(root.join(&receipt.sha256)).unwrap(), b"changed");
    fs::remove_file(root.join(&receipt.sha256)).unwrap();
    fs::write(f.0.join("outside"), b"synthetic").unwrap();
    symlink(f.0.join("outside"), root.join(&receipt.sha256)).unwrap();
    assert!(store.get(&receipt.sha256).is_err());
    assert!(store.put(b"original").is_err());
    assert_eq!(fs::read(f.0.join("outside")).unwrap(), b"synthetic");
    assert!(store.get("../outside").is_err());
}
#[test]
fn ownership_and_symlinked_root_or_lock_are_rejected() {
    let f = Fixture::new();
    let root = f.0.join("archive");
    let store = Archive::open(&root).unwrap();
    assert!(Archive::open(&root).is_err());
    drop(store);
    symlink(&root, f.0.join("alias")).unwrap();
    assert!(Archive::open(&f.0.join("alias")).is_err());
    fs::remove_file(root.join(".lock")).unwrap();
    symlink(f.0.join("outside"), root.join(".lock")).unwrap();
    assert!(Archive::open(&root).is_err());
}
#[test]
fn entry_and_blob_quotas_preserve_existing_results() {
    let f = Fixture::new();
    let store = Archive::open(&f.0.join("archive")).unwrap();
    assert!(store.put(&vec![0; BLOB_LIMIT + 1]).is_err());
    let receipt = store.put(b"original").unwrap();
    for n in 0..255 {
        store.put(n.to_string().as_bytes()).unwrap();
    }
    assert!(store.put(b"overflow").is_err());
    assert_eq!(store.get(&receipt.sha256).unwrap(), b"original");
    assert_eq!(store.put(b"original").unwrap().sha256, receipt.sha256);
}
#[test]
fn interrupted_staging_counts_toward_quota_and_is_preserved() {
    let f = Fixture::new();
    let root = f.0.join("archive");
    let store = Archive::open(&root).unwrap();
    let staging = root.join(".staging-interrupted");
    fs::write(&staging, vec![0; 16 * 1024 * 1024]).unwrap();
    assert!(store.put(b"next").is_err());
    assert_eq!(fs::metadata(staging).unwrap().len(), 16 * 1024 * 1024);
}
