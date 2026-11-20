/* Database block: table, board and gallery views, properties, side peek */
(function () {
  const { h, icon, esc } = UI;
  const TYPES = { title: ["Aa", "Title"], text: ["≡", "Text"], number: ["#", "Number"], select: ["◉", "Select"], multi: ["☰", "Multi-select"], date: ["📅", "Date"], checkbox: ["☑", "Checkbox"], url: ["🔗", "URL"], progress: ["▰", "Progress"] };
  const TAGC = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];
  const query = new WeakMap(); // db -> search string

  function render(block, page) {
    const db = block.db, wrap = h("div", { class: "db" });
    const save = (rerender = true) => { Store.touch(page.id); if (rerender) redraw(); };
    const redraw = () => { const cur = document.querySelector(`.db[data-b="${block.id}"]`) || wrap; cur.replaceWith(render(block, page)); };
    const titleProp = db.props.find(p => p.type === "title");
    const q = (query.get(db) || "").toLowerCase();
    const rows = db.rows.filter(r => !q || db.props.some(p => valueText(p, r.values[p.id]).toLowerCase().includes(q)));
    if (db.sort) {
      const p = db.props.find(x => x.id === db.sort.prop);
      if (p) rows.sort((a, b) => valueText(p, a.values[p.id]).localeCompare(valueText(p, b.values[p.id]), undefined, { numeric: true }) * db.sort.dir);
    }

    // header
    const title = h("div", { class: "db-title", contenteditable: !page.locked, html: esc(db.title || "") });
    title.addEventListener("input", () => { db.title = title.textContent; save(false); });
    const views = h("div", { class: "db-views" }, ...[["table", "Table"], ["board", "Board"], ["gallery", "Gallery"]].map(([v, l]) =>
      h("button", { class: db.view === v ? "on" : "", html: icon(v) + l, onclick: () => { db.view = v; save(); } })));
    const search = h("input", { placeholder: "Search…", value: query.get(db) || "" });
    const tools = h("div", { class: "db-tools" + (q ? " searching" : "") },
      search,
      h("button", { class: "icon-btn xs", title: "Search", html: `<svg class="ico sm" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>`, onclick: () => { tools.classList.toggle("searching"); search.focus(); } }),
      h("button", { class: "icon-btn xs", title: "Sort", html: "⇅", onclick: e => sortMenu(e.currentTarget) }),
      h("button", { class: "db-new", text: "New", onclick: () => addRow() }));
    search.addEventListener("input", () => { query.set(db, search.value); const pos = search.selectionStart; redraw(); const s = document.querySelector(`.db[data-b="${block.id}"] .db-tools input`); s?.focus(); s?.setSelectionRange(pos, pos); });
    wrap.dataset.b = block.id;
    wrap.append(h("div", { class: "db-head" }, title, views, tools));

    function addRow(values = {}) {
      const r = { id: Store.uid(), notes: "", values }; db.rows.push(r); save();
      setTimeout(() => document.querySelector(`[data-row="${r.id}"] .txt, [data-row="${r.id}"] .bc-t`)?.focus(), 30);
      return r;
    }
    function sortMenu(a) {
      UI.menu(a, [{ section: "Sort by" }, ...db.props.map(p => ({ label: p.name, kbd: db.sort?.prop === p.id ? (db.sort.dir > 0 ? "↑" : "↓") : "",
        onClick: () => { db.sort = { prop: p.id, dir: db.sort?.prop === p.id ? -db.sort.dir : 1 }; save(); } })),
        db.sort ? { sep: true } : null, db.sort ? { label: "Remove sort", icon: "x", onClick: () => { delete db.sort; save(); } } : null]);
    }

    /* ----- views ----- */
    if (db.view === "board") wrap.append(board());
    else if (db.view === "gallery") wrap.append(gallery());
    else wrap.append(table());
    const doneP = db.props.find(p => p.type === "checkbox");
    wrap.append(h("div", { class: "db-foot" }, h("span", { text: `${rows.length} ${rows.length === 1 ? "row" : "rows"}` }),
      doneP ? h("span", { text: `${db.rows.filter(r => r.values[doneP.id]).length} checked` }) : null));
    return wrap;

    function table() {
      const thead = h("tr", null, ...db.props.map(p => h("th", null, h("div", { class: "th", onclick: e => propMenu(p, e.currentTarget) }, h("span", { class: "t-ic", text: TYPES[p.type][0] }), p.name))),
        h("th", { class: "add-col" }, h("button", { title: "Add property", html: icon("plus"), onclick: e => addProp(e.currentTarget) })));
      const body = h("tbody");
      rows.forEach((r, i) => {
        const tr = h("tr", { class: "row", dataset: { row: r.id }, style: { animationDelay: Math.min(i * 30, 300) + "ms" } });
        db.props.forEach(p => tr.append(h("td", null, cell(p, r))));
        tr.append(h("td"));
        body.append(tr);
      });
      return h("div", null, h("div", { class: "db-scroll" }, h("table", { class: "db-table" }, h("thead", null, thead), body)),
        h("button", { class: "db-add-row", html: icon("plus") + " New row", onclick: () => addRow() }));
    }
    function board() {
      const g = db.props.find(p => p.id === db.groupBy) || db.props.find(p => p.type === "select");
      if (!g) return h("div", { class: "menu-empty", text: "Add a Select property to use the board view." });
      const cols = [{ id: null, name: "No " + g.name, color: "gray" }, ...g.options];
      const el = h("div", { class: "board" });
      cols.forEach(o => {
        const items = rows.filter(r => (r.values[g.id] || null) === o.id);
        if (o.id === null && !items.length) return;
        const cards = h("div", { class: "b-cards" });
        items.forEach((r, i) => {
          const tt = h("div", { class: "bc-t", contenteditable: !page.locked, html: esc(r.values[titleProp.id] || "") });
          tt.addEventListener("input", () => { r.values[titleProp.id] = tt.textContent; save(false); });
          tt.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); tt.blur(); } });
          const props = h("div", { class: "bc-p" });
          db.props.filter(p => p !== titleProp && p !== g && r.values[p.id] != null && r.values[p.id] !== "" && !(Array.isArray(r.values[p.id]) && !r.values[p.id].length)).forEach(p => props.append(display(p, r.values[p.id])));
          const card = h("div", { class: "b-card", draggable: !page.locked, dataset: { row: r.id }, style: { animationDelay: i * 40 + "ms" } }, tt, props,
            h("button", { class: "open-row", text: "Open", onclick: () => peek(r) }));
          card.addEventListener("dragstart", e => { e.stopPropagation(); card.classList.add("dragging"); e.dataTransfer.setData("text/row", r.id); });
          card.addEventListener("dragend", () => card.classList.remove("dragging"));
          cards.append(card);
        });
        const col = h("div", { class: "b-col" },
          h("div", { class: "b-col-h" }, h("span", { class: "tag", dataset: { tc: o.color }, text: o.name }), h("span", { class: "n", text: items.length })),
          cards, h("button", { class: "b-add", html: "+ New", onclick: () => addRow({ [g.id]: o.id }) }));
        col.addEventListener("dragover", e => { if (e.dataTransfer.types.includes("text/row")) { e.preventDefault(); e.stopPropagation(); col.classList.add("drop"); } });
        col.addEventListener("dragleave", e => { if (!col.contains(e.relatedTarget)) col.classList.remove("drop"); });
        col.addEventListener("drop", e => {
          e.preventDefault(); e.stopPropagation(); col.classList.remove("drop");
          const r = db.rows.find(x => x.id === e.dataTransfer.getData("text/row")); if (!r) return;
          r.values[g.id] = o.id; save();
          if (/done|complete/i.test(o.name)) UI.toast("🎉 Nice work!");
        });
        el.append(col);
      });
      return el;
    }
    function gallery() {
      const el = h("div", { class: "gallery" });
      const sel = db.props.find(p => p.type === "select");
      rows.forEach((r, i) => {
        const color = sel ? (sel.options.find(o => o.id === r.values[sel.id])?.color || "gray") : "purple";
        const props = h("div", { class: "bc-p" });
        db.props.filter(p => p !== titleProp && r.values[p.id] != null && r.values[p.id] !== "").slice(0, 3).forEach(p => props.append(display(p, r.values[p.id])));
        el.append(h("div", { class: "g-card", style: { animationDelay: i * 40 + "ms" }, onclick: () => peek(r) },
          h("div", { class: "g-top", style: { background: `var(--bg-${color})` }, text: r.icon || "📄" }),
          h("div", { class: "g-b" }, h("div", { class: "g-t", text: r.values[titleProp.id] || "Untitled" }), props)));
      });
      el.append(h("button", { class: "g-card", style: { display: "grid", placeItems: "center", minHeight: "150px", color: "var(--faint)" }, text: "+ New", onclick: () => peek(addRow()) }));
      return el;
    }

    /* ----- cells ----- */
    function cell(p, r, inPeek) {
      const v = r.values[p.id];
      if (p.type === "title") {
        const t = h("span", { class: "txt", contenteditable: !page.locked, html: esc(v || "") });
        t.addEventListener("input", () => { r.values[p.id] = t.textContent; save(false); });
        t.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addRow(); } });
        return h("div", { class: "cell title-cell" }, h("span", { text: r.icon || "📄" }), t, inPeek ? null : h("button", { class: "open-row", text: "Open", onclick: () => peek(r) }));
      }
      if (p.type === "checkbox") {
        const c = h("input", { type: "checkbox", checked: !!v, disabled: page.locked });
        c.addEventListener("change", () => { r.values[p.id] = c.checked; save(); });
        return h("div", { class: "cell" }, c);
      }
      if (p.type === "date") {
        const d = h("input", { type: "date", class: "date-in", value: v || "", disabled: page.locked, required: true });
        d.addEventListener("change", () => { r.values[p.id] = d.value; save(false); });
        return h("div", { class: "cell" }, d);
      }
      if (p.type === "select" || p.type === "multi") {
        const c = h("div", { class: "cell click" }, display(p, v));
        c.addEventListener("click", () => !page.locked && optionPicker(p, r, c, inPeek));
        return c;
      }
      if (p.type === "progress") {
        const n = Math.max(0, Math.min(100, +v || 0));
        const c = h("div", { class: "cell click", title: "Click to set" }, h("span", { style: { fontSize: "12px", color: "var(--muted)" }, text: n + "%" }), h("div", { class: "progress" }, h("span", { style: { width: n + "%" } })));
        c.addEventListener("click", e => {
          const inp = h("input", { type: "range", min: 0, max: 100, value: n, style: { width: "200px" } });
          inp.addEventListener("input", () => { r.values[p.id] = +inp.value; c.firstChild.textContent = inp.value + "%"; c.querySelector(".progress span").style.width = inp.value + "%"; save(false); });
          UI.popover(c, h("div", { style: { padding: "8px" } }, inp), { onClose: () => (inPeek ? null : save()) });
        });
        return c;
      }
      const c = h("div", { class: "cell", contenteditable: !page.locked, html: esc(v ?? "") });
      c.addEventListener("input", () => { r.values[p.id] = p.type === "number" ? c.textContent.replace(/[^\d.-]/g, "") : c.textContent; save(false); });
      c.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); c.blur(); } });
      if (p.type === "url") c.addEventListener("click", e => { if ((e.ctrlKey || e.metaKey) && v) open(/^https?:/.test(v) ? v : "https://" + v, "_blank"); });
      return c;
    }
    function optionPicker(p, r, anchor, inPeek) {
      const inp = h("input", { class: "menu-input", placeholder: "Search or create an option…" });
      const list = h("div");
      const cur = () => p.type === "multi" ? (r.values[p.id] || []) : [r.values[p.id]];
      const draw = () => {
        list.innerHTML = ""; const qq = inp.value.trim().toLowerCase();
        p.options.filter(o => o.name.toLowerCase().includes(qq)).forEach(o => {
          list.append(h("button", { class: "mi compact", onclick: () => choose(o.id) }, h("span", { class: "tag", dataset: { tc: o.color }, text: o.name }), cur().includes(o.id) ? h("span", { class: "mi-k", text: "✓" }) : null));
        });
        if (qq && !p.options.some(o => o.name.toLowerCase() === qq))
          list.append(h("button", { class: "mi compact", onclick: () => { const o = { id: Store.uid(), name: inp.value.trim(), color: TAGC[p.options.length % TAGC.length] }; p.options.push(o); choose(o.id); } }, "Create ", h("span", { class: "tag", dataset: { tc: TAGC[p.options.length % TAGC.length] }, text: inp.value.trim() })));
        if (r.values[p.id] && (p.type !== "multi" || r.values[p.id].length)) list.append(h("div", { class: "menu-sep" }), h("button", { class: "mi compact danger", text: "Clear", onclick: () => { delete r.values[p.id]; done(); } }));
      };
      const choose = id => {
        if (p.type === "multi") { const a = r.values[p.id] || []; r.values[p.id] = a.includes(id) ? a.filter(x => x !== id) : [...a, id]; Store.touch(page.id); anchor.innerHTML = ""; anchor.append(display(p, r.values[p.id])); inp.value = ""; draw(); }
        else { r.values[p.id] = id; done(); }
      };
      const done = () => { api.close(); };
      inp.addEventListener("input", draw);
      inp.addEventListener("keydown", e => { if (e.key === "Enter") list.querySelector(".mi")?.click(); });
      draw();
      const api = UI.popover(anchor, h("div", { style: { width: "260px" } }, inp, list), { onClose: () => { if (inPeek) { anchor.innerHTML = ""; anchor.append(display(p, r.values[p.id])); Store.touch(page.id); } else save(); } });
      setTimeout(() => inp.focus());
    }
    function display(p, v) {
      if (v == null || v === "") return document.createTextNode("");
      if (p.type === "select") { const o = p.options.find(x => x.id === v); return o ? h("span", { class: "tag", dataset: { tc: o.color }, text: o.name }) : document.createTextNode(""); }
      if (p.type === "multi") return h("span", null, ...(v || []).map(id => p.options.find(x => x.id === id)).filter(Boolean).map(o => h("span", { class: "tag", dataset: { tc: o.color }, text: o.name })));
      if (p.type === "checkbox") return h("span", { text: v ? "☑ " + p.name : "" });
      if (p.type === "date") return h("span", { text: "📅 " + new Date(v + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) });
      if (p.type === "progress") return h("span", { text: (+v || 0) + "%" });
      return h("span", { text: String(v) });
    }

    /* ----- properties ----- */
    function addProp(anchor) {
      UI.menu(anchor, [{ section: "Property type" }, ...Object.entries(TYPES).filter(([t]) => t !== "title").map(([t, [ic, name]]) => ({
        label: name, iconHtml: `<span class="sw" style="border:0">${ic}</span>`,
        onClick: () => { db.props.push({ id: Store.uid(), name, type: t, options: [] }); save(); },
      }))]);
    }
    function propMenu(p, anchor) {
      const inp = h("input", { class: "menu-input", value: p.name });
      inp.addEventListener("input", () => { p.name = inp.value; Store.touch(page.id); });
      inp.addEventListener("keydown", e => { if (e.key === "Enter") api.close(); });
      const items = [{ el: inp }];
      if (p.type !== "title") {
        items.push({ section: "Type" }, ...Object.entries(TYPES).filter(([t]) => t !== "title").map(([t, [ic, name]]) => ({ label: name, iconHtml: `<span class="sw" style="border:0">${ic}</span>`, kbd: p.type === t ? "✓" : "",
          onClick: () => { p.type = t; p.options = p.options || []; save(); } })));
        if (p.type === "select") items.push({ label: "Group board by this", icon: "board", onClick: () => { db.groupBy = p.id; db.view = "board"; save(); } });
        items.push({ sep: true }, { label: "Delete property", icon: "trash", danger: true, onClick: () => { db.props = db.props.filter(x => x !== p); save(); } });
      }
      const api = UI.menu(anchor, items, { onClose: () => save() });
    }

    /* ----- side peek ----- */
    function peek(r) {
      UI.closePops();
      const t = h("div", { class: "peek-title", contenteditable: !page.locked, html: esc(r.values[titleProp.id] || "") });
      t.addEventListener("input", () => { r.values[titleProp.id] = t.textContent; Store.touch(page.id); });
      const ic = h("div", { style: { fontSize: "44px", cursor: "pointer", width: "fit-content", marginBottom: "6px" }, text: r.icon || "📄", onclick: e => UI.emojiPicker(e.currentTarget, em => { r.icon = em; ic.textContent = em || "📄"; Store.touch(page.id); }) });
      const props = h("div");
      db.props.filter(p => p !== titleProp).forEach(p => props.append(h("div", { class: "prop-row" }, h("div", { class: "pk" }, h("span", { text: TYPES[p.type][0] }), p.name), h("div", { class: "pv" }, cell(p, r, true)))));
      const notes = h("textarea", { placeholder: "Add notes, details, links…" }); notes.value = r.notes || "";
      notes.addEventListener("input", () => { r.notes = notes.value; Store.touch(page.id); });
      const panel = h("div", { class: "peek glass-strong" },
        h("div", { class: "peek-top" },
          h("button", { class: "icon-btn", title: "Delete row", html: icon("trash"), onclick: () => { db.rows = db.rows.filter(x => x !== r); close(); UI.toast("Row deleted"); } }),
          h("button", { class: "icon-btn", title: "Close", html: icon("x"), onclick: () => close() })),
        h("div", { class: "peek-body" }, ic, t, props, h("div", { class: "peek-notes" }, notes)));
      const close = () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onOut, true); panel.classList.add("closing"); setTimeout(() => panel.remove(), 280); save(); };
      const onKey = e => { if (e.key === "Escape" && !document.querySelector(".pop")) close(); };
      const onOut = e => { if (!panel.contains(e.target) && !e.target.closest(".pop")) close(); };
      document.addEventListener("keydown", onKey); setTimeout(() => document.addEventListener("mousedown", onOut, true));
      document.getElementById("layer").append(panel);
      setTimeout(() => !r.values[titleProp.id] && t.focus(), 50);
    }
  }

  function valueText(p, v) {
    if (v == null) return "";
    if (p.type === "select") return p.options.find(o => o.id === v)?.name || "";
    if (p.type === "multi") return (v || []).map(id => p.options.find(o => o.id === id)?.name || "").join(" ");
    return String(v);
  }
  function plain(db) { return db.title + " " + db.rows.map(r => db.props.map(p => valueText(p, r.values[p.id])).join(" ")).join(" "); }

  window.Database = { render, plain };
})();
