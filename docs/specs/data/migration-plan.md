# POC migration and data delivery plan

Updated 2026-09-18. Proposed procedure only. No running service, retained data or credentials have been changed. Parent: [data model](../data-model.md); target [SQL draft](core-schema.sql).

## Current state, inspected in source

`apps/poc/server.mjs` loads `.local/poc/state.json` with a `tasks` array. Each task saves `id`, `prompt`, `inputs[{name,data}]`, `artifacts[{name,data}]`, `answer`, `status`, `activity`, `createdAt` and optional error. File bytes are base64 in JSON. The server serializes state saves through temporary-file rename and admits one active task. Startup marks previously running tasks interrupted. Task completion is saved; intermediate runtime progress is not a durable event journal. The public API masks base64; downloads identify task plus filename.

The POC does not persist conversation identity, native provider-session mapping, full tool event history, artifact source history or original command timestamps. A task's saved answer is not evidence of native continuation. The importer must not infer missing state or recover arbitrary provider history from the credential volume. It does not read raw credentials.

## Exact legacy mapping

| POC field | Target | Rule |
| --- | --- | --- |
| Task ID | Conversation/run mapping and import receipt | One legacy task becomes one conversation and one imported run; preserve legacy ID lookup. Never guess which separate tasks belonged to one chat |
| Prompt | First user message | Preserve exact saved text |
| Answer | Assistant message | Preserve exact text, including partial answers; retain stopped/failed state where applicable |
| Created time | Conversation/message/run creation | Parse stored ISO time to UTC; invalid timestamps block import of that record for review |
| Status | Run terminal/import state | completed→completed, stopped/cancelled→cancelled, failed→failed, running/interrupted→interrupted; unknown values require review |
| Activity/error | Imported summary/diagnostic | Preserve as imported text, not proof of individual tool actions |
| Inputs | Blob + message attachment | Decode strictly, hash, count and compare bytes; safe display names never become unrestricted host paths |
| Artifacts | Blob + artifact version 1 | Link to imported run; validation is `not_checked` unless independently validated now; retain names and content exactly |
| Missing timestamps/usage | Nullable fields | Unknown stays null, not zero or fabricated original completion time |
| Missing provider ref | No provider session | Show imported history; a user-authorized continuation reconstructs from visible records/files and is labeled reconstructed |
| Missing event history | One imported-record event | Do not manufacture step-by-step logs from answer prose |
| Missing working sources | Explicit unavailable source manifest | Retained outputs can be attached to a new run; do not promise the original build environment |

## Migration sequence

1. Build the importer against synthetic fixtures first: every terminal state, partial response, Unicode/name edge cases, empty/malformed files, duplicate task IDs and unknown status. Reject ambiguous data instead of silently dropping or coercing it.
2. At the authorized implementation cutover, stop accepting new requests, allow active work to settle or obtain an explicit Stop decision, then gracefully stop the writer. Do not copy a changing JSON file and call it a consistent backup.
3. Create a private timestamped backup of the original state and a hash/size manifest. Retain the old executable revision/configuration and record file ownership/modes. Do not back up provider secrets into this ordinary export.
4. Create a new staging database and blob root. Apply ordered checksummed migrations. Import each record with source digest and deterministic mapping recorded in `import_receipts`; no existing destination is overwritten. Unknown/corrupt records halt cutover with a precise report. Repeating the same import is idempotent.
5. For every task compare prompt/answer, state, input/output counts, names, decoded sizes and SHA-256. Check foreign keys, uniqueness, row counts, legacy lookup and artifact retrieval. Keep reports free of private content.
6. Open the staged store through the new service and verify a synthetic new conversation, follow-up, `/new`, restart, Activity links and file reads. Reconcile actual owned worker state before admitting execution. Never automatically replay an imported interrupted run.
7. Switch one configured store pointer only after verification. Exactly one authoritative writer is allowed; do not dual-write JSON and SQLite. Keep a legacy task/file lookup adapter for existing links, resolving to canonical scoped IDs rather than maintaining a second store.
8. Read back representative existing records through the owner UI/API and verify all imported file hashes. Leave original backup untouched until the owner accepts the migration and retention decision. Document chosen revision and restore procedure.

