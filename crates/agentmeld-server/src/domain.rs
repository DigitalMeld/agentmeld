// Shared domain vocabulary.
//
// Ports the *vocabulary* (not the logic) of crates/agentmeld-m0: the
// StaleLease / ChangedAction / WrongScope error taxonomy becomes domain types
// and service error codes. Run states and UI milestone labels follow the PoC.

use std::time::{SystemTime, UNIX_EPOCH};

/// Run lifecycle states. Mirrors the core-schema.sql CHECK constraint.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunStatus {
    Queued,
    Starting,
    Running,
    WaitingApproval,
    WaitingHuman,
    Cancelling,
    Cancelled,
    Completed,
    Failed,
    Interrupted,
    Reconciling,
    NeedsAttention,
}

impl RunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            RunStatus::Queued => "queued",
            RunStatus::Starting => "starting",
            RunStatus::Running => "running",
            RunStatus::WaitingApproval => "waiting_approval",
            RunStatus::WaitingHuman => "waiting_human",
            RunStatus::Cancelling => "cancelling",
            RunStatus::Cancelled => "cancelled",
            RunStatus::Completed => "completed",
            RunStatus::Failed => "failed",
            RunStatus::Interrupted => "interrupted",
            RunStatus::Reconciling => "reconciling",
            RunStatus::NeedsAttention => "needs_attention",
        }
    }

    pub fn parse(s: &str) -> Option<RunStatus> {
        Some(match s {
            "queued" => RunStatus::Queued,
            "starting" => RunStatus::Starting,
            "running" => RunStatus::Running,
            "waiting_approval" => RunStatus::WaitingApproval,
            "waiting_human" => RunStatus::WaitingHuman,
            "cancelling" => RunStatus::Cancelling,
            "cancelled" => RunStatus::Cancelled,
            "completed" => RunStatus::Completed,
            "failed" => RunStatus::Failed,
            "interrupted" => RunStatus::Interrupted,
            "reconciling" => RunStatus::Reconciling,
            "needs_attention" => RunStatus::NeedsAttention,
            _ => return None,
        })
    }

    /// States that hold the single-flight pump slot.
    pub fn is_active(self) -> bool {
        matches!(
            self,
            RunStatus::Starting
                | RunStatus::Running
                | RunStatus::WaitingApproval
                | RunStatus::WaitingHuman
                | RunStatus::Cancelling
                | RunStatus::Reconciling
        )
    }

    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            RunStatus::Cancelled
                | RunStatus::Completed
                | RunStatus::Failed
                | RunStatus::Interrupted
        )
    }
}

/// Error taxonomy ported from control.rs as vocabulary: StaleLease,
/// ChangedAction, WrongScope become these service error codes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceErrorCode {
    WrongRun,        // WrongScope at the seam
    StaleGeneration, // StaleLease at the seam
    Malformed,
    UnknownMessage,
    PayloadTooLarge,
    AuthFailed,
    Internal,
    TurnInProgress,
}

impl ServiceErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            ServiceErrorCode::WrongRun => "wrong_run",
            ServiceErrorCode::StaleGeneration => "stale_generation",
            ServiceErrorCode::Malformed => "malformed",
            ServiceErrorCode::UnknownMessage => "unknown_message",
            ServiceErrorCode::PayloadTooLarge => "payload_too_large",
            ServiceErrorCode::AuthFailed => "auth_failed",
            ServiceErrorCode::Internal => "internal",
            ServiceErrorCode::TurnInProgress => "turn_in_progress",
        }
    }
}

/// UI milestone labels, verbatim from the PoC's recordEvent label set.
pub fn milestone_label(kind: &str) -> Option<&'static str> {
    Some(match kind {
        "run.queued" => "Queued",
        "run.started" => "Started",
        "run.restored" => "Working files ready",
        "run.thinking" => "Agent ready",
        "run.saving" => "Saving results",
        "run.completed" => "Completed",
        "run.failed" => "Failed",
        "run.cancelled" => "Stopped",
        "run.interrupted" => "Interrupted by service restart",
        "run.cancelling" => "Stop requested",
        _ => return None,
    })
}

/// Validation failures carry a user-safe message and an HTTP status, like the
/// PoC's RequestError.
#[derive(Debug)]
pub struct RequestError {
    pub message: String,
    pub status: u16,
}

impl RequestError {
    pub fn new(message: impl Into<String>, status: u16) -> Self {
        RequestError {
            message: message.into(),
            status,
        }
    }

    pub fn bad(message: impl Into<String>) -> Self {
        Self::new(message, 400)
    }
}

impl std::fmt::Display for RequestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} (status {})", self.message, self.status)
    }
}

impl std::error::Error for RequestError {}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before epoch")
        .as_millis() as i64
}

/// Milliseconds since the Unix epoch to an ISO-8601 UTC string
/// (the PoC stored ISO timestamps; the schema stores INTEGER ms).
pub fn ms_to_iso(ms: i64) -> String {
    // Howard Hinnant's days-to-civil algorithm.
    let days = ms.div_euclid(86_400_000);
    let ms_of_day = ms.rem_euclid(86_400_000);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    let (hh, mm, ss) = (
        ms_of_day / 3_600_000,
        (ms_of_day / 60_000) % 60,
        (ms_of_day / 1000) % 60,
    );
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year,
        m,
        d,
        hh,
        mm,
        ss,
        ms_of_day % 1000
    )
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(bytes))
}

/// Constant-time byte comparison for credential checks.
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// 32 bytes of OS entropy for tokens.
pub fn random_32() -> [u8; 32] {
    use std::io::Read;
    let mut f = std::fs::File::open("/dev/urandom").expect("/dev/urandom unavailable");
    let mut buf = [0u8; 32];
    f.read_exact(&mut buf)
        .expect("short read from /dev/urandom");
    buf
}

pub fn new_token_b64url() -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(random_32())
}

pub fn new_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// New protocol message id (a UUID, like the PoC's newMsgId).
pub fn new_msg_id() -> String {
    new_uuid()
}

/// Truncate to at most `max` Unicode scalar values (never splits a
/// character). Used for bounded text columns like `tool_steps.title`.
pub fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max).collect()
    }
}
