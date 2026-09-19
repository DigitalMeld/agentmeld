# Reply streaming: incremental delta rendering (issue #113)

## What changed

`run.answer_delta` already flowed worker → seam → journal → SSE, but the
client treated it as a generic `run.*` event: `queueRefresh()` → throttled
full `refresh()` → whole-conversation re-render (markdown + syntax
highlight) every 750ms while the reply streamed. Now the client paints
deltas incrementally.

- `apps/poc/public/client-track.js`: `handleEvent` routes `run.answer_delta`
  to a new `ctx.onDelta(runId, text)` and returns early — no `queueRefresh`
  for deltas. Falls back to `queueRefresh()` if `onDelta` is absent.
  Terminal run events still take the authoritative full-refresh path, so the
  server stays the source of truth.
- `apps/poc/public/app.js`: new `appendReplyDelta(runId, text)` —
  optimistically appends to `task.answer` and repaints only that turn's
  `.message.assistant` via `markdown()`, rAF-throttled across bursts. First
  delta (no bubble yet) does one `refresh()` to materialize the turn; a turn
  that isn't on screen is left for the next render. Bottom-follow mirrors
  `render()`: follows only when already within 100px of the bottom, never
  yanks a reader who scrolled up.
- `crates/agentmeld-server/src/bin/emit_delta.rs`: test helper that appends
  `run.answer_delta` events through the real `Db::apply_worker_events` path
  (creates the response message on first use, uses the run's live
  generation). Used by the E2E to stream synthetic deltas over the live SSE
  connection.

## Verification

- E2E `scripts/e2e_browser.py`: **44/44** headless-Firefox assertions green,
  including the new streaming block: turn on screen → emit delta →
  reply bubble materializes → two more deltas stream the text in.
- Incremental proof: the client runs a pre-existing 1Hz `/api/state`
  baseline poll, so attribution is by fetch grid — a delta-triggered refresh
  would land off-grid and split a ~1000ms interval into short gaps. The
  E2E asserts at most 2 gaps < 800ms across the whole delta window (one
  off-grid refresh, the expected first-delta materialization, makes at most
  2). With the old `queueRefresh` path, the throttled refreshes would have
  produced 3+ off-grid gaps.
- Screenshot: `docs/progress/2026-09-19-reply-streaming.png` — streamed
  markdown (heading, bold, code span, bullets) rendered in the reply bubble.
- `sh scripts/check-local.sh`: green (run before push).

## Notes / traps for the next agent

- `agentmeld-server serve` takes `--dir`, not `--state-dir` — unknown flags
  are silently ignored, so a wrong flag means the server boots against the
  default state dir while your tooling talks to another. (The E2E uses
  `--dir`.)
- `serve` marks in-flight runs `interrupted` at every boot
  (`mark_interrupted_on_startup`); the E2E seeds AFTER boot so the demo runs
  stay live. `emit_delta` gets a 409 "run is not active" on interrupted or
  `waiting_approval` runs — that is correct server behavior, pick a live run.
- `app.js` is a module (`type="module"`): its top-level `let` bindings are
  not reachable from `page.evaluate`. The E2E pauses nothing; it measures
  around the 1Hz poll instead.
