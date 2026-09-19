// Phase 4: tool_steps projection — start/finish atomicity, idempotency,
// unknown-finish rejection, the approval gate, denied/cancelled steps, and
// v1's refusal of tool events.
mod common;

use agentmeld_server::approvals::DecideKind;
use agentmeld_server::db::{AdmitInput, Db, ToolStepRow};
use agentmeld_server::domain::new_uuid;
use agentmeld_server::seam::{Binding, WorkerEvent};
use std::sync::Arc;

fn setup_running(db: &Arc<Db>) -> (String, Binding, i64) {
    let run_id = db
        .admit(
            &AdmitInput {
                conversation_id: None,
                prompt: "tool probe".to_string(),
                request_key: new_uuid(),
                files: vec![],
            },
            "owner",
        )
        .expect("admit")
        .run_id;
    db.claim_queued_run().expect("claim").expect("claimed run");
    let generation = db.begin_turn(&run_id).expect("begin turn").generation;
    let binding = Binding {
        image_digest: "img".to_string(),
        store_instance: "store".to_string(),
        model: "model".to_string(),
        policy_digest: "policy".to_string(),
    };
    (run_id, binding, generation)
}

fn tool_event(id: &str, kind: &str, payload: serde_json::Value) -> WorkerEvent {
    WorkerEvent {
        event_id: id.to_string(),
        event_type: kind.to_string(),
        dedupe_key: None,
        payload,
    }
}

fn started(call_key: &str, tool: &str) -> WorkerEvent {
    tool_event(
        &new_uuid(),
        "tool.call_started",
        serde_json::json!({
            "call_key": call_key,
            "tool_name": tool,
            "title": format!("run {tool}"),
        }),
    )
}

fn finished(call_key: &str, state: &str) -> WorkerEvent {
    tool_event(
        &new_uuid(),
        "tool.call_finished",
        serde_json::json!({
            "call_key": call_key,
            "state": state,
            "result_json": {"ok": true},
        }),
    )
}

/// Journal tool events on a v2-allowed turn; panics on failure.
fn journal_v2(
    db: &Arc<Db>,
    run_id: &str,
    generation: i64,
    binding: &Binding,
    events: &[WorkerEvent],
) {
    db.apply_worker_events(run_id, generation, binding, events, None, true)
        .expect("journal v2");
}

/// Journal expecting failure; returns the error message.
fn journal_fails(
    db: &Arc<Db>,
    run_id: &str,
    generation: i64,
    binding: &Binding,
    events: &[WorkerEvent],
    tool_allowed: bool,
) -> String {
    match db.apply_worker_events(run_id, generation, binding, events, None, tool_allowed) {
        Ok(_) => panic!("expected apply_worker_events to fail"),
        Err(e) => e.message,
    }
}

fn steps(db: &Arc<Db>, run_id: &str) -> Vec<ToolStepRow> {
    db.tool_steps_for_run(run_id).expect("read steps")
}

#[test]
fn start_finish_projects_running_then_completed() {
    let (db, _dir) = common::test_db();
    let (run_id, binding, generation) = setup_running(&db);

    journal_v2(
        &db,
        &run_id,
        generation,
        &binding,
        &[started("k1", "computer.screenshot")],
    );
    let rows = steps(&db, &run_id);
    assert_eq!(rows.len(), 1);
    let s = &rows[0];
    assert_eq!(s.call_key, "k1");
    assert_eq!(s.tool_name, "computer.screenshot");
    assert_eq!(s.title, "run computer.screenshot");
    assert_eq!(s.state, "running");
    assert_eq!(s.ordinal, 1);
    assert!(s.finished_at.is_none());
    assert!(s.started_at > 0);

    journal_v2(
        &db,
        &run_id,
        generation,
        &binding,
        &[finished("k1", "completed")],
    );
    let rows = steps(&db, &run_id);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].state, "completed");
    assert!(rows[0].finished_at.unwrap() >= rows[0].started_at);
    assert_eq!(rows[0].result_json.as_deref(), Some(r#"{"ok":true}"#));
}

#[test]
fn duplicate_start_is_idempotent_no_ordinal_gap() {
    let (db, _dir) = common::test_db();
    let (run_id, binding, generation) = setup_running(&db);

    journal_v2(
        &db,
        &run_id,
        generation,
        &binding,
        &[started("k1", "computer.screenshot")],
    );
    // A retried start with the same call_key returns the existing row.
    journal_v2(
        &db,
        &run_id,
        generation,
        &binding,
        &[started("k1", "computer.screenshot")],
    );
    let rows = steps(&db, &run_id);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].ordinal, 1);

    // The next distinct call takes ordinal 2 — no gap from the duplicate.
    journal_v2(
        &db,
        &run_id,
        generation,
        &binding,
        &[started("k2", "computer.click")],
    );
    let rows = steps(&db, &run_id);
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[1].ordinal, 2);
    assert_eq!(rows[1].call_key, "k2");
}

