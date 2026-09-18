// Original outline symbols shared by navigation and file results.
const paths={
 chat:'<path d="M20 11.5a8 8 0 0 1-8 8c-1.3 0-2.5-.3-3.6-.8L4 20l1.3-4.4A8 8 0 1 1 20 11.5Z"/>',
 files:'<path d="M9 3h7l4 4v13a1 1 0 0 1-1 1H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M16 3v5h4M4 7H3v12a2 2 0 0 0 2 2M10 12h7M10 16h5"/>',
 file:'<path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM15 3v5h4M8 12h8M8 16h6"/>',
 activity:'<path d="M9 5h11M9 12h11M9 19h11M3 5h1M3 12h1M3 19h1"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',
 send:'<path d="M12 19V5m-6 6 6-6 6 6"/>',
 close:'<path d="m6 6 12 12M18 6 6 18"/>',
 download:'<path d="M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4"/>',
};
export const icon=name=>`<svg class="outlineIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]||paths.file}</svg>`;
for(const el of document.querySelectorAll('[data-icon]'))el.innerHTML=icon(el.dataset.icon);
