-- v4: Phase 3 approval path (issue #86): the approvals table and the
-- controller-lease table.
--
-- Adapted from docs/design/approval-path.md §9 (a sketch for review, not
-- final DDL) to the installed schema conventions:
--   * `decided_by` references devices(id): the deciding actor is a device
--     session, never a principal row.
--   * No `policy_revision` column: there is no policy table in the installed
--     schema slice, so there is nothing to re-validate at decide time. The
--     decision transaction re-validates grant_revision (workspaces) and
--     lease_generation (computer_leases), which both exist.
--   * `consumed_at` records single-use ticket redemption; NULL until the
--     worker presents the ticket in an approval.dispatched event.
--   * Supersession is not a state: revoked_reason = 'superseded' (the
--     resolved §12.1 decision — schema rules).
CREATE TABLE approvals (
  workspace_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  id TEXT NOT NULL,
  action_digest TEXT NOT NULL CHECK(action_digest GLOB '[0-9a-f]*' AND length(action_digest) = 64),
  action_json TEXT NOT NULL CHECK(json_valid(action_json)),
  target_json TEXT NOT NULL CHECK(json_valid(target_json)),
  description_user TEXT NOT NULL CHECK(length(description_user) <= 512),
  ticket_hash TEXT,
  consumed_at INTEGER,
  grant_revision INTEGER NOT NULL,
  lease_generation INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','approved','denied','expired','revoked')),
  revoked_reason TEXT CHECK(revoked_reason IN ('device_revoked','lease_takeover','digest_mismatch','service_restart','superseded')),
  expires_at INTEGER NOT NULL,
  decided_by TEXT REFERENCES devices(id),
  decided_at INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(workspace_id, id),
  FOREIGN KEY(workspace_id, run_id) REFERENCES runs(workspace_id, id)
);
CREATE INDEX approvals_pending ON approvals(workspace_id, run_id, state, expires_at)
  WHERE state = 'pending';

-- One row per (workspace, host): the controller lease. `generation` is the
-- fencing counter — every takeover, resume, private-bracket edge, revocation,
-- and restart bumps it, and it is never reused. `state` follows the journal's
-- Takeover → pausing → human → resume → resuming → observed → agent sequence;
-- `private_bracket` is the PrivateBegin/End credential-entry bracket inside
-- the human state. `heartbeat_at` drives auto-release of stale human holds.
CREATE TABLE computer_leases (
  workspace_id TEXT NOT NULL,
  host_id TEXT NOT NULL,
  holder_device_id TEXT REFERENCES devices(id),
  generation INTEGER NOT NULL DEFAULT 0 CHECK(generation >= 0),
  state TEXT NOT NULL CHECK(state IN ('agent','pausing','human','resuming','observed','paused')) DEFAULT 'agent',
  private_bracket INTEGER NOT NULL DEFAULT 0 CHECK(private_bracket IN (0, 1)),
  held_since INTEGER,
  heartbeat_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(workspace_id, host_id)
);

-- Append-only journal of lease transitions (takeover, ack, private
-- begin/end, resume, heartbeat expiry, revoke, observed). The lease row
-- is the authority; this table is the audit trail for the harness and
-- the future client surface.
CREATE TABLE lease_events (
  workspace_id TEXT NOT NULL,
  host_id TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  generation INTEGER NOT NULL,
  device_id TEXT REFERENCES devices(id),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(workspace_id, host_id, id)
);
