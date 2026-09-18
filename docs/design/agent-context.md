# Agent identity and approved memory

Implemented as a first P5/P10 slice in the local web client. This does not complete multi-agent management or the full memory specification.

## Owner workflow

Agent settings in the rail edit the name, identity, persona and owner profile. Approved memories are explicitly added by the owner, individually removed, and exported with the current agent context as JSON. The UI preserves unsaved descriptive edits during memory changes; Reload saved settings explicitly replaces the form. Descriptive text cannot change runtime grants, container mounts, egress or approval policy.

The authenticated `/api/agent` endpoint reads and updates the canonical conversation store's optional `agentProfile` field. No second store or database is introduced. Missing profiles default to revision zero. Existing format-2 readers preserve optional fields, so this is an additive extension rather than a destructive migration. The future SQLite importer must preserve the profile revision, memory IDs, source task links and conversation/task revision markers.

Every write requires the current revision and increments it. Concurrent or delayed writes fail with 409; removal cannot be undone by a stale client. Context is bounded to 24,000 serialized characters, 100 memories, 2,000 characters per memory and 4,000 per descriptive field. Task-source references must resolve to an existing task. The web form currently creates owner-sourced memories; conversation-source selection and editing individual memories remain follow-ups.

Changes are rejected while work is running or queued. Each new run receives the current approved context. When the revision changes, the conversation's next run starts fresh provider context, retaining its visible messages, historical outputs and workspace snapshot. This explicit tradeoff prevents a deleted preference surviving solely inside a resumed provider session; it also means the next run does not implicitly remember earlier chat messages. The settings UI discloses this behavior.

Removing memory excludes it from future context but does not scrub the original transcript, files, prior exports, provider retention or backups. There is no autonomous memory creation or background dispatch. Historical profile content is not retained by this implementation; a monotonically increasing revision supplies conflict detection, not a revision-history browser.

## Evidence and remaining acceptance

- `experiments/poc-profile.test.mjs`: validation, stale/concurrent edits, deletion, authenticated endpoints, restart persistence, provider-context replacement with workspace retention, and active-run rejection.
- `experiments/poc-profile.browser.mjs`: owner editing, remember/forget, draft preservation, reload/readback and narrow-layout rendering with disposable state.
- Node suite: 207 tests. Browser fixture uses no provider, container or user data. JavaScript syntax/docs checks accompany the change.
- Live provider use of newly edited context is not yet qualified; the injected execution fixture proves orchestration and the runtime builds the native turn prompt from that context. Full P5/P10 require live acceptance, explicit memory edits/provenance navigation and the broader versioned agent-state design.
