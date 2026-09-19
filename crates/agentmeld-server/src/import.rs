// One-time state.json importer.
//
// Reads the PoC's state.json (format 1: tasks only; format 2: tasks plus
// conversations), validates every record before writing anything, backs the
// source up with a timestamped copy plus a SHA-256/size manifest, imports
// into a staging database, and atomically promotes the staging database
// into place. Public IDs are preserved verbatim: the legacy task id becomes
// the run id.
//
// The source must be quiesced: tasks still in flight (running/cancelling)
// halt the import with a precise error instead of being guessed at. Unknown
// statuses and ambiguous records halt the same way.

use std::path::Path;

use crate::db::{
    Db, LegacyBundle, LegacyConversation, LegacyEvent, LegacyFile, LegacySession, LegacyTask,
    LegacyWorkspaceEntry,
};
use crate::domain::{milestone_label, sha256_hex};

/// Format-2 extras per conversation: (conversation_id, workspace entries)
/// and (conversation_id, provider session).
pub(crate) type ConversationExtras = (
    Vec<(String, Vec<LegacyWorkspaceEntry>)>,
    Vec<(String, LegacySession)>,
);

pub fn run_import(state_dir: &Path, from: &Path) -> Result<(), String> {
    let bytes = std::fs::read(from).map_err(|e| format!("read {}: {e}", from.display()))?;
    let source_digest = sha256_hex(&bytes);
    let source_size = bytes.len();

    // Live-database guards first: the import is one-time.
    let live_db_path = state_dir.join("agentmeld.db");
    if live_db_path.exists() {
        let live = open_live(&live_db_path, state_dir)?;
        if live.has_import_receipt(&source_digest)? {
            println!("state.json (sha256:{source_digest}) was already imported; skipping.");
            return Ok(());
        }
        if live.count_runs()? > 0 {
            return Err(
                "the target database already contains runs; the state.json import is one-time"
                    .to_string(),
            );
        }
        if live.count_devices()? > 0 {
            return Err("the target database already has enrolled devices; the state.json import is one-time".to_string());
        }
    }

    let text = String::from_utf8(bytes.clone())
        .map_err(|_| "state.json is not valid UTF-8".to_string())?;
    let bundle = load_bundle(&text, &source_digest)?;

    // Timestamped backup plus manifest, before any database writes.
    let backup_dir = state_dir.join("backups");
    std::fs::create_dir_all(&backup_dir).map_err(|e| format!("create backups dir: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&backup_dir, std::fs::Permissions::from_mode(0o700)).ok();
    }
    let stamp = backup_stamp();
    let short = &source_digest[..16];
    let backup_path = backup_dir.join(format!("state-{stamp}-{short}.json"));
    std::fs::write(&backup_path, &bytes).map_err(|e| format!("write backup: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&backup_path, std::fs::Permissions::from_mode(0o600)).ok();
    }
    let manifest = serde_json::json!({
        "source": from.display().to_string(),
        "sha256": source_digest,
        "bytes": source_size,
        "backup": backup_path.display().to_string(),
        "imported_at": stamp,
        "conversations": bundle.conversations.len(),
        "tasks": bundle.tasks.len(),
    });
    std::fs::write(
        backup_dir.join(format!("state-{stamp}-{short}.manifest.json")),
        serde_json::to_string_pretty(&manifest).unwrap_or_default(),
    )
    .map_err(|e| format!("write manifest: {e}"))?;

    // Stage into a fresh database file; blobs go straight to the final blob
    // root (content-addressed, so a failed import's orphans are harmless and
    // a retry writes identical bytes).
    let staging_path = state_dir.join(".staging-import.db");
    let _ = std::fs::remove_file(&staging_path);
    let _ = std::fs::remove_file(state_dir.join(".staging-import.db-wal"));
    let _ = std::fs::remove_file(state_dir.join(".staging-import.db-shm"));
    let blob_root = state_dir.join("blobs");
    std::fs::create_dir_all(&blob_root).map_err(|e| format!("create blob root: {e}"))?;
    let staging = Db::open(&staging_path, &blob_root)?;
    staging.run_migrations()?;
    staging.seed_bootstrap()?;
    staging.import_legacy(&bundle)?;
    // Checkpoint the WAL back into the main file so the rename below moves a
    // self-contained database.
    staging.checkpoint_and_compact()?;
    drop(staging);

    std::fs::rename(&staging_path, &live_db_path)
        .map_err(|e| format!("promote staging database: {e}"))?;
    let _ = std::fs::remove_file(state_dir.join("agentmeld.db-wal"));
    let _ = std::fs::remove_file(state_dir.join("agentmeld.db-shm"));
    println!(
        "imported {} conversation(s) and {} task(s) from {} (sha256:{source_digest})",
        bundle.conversations.len(),
        bundle.tasks.len(),
        from.display(),
    );
    Ok(())
}

fn open_live(live_db_path: &Path, state_dir: &Path) -> Result<Db, String> {
    let blob_root = state_dir.join("blobs");
    let db = Db::open(live_db_path, &blob_root)?;
    db.run_migrations()?;
    Ok(db)
}

fn backup_stamp() -> String {
    // UTC timestamp; fall back to process time when the clock is unavailable.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{now}")
}

// ------------------------------------------------------- parse + validate.

fn parse_and_validate(text: &str, source_digest: &str) -> Result<LegacyBundle, String> {
    let v: serde_json::Value =
        serde_json::from_str(text).map_err(|e| format!("state.json is not valid JSON: {e}"))?;
    let obj = v.as_object().ok_or("state.json must be a JSON object")?;
    let tasks = obj
        .get("tasks")
        .and_then(|t| t.as_array())
        .ok_or("state.json: 'tasks' must be an array")?;

    // Format 1 (no version): tasks only; conversations are derived exactly
    // the way the PoC's openStore did. Format 2: explicit conversations.
    // Anything else halts.
    let mut conversations: Vec<LegacyConversation> = vec![];
    match obj.get("version") {
        None => {
            for t in tasks {
                let task = t.as_object().ok_or("state.json: task must be an object")?;
                let id = str_field(task, "id", "task.id")?;
                let prompt = str_field(task, "prompt", "task.prompt")?;
                let created_at = iso_field(task, "createdAt", "task.createdAt")?;
                conversations.push(LegacyConversation {
                    id: id.clone(),
                    title: prompt.clone(),
                    created_at,
                    archived: false,
                });
            }
        }
        Some(serde_json::Value::Number(n)) if n.as_i64() == Some(2) => {
            let convs = obj
                .get("conversations")
                .and_then(|c| c.as_array())
                .ok_or("state.json: format 2 requires a 'conversations' array")?;
            for c in convs {
                let conv = c
                    .as_object()
                    .ok_or("state.json: conversation must be an object")?;
                let continuation = conv
                    .get("continuation")
                    .and_then(|v| v.as_str())
                    .unwrap_or("ready");
                if !["ready", "unavailable", "legacy"].contains(&continuation) {
                    return Err(format!(
                        "state.json: unknown continuation '{continuation}' on conversation"
                    ));
                }
                conversations.push(LegacyConversation {
                    id: str_field(conv, "id", "conversation.id")?,
                    title: str_field(conv, "title", "conversation.title").unwrap_or_default(),
                    created_at: iso_field(conv, "createdAt", "conversation.createdAt")?,
                    archived: conv
                        .get("archived")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false),
                });
            }
        }
        Some(other) => {
            return Err(format!("state.json: unsupported store version {other}"));
        }
    }
    // Reject ambiguous sources with precise errors instead of letting the
    // database UNIQUE constraints produce raw SQLite failures. Task ids are
    // checked first: in format 1 each task derives its own conversation, so
    // a task duplicate would otherwise surface as a conversation duplicate.
    let mut seen_task_ids = std::collections::HashSet::new();
    for t in tasks {
        let task = t.as_object().ok_or("state.json: task must be an object")?;
        let id = str_field(task, "id", "task.id")?;
        if !seen_task_ids.insert(id.clone()) {
            return Err(format!("state.json: duplicate task id '{id}'"));
        }
    }
    let mut seen_convs = std::collections::HashSet::new();
    for c in &conversations {
        if !seen_convs.insert(c.id.as_str()) {
            return Err(format!("state.json: duplicate conversation id '{}'", c.id));
        }
    }
    let conv_ids: std::collections::HashSet<&str> = seen_convs;

    let mut out_tasks = vec![];
    for t in tasks {
        let task = t.as_object().ok_or("state.json: task must be an object")?;
        let id = str_field(task, "id", "task.id")?;
        // Format 1 tasks carry their own id as the conversation id (the
        // PoC mutated conversationId onto the task during migration).
        let conversation_id = task
            .get("conversationId")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| id.clone());
        if !conv_ids.contains(conversation_id.as_str()) {
            return Err(format!(
                "state.json: task {id} references unknown conversation {conversation_id}"
            ));
        }
        let status = str_field(task, "status", &format!("task {id} status"))?;
        match status.as_str() {
            "queued" | "completed" | "failed" | "cancelled" | "interrupted" => {}
            "running" | "cancelling" => {
                return Err(format!(
                    "state.json: task {id} is '{status}'; quiesce the PoC (stop the service) before importing"
                ));
            }
            other => {
                return Err(format!(
                    "state.json: task {id} has unknown status '{other}'"
                ));
            }
        }
        let prompt = str_field(task, "prompt", &format!("task {id} prompt"))?;
        if prompt.is_empty() || prompt.len() > 16000 {
            return Err(format!("state.json: task {id} has an invalid prompt"));
        }
        // requestKey may be absent on tasks created before the PoC
        // recorded it; synthesize a deterministic one so the row stays
        // unique and a re-import derives the same key.
        let request_key = match task.get("requestKey").and_then(|v| v.as_str()) {
            Some(k) => {
                if uuid::Uuid::parse_str(k).is_err() {
                    return Err(format!("state.json: task {id} has an invalid requestKey"));
                }
                k.to_string()
            }
            None => {
                let digest = sha256_hex(format!("agentmeld-import-request-key:{id}").as_bytes());
                format!(
                    "{}-{}-{}-{}-{}",
                    &digest[0..8],
                    &digest[8..12],
                    &digest[12..16],
                    &digest[16..20],
                    &digest[20..32]
                )
            }
        };
        // requestDigest is a provenance marker on imported rows (imported
        // runs are never re-admitted); synthesize it when absent.
        let request_digest = match task.get("requestDigest").and_then(|v| v.as_str()) {
            Some(d) if d.len() == 64 && d.bytes().all(|b| b.is_ascii_hexdigit()) => d.to_string(),
            Some(_) => {
                return Err(format!(
                    "state.json: task {id} has an invalid requestDigest"
                ))
            }
            None => sha256_hex(format!("agentmeld-import-request-digest:{id}").as_bytes()),
        };
        let created_at = iso_field(task, "createdAt", &format!("task {id} createdAt"))?;
        let mut events = vec![];
        let mut started_at = None;
        let mut finished_at = None;
        if let Some(arr) = task.get("events").and_then(|e| e.as_array()) {
            for e in arr {
                let ev = e
                    .as_object()
                    .ok_or(format!("state.json: task {id} event must be an object"))?;
                let kind = str_field(ev, "kind", &format!("task {id} event kind"))?;
                let milestone = format!("run.{kind}");
                if milestone_label(&milestone).is_none() {
                    return Err(format!(
                        "state.json: task {id} has unknown event kind '{kind}'"
                    ));
                }
                let at = iso_field(ev, "at", &format!("task {id} event time"))?;
                match milestone.as_str() {
                    "run.started" => started_at = Some(at),
                    "run.completed" | "run.failed" | "run.cancelled" | "run.interrupted" => {
                        finished_at = Some(at)
                    }
                    _ => {}
                }
                events.push(LegacyEvent {
                    id: ev
                        .get("id")
                        .and_then(|v| v.as_str())
                        .map(str::to_string)
                        .unwrap_or_else(|| format!("{id}:{kind}")),
                    kind: milestone,
                    created_at: at,
                });
            }
        }
        let terminal =
            ["completed", "failed", "cancelled", "interrupted"].contains(&status.as_str());
        out_tasks.push(LegacyTask {
            id: id.clone(),
            conversation_id: conversation_id.clone(),
            prompt,
            request_key,
            request_digest,
            status: status.clone(),
            terminal_reason: task
                .get("error")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(str::to_string),
            failure_stage: task
                .get("failureStage")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            created_at,
            started_at: started_at.or(if terminal { Some(created_at) } else { None }),
            finished_at: finished_at.or(if terminal { Some(created_at) } else { None }),
            answer: task
                .get("answer")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            events,
            inputs: files_field(task, "inputs", &id, "input")?,
            artifacts: files_field(task, "artifacts", &id, "artifact")?,
            workspace: workspace_field(task, &id, &conversation_id)?,
            session: session_field(task, &id)?,
        });
    }
    Ok(LegacyBundle {
        conversations,
        tasks: out_tasks,
        source_digest: source_digest.to_string(),
    })
}

