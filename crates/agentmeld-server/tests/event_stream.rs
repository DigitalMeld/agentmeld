// Phase 4: SSE event stream — envelope shape, cursor rules, heartbeat,
// queue overflow, exclusions, revocation, and the execution-ticket scan.
mod common;

use agentmeld_server::auth::Auth;
use agentmeld_server::db::{AdmitInput, Db};
use agentmeld_server::domain::{new_uuid, sha256_hex};
use agentmeld_server::events::{resolve_cursor, CursorSource, StreamConfig};
use agentmeld_server::seam::{Binding, WorkerEvent};
use std::sync::Arc;
use std::time::Duration;
use tokio_stream::StreamExt as _;

fn setup_running(db: &Arc<Db>) -> (String, String, Binding, i64) {
    let run_id = db
        .admit(
            &AdmitInput {
                conversation_id: None,
                prompt: "stream probe".to_string(),
                request_key: new_uuid(),
                files: vec![],
            },
            "owner",
        )
        .expect("admit")
        .run_id;
    let claimed = db.claim_queued_run().expect("claim").expect("claimed run");
    let conv_id = claimed.conversation_id.clone();
    let generation = db.begin_turn(&run_id).expect("begin turn").generation;
    let binding = Binding {
        image_digest: "img".to_string(),
        store_instance: "store".to_string(),
        model: "model".to_string(),
        policy_digest: "policy".to_string(),
    };
    (run_id, conv_id, binding, generation)
}

fn event(id: &str, kind: &str, payload: serde_json::Value) -> WorkerEvent {
    WorkerEvent {
        event_id: id.to_string(),
        event_type: kind.to_string(),
        dedupe_key: None,
        payload,
    }
}

fn journal(db: &Arc<Db>, run_id: &str, generation: i64, binding: &Binding, events: &[WorkerEvent]) {
    db.apply_worker_events(run_id, generation, binding, events, None, true)
        .expect("journal");
}

/// A device session the producer can recheck on heartbeat. Returns the
/// `Authorization` header value and the device id (for revocation tests).
fn bearer(db: &Arc<Db>) -> (String, String) {
    let device_id = db.create_device("stream-test").expect("device").id;
    let token = new_uuid();
    db.create_session(&device_id, &sha256_hex(token.as_bytes()), None)
        .expect("session");
    (format!("Bearer {token}"), device_id)
}

async fn next_frame(rx: &mut tokio_stream::wrappers::ReceiverStream<String>) -> String {
    tokio::time::timeout(Duration::from_secs(10), rx.next())
        .await
        .expect("frame in time")
        .expect("stream open")
}

/// Split an SSE frame into its field lines.
fn fields(frame: &str) -> Vec<(&str, &str)> {
    frame
        .trim_end_matches('\n')
        .split('\n')
        .filter_map(|l| l.split_once(": "))
        .collect()
}

fn data_payload(frame: &str) -> serde_json::Value {
    let data = fields(frame)
        .into_iter()
        .find(|(k, _)| *k == "data")
        .map(|(_, v)| v)
        .expect("data field");
    serde_json::from_str(data).expect("envelope json")
}

// ---------------------------------------------------------- cursor rules.

#[test]
fn resolve_cursor_defaults_last_event_id_wins_and_rejects() {
    // No cursor: replay the latest 200.
    let (src, cur) = resolve_cursor(None, None, 1000).expect("default");
    assert_eq!(src, CursorSource::Default);
    assert_eq!(cur, 800);

    // Below 200 rows the default clamps at zero, never negative.
    let (_, cur) = resolve_cursor(None, None, 50).expect("default");
    assert_eq!(cur, 0);

    // Query cursor.
    let (src, cur) = resolve_cursor(None, Some("42"), 1000).expect("query");
    assert_eq!(src, CursorSource::Query);
    assert_eq!(cur, 42);

    // Last-Event-ID wins over ?cursor=.
    let (src, cur) = resolve_cursor(Some("900"), Some("42"), 1000).expect("lei");
    assert_eq!(src, CursorSource::LastEventId);
    assert_eq!(cur, 900);

    // Garbage is a 400, not a silent default.
    let err = resolve_cursor(None, Some("abc"), 1000).expect_err("bad cursor");
    assert_eq!(err.0, 400);
    let err = resolve_cursor(Some("-5"), None, 1000).expect_err("negative");
    assert_eq!(err.0, 400);

    // More than 5000 behind is a 410 with cursor_too_old.
    let err = resolve_cursor(None, Some("0"), 5001).expect_err("too old");
    assert_eq!(err.0, 410);
    assert_eq!(err.1, "cursor_too_old");
    // Exactly at the window is still fine.
    assert!(resolve_cursor(None, Some("0"), 5000).is_ok());
}

