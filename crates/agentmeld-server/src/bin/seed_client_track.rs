// Deterministic demo seeder for the client track (issue #92).
//
// Seeds a disposable state dir with a fixed scenario the browser UI can
// render, using the REAL Db code paths (admit, worker-event application,
// propose/decide approval) so the seeded rows are shaped exactly like
// production rows. The running server then serves them over the real
// HTTP + SSE APIs.
//
// Scenario:
//   - conversation "Summarize the Q3 sales data" with a running run that
//     has two tool steps (one running, one completed);
//   - one PENDING approval (5-minute TTL) proposing a delete;
//   - a second conversation/run with a DENIED approval for history.
//
// Usage: seed-client-track-demo --state-dir <dir>
// Idempotent: wipes the demo rows it created on a previous run.

use std::path::PathBuf;
use std::sync::Arc;

use agentmeld_server::approvals::DecideKind;
use agentmeld_server::db::{AdmitInput, Db};
use agentmeld_server::domain::{new_uuid, now_ms, RunStatus};
use agentmeld_server::seam::{Binding, WorkerEvent};

fn worker_event(event_id: &str, event_type: &str, payload: serde_json::Value) -> WorkerEvent {
    WorkerEvent {
        event_id: event_id.to_string(),
        event_type: event_type.to_string(),
        dedupe_key: None,
        payload,
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let dir = args
        .windows(2)
        .find(|w| w[0] == "--state-dir")
        .map(|w| PathBuf::from(&w[1]))
        .expect("usage: seed-client-track-demo --state-dir <dir>");
    std::fs::create_dir_all(&dir).expect("create state dir");
    std::fs::create_dir_all(dir.join("blobs")).expect("create blob root");

    let db = Arc::new(Db::open(&dir.join("agentmeld.db"), &dir.join("blobs")).expect("open db"));
    db.run_migrations().expect("migrations");
    db.seed_bootstrap().expect("bootstrap");

    // Idempotent: remove rows from a previous seed run.
    {
        let conn = rusqlite::Connection::open(dir.join("agentmeld.db")).expect("open raw");
        conn.execute_batch(
            "DELETE FROM approvals WHERE id LIKE 'demo-approval-%';
             DELETE FROM tool_steps WHERE run_id IN (SELECT id FROM runs WHERE conversation_id IN
               (SELECT id FROM conversations WHERE title IN
                 ('Summarize the Q3 sales data','Clean up old exports')));
             DELETE FROM run_events WHERE run_id IN (SELECT id FROM runs WHERE conversation_id IN
               (SELECT id FROM conversations WHERE title IN
                 ('Summarize the Q3 sales data','Clean up old exports')));
             DELETE FROM runs WHERE conversation_id IN
               (SELECT id FROM conversations WHERE title IN
                 ('Summarize the Q3 sales data','Clean up old exports'));
             DELETE FROM messages WHERE conversation_id IN
               (SELECT id FROM conversations WHERE title IN
                 ('Summarize the Q3 sales data','Clean up old exports'));
             DELETE FROM conversations WHERE title IN
               ('Summarize the Q3 sales data','Clean up old exports');",
        )
        .expect("cleanup previous seed");
    }

    // A demo device so the denied approval has a real deciding device.
    {
        let conn = rusqlite::Connection::open(dir.join("agentmeld.db")).expect("open raw");
        conn.execute(
            "INSERT OR IGNORE INTO devices (id, name, enrolled_at) VALUES ('demo-browser','Demo browser',?1)",
            rusqlite::params![now_ms()],
        )
        .expect("seed device");
    }

    let binding = Binding {
        image_digest: "demo".to_string(),
        store_instance: "demo".to_string(),
        model: "demo".to_string(),
        policy_digest: "demo".to_string(),
    };

    // --- run 1: live run with tool steps + pending approval ----------------
    let admitted = db
        .admit(
            &AdmitInput {
                conversation_id: None,
                prompt: "Summarize the Q3 sales data".to_string(),
                request_key: new_uuid(),
                files: vec![],
            },
            "owner",
        )
        .expect("admit run 1");
    let run1 = admitted.run_id;
    db.set_run_status(&run1, RunStatus::Running, None)
        .expect("run 1 -> running");
    db.apply_worker_events(
        &run1,
        1,
        &binding,
        &[
            worker_event(
                "ev-tool-1",
                "tool.call_started",
                serde_json::json!({"call_key":"ck-1","tool_name":"read_file","title":"Reading sales_q3.csv"}),
            ),
            worker_event(
                "ev-tool-2",
                "tool.call_finished",
                serde_json::json!({"call_key":"ck-1","state":"completed"}),
            ),
            worker_event(
                "ev-tool-3",
                "tool.call_started",
                serde_json::json!({"call_key":"ck-2","tool_name":"run_query","title":"Aggregating by region"}),
            ),
            worker_event(
                "ev-run-thinking",
                "run.thinking",
                serde_json::json!({}),
            ),
        ],
        None,
        true,
    )
    .expect("tool events run 1");

    let action = serde_json::json!({
        "tool": "delete_table",
        "target": "staging.sales_2024_draft",
        "arguments": {"cascade": false, "reason": "superseded by the audited table"}
    });
    db.propose_approval(
        "demo-approval-1",
        &run1,
        1,
        &action,
        "Delete the stale staging table staging.sales_2024_draft",
        300_000,
    )
    .expect("propose approval 1");

    // --- run 2: denied approval for the history panel ----------------------
    let admitted2 = db
        .admit(
            &AdmitInput {
                conversation_id: None,
                prompt: "Clean up old exports".to_string(),
                request_key: new_uuid(),
                files: vec![],
            },
            "owner",
        )
        .expect("admit run 2");
    let run2 = admitted2.run_id;
    db.set_run_status(&run2, RunStatus::Running, None)
        .expect("run 2 -> running");
    db.propose_approval(
        "demo-approval-2",
        &run2,
        1,
        &serde_json::json!({
            "tool": "delete_file",
            "target": "exports/2023-archive.zip",
            "arguments": {}
        }),
        "Delete the 2023 exports archive",
        300_000,
    )
    .expect("propose approval 2");
    let lease = db.get_lease().expect("lease");
    db.decide_approval(
        "demo-approval-2",
        "demo-browser",
        DecideKind::Deny,
        lease.generation,
    )
    .expect("deny approval 2");

    println!("seeded: run {run1} (pending approval demo-approval-1), run {run2} (denied demo-approval-2)");
}
