# File preview recovery

Implemented 2026-09-18. This batch improves the existing artifact and saved-workspace reader without introducing a new navigation surface.

## Behavior

1. Failed artifact loads have an in-dialog Retry action.
2. Failed workspace-file loads can be retried without closing or refreshing the workspace.
3. Retry and adjacent-file navigation retain the original task or conversation identity.
4. Closing a preview aborts its pending fetch.
5. Starting another preview aborts the superseded fetch; request-generation checks still reject late results.
6. Closing returns focus to the opening control when it is still present. Opening the source conversation does not override destination focus.
7. New previews start at the top rather than retaining the previous file's scroll position.
8. Closing releases the retained preview blob/text and rendered contents, in addition to unloading media and revoking object URLs.
9. Detached image/audio/video callbacks cannot replace the current preview or its metadata.
10. Audio and video show duration when the browser supplies finite metadata.
11. Text search and wrapping are disabled for media and binary files. The dialog has an accessible title and load failures use an alert.
12. Workspace refresh hides stale rows; a failed load no longer also claims that the folder is empty.

## Verification

- `experiments/poc-file-reading.browser.mjs`: disposable local fixtures; output and workspace failure/retry, disabled actions during pending/failed loads, close cleanup/focus, reading tools, sorting, workspace navigation, and desktop/mobile rendering.
- `experiments/poc-artifact-actions.browser.mjs`: generated media fixtures; duration, disabled text tools, media unload, plus existing artifact selection/export/navigation checks.
- 204 Node tests pass with `node --test --test-concurrency=1 experiments/*.test.mjs`; six seccomp tests pass. The concurrent run exposed an existing fixed 30 ms wait in the authentication/file fixture; that test passes individually and in the serial suite.
- JavaScript syntax and whitespace checks pass. Mobile reader screenshot inspected.
- Full `scripts/check-local.sh` stops because `cargo` is unavailable; Rust checks were not performed. No Rust, provider, container, credential or dependency changes were made.

These checks use disposable state, not retained user files or paid inference. System Files continues to represent the saved agent workspace snapshot, not arbitrary host files. Scheduling and approval execution remain outside this batch.