// ------------------------------------------------------------ producer.

#[tokio::test]
async fn stream_envelope_shape_order_and_hello() {
    let (db, dir) = common::test_db();
    let (run_id, conv_id, binding, generation) = setup_running(&db);
    journal(
        &db,
        &run_id,
        generation,
        &binding,
        &[
            event("e1", "run.thinking", serde_json::json!({})),
            event("e2", "run.answer_delta", serde_json::json!({"text": "hi"})),
            event("e3", "run.answer_delta", serde_json::json!({"text": "yo"})),
        ],
    );
    let (_authz, device_id) = bearer(&db);
    let cursor = db.max_event_sequence().unwrap() - 3;

    let mut rx = agentmeld_server::events::spawn_event_stream(
        db.clone(),
        device_id.clone(),
        cursor,
        StreamConfig::default(),
    );

    // retry hint first, then the hello carrying the current max sequence.
    assert!(next_frame(&mut rx).await.starts_with("retry: 3000"));
    let hello = next_frame(&mut rx).await;
    assert!(hello.starts_with("event: stream.hello\n"));
    let hello_data = data_payload(&hello);
    assert_eq!(hello_data["current_seq"], db.max_event_sequence().unwrap());

    // Data frames: SSE id is the sequence, envelope carries the full shape,
    // strictly ascending.
    let mut last_seq = 0i64;
    for want_kind in ["run.thinking", "run.answer_delta", "run.answer_delta"] {
        let frame = next_frame(&mut rx).await;
        let f = fields(&frame);
        let sse_id: i64 = f
            .iter()
            .find(|(k, _)| *k == "id")
            .map(|(_, v)| v.parse().unwrap())
            .expect("sse id");
        assert!(sse_id > last_seq);
        last_seq = sse_id;
        let env = data_payload(&frame);
        assert_eq!(env["v"], 1);
        assert_eq!(env["seq"], sse_id);
        assert_eq!(env["type"], want_kind);
        assert_eq!(env["workspace_id"], "default");
        assert_eq!(env["conversation_id"], conv_id);
        assert_eq!(env["run_id"], run_id);
        assert_eq!(env["actor"], "worker");
        assert!(env["ts"].as_i64().unwrap() > 0);
        assert!(!env["id"].as_str().unwrap().is_empty());
    }
    common::cleanup(&dir);
}

#[tokio::test]
async fn stream_replay_is_bounded_and_live_rows_follow() {
    let (db, dir) = common::test_db();
    let (run_id, _conv, binding, generation) = setup_running(&db);
    // run.answer_delta has no milestone side-row, so the 250 journalled
    // events map 1:1 to streamable rows.
    let batch: Vec<WorkerEvent> = (0..250)
        .map(|i| {
            event(
                &format!("e{i}"),
                "run.answer_delta",
                serde_json::json!({"text": "x"}),
            )
        })
        .collect();
    journal(&db, &run_id, generation, &binding, &batch);
    let max = db.max_event_sequence().unwrap();

    let (_authz, device_id) = bearer(&db);
    // The no-cursor default replays the latest 200: cursor = max - 200.
    let mut rx = agentmeld_server::events::spawn_event_stream(
        db.clone(),
        device_id.clone(),
        max - 200,
        StreamConfig::default(),
    );
    assert!(next_frame(&mut rx).await.starts_with("retry:"));
    assert!(next_frame(&mut rx).await.starts_with("event: stream.hello"));

    let mut ids = Vec::new();
    for _ in 0..200 {
        let frame = next_frame(&mut rx).await;
        let sse_id: i64 = fields(&frame)
            .into_iter()
            .find(|(k, _)| *k == "id")
            .map(|(_, v)| v.parse().unwrap())
            .unwrap();
        ids.push(sse_id);
    }
    assert_eq!(ids[0], max - 199);
    assert_eq!(ids[199], max);

    // A row journalled after connect arrives live.
    journal(
        &db,
        &run_id,
        generation,
        &binding,
        &[event(
            "live",
            "run.answer_delta",
            serde_json::json!({"text": "x"}),
        )],
    );
    let frame = next_frame(&mut rx).await;
    let sse_id: i64 = fields(&frame)
        .into_iter()
        .find(|(k, _)| *k == "id")
        .map(|(_, v)| v.parse().unwrap())
        .unwrap();
    assert_eq!(sse_id, max + 1);
    common::cleanup(&dir);
}

