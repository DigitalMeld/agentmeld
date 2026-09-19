// Phase 3 deterministic harness: the full approval path against a real
// SQLite file, driven by the injected Db clock. No sleeps, no network, no
// worker process. The supervisor's seam behavior is covered by
// supervisor_seam.rs; this file proves the database semantics the seam
// stands on: proposal, decision, expiry, fencing, revocation, takeover,
// restart recovery, and exactly-once ticket redemption.
mod common;

use std::sync::Arc;

use agentmeld_server::approvals::{
    sweep_once, ApprovalOutcome, ApprovalState, DecideError, DecideKind, LeaseError, LeaseState,
    PendingApprovals, ProposeError, RevokeError,
};
use agentmeld_server::db::{AdmitInput, Db};
use agentmeld_server::domain::{new_uuid, RunStatus};
use agentmeld_server::seam::{Binding, WorkerEvent};

fn action() -> serde_json::Value {
    serde_json::json!({
        "tool": "computer.screenshot",
        "target": "display0",
        "arguments": {},
    })
}

fn binding() -> Binding {
    Binding {
        image_digest: "img".to_string(),
        store_instance: "store".to_string(),
        model: "model".to_string(),
        policy_digest: "policy".to_string(),
    }
}

/// An enrolled device plus an admitted, claimed, begun turn. Returns
/// (run_id, generation, device_id). The lease starts in `agent` from
/// bootstrap, so begin_turn succeeds.
fn setup_turn(db: &Arc<Db>) -> (String, i64, String) {
    let device_id = db.create_device("harness").expect("create device").id;
    let run_id = db
        .admit(
            &AdmitInput {
                conversation_id: None,
                prompt: "approval probe".to_string(),
                request_key: new_uuid(),
                files: vec![],
            },
            "owner",
        )
        .expect("admit")
        .run_id;
    db.claim_queued_run().expect("claim").expect("claimed run");
    let generation = db.begin_turn(&run_id).expect("begin turn").generation;
    (run_id, generation, device_id)
}

fn propose(db: &Arc<Db>, run_id: &str, generation: i64, ttl_ms: i64) -> String {
    let id = new_uuid();
    db.propose_approval(
        &id,
        run_id,
        generation,
        &action(),
        "take a screenshot",
        ttl_ms,
    )
    .expect("propose")
    .id
}

fn dispatched(approval_id: &str, ticket: &str) -> WorkerEvent {
    WorkerEvent {
        event_id: new_uuid(),
        event_type: "approval.dispatched".to_string(),
        dedupe_key: None,
        payload: serde_json::json!({"approval_id": approval_id, "ticket": ticket}),
    }
}

fn lease_generation(db: &Arc<Db>) -> i64 {
    db.get_lease().expect("lease").generation
}

#[test]
fn proposal_registers_pending_and_parks_run() {
    let (db, dir) = common::test_db();
    let (run_id, generation, _device) = setup_turn(&db);

    let id = propose(&db, &run_id, generation, 60_000);
    let row = db.get_approval(&id).expect("read").expect("row");
    assert_eq!(row.state, ApprovalState::Pending);
    assert_eq!(
        db.get_run(&run_id).expect("run").status,
        RunStatus::WaitingApproval
    );

    // One pending approval per run: a second proposal is rejected, never
    // queued behind the first.
    assert!(matches!(
        db.propose_approval(&new_uuid(), &run_id, generation, &action(), "again", 60_000),
        Err(ProposeError::PendingExists)
    ));
    // A stale generation is rejected too.
    assert!(matches!(
        db.propose_approval(
            &new_uuid(),
            &run_id,
            generation - 1,
            &action(),
            "stale",
            60_000
        ),
        Err(ProposeError::StaleGeneration)
    ));
    common::cleanup(&dir);
}