### Rollback

Before new writes occur, stop the new service and restore the recorded old revision/store pointer from the backup. After new writes occur, reverting to old JSON would lose new work: quiesce, preserve/export the new database/blob generation and use a verified forward fix or explicit reverse migration. Never delete the new store to make rollback appear successful. Schema downgrade is not assumed; fail closed on newer unknown versions.

SQLite/filesystem backup must be coordinated with writer and workspace/browser state, using supported SQLite backup/checkpoint APIs. A live raw database copy is insufficient. Run restore checks against an isolated destination before any backup claim.

## M1 schema rollout

| Increment | Minimal authoritative additions | Must demonstrate before next increment |
| --- | --- | --- |
| A: continuity/import | Identity scope, conversation/messages/runs, native session map, workspace lease, inputs and minimal event ledger; imported outputs retained | Follow-up uses correct context/files; `/new` is fresh; restart/duplicate/concurrent submission tests; every old file retained |
| B: output provenance | Artifact versions, retained source manifests, quota-aware ingestion | Edit earlier report, preserve versions, recover interrupted ingestion and reject unsafe paths |
| C: activity | Tool-step projection, recorded result links, user/diagnostic visibility | Running/completed/failed/stopped entries, deep links, replay without duplication, known missing native details shown honestly |
| D: browser/approval | Exact-action approvals, viewer lease integration, browser assignment records as needed | Deny/replay/modified target fail; takeover pauses; resume reobserves; disconnect remains paused |
| E: recovery/delivery | Durable outbox, reconciliation and production worker ownership | Crashes between admission/dispatch/result/notification do not duplicate effects; uncertain outcomes need attention |

Keep each schema change small and backward-aware. The complete draft SQL describes the end of M1; the implementation must split it into dependency-ordered migrations and test each upgrade path. Do not install all future Muse domains to deliver increment A.

## Required verification coverage

- **Schema:** empty creation, foreign-key check, invalid enum/JSON rejection, cross-workspace and cross-conversation reference rejection, one active turn/ready session, request-key uniqueness, ordered message/event replay.
- **Authorization:** an owner-scoped API rejects wrong host/workspace/artifact IDs; schema constraints alone are not that proof. Future guest scopes require their own tests before M3.
- **Continuation:** provider-native resume, expired/invalid mapping, changed grants/config, unavailable worker; never silently use another conversation's session.
- **Artifacts:** strict bounded decoding, path/symlink/archive defenses, quotas, hash readback, repeated filenames across versions, dangling/staged blob reconciliation, no secret/profile exports.
- **Recovery:** kill at each durable boundary with disposable fixtures, restore DB/files consistently, retry admission safely, uncertain external writes never replay automatically.
- **Deletion:** search/context invalidation, revoked file links, rejected delayed writes and queued delivery; disclose residual backups separately.
- **Product:** P9/P10 plus existing M1 acceptance; inspect actual UI, not only SQL/test output.

## Design validation performed

Executed the SQL draft against an in-memory SQLite database with synthetic owner/host/workspace/conversation rows. All 19 tables created. Verified rejection of duplicate admission keys, a second active turn, cross-conversation origin messages, cross-workspace references, invalid run state, invalid JSON, a second ready native session and a native session belonging to another conversation. Verified ordered event readback, transaction rollback and a clean `PRAGMA foreign_key_check`.

Also compared the mapping document against every relation heading in the supplied source catalog: exactly 195 unique names, none missing or extra. Dispositions: 28 adapt, 43 consolidate, 118 defer and six omit. These are design checks, not an implemented migration, live-provider test or production durability claim. File-import, UI, service authorization and crash-injection acceptance remain pending.
