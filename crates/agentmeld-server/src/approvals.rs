// Phase 3 approval path: the ChangedAction canonical digest, proposal
// validation, and the registry of blocked approval waiters shared between
// the supervisor (which registers a waiter when the worker proposes) and the
// HTTP layer (which resolves it when the human decides, or the sweeper when
// the approval expires).
//
// Design: docs/design/approval-path.md (issue #84), implemented for #86.

use std::collections::HashMap;
use std::sync::Mutex;

use tokio::sync::oneshot;

use crate::domain::sha256_hex;

/// Proposal bounds from the seam schema (`worker-approvals-request-decision`)
/// and the M0 journal: approval TTL window, user-description length, tool and
/// target name lengths, and the argument object shape (property count and
/// scalar value length). Enforced service-side by `validate_proposal`.
pub const APPROVAL_TTL_MIN_MS: i64 = 1;
pub const APPROVAL_TTL_MAX_MS: i64 = 300_000;
pub const DESCRIPTION_MAX_CHARS: usize = 512;
pub const TOOL_MAX_CHARS: usize = 64;
pub const TARGET_MAX_CHARS: usize = 512;
pub const ARGUMENTS_MAX_PROPS: usize = 16;
pub const ARGUMENT_VALUE_MAX_CHARS: usize = 2048;

/// A validated approval proposal, ready for the row insert.
#[derive(Debug, Clone)]
pub struct ValidProposal {
    /// Canonical action JSON (the exact digest input).
    pub action_json: String,
    /// The action's target, as JSON (queryability; the digest covers the
    /// whole action, not this column alone).
    pub target_json: String,
    pub description_user: String,
    pub ttl_ms: i64,
    pub digest: String,
}

/// Canonical form of an action value: UTF-8 JSON with object keys sorted
/// lexicographically by Unicode code point, no insignificant whitespace.
///
/// Byte layout (fully specified so the worker can reimplement it exactly):
///   * objects: `{` then `"key":value` pairs joined by `,` (nothing around
///     the separators), keys in ascending Unicode code-point order, then `}`
///   * arrays: `[` elements joined by `,` then `]`
///   * strings: JSON quoting with minimal escaping (`"`, `\`, and control
///     characters as `\u00XX`; `/` and non-ASCII are not escaped)
///   * numbers: serde_json's representation-preserving rendering
///     (no normalization: `1` and `1.0` are different inputs)
///   * `true`, `false`, `null` literally
///
/// The digest is SHA-256 hex over these bytes.
pub fn canonical_json(value: &serde_json::Value) -> String {
    fn write_into(out: &mut String, v: &serde_json::Value) {
        match v {
            serde_json::Value::Null => out.push_str("null"),
            serde_json::Value::Bool(true) => out.push_str("true"),
            serde_json::Value::Bool(false) => out.push_str("false"),
            serde_json::Value::Number(n) => out.push_str(&n.to_string()),
            serde_json::Value::String(s) => {
                // Minimal escaping: quote, backslash, control characters.
                out.push('"');
                for c in s.chars() {
                    match c {
                        '"' => out.push_str("\\\""),
                        '\\' => out.push_str("\\\\"),
                        c if (c as u32) < 0x20 => {
                            out.push_str(&format!("\\u{:04x}", c as u32));
                        }
                        c => out.push(c),
                    }
                }
                out.push('"');
            }
            serde_json::Value::Array(items) => {
                out.push('[');
                for (i, item) in items.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    write_into(out, item);
                }
                out.push(']');
            }
            serde_json::Value::Object(map) => {
                out.push('{');
                let mut keys: Vec<&String> = map.keys().collect();
                keys.sort();
                for (i, key) in keys.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    write_into(out, &serde_json::Value::String((*key).clone()));
                    out.push(':');
                    write_into(out, &map[*key]);
                }
                out.push('}');
            }
        }
    }
    let mut out = String::new();
    write_into(&mut out, value);
    out
}