fn str_field(
    obj: &serde_json::Map<String, serde_json::Value>,
    key: &str,
    label: &str,
) -> Result<String, String> {
    obj.get(key)
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .ok_or_else(|| format!("state.json: missing or invalid {label}"))
}

fn iso_field(
    obj: &serde_json::Map<String, serde_json::Value>,
    key: &str,
    label: &str,
) -> Result<i64, String> {
    let s = str_field(obj, key, label)?;
    iso_to_ms(&s).ok_or_else(|| format!("state.json: invalid timestamp in {label}"))
}

fn files_field(
    task: &serde_json::Map<String, serde_json::Value>,
    key: &str,
    task_id: &str,
    what: &str,
) -> Result<Vec<LegacyFile>, String> {
    let mut out = vec![];
    let mut total = 0usize;
    if let Some(arr) = task.get(key).and_then(|v| v.as_array()) {
        for f in arr {
            let obj = f
                .as_object()
                .ok_or_else(|| format!("state.json: task {task_id} {what} must be an object"))?;
            let name = str_field(obj, "name", &format!("task {task_id} {what} name"))?;
            if !safe_name(&name) {
                return Err(format!(
                    "state.json: task {task_id} has an unsafe {what} name '{name}'"
                ));
            }
            let data_b64 = str_field(obj, "data", &format!("task {task_id} {what} data"))?;
            let data = decode_strict_b64(&data_b64).ok_or_else(|| {
                format!("state.json: task {task_id} {what} '{name}' is not valid base64")
            })?;
            if data.len() > 2 * 1024 * 1024 {
                return Err(format!(
                    "state.json: task {task_id} {what} '{name}' exceeds 2 MiB"
                ));
            }
            total += data.len();
            if total > 5 * 1024 * 1024 {
                return Err(format!(
                    "state.json: task {task_id} {what}s exceed 5 MiB combined"
                ));
            }
            out.push(LegacyFile { name, data });
        }
    }
    Ok(out)
}