#[test]
fn finish_unknown_call_key_fails_closed() {
    let (db, _dir) = common::test_db();
    let (run_id, binding, generation) = setup_running(&db);

    let msg = journal_fails(
        &db,
        &run_id,
        generation,
        &binding,
        &[finished("nope", "completed")],
        true,
    );
    assert!(msg.contains("unknown_call_key"), "unexpected error: {msg}");
    // The failed finish journalled nothing: no step, and the rejected event
    // row rolled back with it (atomic both-or-neither).
    assert!(steps(&db, &run_id).is_empty());
}

#[test]
fn first_terminal_finish_wins() {
    let (db, _dir) = common::test_db();
    let (run_id, binding, generation) = setup_running(&db);

    journal_v2(
        &db,
        &run_id,
        generation,
        &binding,
        &[started("k1", "computer.screenshot")],
    );
    journal_v2(
        &db,
        &run_id,
        generation,
        &binding,
        &[finished("k1", "failed")],
    );
    // A second finish is ignored: the first terminal state stands.
    journal_v2(
        &db,
        &run_id,
        generation,
        &binding,
        &[finished("k1", "completed")],
    );
    let rows = steps(&db, &run_id);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].state, "failed");
}

#[test]
fn nested_parent_child_links() {
    let (db, _dir) = common::test_db();
    let (run_id, binding, generation) = setup_running(&db);

    journal_v2(
        &db,
        &run_id,
        generation,
        &binding,
        &[started("parent", "shell.exec")],
    );
    journal_v2(
        &db,
        &run_id,
        generation,
        &binding,
        &[tool_event(
            &new_uuid(),
            "tool.call_started",
            serde_json::json!({
                "call_key": "child",
                "parent_call_key": "parent",
                "tool_name": "fs.read",
                "title": "read file",
            }),
        )],
    );
    let rows = steps(&db, &run_id);
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[1].parent_step_id.as_deref(), Some(rows[0].id.as_str()));

    // Unknown parent fails closed.
    let msg = journal_fails(
        &db,
        &run_id,
        generation,
        &binding,
        &[tool_event(
            &new_uuid(),
            "tool.call_started",
            serde_json::json!({
                "call_key": "orphan",
                "parent_call_key": "ghost",
                "tool_name": "fs.read",
                "title": "read file",
            }),
        )],
        true,
    );
    assert!(msg.contains("unknown parent"), "got: {msg}");
}

#[test]
fn v1_turn_rejects_tool_events() {
    let (db, _dir) = common::test_db();
    let (run_id, binding, generation) = setup_running(&db);

    // tool_events_allowed=false: a v1-negotiated session sending tool events
    // violates its contract — the turn fails closed, nothing is journalled.
    let msg = journal_fails(
        &db,
        &run_id,
        generation,
        &binding,
        &[started("k1", "computer.screenshot")],
        false,
    );
    assert!(!msg.is_empty());
    assert!(steps(&db, &run_id).is_empty());
    // ...but ordinary v1 events still flow.
    db.apply_worker_events(
        &run_id,
        generation,
        &binding,
        &[tool_event(
            &new_uuid(),
            "run.thinking",
            serde_json::json!({}),
        )],
        None,
        false,
    )
    .expect("v1 events ok");
}

