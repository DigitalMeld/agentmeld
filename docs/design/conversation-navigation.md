# Conversation discovery and activity navigation

September 18, 2026. This batch works with the existing authenticated local state. It does not add provider calls, a new search service, persistent drafts or new stored data.

## 24 improvements

| # | Improvement | Behavior |
|---|---|---|
| 1 | Search messages across chats | Chat search matches titles, requests, replies and output filenames within the active/archive list. |
| 2 | Search excerpts | A matching text excerpt explains why a conversation appears. |
| 3 | Search result count | Shows the number of matching conversations, not message occurrences. |
| 4 | Clear chat search | Explicit Clear restores the list and returns keyboard focus to search. |
| 5 | Find within a conversation | A compact Find bar searches rendered message text in the selected chat. |
| 6 | Match highlighting | Escaped text matches are highlighted without interpreting user text as HTML or a regular expression. |
| 7 | Match navigation | Previous/Next, match position, wrapping and explicit no-results feedback. |
| 8 | Find shortcuts | Cmd/Ctrl+F opens conversation search; Enter/Shift+Enter navigate; Escape closes and clears highlights. |
| 9 | Copy request | Copy the original request independently of its reply or attachments. |
| 10 | Use request | Append a prior request to the current editable draft, preserving existing draft text and attachments; never submit automatically. Length/pending checks leave the draft unchanged on rejection. |
| 11 | Readable reply formatting | Headings, paragraphs, ordered/unordered lists, quotes, inline code, fenced code and tables render from escaped Markdown. |
| 12 | Copy code | Fenced blocks have an explicit Copy code action that copies their original code text. |
| 13 | Activity status controls | Compact All/Active/Attention/Done controls replace the native dropdown and expose pressed state. |
| 14 | Current-chat activity | Optional This chat scope filters runs to the selected conversation. |
| 15 | Output-bearing runs | With files filters activity to runs with retained outputs. |
| 16 | Activity order | Toggle newest/oldest without changing run state. |
| 17 | Activity count | Show the number of runs matching the combined filters. |
| 18 | Search activity results | Search matches request, reply, status summary/error, conversation title and output filename. |
| 19 | Recorded execution duration | Completed run duration derives from recorded start/end milestones; unavailable history is explicitly unknown. |
| 20 | Milestone intervals | Run details show time since the previous recorded milestone, without inventing native tool events. |
| 21 | Run file access | Inputs and outputs are directly accessible from run details through existing authenticated retrieval. |
| 22 | Inspect a run reply | Expand the retained reply alongside its milestones; each transcript turn also links directly to its run details. |
| 23 | Export/copy run information | Export an allowlisted JSON record or copy a concise request/status/duration summary. |
| 24 | Adjacent run navigation | Previous/Next moves through the current activity filter and order; position and boundary controls stay explicit. |

## Scope, persistence and privacy

All searches use already-authorized client data. They do not search file bytes, private provider records, host files or a separate content index. Within-conversation search matches individual rendered text nodes; a phrase spanning Markdown formatting boundaries may not match. Changing the conversation clears its Find bar. Active/archive search boundaries and existing pin/recent ordering remain intact.

Use request only appends request text, not original attachments. It preserves the active draft and requires a separate Send action. It refuses unavailable/pending chats and over-limit drafts. Copy actions write to the clipboard only on explicit action. Test clipboard writes use a stub, never the user's clipboard.

The Markdown renderer intentionally supports a small escaped subset. Raw HTML, executable embeds and active links are not supported. Code blocks preserve their contents. No third-party rendering package is introduced.

Timing is based on recorded application milestones, not model token latency or inferred command traces. Missing, invalid or backwards endpoints remain unknown. Run export includes public prompt/reply, status, timestamp, milestone labels/times and input/output metadata. It excludes bytes, credentials, request keys, provider session references and workspace snapshots. It is an inspection export, not a restorable backup.

No storage schema migration is required. Search/filter/navigation state remains browser-memory-only. Existing artifact and workspace behavior remains described in [artifact actions](artifact-actions.md) and [workspace browsing](workspace-browser.md).

## Verification

Disposable unit/browser fixtures cover search isolation and filters, excerpts, escaped highlighting, keyboard navigation, draft-preserving request reuse, clipboard payloads, escaped Markdown/code, activity scope/order, recorded timing, run export field projection and mobile layouts. Existing chat, organization/workspace and artifact browser fixtures remain regression coverage. Tests do not invoke a provider or read user files.

### Local verification checkpoint

- 198 Node tests and six seccomp checks passed. All four browser suites passed: chat/UI, organization/workspace, artifact actions, and conversation navigation.
- Browser checks verified draft text and attachment preservation, over-limit rejection without submission, clipboard payloads through a stub, transcript navigation, source escaping, filtering, export metadata and mobile containment. Unicode and literal-punctuation matching have focused regression checks.
- Desktop Find, mobile Activity and run-detail screenshots were inspected. The local server was restarted only after verifying no active/queued runs, and the existing app tab reported Connected with the new controls.
- Documentation checks passed for 61 Markdown files. Cargo remains unavailable, so Rust checks are not claimed. No model inference was used.
- Focused review covered the pending diff and new modules/tests, including escaping, data projection, event timing and draft protection; no unresolved task-introduced finding remained. GitHub Actions is disabled, with no workflows or repository hooks.

## Request-action refinement

Owner feedback supersedes items 9–10 above: Copy request and Run details now use compact original outline icons with hover/focus tooltips and accessible names. The redundant Use request action and its draft-appending handler have been removed. Copy request continues to copy the original prompt; reusing that text can be done explicitly by pasting into the composer.