#[test]
fn approve_wakes_waiter_with_ticket_and_resumes_run() {
    let (db, dir) = common::test_db();
    let (run_id, generation, device_id) = setup_turn(&db);
    let pending = Arc::new(PendingApprovals::new());

    let id = propose(&db, &run_id, generation, 60_000);
    let (tx, rx) = tokio::sync::oneshot::channel();
    pending.register(&id, tx);

    let decided = db
        .decide_approval(&id, &device_id, DecideKind::Approve, lease_generation(&db))
        .expect("decide");
    assert_eq!(decided.state, ApprovalState::Approved);
    let ticket = decided.ticket.clone().expect("ticket issued");
    // The HTTP handler resolves the waiter with the returned outcome;
    // the harness does the same so the blocked wait unblocks.
    pending.resolve(&id, decided.outcome);

    // The waiter carries the internal outcome — including the raw ticket —
    // which is why the HTTP receipt must never include it.
    match rx.blocking_recv().expect("waiter resolved") {
        ApprovalOutcome::Approved {
            ticket: t,
            digest,
            decided_at_ms,
        } => {
            assert_eq!(t, ticket);
            assert_eq!(digest, decided.digest);
            assert_eq!(decided_at_ms, decided.decided_at_ms);
        }
        other => panic!("unexpected outcome: {other:?}"),
    }
    // The run goes back to work: approval is a pause, not a death.
    assert_eq!(db.get_run(&run_id).expect("run").status, RunStatus::Running);
    // The receipt the HTTP layer returns carries state only, never the
    // ticket: the ticket_hash at rest must not equal the raw ticket.
    let row = db.get_approval(&id).expect("read").expect("row");
    assert_ne!(row.ticket_hash.as_deref(), Some(ticket.as_str()));
    common::cleanup(&dir);
}

#[test]
fn waiter_registered_before_publication_cannot_miss_decision() {
    // Pins the supervisor's propose order: the waiter exists before the
    // approval row is visible, so a decision that lands the instant the
    // row commits is always delivered. Under the old commit-then-register
    // order the outcome — including the unrecoverable raw ticket — could
    // be dropped and the turn wedged.
    let (db, dir) = common::test_db();
    let (run_id, generation, device_id) = setup_turn(&db);
    let pending = Arc::new(PendingApprovals::new());

    let id = new_uuid();
    let (tx, rx) = tokio::sync::oneshot::channel();
    pending.register(&id, tx);
    db.propose_approval(
        &id,
        &run_id,
        generation,
        &action(),
        "take a screenshot",
        60_000,
    )
    .expect("propose");

    // The decision lands immediately after publication — the worst case
    // for the old order.
    let decided = db
        .decide_approval(&id, &device_id, DecideKind::Approve, lease_generation(&db))
        .expect("decide");
    let ticket = decided.ticket.clone().expect("ticket");
    assert!(pending.resolve(&id, decided.outcome));
    match rx.blocking_recv().expect("waiter resolved") {
        ApprovalOutcome::Approved { ticket: t, .. } => assert_eq!(t, ticket),
        other => panic!("unexpected outcome: {other:?}"),
    }
    common::cleanup(&dir);
}

#[test]
fn deny_settles_without_ticket_and_run_continues() {
    let (db, dir) = common::test_db();
    let (run_id, generation, device_id) = setup_turn(&db);
    let pending = Arc::new(PendingApprovals::new());

    let id = propose(&db, &run_id, generation, 60_000);
    let (tx, rx) = tokio::sync::oneshot::channel();
    pending.register(&id, tx);

    let decided = db
        .decide_approval(&id, &device_id, DecideKind::Deny, lease_generation(&db))
        .expect("decide");
    assert_eq!(decided.state, ApprovalState::Denied);
    assert!(decided.ticket.is_none());
    pending.resolve(&id, decided.outcome);
    assert!(matches!(
        rx.blocking_recv().expect("waiter resolved"),
        ApprovalOutcome::Denied { .. }
    ));
    // Denied means the action doesn't run; the turn itself continues.
    assert_eq!(db.get_run(&run_id).expect("run").status, RunStatus::Running);
    common::cleanup(&dir);
}

