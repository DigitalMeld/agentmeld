// One-time state.json import: happy path, idempotency, and precise
// rejections for ambiguous or unquiesced sources.
mod common;

use agentmeld_server::db::Db;
use agentmeld_server::import::run_import;
use std::path::{Path, PathBuf};

fn fixture(task_status: &str, extra: &str) -> String {
    // Format 1: the legacy PoC file has no version marker and no
    // conversations array; each task carries its own conversation.
    format!(
        r#"{{
  "tasks": [
    {{"id": "task-1", "status": "{task_status}", "prompt": "say hi",
      "createdAt": "2026-09-10T10:01:00Z", "updatedAt": "2026-09-10T10:04:00Z",
      "files": [], "events": [{{"kind": "queued", "at": "2026-09-10T10:01:00Z"}}],
      "artifacts": []}}
  ]
  {extra}
}}"#
    )
}

fn write_source(dir: &Path, name: &str, body: &str) -> PathBuf {
    let p = dir.join(name);
    std::fs::write(&p, body).unwrap();
    p
}

#[test]
fn happy_path_imports_verbatim_ids() {
    let (_db, dir) = common::test_db();
    let state_dir = dir.join("state");
    std::fs::create_dir_all(&state_dir).unwrap();
    let src = write_source(&dir, "state.json", &fixture("completed", ""));

    run_import(&state_dir, &src).expect("import succeeds");

    // The promoted database carries the legacy task id verbatim as the run id.
    let db = Db::open(&state_dir.join("agentmeld.db"), &state_dir.join("blobs"))
        .expect("open promoted db");
    assert_eq!(db.count_runs().expect("count"), 1);
    let run = db.get_run("task-1").expect("verbatim legacy id");
    assert_eq!(run.status.as_str(), "completed");
    common::cleanup(&dir);
}

#[test]
fn rerun_is_idempotent_skip() {
    let (_db, dir) = common::test_db();
    let state_dir = dir.join("state");
    std::fs::create_dir_all(&state_dir).unwrap();
    let src = write_source(&dir, "state.json", &fixture("completed", ""));

    run_import(&state_dir, &src).expect("first import");
    // Same source again: idempotent no-op, not a duplicate import.
    run_import(&state_dir, &src).expect("second import is a clean skip");

    let db = Db::open(&state_dir.join("agentmeld.db"), &state_dir.join("blobs"))
        .expect("open promoted db");
    assert_eq!(db.count_runs().expect("count"), 1, "no duplicate rows");
    common::cleanup(&dir);
}

#[test]
fn running_source_is_rejected_until_quiesced() {
    let (_db, dir) = common::test_db();
    let state_dir = dir.join("state");
    std::fs::create_dir_all(&state_dir).unwrap();
    let src = write_source(&dir, "state.json", &fixture("running", ""));

    let err = run_import(&state_dir, &src).expect_err("running source rejected");
    assert!(
        err.contains("quiesce"),
        "rejection must name quiescing, got: {err}"
    );
    common::cleanup(&dir);
}

#[test]
fn unsupported_version_is_rejected() {
    let (_db, dir) = common::test_db();
    let state_dir = dir.join("state");
    std::fs::create_dir_all(&state_dir).unwrap();
    let src = write_source(
        &dir,
        "state.json",
        r#"{"version": 99, "conversations": [], "tasks": []}"#,
    );

    let err = run_import(&state_dir, &src).expect_err("bad version rejected");
    assert!(err.contains("unsupported"), "got: {err}");
    common::cleanup(&dir);
}

#[test]
fn ambiguous_fixtures_are_rejected_precisely() {
    let (_db, dir) = common::test_db();

    // Duplicate conversation ids (format 2).
    let dup_conv = r#"{
      "version": 2,
      "conversations": [
        {"id": "conv-1", "title": "a", "createdAt": "2026-09-10T10:00:00Z"},
        {"id": "conv-1", "title": "b", "createdAt": "2026-09-10T11:00:00Z"}
      ],
      "tasks": []
    }"#;
    let state_dir = dir.join("s1");
    std::fs::create_dir_all(&state_dir).unwrap();
    let src = write_source(&dir, "a.json", dup_conv);
    let err = run_import(&state_dir, &src).expect_err("duplicate conversation rejected");
    assert!(err.contains("duplicate conversation id"), "got: {err}");

    // Task pointing at a conversation that does not exist (format 2).
    let orphan = r#"{
      "version": 2,
      "conversations": [],
      "tasks": [
        {"id": "task-9", "conversationId": "conv-ghost", "status": "completed", "prompt": "x",
         "createdAt": "2026-09-10T10:01:00Z", "updatedAt": "2026-09-10T10:04:00Z",
         "files": [], "events": [], "artifacts": []}
      ]
    }"#;
    let state_dir = dir.join("s2");
    std::fs::create_dir_all(&state_dir).unwrap();
    let src = write_source(&dir, "b.json", orphan);
    let err = run_import(&state_dir, &src).expect_err("orphan task rejected");
    assert!(err.contains("unknown conversation"), "got: {err}");

    // Duplicate task ids (format 1).
    let dup_task = r#"{
      "tasks": [
        {"id": "task-1", "status": "completed", "prompt": "x",
         "createdAt": "2026-09-10T10:01:00Z", "updatedAt": "2026-09-10T10:04:00Z",
         "files": [], "events": [], "artifacts": []},
        {"id": "task-1", "status": "failed", "prompt": "y",
         "createdAt": "2026-09-10T11:01:00Z", "updatedAt": "2026-09-10T11:04:00Z",
         "files": [], "events": [], "artifacts": []}
      ]
    }"#;
    let state_dir = dir.join("s3");
    std::fs::create_dir_all(&state_dir).unwrap();
    let src = write_source(&dir, "c.json", dup_task);
    let err = run_import(&state_dir, &src).expect_err("duplicate task rejected");
    assert!(err.contains("duplicate task id"), "got: {err}");
    common::cleanup(&dir);
}
