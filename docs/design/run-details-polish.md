# Run details and quieter activity

Implemented 2026-09-18. The footer now reads only **Codex subscription**, preserving the provider/subscription cue.

Additional improvements:

1. Run copy/export actions use compact outline icons instead of a row of text buttons.
2. Toolbar and previous/next actions expose descriptive hover/focus tooltips and accessible names.
3. Details opened from a chat navigate only that conversation, in chronological order, independently of Activity search. Details opened from Activity preserve its search and newest-first order.
4. Run position changes are announced through a polite status region.
5. The dialog heading identifies the conversation, truncates long names and retains the full title on hover.
6. Request content has a heading and preserves line breaks and long-word wrapping.
7. Closing details restores focus to its source control; Open conversation instead focuses the destination turn.
8. Opening details starts at the top rather than inheriting a previously inspected run's scroll position.
9. Activity uses Today and Yesterday date headings when applicable, with dated headings for older work.
10. Activity omits conversation titles identical to the request and hides zero-input/zero-output metadata.
11. Repeated status-only summaries, including Stopped, are omitted while error text remains visible.
12. The details date row no longer repeats the conversation title already shown in the heading.

No new filters, storage, schema or execution behavior. Timing remains based on recorded events. Existing copy/export data is unchanged.

Verification: existing Activity and conversation-navigation browser fixtures now assert footer text, reduced metadata, relative headings, icon controls, run-position accessibility, conversation-scoped navigation despite a nonmatching Activity search, and return focus. Desktop/mobile renders inspected. The Node suite, docs and syntax/diff checks remain the local verification baseline; Cargo is unavailable for Rust checks.
