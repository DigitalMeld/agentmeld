-- Migration v5: phase4-event-stream.
--
-- 1. run_events.actor: who caused the fact ('worker', 'device:<id>', or
--    'service'). Nullable: rows written before v5 carry no actor, and the
--    SSE envelope omits the field rather than inventing one.
-- 2. tool_steps: the queryable tool-call projection (Phase 4 design §4,
--    adapted from docs/specs/data/core-schema.sql with two refinements:
--    approval_id links the execution record to its authorization, and the
--    state set drops 'proposed', which belongs to approvals).
--
-- The stream never serves approval.dispatched (plaintext execution ticket)
-- or provider_session.bound (native provider binding): the exclusion is
-- enforced by kind in the stream query, not by this schema.

ALTER TABLE run_events ADD COLUMN actor TEXT;

CREATE TABLE tool_steps (
  workspace_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  id TEXT NOT NULL,
  call_key TEXT NOT NULL,
  parent_step_id TEXT,
  ordinal INTEGER NOT NULL CHECK(ordinal > 0),
  tool_name TEXT NOT NULL CHECK(length(tool_name) BETWEEN 1 AND 128),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 256),
  approval_id TEXT,
  state TEXT NOT NULL CHECK(state IN ('running','completed','failed','denied','cancelled','unknown')),
  result_json TEXT CHECK(result_json IS NULL
    OR (json_valid(result_json) AND length(result_json) <= 65536)),
  output_blob_id TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  PRIMARY KEY(workspace_id, run_id, id),
  UNIQUE(workspace_id, run_id, call_key),
  FOREIGN KEY(workspace_id, run_id) REFERENCES runs(workspace_id, id),
  FOREIGN KEY(workspace_id, run_id, parent_step_id) REFERENCES tool_steps(workspace_id, run_id, id),
  FOREIGN KEY(workspace_id, output_blob_id) REFERENCES blobs(workspace_id, id)
);
CREATE INDEX tool_steps_run_ord ON tool_steps(workspace_id, run_id, ordinal);
