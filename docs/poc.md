# Local AgentMeld POC

The purpose is to decide whether the product is useful by doing real work in a
simple interface. Further Codex patch qualification was deferred at the owner's
request on 2026-09-18. The POC uses the existing unpatched Codex 0.154.0 runtime
with GPT-5.5 and the owner's already-authorized ChatGPT subscription.

## Run

In the existing prepared AgentMeld development environment:

```sh
npm run poc
```

Open the private `http://127.0.0.1:4317/#...` link printed by the server. The
fragment is a temporary local access token, not a provider credential. Keep it
local; it changes when the server restarts. No new npm package is required.
The dedicated `colima-agentmeld-m0` VM, selected `agentmeld-m0:local` image,
loaded named sandbox policy, and existing dedicated subscription store must be
available. This is currently a developer POC, not a fresh-machine installer.
[Runtime setup](m0/README.md) and [subscription store](m0/codex-auth-store.md)
document those prerequisites. Do not copy a personal home/profile into a worker.

## Try it

1. Choose **Find the story in my sales data** to attach the clearly labeled
   synthetic CSV, or use **+** to attach your own small files.
2. Send the request. The agent runs real commands in its isolated workspace;
   its response updates while it works.
3. Open the generated report or CSV in the conversation or Files view. Download
   the original bytes from the preview.
4. Send a follow-up in the same chat to revise the report without reuploading.
   Use **New chat** or send `/new` for fresh context and working files. Neither
   deletes earlier chats nor stops unrelated work. Follow-ups queue while a turn runs.
5. Use **Stop** while a turn runs. Stop targets that turn and verifies worker shutdown.
   A stopped/interrupted chat is preserved but cannot resume in this slice.
6. Restart the local server and reopen the newly printed link. Completed results
   and task history remain available.

## Verified locally

- The sample request produced actual `report.md` and `summary.csv` files using
  the subscribed model and native container commands. Downloaded bytes contain
  the correct totals: revenue 110,000; cost 44,800; profit 65,200.
- The browser opens the saved report preview. Rendered dark chat and report
  screens were inspected against the Muse reference hierarchy.
- A command waiting 120 seconds was started through the UI and stopped through
  the UI. The task became cancelled and no POC containers remained.
- Completed task/files remained accessible after a service restart.
- Unauthenticated API access returns 401; a foreign Origin returns 403.
- Default local checks remain separate from live subscription usage.

## Scope and limits

One local owner and one executing turn, with a durable FIFO queue. Each chat has
its own native Codex thread and bounded workspace snapshot. Completed turns can
continue after reload/service restart, using the same model, runtime image,
subscription-store identity and policy binding. Unsupported/missing continuation
fails closed; there is no silent reconstructed-context fallback.

Up to five new attachments, 2 MiB each and 5 MiB combined. Retained workspaces
allow 128 files/directories, eight directory levels, 2 MiB per file and 16 MiB
combined. Regular files and directories with supported names are retained;
symlinks, special files and unsupported names are rejected. Changed top-level
outputs are downloadable, at most 8 MiB per turn. Existing filenames cannot be
replaced by uploads; ask the agent to revise a file or rename the new attachment.
Thirty retained turns maximum; no automatic deletion. Ten-minute turn deadline.
Native tools may show their own scaffold directories in a fresh workspace;
prior user files and transcripts do not carry over.

Text, uploads, outputs and workspace snapshots stay in owner-only
`.local/poc/state.json` (format 2). The first upgrade preserves the exact old
JSON in an owner-only `state-v1-backup-<id>.json` before writing format 2.
Each legacy task becomes a separate read-only conversation because its native
continuation was never recorded. Download links and original file bytes remain.
Do not downgrade the server onto format 2; preserve/export new writes first.

Cancelled, failed or interrupted execution makes its conversation unavailable
for further turns: native execution and the last successful workspace snapshot
may differ. History and earlier outputs remain readable. Start a new chat and
explicitly attach a downloaded result. Recovery/reconstruction is future work.
Draft text, attachment selections and scroll positions survive chat switching
within the current page, not a page reload. Admission retries use the same
request key; an uncertain submission offers Retry without silently resending a
changed payload. Client drafts are not persisted to browser storage.

Inputs are sent to the configured subscription provider as needed. Native
session history remains in the existing protected provider store, never returned
in the state API. Snapshots are captured only after successful execution;
unfinished new files are not promised after Stop. Streaming text saves are
throttled; power-loss durability and orphan-worker recovery remain unqualified.

No remote listener, host-home mount, Docker-socket mount, arbitrary website
access, native app, live computer viewer, payments, sharing or messaging.
Workspace operations use the existing sandbox profile; escalation requests are
not granted. A model can report a tool error in text, but the known missing
failed-command lifecycle event is not repaired here. This does not block file
analysis/report generation; detailed command timeline accuracy remains deferred.

The web/server glue is a small Node implementation using the existing native
protocol client and container launcher pattern. It is not the completed Rust
control plane. Graceful shutdown stops an active worker; abrupt host/process
failure recovery is not claimed. Plain-text/Markdown/CSV previews do not execute
artifact HTML or scripts. Credentials stay in the existing dedicated volume.

