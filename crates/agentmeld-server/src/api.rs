// HTTP surface: the nine /api/v1 routes, the pairing bootstrap endpoints,
// and the frozen static-asset allowlist.
//
// Error envelope and security posture are ported verbatim from
// apps/poc/server.mjs:
//   * API errors are JSON {"error": "..."} with the PoC's status codes.
//   * Host must be exactly 127.0.0.1:<port>; an Origin header, when present,
//     must equal the local origin; anything else is 403.
//   * Responses carry nosniff, no-referrer, and the PoC's CSP.
//   * API responses carry Cache-Control: no-store. Static assets do not
//     (they are frozen files served as-is).

use std::path::PathBuf;
use std::sync::Arc;

use axum::{
    body::Body,
    extract::{FromRequestParts, Path, Query, Request, State},
    http::{header, request::Parts, HeaderMap, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Redirect, Response},
    routing::{get, post},
    Json, Router,
};
use http_body_util::Limited;
use serde::Deserialize;

use crate::approvals::{
    ApprovalOutcome, ApprovalState, DecideKind, LeaseError, LeaseOutcome, PendingApprovals,
    RevokeError,
};
use crate::auth::{Auth, AuthError, SessionContext};
use crate::db::{AdmitInput, Db, StopOutcome, UploadFile};
use crate::domain::RequestError;
use crate::supervisor::{Supervisor, TurnContext};

/// Body cap for POST routes, matching the PoC's 8 MiB request limit.
const BODY_LIMIT: usize = 8 * 1024 * 1024;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Db>,
    pub auth: Arc<Auth>,
    pub supervisor: Arc<Supervisor>,
    /// Waiters blocked on human approval decisions, shared with the
    /// supervisor and the expiry sweeper.
    pub pending: Arc<PendingApprovals>,
    pub public_dir: PathBuf,
    /// Exact expected Host value, e.g. "127.0.0.1:4317".
    pub host: String,
    /// Exact expected Origin value, e.g. "http://127.0.0.1:4317".
    pub origin: String,
    /// Wakes the pump after admission.
    pub pump_kick: tokio::sync::mpsc::Sender<()>,
}

// ---------------------------------------------------------------- errors.

fn err(status: u16, message: &str) -> Response {
    let code = StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    (code, Json(serde_json::json!({ "error": message }))).into_response()
}

fn req_err(e: RequestError) -> Response {
    err(e.status, &e.message)
}

/// Internal (String) db errors: logged, never leaked to the client.
fn internal_err(context: &str, e: String) -> Response {
    eprintln!("[api] {context}: {e}");
    err(500, "The request could not be completed.")
}

fn auth_err(e: AuthError) -> Response {
    match e {
        AuthError::Unauthorized(m) => err(401, &m),
        AuthError::Forbidden(m) => err(403, &m),
        AuthError::Internal(_) => err(500, "The request could not be completed."),
    }
}

// ------------------------------------------------------------ middleware.

/// Port of the PoC's host guard: Host must be exactly the local bind
/// address; an Origin header, when present, must equal the local origin.
async fn host_guard(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let host = req
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let origin_ok = req
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .map(|o| o == state.origin)
        .unwrap_or(true);
    if host != state.host || !origin_ok {
        return err(403, "This app is available only from its local address.");
    }
    next.run(req).await
}

/// The PoC's response security headers.
async fn security_headers(req: Request, next: Next) -> Response {
    let mut res = next.run(req).await;
    let headers = res.headers_mut();
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(
            "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' blob:; media-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        ),
    );
    res
}

/// API responses are never cached (the PoC's send() set no-store on every
/// API response).
async fn no_store(req: Request, next: Next) -> Response {
    let mut res = next.run(req).await;
    res.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    res
}

/// Enforce the 8 MiB request cap, mirroring the PoC's body() limit.
/// (axum's default 2 MiB extractor limit is disabled on the router so the
/// PoC's cap is the effective one.)
async fn body_limit(req: Request, next: Next) -> Result<Response, StatusCode> {
    let (parts, body) = req.into_parts();
    let limited = Limited::new(body, BODY_LIMIT);
    let req = Request::from_parts(parts, Body::new(limited));
    let mut res = next.run(req).await;
    // The Json extractor turns an over-limit body into a 413 with axum's
    // default plain-text rejection; the PoC envelopes every error as JSON.
    if res.status() == StatusCode::PAYLOAD_TOO_LARGE {
        *res.body_mut() = Body::from("{\"error\":\"The request body is too large.\"}");
        res.headers_mut().insert(
            header::CONTENT_TYPE,
            header::HeaderValue::from_static("application/json"),
        );
    }
    Ok(res)
}

// ------------------------------------------------------------------ auth.