#[test]
fn duplicate_decision_is_rejected() {
    let (db, dir) = common::test_db();
    let (run_id, generation, device_id) = setup_turn(&db);

    let id = propose(&db, &run_id, generation, 60_000);
    let gen = lease_generation(&db);
    db.decide_approval(&id, &device_id, DecideKind::Approve, gen)
        .expect("first decision");
    assert!(matches!(
        db.decide_approval(&id, &device_id, DecideKind::Deny, gen),
        Err(DecideError::AlreadySettled(ApprovalState::Approved))
    ));
    // Unknown ids are 404, not 409.
    assert!(matches!(
        db.decide_approval("nope", &device_id, DecideKind::Deny, gen),
        Err(DecideError::NotFound)
    ));
    common::cleanup(&dir);
}

#[test]
fn expiry_fires_on_server_time_and_fails_run_closed() {
    let (db, dir) = common::test_db();
    db.set_clock_override(1_000_000);
    let (run_id, generation, _device) = setup_turn(&db);
    let pending = Arc::new(PendingApprovals::new());

    let id = propose(&db, &run_id, generation, 5_000);
    let (tx, rx) = tokio::sync::oneshot::channel();
    pending.register(&id, tx);

    // The deadline passes on the service clock — no sleeping.
    db.advance_clock(6_000);
    let expired = sweep_once(&db, &pending).expect("sweep");
    assert_eq!(expired, vec![id.clone()]);
    assert!(matches!(
        rx.blocking_recv().expect("waiter resolved"),
        ApprovalOutcome::Expired
    ));

    let row = db.get_approval(&id).expect("read").expect("row");
    assert_eq!(row.state, ApprovalState::Expired);
    // Fail closed: a turn that waited on an expired approval is
    // abandoned, not resumed.
    assert_eq!(
        db.get_run(&run_id).expect("run").status,
        RunStatus::Interrupted
    );
    // A second sweep is idempotent: nothing more to expire.
    let again = sweep_once(&db, &pending).expect("sweep");
    assert!(again.is_empty());
    db.clear_clock_override();
    common::cleanup(&dir);
}

#[test]
fn lazy_expiry_inside_decision_wins_over_decide() {
    let (db, dir) = common::test_db();
    db.set_clock_override(2_000_000);
    let (run_id, generation, device_id) = setup_turn(&db);
    let pending = Arc::new(PendingApprovals::new());

    let id = propose(&db, &run_id, generation, 5_000);
    let (tx, rx) = tokio::sync::oneshot::channel();
    pending.register(&id, tx);

    db.advance_clock(6_000);
    // The decision arrives after the deadline: the transaction expires
    // the row instead of deciding it. The caller (HTTP layer) must
    // resolve the waiter — emulated here.
    assert!(matches!(
        db.decide_approval(&id, &device_id, DecideKind::Approve, lease_generation(&db)),
        Err(DecideError::Expired)
    ));
    pending.resolve(&id, ApprovalOutcome::Expired);
    assert!(matches!(
        rx.blocking_recv().expect("waiter resolved"),
        ApprovalOutcome::Expired
    ));
    assert_eq!(
        db.get_approval(&id).expect("read").expect("row").state,
        ApprovalState::Expired
    );
    db.clear_clock_override();
    common::cleanup(&dir);
}

#[test]
fn digest_mismatch_revokes_instead_of_deciding() {
    let (db, dir) = common::test_db();
    let (run_id, generation, device_id) = setup_turn(&db);

    let id = propose(&db, &run_id, generation, 60_000);
    // Tamper with the stored action behind the proposal's back.
    db.test_corrupt_approval_action(
        &id,
        r#"{"tool":"computer.screenshot","target":"display0","arguments":{"evil":true}}"#,
    )
    .expect("tamper");

    assert!(matches!(
        db.decide_approval(&id, &device_id, DecideKind::Approve, lease_generation(&db)),
        Err(DecideError::DigestMismatch)
    ));
    // ChangedAction is terminal: revoked, never approved, never left
    // decidable.
    let row = db.get_approval(&id).expect("read").expect("row");
    assert_eq!(row.state, ApprovalState::Revoked);
    assert_eq!(row.revoked_reason.as_deref(), Some("digest_mismatch"));
    common::cleanup(&dir);
}

