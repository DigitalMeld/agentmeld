-- Migration v6: user-initiated approval revocation (issue #105).
--
-- 'user_revoked' joins the revoked_reason CHECK enum. SQLite cannot ALTER
-- a CHECK constraint, so the approvals table is rebuilt: the new table
-- carries the extended enum, rows copy verbatim, then the old table drops
-- and the new one renames into place. The partial index is recreated too.

CREATE TABLE approvals_new (
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
  revoked_reason TEXT CHECK(revoked_reason IN ('device_revoked','lease_takeover','digest_mismatch','service_restart','superseded','user_revoked')),
  expires_at INTEGER NOT NULL,
  decided_by TEXT REFERENCES devices(id),
  decided_at INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(workspace_id, id),
  FOREIGN KEY(workspace_id, run_id) REFERENCES runs(workspace_id, id)
);

INSERT INTO approvals_new
  (workspace_id, run_id, id, action_digest, action_json, target_json,
   description_user, ticket_hash, consumed_at, grant_revision, lease_generation,
   state, revoked_reason, expires_at, decided_by, decided_at, created_at)
SELECT
  workspace_id, run_id, id, action_digest, action_json, target_json,
  description_user, ticket_hash, consumed_at, grant_revision, lease_generation,
  state, revoked_reason, expires_at, decided_by, decided_at, created_at
FROM approvals;

DROP TABLE approvals;

ALTER TABLE approvals_new RENAME TO approvals;

CREATE INDEX approvals_pending ON approvals(workspace_id, run_id, state, expires_at)
  WHERE state = 'pending';
