# Artifact selection, export and preview improvements

September 18, 2026. This batch extends the existing artifact library without provider calls, new dependencies, data migration or file deletion. It uses original interface components and does not copy Muse assets.

## Delivered behavior

| # | Improvement | Contract |
|---|---|---|
| 1 | Selection mode | Select/Done exposes file checkboxes in every artifact category and either layout. |
| 2 | Individual selection | Keyboard-accessible checkboxes select a precise output version without opening it. |
| 3 | Select visible | Select all outputs matching the current category, search and version filter. |
| 4 | Clear selection | Clear selected items in one action; Done and category changes also clear selection. |
| 5 | Selection summary | Show selected file count and total bytes, including items hidden by subsequent search. |
| 6 | ZIP download | Fetch selected outputs through authenticated endpoints and download one archive. |
| 7 | Collision-safe exports | Separate each turn's outputs into its own archive directory; repeated names preserve original bytes. |
| 8 | File index | Download a JSON index with conversation, turn, version, name, size and creation time; include it in ZIP exports. |
| 9 | Copy paths | Copy workspace-relative paths with producing turn IDs so equal filenames remain distinguishable. |
| 10 | Export progress | Show preparation progress and prevent overlapping exports. |
| 11 | Cancel export | Abort in-flight requests without changing retained files; preserve selection when remaining in the category. |
| 12 | Export recovery | On failure, offer retry with the same selection; never download a partial archive. |
| 13 | Latest versions | Hide superseded outputs of the same name within a conversation while keeping other conversations distinct. |
| 14 | Category counts | Sidebar counts show retained outputs of each type, independent of search. |
| 15 | Clear search | Explicit clear action restores the current category and focuses its search field. |
| 16 | JSON formatting | Show indented valid JSON with a raw toggle; invalid JSON remains readable source. |
| 17 | CSV table | Parse quoted commas, escaped quotes, multiline fields and CRLF; show up to 100 data rows and 50 columns with a raw toggle. |
| 18 | Source preview | HTML, SVG and common source/configuration files display as escaped text, never executable content. |
| 19 | Audio preview | Native audio controls for browser-supported MP3, WAV, M4A and OGG; no autoplay. |
| 20 | Video preview | Native video controls for browser-supported MP4, WebM and MOV; no autoplay. |
| 21 | Preview navigation | Previous/Next and unmodified Left/Right keys move through the opened library's filtered order; show position and disable end controls. |
| 22 | Expanded preview | Expand/restore within the viewport; closing resets the size. |
| 23 | Preview metadata | Display type, bytes, text line count and decoded raster dimensions where available. |
| 24 | Media fallback | Unsupported or invalid media leaves an explicit download path; closing/replacing a preview pauses playback and revokes its object URL. |

## Boundaries

Selection is temporary browser state, not persisted user data. Search changes retain selected items and the total count makes that visible. Category changes clear selection and cancel an in-flight export. Exports are bounded to 500 selected outputs and less than 32 MiB, including archive index bytes. Fetches have timeouts and cancellation. ZIP uses the standard uncompressed store format; it does not upload data or invoke external tooling in the product. The JSON index projects only artifact metadata, excluding credentials, provider sessions and file bytes.

Media sources use local blob URLs allowed by `media-src 'self' blob:`. No new remote origin, iframe or executable content permission was added. Actual decoding depends on the user's browser codecs. CSV previews are bounded and escaped; full bytes and raw text remain available. Downloading source does not execute it. Preview navigation captures the displayed ordering when opened and does not unexpectedly reorder during polling.

System Files retains its separate read-only table and complete saved workspace scope from [the workspace browser](workspace-browser.md); this batch does not implement a live machine filesystem. Artifact versions remain separate retained outputs. The latest-only filter never deletes history.

## Verification

The disposable browser fixture covers populated categories, selection/filter transitions, ZIP round-trip bytes and file index, cancellation and error recovery, latest-version separation, formatted/raw JSON, CSV cells, source injection resistance, preview navigation, expanded layout, media failures and narrow layouts. Unit checks validate CSV quoting/bounds, version identity, metadata projection, archive path/size restrictions and ZIP interoperability using Python's standard library. Existing UI and organization browser suites remain regression checks. All fixtures avoid user files and model calls.

### Local verification checkpoint

- 193 Node tests and six seccomp tests passed.
- All three browser suites passed: existing chat/UI, existing organization/workspace, and the new artifact-actions fixture. Valid generated WAV/WebM files decoded, played and stopped on close; invalid media showed download fallback.
- Desktop selection, CSV preview and mobile selection screenshots were inspected. The running local server was restarted only after verifying no active or queued work; its existing browser tab reloaded and reported Connected.
- Documentation checks passed for 60 Markdown files. The full local script still stops at missing Cargo; Rust checks are not claimed.
- Focused review covered the complete pending code, tests and new helpers, including data projection, archive limits, escaped previews, media cleanup and cancellation. No unresolved task-introduced finding remained.
