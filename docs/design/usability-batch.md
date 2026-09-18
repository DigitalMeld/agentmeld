# Local client usability batch

Implemented 2026-09-18. Scope: the existing Codex-only local client. No new provider, service dependency, native client, or messaging integration.

| Improvement | Implemented behavior |
| --- | --- |
| 1. Expanding composer | Textarea grows with lines up to 140px, then scrolls; shrinks after clearing. |
| 2. Character feedback | Shows count from 14,000 characters toward the existing 16,000-character limit. |
| 3. Send readiness | Empty/whitespace messages, offline state and attachment loading disable Send. Existing idempotent Retry remains available when connected. |
| 4. IME-safe Enter | Composition Enter does not submit; Enter submits otherwise and Shift+Enter retains a newline. |
| 5. Drop attachments | File drops attach to the current chat draft; a drag overlay indicates the destination. Browser file navigation is prevented. |
| 6. Atomic attachment checks | Entire batch is checked before adding any file: safe filenames, duplicates, five-file count, 2 MiB/file and 5 MiB total. Invalid batches preserve previous attachments. Server validation remains authoritative. |
| 7. Readable sizes | Attachment chips and output rows show bytes/KB/MB, including empty and sub-KB files accurately. |
| 8. Composer focus | Successful sends return focus when initiated from the composer and the user has not navigated/focused another control. |
| 9. Copy reply | Copy action uses the original assistant text, not rendered HTML; success/failure feedback is visible and announced. |
| 10. Copy preview | Text-format outputs can be copied as original text. Unsupported file types remain downloadable. |
| 11. Preview provenance | Preview identifies the producing conversation, turn time and actual byte size. Latest requested preview wins if requests overlap. |
| 12. Activity filters | All, In progress, Needs attention (failed/interrupted/stopped), and Completed filter retained turns without changing their status. |
| 13. Connection recovery | Local API connectivity is shown in the sidebar; a banner remains visible on mobile. Polls time out after eight seconds. Explicit Retry and automatic polling restore connection without discarding the draft. This indicates API connectivity, not VM/model readiness. |
| 14. Close Activity | Explicit keyboard-accessible close button works on desktop/mobile and returns focus to Activity; reopening works across breakpoints. |

## Persistence and privacy boundaries

No new storage of credentials, clipboard history, message drafts or file contents is introduced. Clipboard access happens only on explicit Copy actions. Drafts/attachments remain memory-only; only the selected conversation ID already survives same-tab refresh. Attachments are added to their originating draft if the user switches chats during loading. Clearing that draft invalidates the pending attachment batch.

## Verification

Pure tests cover attachment limits, names, duplicates, atomic validation and byte labels. The explicit Chrome fixture uses disposable conversations/files and a stubbed clipboard API (no modification of the user's system clipboard). It covers composer sizing/count/readiness, IME Enter, upload/drop/removal, preserved files after batch rejection, offline/retry draft preservation, copy payloads, preview provenance, Activity filters and mobile close/reopen, in addition to existing continuity/search/output tests. A lost-response fixture confirms Retry reuses the accepted request without a duplicate turn; a delayed file-read fixture confirms uploads stay with the originating draft across chat switches. Clipboard denial is also exercised. All 180 Node tests and the expanded browser fixture passed. Documentation checks passed. The full local script remains blocked at its first Rust command because Cargo is unavailable. No paid model or container is invoked by these tests.

Native command history, persisted drafts, full-content search, reusable artifact identities, and cross-device clients remain separate roadmap work.
