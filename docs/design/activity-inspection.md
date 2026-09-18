# Activity inspection

Implemented 2026-09-18. This batch improves browsing retained runs without changing execution, credentials, retention, or filesystem access.

## Delivered behavior

1. Readable outcome labels replace raw status values in Activity.
2. Quiet status badges distinguish active, completed, and failed outcomes.
3. Status filters display live counts within the other selected criteria.
4. Failed includes failed and interrupted runs.
5. Stopped isolates cancelled runs.
6. All dates, Today, and 7 days use local calendar dates; 7 days includes today and six preceding days.
7. With inputs filters runs that received attachments.
8. Search includes input filenames.
9. Search includes recorded milestone labels.
10. Clear search preserves other filters and restores input focus.
11. Reset filters restores the complete retained view.
12. Empty states distinguish no history, no matches, and no selected chat.
13. Completed boilerplate summaries are omitted from Activity and details.
14. Each entry displays input and output counts.
15. The result count explicitly identifies All chats or This chat scope.
16. Export JSON downloads exactly the filtered results in their visible order.
17. Export Markdown downloads a readable digest of those results.
18. Details show queue wait derived only from recorded queued and started milestones.
19. Details summarize input count, output count, and total output bytes.
20. The milestone heading includes its recorded event count.
21. Copy request copies the exact original request.
22. Copy reply copies the answer and is disabled when none exists.
23. Copy timeline copies recorded timestamps and labels and is disabled without events.
24. Left/right keys navigate the filtered runs, with focus continuity and a scrollable mobile dialog body.
25. Validated filter, date, scope, attachment, and ordering preferences survive reload; search text is never persisted.

## Data and limits

Activity uses the existing authorized task projection and existing 30-turn retention. No schema migration or deletion behavior changed. Dates filter creation time. Search is local, case-insensitive metadata/text matching, not file-content indexing.

Queue wait and duration show Not recorded when evidence is missing or invalid. Milestones are application-owned lifecycle records, not complete command history. Older runs are not backfilled with inferred events.

Exports are explicit local downloads using the existing allowlisted run projection. They include requests, replies, public milestone labels and file metadata, but not credentials, internal provider payloads or file bytes. They are not backups or import packages. Preferences store only UI settings under `agentmeld-activity`.

## Verification

- `experiments/poc-conversation-tools.test.mjs`: composed filters, local dates, labels, timing validity, export projection and source preservation.
- `experiments/poc-activity-inspection.browser.mjs`: disposable runs, counts, filters, search, reset, persistence, downloads, copy actions, keyboard navigation, empty states and desktop/mobile rendering.
- Existing conversation-navigation browser regression remains passing.
- Browser fixtures do not call a provider, start containers, read user files or write the real clipboard.
