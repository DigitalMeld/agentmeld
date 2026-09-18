# Authenticated native browser integration

Updated: 2026-09-18. This closes the M0 authenticated browser-fixture integration gap. It does not qualify arbitrary websites, remote viewer access, real browser credentials or production browser automation.

## Architecture exercised

The existing restricted provider gateway launches Codex 0.154.0 in its credential-bearing worker. A separate, non-root, read-only browser container has no network, shared mounts, published ports or credential volume. Chromium keeps its renderer sandbox enabled. The host owns the Rust journal, browser action queue and capability-authenticated loopback viewer; none is mounted into either worker. The host forwards only a bounded dynamic tool callback, with exact thread/turn, tool, argument and one-time call-ID checks. The model cannot request controller transitions or select its own generation.

The native worker uses the already-authorized subscription store, configuration validation and native sandbox credential-open denial preflight. It exposes app-server JSONL only through Docker attachment. No host credentials directory, browser profile or Docker socket is mounted. The existing driver verifies the native worker's isolated provider network and sole auth-volume mount. Exact GPT-5.5 native catalog and thread model checks remain mandatory.

## Verified flow

1. Initial browser observation is counter 0. Real GPT-5.5 calls `browser_fixture_increment`; Rust admits and settles the click, and the browser reports 1.
2. A second real callback is held while the trusted fixture sends viewer HTTP **Takeover**. Its captured old generation cannot dispatch. The browser remains at 1 and the native callback receives a failed result.
3. The trusted fixture sends viewer HTTP coordinate input under the human generation; the counter becomes 2.
4. Viewer HTTP **Resume** obtains a fresh screenshot and counter 2 before Rust permits agent dispatch. The old generation remains rejected.
5. A third real GPT-5.5 callback advances the counter to 3. The final screenshot is saved locally; rendered inspection confirmed the visible counter and button.
6. Viewer HTTP **Disconnect** pauses control; a further attempted controller click is denied and direct browser readback remains 3.

The trusted test runner drives the human HTTP actions. This run does not claim that a person used the viewer UI or that the model visually interpreted screenshots. Earlier viewer UI coverage remains in the [viewer report](viewer-takeover.md). A 180-second fixture lease accommodates live turns; production/default viewer expiry remains five seconds.

The native turn result must complete, exactly one callback must occur per turn, and native failure/rerouting fails qualification. Callbacks from another thread, prior turn, arbitrary tool/namespace/arguments, reused call IDs or beyond the three-call fixture budget are rejected. Three new offline tests exercise those binding failures. The full local suite passes 193 tests (18 Rust, 169 Node, six Python), plus formatting, lint, build and documentation checks.

## Reproduction and evidence

```sh
node scripts/probe-provider-egress.mjs --context colima-agentmeld-m0 --browser
```

This is an explicit live subscription command. Use the existing dedicated VM, loaded named AppArmor policy, verified seccomp file and built image. The driver owns and removes its native worker, provider proxy/network and browser container. Cleanup attempts each resource even if an earlier close fails; it never removes the auth volume.

Verified image: `sha256:60f4a11cbde1f63ad82536df6ec91a80e2026e742c93c5c300cb431a7e8790f9`. The final live integration and separate default egress regression both exited successfully on this image.

Sanitized reports and the final synthetic screenshot remain under ignored `.local/m0/egress/<run-id>/`. Reports record the immutable image and booleans for each assertion, without account details, tool output, viewer capabilities or credentials. The [runtime inventory](runtime-inventory.json) records the current image; prior measurements retain their original image bindings.

## Remaining limits

The existing browser component and screenshot transport now work through live native callbacks, but broad tool grants, production user identity, owner keyboard/clipboard entry, browser login transport, downloaded files and remote viewer delivery remain unqualified. The screenshot HTTP fixture is sufficient for this M0 contract; production streaming-component selection remains open. Native shell tools remain sandboxed separately and cannot directly reach this networkless browser. This is scoped isolation evidence, not an escape certification.