/// The ChangedAction digest: SHA-256 hex over the canonical action bytes.
/// The service recomputes this from the stored action at propose, decide,
/// and dispatch — it never trusts a worker-sent digest.
pub fn action_digest(action: &serde_json::Value) -> String {
    sha256_hex(canonical_json(action).as_bytes())
}

/// Validate the wire proposal shape (the seam schema's bounds, enforced
/// service-side so a hostile worker cannot smuggle an oversized or
/// misshapen action into the approvals table).
pub fn validate_proposal(
    action: &serde_json::Value,
    description_user: &str,
    ttl_ms: i64,
) -> Result<ValidProposal, String> {
    let obj = action
        .as_object()
        .ok_or_else(|| "approval action must be an object".to_string())?;
    // The seam schema pins additionalProperties: false on the action.
    for key in obj.keys() {
        if !matches!(key.as_str(), "tool" | "target" | "arguments") {
            return Err(format!("unknown approval action field: {key}"));
        }
    }
    let tool = obj
        .get("tool")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "approval action is missing tool".to_string())?;
    if tool.is_empty() || tool.chars().count() > TOOL_MAX_CHARS {
        return Err("approval tool name is out of bounds".to_string());
    }
    let target = obj
        .get("target")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "approval action is missing target".to_string())?;
    if target.is_empty() || target.chars().count() > TARGET_MAX_CHARS {
        return Err("approval target is out of bounds".to_string());
    }
    let arguments = obj
        .get("arguments")
        .and_then(|v| v.as_object())
        .ok_or_else(|| "approval arguments must be an object".to_string())?;
    if arguments.len() > ARGUMENTS_MAX_PROPS {
        return Err("approval arguments exceed the property bound".to_string());
    }
    for (key, value) in arguments {
        // The seam schema bounds argument values to scalars; nested
        // objects/arrays are rejected here so the canonical form stays
        // shallow and auditable.
        match value {
            serde_json::Value::String(s) => {
                if s.chars().count() > ARGUMENT_VALUE_MAX_CHARS {
                    return Err(format!("approval argument is too long: {key}"));
                }
            }
            serde_json::Value::Number(_) | serde_json::Value::Bool(_) | serde_json::Value::Null => {
            }
            _ => {
                return Err(format!("approval argument must be a scalar: {key}"));
            }
        }
    }
    if description_user.is_empty() || description_user.chars().count() > DESCRIPTION_MAX_CHARS {
        return Err("approval description is out of bounds".to_string());
    }
    if !(APPROVAL_TTL_MIN_MS..=APPROVAL_TTL_MAX_MS).contains(&ttl_ms) {
        return Err("approval ttl_ms is out of bounds".to_string());
    }
    let action_json = canonical_json(action);
    let target_json = canonical_json(&serde_json::Value::String(target.to_string()));
    let digest = sha256_hex(action_json.as_bytes());
    Ok(ValidProposal {
        action_json,
        target_json,
        description_user: description_user.to_string(),
        ttl_ms,
        digest,
    })
}

/// The outcome delivered to the supervisor's blocked approval wait.
#[derive(Debug, Clone)]
pub enum ApprovalOutcome {
    /// Human approved: the single-use ticket travels to the worker ONLY in
    /// the seam reply — never in the HTTP decision response.
    Approved {
        ticket: String,
        digest: String,
        decided_at_ms: i64,
    },
    Denied {
        digest: String,
        decided_at_ms: i64,
    },
    /// Server-time expiry swept the row.
    Expired,
    /// The row was terminally settled by revocation/takeover while the
    /// worker was blocked. On the wire this is delivered as `denied`
    /// (the action will not run); the row itself stays `revoked`.
    Revoked,
}

/// Waiters blocked on a human decision, keyed by approval id. The
/// supervisor registers when the worker proposes; the HTTP decision handler
/// and the expiry sweeper resolve. Registration is removed exactly once —
/// by resolve, unregister (wait abandoned), or the sweeper — so a decision
/// and an expiry can never both fire.
pub struct PendingApprovals {
    inner: Mutex<HashMap<String, oneshot::Sender<ApprovalOutcome>>>,
}

