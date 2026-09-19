// GET /api/v1/session: the authenticated device's own non-secret identity.
// Lets the browser honestly distinguish "controlling on this device" from
// "controlled by another device" when rendering the controller lease.
mod common;

use std::sync::Arc;

use agentmeld_server::api::{router, AppState};
use agentmeld_server::approvals::PendingApprovals;
use agentmeld_server::auth::Auth;
use agentmeld_server::supervisor::Supervisor;
use tower::ServiceExt;

fn test_state(db: Arc<agentmeld_server::db::Db>, dir: &std::path::Path) -> AppState {
    let auth = Arc::new(Auth::new(db.clone()));
    let pending = Arc::new(PendingApprovals::new());
    let supervisor = Arc::new(Supervisor::new(
        db.clone(),
        dir.to_path_buf(),
        dir.to_path_buf(),
        dir.to_path_buf(),
        pending.clone(),
    ));
    let (pump_kick, _rx) = tokio::sync::mpsc::channel(1);
    AppState {
        db,
        auth,
        supervisor,
        pending,
        public_dir: dir.to_path_buf(),
        host: "127.0.0.1:1".to_string(),
        origin: "http://127.0.0.1:1".to_string(),
        pump_kick,
    }
}

#[tokio::test]
async fn session_returns_authenticated_device_identity() {
    let (db, dir) = common::test_db();
    let auth = Auth::new(db.clone());
    let pairing = auth.mint_pairing_token().expect("mint");
    let (device_id, session) = auth.pair(&pairing, "Test browser", None).expect("pair");

    let state = test_state(db, &dir);
    let app = router(state);

    let req = axum::http::Request::builder()
        .uri("/api/v1/session")
        .header("host", "127.0.0.1:1")
        .header("authorization", format!("Bearer {session}"))
        .body(axum::body::Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.expect("oneshot");
    assert_eq!(res.status(), 200);
    let body = axum::body::to_bytes(res.into_body(), 1024)
        .await
        .expect("body");
    let json: serde_json::Value = serde_json::from_slice(&body).expect("json");
    assert_eq!(json["device_id"], device_id);
    assert_eq!(json["device_name"], "Test browser");
    // No credentials in the response.
    assert!(json.get("token").is_none());
    assert!(json.get("ticket").is_none());
    common::cleanup(&dir);
}

#[tokio::test]
async fn session_requires_auth() {
    let (db, dir) = common::test_db();
    let state = test_state(db, &dir);
    let app = router(state);

    let req = axum::http::Request::builder()
        .uri("/api/v1/session")
        .header("host", "127.0.0.1:1")
        .body(axum::body::Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.expect("oneshot");
    assert_eq!(res.status(), 401);
    common::cleanup(&dir);
}