fn workspace_field(
    task: &serde_json::Map<String, serde_json::Value>,
    task_id: &str,
    conversation_id: &str,
) -> Result<Vec<LegacyWorkspaceEntry>, String> {
    // The workspace snapshot lives on the conversation in format 2; the
    // importer reads it from a sibling lookup the caller provides. Here we
    // only handle the per-task case: format 2 tasks don't carry workspaces,
    // so this stays empty unless the record has one (forward tolerance).
    let _ = conversation_id;
    let mut out = vec![];
    if let Some(arr) = task.get("workspace").and_then(|v| v.as_array()) {
        for f in arr {
            let obj = f.as_object().ok_or_else(|| {
                format!("state.json: task {task_id} workspace entry must be an object")
            })?;
            let name = str_field(obj, "name", &format!("task {task_id} workspace name"))?;
            if !valid_workspace_path(&name) {
                return Err(format!(
                    "state.json: task {task_id} has an invalid workspace path '{name}'"
                ));
            }
            let directory = obj
                .get("directory")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let data = match obj.get("data").and_then(|v| v.as_str()) {
                Some(b64) => Some(decode_strict_b64(b64).ok_or_else(|| {
                    format!(
                        "state.json: task {task_id} workspace file '{name}' is not valid base64"
                    )
                })?),
                None => None,
            };
            let modified_at = match obj.get("modifiedAt").and_then(|v| v.as_str()) {
                Some(ms) => Some(iso_to_ms(ms).ok_or_else(|| {
                    format!("state.json: task {task_id} workspace file '{name}' has an invalid modifiedAt")
                })?),
                None => None,
            };
            out.push(LegacyWorkspaceEntry {
                name,
                data,
                directory,
                modified_at,
            });
        }
    }
    Ok(out)
}

