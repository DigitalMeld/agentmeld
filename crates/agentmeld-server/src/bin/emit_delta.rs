// Test helper for the browser E2E (issue #113): append `run.answer_delta`
// events to a live run through the real `Db::apply_worker_events` path, so
// the E2E can stream synthetic reply deltas over the live SSE connection
// and verify the client's incremental rendering.
//
// Usage: emit-delta --state-dir <dir> --run-id <id> --text <text> [--event-id <id>]
//
// The run must be active (Running/Cancelling); the helper creates the
// response message if the run doesn't have one yet and uses the run's
// current generation.

use std::path::PathBuf;
use std::sync::Arc;

use agentmeld_server::db::Db;
use agentmeld_server::domain::new_uuid;
use agentmeld_server::seam::{Binding, WorkerEvent};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let opt = |name: &str| args.windows(2).find(|w| w[0] == name).map(|w| w[1].clone());
    let dir = PathBuf::from(
        opt("--state-dir")
            .expect("usage: emit-delta --state-dir <dir> --run-id <id> --text <text>"),
    );
    let run_id = opt("--run-id").expect("missing --run-id");
    let text = opt("--text").expect("missing --text");
    let event_id = opt("--event-id").unwrap_or_else(new_uuid);

    let db = Arc::new(Db::open(&dir.join("agentmeld.db"), &dir.join("blobs")).expect("open db"));
    db.run_migrations().expect("migrations");

    let generation: i64 = {
        let conn =
            rusqlite::Connection::open(dir.join("agentmeld.db")).expect("open raw for generation");
        conn.query_row(
            "SELECT generation FROM runs WHERE workspace_id = 'default' AND id = ?1",
            rusqlite::params![run_id],
            |r| r.get(0),
        )
        .expect("read run generation")
    };

    // Binding only needs to be well-formed here; the demo seeder uses the
    // same placeholder binding for the runs this helper targets.
    let binding = Binding {
        image_digest: "demo".to_string(),
        store_instance: "demo".to_string(),
        model: "demo".to_string(),
        policy_digest: "demo".to_string(),
    };

    // Deltas append to the run's response message; create it on first use.
    let has_response: Option<String> = {
        let conn =
            rusqlite::Connection::open(dir.join("agentmeld.db")).expect("open raw for response");
        conn.query_row(
            "SELECT response_message_id FROM runs WHERE workspace_id = 'default' AND id = ?1",
            rusqlite::params![run_id],
            |r| r.get(0),
        )
        .expect("read response_message_id")
    };
    if has_response.is_none() {
        db.create_response_message(&run_id)
            .expect("create response message");
    }

    db.apply_worker_events(
        &run_id,
        generation,
        &binding,
        &[WorkerEvent {
            event_id,
            event_type: "run.answer_delta".to_string(),
            dedupe_key: None,
            payload: serde_json::json!({ "text": text }),
        }],
        None,
        true,
    )
    .expect("append answer_delta");
    println!("delta appended to run {run_id}");
}
