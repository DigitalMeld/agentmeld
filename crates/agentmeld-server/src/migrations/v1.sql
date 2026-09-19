-- Migration v1: Phase 2 continuity slice + device auth.
-- Adapted from docs/specs/data/core-schema.sql. Tables NOT installed in
-- Phase 2 (approvals, tool_steps, artifacts, artifact_versions, delivery_outbox)
-- arrive in the Phase 3/4 increments with their own reviewed migrations.
-- Must not invent fields the core-schema draft does not define; the three
-- Phase 2 auth tables (devices, device_sessions, pairing_tokens) are the
-- design's own addition (docs/design/rust-service-front.md section 3).
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);

CREATE TABLE principals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('owner','system')),
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE hosts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL REFERENCES hosts(id),
  owner_id TEXT NOT NULL REFERENCES principals(id),
  name TEXT NOT NULL,
  grant_revision INTEGER NOT NULL DEFAULT 1 CHECK(grant_revision > 0),
  created_at INTEGER NOT NULL
);

CREATE TABLE agents (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  config_json TEXT NOT NULL CHECK(json_valid(config_json)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(workspace_id, id)
);

CREATE TABLE conversations (
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  title TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER,
  deleted_at INTEGER,
  PRIMARY KEY(workspace_id, id),
  FOREIGN KEY(workspace_id, agent_id) REFERENCES agents(workspace_id, id)
);

CREATE TABLE messages (
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal > 0),
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system_notice')),
  state TEXT NOT NULL CHECK(state IN ('pending','streaming','complete','stopped','failed')),
  blocks_json TEXT NOT NULL CHECK(json_valid(blocks_json)),
  reply_to_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY(workspace_id, conversation_id, id),
  UNIQUE(workspace_id, conversation_id, ordinal),
  FOREIGN KEY(workspace_id, conversation_id) REFERENCES conversations(workspace_id, id),
  FOREIGN KEY(workspace_id, conversation_id, reply_to_id) REFERENCES messages(workspace_id, conversation_id, id)
);

CREATE TABLE provider_sessions (
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  id TEXT NOT NULL,
  adapter TEXT NOT NULL,
  protocol_version TEXT NOT NULL,
  model TEXT NOT NULL,
  native_ref TEXT NOT NULL,
  config_digest TEXT NOT NULL,
  grant_revision INTEGER NOT NULL,
  generation INTEGER NOT NULL CHECK(generation > 0),
  state TEXT NOT NULL CHECK(state IN ('ready','invalidated','unavailable','closed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(workspace_id, id),
  UNIQUE(workspace_id, conversation_id, id),
  UNIQUE(workspace_id, conversation_id, generation),
  FOREIGN KEY(workspace_id, conversation_id) REFERENCES conversations(workspace_id, id)
);

CREATE TABLE runs (
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  id TEXT NOT NULL,
  origin_message_id TEXT NOT NULL,
  response_message_id TEXT,
  provider_session_id TEXT,
  initiator_id TEXT NOT NULL REFERENCES principals(id),
  request_key TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','starting','running','waiting_approval','waiting_human','cancelling','cancelled','completed','failed','interrupted','reconciling','needs_attention')),
  config_json TEXT NOT NULL CHECK(json_valid(config_json)),
  grant_revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  terminal_reason TEXT,
  usage_json TEXT CHECK(usage_json IS NULL OR json_valid(usage_json)),
  PRIMARY KEY(workspace_id, id),
  UNIQUE(workspace_id, conversation_id, id),
  UNIQUE(workspace_id, initiator_id, request_key),
  FOREIGN KEY(workspace_id, conversation_id, origin_message_id) REFERENCES messages(workspace_id, conversation_id, id),
  FOREIGN KEY(workspace_id, conversation_id, response_message_id) REFERENCES messages(workspace_id, conversation_id, id),
  FOREIGN KEY(workspace_id, conversation_id, provider_session_id) REFERENCES provider_sessions(workspace_id, conversation_id, id)
);

CREATE TABLE run_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  kind TEXT NOT NULL,
  source_key TEXT,
  visibility TEXT NOT NULL CHECK(visibility IN ('user','diagnostic')),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  created_at INTEGER NOT NULL,
  UNIQUE(workspace_id, run_id, source_key),
  FOREIGN KEY(workspace_id, conversation_id, run_id) REFERENCES runs(workspace_id, conversation_id, id)
);

CREATE TABLE blobs (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  id TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
  byte_size INTEGER NOT NULL CHECK(byte_size >= 0),
  media_type TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('ready','quarantined','pending_delete','deleted')),
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY(workspace_id, id),
  UNIQUE(workspace_id, storage_key)
);

CREATE TABLE message_attachments (
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  id TEXT NOT NULL,
  blob_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  PRIMARY KEY(workspace_id, id),
  FOREIGN KEY(workspace_id, conversation_id, message_id) REFERENCES messages(workspace_id, conversation_id, id),
  FOREIGN KEY(workspace_id, blob_id) REFERENCES blobs(workspace_id, id)
);

CREATE TABLE conversation_workspaces (
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  quota_bytes INTEGER NOT NULL CHECK(quota_bytes > 0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  lease_owner TEXT,
  lease_generation INTEGER NOT NULL DEFAULT 0 CHECK(lease_generation >= 0),
  lease_expires_at INTEGER,
  captured_at INTEGER,
  state TEXT NOT NULL CHECK(state IN ('ready','leased','reconciling','unavailable','pending_delete')),
  PRIMARY KEY(workspace_id, conversation_id),
  UNIQUE(workspace_id, storage_key),
  FOREIGN KEY(workspace_id, conversation_id) REFERENCES conversations(workspace_id, id)
);

CREATE TABLE import_receipts (
  source_digest TEXT NOT NULL,
  legacy_task_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  imported_at INTEGER NOT NULL,
  PRIMARY KEY(source_digest, legacy_task_id),
  FOREIGN KEY(workspace_id, conversation_id, run_id) REFERENCES runs(workspace_id, conversation_id, id)
);

-- Phase 2 device auth (design section 3). Sessions are opaque bearer tokens,
-- SHA-256-hashed at rest; the service derives actor identity from the session.
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enrolled_at INTEGER NOT NULL,
  revocation_version INTEGER NOT NULL DEFAULT 1,
  last_seen INTEGER
);

CREATE TABLE device_sessions (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id),
  token_hash TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  issued_revocation_version INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX device_sessions_token ON device_sessions(token_hash);

-- Pairing tokens: single-use, time-boxed enrollment credentials. The bootstrap
-- mints one automatically when no device is enrolled; re-pairing afterwards
-- requires the on-host `pair` CLI subcommand. A pairing token is also accepted
-- as a bearer credential until it expires or is consumed, so the unmodified
-- PoC browser client works on first run (no flag day).
CREATE TABLE pairing_tokens (
  token_hash TEXT PRIMARY KEY,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE INDEX runs_queue ON runs(status, created_at);
CREATE INDEX runs_conversation ON runs(workspace_id, conversation_id, created_at, id);
CREATE UNIQUE INDEX one_active_turn ON runs(workspace_id, conversation_id)
  WHERE status IN ('starting','running','waiting_approval','waiting_human','cancelling','reconciling');
CREATE UNIQUE INDEX one_ready_session ON provider_sessions(workspace_id, conversation_id)
  WHERE state = 'ready';
CREATE INDEX events_replay ON run_events(workspace_id, sequence);