/// Extractor for device-session auth: 401 when no/invalid bearer token, 403
/// when the presented token belongs to a revoked or retired session.
pub struct Authed(pub SessionContext);

impl FromRequestParts<AppState> for Authed {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let authorization = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok());
        if authorization.is_none() {
            return Err(err(401, "Open the local app link printed by the server."));
        }
        match state.auth.authenticate(authorization) {
            Ok(ctx) => Ok(Authed(ctx)),
            Err(e) => Err(auth_err(e)),
        }
    }
}

// ---------------------------------------------------------------- routes.

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/state", get(get_state))
        .route("/agent", get(get_agent).post(post_agent))
        .route("/conversations", post(post_conversations))
        .route("/tasks", post(post_tasks))
        .route("/stop", post(post_stop))
        .route("/workspace", get(get_workspace))
        .route("/workspace/file", get(get_workspace_file))
        .route("/file", get(get_file))
        .route("/events", get(get_events))
        .route("/approvals/{id}/decision", post(post_approval_decision))
        .route("/approvals/{id}/revoke", post(post_approval_revoke))
        .route("/approvals/{id}", get(get_approval))
        .route("/approvals", get(get_approvals))
        .route("/runs/{id}/tool_steps", get(get_run_tool_steps))
        .route("/session", get(get_session))
        .route("/lease", get(get_lease))
        .route("/lease/takeover", post(post_lease_takeover))
        .route("/lease/takeover/ack", post(post_lease_takeover_ack))
        .route("/lease/private/begin", post(post_lease_private_begin))
        .route("/lease/private/end", post(post_lease_private_end))
        .route("/lease/resume", post(post_lease_resume))
        .route("/lease/heartbeat", post(post_lease_heartbeat))
        .route("/lease/revoke", post(post_lease_revoke))
        .route("/devices/{id}/revoke", post(post_device_revoke));

    // The frozen UI calls /api/* (no version); the versioned API lives at
    // /api/v1/*. Both serve the identical routes.
    Router::new()
        .nest("/api/v1", api.clone())
        .nest("/api", api)
        .route("/api/v1/pair", get(get_pair).post(post_pair))
        .route("/", get(static_root))
        .route("/{*path}", get(static_asset))
        // no-store covers every response including the pairing redirect,
        // whose Location fragment carries a device-session token.
        .layer(middleware::from_fn(no_store))
        .layer(middleware::from_fn_with_state(state.clone(), host_guard))
        .layer(middleware::from_fn(security_headers))
        .layer(middleware::from_fn(body_limit))
        .layer(axum::extract::DefaultBodyLimit::disable())
        .with_state(state)
}

// ------------------------------------------------------------ handlers.

async fn get_state(Authed(_): Authed, State(state): State<AppState>) -> Response {
    match state.db.state_view() {
        Ok(view) => Json(view).into_response(),
        Err(e) => req_err(e),
    }
}

async fn get_agent(Authed(_): Authed, State(state): State<AppState>) -> Response {
    match state.db.get_agent_profile() {
        Ok(profile) => Json(profile.public_json()).into_response(),
        Err(e) => internal_err("get_agent", e),
    }
}

async fn post_agent(
    Authed(_): Authed,
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let action = body.get("action").and_then(|v| v.as_str()).unwrap_or("");
    match action {
        // PoC parity: GET /api/agent returns the profile itself.
        "get" => match state.db.get_agent_profile() {
            Ok(profile) => Json(profile.public_json()).into_response(),
            Err(e) => internal_err("post_agent/get", e),
        },
        // PoC parity: edit/remember/forget are the only write actions, all
        // behind the same busy guard and revision check.
        "edit" | "remember" | "forget" => {
            // Mirror the PoC's guard: refuse while any work is queued or live.
            match state.db.any_active_or_queued() {
                Ok(true) => {
                    return err(
                        409,
                        "Wait for queued and running work to finish before changing agent context.",
                    );
                }
                Ok(false) => {}
                Err(e) => return req_err(e),
            }
            if body.get("revision").and_then(|v| v.as_i64()).is_none() {
                return err(400, "A profile revision is required.");
            }
            match state.db.update_agent_profile(&body) {
                Ok(profile) => Json(profile.public_json()).into_response(),
                Err(e) => req_err(e),
            }
        }
        _ => err(400, "Unknown profile action."),
    }
}

