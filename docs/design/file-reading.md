# File reading and workspace navigation

Implemented in the existing local web client. This batch improves reading retained outputs and browsing saved workspace snapshots; it adds no file editing, host access, provider calls, or executable HTML previews.

## Delivered behavior

1. Find text inside the open file preview, separately from library filename search.
2. Case-insensitive literal highlighting, including punctuation, without interpreting search as regular expressions.
3. Previous/next match buttons with a visible current/total count.
4. Enter and Shift+Enter move between matches while typing in file search.
5. Cmd/Ctrl+F opens search inside the current preview.
6. Escape closes file search before closing the preview.
7. No-match feedback disables match navigation; highlighting is capped at 500 matches and reports the limit.
8. Wrap lines switches between wrapped reading and horizontal source scrolling.
9. Wrap preference survives closing files and reloading the app.
10. Text metadata shows line, whitespace-delimited word, and Unicode code-point character counts for original file text.
11. Copy filename copies the basename; the existing path and original-text copy actions remain separate.
12. Truncated preview headings expose the full filename through their title.
13. Invalid JSON shows an explicit notice and the unchanged original source.
14. Empty text files have an explicit empty state and zero counts.
15. File loading appears immediately in the dialog and exposes its busy state to assistive technology.
16. Copy, download, origin and navigation controls are disabled while fetching, so stale bytes cannot be mistaken for the requested file; failures keep them disabled and explain retry.
17. Artifact fetches have an eight-second timeout, matching workspace fetches. Closing a pending preview invalidates its eventual response; it cannot reopen the dialog.
18. System Files sorts by Name, Type, Last modified or Size, with repeat clicks reversing direction. Unknown modification dates sort as zero; missing sizes as zero.
19. Folders remain first in both sort directions; names sort naturally and table headers expose their sort state.
20. Hidden-file visibility is remembered locally, with storage failures falling back safely.
21. Workspace summaries distinguish folders and files, show bytes, and name the searched workspace path when filtering. Choosing another workspace clears the old query.
22. Workspace selection supports Arrow Up/Down and Home/End, with visible focus; existing Escape dismissal remains available.
23. Workspace file previews support previous/next navigation in the captured visible order, skipping directories and preserving the selected workspace.
24. Preview downloads remain visible below a separately scrolling body on narrow screens. Keyboard focus stays inside the preview after file navigation, including when the initiating navigation button is temporarily disabled.

## Boundaries

Search inspects rendered text nodes, excluding copy buttons and explanatory hints. It never executes file content, changes retained bytes, or changes the content copied/downloaded. Formatted CSV searches only the displayed bounded preview; raw mode exposes original text. Formatted text split across different DOM nodes is searched per node. Source/formatted changes recompute matches; opening another file clears the previous query. Unicode character counts are code points, not grapheme clusters; word counts use whitespace and are not a linguistic tokenizer.

Workspace navigation is scoped to the same authenticated snapshot API and exact filenames as before. Sorting and display preferences never modify snapshots or artifacts. No migrations, new dependencies, authentication changes, or external services were introduced. The server static allowlist adds only the new preview-reader module.

## Verification

Disposable browser fixtures cover literal and bounded search, match controls, keyboard navigation, original clipboard data, wrap persistence, empty/invalid text, sortable workspace headings, folder priority, hidden-file persistence, file navigation, loading/failure controls, late-response dismissal, and narrow layouts. Existing artifact and organization fixtures verify ZIP exports, immutable originals, version switching, media decoding and cleanup, escaped HTML, and workspace boundaries. Unit checks cover natural sorting, direction, folder priority, mixed-newline and Unicode text counts. Screenshots use synthetic content only.

Local verification checkpoint: 202 Node tests, six seccomp tests, and all four browser suites (file reading, artifact actions, organization, general UI) passed. Desktop/mobile rendered previews were inspected, including the pinned download footer. JavaScript syntax and 62-file Markdown validation passed. The full local script still stops at missing Cargo; Rust checks are not claimed. The running service was restarted only after an authenticated idle-state check; all 10 retained turns remained available and the refreshed app showed Connected and the new preview controls.
