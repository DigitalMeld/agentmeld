# Workspace browser and file usability batch

## Scope and decisions

System Files now browses the complete retained `/workspace` snapshot for each conversation, including nested directories, original inputs, intermediate files and dotfiles. It no longer substitutes finished artifacts for the filesystem. The current runtime has a separate workspace per conversation and removes each execution container after the turn. OS files outside `/workspace`, credential stores, provider session records and host files are not exposed. Live browsing of a running container and a persistent machine-wide root remain unimplemented, rather than being represented by invented files.

The browser is read-only. Downloading or previewing a file requires the existing local authentication and origin/host checks. API lookup is by exact conversation ID and validated relative path, never by a host filesystem path. Snapshots still reject symlinks, special files, traversal, excessive depth, entries and bytes. Hidden regular files are now retained; provider credentials remain outside `/workspace`.

## 25 improvements in this batch

| # | Change | Behavior |
|---|---|---|
| 1 | Complete snapshot listing | Metadata covers every retained workspace entry, not just artifacts. |
| 2 | Nested folders | Folder rows open their children. |
| 3 | Workspace selector | Switch between conversation workspaces without changing the current chat. |
| 4 | Breadcrumbs | Jump directly to any ancestor. |
| 5 | Parent navigation | A dedicated Up control returns one level. |
| 6 | Recursive search | Search finds descendant files within the current folder. |
| 7 | Hidden-file visibility | Hidden files are included by default and can be hidden. |
| 8 | Copy folder path | Copy the `/workspace` path. |
| 9 | Workspace previews | Inspect saved inputs and intermediate source/text files. |
| 10 | Workspace downloads | Download exact saved file bytes. |
| 11 | Copy file path | The preview exposes its `/workspace` path. |
| 12 | Source conversation | Return from workspace or preview to its owning conversation. |
| 13 | Refresh | Explicitly reload the saved snapshot. |
| 14 | Retry feedback | Failed loads display a recoverable error, not another workspace's files. |
| 15 | Snapshot status | Distinguish running work, latest saved capture, legacy and empty workspaces. |
| 16 | Modification times | New captures retain actual file mtimes; old unknown timestamps display an em dash. |
| 17 | Dotfile retention | Snapshot and restore support safe hidden names, preserving mtimes during restore. |
| 18 | True List view | Full-width rows replace the previous multi-column "list". |
| 19 | Category layout preferences | Every artifact category independently remembers Grid/List across navigation and reload. |
| 20 | Sort preference | Sort survives reload; malformed/unavailable storage falls back safely. |
| 21 | Last opened sort | Successful artifact previews update a bounded local recency index. |
| 22 | Menu keyboard navigation | Arrow keys, Home/End and native Enter activation work alongside Escape. |
| 23 | Raster image preview | PNG/JPEG/GIF/WebP display in a bounded preview; blob URLs are revoked on close/replacement. |
| 24 | Category-specific empty states | Empty media and artifact sections name the current category. |
| 25 | Natural folder ordering | Folders precede files and numbered names sort naturally. |

## Data and API

- `GET /api/workspace?conversation=<id>` returns title, capture time, continuation/working status and entry metadata (`name`, `directory`, `size`, `modifiedAt`). It excludes file bytes and provider data.
- `GET /api/workspace/file?conversation=<id>&name=<relative-path>` downloads one exact regular file from that saved snapshot. Unknown conversations/paths and directories return 404. Traversal and absolute paths never resolve.
- Additive store fields: `conversation.workspaceCapturedAt` and regular snapshot-entry `modifiedAt`. Existing records remain readable without migration; unknown metadata remains unknown.
- Browser preferences under `agentmeld-files` retain validated category layouts, sort and at most 100 artifact-open timestamps. File contents, credentials and workspace snapshots are not stored there.
- System Files has no editable filesystem operations. Artifact Grid/List preferences do not change the dedicated System Files table.

## Verification and remaining limits

Read-only API tests use disposable stores, including authentication, origin rejection, cross-conversation lookup, traversal rejection, exact-byte downloads and restart persistence. Browser checks cover every category's Grid/List control, Documents previews versus list rows, navigation/reload persistence, folder navigation, recursive search, hidden-file visibility, workspace download and error recovery. A disposable, network-disabled container probe checks nested/dotfile capture, timestamps, symlink rejection and quotas. It has no credential mounts and does not invoke a model.

Full filesystem access outside retained `/workspace` requires a future runtime design, not broader access to the host.

## Implementation checkpoint — September 18, 2026

- Local verification: 189 Node tests passed; both UI browser suites passed, including populated Grid/List checks for all six artifact categories and preference persistence after reload.
- Disposable container probe passed for workspace capture/restore, hidden files, modification times, symlink rejection and quotas. No provider inference was invoked.
- Rendered Documents grid/list and workspace screenshots were inspected. The local app server was restarted while idle and the browser reloaded with the updated interface.
- Documentation checks passed for 59 Markdown files. Rust checks remain unverified because Cargo is unavailable on this host.
- GitHub Actions and repository hooks were checked before publication: Actions disabled, zero workflows and zero hooks.