async fn post_conversations(
    Authed(_): Authed,
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    // Port of the PoC's archive guard: the conversation that owns the
    // currently running turn cannot be archived mid-turn.
    if body
        .get("archived")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        if let Some(conv_id) = body.get("id").and_then(|v| v.as_str()) {
            if let Some(active) = state.supervisor.active_run_id().await {
                match state.db.run_conversation(&active) {
                    Ok(Some(owner)) if owner == conv_id => {
                        return err(
                            409,
                            "Wait for this conversation’s work to finish before archiving.",
                        );
                    }
                    Ok(_) => {}
                    Err(e) => return req_err(e),
                }
            }
        }
    }
    let id = body.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let title = body.get("title").and_then(|v| v.as_str());
    let pinned = body.get("pinned").and_then(|v| v.as_bool());
    let archived = body.get("archived").and_then(|v| v.as_bool());
    match state.db.update_conversation(id, title, pinned, archived) {
        Ok(conv) => Json(conv).into_response(),
        Err(e) => req_err(e),
    }
}

async fn post_tasks(
    Authed(_): Authed,
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let files: Vec<UploadFile> = match body
        .get("files")
        .map(|f| serde_json::from_value(f.clone()))
        .transpose()
    {
        Ok(f) => f.unwrap_or_default(),
        Err(_) => return err(400, "Attach up to five files."),
    };
    let input = AdmitInput {
        conversation_id: body
            .get("conversationId")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        prompt: body
            .get("prompt")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        request_key: body
            .get("requestKey")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        files,
    };
    match state.db.admit(&input, "owner") {
        Ok(outcome) => {
            let _ = state.pump_kick.try_send(());
            match state.db.public_task(&outcome.run_id) {
                Ok(task) => (StatusCode::ACCEPTED, Json(task)).into_response(),
                Err(e) => req_err(e),
            }
        }
        Err(e) => req_err(e),
    }
}

async fn post_stop(
    Authed(_): Authed,
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let task_id = body.get("taskId").and_then(|v| v.as_str()).unwrap_or("");
    // Resolve legacy PoC task ids through the import receipts.
    let run_id = state
        .db
        .resolve_legacy_task(task_id)
        .ok()
        .flatten()
        .unwrap_or_else(|| task_id.to_string());
    let active = state.supervisor.active_run_id().await;
    match state.db.stop_task(&run_id, active.as_deref()) {
        Ok(StopOutcome::CancelledQueued) => {
            Json(serde_json::json!({ "stopped": true })).into_response()
        }
        Ok(StopOutcome::RequestedRunning) => {
            if let Err(e) = state
                .supervisor
                .cancel_active_turn(&run_id, "user_requested")
                .await
            {
                eprintln!("[api] stop signal failed for {run_id}: {e}");
                return err(500, "The request could not be completed.");
            }
            (
                StatusCode::ACCEPTED,
                Json(serde_json::json!({ "requested": true })),
            )
                .into_response()
        }
        Ok(StopOutcome::Finished) => Json(serde_json::json!({ "finished": true })).into_response(),
        Err(e) => req_err(e),
    }
}

#[derive(Deserialize)]
struct WorkspaceQuery {
    conversation: Option<String>,
}

async fn get_workspace(
    Authed(_): Authed,
    State(state): State<AppState>,
    Query(q): Query<WorkspaceQuery>,
) -> Response {
    let conversation_id = q.conversation.as_deref().unwrap_or("");
    match state.db.workspace_view(conversation_id) {
        Ok(view) => Json(view).into_response(),
        Err(e) => req_err(e),
    }
}

#[derive(Deserialize)]
struct WorkspaceFileQuery {
    conversation: Option<String>,
    name: Option<String>,
}

async fn get_workspace_file(
    Authed(_): Authed,
    State(state): State<AppState>,
    Query(q): Query<WorkspaceFileQuery>,
) -> Response {
    let conversation_id = q.conversation.as_deref().unwrap_or("");
    let name = q.name.as_deref().unwrap_or("");
    match state.db.workspace_file(conversation_id, name) {
        Ok((name, bytes)) => download(&name, bytes),
        Err(e) => req_err(e),
    }
}

#[derive(Deserialize)]
struct FileQuery {
    task: Option<String>,
    kind: Option<String>,
    name: Option<String>,
}

async fn get_file(
    Authed(_): Authed,
    State(state): State<AppState>,
    Query(q): Query<FileQuery>,
) -> Response {
    let task_id = q.task.as_deref().unwrap_or("");
    let run_id = state
        .db
        .resolve_legacy_task(task_id)
        .ok()
        .flatten()
        .unwrap_or_else(|| task_id.to_string());
    let kind = q
        .kind
        .as_deref()
        .filter(|k| !k.is_empty())
        .unwrap_or("output");
    let name = q.name.as_deref().unwrap_or("");
    match state.db.task_file(&run_id, kind, name) {
        Ok((name, bytes)) => download(&name, bytes),
        Err(e) => req_err(e),
    }
}