#[test]
fn stale_lease_generation_rejects_decision() {
    let (db, dir) = common::test_db();
    let phone = db.create_device("phone").expect("phone").id;
    let stale_gen = lease_generation(&db);

    // A takeover cycle bumps the lease generation with no approvals in
    // flight: takeover (straight to human, no live turn) -> private ->
    // resume -> observed, back to agent.
    db.lease_takeover(&phone, false, None).expect("takeover");
    let g2 = lease_generation(&db);
    let begun = db
        .lease_private_begin(&phone, g2, None)
        .expect("private begin");
    db.lease_private_end(&phone, begun.lease.generation, None)
        .expect("private end");
    let g3 = lease_generation(&db);
    db.lease_resume(&phone, g3, None).expect("resume");
    db.lease_note_observed("digest-1").expect("observed");
    assert_eq!(db.get_lease().expect("lease").state, LeaseState::Agent);

    // The worker turns and proposes under the NEW generation...
    let (run_id, generation, device_id) = setup_turn(&db);
    let id = propose(&db, &run_id, generation, 60_000);
    // ...but the human's panel still shows the old one: rejected, and
    // the row is left untouched so a fresh read can decide it.
    assert!(matches!(
        db.decide_approval(&id, &device_id, DecideKind::Approve, stale_gen),
        Err(DecideError::StaleLease)
    ));
    assert_eq!(
        db.get_approval(&id).expect("read").expect("row").state,
        ApprovalState::Pending
    );
    let decided = db
        .decide_approval(&id, &device_id, DecideKind::Approve, lease_generation(&db))
        .expect("decide with fresh generation");
    assert_eq!(decided.state, ApprovalState::Approved);
    common::cleanup(&dir);
}

#[test]
fn device_revocation_settles_approval_surface() {
    let (db, dir) = common::test_db();
    let (run_id, generation, device_id) = setup_turn(&db);
    let pending = Arc::new(PendingApprovals::new());

    let id = propose(&db, &run_id, generation, 60_000);
    let (tx, rx) = tokio::sync::oneshot::channel();
    pending.register(&id, tx);

    let rev = db.revoke_device_and_settle(&device_id).expect("revoke");
    assert_eq!(rev.approvals_settled, 1);
    assert_eq!(rev.settled_approval_ids, vec![id.clone()]);
    // The caller (HTTP layer) resolves waiters from the returned ids.
    for aid in &rev.settled_approval_ids {
        pending.resolve(aid, ApprovalOutcome::Revoked);
    }
    assert!(matches!(
        rx.blocking_recv().expect("waiter resolved"),
        ApprovalOutcome::Revoked
    ));

    let row = db.get_approval(&id).expect("read").expect("row");
    assert_eq!(row.state, ApprovalState::Revoked);
    assert_eq!(row.revoked_reason.as_deref(), Some("device_revoked"));
    // Revoking an unknown device is a 404-shaped error, not a settle.
    assert!(db.revoke_device_and_settle("ghost").is_err());
    common::cleanup(&dir);
}