## Next product work

Track owner feedback and acceptance criteria in the [product backlog](backlog.md).

Use the POC for representative real tasks and identify what is useful or missing.
Then add conversational follow-up and browser/computer interaction, followed by
the native clients and cross-host access already required for alpha. Resume a
dependency patch only when a demonstrated product need warrants it.

## Conversation continuity verification (2026-09-18)

- The idle local development app was upgraded to format 2 after an exact private backup. All seven pre-existing records and their input/output bytes compared equal after migration; authenticated API readback confirmed the retained conversations.
- Local HTTP fixtures verify serial follow-ups, duplicate admission, conflicting request keys, restart, fresh conversations, scoped queued Stop, invalid input, API redaction and exact legacy backup bytes.
- Real subscription-backed execution completed three turns in one chat. After a service restart, the second turn remembered a synthetic label, read a nested source file and revised a report from 42 to 63. The third read 63. Fresh native conversations reported all three prior paths absent; native scaffolding is allowed.
- One earlier live turn returned a valid answer but failed finalization. Its cause was not captured in that run; the chat failed closed. Stage-specific, bounded snapshot diagnostics were subsequently added. Later fresh-chat and resume checks passed; this is not a claim that every native execution is reliable.
- Browser fixtures passed on desktop (1440×900) and narrow web (390×844): two turns/one chat, draft restoration, `/new`, reload and mobile history selection; screenshots inspected and no page errors. This is web evidence, not native iOS acceptance.
- A real native command waiting 120 seconds was stopped by its task ID; the worker stopped, the turn became cancelled and continuation was disabled. No test containers remained.
- The explicit container snapshot probe passed nested capture, file/directory symlink rejection and oversized-file rejection. It mounts no credentials and uses no provider.

Reproduce ordinary fixtures with `node --test experiments/poc-conversations.test.mjs`. Run the explicit browser fixture with `node experiments/poc-ui.browser.mjs` using the installed Playwright package (or `PLAYWRIGHT_MODULE` pointing to an existing installation). Run `node experiments/poc-workspace-probe.mjs` only against the prepared disposable VM runtime. Live subscription checks remain separate from the default test suite. No image or dependency patch rebuild is required.

## Interface polish

The local web client uses a refined original brain and consistent outline icons, with no POC badge in navigation or development label in the composer. Hover/focus tooltips name icon controls, stay within the viewport and dismiss with Escape before a preview dialog closes. Attach files works by keyboard as well as pointer. The runtime requests direct conversational replies without repeating that no files were necessary. The Activity history slice below now provides turn navigation and output links; detailed tool steps remain pending.

## Activity history (2026-09-18)

The Activity panel lists all retained turns by local date, with the original request, actual stored status, latest activity/error summary and request creation time. Rows navigate to the exact turn and preserve conversation drafts. File links resolve through the originating task ID, so identically named outputs from different turns retain their own contents. The existing store provides persistence; no new event schema or inferred tool steps are introduced.

The explicit browser fixture verifies three entries across two conversations after reload, original output contents, exact-turn focus retained through an unchanged poll, and mobile panel dismissal on navigation. Detailed tool-step history remains backlog B07 work. Composer placeholder: “Message.”

### Recorded milestones and output origins

New turns persist an additive `events` array in the existing version-2 task store. Each event has a stable task/kind ID, application-owned kind and observation timestamp. API projection adds a fixed display label and excludes arbitrary fields. Terminal milestones are recorded after executor cleanup; interrupted running turns receive an interruption event during recovery. Older records remain readable without backfilled event claims.

The Activity details dialog displays these milestones and the current result/status, with a link to the exact conversation turn. It refreshes while open. File-library entries identify their originating conversation and turn time. These are local authenticated navigation actions, not publicly shareable links. Detailed command execution remains deferred; this implementation does not reactivate the Codex dependency patch.

Validation includes event deduplication/projection, restart persistence, failure and queued cancellation without fabricated completion, and browser checks for details navigation and file provenance. No live model invocation is required for these checks.

## Finding and revisiting work (2026-09-18)

The chat list now filters by title; Files filters by filename or originating conversation title and displays newest turns first. Both searches are case-insensitive, trim surrounding whitespace and show an explicit no-results state. They filter already-authorized metadata in the browser without searching file bytes or sending a model request. This is not the planned full-content search index. Filtering does not change the selected conversation or erase its draft. Unchanged chat-list polling preserves keyboard focus.

The selected conversation ID survives refresh in the same browser tab through session storage. It is validated against the authenticated conversation list before restoration. New chat and `/new` clear the saved selection; a stale ID falls back to the welcome screen. Draft text, attachments and scroll are still memory-only across chat switches and do not survive reload. This is navigation restoration, not a new provider session or credential storage path.

Browser verification covers trimmed/case-insensitive searches, no results, clearing filters, retained transcript selection, unchanged-poll focus, file provenance and selected-conversation restoration after reload.

## Composer, files and status usability (2026-09-18)

The [14-improvement usability batch](design/usability-batch.md) records the implemented composer, attachment, copy/preview, Activity-filter and connection-recovery behavior, including exact limits and verification boundaries. It adds no provider calls or dependencies and does not change alpha scope.