fn download(name: &str, bytes: Vec<u8>) -> Response {
    // The PoC's disposition used only the basename.
    let base = name.rsplit('/').next().unwrap_or(name);
    let encoded: String = base
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect();
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/octet-stream"),
            (
                header::CONTENT_DISPOSITION,
                &format!("attachment; filename*=UTF-8''{encoded}"),
            ),
            (header::CACHE_CONTROL, "no-store"),
        ],
        bytes,
    )
        .into_response()
}

// --------------------------------------------- Phase 4: SSE event stream.
//
// GET /api/v1/events — the host-local event stream. Authenticated device
// session only; a revoked device fails here at connect time, and the
// producer closes the stream on heartbeat-time revocation. See events.rs
// for the wire contract (cursor rules, hello, resync, at-least-once).

/// Query params for the event stream: `?cursor=` (a run_events.sequence).
#[derive(Deserialize)]
struct EventsQuery {
    cursor: Option<String>,
}

async fn get_events(
    Authed(session): Authed,
    State(state): State<AppState>,
    Query(query): Query<EventsQuery>,
    headers: HeaderMap,
) -> Response {
    use crate::events::{resolve_cursor, spawn_event_stream, StreamConfig};
    use tokio_stream::StreamExt as _;

    // Last-Event-ID (the SSE reconnect header) wins over ?cursor=; both are
    // host-local run_events.sequence values.
    let last_event_id = headers.get("last-event-id").and_then(|v| v.to_str().ok());
    let max_seq = match state.db.max_event_sequence() {
        Ok(n) => n,
        Err(e) => return internal_err("event stream cursor", e),
    };
    let (_source, cursor) = match resolve_cursor(last_event_id, query.cursor.as_deref(), max_seq) {
        Ok(ok) => ok,
        Err((status, code, message)) => {
            return (
                StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_REQUEST),
                Json(serde_json::json!({
                    "error": message,
                    "code": code,
                    "current_seq": max_seq,
                })),
            )
                .into_response()
        }
    };

    // The producer rechecks revocation by device id on heartbeat; the raw
    // bearer is not retained past this connect-time authentication.
    let frames = spawn_event_stream(
        state.db.clone(),
        session.device_id,
        cursor,
        StreamConfig::default(),
    );
    let body = axum::body::Body::from_stream(
        frames.map(|frame| Ok::<_, std::convert::Infallible>(axum::body::Bytes::from(frame))),
    );
    (
        StatusCode::OK,
        [("content-type", "text/event-stream")],
        body,
    )
        .into_response()
}

// --------------------------------------------- Phase 3: approval decision.
//
// POST /api/v1/approvals/{id}/decision — the human decides. The execution
// ticket travels service -> worker over the seam ONLY; this response
// carries the state/receipt and never the ticket.

/// Machine-readable error envelope for the Phase 3 surfaces:
/// {"error": "<code>", "message": "<detail>"}.
fn err_code(status: u16, code: &str, message: &str) -> Response {
    let status = StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    (
        status,
        Json(serde_json::json!({ "error": code, "message": message })),
    )
        .into_response()
}

/// Strict decision body: unknown fields are rejected, never ignored. The
/// caller presents the lease generation it observed; the decision
/// transaction fences on it (stale -> 409 stale_lease).
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DecisionRequest {
    decision: String,
    lease_generation: i64,
}

async fn post_approval_decision(
    Authed(ctx): Authed,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<DecisionRequest>,
) -> Response {
    let kind = match body.decision.as_str() {
        "approve" => DecideKind::Approve,
        "deny" => DecideKind::Deny,
        _ => {
            return err_code(
                400,
                "invalid_decision",
                "decision must be \"approve\" or \"deny\"",
            )
        }
    };
    // The deciding device is the authenticated session's device — never a
    // client-supplied value. In this single-workspace alpha every paired
    // device is authorized for the host; wrong_scope is reserved for a
    // future multi-workspace model. The design's "never 404 to the wrong
    // party" rule is honored structurally: authorization precedes lookup.
    match state
        .db
        .decide_approval(&id, &ctx.device_id, kind, body.lease_generation)
    {
        Ok(decided) => {
            // Wake the blocked worker, if any. The waiter carries the
            // internal outcome — including the raw ticket — which is why
            // the HTTP receipt below must never include it.
            state.pending.resolve(&id, decided.outcome);
            Json(serde_json::json!({
                "approval_id": decided.approval_id,
                "state": decided.state.as_str(),
                "action_digest": decided.digest,
                "decided_at_ms": decided.decided_at_ms,
                "decided_by": ctx.device_id,
            }))
            .into_response()
        }
        Err(e) => {
            // Lazy expiry and digest-mismatch revocation settle the row
            // inside the failed decision: wake the blocked worker so it
            // fails closed instead of hanging on a dead wait.
            if matches!(
                e,
                crate::approvals::DecideError::Expired
                    | crate::approvals::DecideError::DigestMismatch
            ) {
                let outcome = match e {
                    crate::approvals::DecideError::Expired => ApprovalOutcome::Expired,
                    _ => ApprovalOutcome::Revoked,
                };
                state.pending.resolve(&id, outcome);
            }
            err_code(e.status(), e.code(), &e.message())
        }
    }
}

