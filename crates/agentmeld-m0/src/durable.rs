//! Trusted-owner M0 journal. The production supervisor must keep this outside agent storage.
use serde::{Deserialize, Serialize};
use std::{
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::Path,
};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    pub sequence: u64,
    pub generation: u64,
    pub mode: String,
    pub pending: Option<u64>,
    pub uncertain: bool,
    pub observation: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum Command {
    State,
    Admit { generation: u64, actor: String },
    Settle { ticket: u64 },
    Takeover,
    HumanReady { generation: u64 },
    Resume { generation: u64 },
    Observed { generation: u64, digest: String },
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
            sequence: 0,
            generation: 0,
            mode: "agent".into(),
            pending: None,
            uncertain: false,
            observation: None,
        };
        for line in data.lines() {
            let next: Snapshot = serde_json::from_str(line).map_err(|_| "corrupt journal")?;
            if next.sequence != state.sequence.checked_add(1).ok_or("sequence exhausted")?
                || next.generation < state.generation
                || ![
                    "agent",
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
            Command::Admit { generation, actor } => {
                if !["agent", "human"].contains(&actor.as_str()) {
                    return Err("invalid actor".into());
                }
                require(&actor, generation)?;
                if next.pending.is_some() {
                    return Err("action already pending".into());
                }
                next.pending = Some(next.sequence.checked_add(1).ok_or("sequence exhausted")?);
            }
            Command::Settle { ticket } => {
                if next.pending != Some(ticket) || next.uncertain {
                    return Err("unknown or uncertain ticket".into());
                }
                next.pending = None;
            }
            Command::Takeover => {
                if !["agent", "paused"].contains(&next.mode.as_str()) || next.uncertain {
                    return Err("takeover unavailable".into());
                }
                next.generation = next
                    .generation
                    .checked_add(1)
                    .ok_or("generation exhausted")?;
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