/// Format 2 workspace snapshots live on the conversation record. The bundle
/// builder merges them onto the conversation's latest task before calling
/// import_legacy; this helper extracts them per conversation.
fn conversation_workspace(
    conv: &serde_json::Map<String, serde_json::Value>,
    conv_id: &str,
) -> Result<Vec<LegacyWorkspaceEntry>, String> {
    let mut out = vec![];
    if let Some(arr) = conv.get("workspace").and_then(|v| v.as_array()) {
        for f in arr {
            let obj = f.as_object().ok_or_else(|| {
                format!("state.json: conversation {conv_id} workspace entry must be an object")
            })?;
            let name = str_field(
                obj,
                "name",
                &format!("conversation {conv_id} workspace name"),
            )?;
            if !valid_workspace_path(&name) {
                return Err(format!(
                    "state.json: conversation {conv_id} has an invalid workspace path '{name}'"
                ));
            }
            let directory = obj
                .get("directory")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let data = match obj.get("data").and_then(|v| v.as_str()) {
                Some(b64) => Some(decode_strict_b64(b64).ok_or_else(|| {
                    format!("state.json: conversation {conv_id} workspace file '{name}' is not valid base64")
                })?),
                None => None,
            };
            let modified_at = match obj.get("modifiedAt").and_then(|v| v.as_str()) {
                Some(ms) => Some(iso_to_ms(ms).ok_or_else(|| {
                    format!("state.json: conversation {conv_id} workspace file '{name}' has an invalid modifiedAt")
                })?),
                None => None,
            };
            out.push(LegacyWorkspaceEntry {
                name,
                data,
                directory,
                modified_at,
            });
        }
    }
    Ok(out)
}

