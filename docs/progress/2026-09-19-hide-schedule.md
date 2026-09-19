# Hide the dead Schedule tab (issue #109)

**Date:** 2026-09-19 UTC · **Branch:** `impl/2026-09-19-hide-schedule`

The inspector's Schedule tab was a dead placeholder ("Scheduling is not
connected yet."). There is no scheduling backend, and building one is a
large project far beyond MVP scope.

## Decision

Hide the tab for the alpha. Dead UI ships nothing; the tab returns when
scheduling is real. No backend changes, no migration — the tab button and
panel were removed from `index.html`; the tab-switching code in `app.js`
is fully generic (`[data-inspector-tab]`) and needed no changes.

## Verification

- Headless-Firefox check: inspector shows Activity and Approvals only, no
  Schedule tab or panel; arrow-key/Home/End tab navigation still works;
  zero page errors.
