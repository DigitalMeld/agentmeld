// Rust port of apps/poc/supervisor.mjs: spawns the Node worker for one turn,
// owns the Unix socket, and applies the worker's events transactionally.
// One active turn per service, matching the PoC's single-active-run pump.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tokio::net::UnixListener;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::timeout;

use crate::db::Db;
use crate::domain::{
    constant_time_eq, new_msg_id, new_token_b64url, new_uuid, now_ms, sha256_hex, RunStatus,
};
use crate::seam::{
    self, ArtifactFile, Binding, FrameReader, ServiceArtifactsStored, ServiceError,
    ServiceEventsStored, ServiceInputsData, ServiceTurnCancel, ServiceTurnStart, ServiceWelcome,
    StoredEvent, StoredFile, TurnStart, WorkerMessage, ARTIFACT_MAX_FILES,
    ARTIFACT_TOTAL_CAP_BYTES, INPUT_CHUNK_BYTES, MAX_FRAME_BYTES, PROTOCOL,
};

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);
const TURN_TIMEOUT_MS: i64 = 600_000; // Matches the PoC's LiveClient whole-life timer.
const REAP_GRACE: Duration = Duration::from_secs(5);

#[derive(Debug)]
pub enum SupervisorError {
    /// Fail-closed: the run was marked interrupted; the caller (pump) moves on.
    TurnFailed(String),
    /// The supervisor is busy or the run is not active; maps to 409.
    NotActive(String),
}

