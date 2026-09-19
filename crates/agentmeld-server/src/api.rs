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
        .route("/events", get(future_stub))
        .route("/approvals/{id}/decision", post(future_stub));

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

/// Future route stub: the client never calls these; they answer 501 until
/// the delivery surface is built.
async fn future_stub(Authed(_): Authed) -> Response {
    err(501, "This feature is not available in this build.")
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

// The static allowlist is unchanged from the PoC: frozen assets served
// verbatim under the same paths.
const STATIC_ASSETS: &[(&str, &str)] = &[
    ("/", "index.html"),
    ("/app.js", "app.js"),
    ("/style.css", "style.css"),
    ("/icon.svg", "icon.svg"),
    ("/manifest.webmanifest", "manifest.webmanifest"),
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