impl PendingApprovals {
    /// An empty waiter registry.
    pub fn new() -> Self {
        PendingApprovals {
            inner: Mutex::new(HashMap::new()),
        }
    }

    /// Register a waiter for an approval id. Replaces any stale entry for
    /// the same id (a stale entry means a previous wait leaked, which must
    /// not block a new decision).
    pub fn register(&self, approval_id: &str, tx: oneshot::Sender<ApprovalOutcome>) {
        if let Ok(mut guard) = self.inner.lock() {
            guard.insert(approval_id.to_string(), tx);
        }
    }

    /// Abandon a wait without delivering an outcome (cancel raced the
    /// decision; worker death; turn teardown). The row keeps whatever
    /// state the database gave it.
    pub fn unregister(&self, approval_id: &str) {
        if let Ok(mut guard) = self.inner.lock() {
            guard.remove(approval_id);
        }
    }

    /// Deliver an outcome to the waiter, if one is still registered.
    /// Returns true when a waiter received it.
    pub fn resolve(&self, approval_id: &str, outcome: ApprovalOutcome) -> bool {
        let tx = match self.inner.lock() {
            Ok(mut guard) => guard.remove(approval_id),
            Err(_) => return false,
        };
        match tx {
            Some(tx) => tx.send(outcome).is_ok(),
            None => false,
        }
    }

    /// Await an already-registered waiter, unregistering on abandonment.
    /// The supervisor uses this on the propose path: the waiter is
    /// registered BEFORE the approval row is published, so no HTTP
    /// decision can slip between publication and waiter readiness — the
    /// raw ticket in the outcome is never lost to the race.
    pub async fn wait_registered(
        &self,
        approval_id: &str,
        rx: oneshot::Receiver<ApprovalOutcome>,
    ) -> ApprovalOutcome {
        struct Guard<'a> {
            pending: &'a PendingApprovals,
            id: String,
        }
        impl Drop for Guard<'_> {
            fn drop(&mut self) {
                self.pending.unregister(&self.id);
            }
        }
        let _guard = Guard {
            pending: self,
            id: approval_id.to_string(),
        };
        // resolve() removes the registration before sending, so the
        // guard's unregister is a no-op on the happy path.
        rx.await.unwrap_or(ApprovalOutcome::Revoked)
    }
}

impl Default for PendingApprovals {
    fn default() -> Self {
        Self::new()
    }
}

/// Approval row states. `superseded` is deliberately absent: supersession
/// is `revoked` with `revoked_reason = 'superseded'` (resolved §12.1 —
/// schema rules).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalState {
    Pending,
    Approved,
    Denied,
    Expired,
    Revoked,
}

impl ApprovalState {
    /// The row string stored in SQLite and served over the API.
    pub fn as_str(self) -> &'static str {
        match self {
            ApprovalState::Pending => "pending",
            ApprovalState::Approved => "approved",
            ApprovalState::Denied => "denied",
            ApprovalState::Expired => "expired",
            ApprovalState::Revoked => "revoked",
        }
    }

    /// Parse a row string back into the state; `None` for anything else.
    pub fn parse(s: &str) -> Option<ApprovalState> {
        Some(match s {
            "pending" => ApprovalState::Pending,
            "approved" => ApprovalState::Approved,
            "denied" => ApprovalState::Denied,
            "expired" => ApprovalState::Expired,
            "revoked" => ApprovalState::Revoked,
            _ => return None,
        })
    }

    /// Terminal states never leave: no path returns a settled approval to
    /// `pending` — a changed action is a new proposal.
    pub fn is_terminal(self) -> bool {
        !matches!(self, ApprovalState::Pending)
    }
}