#[test]
fn takeover_sequence_parks_and_releases_lease() {
    let (db, dir) = common::test_db();
    let (run_id, generation, device_id) = setup_turn(&db);
    let holder = db.create_device("phone").expect("phone").id;

    // The phone seizes the computer while a turn is live: pausing, and
    // the pending approval dies with lease_takeover.
    let id = propose(&db, &run_id, generation, 60_000);
    let outcome = db.lease_takeover(&holder, true, None).expect("takeover");
    assert_eq!(outcome.lease.state, LeaseState::Pausing);
    assert_eq!(
        outcome.lease.holder_device_id.as_deref(),
        Some(holder.as_str())
    );
    assert!(outcome.killed_active_turn);
    assert_eq!(outcome.revoked_approval_ids, vec![id.clone()]);
    let g1 = outcome.lease.generation;

    // A device that wasn't there for the takeover can't ack it.
    assert!(matches!(
        db.lease_takeover_ack(&device_id, g1, None),
        Err(LeaseError::NotHolder)
    ));
    // ...nor ack a stale generation.
    assert!(matches!(
        db.lease_takeover_ack(&holder, g1 - 1, None),
        Err(LeaseError::StaleLease)
    ));
    // The worker winds down; the phone takes the computer as a human.
    let acked = db.lease_takeover_ack(&holder, g1, None).expect("ack");
    assert_eq!(acked.lease.state, LeaseState::Human);
    let g2 = acked.lease.generation;
    assert!(g2 > g1);

    // Private bracket: credentials go in, heartbeat keeps the hold alive,
    // and the bracket closes before resume.
    let begun = db
        .lease_private_begin(&holder, g2, None)
        .expect("private begin");
    assert!(begun.lease.private_bracket);
    let g3 = begun.lease.generation;
    assert!(matches!(
        db.lease_resume(&holder, g3, None),
        Err(LeaseError::WrongState(_))
    ));
    db.lease_private_end(&holder, g3, None)
        .expect("private end");
    let resumed = db.lease_resume(&holder, g3 + 1, None).expect("resume");
    assert_eq!(resumed.lease.state, LeaseState::Resuming);

    // The worker re-observes (run.resumed): resuming -> agent, holder
    // cleared, the computer belongs to the agent again.
    let observed = db.lease_note_observed("obs-digest-1").expect("observed");
    assert_eq!(observed.lease.state, LeaseState::Agent);
    assert!(observed.lease.holder_device_id.is_none());
    common::cleanup(&dir);
}

#[test]
fn lease_heartbeat_fencing_and_auto_release() {
    let (db, dir) = common::test_db();
    db.set_clock_override(3_000_000);
    let holder = db.create_device("phone").expect("phone").id;

    // Takeover with no live turn: straight to human.
    let outcome = db.lease_takeover(&holder, false, None).expect("takeover");
    assert_eq!(outcome.lease.state, LeaseState::Human);
    let gen = outcome.lease.generation;

    // Heartbeat on a stale generation is rejected: re-read and retry.
    assert!(matches!(
        db.lease_heartbeat(&holder, gen - 1),
        Err(LeaseError::StaleLease)
    ));
    // A non-holder's heartbeat is rejected even with the right generation.
    let stranger = db.create_device("stranger").expect("stranger").id;
    assert!(matches!(
        db.lease_heartbeat(&stranger, gen),
        Err(LeaseError::NotHolder)
    ));
    db.lease_heartbeat(&holder, gen).expect("heartbeat");

    // Five minutes without a heartbeat: the hold auto-releases and the
    // computer returns to the agent. No sleep — the clock is injected.
    db.advance_clock(6 * 60 * 1000);
    let released = db.get_lease().expect("lease");
    assert_eq!(released.state, LeaseState::Agent);
    assert!(released.holder_device_id.is_none());
    // The zombie's late heartbeat is NotHolder, not a silent re-accept.
    assert!(matches!(
        db.lease_heartbeat(&holder, released.generation),
        Err(LeaseError::NotHolder)
    ));
    db.clear_clock_override();
    common::cleanup(&dir);
}