/// Strict revoke body: empty today — the reason is always `user_revoked`
/// (the column is a closed enum; the actor is journalled in the event).
/// Unknown fields are rejected, never ignored, so a future reason has a
/// clean place to land.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RevokeRequest {}

/// POST /api/v1/approvals/{id}/revoke — the human pulls back a grant.
/// A pending approval settles to revoked (the blocked worker's waiter
/// resolves with `Revoked` so the turn winds down); an approved one is
/// revoked and its execution ticket dies with it (`claim_ticket` only
/// honors `approved` rows). Unlike decisions this is not fenced on the
/// lease generation: revocation is retrospective, not turn-gated.
async fn post_approval_revoke(
    Authed(ctx): Authed,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(_body): Json<RevokeRequest>,
) -> Response {
    // The revoking device is the authenticated session's device — never a
    // client-supplied value.
    match state.db.revoke_approval(&id, &ctx.device_id) {
        Ok(revoked) => {
            if revoked.was_pending {
                // Wake the blocked worker, if any: the approval it waited on
                // is terminally revoked, so the action will not run.
                state.pending.resolve(&id, ApprovalOutcome::Revoked);
            }
            Json(serde_json::json!({
                "approval_id": revoked.approval_id,
                "state": "revoked",
                "revoked_reason": revoked.revoked_reason,
                "revoked_at_ms": revoked.revoked_at_ms,
                "revoked_by": ctx.device_id,
                "already_dispatched": revoked.already_dispatched,
            }))
            .into_response()
        }
        Err(e) => {
            // Lazy expiry settles the row inside the failed revoke: wake
            // the blocked worker so it fails closed instead of hanging.
            if matches!(e, RevokeError::Expired) {
                state.pending.resolve(&id, ApprovalOutcome::Expired);
            }
            err_code(e.status(), e.code(), &e.message())
        }
    }
}

// ------------------------------------------------- Phase 3: harness reads.
//
// GET /api/v1/approvals/{id} and GET /api/v1/approvals: operator surfaces
// for the deterministic harness (and the future client UI). The receipt
// never includes the ticket hash.

async fn get_approval(
    Authed(_): Authed,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    match state.db.get_approval(&id) {
        Ok(Some(row)) => Json(row.public_json()).into_response(),
        Ok(None) => err_code(404, "unknown_approval", "No such approval."),
        Err(e) => err(500, &format!("read approval: {e}")),
    }
}

#[derive(Deserialize)]
struct ApprovalListQuery {
    state: Option<String>,
}

async fn get_approvals(
    Authed(_): Authed,
    State(state): State<AppState>,
    Query(q): Query<ApprovalListQuery>,
) -> Response {
    let filter = match q.state.as_deref() {
        None => None,
        Some(s) => match ApprovalState::parse(s) {
            Some(st) => Some(st),
            None => {
                return err_code(
                    400,
                    "invalid_state",
                    "state must be pending, approved, denied, expired, or revoked",
                )
            }
        },
    };
    match state.db.list_approvals(filter) {
        Ok(rows) => Json(serde_json::json!({
            "approvals": rows.iter().map(|r| r.public_json()).collect::<Vec<_>>(),
        }))
        .into_response(),
        Err(e) => err(500, &format!("list approvals: {e}")),
    }
}

// ------------------------------------------------- Phase 4: tool-step hydration.
//
// GET /api/v1/runs/{id}/tool_steps: the persisted tool-step projection for
// a run, in service-assigned ordinal order. Lets the browser backfill the
// inline tool-step view after a reload, when the persisted SSE cursor has
// already skipped the historical tool events. The projection is the same
// one the stream emits live; the client merges on `call_key` and lets live
// SSE state win for in-flight steps.

async fn get_run_tool_steps(
    Authed(_): Authed,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let exists = match state.db.run_conversation(&id) {
        Ok(opt) => opt.is_some(),
        Err(e) => return err(500, &format!("read run: {e}")),
    };
    if !exists {
        return err_code(404, "unknown_run", "No such run.");
    }
    match state.db.tool_steps_for_run(&id) {
        Ok(rows) => Json(serde_json::json!({
            "run_id": id,
            "steps": rows
                .iter()
                .map(|r| serde_json::json!({
                    "call_key": r.call_key,
                    "tool": r.tool_name,
                    "title": r.title,
                    "state": r.state,
                }))
                .collect::<Vec<_>>(),
        }))
        .into_response(),
        Err(e) => err(500, &format!("read tool steps: {e}")),
    }
}

