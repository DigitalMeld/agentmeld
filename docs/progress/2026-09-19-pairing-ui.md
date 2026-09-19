# First-run pairing / onboarding UI (issue #103)

**Date:** 2026-09-19 UTC · **Branch:** `impl/2026-09-19-pairing-ui`

A bare URL with no token used to 401 and tell the user their session had
"expired". It now shows a pairing screen; an actually-expired session gets a
"Pair a new device" button on the connection banner.

## What the UI does

- **First run (no token anywhere):** a centered pairing card instead of the
  app — "Pair this browser", steps (`agentmeld-server pair` on the server,
  paste the token or full pairing link), a token/link input, a device-name
  input (default "Browser"), and a violet Pair button. No state polling runs
  until paired.
- **Token or link:** a pasted pairing link (with `?token=`) navigates to it
  and the server's 302 lands back in the app with the session token in the
  hash (existing hashchange flow). A bare token POSTs `/api/v1/pair`
  directly. Invalid/expired tokens get a plain error: single-use, 10-minute
  expiry, generate a fresh one.
- **Expired session:** the connection banner keeps its copy but gains "Pair
  a new device", which clears the dead token, stops the track module and
  the poll loop, and shows the pairing screen with "Session expired" copy.

Client-only; no new server endpoints. The existing hash/sessionStorage
token flow for paired users is untouched.

## Verification (headless Firefox, real server)

13/13 checks green: bare URL shows the pairing screen; invalid token shows
the error; valid token pairs and reaches Live; reload stays paired via
sessionStorage; dead token shows the banner + "Pair a new device"; the
re-pair screen shows the expired copy; a full pairing link lands in the app.
Zero page errors. Screenshots inspected at 1440×900 (pairing card, expired
banner).

## E2E change

`scripts/e2e_browser.py` now pairs **through the first-run UI** instead of
redeeming the token via the API — the real first-run path, same endpoint.
22/22 assertions green. (`redeem_pairing_token` removed as dead code;
approval-button locators scoped to `#approvalBar` after the pairing form's
shared `approvalBtn--approve` style started being counted.)

## Decisions and honest notes

- The pairing screen is a full overlay, not a route: the app is a single
  page and the unpaired state is transient. The poll loop and SSE track
  module don't start until a token exists.
- Device name defaults to "Browser" — good enough for the alpha; a device
  list UI (survey gap #4) is the place to rename/manage later.
- The expired-banner copy ("Reopen the current app link…") is kept: the
  link flow still works, and the new button is the primary path.