#[test]
fn startup_recovery_settles_everything_pending() {
    let (db, dir) = common::test_db();
    db.set_clock_override(4_000_000);

    // Case A: pending approval on an interrupted run — the worker is
    // gone; revoked regardless of the deadline.
    let (run_a, gen_a, _) = setup_turn(&db);
    let id_a = propose(&db, &run_a, gen_a, 60_000);
    db.mark_interrupted(&run_a, "worker died")
        .expect("interrupt");

    // Case B: pending approval past its deadline — normal expiry.
    let (run_b, gen_b, _) = setup_turn(&db);
    let id_b = propose(&db, &run_b, gen_b, 1_000);
    db.advance_clock(2_000);

    // Case C: fresh pending approval on a live run. The lease fence
    // would make it undecidable, so recovery revokes it too and fails
    // the run closed — no pending-but-undecidable row may survive a
    // restart (design §7: never resume a turn mid-approval).
    let (run_c, gen_c, _) = setup_turn(&db);
    let id_c = propose(&db, &run_c, gen_c, 60_000);

    let (revoked, expired, lease_gen) = db.recover_approvals_on_startup().expect("recover");
    assert_eq!(revoked, 2);
    assert_eq!(expired, 1);
    assert!(lease_gen > 0);

    let row_a = db.get_approval(&id_a).expect("read").expect("row");
    assert_eq!(row_a.state, ApprovalState::Revoked);
    assert_eq!(row_a.revoked_reason.as_deref(), Some("service_restart"));
    let row_b = db.get_approval(&id_b).expect("read").expect("row");
    assert_eq!(row_b.state, ApprovalState::Expired);
    let row_c = db.get_approval(&id_c).expect("read").expect("row");
    assert_eq!(row_c.state, ApprovalState::Revoked);
    assert_eq!(row_c.revoked_reason.as_deref(), Some("service_restart"));
    assert_eq!(
        db.get_run(&run_c).expect("run").status,
        RunStatus::Interrupted
    );

    // The lease is fenced off: after a restart the computer belongs to
    // the agent until a human explicitly takes over again.
    let lease = db.get_lease().expect("lease");
    assert_eq!(lease.state, LeaseState::Agent);
    assert_eq!(lease.generation, lease_gen);
    db.clear_clock_override();
    common::cleanup(&dir);
}

#[test]
fn ticket_redemption_is_exactly_once() {
    let (db, dir) = common::test_db();
    let (run_id, generation, device_id) = setup_turn(&db);

    let id = propose(&db, &run_id, generation, 60_000);
    let decided = db
        .decide_approval(&id, &device_id, DecideKind::Approve, lease_generation(&db))
        .expect("decide");
    let ticket = decided.ticket.expect("ticket");

    // The worker dispatches: the ticket is claimed atomically and the
    // event is journalled.
    let outcome = db
        .apply_worker_events(
            &run_id,
            generation,
            &binding(),
            &[dispatched(&id, &ticket)],
            None,
            false,
        )
        .expect("dispatch");
    assert_eq!(outcome.stored.len(), 1);
    let row = db.get_approval(&id).expect("read").expect("row");
    assert!(row.consumed_at.is_some());

    // A second dispatch with the same ticket fails closed: the event is
    // never journalled twice and the turn dies on ticket_reused.
    let err = match db.apply_worker_events(
        &run_id,
        generation,
        &binding(),
        &[dispatched(&id, &ticket)],
        None,
        false,
    ) {
        Ok(_) => panic!("double dispatch must fail"),
        Err(e) => e,
    };
    assert_eq!(err.message, "ticket_reused");

    // A wrong ticket fails too — and the transaction rolls back, so the
    // failed claim leaves no journal trace.
    let (run_id2, gen2, device2) = setup_turn(&db);
    let id2 = propose(&db, &run_id2, gen2, 60_000);
    db.decide_approval(&id2, &device2, DecideKind::Approve, lease_generation(&db))
        .expect("decide2");
    let err = match db.apply_worker_events(
        &run_id2,
        gen2,
        &binding(),
        &[dispatched(&id2, "wrong-ticket")],
        None,
        false,
    ) {
        Ok(_) => panic!("bad ticket must fail"),
        Err(e) => e,
    };
    assert_eq!(err.message, "ticket_mismatch");

    // A ticket presented by a different run's turn is rejected: tickets
    // are bound to the run whose worker was blocked on the approval.
    let err = match db.apply_worker_events(
        &run_id2,
        gen2,
        &binding(),
        &[dispatched(&id, &ticket)],
        None,
        false,
    ) {
        Ok(_) => panic!("cross-run dispatch must fail"),
        Err(e) => e,
    };
    assert_eq!(err.message, "ticket_mismatch");
    common::cleanup(&dir);
}

