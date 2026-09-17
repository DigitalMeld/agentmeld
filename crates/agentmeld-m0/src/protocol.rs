use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const MAX_FRAME: usize = 1024 * 1024;

/// Bounded newline decoder shared by transport experiments. A malformed/oversized stream
/// poisons this decoder so subsequent bytes cannot be mistaken for a new valid frame.
#[derive(Default)]
pub struct JsonLines {
    pending: Vec<u8>,
    poisoned: bool,
}

impl JsonLines {
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<Value>, String> {
        if self.poisoned {
            return Err("stream already failed".into());
        }
        let mut frames = Vec::new();
        for &byte in bytes {
            if byte == b'\n' {
                if !self.pending.iter().all(u8::is_ascii_whitespace) {
                    match serde_json::from_slice(&self.pending) {
                        Ok(value) => frames.push(value),
                        Err(_) => {
                            self.poisoned = true;
                            self.pending.clear();
                            return Err("invalid JSON frame".into());
                        }
                    }
                }
                self.pending.clear();
            } else {
                if self.pending.len() >= MAX_FRAME {
                    self.poisoned = true;
                    self.pending.clear();
                    return Err("frame exceeds byte limit".into());
                }
                self.pending.push(byte);
            }
        }
        Ok(frames)
    }

    pub fn finish(&mut self) -> Result<(), String> {
        if self.poisoned {
            return Err("stream already failed".into());
        }
        if !self.pending.is_empty() {
            self.poisoned = true;
            self.pending.clear();
            return Err("truncated stream: missing newline".into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    Text { text: String },
    Approval { request_id: Value, method: String },
    Completed,
    Failed { reason: String },
    Ignored,
}

pub fn codex_event(frame: &Value) -> Result<Event, String> {
    let method = frame.get("method").and_then(Value::as_str).unwrap_or("");
    match method {
        "item/agentMessage/delta" => Ok(Event::Text {
            text: frame
                .pointer("/params/delta")
                .and_then(Value::as_str)
                .ok_or("missing Codex text delta")?
                .into(),
        }),
        "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" => {
            let id = frame
                .get("id")
                .filter(|id| id.is_string() || id.is_number())
                .ok_or("approval missing request ID")?;
            Ok(Event::Approval {
                request_id: id.clone(),
                method: method.into(),
            })
        }
        "turn/completed" => match frame.pointer("/params/turn/status").and_then(Value::as_str) {
            Some("completed") => Ok(Event::Completed),
            Some("failed" | "interrupted") => Ok(Event::Failed {
                reason: "turn did not complete".into(),
            }),
            _ => Err("unknown terminal Codex status".into()),
        },
        _ if frame.get("id").is_some() && !method.is_empty() => {
            Err("unsupported server request; must not auto-approve".into())
        }
        _ => Ok(Event::Ignored),
    }
}

pub fn codex_initialize() -> Value {
    json!({"id":1,"method":"initialize","params":{
        "clientInfo":{"name":"agentmeld_m0","title":"AgentMeld M0","version":"0.1.0"},
        "capabilities":{"experimentalApi":false}
    }})
}

/// Claude bridge accepts SDK messages, not raw CLI control frames. All tool decisions
/// stay in the SDK bridge; result subtype, not process exit or text, establishes success.
pub fn claude_event(frame: &Value) -> Result<Event, String> {
    match frame.get("type").and_then(Value::as_str) {
        Some("stream_event")
            if frame.pointer("/event/type").and_then(Value::as_str)
                == Some("content_block_delta") =>
        {
            match frame.pointer("/event/delta/type").and_then(Value::as_str) {
                Some("text_delta") => Ok(Event::Text {
                    text: frame
                        .pointer("/event/delta/text")
                        .and_then(Value::as_str)
                        .ok_or("missing Claude text delta")?
                        .into(),
                }),
                _ => Ok(Event::Ignored),
            }
        }
        Some("result") => {
            if frame.get("subtype").and_then(Value::as_str) == Some("success")
                && frame.get("is_error").and_then(Value::as_bool) == Some(false)
            {
                Ok(Event::Completed)
            } else {
                Ok(Event::Failed {
                    reason: "Claude result not successful".into(),
                })
            }
        }
        _ => Ok(Event::Ignored),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolCall {
    pub name: String,
    pub arguments: Value,
}

#[derive(Default)]
pub struct OllamaTurn {
    text: String,
    calls: Vec<ToolCall>,
    done: bool,
    failed: bool,
    bytes: usize,
}

impl OllamaTurn {
    pub fn ingest(&mut self, frame: &Value) -> Result<(), String> {
        if self.done || self.failed {
            return Err("turn already terminal".into());
        }
        let result = self.ingest_checked(frame);
        if result.is_err() {
            self.failed = true;
        }
        result
    }

    fn ingest_checked(&mut self, frame: &Value) -> Result<(), String> {
        self.bytes += serde_json::to_vec(frame)
            .map_err(|_| "invalid frame")?
            .len();
        if self.bytes > MAX_FRAME {
            return Err("turn exceeds byte limit".into());
        }
        if frame.get("error").is_some() {
            return Err("Ollama reported an error".into());
        }
        let done = frame
            .get("done")
            .and_then(Value::as_bool)
            .ok_or("missing Ollama done flag")?;
        if let Some(message) = frame.get("message") {
            if let Some(content) = message.get("content") {
                self.text
                    .push_str(content.as_str().ok_or("invalid content")?);
            }
            if let Some(calls) = message.get("tool_calls") {
                for call in calls.as_array().ok_or("invalid tool_calls")? {
                    if self.calls.len() >= 8 {
                        return Err("too many tool calls".into());
                    }
                    let name = call
                        .pointer("/function/name")
                        .and_then(Value::as_str)
                        .filter(|name| !name.is_empty())
                        .ok_or("missing tool name")?;
                    let arguments = call
                        .pointer("/function/arguments")
                        .filter(|args| args.is_object())
                        .ok_or("tool arguments must be an object")?;
                    self.calls.push(ToolCall {
                        name: name.into(),
                        arguments: arguments.clone(),
                    });
                }
            }
        } else if !done {
            return Err("missing Ollama message".into());
        }
        self.done = done;
        Ok(())
    }

    /// Calls become available only after a validated terminal frame; no partial tool execution.
    pub fn finish(self) -> Result<(String, Vec<ToolCall>), String> {
        if !self.done || self.failed {
            return Err("incomplete or failed Ollama turn".into());
        }
        Ok((self.text, self.calls))
    }
}

/// Disposable conformance tool only. No shell/files/network capabilities are exposed.
pub fn fixture_tool(call: &ToolCall) -> Result<Value, String> {
    if call.name != "sum" {
        return Err("tool is not granted".into());
    }
    let args = call.arguments.as_object().ok_or("invalid arguments")?;
    if args.len() != 2 {
        return Err("unexpected arguments".into());
    }
    let a = args
        .get("a")
        .and_then(Value::as_i64)
        .ok_or("a must be an integer")?;
    let b = args
        .get("b")
        .and_then(Value::as_i64)
        .ok_or("b must be an integer")?;
    Ok(json!({"sum":a.checked_add(b).ok_or("sum overflow")?}))
}
