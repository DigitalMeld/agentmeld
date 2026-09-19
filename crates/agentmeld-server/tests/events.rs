// Worker event dedupe: re-appending the same event returns the original
// sequence number with duplicate=true instead of a second row.
mod common;

use agentmeld_server::db::{AdmitInput, Db};
use agentmeld_server::domain::new_uuid;
use agentmeld_server::seam::{Binding, WorkerEvent};
use std::sync::Arc;

fn setup_running(db: &Arc<Db>) -> (String, String, Binding, i64) {
    let run_id = db
        .admit(
            &AdmitInput {
                conversation_id: None,
                prompt: "dedupe probe".to_string(),
                request_key: new_uuid(),
                files: vec![],
            },
            "owner",
        )
        .expect("admit")
        .run_id;
    let claimed = db.claim_queued_run().expect("claim").expect("claimed run");
    let conv_id = claimed.conversation_id.clone();
    // begin_turn mints the run's monotonic action generation; event batches
    // must bind to it.
    let generation = db.begin_turn(&run_id).expect("begin turn").generation;
    let binding = Binding {
        image_digest: "img".to_string(),
        store_instance: "store".to_string(),
        model: "model".to_string(),
        policy_digest: "policy".to_string(),
    };
    (run_id, conv_id, binding, generation)
}

fn event(id: &str, kind: &str, dedupe: Option<&str>) -> WorkerEvent {
    WorkerEvent {
        event_id: id.to_string(),
        event_type: kind.to_string(),
        dedupe_key: dedupe.map(|s| s.to_string()),
        payload: serde_json::json!({}),
    }
}

#[test]
fn reappend_returns_original_sequence() {
    let (db, dir) = common::test_db();
    let (run_id, _conv, binding, generation) = setup_running(&db);

    let first = db
        .apply_worker_events(
            &run_id,
            generation,
            &binding,
            &[event("e1", "run.thinking", Some("k1"))],
            None,
            false,
        )
        .expect("append");
    assert_eq!(first.stored.len(), 1);
    assert!(!first.stored[0].duplicate);
    let seq = first.stored[0].seq;

    // Same event id, same dedupe key: dedupe to the original sequence.
    let second = db
        .apply_worker_events(
            &run_id,
            generation,
            &binding,
            &[event("e1", "run.thinking", Some("k1"))],
            None,
            false,
        )
        .expect("re-append");
    assert_eq!(second.stored.len(), 1);
    assert!(
        second.stored[0].duplicate,
        "repeat must be marked duplicate"
    );
    assert_eq!(
        second.stored[0].seq, seq,
        "duplicate returns the original seq"
    );

    // Different event id but the same dedupe key: also a duplicate.
    let third = db
        .apply_worker_events(
            &run_id,
            generation,
            &binding,
            &[event("e2", "run.thinking", Some("k1"))],
            None,
            false,
        )
        .expect("re-append by key");
    assert!(third.stored[0].duplicate);
    assert_eq!(third.stored[0].seq, seq);

    // A fresh event advances the sequence.
    let fourth = db
        .apply_worker_events(
            &run_id,
            generation,
            &binding,
            &[event("e3", "run.thinking", Some("k2"))],
            None,
            false,
        )
        .expect("fresh event");
    assert!(!fourth.stored[0].duplicate);
    assert!(fourth.stored[0].seq > seq);
    common::cleanup(&dir);
}