#[test]
fn revoke_pending_settles_and_records_reason() {
    let (db, dir) = common::test_db();
    let (run_id, generation, device_id) = setup_turn(&db);

    let id = propose(&db, &run_id, generation, 60_000);
    let revoked = db.revoke_approval(&id, &device_id).expect("revoke pending");
    assert!(revoked.was_pending);
    assert!(!revoked.already_dispatched);
    assert_eq!(revoked.revoked_reason, "user_revoked");

    let row = db.get_approval(&id).expect("read").expect("row");
    assert_eq!(row.state, ApprovalState::Revoked);
    assert_eq!(row.revoked_reason.as_deref(), Some("user_revoked"));

    // The journal carries approval.revoked so the stream and the history
    // UI observe the revocation.
    let events = db.stream_events_after(0, 100).expect("stream");
    assert!(
        events
            .iter()
            .any(|e| e.kind == "approval.revoked" && e.id == format!("{id}:approval.revoked")),
        "approval.revoked journalled"
    );
    common::cleanup(&dir);
}

#[test]
fn revoke_approved_kills_the_execution_ticket() {
    let (db, dir) = common::test_db();
    let (run_id, generation, device_id) = setup_turn(&db);

    let id = propose(&db, &run_id, generation, 60_000);
    let decided = db
        .decide_approval(&id, &device_id, DecideKind::Approve, lease_generation(&db))
        .expect("decide");
    let ticket = decided.ticket.expect("ticket");

    let revoked = db.revoke_approval(&id, &device_id).expect("revoke");
    assert_eq!(revoked.revoked_reason, "user_revoked");
    assert!(!revoked.was_pending);
    assert!(!revoked.already_dispatched);

    // The ticket dies with the grant: claim_ticket requires state='approved'.
    let err = match db.apply_worker_events(
        &run_id,
        generation,
        &binding(),
        &[dispatched(&id, &ticket)],
        None,
        false,
    ) {
        Ok(_) => panic!("dispatch after revoke must fail"),
        Err(e) => e,
    };
    assert_eq!(err.message, "ticket_not_approved");
    common::cleanup(&dir);
}

#[test]
fn revoke_approved_after_dispatch_reports_honestly() {
    let (db, dir) = common::test_db();
    let (run_id, generation, device_id) = setup_turn(&db);

    let id = propose(&db, &run_id, generation, 60_000);
    let decided = db
        .decide_approval(&id, &device_id, DecideKind::Approve, lease_generation(&db))
        .expect("decide");
    let ticket = decided.ticket.expect("ticket");
    db.apply_worker_events(
        &run_id,
        generation,
        &binding(),
        &[dispatched(&id, &ticket)],
        None,
        false,
    )
    .expect("dispatch");

    // The action already ran; revoking now is a recorded "I take it back".
    let revoked = db.revoke_approval(&id, &device_id).expect("revoke");
    assert!(revoked.already_dispatched);
    let row = db.get_approval(&id).expect("read").expect("row");
    assert_eq!(row.state, ApprovalState::Revoked);
    common::cleanup(&dir);
}

#[test]
fn revoke_terminal_and_unknown_fail_cleanly() {
    let (db, dir) = common::test_db();
    let (run_id, generation, device_id) = setup_turn(&db);

    assert!(matches!(
        db.revoke_approval("nope", &device_id),
        Err(RevokeError::NotFound)
    ));

    let id = propose(&db, &run_id, generation, 60_000);
    db.revoke_approval(&id, &device_id).expect("first revoke");
    // Second revoke: the row is terminal.
    assert!(matches!(
        db.revoke_approval(&id, &device_id),
        Err(RevokeError::AlreadySettled(ApprovalState::Revoked))
    ));
    common::cleanup(&dir);
}
