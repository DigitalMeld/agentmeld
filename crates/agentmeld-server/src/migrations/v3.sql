-- v3: profile-revision sync (the PoC's conversation.agentRevision /
-- task.agentRevision): a changed agent profile invalidates the ready
-- provider session for the conversation.
ALTER TABLE conversations ADD COLUMN agent_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN agent_revision INTEGER NOT NULL DEFAULT 0;
