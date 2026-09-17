use std::collections::HashSet;

#[derive(Clone)]
pub struct Binding {
    pub bridge: String,
    pub account: String,
    pub chat: String,
    pub sender: String,
    pub actor: String,
}

pub struct Inbound {
    pub bridge: String,
    pub account: String,
    pub chat: String,
    pub sender: String,
    pub service: String,
    pub guid: String,
    pub from_me: bool,
    pub is_group: bool,
    pub text: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Disposition {
    Accepted { actor: String, text: String },
    Echo,
    Duplicate,
}

/// Fixture for verified API readback, not a webhook authentication implementation.
/// Production deduplication and bindings must be transactional and persistent.
pub struct ChannelGate {
    binding: Binding,
    seen: HashSet<String>,
    revoked: bool,
}

impl ChannelGate {
    pub fn new(binding: Binding) -> Self {
        Self {
            binding,
            seen: HashSet::new(),
            revoked: false,
        }
    }

    pub fn revoke(&mut self) {
        self.revoked = true;
    }

    pub fn accept(&mut self, message: Inbound) -> Result<Disposition, &'static str> {
        if self.revoked {
            return Err("bridge revoked");
        }
        if message.bridge != self.binding.bridge
            || message.account != self.binding.account
            || message.chat != self.binding.chat
            || message.service != "iMessage"
            || message.is_group
        {
            return Err("unbound channel");
        }
        if message.from_me {
            return Ok(Disposition::Echo);
        }
        if message.sender != self.binding.sender {
            return Err("unbound sender");
        }
        if message.guid.is_empty()
            || message.guid.len() > 256
            || message.text.is_empty()
            || message.text.len() > 32 * 1024
        {
            return Err("invalid message");
        }
        if self.seen.contains(&message.guid) {
            return Ok(Disposition::Duplicate);
        }
        if self.seen.len() >= 4096 {
            return Err("fixture deduplication capacity reached");
        }
        self.seen.insert(message.guid);
        Ok(Disposition::Accepted {
            actor: self.binding.actor.clone(),
            text: message.text,
        })
    }
}