/// One row of the approvals table.
#[derive(Debug, Clone)]
pub struct ApprovalRow {
    pub id: String,
    pub run_id: String,
    pub action_digest: String,
    pub action_json: String,
    pub target_json: String,
    pub description_user: String,
    pub ticket_hash: Option<String>,
    pub consumed_at: Option<i64>,
    pub grant_revision: i64,
    pub lease_generation: i64,
    pub state: ApprovalState,
    pub revoked_reason: Option<String>,
    pub expires_at_ms: i64,
    pub decided_by: Option<String>,
    pub decided_at_ms: Option<i64>,
    pub created_at_ms: i64,
}

impl ApprovalRow {
    /// The human-facing receipt. Never includes the ticket hash: the
    /// ticket is a worker-bound execution credential, not a client field.
    /// The operator-facing receipt. Never includes the ticket or its hash.
    pub fn public_json(&self) -> serde_json::Value {
        serde_json::json!({
            "id": self.id,
            "run_id": self.run_id,
            "action": serde_json::from_str::<serde_json::Value>(&self.action_json).unwrap_or(serde_json::Value::Null),
            "description_user": self.description_user,
            "action_digest": self.action_digest,
            "state": self.state.as_str(),
            "revoked_reason": self.revoked_reason,
            "expires_at_ms": self.expires_at_ms,
            "decided_by": self.decided_by,
            "decided_at_ms": self.decided_at_ms,
            "created_at_ms": self.created_at_ms,
        })
    }
}

/// Controller-lease states: the journal's
/// Takeover → pausing → human → resume → resuming → observed → agent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LeaseState {
    Agent,
    Pausing,
    Human,
    Resuming,
    Observed,
    Paused,
}

impl LeaseState {
    /// The row string stored in SQLite and served over the API.
    pub fn as_str(self) -> &'static str {
        match self {
            LeaseState::Agent => "agent",
            LeaseState::Pausing => "pausing",
            LeaseState::Human => "human",
            LeaseState::Resuming => "resuming",
            LeaseState::Observed => "observed",
            LeaseState::Paused => "paused",
        }
    }

    /// Parse a row string back into the state; `None` for anything else.
    pub fn parse(s: &str) -> Option<LeaseState> {
        Some(match s {
            "agent" => LeaseState::Agent,
            "pausing" => LeaseState::Pausing,
            "human" => LeaseState::Human,
            "resuming" => LeaseState::Resuming,
            "observed" => LeaseState::Observed,
            "paused" => LeaseState::Paused,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone)]
/// One row of the controller lease: who holds the computer, at which
/// generation, in which state.
pub struct LeaseRow {
    pub generation: i64,
    pub state: LeaseState,
    pub holder_device_id: Option<String>,
    pub private_bracket: bool,
    pub held_since_ms: Option<i64>,
    pub heartbeat_at_ms: Option<i64>,
    pub updated_at_ms: i64,
}

impl LeaseRow {
    /// The operator-facing receipt: state, generation, holder, heartbeat.
    /// Never includes credentials or private-bracket contents.
    pub fn public_json(&self) -> serde_json::Value {
        serde_json::json!({
            "state": self.state.as_str(),
            "generation": self.generation,
            "holder_device_id": self.holder_device_id,
            "private_bracket": self.private_bracket,
            "held_since_ms": self.held_since_ms,
            "heartbeat_at_ms": self.heartbeat_at_ms,
        })
    }
}

/// A lease hold goes stale without a heartbeat; the holder is assumed gone
/// and the lease auto-releases. Five minutes is generous for a human at the
/// controls and tight enough that a lost device cannot squat the computer.
pub const LEASE_HEARTBEAT_TTL_MS: i64 = 5 * 60 * 1000;

/// The result of a lease mutation: the new row, plus side-effect flags the
/// caller (HTTP layer / supervisor) must act on outside the transaction.
#[derive(Debug, Clone)]
pub struct LeaseOutcome {
    pub lease: LeaseRow,
    /// Pending approvals settled as side effects of this transition
    /// (revoked with reason `lease_takeover`).
    pub revoked_approval_ids: Vec<String>,
    /// True when the transition interrupted a live worker turn; the caller
    /// must send `service.turn.cancel` with reason `lease_takeover`.
    pub killed_active_turn: bool,
}

impl LeaseOutcome {
    /// A lease outcome that revoked no approvals (the common case for
    /// holder mutations that leave the approval surface untouched).
    pub fn plain(lease: LeaseRow) -> Self {
        LeaseOutcome {
            lease,
            revoked_approval_ids: Vec::new(),
            killed_active_turn: false,
        }
    }
}

/// The receipt for a device revocation: every surface that could act for
/// the device is settled inside one transaction.
#[derive(Debug, Clone)]
pub struct DeviceRevocation {
    pub sessions_revoked: i64,
    pub approvals_settled: usize,
    /// The settled ids, so the caller can resolve blocked waiters with
    /// `Revoked`.
    pub settled_approval_ids: Vec<String>,
    pub lease_killed: bool,
    pub new_lease_generation: i64,
}

/// Machine-readable propose failures, mapped to seam `service.error` codes
/// by the supervisor.
#[derive(Debug)]
pub enum ProposeError {
    /// The journal's structural guard: one pending approval per run.
    PendingExists,
    /// The run is not in a proposable state.
    RunNotActive,
    /// The frame's generation does not match the run's.
    StaleGeneration,
    Malformed(String),
    Internal(String),
}

impl ProposeError {
    /// The `service.error` code the supervisor sends on the seam.
    pub fn seam_code(&self) -> &'static str {
        match self {
            ProposeError::PendingExists => "propose_while_pending",
            ProposeError::RunNotActive => "run_not_active",
            ProposeError::StaleGeneration => "stale_generation",
            ProposeError::Malformed(_) => "malformed",
            ProposeError::Internal(_) => "internal",
        }
    }

    /// User-safe message for the error frame. Never includes digests,
    /// tickets, or row internals.
    pub fn message(&self) -> String {
        match self {
            ProposeError::PendingExists => {
                "An approval is already pending for this run.".to_string()
            }
            ProposeError::RunNotActive => "The run is not active.".to_string(),
            ProposeError::StaleGeneration => {
                "The request is for a stale turn generation.".to_string()
            }
            ProposeError::Malformed(m) => m.clone(),
            ProposeError::Internal(_) => "The request could not be completed.".to_string(),
        }
    }
}

