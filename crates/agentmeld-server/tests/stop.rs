// Stop semantics: a stop that lands while the turn is still in setup
// (status 'starting') moves the run to cancelling, and the supervisor's
// pre-spawn check resolves it as cancelled without spawning a worker.
mod common;

use agentmeld_server::db::{AdmitInput, Db, StopOutcome};
use agentmeld_server::domain::new_uuid;
use std::sync::Arc;

fn admit_starting(db: &Arc<Db>) -> String {
    let run_id = db
        .admit(
            &AdmitInput {
                conversation_id: None,
                prompt: "stop me during setup".to_string(),
                request_key: new_uuid(),
                files: vec![],
            },
            "owner",
        )
        .expect("admit")
        .run_id;
    db.claim_queued_run().expect("claim").expect("claimed");
    run_id
}

#[test]
fn stop_during_starting_marks_cancelling() {
    let (db, dir) = common::test_db();
    let run_id = admit_starting(&db);

    // The supervisor registered the turn before setup, so its active run
    // id matches: the stop is accepted, not a 409.
    let outcome = db
        .stop_task(&run_id, Some(&run_id))
        .expect("stop during starting");
    assert!(
        matches!(outcome, StopOutcome::RequestedRunning),
        "starting turn stop requests a running cancel"
    );
    assert_eq!(
        db.get_run(&run_id).expect("read").status.as_str(),
        "cancelling"
    );

    // The supervisor's pre-spawn check sees cancelling and resolves the
    // run as cancelled without ever spawning.
    db.cancel_before_spawn(&run_id).expect("setup cancel");
    assert_eq!(
        db.get_run(&run_id).expect("read").status.as_str(),
        "cancelled"
    );
    common::cleanup(&dir);
}

#[test]
fn stop_without_active_turn_is_409() {
    let (db, dir) = common::test_db();
    let run_id = admit_starting(&db);

    // No active turn registered (e.g. the pump hasn't picked it up yet):
    // the client gets the retry message, not a phantom cancel.
    let err = db
        .stop_task(&run_id, None)
        .expect_err("stop with no active turn");
    assert_eq!(err.status, 409);
    common::cleanup(&dir);
}

#[test]
fn stop_queued_cancels_immediately() {
    let (db, dir) = common::test_db();
    let run_id = db
        .admit(
            &AdmitInput {
                conversation_id: None,
                prompt: "queued stop".to_string(),
                request_key: new_uuid(),
                files: vec![],
            },
            "owner",
        )
        .expect("admit")
        .run_id;
    let outcome = db.stop_task(&run_id, None).expect("stop queued");
    assert!(matches!(outcome, StopOutcome::CancelledQueued));
    assert_eq!(
        db.get_run(&run_id).expect("read").status.as_str(),
        "cancelled"
    );
    common::cleanup(&dir);
}
