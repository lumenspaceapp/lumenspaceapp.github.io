/* Which parts of Lumen are switched on.
   pages: the Notion-style pages, editor, templates, favorites and trash.
   They are off for now (Lumen runs as a Bitrix24-style team workspace). Nothing is deleted while
   they're off: set pages to true and every page comes back. */
window.FEATURES = { pages: false };
if (typeof document !== "undefined") document.documentElement.classList.toggle("no-pages", !window.FEATURES.pages);
