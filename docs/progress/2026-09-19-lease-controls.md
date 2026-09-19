# Lease controls in the browser (issue #101)

**Date:** 2026-09-19 UTC · **Branch:** `impl/2026-09-19-lease-controls`

The lease pill was display-only. It now has contextual controls, client-only,
against the existing server endpoints — no new API surface.

## What the UI does

Under the lease pill in the header identity block, a small control row appears
with only the actions this device can legally drive:

| Lease state | This device | Controls shown |
|---|---|---|
| `agent` / `observed` | — | **Take control** |
| `pausing` | holder | **Confirm handover** |
| `human` | holder | **Release control**, **Private session** toggle |
| anything else | — | none (readout only) |

Details:

- **Two-step takeover.** Takeover cancels the live turn and revokes pending
  approvals, so the first click arms the button ("Confirm take control",
  violet primary) and the second click, within 6 s, executes. A confirm
  without a modal.
- **Fenced mutations.** Every mutation except takeover sends
  `expected_generation`; a 409 `stale_lease` re-reads the lease and tells the
  user the world moved instead of acting on stale state. Buttons disable
  ("Working…") while a mutation is in flight.
- **Heartbeat.** While this device holds a human lease, the 10 s poll loop
  sends `POST /lease/heartbeat` when the last heartbeat is older than 60 s,
  so a closed tab can't squat the computer (server TTL is 5 min).
- **Failures** surface through the existing transient notice, mirroring the
  approval-decision error pattern.

## Verified behavior (headless Firefox, real server + seeder)

- Take control → pill reads "Controlling on this device"; Release + Private
  offered; private bracket toggles on/off server-side.
- Heartbeat advances `heartbeat_at_ms` while held (observed over 75 s).
- Release → lease leaves `human`; pill drops the control claim.
- Zero page errors.

## Decisions and honest notes

- **Takeover → `human` directly when no worker turn is active.** The DB only
  uses `pausing` when a live turn needs winding down (`db.rs`
  `lease_takeover`). The ack path (pausing → human) is therefore unreachable
  in the headless harness; the UI handles it (Confirm handover) but it is
  covered by reasoning + Rust tests, not by the browser E2E. It will be
  exercised the first time a real worker turn is interrupted.
- **Resume parks in `resuming` with no worker.** Only a live worker drives
  `resuming → observed → agent`, so after release the pill reads "Resuming…"
  until a worker exists. This is the server's designed sequence, not a UI
  bug; the UI reports it honestly.
- **Private toggle placement.** The private-session bracket is a holder-only
  action, so it sits next to Release rather than in the pill tooltip.

## Repeatable E2E extension

`scripts/e2e_browser.py` grew four lease assertions (20/20 green):
take offered while Observing → arm → human pill → Release + Private offered →
release ends this device's control. Also fixed two preflight defects from the
E2E milestone: the binary pre-check ran before `cargo build` (now a
post-build sanity check), and `PWVENV` is honored from the environment.

## Screenshots

Header states at 1440×900: `lease-01-observing.png` (Take control),
`lease-02-armed.png` (Confirm take control), `lease-04-human.png`
(Release control + Private session). Kept out of the repo; inspected during
verification.
