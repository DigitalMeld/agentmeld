# Composer refinements

Implemented 2026-09-18 following the request to remove the header subtitle and continue practical improvements.

## Delivered changes

1. Removed “Your personal agent” from the header.
2. Pasting files into the message field attaches them through the existing admission path; ordinary text paste is unaffected.
3. Attachment summary shows file count and combined size.
4. Attachment limits appear alongside selected files and describe the attach control for assistive technology.
5. Reading attachments has a visible status and the composer exposes its busy state.
6. Successful attachment additions announce how many files were added.
7. Unchanged attachment controls retain keyboard focus during polling.
8. Removing one attachment focuses the next available remove control, or Attach when empty.
9. Remove all clears only attachments, preserving the message.
10. Undo restores the previous attachment set after individual or bulk removal.
11. New chat restores its unfinished draft after visiting another conversation; repeated New chat clicks preserve that draft.
12. The sample action refuses to overwrite existing message text or attachments.
13. Long attachment names truncate within their chip, while their full name remains available in the title and remove control's accessible label.

## Boundaries

Drafts and one attachment undo snapshot per draft remain in memory only. Refresh does not persist them, and the existing unsaved-work warning still applies. A successful send clears that draft's undo snapshot. Adding files clears its earlier removal snapshot. Undo never sends a request or touches retained output files.

`/new` remains an explicit empty composer/context action and clears the new-chat draft. The same filename, file-count and byte limits apply to picker, drop and clipboard attachments. Invalid batches leave existing files intact. Clipboard file pastes do not silently submit the message. No new storage, dependencies, provider calls or permissions were added.

## Verification

204 existing Node tests pass. The disposable `experiments/poc-composer-refinements.browser.mjs` fixture verifies header text, attachment summaries, paste admission and duplicate rejection, individual/bulk undo, focus across polling, new-chat draft recovery, sample protection, `/new` and mobile containment. Existing Activity inspection and conversation-navigation browser regressions also pass. Desktop/mobile output was visually inspected. No model or container calls are made by these fixtures.
