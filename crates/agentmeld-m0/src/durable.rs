//! Trusted-owner M0 journal. The production supervisor must keep this outside agent storage.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::Path,
};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    pub version: u8,
    pub sequence: u64,
    pub generation: u64,
    pub mode: String,
    pub pending: Option<u64>,
    pub pending_digest: Option<String>,
    pub dispatched: bool,
    pub uncertain: bool,
    pub observation: Option<String>,
    pub approval: Option<Approval>,
    pub decision: Option<String>,
    pub requests: Vec<String>,
    pub private: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ApprovalScope {
    pub workspace: String,
    pub worker: String,
    pub thread: String,
    pub turn: String,
    pub request: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Approval {
    pub id: u64,
    pub generation: u64,
    pub expires_at_ms: u64,
    pub scope: ApprovalScope,
    pub digest: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum Command {
    State,
    Propose {
        generation: u64,
        action: Value,
        scope: ApprovalScope,
        ttl_ms: u64,
    },
    Decide {
        approval_id: u64,
        action: Value,
        scope: ApprovalScope,
        allow: bool,
    },
    Admit {
        generation: u64,
        actor: String,
        action: Value,
    },
    Dispatch {
        generation: u64,
        actor: String,
        ticket: u64,
        action: Value,
    },
    Settle {
        ticket: u64,
        action: Value,
    },
    PrivateBegin {
        generation: u64,
    },
    PrivateEnd {
        generation: u64,
    },
    Takeover,
    HumanReady {
        generation: u64,
    },
    Resume {
        generation: u64,
    },
    Observed {
        generation: u64,
        digest: String,
    },
    Disconnect,
    Cancel,
}

pub struct Journal {
    file: File,
    state: Snapshot,
    poisoned: bool,
    bytes: u64,
}
const LIMIT: u64 = 16 * 1024 * 1024;

impl Journal {
    pub fn open(path: &Path) -> Result<Self, String> {
        if std::fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("journal cannot be a symlink".into());
        }
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .append(true)
            .open(path)
            .map_err(|_| "cannot open journal")?;
        file.try_lock()
            .map_err(|_| "journal already owned or locking unavailable")?;
        let bytes = file.metadata().map_err(|_| "journal metadata")?.len();
        if bytes > LIMIT {
            return Err("journal limit exceeded".into());
        }
        let mut data = String::new();
        file.read_to_string(&mut data)
            .map_err(|_| "journal read failed")?;
        if !data.is_empty() && !data.ends_with('\n') {
            return Err("incomplete journal; manual reconciliation required".into());
        }
        let mut state = Snapshot {
            version: 4,
            sequence: 0,
            generation: 0,
            mode: "agent".into(),
            pending: None,
            pending_digest: None,
            dispatched: false,
            uncertain: false,
            observation: None,
            approval: None,
            decision: None,
            requests: Vec::new(),
            private: false,
        };
        for line in data.lines() {
            let next: Snapshot = serde_json::from_str(line).map_err(|_| "corrupt journal")?;
            if next.version != 4
                || (state.mode == "cancelled" && next.mode != "cancelled")
                || (state.uncertain && !next.uncertain)
                || next
                    .pending_digest
                    .as_deref()
                    .is_some_and(|s| !valid_digest(s))
                || next
                    .observation
                    .as_deref()
                    .is_some_and(|s| !valid_digest(s))
                || next
                    .decision
                    .as_deref()
                    .is_some_and(|s| !["allow", "deny", "expired"].contains(&s))
                || next.requests.len() > 256
                || !next.requests.starts_with(&state.requests)
                || next
                    .requests
                    .iter()
                    .any(|key| key.len() != 64 || !key.bytes().all(|b| b.is_ascii_hexdigit()))
                || next
                    .requests
                    .iter()
                    .collect::<std::collections::HashSet<_>>()
                    .len()
                    != next.requests.len()
                || (next.mode == "awaiting_approval") != next.approval.is_some()
                || next.approval.as_ref().is_some_and(|approval| {
                    next.pending.is_some()
                        || approval.generation != next.generation
                        || approval.id == 0
                        || approval.id > next.sequence
                        || !valid_digest(&approval.digest)
                        || !valid_scope(&approval.scope)
                        || !next
                            .requests
                            .contains(&scope_digest(&approval.scope).unwrap_or_default())
                })
                || next.pending.is_some() != next.pending_digest.is_some()
                || (next.dispatched && next.pending.is_none())
                || next.sequence != state.sequence.checked_add(1).ok_or("sequence exhausted")?
                || next.generation < state.generation
                || ![
                    "agent",
                    "awaiting_approval",
                    "pausing",
                    "human",
                    "resuming",
                    "paused",
                    "cancelled",
                ]
                .contains(&next.mode.as_str())
                || next
                    .pending
                    .is_some_and(|ticket| ticket > next.sequence || ticket == 0)
                || (next.uncertain && next.pending.is_none())
            {
                return Err("invalid journal history".into());
            }
            state = next;
        }
        let recovered = !data.is_empty();
        let mut journal = Self {
            file,
            state,
            poisoned: false,
            bytes,
        };
        let mut next = journal.state.clone();
        if recovered {
            next.generation = next
                .generation
                .checked_add(1)
                .ok_or("generation exhausted")?;
            if next.mode != "cancelled" {
                next.mode = "paused".into();
            }
            next.uncertain = next.pending.is_some();
            next.observation = None;
            next.approval = None;
        }
        journal.persist(next)?;
        // Persist the directory entry as well as the journal bytes before returning ownership.
        File::open(
            path.parent()
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or(Path::new(".")),
        )
        .and_then(|dir| dir.sync_all())
        .map_err(|_| "journal directory sync failed")?;
        Ok(journal)
    }
    pub fn state(&self) -> Snapshot {
        self.state.clone()
    }
    fn persist(&mut self, mut next: Snapshot) -> Result<Snapshot, String> {
        if self.poisoned {
            return Err("journal unavailable".into());
        }
        next.sequence = self
            .state
            .sequence
            .checked_add(1)
            .ok_or("sequence exhausted")?;
        let mut line = serde_json::to_vec(&next).map_err(|_| "journal encoding")?;
        line.push(b'\n');
        if self.bytes + line.len() as u64 > LIMIT {
            self.poisoned = true;
            return Err("journal limit exceeded".into());
        }
        if self
            .file
            .write_all(&line)
            .and_then(|_| self.file.sync_all())
            .is_err()
        {
            self.poisoned = true;
            return Err("journal persistence failed; stop worker".into());
        }
        self.bytes += line.len() as u64;
        self.state = next;
        Ok(self.state())
    }
    pub fn apply(&mut self, command: Command) -> Result<Snapshot, String> {
        if self.poisoned {
            return Err("journal unavailable".into());
        }
        if matches!(command, Command::State) {
            return Ok(self.state());
        }
        let mut next = self.state();
        let require = |mode: &str, generation: u64| -> Result<(), String> {
            if self.state.mode != mode
                || self.state.generation != generation
                || self.state.uncertain
            {
                Err("stale controller or unresolved action".into())
            } else {
                Ok(())
            }
        };
        match command {
            Command::State => unreachable!(),
            Command::Propose {
                generation,
                action,
                scope,
                ttl_ms,
            } => {
                require("agent", generation)?;
                if next.pending.is_some()
                    || next.approval.is_some()
                    || !action.is_object()
                    || ttl_ms == 0
                    || ttl_ms > 300_000
                    || !valid_scope(&scope)
                {
                    return Err("invalid approval proposal".into());
                }
                let request_key = scope_digest(&scope)?;
                if next.requests.contains(&request_key) || next.requests.len() >= 256 {
                    return Err("duplicate or exhausted request ledger".into());
                }
                next.requests.push(request_key);
                next.approval = Some(Approval {
                    id: next.sequence.checked_add(1).ok_or("sequence exhausted")?,
                    generation,
                    expires_at_ms: now_ms()?.checked_add(ttl_ms).ok_or("expiry overflow")?,
                    scope,
                    digest: action_digest(&action)?,
                });
                next.decision = None;
                next.mode = "awaiting_approval".into();
            }
            Command::Decide {
                approval_id,
                action,
                scope,
                allow,
            } => {
                let approval = next.approval.as_ref().ok_or("no pending approval")?;
                require("awaiting_approval", approval.generation)?;
                if approval.id != approval_id
                    || approval.scope != scope
                    || approval.digest != action_digest(&action)?
                {
                    return Err("approval binding mismatch".into());
                }
                let expired = now_ms()? >= approval.expires_at_ms;
                next.decision = Some(
                    if expired {
                        "expired"
                    } else if allow {
                        "allow"
                    } else {
                        "deny"
                    }
                    .into(),
                );
                if allow && !expired {
                    next.pending = Some(next.sequence.checked_add(1).ok_or("sequence exhausted")?);
                    next.pending_digest = Some(approval.digest.clone());
                    next.dispatched = false;
                }
                next.approval = None;
                next.mode = "agent".into();
            }
            Command::Admit {
                generation,
                actor,
                action,
            } => {
                if !["agent", "human"].contains(&actor.as_str()) {
                    return Err("invalid actor".into());
                }
                require(&actor, generation)?;
                if next.pending.is_some() || next.private {
                    return Err("action already pending or screen private".into());
                }
                if !action.is_object() {
                    return Err("action object required".into());
                }
                next.pending = Some(next.sequence.checked_add(1).ok_or("sequence exhausted")?);
                next.pending_digest = Some(action_digest(&action)?);
                next.dispatched = false;
            }
            Command::Dispatch {
                generation,
                actor,
                ticket,
                action,
            } => {
                if !["agent", "human"].contains(&actor.as_str()) {
                    return Err("invalid actor".into());
                }
                require(&actor, generation)?;
                if next.pending != Some(ticket)
                    || next.dispatched
                    || next.pending_digest != Some(action_digest(&action)?)
                {
                    return Err("dispatch ticket or payload mismatch".into());
                }
                next.dispatched = true;
            }
            Command::Settle { ticket, action } => {
                if next.pending != Some(ticket)
                    || next.uncertain
                    || !next.dispatched
                    || next.pending_digest != Some(action_digest(&action)?)
                {
                    return Err("unknown or uncertain ticket".into());
                }
                next.pending = None;
                next.pending_digest = None;
                next.dispatched = false;
            }
            Command::PrivateBegin { generation } | Command::PrivateEnd { generation } => {
                require("human", generation)?;
                let entering = matches!(command, Command::PrivateBegin { .. });
                if next.pending.is_some() || next.private == entering {
                    return Err("private transition unavailable".into());
                }
                next.private = entering;
                next.generation = next
                    .generation
                    .checked_add(1)
                    .ok_or("generation exhausted")?;
                next.observation = None;
            }
            Command::Takeover => {
                if !["agent", "paused", "awaiting_approval"].contains(&next.mode.as_str())
                    || next.uncertain
                {
                    return Err("takeover unavailable".into());
                }
                next.generation = next
                    .generation
                    .checked_add(1)
                    .ok_or("generation exhausted")?;
                revoke_undispatched(&mut next);
                next.mode = "pausing".into();
            }
            Command::HumanReady { generation } => {
                require("pausing", generation)?;
                if next.pending.is_some() {
                    return Err("active action has not settled".into());
                }
                next.mode = "human".into();
            }
            Command::Resume { generation } => {
                require("human", generation)?;
                if next.private {
                    return Err("screen private".into());
                }
                next.generation = next
                    .generation
                    .checked_add(1)
                    .ok_or("generation exhausted")?;
                next.mode = "resuming".into();
                next.observation = None;
            }
            Command::Observed { generation, digest } => {
                require("resuming", generation)?;
                if next.pending.is_some()
                    || digest.len() != 64
                    || !digest.bytes().all(|b| b.is_ascii_hexdigit())
                {
                    return Err("fresh observation required after actions settle".into());
                }
                next.observation = Some(digest);
                next.mode = "agent".into();
            }
            Command::Disconnect | Command::Cancel => {
                revoke_undispatched(&mut next);
                next.generation = next
                    .generation
                    .checked_add(1)
                    .ok_or("generation exhausted")?;
                if matches!(command, Command::Cancel) || next.mode == "cancelled" {
                    next.mode = "cancelled".into();
                } else {
                    next.mode = "paused".into();
                }
                next.observation = None;
            }
        }
        self.persist(next)
    }
}

fn action_digest(action: &Value) -> Result<String, String> {
    let bytes = serde_json::to_vec(action).map_err(|_| "invalid action")?;
    if bytes.len() > 8192 {
        return Err("action too large".into());
    }
    Ok(format!("{:x}", Sha256::digest(bytes)))
}
fn valid_digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit())
}
fn valid_scope(scope: &ApprovalScope) -> bool {
    [
        &scope.workspace,
        &scope.worker,
        &scope.thread,
        &scope.turn,
        &scope.request,
    ]
    .iter()
    .all(|s| !s.is_empty() && s.len() <= 256)
}
fn scope_digest(scope: &ApprovalScope) -> Result<String, String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(scope).map_err(|_| "invalid scope")?)
    ))
}
fn revoke_undispatched(state: &mut Snapshot) {
    state.approval = None;
    if !state.dispatched && !state.uncertain {
        state.pending = None;
        state.pending_digest = None;
    }
}

fn now_ms() -> Result<u64, String> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "clock unavailable")?
        .as_millis()
        .try_into()
        .map_err(|_| "clock overflow".into())
}