// ------------------------------------------------- Phase 3: controller lease.
//
// Harness/operator surfaces. Every mutation is fenced on the
// caller-supplied expected_generation: a device acting on a stale view of
// the lease gets 409 stale_lease and must re-read.

/// The authenticated device's own non-secret identity: lets the browser
/// honestly distinguish "controlling on this device" from "controlled by
/// another device" when rendering the controller lease. Returns no
/// credentials — just the device id and name the session was issued to.
async fn get_session(Authed(ctx): Authed) -> Response {
    Json(serde_json::json!({
        "device_id": ctx.device_id,
        "device_name": ctx.device_name,
    }))
    .into_response()
}

async fn get_lease(Authed(_): Authed, State(state): State<AppState>) -> Response {
    match state.db.get_lease() {
        Ok(row) => Json(row.public_json()).into_response(),
        Err(e) => err_code(e.status(), e.code(), &e.message()),
    }
}

/// Strict body for the fenced lease mutations.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LeaseMutationRequest {
    expected_generation: i64,
}

async fn post_lease_takeover(Authed(ctx): Authed, State(state): State<AppState>) -> Response {
    // Anyone may take over — seizing control from a stuck holder is the
    // point. Pending approvals die with lease_takeover; a live worker is
    // cancelled with service.turn.cancel reason lease_takeover.
    let active = state.supervisor.active_run_id().await;
    match state
        .db
        .lease_takeover(&ctx.device_id, active.is_some(), active.as_deref())
    {
        Ok(outcome) => {
            if outcome.killed_active_turn {
                if let Some(run_id) = &active {
                    let _ = state
                        .supervisor
                        .cancel_active_turn(run_id, "lease_takeover")
                        .await;
                }
            }
            for id in &outcome.revoked_approval_ids {
                state.pending.resolve(id, ApprovalOutcome::Revoked);
            }
            Json(serde_json::json!({
                "lease": outcome.lease.public_json(),
                "revoked_approval_ids": outcome.revoked_approval_ids,
                "cancelled_run_id": if outcome.killed_active_turn { active } else { None::<String> },
            }))
            .into_response()
        }
        Err(e) => err_code(e.status(), e.code(), &e.message()),
    }
}

/// The seizing device confirms the worker has wound down after a
/// takeover and takes the computer as a human: pausing -> human.
async fn post_lease_takeover_ack(
    Authed(ctx): Authed,
    State(state): State<AppState>,
    Json(body): Json<LeaseMutationRequest>,
) -> Response {
    let active = state.supervisor.active_run_id().await;
    let result =
        state
            .db
            .lease_takeover_ack(&ctx.device_id, body.expected_generation, active.as_deref());
    lease_mutation_response(&state, result)
}

/// Render a lease mutation receipt. Revoked approvals wake their waiters
/// as Revoked so no worker hangs on a dead wait.
fn lease_mutation_response(state: &AppState, result: Result<LeaseOutcome, LeaseError>) -> Response {
    match result {
        Ok(outcome) => {
            for id in &outcome.revoked_approval_ids {
                state.pending.resolve(id, ApprovalOutcome::Revoked);
            }
            Json(serde_json::json!({ "lease": outcome.lease.public_json() })).into_response()
        }
        Err(e) => err_code(e.status(), e.code(), &e.message()),
    }
}

async fn post_lease_private_begin(
    Authed(ctx): Authed,
    State(state): State<AppState>,
    Json(body): Json<LeaseMutationRequest>,
) -> Response {
    let active = state.supervisor.active_run_id().await;
    let result =
        state
            .db
            .lease_private_begin(&ctx.device_id, body.expected_generation, active.as_deref());
    lease_mutation_response(&state, result)
}

async fn post_lease_private_end(
    Authed(ctx): Authed,
    State(state): State<AppState>,
    Json(body): Json<LeaseMutationRequest>,
) -> Response {
    let active = state.supervisor.active_run_id().await;
    let result =
        state
            .db
            .lease_private_end(&ctx.device_id, body.expected_generation, active.as_deref());
    lease_mutation_response(&state, result)
}

async fn post_lease_resume(
    Authed(ctx): Authed,
    State(state): State<AppState>,
    Json(body): Json<LeaseMutationRequest>,
) -> Response {
    let active = state.supervisor.active_run_id().await;
    let result = state
        .db
        .lease_resume(&ctx.device_id, body.expected_generation, active.as_deref());
    lease_mutation_response(&state, result)
}

async fn post_lease_heartbeat(
    Authed(ctx): Authed,
    State(state): State<AppState>,
    Json(body): Json<LeaseMutationRequest>,
) -> Response {
    let result = state
        .db
        .lease_heartbeat(&ctx.device_id, body.expected_generation);
    lease_mutation_response(&state, result)
}

