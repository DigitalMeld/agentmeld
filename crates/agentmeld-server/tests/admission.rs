// Admission idempotency: same key + same digest returns the original
// receipt; same key + a different digest is a 409.
mod common;

use agentmeld_server::db::{AdmitInput, Db};
use agentmeld_server::domain::new_uuid;
use std::sync::Arc;

fn admit(db: &Arc<Db>, key: &str, prompt: &str) -> Result<String, String> {
    db.admit(
        &AdmitInput {
            conversation_id: None,
            prompt: prompt.to_string(),
            request_key: key.to_string(),
            files: vec![],
        },
        "owner",
    )
    .map(|o| o.run_id)
    .map_err(|e| e.message)
}

#[test]
fn same_key_same_digest_returns_original_receipt() {
    let (db, dir) = common::test_db();
    let key = new_uuid();
    let first = admit(&db, &key, "hello world").expect("first admission");
    let outcome = db
        .admit(
            &AdmitInput {
                conversation_id: None,
                prompt: "hello world".to_string(),
                request_key: key.clone(),
                files: vec![],
            },
            "owner",
        )
        .expect("second admission");
    assert!(outcome.duplicate, "repeat admission must be a duplicate");
    assert_eq!(outcome.run_id, first, "must return the original run id");
    common::cleanup(&dir);
}

#[test]
fn same_key_different_digest_is_409() {
    let (db, dir) = common::test_db();
    let key = new_uuid();
    admit(&db, &key, "first message").expect("first admission");
    let err = db
        .admit(
            &AdmitInput {
                conversation_id: None,
                prompt: "a different message".to_string(),
                request_key: key.clone(),
                files: vec![],
            },
            "owner",
        )
        .expect_err("conflicting admission must fail");
    assert_eq!(err.status, 409, "key reuse with a new digest is a 409");
    common::cleanup(&dir);
}

#[test]
fn unicode_prompts_admit_and_round_trip() {
    let (db, dir) = common::test_db();
    let prompt = "héllo wörld 🌍 — مرحبا — 你好";
    let run_id = admit(&db, &new_uuid(), prompt).expect("unicode admission");
    let run = db.get_run(&run_id).expect("read run");
    assert_eq!(run.status.as_str(), "queued");
    common::cleanup(&dir);
}
