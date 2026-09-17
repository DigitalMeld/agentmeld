//! Bounded trusted-owner result archive. No automatic deletion or reconciliation.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{DirBuilderExt, OpenOptionsExt},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

pub const BLOB_LIMIT: usize = 512 * 1024;
const STORE_LIMIT: u64 = 16 * 1024 * 1024;
const ENTRY_LIMIT: usize = 256;
static NEXT: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Serialize)]
pub struct Receipt {
    pub sha256: String,
    pub bytes: usize,
}
pub struct Archive {
    root: PathBuf,
    _lock: File,
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn valid_id(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
impl Archive {
    pub fn open(root: &Path) -> Result<Self, String> {
        if !root.exists() {
            fs::DirBuilder::new()
                .mode(0o700)
                .create(root)
                .map_err(|_| "archive creation failed")?;
        }
        let meta = fs::symlink_metadata(root).map_err(|_| "archive metadata failed")?;
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err("archive must be an owned directory".into());
        }
        let lock_path = root.join(".lock");
        if fs::symlink_metadata(&lock_path)
            .is_ok_and(|m| !m.is_file() || m.file_type().is_symlink())
        {
            return Err("invalid archive lock".into());
        }
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .open(lock_path)
            .map_err(|_| "archive lock unavailable")?;
        lock.try_lock().map_err(|_| "archive already owned")?;
        File::open(
            root.parent()
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or(Path::new(".")),
        )
        .and_then(|f| f.sync_all())
        .map_err(|_| "archive parent sync failed")?;
        Ok(Self {
            root: root.to_path_buf(),
            _lock: lock,
        })
    }
    fn inventory(&self) -> Result<(usize, u64), String> {
        let mut count = 0;
        let mut bytes = 0u64;
        for entry in fs::read_dir(&self.root).map_err(|_| "archive inventory failed")? {
            let entry = entry.map_err(|_| "archive entry failed")?;
            if entry.file_name() == ".lock" {
                continue;
            }
            let meta =
                fs::symlink_metadata(entry.path()).map_err(|_| "archive entry metadata failed")?;
            if !meta.is_file() || meta.file_type().is_symlink() {
                return Err("invalid archive entry".into());
            }
            let name = entry.file_name();
            let name = name.to_str().ok_or("invalid archive name")?;
            if !valid_id(name) && !name.starts_with(".staging-") {
                return Err("unknown archive entry".into());
            }
            count += 1;
            bytes = bytes
                .checked_add(meta.len())
                .ok_or("archive size overflow")?;
            if count > ENTRY_LIMIT || bytes > STORE_LIMIT {
                return Err("archive quota exceeded".into());
            }
        }
        Ok((count, bytes))
    }
    pub fn get(&self, id: &str) -> Result<Vec<u8>, String> {
        if !valid_id(id) {
            return Err("invalid artifact digest".into());
        }
        let path = self.root.join(id);
        let meta = fs::symlink_metadata(&path).map_err(|_| "artifact unavailable")?;
        if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > BLOB_LIMIT as u64 {
            return Err("invalid artifact file".into());
        }
        let mut bytes = Vec::new();
        File::open(path)
            .map_err(|_| "artifact open failed")?
            .take((BLOB_LIMIT + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| "artifact read failed")?;
        if bytes.len() > BLOB_LIMIT || digest(&bytes) != id {
            return Err("artifact integrity mismatch".into());
        }
        Ok(bytes)
    }
    pub fn put(&self, bytes: &[u8]) -> Result<Receipt, String> {
        if bytes.len() > BLOB_LIMIT {
            return Err("artifact size limit".into());
        }
        let id = digest(bytes);
        let destination = self.root.join(&id);
        let (count, total) = self.inventory()?;
        if fs::symlink_metadata(&destination).is_ok() {
            if self.get(&id)? != bytes {
                return Err("artifact conflict".into());
            }
            File::open(&destination)
                .and_then(|f| f.sync_all())
                .map_err(|_| "artifact sync failed")?;
            self.sync()?;
            return Ok(Receipt {
                sha256: id,
                bytes: bytes.len(),
            });
        }
        if count >= ENTRY_LIMIT || total + bytes.len() as u64 > STORE_LIMIT {
            return Err("archive quota exceeded".into());
        }
        let staging = self.root.join(format!(
            ".staging-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&staging)
            .map_err(|_| "artifact staging failed")?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "artifact write failed")?;
        // Hard-link promotion fails if the destination exists; never replace retained bytes.
        fs::hard_link(&staging, &destination).map_err(|_| "artifact promotion failed")?;
        self.sync()?;
        fs::remove_file(&staging).map_err(|_| "artifact staging cleanup failed")?;
        self.sync()?;
        Ok(Receipt {
            sha256: id,
            bytes: bytes.len(),
        })
    }
    fn sync(&self) -> Result<(), String> {
        File::open(&self.root)
            .and_then(|f| f.sync_all())
            .map_err(|_| "archive directory sync failed".into())
    }
}