/// Strict body for the lease kill switch: the generation fence plus a
/// free-form reason recorded in the journal.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LeaseRevokeRequest {
    expected_generation: i64,
    reason: Option<String>,
}

async fn post_lease_revoke(
    Authed(ctx): Authed,
    State(state): State<AppState>,
    Json(body): Json<LeaseRevokeRequest>,
) -> Response {
    let reason = body.reason.as_deref().unwrap_or("operator").trim();
    let reason = if reason.is_empty() {
        "operator"
    } else {
        reason
    };
    // A revoke that lands mid-pause still has a worker to kill.
    let active = state.supervisor.active_run_id().await;
    match state.db.lease_revoke(
        &ctx.device_id,
        reason,
        body.expected_generation,
        active.as_deref(),
    ) {
        Ok(outcome) => {
            if outcome.killed_active_turn {
                if let Some(run_id) = &active {
                    let _ = state
                        .supervisor
                        .cancel_active_turn(run_id, "lease_takeover")
                        .await;
                }
            }
            lease_mutation_response(&state, Ok(outcome))
        }
        Err(e) => err_code(e.status(), e.code(), &e.message()),
    }
}

// -------------------------------------------- Phase 3: device revocation.
//
// POST /api/v1/devices/{id}/revoke — the operator kill switch for a
// device: its sessions die, pending approvals are revoked
// (device_revoked), and the lease is released if the device held it.
// Revoking the final device is recoverable only through explicit on-host
// CLI re-pairing.

async fn post_device_revoke(
    Authed(_): Authed,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let active = state.supervisor.active_run_id().await;
    match state.db.revoke_device_and_settle(&id) {
        Ok(rev) => {
            for aid in &rev.settled_approval_ids {
                state.pending.resolve(aid, ApprovalOutcome::Revoked);
            }
            if rev.lease_killed {
                if let Some(run_id) = &active {
                    let _ = state
                        .supervisor
                        .cancel_active_turn(run_id, "lease_takeover")
                        .await;
                }
            }
            Json(serde_json::json!({
                "device_id": id,
                "sessions_revoked": rev.sessions_revoked,
                "approvals_settled": rev.approvals_settled,
                "settled_approval_ids": rev.settled_approval_ids,
                "lease_killed": rev.lease_killed,
                "new_lease_generation": rev.new_lease_generation,
            }))
            .into_response()
        }
        Err(e) => {
            if e == "unknown device" {
                err_code(404, "unknown_device", "No such device.")
            } else {
                err(500, &format!("revoke device: {e}"))
            }
        }
    }
}

// --------------------------------------------------------------- pairing.

// The pairing link is the PoC's bootstrap contract: the frozen UI reads
// location.hash and sends it as the bearer token. GET /api/v1/pair exchanges
// a one-time pairing token for a device session and redirects the browser to
// /#<session-token>, exactly what the app.js startup flow expects.
#[derive(Deserialize)]
struct PairQuery {
    token: Option<String>,
    name: Option<String>,
}

async fn get_pair(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<PairQuery>,
) -> Response {
    let token = q.token.as_deref().unwrap_or("");
    let name = q.name.as_deref().unwrap_or("").trim();
    let name = if name.is_empty() { "browser" } else { name };
    let authorization = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    match state.auth.pair(token, name, authorization) {
        Ok((_device_id, session_token)) => {
            Redirect::to(&format!("/#{session_token}")).into_response()
        }
        Err(e) => auth_err(e),
    }
}

// Machine-friendly pairing endpoint for the eventual CLI / iOS flow: the
// same one-time exchange, returned as JSON instead of a redirect.
#[derive(Deserialize)]
struct PairRequest {
    token: Option<String>,
    device_name: Option<String>,
}

async fn post_pair(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PairRequest>,
) -> Response {
    let token = body.token.as_deref().unwrap_or("");
    let name = body.device_name.as_deref().unwrap_or("").trim();
    let name = if name.is_empty() { "device" } else { name };
    let authorization = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    match state.auth.pair(token, name, authorization) {
        Ok((device_id, session_token)) => Json(serde_json::json!({
            "device": device_id,
            "name": name,
            "token": session_token,
        }))
        .into_response(),
        Err(e) => auth_err(e),
    }
}

// ---------------------------------------------------------- static assets.

