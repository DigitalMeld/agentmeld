//! Host-local SSE event stream (Phase 4).
//!
//! `GET /api/v1/events` (and its `/api` alias) serve [`run_events`] rows as
//! Server-Sent Events, one stream per host. The stream is authenticated with
//! the same device session as every other route; a revoked device fails at
//! connect time, and the producer rechecks revocation on every heartbeat so
//! a long-lived stream closes promptly when its device is revoked.
//!
//! ## Wire behavior
//!
//! * `Last-Event-ID` wins over `?cursor=`; both are `run_events.sequence`
//!   values. No cursor replays the latest 200 streamable rows.
//! * Replay batches are capped at 1000 rows; a cursor more than 5000 rows
//!   behind the max is rejected with HTTP 410 `cursor_too_old`.
//! * The first frame is `stream.hello` with the current max sequence.
//! * `:ping` every 15 seconds, `retry: 3000`.
//! * Delivery is at-least-once: the SSE `id` field carries the sequence and
//!   the envelope `id` is a stable per-row identifier, so clients dedupe on
//!   reconnect by resuming from `Last-Event-ID`.
//! * The outbound queue is bounded at 256 frames. When the client is that
//!   far behind live rows, the server emits `event: control` with
//!   `{"type":"stream.resync_required","current_seq":N}` and closes; the
//!   client replays from its cursor. Events are never dropped silently.
//!
//! ## Producer/consumer design
//!
//! Each connection spawns one producer task ([`spawn_event_stream`]) that
//! owns a bounded `mpsc` channel. The axum handler adapts the receiver to
//! the response body; backpressure propagates through the channel, so a
//! stalled client applies backpressure instead of losing events. SQLite
//! restarts are invisible to clients: the producer polls the journal, so
//! after a server restart the client reconnects, replays from its cursor,
//! and continues at-least-once.

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

use crate::auth::Auth;
use crate::db::{Db, StreamRow};

/// A cursor more than this many rows behind the max is rejected (HTTP 410).
pub const CURSOR_TOO_OLD_WINDOW: i64 = 5000;
/// Replay bound when the client supplies no cursor.
pub const DEFAULT_REPLAY_LIMIT: i64 = 200;
/// Catch-up batch cap per poll.
pub const REPLAY_BATCH: i64 = 1000;
/// Per-connection outbound queue bound (frames).
pub const DEFAULT_QUEUE_CAP: usize = 256;
/// SSE `retry` hint in milliseconds.
pub const RETRY_MS: u64 = 3000;
/// Heartbeat comment interval.
pub const HEARTBEAT: Duration = Duration::from_secs(15);
/// Live-row poll interval.
pub const POLL_INTERVAL: Duration = Duration::from_millis(250);

/// Tuning knobs for the stream producer. Production uses the defaults;
/// deterministic tests shrink the queue and heartbeat.
#[derive(Debug, Clone)]
pub struct StreamConfig {
    /// Outbound queue bound in frames; exceeding it emits
    /// `stream.resync_required` and closes.
    pub queue_cap: usize,
    /// Heartbeat interval (also the revocation-recheck interval).
    pub heartbeat: Duration,
    /// Live-row poll interval.
    pub poll_interval: Duration,
}

impl Default for StreamConfig {
    fn default() -> Self {
        StreamConfig {
            queue_cap: DEFAULT_QUEUE_CAP,
            heartbeat: HEARTBEAT,
            poll_interval: POLL_INTERVAL,
        }
    }
}

/// The SSE envelope every streamable row is delivered in.
///
/// The envelope is versioned (`v: 1`) and carries the stable row id, the
/// journal sequence, the routing triple, the server timestamp, the actor
/// that wrote the row, and the raw event payload.
#[derive(serde::Serialize, Debug)]
pub struct StreamEnvelope<'a> {
    /// Envelope version, always 1.
    pub v: u8,
    /// Stable per-row identifier (the run_events id).
    pub id: &'a str,
    /// Journal sequence; also the SSE `id` field for Last-Event-ID resume.
    pub seq: i64,
    /// Event type (e.g. `run.message`, `tool.call_started`).
    #[serde(rename = "type")]
    pub kind: &'a str,
    /// Owning workspace.
    pub workspace_id: &'a str,
    /// Owning conversation.
    pub conversation_id: &'a str,
    /// Owning run.
    pub run_id: &'a str,
    /// Server timestamp (unix millis).
    pub ts: i64,
    /// Writer of the row (`worker`, `service`, or `device:<id>`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor: Option<&'a str>,
    /// The raw event payload.
    pub payload: serde_json::Value,
}

impl<'a> StreamEnvelope<'a> {
    /// Build the envelope for a stream row. The payload column is
    /// CHECK-constrained to valid JSON at insert; the `Null` fallback is
    /// unreachable defense-in-depth so one malformed row can never wedge
    /// the stream (at-least-once still holds for every other row).
    pub fn of(row: &'a StreamRow) -> Self {
        let payload = serde_json::from_str(&row.payload).unwrap_or(serde_json::Value::Null);
        StreamEnvelope {
            v: 1,
            id: &row.id,
            seq: row.seq,
            kind: &row.kind,
            workspace_id: &row.workspace_id,
            conversation_id: &row.conversation_id,
            run_id: &row.run_id,
            ts: row.ts,
            actor: row.actor.as_deref(),
            payload,
        }
    }
}