#[tokio::test]
async fn stream_heartbeat_ping_and_revocation_close() {
    let (db, dir) = common::test_db();
    let (_run, _conv, _binding, _gen) = setup_running(&db);
    let (_authz, device_id) = bearer(&db);
    let config = StreamConfig {
        heartbeat: Duration::from_millis(50),
        poll_interval: Duration::from_millis(20),
        ..StreamConfig::default()
    };
    let mut rx =
        agentmeld_server::events::spawn_event_stream(db.clone(), device_id.clone(), 0, config);

    assert!(next_frame(&mut rx).await.starts_with("retry:"));
    assert!(next_frame(&mut rx).await.starts_with("event: stream.hello"));
    // The admit journalled run.queued; drain data frames until the
    // heartbeat comment arrives (~50ms).
    let mut saw_ping = false;
    for _ in 0..8 {
        let frame = tokio::time::timeout(Duration::from_secs(10), rx.next())
            .await
            .expect("frame in time")
            .expect("stream open");
        if frame == ":ping\n\n" {
            saw_ping = true;
            break;
        }
        assert!(frame.starts_with("id: "), "unexpected frame: {frame:?}");
    }
    assert!(saw_ping, "heartbeat ping never arrived");

    // Revoking the device closes the stream on the next heartbeat recheck.
    // The in-flight heartbeat may deliver one last ping first (ping is sent
    // before the recheck); either way the stream then ends.
    db.revoke_device_sessions(&device_id).expect("revoke");
    let mut closed = false;
    for _ in 0..4 {
        match tokio::time::timeout(Duration::from_secs(10), rx.next()).await {
            Ok(None) => {
                closed = true;
                break;
            }
            Ok(Some(frame)) => assert_eq!(frame, ":ping\n\n", "unexpected frame: {frame:?}"),
            Err(_) => panic!("stream stalled after revocation"),
        }
    }
    assert!(closed, "revoked device must close the stream");
    common::cleanup(&dir);
}

#[tokio::test]
async fn stream_queue_overflow_sends_resync_and_closes() {
    let (db, dir) = common::test_db();
    let (run_id, _conv, binding, generation) = setup_running(&db);
    let (_authz, device_id) = bearer(&db);
    // Tiny queue: 10 pending rows must trigger resync, not silent drops.
    let config = StreamConfig {
        queue_cap: 4,
        poll_interval: Duration::from_millis(20),
        ..StreamConfig::default()
    };
    let mut rx =
        agentmeld_server::events::spawn_event_stream(db.clone(), device_id.clone(), 0, config);

    assert!(next_frame(&mut rx).await.starts_with("retry:"));
    assert!(next_frame(&mut rx).await.starts_with("event: stream.hello"));
    let batch: Vec<WorkerEvent> = (0..10)
        .map(|i| event(&format!("burst{i}"), "run.thinking", serde_json::json!({})))
        .collect();
    journal(&db, &run_id, generation, &binding, &batch);

    // The client may drain a few frames first; eventually the control frame
    // arrives and the stream closes — never a silent gap.
    let mut saw_resync = false;
    for _ in 0..12 {
        match tokio::time::timeout(Duration::from_secs(10), rx.next()).await {
            Ok(Some(frame)) if frame.starts_with("event: control") => {
                let data = data_payload(&frame);
                assert_eq!(data["type"], "stream.resync_required");
                assert_eq!(data["current_seq"], db.max_event_sequence().unwrap());
                saw_resync = true;
            }
            Ok(Some(_)) => {}
            Ok(None) => break,
            Err(_) => panic!("stream stalled"),
        }
    }
    assert!(saw_resync, "expected stream.resync_required");
    let closed = tokio::time::timeout(Duration::from_secs(10), rx.next()).await;
    assert!(matches!(closed, Ok(None)), "stream must close after resync");
    common::cleanup(&dir);
}

