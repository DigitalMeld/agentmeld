// Original outline symbols shared by navigation and file results.
const paths={
 menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
 sort:'<path d="M4 6h16M7 12h10M10 18h4"/>',
 search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
 folder:'<path d="M3 7V5h6l2 2h10v13H3ZM3 10h18"/>',
 artifacts:'<path d="m7 3 4 4-4 4-4-4ZM15 10l3-7 3 7ZM15 15h6v6h-6Z"/><circle cx="7" cy="18" r="3"/>',
 globe:'<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
 image:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1"/><path d="m3 17 6-5 4 3 4-5 4 5"/>',
 video:'<rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
 audio:'<path d="M4 9v6M8 5v14M12 3v18M16 6v12M20 9v6"/>',

 archive:'<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/>',
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