// The static allowlist mirrors the PoC server (apps/poc/server.mjs): frozen
// assets served verbatim under the same paths. app.js statically imports the
// sibling modules, so every entry must be present or the whole UI fails to
// boot (missing entries 404, the module graph fails, and the page sits at
// "Connecting…" with no icons and no navigation).
const STATIC_ASSETS: &[(&str, &str)] = &[
    ("/", "index.html"),
    ("/agent-settings.js", "agent-settings.js"),
    ("/app.js", "app.js"),
    ("/artifact-tools.js", "artifact-tools.js"),
    ("/brain.svg", "brain.svg"),
    ("/client-track.js", "client-track.js"),
    ("/sse-parse.js", "sse-parse.js"),
    ("/composer.js", "composer.js"),
    ("/conversation-tools.js", "conversation-tools.js"),
    ("/file-browser.js", "file-browser.js"),
    ("/icons.js", "icons.js"),
    ("/organization.js", "organization.js"),
    ("/preview-reader.js", "preview-reader.js"),
    ("/style.css", "style.css"),
    ("/tooltips.js", "tooltips.js"),
    ("/fonts/roboto-latin.woff2", "fonts/roboto-latin.woff2"),
];

async fn static_root(State(state): State<AppState>) -> Response {
    serve_file(&state.public_dir, "index.html")
}

async fn static_asset(State(state): State<AppState>, Path(path): Path<String>) -> Response {
    let request_path = format!("/{path}");
    match STATIC_ASSETS.iter().find(|(p, _)| *p == request_path) {
        Some((_, file)) => serve_file(&state.public_dir, file),
        None => err(404, "Not found."),
    }
}

fn serve_file(public_dir: &std::path::Path, file: &str) -> Response {
    let bytes = match std::fs::read(public_dir.join(file)) {
        Ok(b) => b,
        Err(_) => return err(404, "Not found."),
    };
    let content_type = match file.rsplit('.').next() {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("woff2") => "font/woff2",
        Some("webmanifest") => "application/manifest+json",
        _ => "application/octet-stream",
    };
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, content_type)],
        bytes,
    )
        .into_response()
}

// ------------------------------------------------------------------ pump.

// The admission pump: whenever a run is queued and no turn is live, claim
// the oldest queued run and hand it to the supervisor. Admission kicks the
// channel; a slow poll covers restarts and anything the kick missed.
pub async fn pump_loop(state: AppState, mut kick: tokio::sync::mpsc::Receiver<()>) {
    loop {
        pump_once(&state).await;
        tokio::select! {
            _ = kick.recv() => {}
            _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => {}
        }
    }
}

async fn pump_once(state: &AppState) {
    if state.supervisor.active_run_id().await.is_some() {
        return;
    }
    let run_id = match state.db.claim_queued_run() {
        Ok(Some(row)) => row.id,
        Ok(None) => return,
        Err(e) => {
            eprintln!("[pump] claim failed: {e}");
            return;
        }
    };
    let conversation_id = match state.db.run_conversation(&run_id) {
        Ok(Some(id)) => id,
        Ok(None) => {
            let _ = state.db.fail_run_precheck(
                &run_id,
                "Needs attention",
                "The run has no conversation.",
            );
            return;
        }
        Err(e) => {
            eprintln!("[pump] run lookup failed for {run_id}: {e}");
            return;
        }
    };
    // Continuation gate: the PoC refused to start a turn on a conversation
    // that cannot safely resume, preserving history and files. 'legacy'
    // (imported history) starts a fresh turn, mirroring the admit gate.
    match state.db.conversation_continuation(&conversation_id) {
        Ok(c) if c == "ready" || c == "legacy" => {}
        _ => {
            let _ = state.db.fail_run_precheck(
                &run_id,
                "Needs attention",
                "This conversation cannot safely resume. Start a new chat; its history and files are preserved.",
            );
            return;
        }
    }
    // Profile-revision sync: a changed agent context invalidates the ready
    // provider session, mirroring the PoC's session=null reset.
    if let Err(e) = state.db.sync_agent_revision(&run_id) {
        eprintln!("[pump] revision sync failed for {run_id}: {e}");
        let _ = state.db.fail_run_precheck(
            &run_id,
            "Needs attention",
            "The turn could not finish safely. Start a new chat.",
        );
        return;
    }
    let agent_context = match state.db.assemble_agent_context(&run_id) {
        Ok(ctx) => ctx,
        Err(e) => {
            eprintln!("[pump] context assembly failed for {run_id}: {e}");
            let _ = state.db.fail_run_precheck(
                &run_id,
                "Needs attention",
                "The turn could not finish safely. Start a new chat.",
            );
            return;
        }
    };
    let resume_thread_id = state
        .db
        .get_ready_session(&conversation_id)
        .ok()
        .flatten()
        .and_then(|s| s.native_ref);
    let turn = TurnContext {
        run_id: run_id.clone(),
        conversation_id,
        agent_context,
        resume_thread_id,
        binding: None,
    };
    if let Err(e) = state.supervisor.run_turn(turn).await {
        eprintln!("[pump] turn {run_id} failed: {e}");
    }
}
