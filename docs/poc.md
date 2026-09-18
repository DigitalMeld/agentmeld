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
4. Start another task and use **Stop** while it runs. Stop terminates the owned
   worker and verifies its stopped state.
5. Restart the local server and reopen the newly printed link. Completed results
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

One local owner and one active task. Each message starts an independent task;
this version does not yet resume a conversation or carry a previous workspace
into the next task. Up to five uploaded files, 2 MiB each and 5 MiB combined.
Top-level output files are limited to 2 MiB each and 8 MiB combined. Thirty
retained tasks maximum; no automatic deletion of user results. Ten-minute task
deadline. Uploads, text responses and results are saved under ignored
`.local/poc/state.json` with owner-only file permissions. Inputs are sent to the
configured subscription provider as needed to perform the task. Native session
history also remains in the existing dedicated provider store.

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