/// The proposal receipt: the id the supervisor's waiter is registered
/// under, the service-computed digest, and the server-time deadline.
#[derive(Debug)]
pub struct ProposedApproval {
    pub id: String,
    pub digest: String,
    pub expires_at_ms: i64,
    pub lease_generation: i64,
}

/// The human's verdict on a pending approval.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecideKind {
    Approve,
    Deny,
}

/// Machine-readable decision failures, mapped to HTTP status + code by the
/// API layer (the design §3 contract).
#[derive(Debug)]
pub enum DecideError {
    NotFound,
    WrongScope,
    AlreadySettled(ApprovalState),
    /// Lazy expiry fired inside the decision transaction: the row was
    /// moved to `expired` as part of returning this.
    Expired,
    /// The recomputed digest did not match: the row was moved to
    /// `revoked`/`digest_mismatch` as part of returning this.
    DigestMismatch,
    StaleLease,
    StaleGrant,
    /// The run is neither waiting on this approval nor interrupted after
    /// a worker death — deciding it would be deciding a ghost.
    RunNotWaiting,
    Malformed(String),
    Internal(String),
}

impl DecideError {
    /// The HTTP status for the failure.
    pub fn status(&self) -> u16 {
        match self {
            DecideError::NotFound => 404,
            DecideError::WrongScope => 403,
            DecideError::Malformed(_) => 400,
            DecideError::Internal(_) => 500,
            _ => 409,
        }
    }

