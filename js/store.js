/* Store: data model, persistence, templates */
(function () {
  const KEY = "lumen-notes-v1";
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
  const now = () => Date.now();

  const COVERS = [
    "linear-gradient(135deg,#a78bfa,#f472b6)", "linear-gradient(135deg,#60a5fa,#a78bfa)", "linear-gradient(135deg,#34d399,#3b82f6)",
    "linear-gradient(135deg,#fbbf24,#f472b6)", "linear-gradient(135deg,#0f172a,#6d28d9)", "linear-gradient(135deg,#f97316,#ef4444)",
    "linear-gradient(135deg,#5eead4,#a3e635)", "linear-gradient(120deg,#e0c3fc,#8ec5fc)", "radial-gradient(circle at 30% 30%,#fde68a,#f9a8d4 50%,#a78bfa)",
    "linear-gradient(160deg,#1e3a8a,#0ea5e9 60%,#a5f3fc)", "linear-gradient(135deg,#111827,#374151)", "conic-gradient(from 200deg at 60% 40%,#f472b6,#a78bfa,#60a5fa,#34d399,#f472b6)",
  ];

  const b = (type, text = "", extra = {}) => ({ id: uid(), type, text, ...extra });

  function newDb(kind) {
    const status = { id: uid(), name: "Status", type: "select", options: [
      { id: uid(), name: "Not started", color: "gray" }, { id: uid(), name: "In progress", color: "blue" }, { id: uid(), name: "Done", color: "green" }] };
    const props = [{ id: uid(), name: "Name", type: "title" }, status,
      { id: uid(), name: "Tags", type: "multi", options: [{ id: uid(), name: "Design", color: "purple" }, { id: uid(), name: "Dev", color: "orange" }] },
      { id: uid(), name: "Due", type: "date" }];
    const row = (t, s, extra = {}) => ({ id: uid(), notes: "", values: { [props[0].id]: t, [status.id]: status.options[s].id, ...extra } });
    return {
      title: kind === "board" ? "Project board" : "Tasks", view: kind || "table", groupBy: status.id, props,
      rows: [row("Research competitors", 2), row("Design glass UI", 1, { [props[2].id]: [props[2].options[0].id] }), row("Ship v1", 0, { [props[2].id]: [props[2].options[1].id] })],
    };
  }

  const TEMPLATES = {
    empty: { name: "Empty page", icon: "📄", blocks: () => [b("p")] },
    todo: { name: "To-do list", icon: "✅", title: "To-do list", blocks: () => [
      b("callout", "Plan the day. Check things off and watch the progress fill.", { icon: "💡" }),
      b("h2", "Today"), b("todo", "Morning review"), b("todo", "Deep work block"), b("todo", "Reply to messages"),
      b("h2", "Later"), b("todo", "Read for 30 minutes"), b("p")] },
    meeting: { name: "Meeting notes", icon: "🗓️", title: "Meeting notes", blocks: () => [
      b("callout", "Date · Attendees · Goal", { icon: "📌" }), b("h2", "Agenda"), b("numbered", "Updates"), b("numbered", "Discussion"),
      b("h2", "Notes"), b("bullet", ""), b("h2", "Action items"), b("todo", ""), b("p")] },
    board: { name: "Project board", icon: "📋", title: "Project board", blocks: () => [b("database", "", { db: newDb("board") }), b("p")] },
    journal: { name: "Journal", icon: "📓", title: "Journal", blocks: () => [
      b("quote", "What would make today great?"), b("h3", "Grateful for"), b("bullet", ""), b("h3", "Reflections"), b("p", ""),
      b("toggle", "Yesterday's highlights", { body: "" })] },
    reading: { name: "Reading list", icon: "📚", title: "Reading list", blocks: () => [b("database", "", { db: Object.assign(newDb("table"), { title: "Books", view: "gallery" }) }), b("p")] },
  };

  function makePage(parentId = null, tpl = "empty") {
    const t = TEMPLATES[tpl] || TEMPLATES.empty;
    return {
      id: uid(), title: t.title || "", icon: tpl === "empty" ? "" : t.icon, cover: tpl === "empty" ? "" : COVERS[Math.floor(Math.random() * COVERS.length)],
      parentId, children: [], blocks: t.blocks(), favorite: false, deleted: false, createdAt: now(), updatedAt: now(),
      fullWidth: false, smallText: false, font: "default", locked: false, fresh: tpl === "empty",
    };
  }

  function seed() {
    const s = { pages: {}, root: [], settings: { theme: "light", accent: "#7c5cff", blur: 26, motion: true, sbWidth: 268, sbOpen: true, wsName: "My Workspace" }, recent: [] };
    const welcome = makePage(null, "empty");
    Object.assign(welcome, { title: "Welcome to Lumen", icon: "✨", cover: COVERS[11], fresh: false, favorite: true, blocks: [
      b("callout", "Lumen is a glassy, animated take on a block-based workspace. Everything saves to this browser automatically.", { icon: "👋", bg: "purple" }),
      b("h2", "Try these"),
      b("todo", "Type <code>/</code> anywhere to insert a block", { checked: true }),
      b("todo", "Select text to <b>bold</b>, <i>italicize</i>, color or link it"),
      b("todo", "Drag the ⋮⋮ handle to reorder blocks"),
      b("todo", "Press <code>Ctrl K</code> to search everything"),
      b("todo", "Markdown shortcuts: <code>#</code>, <code>-</code>, <code>[]</code>, <code>&gt;</code>, <code>1.</code>, <code>```</code>"),
      b("h2", "Blocks"),
      b("toggle", "Toggles hide details", { body: "Like this. Click the arrow to collapse it again.", open: false }),
      b("quote", "Simplicity is the ultimate sophistication."),
      b("code", "function greet(name) {\n  // say hello\n  return `Hello, ${name}!`;\n}", { lang: "javascript" }),
      b("divider"),
      b("h2", "A database"),
      b("database", "", { db: newDb("table") }),
      b("p", ""),
    ] });
    const ideas = makePage(null, "todo"); ideas.title = "Weekly plan"; ideas.fresh = false;
    const board = makePage(null, "board"); board.fresh = false;
    const sub = makePage(welcome.id, "journal"); sub.fresh = false;
    welcome.children.push(sub.id);
    welcome.blocks.splice(welcome.blocks.length - 1, 0, b("h2", "Sub-pages"), b("page", "", { pageId: sub.id }));
    [welcome, ideas, board, sub].forEach(p => (s.pages[p.id] = p));
    s.root = [welcome.id, ideas.id, board.id];
    return s;
  }

  // `local` is the browser-only workspace (always persisted to localStorage, and owns the settings).
  // `state` is the active workspace: `local`, or a shared cloud workspace that cloud.js swaps in.
  let local, firstRun = false;
  try { firstRun = !localStorage.getItem(KEY); local = JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { local = seed(); }
  let state = local;

  let saveTimer;
  const listeners = new Set();
  const Store = {
    uid, COVERS, TEMPLATES, newDb, block: b,
    get state() { return state; },
    page: id => state.pages[id],
    save(immediate) {
      clearTimeout(saveTimer);
      document.getElementById("savedState")?.classList.add("saving");
      const run = () => {
        try { localStorage.setItem(KEY, JSON.stringify(local)); } catch (e) { console.warn("save failed", e); }
        if (state.cloud && Store.onCloudSave) Store.onCloudSave();
        const el = document.getElementById("savedState");
        if (el) { el.classList.remove("saving"); if (!state.cloud) el.textContent = "Saved"; }
      };
      immediate ? run() : (saveTimer = setTimeout(run, 350));
    },
    touch(id) { const p = state.pages[id]; if (p) { p.updatedAt = now(); p.fresh = false; } Store.save(); },
    emit(evt) { listeners.forEach(fn => fn(evt)); },
    on(fn) { listeners.add(fn); },

    createPage(parentId = null, tpl = "empty", afterId) {
      const p = makePage(parentId, tpl);
      state.pages[p.id] = p;
      const list = parentId ? state.pages[parentId].children : state.root;
      const i = afterId ? list.indexOf(afterId) : -1;
      i >= 0 ? list.splice(i + 1, 0, p.id) : list.push(p.id);
      Store.save(); Store.emit("tree");
      return p;
    },
    applyTemplate(id, tpl) {
      const p = state.pages[id], t = TEMPLATES[tpl];
      p.blocks = t.blocks(); p.icon = p.icon || t.icon; p.title = p.title || t.title || "";
      p.cover = p.cover || COVERS[Math.floor(Math.random() * COVERS.length)]; p.fresh = false;
      Store.touch(id); Store.emit("tree");
    },
    siblings(id) { const p = state.pages[id]; return p.parentId ? state.pages[p.parentId].children : state.root; },
    ancestors(id) { const out = []; let p = state.pages[id]; while (p && p.parentId) { p = state.pages[p.parentId]; if (p) out.unshift(p); } return out; },
    descendants(id) { const out = []; const walk = pid => (state.pages[pid]?.children || []).forEach(c => { out.push(c); walk(c); }); walk(id); return out; },

    trash(id) {
      const p = state.pages[id]; if (!p) return;
      [id, ...Store.descendants(id)].forEach(x => { state.pages[x].deleted = true; state.pages[x].deletedAt = now(); });
      Store.save(); Store.emit("tree");
    },
    restore(id) {
      const p = state.pages[id];
      [id, ...Store.descendants(id)].forEach(x => (state.pages[x].deleted = false));
      if (p.parentId && (!state.pages[p.parentId] || state.pages[p.parentId].deleted)) {
        const old = state.pages[p.parentId]; if (old) old.children = old.children.filter(c => c !== id);
        p.parentId = null; if (!state.root.includes(id)) state.root.push(id);
      }
      Store.save(); Store.emit("tree");
    },
    destroy(id) {
      const p = state.pages[id]; if (!p) return;
      [...Store.descendants(id), id].forEach(x => delete state.pages[x]);
      if (p.parentId && state.pages[p.parentId]) state.pages[p.parentId].children = state.pages[p.parentId].children.filter(c => c !== id);
      state.root = state.root.filter(c => c !== id);
      Store.save(); Store.emit("tree");
    },
    move(id, targetId, mode) { // mode: "inside" | "before"
      if (id === targetId || Store.descendants(id).includes(targetId)) return false;
      const p = state.pages[id];
      const from = Store.siblings(id); from.splice(from.indexOf(id), 1);
      if (mode === "inside") { p.parentId = targetId; state.pages[targetId].children.push(id); }
      else {
        const t = state.pages[targetId]; p.parentId = t.parentId;
        const list = Store.siblings(targetId); list.splice(list.indexOf(targetId), 0, id);
      }
      Store.save(); Store.emit("tree"); return true;
    },
    duplicate(id) {
      const src = state.pages[id];
      const copy = JSON.parse(JSON.stringify(src));
      copy.id = uid(); copy.title = (src.title || "Untitled") + " (copy)"; copy.children = []; copy.createdAt = copy.updatedAt = now(); copy.favorite = false;
      copy.blocks.forEach(bl => (bl.id = uid()));
      state.pages[copy.id] = copy;
      const list = Store.siblings(id); list.splice(list.indexOf(id) + 1, 0, copy.id);
      Store.save(); Store.emit("tree"); return copy;
    },
    visit(id) { state.recent = [id, ...(state.recent || []).filter(x => x !== id)].slice(0, 12); Store.save(); },
    plainText(html) { const d = document.createElement("div"); d.innerHTML = html || ""; return d.textContent || ""; },
    exportAll() { return JSON.stringify(state, null, 2); },
    importAll(json) { const s = JSON.parse(json); if (!s.pages || !s.root) throw new Error("Invalid file"); s.settings = local.settings; local = state = s; Store.save(true); },
    reset() { const keep = local.settings; local = state = seed(); local.settings = keep; Store.save(true); },
    // cloud workspace support
    get local() { return local; },
    get isCloud() { return !!state.cloud; },
    useCloud(ws) { state = ws ? Object.assign(ws, { cloud: true, settings: local.settings, recent: ws.recent || [] }) : local; },
    getName() { return state.cloud ? state.name : local.settings.wsName; },
    getIcon() { return state.cloud ? state.icon : local.settings.wsIcon; },
    get firstRun() { return firstRun; },
    setName(n) { if (state.cloud) state.name = n; else local.settings.wsName = n; Store.save(); },
    seedPages() { return seed(); },
  };
  window.Store = Store;
})();