fn session_field(
    task: &serde_json::Map<String, serde_json::Value>,
    task_id: &str,
) -> Result<Option<LegacySession>, String> {
    // Sessions live on the conversation in format 2; tasks may also carry
    // one in forward-tolerant records.
    let obj = match task.get("session").and_then(|v| v.as_object()) {
        Some(o) => o,
        None => return Ok(None),
    };
    build_session(obj, task_id)
}

fn build_session(
    obj: &serde_json::Map<String, serde_json::Value>,
    label: &str,
) -> Result<Option<LegacySession>, String> {
    if obj.is_empty() {
        return Ok(None);
    }
    // Normalize the PoC's camelCase keys to worker-seam/1 snake_case, the
    // same normalization the supervisor applies at runtime.
    let get = |snake: &str, camel: &str| {
        obj.get(snake)
            .or_else(|| obj.get(camel))
            .and_then(|v| v.as_str())
            .map(str::to_string)
    };
    let native_ref = get("thread_id", "threadId").ok_or_else(|| {
        format!("state.json: {label} has a session without a thread id; cannot import an unresumable session")
    })?;
    let model = get("model", "model").unwrap_or_else(|| "codex".to_string());
    Ok(Some(LegacySession {
        model,
        native_ref,
        image_digest: get("image_digest", "image"),
        store_instance: get("store_instance", "storeInstance"),
        policy_digest: get("policy_digest", "policyDigest"),
    }))
}

// ------------------------------------------------------- small validators.

fn safe_name(name: &str) -> bool {
    if name == ".." || name.is_empty() || name.len() > 120 {
        return false;
    }
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphanumeric() || c == '.' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ' '))
        && !name.contains('/')
}

fn valid_workspace_path(name: &str) -> bool {
    if name.is_empty() || name.len() > 1088 {
        return false;
    }
    name.split('/').all(|part| {
        part != "." && part != ".." && {
            let mut chars = part.chars();
            match chars.next() {
                Some(c) if c.is_ascii_alphanumeric() || c == '.' => {}
                _ => return false,
            }
            chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | ' ' | '_' | '-'))
                && part.len() <= 120
        }
    })
}