#[tokio::test]
async fn stream_excludes_diagnostic_rows_and_never_leaks_tickets() {
    let (db, dir) = common::test_db();
    let (run_id, _conv, binding, generation) = setup_running(&db);

    // provider_session.bound is stored diagnostic and excluded by kind.
    journal(
        &db,
        &run_id,
        generation,
        &binding,
        &[event(
            "psb",
            "provider_session.bound",
            serde_json::json!({"binding": {
                "image_digest": "img", "store_instance": "store",
                "model": "model", "policy_digest": "policy",
                "thread_id": "thread-1",
            }}),
        )],
    );
    // approval.dispatched carries the plaintext execution ticket and is
    // excluded from the stream by kind. The full propose -> decide ->
    // dispatch flow mints a real ticket.
    let approval_id = new_uuid();
    let device_id = db.create_device("approver").expect("device").id;
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
    let ticket = db
        .decide_approval(
            &approval_id,
            &device_id,
            agentmeld_server::approvals::DecideKind::Approve,
            lease_gen,
        )
        .expect("decide")
        .ticket
        .expect("ticket issued");
    journal(
        &db,
        &run_id,
        generation,
        &binding,
        &[event(
            "ad",
            "approval.dispatched",
            serde_json::json!({"approval_id": approval_id, "ticket": ticket}),
        )],
    );
    // A normal user-visible row is streamed.
    journal(
        &db,
        &run_id,
        generation,
        &binding,
        &[event(
            "ok",
            "run.answer_delta",
            serde_json::json!({"text": "hi"}),
        )],
    );

    let (_authz, device_id) = bearer(&db);
    // Start the cursor after the admit rows. The propose/decide flow
    // journalled approval.requested + approval.settled (both legitimately
    // streamable); the three worker rows follow: five rows total.
    let cursor = db.max_event_sequence().unwrap() - 5;
    let mut rx = agentmeld_server::events::spawn_event_stream(
        db.clone(),
        device_id.clone(),
        cursor,
        StreamConfig::default(),
    );
    assert!(next_frame(&mut rx).await.starts_with("retry:"));
    assert!(next_frame(&mut rx).await.starts_with("event: stream.hello"));

    // Three data frames arrive (approval.requested, approval.settled, the
    // visible row); scan every streamed payload for the ticket — it must
    // never appear, and neither may the excluded kinds.
    let mut frames = Vec::new();
    for _ in 0..3 {
        frames.push(next_frame(&mut rx).await);
    }
    let extra = tokio::time::timeout(Duration::from_millis(300), rx.next()).await;
    assert!(
        matches!(extra, Err(_) | Ok(None)),
        "only user-visible rows may stream, got: {extra:?}"
    );
    let kinds: Vec<String> = frames
        .iter()
        .map(|f| data_payload(f)["type"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        kinds,
        vec!["approval.requested", "approval.settled", "run.answer_delta"]
    );
    for f in &frames {
        assert!(!f.contains(&ticket), "ticket leaked into the stream");
        assert!(!f.contains("approval.dispatched"));
        assert!(!f.contains("provider_session.bound"));
    }
    // Silence, not absence: the excluded rows really were journalled.
    let seqs: Vec<i64> = db
        .stream_events_after(cursor, 1000)
        .expect("stream")
        .into_iter()
        .map(|r| r.seq)
        .collect();
    assert_eq!(seqs.len(), 3, "excluded rows stay out of the stream");
    common::cleanup(&dir);
}

// ------------------------------------------------------------ HTTP layer.

use agentmeld_server::api::{router, AppState};
use agentmeld_server::approvals::PendingApprovals;
use agentmeld_server::supervisor::Supervisor;
use tower::ServiceExt as _;

/// A full app stack for HTTP-level stream tests. The supervisor is never
/// started; only the router + db + auth are exercised.
fn http_app(db: &Arc<Db>, dir: &std::path::Path) -> (axum::Router, String) {
    let pending = Arc::new(PendingApprovals::new());
    let auth = Arc::new(Auth::new(db.clone()));
    let supervisor = Arc::new(Supervisor::new(
        db.clone(),
        dir.to_path_buf(),
        dir.to_path_buf(),
        dir.to_path_buf(),
        pending.clone(),
    ));
    let (kick_tx, _kick_rx) = tokio::sync::mpsc::channel::<()>(16);
    let state = AppState {
        db: db.clone(),
        auth,
        supervisor,
        pending,
        public_dir: dir.to_path_buf(),
        host: "127.0.0.1:4317".to_string(),
        origin: "http://127.0.0.1:4317".to_string(),
        pump_kick: kick_tx,
    };
    (router(state), "127.0.0.1:4317".to_string())
}

fn stream_request(
    host: &str,
    bearer: &str,
    uri: &str,
    last_event_id: Option<&str>,
) -> axum::http::Request<axum::body::Body> {
    let mut builder = axum::http::Request::builder()
        .uri(uri)
        .header("host", host)
        .header("authorization", bearer);
    if let Some(lei) = last_event_id {
        builder = builder.header("last-event-id", lei);
    }
    builder.body(axum::body::Body::empty()).unwrap()
}

/// Read an SSE response body until `want` data frames (envelopes) arrive.
/// Returns the parsed envelopes in order.
async fn read_envelopes(mut body: axum::body::Body, want: usize) -> Vec<serde_json::Value> {
    use http_body_util::BodyExt as _;
    let mut buf = Vec::new();
    let mut envelopes = Vec::new();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
    while envelopes.len() < want {
        let frame = tokio::time::timeout_at(deadline, body.frame())
            .await
            .expect("frame in time")
            .expect("body open")
            .expect("frame ok");
        if let Some(data) = frame.data_ref() {
            buf.extend_from_slice(data);
            // SSE frames are terminated by a blank line.
            while let Some(pos) = buf.windows(2).position(|w| w == b"\n\n") {
                let raw: Vec<u8> = buf.drain(..pos + 2).collect();
                let text = String::from_utf8(raw).expect("sse utf8");
                // Data frames carry `id:`; hello/control/ping do not.
                if text.lines().any(|l| l.starts_with("id: ")) {
                    let data_line = text
                        .lines()
                        .find(|l| l.starts_with("data: "))
                        .expect("data line");
                    let json: serde_json::Value =
                        serde_json::from_str(&data_line["data: ".len()..]).expect("envelope");
                    envelopes.push(json);
                }
            }
        }
    }
    envelopes
}

#[tokio::test]
async fn http_no_cursor_replays_latest_200() {
    let (db, dir) = common::test_db();
    let (run_id, _conv, binding, generation) = setup_running(&db);
    let batch: Vec<WorkerEvent> = (0..250)
        .map(|i| {
            event(
                &format!("e{i}"),
                "run.answer_delta",
                serde_json::json!({"text": "x"}),
            )
        })
        .collect();
    journal(&db, &run_id, generation, &binding, &batch);
    let max = db.max_event_sequence().unwrap();

    let (bearer_token, _device) = bearer(&db);
    let (app, host) = http_app(&db, &dir);
    let res = app
        .oneshot(stream_request(&host, &bearer_token, "/api/v1/events", None))
        .await
        .expect("oneshot");
    assert_eq!(res.status(), 200);
    assert_eq!(res.headers()["content-type"], "text/event-stream");

    let envelopes = read_envelopes(res.into_body(), 200).await;
    assert_eq!(envelopes.len(), 200);
    assert_eq!(envelopes[0]["seq"], max - 199);
    assert_eq!(envelopes[199]["seq"], max);
    // Strictly ascending, all envelope v1.
    for w in envelopes.windows(2) {
        assert!(w[0]["seq"].as_i64().unwrap() < w[1]["seq"].as_i64().unwrap());
        assert_eq!(w[0]["v"], 1);
    }
    common::cleanup(&dir);
}

#[tokio::test]
async fn http_cursor_and_last_event_id_precedence() {
    let (db, dir) = common::test_db();
    let (run_id, _conv, binding, generation) = setup_running(&db);
    let batch: Vec<WorkerEvent> = (0..10)
        .map(|i| {
            event(
                &format!("e{i}"),
                "run.answer_delta",
                serde_json::json!({"text": "x"}),
            )
        })
        .collect();
    journal(&db, &run_id, generation, &binding, &batch);
    let max = db.max_event_sequence().unwrap();

    let (bearer_token, _device) = bearer(&db);
    let (app, host) = http_app(&db, &dir);

    // ?cursor= replays after the cursor.
    let res = app
        .clone()
        .oneshot(stream_request(
            &host,
            &bearer_token,
            &format!("/api/v1/events?cursor={}", max - 3),
            None,
        ))
        .await
        .expect("oneshot");
    assert_eq!(res.status(), 200);
    let envelopes = read_envelopes(res.into_body(), 3).await;
    assert_eq!(envelopes[0]["seq"], max - 2);
    assert_eq!(envelopes[2]["seq"], max);

    // Last-Event-ID wins over ?cursor=.
    let res = app
        .oneshot(stream_request(
            &host,
            &bearer_token,
            &format!("/api/v1/events?cursor={}", max - 3),
            Some(&format!("{}", max - 1)),
        ))
        .await
        .expect("oneshot");
    assert_eq!(res.status(), 200);
    let envelopes = read_envelopes(res.into_body(), 1).await;
    assert_eq!(envelopes[0]["seq"], max);

    // The unversioned alias serves the identical stream.
    let (app2, host2) = http_app(&db, &dir);
    let res = app2
        .oneshot(stream_request(&host2, &bearer_token, "/api/events", None))
        .await
        .expect("oneshot");
    assert_eq!(res.status(), 200);
    assert_eq!(res.headers()["content-type"], "text/event-stream");
    common::cleanup(&dir);
}

#[tokio::test]
async fn http_bad_and_too_old_cursors_rejected() {
    let (db, dir) = common::test_db();
    let (run_id, _conv, binding, generation) = setup_running(&db);
    // One batch of 5100: a single transaction, fast enough for a test.
    let batch: Vec<WorkerEvent> = (0..5100)
        .map(|i| {
            event(
                &format!("e{i}"),
                "run.answer_delta",
                serde_json::json!({"text": "x"}),
            )
        })
        .collect();
    journal(&db, &run_id, generation, &binding, &batch);
    let max = db.max_event_sequence().unwrap();
    assert!(max > 5000);

    let (bearer_token, _device) = bearer(&db);
    let (app, host) = http_app(&db, &dir);

    // Garbage cursor: 400.
    let res = app
        .clone()
        .oneshot(stream_request(
            &host,
            &bearer_token,
            "/api/v1/events?cursor=abc",
            None,
        ))
        .await
        .expect("oneshot");
    assert_eq!(res.status(), 400);

    // More than 5000 behind: 410 with cursor_too_old + current_seq.
    let res = app
        .oneshot(stream_request(
            &host,
            &bearer_token,
            "/api/v1/events?cursor=0",
            None,
        ))
        .await
        .expect("oneshot");
    assert_eq!(res.status(), 410);
    let body = axum::body::to_bytes(res.into_body(), 64 * 1024)
        .await
        .expect("body");
    let json: serde_json::Value = serde_json::from_slice(&body).expect("json");
    assert_eq!(json["code"], "cursor_too_old");
    assert_eq!(json["current_seq"], max);
    common::cleanup(&dir);
}

#[tokio::test]
async fn http_revoked_device_rejected_at_connect() {
    let (db, dir) = common::test_db();
    let (_run, _conv, _binding, _gen) = setup_running(&db);
    let (bearer_token, device_id) = bearer(&db);
    db.revoke_device_sessions(&device_id).expect("revoke");

    let (app, host) = http_app(&db, &dir);
    let res = app
        .oneshot(stream_request(&host, &bearer_token, "/api/v1/events", None))
        .await
        .expect("oneshot");
    // Revoked sessions fail auth: 401 (never a stream).
    assert_eq!(res.status(), 401);
    common::cleanup(&dir);
}