    /// The machine-readable error code for the `{"error": code}` envelope.
    pub fn code(&self) -> &'static str {
        match self {
            DecideError::NotFound => "unknown_approval",
            DecideError::WrongScope => "wrong_scope",
            DecideError::AlreadySettled(_) => "already_settled",
            DecideError::Expired => "expired",
            DecideError::DigestMismatch => "digest_mismatch",
            DecideError::StaleLease => "stale_lease",
            DecideError::StaleGrant => "stale_grant",
            DecideError::RunNotWaiting => "run_not_waiting",
            DecideError::Malformed(_) => "invalid_decision",
            DecideError::Internal(_) => "internal",
        }
    }

    /// User-safe message for the error envelope. Never includes digests,
    /// tickets, or row internals.
    pub fn message(&self) -> String {
        match self {
            DecideError::NotFound => "No such approval.".to_string(),
            DecideError::WrongScope => {
                "This device may not decide approvals for that workspace.".to_string()
            }
            DecideError::AlreadySettled(state) => {
                format!("This approval was already settled ({}).", state.as_str())
            }
            DecideError::Expired => "This approval expired before it was decided.".to_string(),
            DecideError::DigestMismatch => {
                "The proposed action could not be verified. It was revoked, not approved."
                    .to_string()
            }
            DecideError::StaleLease => {
                "Control of the computer changed since this was proposed. Ask again.".to_string()
            }
            DecideError::StaleGrant => {
                "Permissions changed since this was proposed. Ask again.".to_string()
            }
            DecideError::RunNotWaiting => {
                "The run this approval belongs to is no longer waiting on it.".to_string()
            }
            DecideError::Malformed(m) => m.clone(),
            DecideError::Internal(_) => "The request could not be completed.".to_string(),
        }
    }
}

/// Machine-readable revocation failures, mapped to HTTP status + code by
/// the API layer. Revocation is retrospective (it pulls back a grant),
/// so unlike decisions it is not fenced on the lease generation.
#[derive(Debug)]
pub enum RevokeError {
    NotFound,
    AlreadySettled(ApprovalState),
    /// Lazy expiry fired inside the revoke transaction: the row was moved
    /// to `expired` as part of returning this.
    Expired,
    Internal(String),
}

impl RevokeError {
    /// The HTTP status for the failure.
    pub fn status(&self) -> u16 {
        match self {
            RevokeError::NotFound => 404,
            RevokeError::Internal(_) => 500,
            _ => 409,
        }
    }

    /// The machine-readable error code for the `{"error": code}` envelope.
    pub fn code(&self) -> &'static str {
        match self {
            RevokeError::NotFound => "unknown_approval",
            RevokeError::AlreadySettled(_) => "already_settled",
            RevokeError::Expired => "expired",
            RevokeError::Internal(_) => "internal",
        }
    }

    /// User-safe message for the error envelope. Never includes digests,
    /// tickets, or row internals.
    pub fn message(&self) -> String {
        match self {
            RevokeError::NotFound => "No such approval.".to_string(),
            RevokeError::AlreadySettled(state) => {
                format!("This approval was already settled ({}).", state.as_str())
            }
            RevokeError::Expired => "This approval expired before it was revoked.".to_string(),
            RevokeError::Internal(_) => "The request could not be completed.".to_string(),
        }
    }
}

/// The revocation receipt.
#[derive(Debug)]
pub struct RevokedApproval {
    pub approval_id: String,
    pub revoked_reason: String,
    pub revoked_at_ms: i64,
    /// The approval was pending: the API layer must resolve the blocked
    /// worker's waiter with `ApprovalOutcome::Revoked` so the turn winds
    /// down instead of hanging.
    pub was_pending: bool,
    /// The execution ticket was already consumed before revocation: the
    /// action may have run. The UI says so plainly.
    pub already_dispatched: bool,
}

/// The decision receipt. `outcome` wakes the supervisor's blocked waiter;
/// `ticket` is `Some` only on approval and travels to the worker in the
/// seam reply — never in the HTTP response.
#[derive(Debug)]
pub struct DecidedApproval {
    pub approval_id: String,
    pub state: ApprovalState,
    pub decided_at_ms: i64,
    /// The raw single-use ticket. This value travels to the worker in the
    /// seam reply ONLY — the HTTP decision response never carries it
    /// (the design §7 ticket-transport risk, resolved: the browser must not
    /// become a bearer of execution credentials).
    pub ticket: Option<String>,
    pub digest: String,
    pub outcome: ApprovalOutcome,
}

