// worker-seam/1 protocol codec.
//
// JSON-lines framing over the Unix socket (1 MiB frame cap) and the typed
// message inventory from docs/specs/worker-service-seam.md. Worker->service
// shapes deny unknown fields, matching the schemas' additionalProperties:
// false (the M0 journal's deny_unknown_fields spirit).

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};

pub const PROTOCOL: &str = "worker-seam/1";
pub const MAX_FRAME_BYTES: usize = 1024 * 1024;
pub const INPUT_CHUNK_BYTES: usize = 256 * 1024;
pub const ARTIFACT_TOTAL_CAP_BYTES: u64 = 8 * 1024 * 1024;
pub const ARTIFACT_MAX_FILES: usize = 64;

#[derive(Debug)]
pub enum SeamError {
    Io(String),
    FrameTooLarge,
    MalformedJson(String),
}

impl std::fmt::Display for SeamError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SeamError::Io(e) => write!(f, "io: {e}"),
            SeamError::FrameTooLarge => write!(f, "frame exceeds 1 MiB cap"),
            SeamError::MalformedJson(e) => write!(f, "malformed JSON frame: {e}"),
        }
    }
}

impl std::error::Error for SeamError {}

/// Write one JSON-lines frame.
pub async fn send_frame<W>(writer: &mut W, value: &impl Serialize) -> std::io::Result<()>
where
    W: AsyncWriteExt + Unpin,
{
    let mut bytes = serde_json::to_vec(value).expect("frame serialization");
    bytes.push(b'\n');
    writer.write_all(&bytes).await?;
    writer.flush().await
}

/// Read newline-delimited frames, enforcing the 1 MiB cap. Returns None on
/// clean EOF.
pub struct FrameReader<R> {
    reader: tokio::io::BufReader<R>,
    buf: Vec<u8>,
}

impl<R: tokio::io::AsyncRead + Unpin> FrameReader<R> {
    pub fn new(inner: R) -> Self {
        FrameReader {
            reader: tokio::io::BufReader::new(inner),
            buf: Vec::new(),
        }
    }

    pub async fn next_frame(&mut self) -> Result<Option<serde_json::Value>, SeamError> {
        loop {
            if let Some(pos) = self.buf.iter().position(|&b| b == b'\n') {
                let line: Vec<u8> = self.buf.drain(..=pos).collect();
                let line = &line[..line.len() - 1]; // strip newline
                if line.is_empty() {
                    continue;
                }
                // The pre-read cap above only bounds the buffer before a
                // read; a single read_until can deliver a whole oversized
                // line at once, so enforce the cap on the drained frame too.
                if line.len() > MAX_FRAME_BYTES {
                    return Err(SeamError::FrameTooLarge);
                }
                let v: serde_json::Value = serde_json::from_slice(line)
                    .map_err(|e| SeamError::MalformedJson(e.to_string()))?;
                return Ok(Some(v));
            }
            if self.buf.len() > MAX_FRAME_BYTES {
                return Err(SeamError::FrameTooLarge);
            }
            let n = self
                .reader
                .read_until(b'\n', &mut self.buf)
                .await
                .map_err(|e| SeamError::Io(e.to_string()))?;
            if n == 0 {
                if self.buf.is_empty() {
                    return Ok(None);
                }
                return Err(SeamError::MalformedJson(
                    "truncated frame at EOF".to_string(),
                ));
            }
        }
    }
}

// ------------------------------------------------------------- wire messages