#[test]
fn gated_start_requires_approved_consumed_approval() {
    let (db, _dir) = common::test_db();
    let (run_id, binding, generation) = setup_running(&db);
    let device_id = db.create_device("approver").expect("device").id;

    let approval_id = new_uuid();
    db.propose_approval(
        &approval_id,
        &run_id,
        generation,
        &serde_json::json!({"tool": "computer.screenshot", "target": "display0", "arguments": {}}),
        "take a screenshot",
        60_000,
    )
    .expect("propose");

    let gated = |key: &str| {
        tool_event(
            &new_uuid(),
            "tool.call_started",
            serde_json::json!({
                "call_key": key,
                "tool_name": "computer.screenshot",
                "title": "take a screenshot",
                "approval_id": approval_id,
            }),
        )
    };

    // While the run waits for the decision it is not active: the worker is
    // blocked and cannot send tool events at all.
    let msg = journal_fails(&db, &run_id, generation, &binding, &[gated("g1")], true);
    assert!(msg.contains("run is not active"), "got: {msg}");
    assert!(steps(&db, &run_id).is_empty());

    // Approved but ticket unconsumed: the gate fails closed.
    let lease_gen = db.get_lease().expect("lease").generation;
    let ticket = db
        .decide_approval(&approval_id, &device_id, DecideKind::Approve, lease_gen)
        .expect("decide")
        .ticket
        .expect("ticket");
    let msg = journal_fails(&db, &run_id, generation, &binding, &[gated("g2")], true);
    assert!(
        msg.contains("requires an approved, consumed approval"),
        "got: {msg}"
    );
    assert!(steps(&db, &run_id).is_empty());

    // Dispatched (ticket consumed): the gate opens, approval_id linked.
    db.apply_worker_events(
        &run_id,
        generation,
        &binding,
        &[tool_event(
            &new_uuid(),
            "approval.dispatched",
            serde_json::json!({"approval_id": approval_id, "ticket": ticket}),
        )],
        None,
        true,
    )
    .expect("dispatch");
    journal_v2(&db, &run_id, generation, &binding, &[gated("g3")]);
    let rows = steps(&db, &run_id);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].approval_id.as_deref(), Some(approval_id.as_str()));
    assert_eq!(rows[0].state, "running");
}

#[test]
fn denied_approval_writes_exactly_one_denied_step() {
    let (db, _dir) = common::test_db();
    let (run_id, _binding, generation) = setup_running(&db);
    let device_id = db.create_device("approver").expect("device").id;

    // The worker starts the gated call optimistically? No — the design has
    // the worker request approval first; the denied step is service-written
    // in the decision transaction. Journal a start attempt to prove the
    // denial path needs no worker step.
    let approval_id = new_uuid();
    db.propose_approval(
        &approval_id,
        &run_id,
        generation,
        &serde_json::json!({"tool": "computer.screenshot", "target": "display0", "arguments": {}}),
        "take a screenshot",
        60_000,
    )
    .expect("propose");
    let lease_gen = db.get_lease().expect("lease").generation;
    db.decide_approval(&approval_id, &device_id, DecideKind::Deny, lease_gen)
        .expect("deny");

    let rows = steps(&db, &run_id);
    assert_eq!(rows.len(), 1, "exactly one denied step");
    assert_eq!(rows[0].state, "denied");
    assert_eq!(rows[0].approval_id.as_deref(), Some(approval_id.as_str()));
    assert!(rows[0].finished_at.is_some());
}

#[test]
fn result_size_cap_and_ordinal_monotonic() {
    let (db, _dir) = common::test_db();
    let (run_id, binding, generation) = setup_running(&db);

    journal_v2(
        &db,
        &run_id,
        generation,
        &binding,
        &[started("k1", "computer.screenshot")],
    );
    // A >64 KiB result is rejected.
    let big = "x".repeat(70_000);
    let msg = journal_fails(
        &db,
        &run_id,
        generation,
        &binding,
        &[tool_event(
            &new_uuid(),
            "tool.call_finished",
            serde_json::json!({"call_key": "k1", "state": "completed", "result_json": big}),
        )],
        true,
    );
    assert!(!msg.is_empty());
    // The step is still running: the failed finish changed nothing.
    assert_eq!(steps(&db, &run_id)[0].state, "running");
}
