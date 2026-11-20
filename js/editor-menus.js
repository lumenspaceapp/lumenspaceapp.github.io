/* Editor menus: slash commands, block menu, formatting toolbar, mentions, code highlighting */
(function () {
  const { h, icon, esc } = UI;
  const COLORS = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];
  const HEX = { gray: "#787774", brown: "#9f6b53", orange: "#d9730d", yellow: "#cb912f", green: "#448361", blue: "#337ea9", purple: "#9065b0", pink: "#c14c8a", red: "#d44c47" };
  const BGHEX = { gray: "rgba(140,140,140,.22)", brown: "rgba(159,107,83,.22)", orange: "rgba(217,115,13,.22)", yellow: "rgba(223,171,1,.28)", green: "rgba(68,131,97,.22)", blue: "rgba(51,126,169,.22)", purple: "rgba(144,101,176,.22)", pink: "rgba(193,76,138,.22)", red: "rgba(212,76,71,.22)" };

  const ITEMS = [
    { sec: "Basic blocks", t: "Text", d: "Just start writing with plain text.", ic: "Aa", type: "p", k: "paragraph plain" },
    { t: "Heading 1", d: "Big section heading.", ic: "H1", type: "h1", k: "title #" },
    { t: "Heading 2", d: "Medium section heading.", ic: "H2", type: "h2", k: "subtitle ##" },
    { t: "Heading 3", d: "Small section heading.", ic: "H3", type: "h3", k: "###" },
    { t: "To-do list", d: "Track tasks with a to-do list.", ic: "☑️", type: "todo", k: "checkbox task check" },
    { t: "Bulleted list", d: "Create a simple bulleted list.", ic: "•", type: "bullet", k: "unordered ul -" },
    { t: "Numbered list", d: "Create a list with numbering.", ic: "1.", type: "numbered", k: "ordered ol" },
    { t: "Toggle list", d: "Toggles can hide and show content.", ic: "▸", type: "toggle", k: "collapse details" },
    { t: "Quote", d: "Capture a quote.", ic: "❝", type: "quote", k: "blockquote" },
    { t: "Callout", d: "Make writing stand out.", ic: "💡", type: "callout", k: "note info tip" },
    { t: "Divider", d: "Visually divide blocks.", ic: "—", type: "divider", k: "hr line separator" },
    { t: "Code", d: "Capture a code snippet.", ic: "</>", type: "code", k: "snippet pre" },
    { sec: "Media & pages", t: "Image", d: "Upload or embed with a link.", ic: "🖼️", type: "image", k: "picture photo" },
    { t: "Page", d: "Embed a sub-page inside this page.", ic: "📄", type: "page", k: "subpage new" },
    { t: "Mention a page", d: "Link to another page inline.", ic: "↗", action: "mention", k: "link @" },
    { t: "Date", d: "Insert today's date.", ic: "📅", action: "date", k: "today now time" },
    { sec: "Databases", t: "Table", d: "Database with a table view.", ic: "▦", type: "database", view: "table", k: "database grid spreadsheet" },
    { t: "Board", d: "Kanban board grouped by status.", ic: "▥", type: "database", view: "board", k: "kanban database" },
    { t: "Gallery", d: "Cards in a grid.", ic: "▣", type: "database", view: "gallery", k: "cards database" },
  ];

  /* ---------- slash menu ---------- */
  let slash = null;
  function score(it, q) {
    if (!q) return 1; q = q.toLowerCase();
    const s = (it.t + " " + it.k).toLowerCase();
    if (it.t.toLowerCase().startsWith(q)) return 3;
    if (s.includes(q)) return 2;
    let i = 0; for (const c of s) if (c === q[i]) i++; return i === q.length ? 1 : 0;
  }
  function openSlash(el, b, fromButton) {
    if (fromButton) { el.textContent = "/"; Editor.setCaret(el, "end"); b.text = "/"; }
    const start = Editor.caretOffset(el) - 1;
    slash = { el, b, start, hl: 0, list: [], api: null };
    drawSlash("");
  }
  function drawSlash(q) {
    const list = ITEMS.map(it => ({ it, s: score(it, q) })).filter(x => x.s > 0).sort((a, b) => (q ? b.s - a.s : 0)).map(x => x.it);
    slash.list = list; slash.hl = Math.min(slash.hl, Math.max(0, list.length - 1));
    const wrap = h("div", { style: { width: "320px" } });
    if (!list.length) wrap.append(h("div", { class: "menu-empty", text: "No results" }));
    list.forEach((it, i) => {
      if (it.sec && !q) wrap.append(h("div", { class: "menu-sec", text: it.sec }));
      const btn = h("button", { class: "mi" + (i === slash.hl ? " hl" : ""), dataset: { i } },
        h("span", { class: "mi-ic", text: it.ic }), h("span", null, h("div", { class: "mi-t", text: it.t }), h("div", { class: "mi-d", text: it.d })));
      btn.addEventListener("mousedown", e => { e.preventDefault(); pick(it); });
      btn.addEventListener("mousemove", () => { if (slash.hl !== i) { slash.hl = i; highlightRow(); } });
      wrap.append(btn);
    });
    const s = getSelection(); const rect = s.rangeCount ? s.getRangeAt(0).getBoundingClientRect() : slash.el.getBoundingClientRect();
    const anchor = rect.width || rect.height ? rect : slash.el.getBoundingClientRect();
    if (slash.api && !slash.api.closed) { slash.api.el.innerHTML = ""; slash.api.el.append(wrap); slash.api.reposition(anchor); }
    else slash.api = UI.popover(anchor, wrap, { onClose: () => (slash = null) });
  }
  function highlightRow() {
    slash.api.el.querySelectorAll(".mi").forEach((x, i) => x.classList.toggle("hl", i === slash.hl));
    slash.api.el.querySelector(".mi.hl")?.scrollIntoView({ block: "nearest" });
  }
  function slashInput(el, b, e) {
    if (!slash && e.data === "/") return openSlash(el, b);
    if (!slash || slash.el !== el) return;
    const off = Editor.caretOffset(el), txt = el.textContent;
    if (off <= slash.start || txt[slash.start] !== "/") return slash.api.close();
    const q = txt.slice(slash.start + 1, off);
    if (/\s\s/.test(q) || q.length > 24) return slash.api.close();
    slash.hl = 0; drawSlash(q);
    if (!slash.list.length && q.length > 3) slash.api.close();
  }
  function slashKey(e) {
    if (!slash) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); slash.hl = (slash.hl + (e.key === "ArrowDown" ? 1 : -1) + slash.list.length) % slash.list.length; highlightRow(); return true; }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); slash.list[slash.hl] ? pick(slash.list[slash.hl]) : slash.api.close(); return true; }
    if (e.key === "Escape") { e.preventDefault(); slash.api.close(); return true; }
    return false;
  }
  function removeQuery() {
    const { el, start } = slash; const end = Editor.caretOffset(el);
    Editor.setCaret(el, start); const s = getSelection(); const r = s.getRangeAt(0);
    const endPos = posAt(el, end); if (endPos) r.setEnd(endPos.node, endPos.off);
    r.deleteContents(); slash.b.text = el.innerHTML.replace(/^<br>$/, "");
  }
  function posAt(el, n) { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node; while ((node = w.nextNode())) { if (n <= node.length) return { node, off: n }; n -= node.length; } }
  function pick(it) {
    const { b, el } = slash; removeQuery(); const api = slash.api; slash = null; api.close();
    const empty = !el.textContent.trim();
    const page = Editor.page;
    if (it.action === "date") { document.execCommand("insertHTML", false, `<span class="mention">📅 ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>&nbsp;`); return; }
    if (it.action === "mention") {
      const s = getSelection(); const range = s.getRangeAt(0).cloneRange();
      return pagePicker(range.getBoundingClientRect(), p => {
        el.focus(); s.removeAllRanges(); s.addRange(range);
        document.execCommand("insertHTML", false, `<a class="mention" data-page="${p.id}" contenteditable="false">${esc(p.icon || "📄")} ${esc(p.title || "Untitled")}</a>&nbsp;`);
      });
    }
    let extra = {};
    if (it.type === "database") { extra.db = Store.newDb(it.view); extra.db.view = it.view; extra.db.title = it.view === "board" ? "Board" : it.view === "gallery" ? "Gallery" : "Table"; }
    if (it.type === "page") { const sp = Store.createPage(page.id); extra.pageId = sp.id; UI.toast("Sub-page created"); }
    let target = b;
    if (empty) Editor.turnInto(b.id, it.type, extra);
    else { target = Editor.insertAfter(b.id, it.type, extra); Editor.render(); }
    if (!Editor.TEXT.has(it.type)) {
      if (it.type === "page") return App.go(extra.pageId);
      const nb = Editor.insertAfter(target.id); Editor.render(); if (it.type !== "image") Editor.focus(nb.id, "start");
    } else Editor.focus(target.id, empty ? "start" : "end");
  }

  /* ---------- page picker ---------- */
  function pagePicker(anchor, onPick) {
    const inp = h("input", { class: "menu-input", placeholder: "Search pages…" });
    const list = h("div");
    const draw = () => {
      list.innerHTML = ""; const q = inp.value.toLowerCase();
      Object.values(Store.state.pages).filter(p => !p.deleted && (p.title || "untitled").toLowerCase().includes(q)).slice(0, 12)
        .forEach(p => list.append(h("button", { class: "mi compact", onclick: () => { api.close(); onPick(p); } }, h("span", { class: "mi-ic", text: p.icon || "📄" }), h("span", { class: "mi-t", text: p.title || "Untitled" }))));
      if (!list.children.length) list.append(h("div", { class: "menu-empty", text: "No pages found" }));
    };
    inp.addEventListener("input", draw);
    inp.addEventListener("keydown", e => { if (e.key === "Enter") list.querySelector(".mi")?.click(); });
    draw();
    const api = UI.popover(anchor, h("div", { style: { width: "280px" } }, inp, list));
    setTimeout(() => inp.focus());
  }

  /* ---------- block menu ---------- */
  const TURN = [["p", "Text"], ["h1", "Heading 1"], ["h2", "Heading 2"], ["h3", "Heading 3"], ["todo", "To-do list"], ["bullet", "Bulleted list"], ["numbered", "Numbered list"], ["toggle", "Toggle list"], ["quote", "Quote"], ["callout", "Callout"], ["code", "Code"]];
  function blockMenu(b, anchor, w) {
    w.classList.add("menu-open");
    const close = () => w.classList.remove("menu-open");
    UI.menu(anchor, [
      { label: "Delete", icon: "trash", kbd: "Del", onClick: () => Editor.remove(b.id, true) },
      { label: "Duplicate", icon: "copy", kbd: "Ctrl D", onClick: () => duplicate(b) },
      Editor.TEXT.has(b.type) ? { label: "Turn into", icon: "turn", onClick: () => turnMenu(b, anchor) } : null,
      { label: "Color", icon: "color", onClick: () => colorMenu(b, anchor) },
      { label: "Copy text", icon: "copy", onClick: () => { navigator.clipboard?.writeText(Store.plainText(b.text)); UI.toast("Copied to clipboard"); } },
      { sep: true },
      { label: "Move up", icon: "arrow", kbd: "Ctrl ⇧ ↑", onClick: () => move(b, -1) },
      { label: "Move down", icon: "arrow", kbd: "Ctrl ⇧ ↓", onClick: () => move(b, 1) },
    ], { onClose: close });
  }
  function turnMenu(b, anchor) {
    UI.menu(anchor, [{ section: "Turn into" }, ...TURN.map(([t, l]) => ({ label: l, iconHtml: `<span class="sw" style="border:0">${ITEMS.find(x => x.type === t)?.ic || ""}</span>`, kbd: b.type === t ? "✓" : "", onClick: () => { Editor.turnInto(b.id, t); Editor.focus(b.id); } }))]);
  }
  function colorMenu(b, anchor) {
    const items = [{ section: "Text color" }];
    COLORS.forEach(c => items.push({ label: c[0].toUpperCase() + c.slice(1), iconHtml: `<span class="sw" data-color="${c}">A</span>`, kbd: (b.color || "default") === c ? "✓" : "", onClick: () => { b.color = c === "default" ? "" : c; Store.touch(Editor.page.id); Editor.render(); } }));
    items.push({ section: "Background" });
    COLORS.forEach(c => items.push({ label: c[0].toUpperCase() + c.slice(1) + " background", iconHtml: `<span class="sw" style="background:var(--bg-${c})"></span>`, kbd: (b.bg || "default") === c ? "✓" : "", onClick: () => { b.bg = c === "default" ? "" : c; Store.touch(Editor.page.id); Editor.render(); } }));
    UI.menu(anchor, items);
  }
  function move(b, d) {
    const p = Editor.page, i = Editor.idx(b.id), j = i + d; if (j < 0 || j >= p.blocks.length) return;
    [p.blocks[i], p.blocks[j]] = [p.blocks[j], p.blocks[i]]; Editor.markNew(b.id); Store.touch(p.id); Editor.render();
  }
  function duplicate(b) {
    const c = JSON.parse(JSON.stringify(b)); c.id = Store.uid();
    const p = Editor.page; p.blocks.splice(Editor.idx(b.id) + 1, 0, c); Editor.markNew(c.id); Store.touch(p.id); Editor.render();
    Editor.TEXT.has(c.type) && Editor.focus(c.id);
  }
  const inlineCode = () => { const s = getSelection(); if (s.isCollapsed) return; document.execCommand("insertHTML", false, `<code>${esc(s.toString())}</code>`); };

  /* ---------- formatting toolbar ---------- */
  let bar, savedRange, barTimer;
  function showBar() {
    const s = getSelection();
    if (!s.rangeCount || s.isCollapsed) return hideBar();
    const node = s.anchorNode?.parentElement?.closest?.(".block-content");
    if (!node || node.closest(".t-code") || node.contentEditable === "false" || !document.getElementById("view").contains(node)) return hideBar();
    const r = s.getRangeAt(0).getBoundingClientRect(); if (!r.width) return hideBar();
    savedRange = s.getRangeAt(0).cloneRange();
    if (!bar) {
      bar = h("div", { class: "fmt-bar glass-strong" });
      bar.addEventListener("mousedown", e => { if (e.target.tagName !== "INPUT") e.preventDefault(); });
      document.getElementById("layer").append(bar);
    }
    drawBar();
    const x = Math.max(10, Math.min(r.left + r.width / 2 - bar.offsetWidth / 2, innerWidth - bar.offsetWidth - 10));
    bar.style.left = x + "px"; bar.style.top = Math.max(10, r.top - bar.offsetHeight - 8) + "px";
  }
  function drawBar() {
    const st = c => document.queryCommandState(c) ? " on" : "";
    bar.innerHTML = "";
    const B = (html, title, fn, cls = "") => bar.append(h("button", { class: cls, title, html, onclick: fn }));
    B("<b>B</b>", "Bold (Ctrl B)", () => exec("bold"), st("bold"));
    B("<i>I</i>", "Italic (Ctrl I)", () => exec("italic"), st("italic"));
    B("<u>U</u>", "Underline (Ctrl U)", () => exec("underline"), st("underline"));
    B("<s>S</s>", "Strikethrough", () => exec("strikeThrough"), st("strikeThrough"));
    B('<span style="font-family:var(--mono);font-size:12px">&lt;/&gt;</span>', "Inline code (Ctrl E)", () => { inlineCode(); hideBar(); });
    bar.append(h("span", { class: "sep" }));
    B(icon("link") + "&nbsp;Link", "Link", linkMode);
    B('<span style="text-decoration:underline;text-decoration-color:var(--accent);text-decoration-thickness:3px">A</span> ▾', "Color", e => fmtColor(e.currentTarget));
    B("↗", "Mention page", () => { const r = savedRange; hideBar(); pagePicker(r.getBoundingClientRect(), p => { restore(); document.execCommand("insertHTML", false, `<a class="mention" data-page="${p.id}" contenteditable="false">${esc(p.icon || "📄")} ${esc(p.title || "Untitled")}</a>`); }); });
    B("✕", "Clear formatting", () => exec("removeFormat"));
  }
  function exec(cmd, val) { restore(); document.execCommand("styleWithCSS", false, cmd === "hiliteColor" || cmd === "foreColor"); document.execCommand(cmd, false, val); setTimeout(showBar); }
  const restore = () => { if (!savedRange) return; const s = getSelection(); s.removeAllRanges(); s.addRange(savedRange); };
  function linkMode() {
    bar.innerHTML = "";
    const inp = h("input", { placeholder: "Paste link and press Enter" });
    bar.append(h("span", { html: icon("link"), style: { paddingLeft: "6px", display: "grid" } }), inp);
    inp.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); let u = inp.value.trim(); if (u && !/^[a-z]+:/i.test(u)) u = "https://" + u; restore(); u ? document.execCommand("createLink", false, u) : document.execCommand("unlink"); hideBar(); }
      if (e.key === "Escape") { restore(); hideBar(); }
    });
    setTimeout(() => inp.focus());
  }
  function fmtColor(anchor) {
    const items = [{ section: "Text color" }];
    COLORS.forEach(c => items.push({ label: c[0].toUpperCase() + c.slice(1), iconHtml: `<span class="sw" data-color="${c}">A</span>`, onClick: () => exec("foreColor", HEX[c] || getComputedStyle(document.body).color) }));
    items.push({ section: "Highlight" });
    COLORS.forEach(c => items.push({ label: c[0].toUpperCase() + c.slice(1), iconHtml: `<span class="sw" style="background:var(--bg-${c})"></span>`, onClick: () => exec("hiliteColor", BGHEX[c] || "transparent") }));
    UI.menu(anchor, items, { keep: true });
  }
  function hideBar() { if (bar && !bar.contains(document.activeElement)) { bar.remove(); bar = null; } }
  document.addEventListener("selectionchange", () => { clearTimeout(barTimer); barTimer = setTimeout(() => { if (!bar?.contains(document.activeElement)) showBar(); }, 140); });
  document.addEventListener("mousedown", e => { if (bar && !bar.contains(e.target) && !e.target.closest(".pop")) hideBar(); });

  /* ---------- code highlighting ---------- */
  const KW = "const let var function return if else for while do switch case break continue new class extends import from export default async await try catch finally throw typeof instanceof in of this null undefined true false def lambda elif pass None True False self print and or not is with as yield fn pub struct impl enum match mut use package func go type interface public private static void int string bool select where insert update delete create table join on";
  const KWS = new Set(KW.split(" "));
  function highlight(text, lang) {
    text = text || "";
    if (!lang || lang === "plain") return esc(text) + (text.endsWith("\n") ? "<br>" : "");
    const hash = ["python", "bash"].includes(lang);
    const re = new RegExp(`(\\/\\/.*|\\/\\*[\\s\\S]*?\\*\\/${hash ? "|#.*" : ""}${lang === "html" ? "|<!--[\\s\\S]*?-->" : ""})|("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\`)|\\b(\\d+(?:\\.\\d+)?)\\b|([A-Za-z_$][\\w$]*)(?=\\s*\\()|([A-Za-z_]+)`, "g");
    let out = "", last = 0, m;
    while ((m = re.exec(text))) {
      out += esc(text.slice(last, m.index)); last = re.lastIndex;
      const [all, c, s, n, f, w] = m;
      if (c) out += `<span class="tok-c">${esc(c)}</span>`;
      else if (s) out += `<span class="tok-s">${esc(s)}</span>`;
      else if (n) out += `<span class="tok-n">${n}</span>`;
      else if (f) out += KWS.has(f) ? `<span class="tok-k">${f}</span>` : `<span class="tok-f">${f}</span>`;
      else if (w) out += KWS.has(lang === "sql" ? w.toLowerCase() : w) ? `<span class="tok-k">${w}</span>` : w;
      else out += esc(all);
    }
    out += esc(text.slice(last));
    return out + (text.endsWith("\n") ? "<br>" : "");
  }

  window.EditorMenus = { openSlash, slashInput, slashKey, blockMenu, duplicate, inlineCode, highlight, pagePicker, isSlashOpen: () => !!slash };
})();
