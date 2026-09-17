use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Scope {
    pub workspace: String,
    pub actor: String,
    pub run: String,
    pub policy_revision: u64,
    pub credential_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Action {
    pub tool: String,
    pub target: String,
    pub arguments: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Running,
    WaitingApproval,
    HumanControl,
    Cancelled,
    Completed,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ControlError {
    NotRunning,
    NoPendingApproval,
    WrongScope,
    ChangedAction,
    Expired,
    StaleLease,
    WrongState,
}

struct Approval {
    digest: [u8; 32],
    generation: u64,
    expires_at: u64,
}

/// Single-threaded experiment: a production implementation needs transactional storage,
/// authenticated actor resolution, monotonic lease fencing, and process supervision.
pub struct RunControl {
    scope: Scope,
    state: State,
    generation: u64,
    pending: Option<Approval>,
}

impl RunControl {
    pub fn new(scope: Scope) -> Self {
        Self {
            scope,
            state: State::Running,
            generation: 0,
            pending: None,
        }
    }

    pub fn state(&self) -> State {
        self.state
    }
    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn check_dispatch(&self, generation: u64) -> Result<(), ControlError> {
        if generation != self.generation {
            return Err(ControlError::StaleLease);
        }
        if self.state != State::Running {
            return Err(ControlError::NotRunning);
        }
        Ok(())
    }

    pub fn propose(&mut self, action: &Action, expires_at: u64) -> Result<(), ControlError> {
        self.check_dispatch(self.generation)?;
        self.pending = Some(Approval {
            digest: digest(action),
            generation: self.generation,
            expires_at,
        });
        self.state = State::WaitingApproval;
        Ok(())
    }

    /// Returns an admitted action exactly once. The caller must journal admission before
    /// performing any side effect; it must reconcile uncertain results, never replay them.
    pub fn decide(
        &mut self,
        scope: &Scope,
        action: &Action,
        now: u64,
        allow: bool,
    ) -> Result<Option<Action>, ControlError> {
        if scope != &self.scope {
            return Err(ControlError::WrongScope);
        }
        let pending = self
            .pending
            .as_ref()
            .ok_or(ControlError::NoPendingApproval)?;
        if pending.generation != self.generation {
            return Err(ControlError::StaleLease);
        }
        if self.state != State::WaitingApproval {
            return Err(ControlError::WrongState);
        }
        if digest(action) != pending.digest {
            return Err(ControlError::ChangedAction);
        }
        if now >= pending.expires_at {
            self.pending = None;
            self.state = State::Running;
            return Err(ControlError::Expired);
        }
        self.pending = None;
        self.state = State::Running;
        Ok(allow.then(|| action.clone()))
    }

    pub fn take_control(&mut self) -> Result<u64, ControlError> {
        if !matches!(self.state, State::Running | State::WaitingApproval) {
            return Err(ControlError::WrongState);
        }
        self.invalidate();
        self.state = State::HumanControl;
        Ok(self.generation)
    }

    /// The supervisor may call this only after the browser acknowledged quiescence and
    /// an explicit human resume produced a new observation. This is not that supervisor.
    pub fn resume(&mut self, generation: u64) -> Result<(), ControlError> {
        if generation != self.generation {
            return Err(ControlError::StaleLease);
        }
        if self.state != State::HumanControl {
            return Err(ControlError::WrongState);
        }
        self.invalidate();
        self.state = State::Running;
        Ok(())
    }

    pub fn cancel(&mut self) {
        if self.state != State::Completed {
            self.invalidate();
            self.state = State::Cancelled;
        }
    }

    pub fn complete(&mut self) -> Result<(), ControlError> {
        self.check_dispatch(self.generation)?;
        self.invalidate();
        self.state = State::Completed;
        Ok(())
    }

    fn invalidate(&mut self) {
        self.generation = self
            .generation
            .checked_add(1)
            .expect("lease generation exhausted");
        self.pending = None;
    }
}

fn digest(action: &Action) -> [u8; 32] {
    // serde_json's default map representation sorts object keys, including nested objects.
    Sha256::digest(serde_json::to_vec(action).expect("Action serializes to JSON")).into()
}
