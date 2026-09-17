# M0 browser viewer and takeover experiment

Date: 2026-09-17. Scope: an authenticated screenshot viewer for a synthetic counter page, entirely inside the offline container. This is not the production computer inspector, account system, remote desktop, or durable Rust supervisor.

## What was exercised

The container probe launches sandboxed Chromium with two isolated browser contexts: the target computer and the viewer. A temporary HTTP listener binds only to container loopback. No host port is published. Playwright drives the viewer as a test user; it supplies an ephemeral bearer capability through request headers, never a URL, document, screenshot, persistent file, or log.

The end-to-end fixture:

1. An admitted agent click advances the target counter to 1.
2. Clicking **Take control** fences old agent generations before waiting for active browser work to finish. Queued old-generation actions are rejected.
3. The viewer sends a coordinate click and advances the counter to 2. Agent input remains rejected during human control.
4. Clicking **Resume agent** captures a fresh target screenshot and counter observation before reopening agent dispatch under a new generation.
5. New-generation agent input advances the counter to 3. The test waits until the viewer displays that frame, then captures and visually checks the viewer screenshot.
6. Clicking **Disconnect** pauses the controller, revokes the viewer capability, clears the displayed image, and rejects further agent input. Disconnect never auto-resumes.

The separate deterministic tests exercise takeover with an active action and queued input, stale human and agent generations, failed observation, cancellation during takeover, and disconnect during resume. HTTP tests cover missing/wrong capabilities, wrong/missing Origin, wrong Host, out-of-bounds input, capability expiry, and revocation during a pending screenshot.

## Implementation boundary

`experiments/browser-control.mjs` owns the serial browser-action queue and controller generation for this disposable experiment. `viewer-server.mjs` handles the capability and loopback transport. `viewer.html` and `viewer.js` are the inspectable functional UI. Playwright remains the existing browser dependency; no viewer library or production dependency was added.

The queue admits at most 32 operations. Takeover invalidates queued automation synchronously and acknowledges human control only after the active operation settles. Cancellation/disconnect invalidate a pending resume; failed observations leave the controller paused. UI revisions prevent a late polling response from overwriting a newer control decision or screen.

Authenticated viewer requests renew a five-second lease. Silence revokes the capability and pauses the controller on the next watchdog tick, normally within 250 ms of expiry. A request arriving after the deadline cannot renew the expired capability. A late screenshot is withheld after revocation. This is event-loop-based timing, not a real-time guarantee. Only explicit pairing of a new viewer can create a new capability.

## Limits and next work

- The Node controller deliberately does not claim to be the Rust `RunControl` implementation. The next integration must put durable generation ownership in the Rust supervisor and preserve these behavioral tests against that boundary.
- The experiment gates only actions submitted through its controller. Native harnesses or arbitrary code with direct browser/process access are not mediated by this queue. Provider tool dispatch must be integrated before claiming a global takeover guarantee.
- Screenshot polling and coordinate clicks establish a narrow viewer contract. General keyboard entry, streaming video, clipboard, downloads and accessibility-tree interaction are not implemented.
- The browser image has a fixed 640 by 360 viewport. No cross-browser, mobile, remote network or multiuser qualification is claimed.
- There is no credential-entry mode or screenshot-redaction guarantee. The target contains only synthetic data. Never connect personal accounts to this experiment.
- The capability is ephemeral test authentication, not a user login or shared-agent authorization system. No host/browser onboarding or public listener exists. Expiry pauses control; process restart does not restore a session.
- Active commands must settle before takeover acknowledgement. Hung-browser recovery relies on the outer bounded probe timeout; production process-tree cancellation and crash recovery remain open.

Reproduce using the [M0 commands](README.md). The ordinary offline container probe now includes `browser_viewer_takeover`. Raw output and `viewer.png` stay under ignored `.local/m0/`.