fn decode_strict_b64(data: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    if data.is_empty() {
        return Some(vec![]);
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .ok()?;
    // Strictness: re-encoding must round-trip (rejects whitespace, wrong
    // padding, and non-canonical spellings), mirroring the admission check.
    if base64::engine::general_purpose::STANDARD.encode(&bytes) != data {
        return None;
    }
    Some(bytes)
}

/// Parse an ISO-8601 UTC timestamp (the PoC's Date.toISOString shape) to
/// epoch milliseconds.
fn iso_to_ms(s: &str) -> Option<i64> {
    let s = s.strip_suffix('Z')?;
    let (date, time) = s.split_once('T')?;
    let mut d = date.split('-');
    let y: i64 = d.next()?.parse().ok()?;
    let m: i64 = d.next()?.parse().ok()?;
    let day: i64 = d.next()?.parse().ok()?;
    if d.next().is_some() {
        return None;
    }
    let (time, frac) = match time.split_once('.') {
        Some((t, f)) => (t, f),
        None => (time, "0"),
    };
    let mut t = time.split(':');
    let hh: i64 = t.next()?.parse().ok()?;
    let mm: i64 = t.next()?.parse().ok()?;
    let ss: i64 = t.next()?.parse().ok()?;
    if t.next().is_some() {
        return None;
    }
    if !(1..=12).contains(&m) || !(1..=31).contains(&day) || hh > 23 || mm > 59 || ss > 60 {
        return None;
    }
    let frac_ms: i64 = {
        let mut f = frac.to_string();
        f.truncate(3);
        while f.len() < 3 {
            f.push('0');
        }
        f.parse().ok()?
    };
    let days = days_from_civil(y, m, day)?;
    Some(days * 86_400_000 + hh * 3_600_000 + mm * 60_000 + ss * 1000 + frac_ms)
}

fn days_from_civil(y: i64, m: i64, d: i64) -> Option<i64> {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146097 + doe - 719468)
}

// ------------------------------------------------------------------
// Format 2 conversations carry their workspace snapshot and provider
// session on the conversation record; the bundle builder attaches them to
// the conversation's latest task so import_legacy writes them once.
// ------------------------------------------------------------------

pub(crate) fn attach_conversation_extras(
    bundle: &mut LegacyBundle,
    conv_workspaces: Vec<(String, Vec<LegacyWorkspaceEntry>)>,
    conv_sessions: Vec<(String, LegacySession)>,
) {
    for (conv_id, workspace) in conv_workspaces {
        if let Some(task) = bundle
            .tasks
            .iter_mut()
            .filter(|t| t.conversation_id == conv_id)
            .max_by_key(|t| t.created_at)
        {
            task.workspace = workspace;
        }
    }
    for (conv_id, session) in conv_sessions {
        if let Some(task) = bundle
            .tasks
            .iter_mut()
            .filter(|t| t.conversation_id == conv_id)
            .max_by_key(|t| t.created_at)
        {
            if task.session.is_none() {
                task.session = Some(session);
            }
        }
    }
}

/// Second parse pass for format 2: pull workspace snapshots and sessions off
/// the conversation records.
pub(crate) fn conversation_extras(text: &str) -> Result<ConversationExtras, String> {
    let v: serde_json::Value =
        serde_json::from_str(text).map_err(|e| format!("state.json is not valid JSON: {e}"))?;
    let mut workspaces = vec![];
    let mut sessions = vec![];
    let is_v2 = v
        .get("version")
        .and_then(|n| n.as_i64())
        .map(|n| n == 2)
        .unwrap_or(false);
    if !is_v2 {
        return Ok((workspaces, sessions));
    }
    if let Some(convs) = v.get("conversations").and_then(|c| c.as_array()) {
        for c in convs {
            let conv = c
                .as_object()
                .ok_or("state.json: conversation must be an object")?;
            let id = str_field(conv, "id", "conversation.id")?;
            let ws = conversation_workspace(conv, &id)?;
            if !ws.is_empty() {
                workspaces.push((id.clone(), ws));
            }
            if let Some(obj) = conv.get("session").and_then(|s| s.as_object()) {
                if let Some(session) = build_session(obj, &format!("conversation {id}"))? {
                    sessions.push((id, session));
                }
            }
        }
    }
    Ok((workspaces, sessions))
}

/// Re-export for the binary: parse, validate, attach conversation extras.
pub fn load_bundle(text: &str, source_digest: &str) -> Result<LegacyBundle, String> {
    let mut bundle = parse_and_validate(text, source_digest)?;
    let (workspaces, sessions) = conversation_extras(text)?;
    attach_conversation_extras(&mut bundle, workspaces, sessions);
    Ok(bundle)
}