impl std::fmt::Display for SupervisorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SupervisorError::TurnFailed(e) => write!(f, "{e}"),
            SupervisorError::NotActive(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for SupervisorError {}

pub struct TurnContext {
    pub run_id: String,
    pub conversation_id: String,
    /// Assembled agent prompt (db.assemble_agent_context).
    pub agent_context: String,
    /// Phase 1 gap-fill: provider thread id travels in the spawn environment.
    pub resume_thread_id: Option<String>,
    /// Injected by tests; production calls run_turn(), which reads it live.
    pub binding: Option<Binding>,
}

struct ActiveTurn {
    run_id: String,
    generation: i64,
    turn_started: bool,
    pending_cancel: bool,
    writer: Option<tokio::net::unix::OwnedWriteHalf>,
}

pub struct Supervisor {
    db: Arc<Db>,
    state_dir: PathBuf,
    repo_root: PathBuf,
    node: PathBuf,
    worker_entry: PathBuf,
    active: Mutex<Option<ActiveTurn>>,
}

impl Supervisor {
    pub fn new(db: Arc<Db>, state_dir: PathBuf, repo_root: PathBuf, node: PathBuf) -> Self {
        let worker_entry = repo_root.join("apps/worker/worker.mjs");
        Supervisor {
            db,
            state_dir,
            repo_root,
            node,
            worker_entry,
            active: Mutex::new(None),
        }
    }

    pub async fn active_run_id(&self) -> Option<String> {
        self.active.lock().await.as_ref().map(|a| a.run_id.clone())
    }

    /// Send one frame on the active turn's socket.
    async fn send(&self, value: &impl Serialize) -> Result<(), SupervisorError> {
        let mut guard = self.active.lock().await;
        let active = guard
            .as_mut()
            .ok_or_else(|| SupervisorError::TurnFailed("no active turn".to_string()))?;
        let writer = active
            .writer
            .as_mut()
            .ok_or_else(|| SupervisorError::TurnFailed("no active turn".to_string()))?;
        seam::send_frame(writer, value)
            .await
            .map_err(|e| SupervisorError::TurnFailed(format!("send frame: {e}")))
    }

    /// Armed cancel: if the turn has started, deliver service.turn.cancel on
    /// the socket; if it is still spawning, arm pending_cancel so the cancel
    /// is delivered back-to-back with turn.start (the PoC's cancelActiveTurn).
    pub async fn cancel_active_turn(
        &self,
        run_id: &str,
        reason: &str,
    ) -> Result<(), SupervisorError> {
        let cancel = {
            let mut guard = self.active.lock().await;
            let active = guard.as_mut().ok_or_else(|| {
                SupervisorError::NotActive(
                    "This turn cannot be stopped yet. Try again in a moment.".to_string(),
                )
            })?;
            if active.run_id != run_id {
                return Err(SupervisorError::NotActive(
                    "This turn cannot be stopped yet. Try again in a moment.".to_string(),
                ));
            }
            if !active.turn_started {
                active.pending_cancel = true;
                return Ok(());
            }
            ServiceTurnCancel {
                protocol: PROTOCOL,
                msg_id: new_msg_id(),
                msg_type: "service.turn.cancel",
                run_id: active.run_id.clone(),
                generation: active.generation,
                reason: reason.to_string(),
            }
        };
        self.send(&cancel).await
    }

    /// Run one turn to completion. On any failure the run is marked
    /// interrupted (fail closed); the error is for the pump's logs only.
    pub async fn run_turn(&self, ctx: TurnContext) -> Result<(), SupervisorError> {
        let run_id = ctx.run_id.clone();
        // Register the active turn before any setup so a stop that lands
        // during environment checks arms a pending cancel instead of 409ing
        // (the PoC's cancelActiveTurn armed pendingCancel while spawning).
        {
            let mut guard = self.active.lock().await;
            if guard.is_some() {
                return Err(SupervisorError::NotActive(
                    "supervisor already has an active turn".to_string(),
                ));
            }
            *guard = Some(ActiveTurn {
                run_id: run_id.clone(),
                generation: 1,
                turn_started: false,
                pending_cancel: false,
                writer: None,
            });
        }
        let outcome = self.run_turn_inner(&ctx).await;
        // Registration is cleared on every path; drive_turn additionally
        // reaps the child and removes the socket on the spawn path.
        {
            let mut guard = self.active.lock().await;
            *guard = None;
        }
        outcome
    }

    async fn run_turn_inner(&self, ctx: &TurnContext) -> Result<(), SupervisorError> {
        let run_id = ctx.run_id.clone();
        // The PoC verified the execution environment before spawning; a
        // broken environment fails the turn here, before any worker exists.
        let binding = match ctx.binding.clone() {
            Some(b) => b,
            None => read_binding(&self.repo_root).await.map_err(|e| {
                self.db
                    .mark_interrupted(&run_id, &format!("environment check failed: {e}"))
                    .ok();
                SupervisorError::TurnFailed(format!("environment check failed: {e}"))
            })?,
        };
        // Continuation guard: a ready provider session must match the
        // current binding, exactly like the PoC's normalizeSession check.
        if let Err(e) = self.check_session_binding(&ctx.conversation_id, &binding) {
            self.db.mark_interrupted(&run_id, &e).ok();
            return Err(SupervisorError::TurnFailed(e));
        }
        // A stop that landed during setup armed pending_cancel and moved the
        // run to cancelling. Abort before spawning instead of running a
        // doomed turn.
        match self.db.get_run(&run_id) {
            Ok(run) if run.status == RunStatus::Cancelling => {
                self.db
                    .cancel_before_spawn(&run_id)
                    .map_err(|e| SupervisorError::TurnFailed(e.message))?;
                return Ok(());
            }
            Ok(_) => {}
            Err(e) => return Err(SupervisorError::TurnFailed(e.message)),
        }
        // Build the input manifest; blob bytes stay service-side until fetched.
        let inputs = self
            .db
            .input_entries(&run_id)
            .map_err(|e| self.fail_begin(&run_id, &e.to_string()))?;
        let mut blobs: HashMap<String, Vec<u8>> = HashMap::new();
        let mut manifest: Vec<seam::InputManifestEntry> = vec![];
        for entry in &inputs {
            manifest.push(seam::InputManifestEntry {
                name: entry.name.clone(),
                digest: entry.digest.clone(),
                size: entry.size,
                kind: entry.kind.clone(),
            });
            blobs
                .entry(entry.digest.clone())
                .or_insert_with(|| entry.bytes.clone());
        }
        self.db
            .begin_turn(&run_id)
            .map_err(|e| self.fail_begin(&run_id, &e.to_string()))?;

        let socket_dir = self.state_dir.join("worker-sockets");
        let staging_dir = self.state_dir.join("staging").join(&run_id);
        let socket_path = socket_dir.join(format!("{run_id}.sock"));
        let token = new_token_b64url(); // 256-bit per-spawn token, base64url.
        if let Err(e) = self
            .drive_turn(
                ctx,
                &binding,
                manifest,
                blobs,
                &socket_dir,
                &staging_dir,
                &socket_path,
                &token,
            )
            .await
        {
            self.db
                .mark_interrupted(&run_id, &e.to_string())
                .map_err(SupervisorError::TurnFailed)?;
            return Err(e);
        }
        Ok(())
    }

    fn fail_begin(&self, run_id: &str, msg: &str) -> SupervisorError {
        self.db
            .mark_interrupted(run_id, &format!("turn setup failed: {msg}"))
            .ok();
        SupervisorError::TurnFailed(format!("turn setup failed: {msg}"))
    }

    fn check_session_binding(
        &self,
        conversation_id: &str,
        binding: &Binding,
    ) -> Result<(), String> {
        if let Some(session) = self
            .db
            .get_ready_session(conversation_id)
            .map_err(|e| format!("read provider session: {e}"))?
        {
            let config = serde_json::to_string(binding).unwrap_or_default();
            if sha256_hex(config.as_bytes()) != session.config_digest {
                return Err("Continuation configuration changed".to_string());
            }
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    async fn drive_turn(
        &self,
        ctx: &TurnContext,
        binding: &Binding,
        manifest: Vec<seam::InputManifestEntry>,
        blobs: HashMap<String, Vec<u8>>,
        socket_dir: &Path,
        staging_dir: &Path,
        socket_path: &Path,
        token: &str,
    ) -> Result<(), SupervisorError> {
        let run_id = ctx.run_id.clone();
        let generation: i64 = 1;
        let fail = |msg: String| SupervisorError::TurnFailed(msg);
        std::fs::create_dir_all(socket_dir).map_err(|e| fail(format!("socket dir: {e}")))?;
        set_mode_700(socket_dir).ok();
        std::fs::create_dir_all(staging_dir).map_err(|e| fail(format!("staging dir: {e}")))?;
        let _ = std::fs::remove_file(socket_path);
        // Bind before spawn: the worker connects once with no retry.
        let listener =
            UnixListener::bind(socket_path).map_err(|e| fail(format!("bind socket: {e}")))?;
        set_mode_700(socket_path).ok();

        let mut cmd = Command::new(&self.node);
        cmd.arg(&self.worker_entry);
        cmd.env("AGENTMELD_WORKER_SOCKET", socket_path);
        cmd.env("AGENTMELD_WORKER_TOKEN", token);
        if let Some(tid) = &ctx.resume_thread_id {
            cmd.env("AGENTMELD_RESUME_THREAD_ID", tid);
        }
        cmd.stdin(std::process::Stdio::null());
        cmd.stdout(std::process::Stdio::null());
        cmd.stderr(std::process::Stdio::inherit());
        cmd.kill_on_drop(true);
        let mut child: Child = cmd
            .spawn()
            .map_err(|e| fail(format!("spawn worker: {e}")))?;

        // The active turn was registered by run_turn before setup; sanity
        // check it here so a stop during spawn still arms pending_cancel.
        {
            let guard = self.active.lock().await;
            if guard.as_ref().map(|a| a.run_id.as_str()) != Some(run_id.as_str()) {
                return Err(SupervisorError::NotActive(
                    "supervisor active turn mismatch".to_string(),
                ));
            }
        }

        let outcome = self
            .handshake_and_run(
                &run_id,
                generation,
                binding,
                ctx,
                &manifest,
                &blobs,
                staging_dir,
                token,
                &listener,
                &mut child,
            )
            .await;

        // Teardown, mirroring the PoC's finally: clear active, reap the
        // child (SIGTERM then SIGKILL), remove the socket path and staging.
        {
            let mut guard = self.active.lock().await;
            *guard = None;
        }
        reap_child(&mut child).await;
        let _ = std::fs::remove_file(socket_path);
        let _ = std::fs::remove_dir_all(staging_dir);
        outcome
    }

    #[allow(clippy::too_many_arguments)]
    async fn handshake_and_run(
        &self,
        run_id: &str,
        generation: i64,
        binding: &Binding,
        ctx: &TurnContext,
        manifest: &[seam::InputManifestEntry],
        blobs: &HashMap<String, Vec<u8>>,
        staging_dir: &Path,
        token: &str,
        listener: &UnixListener,
        child: &mut Child,
    ) -> Result<(), SupervisorError> {
        let fail = |msg: String| SupervisorError::TurnFailed(msg);
        let child_pid = child.id();
        // An early worker crash must surface now, not after the full
        // handshake timeout: race the accept against the child's exit.
        let (stream, _) = tokio::select! {
            biased;
            res = timeout(HANDSHAKE_TIMEOUT, listener.accept()) => {
                res.map_err(|_| fail("worker hello timeout".to_string()))?
                    .map_err(|e| fail(format!("accept: {e}")))?
            }
            exit = child.wait() => {
                let code = exit.ok().and_then(|s| s.code()).unwrap_or(-1);
                return Err(fail(format!(
                    "worker exited during handshake (exit code {code})"
                )));
            }
        };
        // Peer auth: the worker-reported pid must be the child this
        // supervisor spawned, exactly the PoC's check. (Kernel peer
        // credentials are future work.)
        let (read_half, write_half) = stream.into_split();
        {
            let mut guard = self.active.lock().await;
            if let Some(active) = guard.as_mut() {
                active.writer = Some(write_half);
            }
        }
        let mut frames = FrameReader::new(read_half);
        // An early worker crash must surface now, not after the full hello
        // timeout: race the read against the child's exit.
        let hello_value = tokio::select! {
            biased;
            res = timeout(HANDSHAKE_TIMEOUT, frames.next_frame()) => {
                res.map_err(|_| fail("worker hello timeout".to_string()))?
                    .map_err(|e| fail(format!("hello read: {e}")))?
                    .ok_or_else(|| fail("worker closed before hello".to_string()))?
            }
            exit = child.wait() => {
                let code = exit.ok().and_then(|s| s.code()).unwrap_or(-1);
                return Err(fail(format!(
                    "worker exited during handshake (exit code {code})"
                )));
            }
        };
        let hello = match WorkerMessage::parse(hello_value).map_err(fail)? {
            WorkerMessage::Hello(h) => h,
            _ => return Err(fail("bad worker hello".to_string())),
        };
        // Transport auth: the token is boot-issued (spawn environment,
        // constant-time compare) and the pid must be the spawned child.
        if !constant_time_eq(hello.worker_token.as_bytes(), token.as_bytes()) {
            return Err(fail("worker hello rejected".to_string()));
        }
        let pid_ok = match child_pid {
            Some(child) => hello.worker_pid as u32 == child,
            None => false,
        };
        if !pid_ok {
            return Err(fail("worker hello rejected".to_string()));
        }

        self.send(&ServiceWelcome {
            protocol: PROTOCOL,
            in_reply_to: hello.msg_id.clone(),
            msg_type: "service.session.welcome",
            ok: true,
            worker_id: new_uuid(),
            negotiated_protocol: PROTOCOL,
            max_frame_bytes: MAX_FRAME_BYTES,
        })
        .await?;

        self.send(&ServiceTurnStart {
            protocol: PROTOCOL,
            msg_id: new_msg_id(),
            msg_type: "service.turn.start",
            run_id: run_id.to_string(),
            generation,
            turn: TurnStart {
                agent_context: ctx.agent_context.clone(),
                expected_binding: binding.clone(),
                lease_generation: 1,
                inputs_manifest: manifest.to_vec(),
                staging_dir: staging_dir.to_string_lossy().to_string(),
                turn_timeout_ms: TURN_TIMEOUT_MS,
            },
        })
        .await?;
        let pending = {
            let mut guard = self.active.lock().await;
            let p = guard.as_ref().map(|a| a.pending_cancel).unwrap_or(false);
            if let Some(active) = guard.as_mut() {
                active.turn_started = true;
                active.pending_cancel = false;
            }
            p
        };
        // A cancel armed during spawning is delivered back-to-back with
        // turn.start, so the worker winds down through run.cancelled.
        if pending {
            self.send(&ServiceTurnCancel {
                protocol: PROTOCOL,
                msg_id: new_msg_id(),
                msg_type: "service.turn.cancel",
                run_id: run_id.to_string(),
                generation,
                reason: "user_requested".to_string(),
            })
            .await?;
        }

        // Turn loop.
        loop {
            let value = frames
                .next_frame()
                .await
                .map_err(|e| fail(format!("turn transport: {e}")))?
                .ok_or_else(|| fail("worker exited mid-turn".to_string()))?;
            let msg = WorkerMessage::parse(value).map_err(fail)?;
            // Wrong run or stale generation is an explicit rejection, never
            // silence; without in_reply_to the worker fails the turn closed.
            let (msg_run, msg_gen, msg_id) = match &msg {
                WorkerMessage::Hello(_) => {
                    return Err(fail("unexpected hello mid-turn".to_string()))
                }
                WorkerMessage::EventsAppend(m) => {
                    (m.run_id.clone(), m.generation, Some(m.msg_id.clone()))
                }
                WorkerMessage::InputsFetch(m) => {
                    (m.run_id.clone(), m.generation, Some(m.msg_id.clone()))
                }
                WorkerMessage::ArtifactsDeliver(m) => {
                    (m.run_id.clone(), m.generation, Some(m.msg_id.clone()))
                }
                WorkerMessage::ApprovalRequest(m) => {
                    (m.run_id.clone(), m.generation, Some(m.msg_id.clone()))
                }
                WorkerMessage::Unknown { msg_id, .. } => {
                    self.send(&ServiceError {
                        protocol: PROTOCOL,
                        in_reply_to: msg_id.clone(),
                        msg_type: "service.error",
                        code: "malformed".to_string(),
                        message: "unknown message".to_string(),
                    })
                    .await?;
                    continue;
                }
            };
            if msg_run != run_id || msg_gen != generation {
                self.send(&ServiceError {
                    protocol: PROTOCOL,
                    in_reply_to: msg_id,
                    msg_type: "service.error",
                    code: if msg_run != run_id {
                        "wrong_run"
                    } else {
                        "stale_generation"
                    }
                    .to_string(),
                    message: "message is not for the active turn".to_string(),
                })
                .await?;
                continue;
            }
            match msg {
                WorkerMessage::EventsAppend(m) => {
                    // Pre-read the workspace snapshot when the batch
                    // completes the run: promotion must land in the same
                    // transaction as the completed event, and a missing
                    // snapshot fails the turn closed.
                    let wants_completed = m.events.iter().any(|e| e.event_type == "run.completed");
                    let listing = if wants_completed {
                        Some(self.read_workspace_listing(staging_dir)?)
                    } else {
                        None
                    };
                    let outcome = self
                        .db
                        .apply_worker_events(
                            run_id,
                            generation,
                            binding,
                            &m.events,
                            listing.as_deref(),
                        )
                        .map_err(|e| fail(format!("apply events: {}", e.message)))?;
                    let stored: Vec<StoredEvent> = outcome
                        .stored
                        .into_iter()
                        .map(|s| StoredEvent {
                            event_id: s.event_id,
                            seq: s.seq,
                            duplicate: s.duplicate,
                        })
                        .collect();
                    self.send(&ServiceEventsStored {
                        protocol: PROTOCOL,
                        in_reply_to: m.msg_id,
                        msg_type: "service.events.stored",
                        server_time_ms: now_ms(),
                        stored,
                    })
                    .await?;
                    // Resolve the turn only after the terminal event is saved
                    // and acked. A termination with no terminal event is a
                    // fail-closed reject, not a resolve.
                    if outcome.terminal {
                        let run = self
                            .db
                            .get_run(run_id)
                            .map_err(|e| fail(format!("read run: {}", e.message)))?;
                        use crate::domain::RunStatus::*;
                        // The PoC completed the turn on the terminal event
                        // regardless of artifact delivery: ordinary
                        // conversation turns produce no output files.
                        match run.status {
                            Completed | Failed | Cancelled | Interrupted => return Ok(()),
                            _ => {
                                return Err(fail(
                                    "worker terminated without completing".to_string(),
                                ))
                            }
                        }
                    }
                }
                WorkerMessage::InputsFetch(m) => {
                    self.on_inputs_fetch(blobs, &m).await?;
                }
                WorkerMessage::ArtifactsDeliver(m) => {
                    match self.on_artifacts_deliver(run_id, staging_dir, &m).await {
                        Ok(files) => {
                            self.send(&ServiceArtifactsStored {
                                protocol: PROTOCOL,
                                in_reply_to: m.msg_id,
                                msg_type: "service.artifacts.stored",
                                accepted: true,
                                manifest_digest: Some(m.manifest.manifest_digest),
                                stored_files: Some(
                                    files
                                        .into_iter()
                                        .map(|f: ArtifactFile| StoredFile {
                                            name: f.name,
                                            blob_digest: f.digest,
                                        })
                                        .collect(),
                                ),
                                rejection: None,
                            })
                            .await?;
                        }
                        Err((code, message)) => {
                            self.send(&ServiceArtifactsStored {
                                protocol: PROTOCOL,
                                in_reply_to: m.msg_id,
                                msg_type: "service.artifacts.stored",
                                accepted: false,
                                manifest_digest: None,
                                stored_files: None,
                                rejection: Some(seam::Rejection { code, message }),
                            })
                            .await?;
                        }
                    }
                }
                WorkerMessage::ApprovalRequest(m) => {
                    // No approval path in Phase 2. Reject, do not hang.
                    self.send(&ServiceError {
                        protocol: PROTOCOL,
                        in_reply_to: Some(m.msg_id),
                        msg_type: "service.error",
                        code: "internal".to_string(),
                        message: "approval path not implemented in Phase 2".to_string(),
                    })
                    .await?;
                }
                WorkerMessage::Hello(_) | WorkerMessage::Unknown { .. } => unreachable!(),
            }
        }
    }

    fn read_workspace_listing(
        &self,
        staging_dir: &Path,
    ) -> Result<Vec<crate::db::WorkspaceEntry>, SupervisorError> {
        let path = staging_dir.join("workspace-listing.json");
        let bytes = std::fs::read(&path).map_err(|_| {
            SupervisorError::TurnFailed("worker completed without a workspace snapshot".to_string())
        })?;
        serde_json::from_slice(&bytes).map_err(|_| {
            SupervisorError::TurnFailed("worker completed without a workspace snapshot".to_string())
        })
    }

    async fn on_inputs_fetch(
        &self,
        blobs: &HashMap<String, Vec<u8>>,
        m: &seam::WorkerInputsFetch,
    ) -> Result<(), SupervisorError> {
        let fail = |msg: String| SupervisorError::TurnFailed(msg);
        let bytes = match blobs.get(&m.digest) {
            Some(b) => b,
            None => {
                self.send(&ServiceError {
                    protocol: PROTOCOL,
                    in_reply_to: Some(m.msg_id.clone()),
                    msg_type: "service.error",
                    code: "internal".to_string(),
                    message: "unknown input digest".to_string(),
                })
                .await?;
                return Ok(());
            }
        };
        // PoC: length = min(msg.length || 262144, 262144); negative fails.
        let length = if m.length == 0 {
            INPUT_CHUNK_BYTES as i64
        } else {
            m.length.min(INPUT_CHUNK_BYTES as i64)
        };
        if m.offset < 0 || m.offset > bytes.len() as i64 || length < 1 {
            self.send(&ServiceError {
                protocol: PROTOCOL,
                in_reply_to: Some(m.msg_id.clone()),
                msg_type: "service.error",
                code: "malformed".to_string(),
                message: "bad chunk range".to_string(),
            })
            .await
            .map_err(|e| fail(e.to_string()))?;
            return Ok(());
        }
        let end = (m.offset + length).min(bytes.len() as i64) as usize;
        let chunk = &bytes[m.offset as usize..end];
        self.send(&ServiceInputsData {
            protocol: PROTOCOL,
            in_reply_to: m.msg_id.clone(),
            msg_type: "service.inputs.data",
            digest: m.digest.clone(),
            offset: m.offset,
            data: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, chunk),
            eof: end >= bytes.len(),
            total_size: bytes.len() as i64,
        })
        .await
        .map_err(|e| fail(e.to_string()))
    }

    /// Validate an artifact delivery and stage accepted bytes. Returns the
    /// accepted files on success, or (code, message) for a rejection reply.
    async fn on_artifacts_deliver(
        &self,
        run_id: &str,
        staging_dir: &Path,
        m: &seam::WorkerArtifactsDeliver,
    ) -> Result<Vec<ArtifactFile>, (String, String)> {
        let reject = |code: &str, message: &str| -> Result<Vec<ArtifactFile>, (String, String)> {
            Err((code.to_string(), message.to_string()))
        };
        let manifest = &m.manifest;
        if manifest.files.is_empty() || manifest.files.len() > ARTIFACT_MAX_FILES {
            return reject("malformed", "bad artifact manifest");
        }
        let mut canonical: Vec<(&str, &str, i64)> = manifest
            .files
            .iter()
            .map(|f| (f.name.as_str(), f.digest.as_str(), f.size))
            .collect();
        canonical.sort_by(|a, b| a.0.cmp(b.0));
        let canonical_json = serde_json::to_string(&canonical).map_err(|_| {
            (
                "internal".to_string(),
                "artifact delivery failed".to_string(),
            )
        })?;
        if sha256_hex(canonical_json.as_bytes()) != manifest.manifest_digest {
            return reject("digest_mismatch", "manifest digest mismatch");
        }
        if manifest.total_bytes != manifest.files.iter().map(|f| f.size).sum::<i64>() {
            return reject("malformed", "total_bytes mismatch");
        }
        if manifest.total_bytes > ARTIFACT_TOTAL_CAP_BYTES as i64 {
            return reject("malformed", "artifact total exceeds 8 MiB cap");
        }
        let mut names = std::collections::HashSet::new();
        let mut entries: Vec<(String, Vec<u8>)> = vec![];
        for f in &manifest.files {
            if !names.insert(f.name.clone()) {
                return reject("malformed", "bad file entry");
            }
            // The staging ref is worker-chosen; confine it to a bare
            // filename so it cannot escape the staging dir.
            if !valid_staging_ref(&f.staging_ref) {
                return reject("malformed", "bad staging ref");
            }
            let bytes = std::fs::read(staging_dir.join(&f.staging_ref)).map_err(|_| {
                (
                    "internal".to_string(),
                    "staged artifact missing".to_string(),
                )
            })?;
            if bytes.len() as i64 != f.size || sha256_hex(&bytes) != f.digest {
                return reject("digest_mismatch", "artifact bytes do not match manifest");
            }
            entries.push((f.name.clone(), bytes));
        }
        // Multiple deliveries within a turn accumulate; the seam's completed
        // event still names only one manifest digest (known gap).
        match self.db.store_delivered_artifacts(run_id, entries) {
            Ok(()) => Ok(manifest.files.clone()),
            Err(_) => reject("internal", "artifact delivery failed"),
        }
    }
}

fn valid_staging_ref(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphanumeric() => {}
        _ => return false,
    }
    name.len() <= 128
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

fn set_mode_700(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
}

async fn reap_child(child: &mut Child) {
    // SIGTERM first, then SIGKILL after the grace period (the PoC's
    // reapChild escalation; tokio's start_kill is SIGKILL on Unix).
    if wait_exit(child, REAP_GRACE).await {
        return;
    }
    if let Some(pid) = child.id() {
        libc_kill(pid, 15);
    }
    if wait_exit(child, REAP_GRACE).await {
        return;
    }
    let _ = child.start_kill();
    let _ = timeout(REAP_GRACE, child.wait()).await;
}

async fn wait_exit(child: &mut Child, grace: Duration) -> bool {
    let deadline = tokio::time::Instant::now() + grace;
    loop {
        match child.try_wait() {
            Ok(Some(_)) | Err(_) => return true,
            Ok(None) => {}
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

#[cfg(unix)]
fn libc_kill(pid: u32, sig: i32) {
    unsafe {
        libc::kill(pid as i32, sig);
    }
}

#[cfg(not(unix))]
fn libc_kill(_pid: u32, _sig: i32) {}

/// Verify the execution environment exactly as the PoC's readBinding did:
/// image, auth store, engine, and seccomp policy. Any mismatch fails closed.
async fn read_binding(repo_root: &Path) -> Result<Binding, String> {
    let context = "colima-agentmeld-m0";
    let docker = |args: &[&str]| {
        let args: Vec<String> = args.iter().map(|s| s.to_string()).collect();
        async move {
            let mut cmd = Command::new("docker");
            cmd.arg("--context").arg(context);
            for a in &args {
                cmd.arg(a);
            }
            let out = cmd.output().await.map_err(|e| format!("docker: {e}"))?;
            if !out.status.success() {
                return Err(format!("docker {args:?} failed"));
            }
            Ok::<String, String>(String::from_utf8_lossy(&out.stdout).trim().to_string())
        }
    };
    let image = docker(&[
        "image",
        "inspect",
        "agentmeld-m0:local",
        "--format",
        "{{.Id}}",
    ])
    .await?;
    if !image.starts_with("sha256:") || image.len() != 7 + 64 {
        return Err("unexpected image id".to_string());
    }
    let store_raw = std::fs::read_to_string(repo_root.join(".local/m0/subscription/store.jsonl"))
        .map_err(|e| format!("read auth store: {e}"))?;
    let entries: Vec<serde_json::Value> = store_raw
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(serde_json::from_str)
        .collect::<Result<_, _>>()
        .map_err(|e| format!("parse auth store: {e}"))?;
    let store = entries.first().ok_or("empty auth store")?;
    if store.get("context").and_then(|v| v.as_str()) != Some(context) {
        return Err("auth store context mismatch".to_string());
    }
    let engine = docker(&["info", "--format", "{{.ID}}"]).await?;
    if store.get("engine").and_then(|v| v.as_str()) != Some(engine.as_str()) {
        return Err("engine mismatch".to_string());
    }
    let instance = store
        .get("instance")
        .and_then(|v| v.as_str())
        .ok_or("auth store missing instance")?;
    if !entries.iter().any(|e| {
        e.get("status").and_then(|v| v.as_str()) == Some("subscription-auth-imported")
            && e.get("instance").and_then(|v| v.as_str()) == Some(instance)
    }) {
        return Err("subscription auth not imported".to_string());
    }
    // validateStore: the volume's labels must match the store name/instance.
    let name = store
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or("auth store missing name")?;
    let vol = docker(&["volume", "inspect", name]).await?;
    let vol0: serde_json::Value =
        serde_json::from_str(&vol).map_err(|_| "volume inspect parse".to_string())?;
    let vol0 = vol0.get(0).ok_or("volume not found")?;
    let labels = vol0
        .get("Labels")
        .and_then(|v| v.as_object())
        .ok_or("volume labels")?;
    if labels.get("agentmeld.store").and_then(|v| v.as_str()) != Some(name)
        || labels.get("agentmeld.instance").and_then(|v| v.as_str()) != Some(instance)
    {
        return Err("auth store volume mismatch".to_string());
    }
    // Seccomp policy: verify the prepared policy and digest it.
    let script = format!(
        "import importlib.util,json,pathlib\nroot=pathlib.Path({})\nspec=importlib.util.spec_from_file_location(\"policy\",root/\"scripts/prepare-codex-policy.py\")\nmodule=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(module)\nprint(json.dumps([str(p) for p in module.verify_prepared(root)]))",
        serde_json::to_string(&repo_root.to_string_lossy()).unwrap()
    );
    let out = Command::new("python3")
        .arg("-c")
        .arg(script)
        .output()
        .await
        .map_err(|e| format!("policy verify: {e}"))?;
    if !out.status.success() {
        return Err("policy verification failed".to_string());
    }
    let policies: Vec<String> =
        serde_json::from_slice(&out.stdout).map_err(|_| "policy verify output".to_string())?;
    let policy_path = policies.first().ok_or("no prepared policy")?;
    let policy_bytes = std::fs::read(policy_path).map_err(|e| format!("read policy: {e}"))?;
    let policy_digest = sha256_hex(&policy_bytes);
    Ok(Binding {
        image_digest: image.trim_start_matches("sha256:").to_string(),
        store_instance: instance.to_string(),
        model: "gpt-5.5".to_string(),
        policy_digest,
    })
}
