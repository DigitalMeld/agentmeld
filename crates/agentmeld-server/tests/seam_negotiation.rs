// Phase 4: worker-seam protocol negotiation. v1 stays compatible,
// v2 is negotiated when offered, future versions negotiate down to our
// max, and anything outside the worker-seam family is rejected. After
// the handshake the session pins the negotiated protocol; post-hello
// frames carrying a different protocol are rejected.
use agentmeld_server::seam::{
    negotiate_protocol, WorkerMessage, MAX_PROTOCOL, PROTOCOL_V1, PROTOCOL_V2,
};
use serde_json::json;

fn hello(protocol: &str) -> serde_json::Value {
    json!({
        "protocol": protocol,
        "msg_id": "hello-1",
        "msg_type": "worker.session.hello",
        "worker_pid": 1234,
        "worker_token": "secret",
    })
}

#[test]
fn v1_negotiates_to_v1() {
    assert_eq!(negotiate_protocol(PROTOCOL_V1), Ok(PROTOCOL_V1));
}

#[test]
fn v2_negotiates_to_v2() {
    assert_eq!(negotiate_protocol(PROTOCOL_V2), Ok(PROTOCOL_V2));
}

#[test]
fn future_version_negotiates_down_to_max() {
    assert_eq!(negotiate_protocol("worker-seam/9"), Ok(MAX_PROTOCOL));
    assert_eq!(MAX_PROTOCOL, PROTOCOL_V2);
}

#[test]
fn non_seam_protocol_is_rejected() {
    assert!(negotiate_protocol("grpc/1").is_err());
    assert!(negotiate_protocol("").is_err());
}

#[test]
fn hello_check_pins_negotiated_protocol() {
    let (parsed, negotiated) = WorkerMessage::parse_hello(hello(PROTOCOL_V2)).expect("v2 hello");
    assert_eq!(negotiated, PROTOCOL_V2);
    assert_eq!(parsed.msg_type, "worker.session.hello");

    let (_, negotiated) = WorkerMessage::parse_hello(hello(PROTOCOL_V1)).expect("v1 hello");
    assert_eq!(negotiated, PROTOCOL_V1);
}

#[test]
fn hello_rejects_unknown_and_future_protocols() {
    assert!(WorkerMessage::parse_hello(hello("grpc/1")).is_err());
    // A future worker-seam version negotiates down at the seam level...
    let (_, negotiated) =
        WorkerMessage::parse_hello(hello("worker-seam/9")).expect("future negotiates down");
    assert_eq!(negotiated, MAX_PROTOCOL);
}

#[test]
fn post_hello_frame_must_carry_pinned_protocol() {
    let frame = |protocol: &str| {
        serde_json::json!({
            "protocol": protocol,
            "msg_id": "m-1",
            "msg_type": "worker.events.append",
            "run_id": "r",
            "generation": 1,
            "events": [],
        })
    };
    // v2 session, v2 frame: fine.
    assert!(WorkerMessage::parse(frame(PROTOCOL_V2), PROTOCOL_V2).is_ok());
    // v2 session, v1 frame: rejected — no smuggling v2 types into v1.
    assert!(WorkerMessage::parse(frame(PROTOCOL_V1), PROTOCOL_V2).is_err());
    // v1 session, v2 frame: rejected.
    assert!(WorkerMessage::parse(frame(PROTOCOL_V2), PROTOCOL_V1).is_err());
}