fn protocol_is(v: &str) -> bool {
    v == PROTOCOL
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerHello {
    pub protocol: String,
    pub msg_id: String,
    pub msg_type: String,
    pub worker_pid: i64,
    pub worker_token: String,
}

impl WorkerHello {
    pub fn check(self) -> Result<Self, String> {
        if !protocol_is(&self.protocol) {
            return Err("protocol mismatch".to_string());
        }
        if self.msg_type != "worker.session.hello" {
            return Err("bad worker hello".to_string());
        }
        Ok(self)
    }
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ServiceWelcome {
    pub protocol: &'static str,
    pub in_reply_to: String,
    pub msg_type: &'static str,
    pub ok: bool,
    pub worker_id: String,
    pub negotiated_protocol: &'static str,
    pub max_frame_bytes: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerEvent {
    pub event_id: String,
    pub event_type: String,
    #[serde(default)]
    pub dedupe_key: Option<String>,
    #[serde(default)]
    pub payload: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerEventsAppend {
    pub protocol: String,
    pub msg_id: String,
    pub msg_type: String,
    pub run_id: String,
    pub generation: i64,
    pub events: Vec<WorkerEvent>,
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
pub struct StoredEvent {
    pub event_id: String,
    pub seq: i64,
    pub duplicate: bool,
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ServiceEventsStored {
    pub protocol: &'static str,
    pub in_reply_to: String,
    pub msg_type: &'static str,
    pub server_time_ms: i64,
    pub stored: Vec<StoredEvent>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerInputsFetch {
    pub protocol: String,
    pub msg_id: String,
    pub msg_type: String,
    pub run_id: String,
    pub generation: i64,
    pub digest: String,
    #[serde(default)]
    pub offset: i64,
    #[serde(default)]
    pub length: i64,
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ServiceInputsData {
    pub protocol: &'static str,
    pub in_reply_to: String,
    pub msg_type: &'static str,
    pub digest: String,
    pub offset: i64,
    pub data: String,
    pub eof: bool,
    pub total_size: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactFile {
    pub name: String,
    pub digest: String,
    pub size: i64,
    pub staging_ref: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactManifest {
    pub manifest_digest: String,
    pub files: Vec<ArtifactFile>,
    pub total_bytes: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerArtifactsDeliver {
    pub protocol: String,
    pub msg_id: String,
    pub msg_type: String,
    pub run_id: String,
    pub generation: i64,
    pub manifest: ArtifactManifest,
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ServiceArtifactsStored {
    pub protocol: &'static str,
    pub in_reply_to: String,
    pub msg_type: &'static str,
    pub accepted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manifest_digest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stored_files: Option<Vec<StoredFile>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rejection: Option<Rejection>,
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
pub struct StoredFile {
    pub name: String,
    pub blob_digest: String,
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Rejection {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerApprovalRequest {
    pub protocol: String,
    pub msg_id: String,
    pub msg_type: String,
    pub run_id: String,
    pub generation: i64,
    // approval.* details are not interpreted in Phase 2: the request is
    // rejected explicitly, never silently.
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ServiceError {
    pub protocol: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub in_reply_to: Option<String>,
    pub msg_type: &'static str,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct Binding {
    pub image_digest: String,
    pub store_instance: String,
    pub model: String,
    pub policy_digest: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct InputManifestEntry {
    pub name: String,
    pub digest: String,
    pub size: i64,
    pub kind: String,
}

#[derive(Debug, Serialize)]
pub struct TurnStart {
    pub agent_context: String,
    pub expected_binding: Binding,
    pub lease_generation: i64,
    pub inputs_manifest: Vec<InputManifestEntry>,
    pub staging_dir: String,
    pub turn_timeout_ms: i64,
}

#[derive(Debug, Serialize)]
pub struct ServiceTurnStart {
    pub protocol: &'static str,
    pub msg_id: String,
    pub msg_type: &'static str,
    pub run_id: String,
    pub generation: i64,
    pub turn: TurnStart,
}

#[derive(Debug, Serialize)]
pub struct ServiceTurnCancel {
    pub protocol: &'static str,
    pub msg_id: String,
    pub msg_type: &'static str,
    pub run_id: String,
    pub generation: i64,
    pub reason: String,
}

/// Route an incoming worker frame to its typed shape by msg_type.
#[derive(Debug)]
pub enum WorkerMessage {
    Hello(WorkerHello),
    EventsAppend(WorkerEventsAppend),
    InputsFetch(WorkerInputsFetch),
    ArtifactsDeliver(WorkerArtifactsDeliver),
    ApprovalRequest(WorkerApprovalRequest),
    Unknown {
        msg_type: String,
        msg_id: Option<String>,
    },
}

impl WorkerMessage {
    pub fn parse(value: serde_json::Value) -> Result<Self, String> {
        let msg_type = value
            .get("msg_type")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "missing msg_type".to_string())?
            .to_string();
        let msg_id = value
            .get("msg_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let protocol = value.get("protocol").and_then(|v| v.as_str()).unwrap_or("");
        if !protocol_is(protocol) {
            return Err("protocol mismatch".to_string());
        }
        let parsed = match msg_type.as_str() {
            "worker.session.hello" => WorkerMessage::Hello(
                serde_json::from_value::<WorkerHello>(value)
                    .map_err(|e| format!("bad hello: {e}"))?
                    .check()?,
            ),
            "worker.events.append" => WorkerMessage::EventsAppend(
                serde_json::from_value(value).map_err(|e| format!("bad events.append: {e}"))?,
            ),
            "worker.inputs.fetch" => WorkerMessage::InputsFetch(
                serde_json::from_value(value).map_err(|e| format!("bad inputs.fetch: {e}"))?,
            ),
            "worker.artifacts.deliver" => WorkerMessage::ArtifactsDeliver(
                serde_json::from_value(value).map_err(|e| format!("bad artifacts.deliver: {e}"))?,
            ),
            "worker.approvals.request-decision" => WorkerMessage::ApprovalRequest(
                serde_json::from_value(value).map_err(|e| format!("bad approvals.request: {e}"))?,
            ),
            other => WorkerMessage::Unknown {
                msg_type: other.to_string(),
                msg_id,
            },
        };
        Ok(parsed)
    }
}
