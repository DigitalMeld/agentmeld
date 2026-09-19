# Repeatable headless-browser E2E — 2026-09-19

Issue #99. `scripts/e2e_browser.py`: seed → serve → pair → drive → assert,
in one command, against a disposable state dir on loopback. 16/16 assertions
green twice in a row on 2026-09-19 UTC (headless Firefox, 1440×900).

## What it does

1. Builds `agentmeld-server` + `seed_client_track` (`cargo build --locked`).
2. Creates a disposable state dir (`mkdtemp`, removed afterwards unless `--keep`).
3. Starts the real Rust service on 127.0.0.1 (first free port from 8473).
4. **Seeds after boot** (see below), mints a pairing token via the `pair` CLI,
   redeems it via `POST /api/v1/pair`.
5. Drives headless Firefox to `/#<session>` and asserts: Roboto first in body
   font-family; Approve button computes to `rgb(139, 92, 246)`; a pending
   approval prompt appears and Approve dismisses it (buttons gone +
   "Approved." notice); lease pill reads Observing; stream reads Live;
   run-details dialog shows `read_file` Done and `run_query` Running; after
   reload the dialog still shows both steps and a `GET …/tool_steps`
   hydration request is observed; zero console/page errors; zero non-loopback
   requests.
6. Fails loudly: non-zero exit plus a per-assertion PASS/FAIL report. A crashed
   drive is recorded as a failed assertion, not a traceback, and the server
   is always torn down.

## Decisions

- **Seed after boot, not before.** `recover_approvals_on_startup`
  deliberately revokes any pending approval predating the boot (reason
  `service_restart` — a restarted service never resumes a turn mid-approval).
  That is a safety semantic, not a bug; the first version of this script
  seeded first and the prompt never appeared. Seeding post-boot keeps the
  demo approval pending, exactly as a live worker proposing mid-turn would.
- **The script exercises the approval poll path, not the SSE
  `approval.proposed` path.** Direct DB seeding writes no journal events, so
  the prompt arrives via the client's approval poll. The SSE proposal path is
  covered by the Rust seam tests and the deterministic harness.
- **Waits poll from Python, not `page.wait_for_function`.** The page CSP
  (`script-src 'self'`, no `unsafe-eval`) blocks Playwright's injected
  polling predicate, so string-eval waits throw/flake. `text_content` and
  locator counts do not eval and are used instead.
- **Harness CSP noise is filtered, not counted.** Playwright's own
  `evaluate()` calls trip the page CSP and log from a `debugger eval code`
  frame; those lines are excluded from the error assertions. The app ships no
  eval of its own — the CSP doing its job is the point.
- **Playwright lives in `/tmp/pwvenv`.** The script re-execs under it when
  `playwright.sync_api` is not importable, so `python3 scripts/e2e_browser.py`
  just works on this VM. That venv path is environment-specific; on another
  machine, point `PWVENV` at a venv with `playwright` + `playwright install
  firefox` installed. (Compare the `~/.cargo/bin` PATH note in `~/AGENTS.md`:
  same class of environment quirk, documented at the call site.)
- **Not wired into `scripts/check-local.sh`.** The E2E needs a headed-capable
  Firefox + Playwright; the standard gate stays dependency-free. Run it
  explicitly before client-facing milestones.

## Preflight

- Rust toolchain on PATH (`~/.cargo/bin` on this VM).
- `/tmp/pwvenv` with `playwright` (or set `PWVENV`); `playwright install firefox`.
- Nothing else: no containers, no paid models, no real Codex, no user files.

## Verification

- `python3 scripts/e2e_browser.py` → 16/16, exit 0, twice.
- `sh scripts/check-local.sh` → exit 0 (85 Rust tests, 207 Node tests,
  90 Markdown files validated).