/// Lease endpoint failures.
#[derive(Debug)]
pub enum LeaseError {
    /// Only the holding device may drive the lease through its sequence.
    NotHolder,
    /// The caller presented a lease generation that is not current: the
    /// world moved; re-read the lease and try again.
    StaleLease,
    WrongState(String),
    NotFound,
    Internal(String),
}

impl LeaseError {
    /// The HTTP status for the failure.
    pub fn status(&self) -> u16 {
        match self {
            LeaseError::NotHolder => 403,
            LeaseError::StaleLease => 409,
            LeaseError::WrongState(_) => 409,
            LeaseError::NotFound => 404,
            LeaseError::Internal(_) => 500,
        }
    }

    /// The machine-readable error code for the `{"error": code}` envelope.
    pub fn code(&self) -> &'static str {
        match self {
            LeaseError::NotHolder => "not_lease_holder",
            LeaseError::StaleLease => "stale_lease",
            LeaseError::WrongState(_) => "wrong_lease_state",
            LeaseError::NotFound => "no_lease",
            LeaseError::Internal(_) => "internal",
        }
    }

    /// User-safe message for the error envelope. Tells the caller what
    /// moved and what to do (re-read the lease and retry); never includes
    /// row internals.
    pub fn message(&self) -> String {
        match self {
            LeaseError::NotHolder => "Only the device holding the lease can do that.".to_string(),
            LeaseError::StaleLease => {
                "The lease moved while you were looking; re-read it and try again.".to_string()
            }
            LeaseError::WrongState(s) => {
                format!("The computer is not in the right state for that ({}).", s)
            }
            LeaseError::NotFound => "No such device.".to_string(),
            LeaseError::Internal(_) => "The request could not be completed.".to_string(),
        }
    }
}

/// Ticket redemption failures (the approval.dispatched event path).
#[derive(Debug)]
pub enum TicketError {
    UnknownApproval,
    NotApproved,
    AlreadyConsumed,
    Mismatch,
}

impl TicketError {
    /// The `service.error` code for a failed ticket redemption.
    pub fn seam_code(&self) -> &'static str {
        match self {
            TicketError::UnknownApproval => "unknown_approval",
            TicketError::NotApproved => "ticket_not_approved",
            TicketError::AlreadyConsumed => "ticket_reused",
            TicketError::Mismatch => "ticket_mismatch",
        }
    }

    /// The HTTP status for the failure (surfaced via the seam error path).
    pub fn status(&self) -> u16 {
        match self {
            TicketError::UnknownApproval => 404,
            TicketError::NotApproved => 409,
            TicketError::AlreadyConsumed => 409,
            TicketError::Mismatch => 403,
        }
    }
}

/// One sweep pass: expire due pending approvals in the database, then
/// resolve their waiters. Shared by the serve-mode sweeper task and the
/// deterministic harness (which drives expiry by advancing the Db clock,
/// never by sleeping).
pub fn sweep_once(db: &crate::db::Db, pending: &PendingApprovals) -> Result<Vec<String>, String> {
    let expired = db.sweep_expired_approvals()?;
    for id in &expired {
        pending.resolve(id, ApprovalOutcome::Expired);
    }
    db.lease_maintenance()?;
    Ok(expired)
}

/// The serve-mode background sweep: server-time expiry applied roughly
/// every second, plus lease auto-release. Expiry is always evaluated on
/// the service clock inside `sweep_expired_approvals`; this task only
/// decides how often the question is asked.
pub async fn sweep_loop(
    db: std::sync::Arc<crate::db::Db>,
    pending: std::sync::Arc<PendingApprovals>,
) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        if let Err(e) = sweep_once(&db, &pending) {
            eprintln!("[sweep] {e}");
        }
    }
}