/// Render the envelope as a plain SSE data frame with the sequence as the
/// frame id (drives `Last-Event-ID` resume).
pub fn data_frame(row: &StreamRow) -> String {
    let json = serde_json::to_string(&StreamEnvelope::of(row))
        .unwrap_or_else(|_| r#"{"v":1}"#.to_string());
    format!("id: {}\ndata: {}\n\n", row.seq, json)
}

/// Render a named SSE event frame (stream.hello, control).
pub fn named_frame(event: &str, data_json: &str) -> String {
    format!("event: {event}\ndata: {data_json}\n\n")
}

/// The SSE retry hint, sent once per connection.
pub fn retry_frame() -> String {
    format!("retry: {RETRY_MS}\n\n")
}

/// The heartbeat comment frame.
pub fn ping_frame() -> &'static str {
    ":ping\n\n"
}

/// How the connect-time cursor was supplied.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CursorSource {
    /// `Last-Event-ID` header (wins over the query param).
    LastEventId,
    /// `?cursor=` query param.
    Query,
    /// No cursor: replay the latest [`DEFAULT_REPLAY_LIMIT`] rows.
    Default,
}

/// Resolve the connect-time cursor. `last_event_id` wins over `query_cursor`
/// (the SSE reconnect header takes precedence); both are
/// `run_events.sequence` values. Returns the source and the cursor, or a
/// `(status, code, message)` rejection for malformed / too-old cursors.
pub fn resolve_cursor(
    last_event_id: Option<&str>,
    query_cursor: Option<&str>,
    max_seq: i64,
) -> Result<(CursorSource, i64), (u16, &'static str, String)> {
    let (source, param) = match (last_event_id, query_cursor) {
        (Some(h), _) => (CursorSource::LastEventId, Some(h)),
        (None, Some(q)) => (CursorSource::Query, Some(q)),
        (None, None) => (CursorSource::Default, None),
    };
    let cursor: i64 = match param {
        Some(raw) => match raw.trim().parse::<i64>() {
            Ok(n) if n >= 0 => n,
            _ => {
                return Err((
                    400,
                    "bad_cursor",
                    "cursor must be a non-negative integer sequence".to_string(),
                ))
            }
        },
        None => (max_seq - DEFAULT_REPLAY_LIMIT).max(0),
    };
    if max_seq - cursor > CURSOR_TOO_OLD_WINDOW {
        return Err((
            410,
            "cursor_too_old",
            format!("cursor {cursor} is more than {CURSOR_TOO_OLD_WINDOW} rows behind {max_seq}"),
        ));
    }
    Ok((source, cursor))
}

/// Spawn the per-connection producer task and return the frame receiver.
/// The task ends (dropping the sender, which closes the body) when the
/// client disconnects, the device is revoked, the queue overflows after
/// emitting `stream.resync_required`, or the journal becomes unreadable
/// (the client reconnects and resumes at-least-once).
pub fn spawn_event_stream(
    db: Arc<Db>,
    auth: Arc<Auth>,
    authorization: String,
    cursor: i64,
    config: StreamConfig,
) -> ReceiverStream<String> {
    let (tx, rx) = mpsc::channel::<String>(config.queue_cap);
    tokio::spawn(run_producer(db, auth, authorization, cursor, config, tx));
    ReceiverStream::new(rx)
}

async fn run_producer(
    db: Arc<Db>,
    auth: Arc<Auth>,
    authorization: String,
    mut cursor: i64,
    config: StreamConfig,
    tx: mpsc::Sender<String>,
) {
    // Fresh-connection hello: retry hint, then the current max sequence so
    // the client can persist a cursor without reading to the end.
    let max_seq = db.max_event_sequence().unwrap_or(0);
    if tx.send(retry_frame()).await.is_err() {
        return;
    }
    let hello = named_frame(
        "stream.hello",
        &serde_json::json!({ "current_seq": max_seq }).to_string(),
    );
    if tx.send(hello).await.is_err() {
        return;
    }

    // Catch-up: bounded batches until the cursor reaches the max. Slow
    // clients apply backpressure through the bounded channel instead of
    // losing rows.
    loop {
        let rows = match db.stream_events_after(cursor, REPLAY_BATCH + 1) {
            Ok(rows) => rows,
            Err(_) => return,
        };
        let caught_up = rows.len() as i64 <= REPLAY_BATCH;
        for row in rows.into_iter().take(REPLAY_BATCH as usize) {
            cursor = row.seq;
            if tx.send(data_frame(&row)).await.is_err() {
                return;
            }
        }
        if caught_up {
            break;
        }
    }

    // Live: poll the journal; the queue cap is enforced by resync, never by
    // silent drops. A revoked device closes the stream on the next
    // heartbeat; reconnect then fails at 401.
    let mut beat = tokio::time::interval(config.heartbeat);
    beat.tick().await; // consume the immediate tick
    loop {
        tokio::select! {
            _ = tokio::time::sleep(config.poll_interval) => {
                let rows = match db.stream_events_after(cursor, config.queue_cap as i64 + 1) {
                    Ok(rows) => rows,
                    Err(_) => return,
                };
                if rows.len() > config.queue_cap {
                    let current = db.max_event_sequence().unwrap_or(cursor);
                    let control = named_frame(
                        "control",
                        &serde_json::json!({
                            "type": "stream.resync_required",
                            "current_seq": current,
                        })
                        .to_string(),
                    );
                    let _ = tx.try_send(control);
                    return;
                }
                for row in rows {
                    cursor = row.seq;
                    if tx.send(data_frame(&row)).await.is_err() {
                        return;
                    }
                }
            }
            _ = beat.tick() => {
                if tx.send(ping_frame().to_string()).await.is_err() {
                    return;
                }
                if auth.authenticate(Some(&authorization)).is_err() {
                    return;
                }
            }
        }
    }
}
