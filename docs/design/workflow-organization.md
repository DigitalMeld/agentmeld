# Conversation organization and output workflow

Implemented 2026-09-18 in the local Codex-only client. This batch extends the existing version-2 store and authenticated loopback API. It does not claim native-client or remote-host alpha completion.

## Delivered improvements

| # | Improvement | Behavior |
| --- | --- | --- |
| 1 | Rename a chat | Single-line title, 1–120 characters, saved on the server; original prompts remain intact. |
| 2 | Pin/unpin | Persistent pin state puts a conversation before unpinned peers. |
| 3 | Recent ordering | Within each pin group, chats sort by their latest retained turn rather than creation date. |
| 4 | Archive | Preserves all messages, outputs, attachments and native session references; running/queued/stopping work cannot be archived. |
| 5 | Restore | Archived conversations have a clear read-only banner and Restore action. Restoration does not bypass unavailable/legacy continuation rules. |
| 6 | Archive browsing | An archive icon beside the Chats heading toggles the archived list, with a tooltip, keyboard access and pressed state. Title search lets the owner find retained archived work; selecting it through Activity also selects the correct list. |
| 7 | Turn counts | Chat rows and the selected-conversation toolbar show retained turn counts. |
| 8 | Chat status | Rows show active work status, otherwise the last turn's actual status. |
| 9 | Selected title | Toolbar shows which conversation is open and provides its options. |
| 10 | Markdown transcript | Explicit local download contains messages, timestamps, status and file names. |
| 11 | JSON transcript | Versioned, allowlisted transcript structure; no native sessions, credentials, request keys, workspace snapshots or file bytes. This is not an import/backup format. |
| 12 | Original attachments | User-message file buttons download the original retained input bytes through authenticated retrieval. |
| 13 | Output sorting | Newest, oldest, name and largest sorts are available. |
| 14 | Output type filter | All, Markdown, CSV, text and JSON; filtering combines with existing filename/conversation search. |
| 15 | Output summary | Shows matching output count and combined byte size. Counts represent retained output occurrences, not unique filenames. |
| 16 | Output version labels | Each conversation/filename pair is numbered in retained turn order. |
| 17 | Version selection | Preview switches between retained occurrences without changing any bytes; unrelated same-name files are not combined. |
| 18 | Raw Markdown | Preview toggles original source and existing formatted rendering; Copy always copies original text. |
| 19 | Preview conversation link | Opens the exact producing turn. |
| 20 | Chat-search shortcut | Cmd/Ctrl+K focuses chat search and opens the mobile history panel. |
| 21 | Shortcut help and dismissal | Visible help describes shortcuts; Escape dismisses tooltips/dialogs before open panels and never stops a run. |
| 22 | Unsent-work warning | Browser before-unload warning when current or retained in-memory drafts contain text, attachments or a pending submission. Browser policy governs whether the warning appears. No draft persistence was added. |
| 23 | Jump to latest | Appears when the transcript is scrolled away from the bottom; returns to the latest turn. |
| 24 | Activity request search | Text filtering combines with status filtering; no full-content or hidden-provider-event search is implied. |

## Data and authorization

`POST /api/conversations` accepts an existing `id` and optional absolute `title`, `pinned` and `archived` values. Unknown fields and invalid types are rejected. Updates use the same serialized admission queue and authenticated local-origin checks as message creation. Archives are rejected while that chat has active or queued work. New messages to archived chats fail with 409; replay of a previously accepted idempotent request still returns that original task. Archive/restore does not delete data, restart execution or reclaim any of the 30 retained turn slots.

`pinned` and `archived` are optional additive conversation fields; older records project them as false. Input metadata now includes byte size. `GET /api/file` defaults to output retrieval and accepts `kind=input` for original attachments; it does not accept filesystem paths or arbitrary workspace access. Existing output links remain valid.

Transcript exports deliberately exclude attachment/output contents and provider internals. They download to the user's browser only on explicit action. Version numbers are derived from current retained turn order, not new globally stable artifact IDs. Existing draft artifact/schema plans still own eventual reusable artifact identities and import/backup design.

## Verification and limits

Node fixtures cover pin/recent ordering, archive filtering, validation, active-work rejection, export field exclusion, type/sort/version behavior, metadata persistence through service restart, archived admission rejection, original-byte retrieval, and authentication/origin boundaries. The explicit organization browser fixture covers the owner journey across rename/pin/archive/reload/restore, both download formats, original attachment bytes, version switching, raw/formatted preview, search, keyboard access, unsent warning and mobile options. All 185 Node tests and both explicit browser fixtures passed, and 58 Markdown files passed link/fence validation. Rendered desktop preview and mobile options were inspected. All fixtures are disposable; no provider call or container is required.

Commands: `node --test experiments/*.test.mjs`; the two explicit browser fixtures are `experiments/poc-ui.browser.mjs` and `experiments/poc-organization.browser.mjs`, with `PLAYWRIGHT_MODULE` pointing to the existing runtime. Run `python3 scripts/check-docs.py`. The full local script still requires Cargo, unavailable on this host. Live native execution was not requalified for this UI/metadata batch.

The archive dropdown was replaced following visual feedback. Browsing archives changes only the list, preserving the selected conversation and draft; the heading reads “Archived” while that view is selected. New chat returns to the active list.
