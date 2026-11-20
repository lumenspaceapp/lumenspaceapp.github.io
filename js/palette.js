/* Command palette (Ctrl K): full-text page search + quick commands */
(function () {
  const { h, esc } = UI;
  let open = null;

  function pageText(p) {
    return p.blocks.map(b => b.type === "database" ? Database.plain(b.db) : Store.plainText(b.text) + " " + Store.plainText(b.body || "")).join(" ");
  }
  const mark = (s, q) => { if (!q) return esc(s); const i = s.toLowerCase().indexOf(q); return i < 0 ? esc(s) : esc(s.slice(0, i)) + "<mark>" + esc(s.slice(i, i + q.length)) + "</mark>" + esc(s.slice(i + q.length)); };

  function commands() {
    return [
      { t: "New page", ic: "➕", run: () => App.newPage() },
      { t: "Go home", ic: "🏠", run: () => App.go("home") },
      { t: "Toggle dark mode", ic: "🌗", run: () => App.toggleTheme() },
      { t: "Toggle sidebar", ic: "📐", run: () => App.toggleSidebar() },
      { t: "Toggle outline", ic: "📑", run: () => App.toggleOutline() },
      { t: "Open settings", ic: "⚙️", run: () => App.settings() },
      { t: "Open trash", ic: "🗑️", run: () => Page.trashModal() },
      { t: "Browse templates", ic: "🧩", run: () => Page.templatesModal() },
      { t: "Focus mode", ic: "🎯", run: () => App.focusMode() },
      { t: "Help: ask Lumi", ic: "✨", run: () => window.Lumi?.open() },
    ];
  }

  function show() {
    if (open) return;
    const inp = h("input", { placeholder: "Search pages or type a command…" });
    const results = h("div", { class: "results" });
    let hl = 0, items = [];
    const draw = () => {
      const q = inp.value.trim().toLowerCase();
      results.innerHTML = ""; items = [];
      const pages = Object.values(Store.state.pages).filter(p => !p.deleted);
      let matches;
      if (!q) {
        const rec = (Store.state.recent || []).map(Store.page).filter(p => p && !p.deleted);
        matches = (rec.length ? rec : pages).slice(0, 7).map(p => ({ p }));
      } else {
        matches = pages.map(p => {
          const title = (p.title || "Untitled").toLowerCase(), body = pageText(p), bi = body.toLowerCase().indexOf(q);
          const s = title.startsWith(q) ? 3 : title.includes(q) ? 2 : bi >= 0 ? 1 : 0;
          return { p, s, snippet: bi >= 0 ? (bi > 30 ? "…" : "") + body.slice(Math.max(0, bi - 30), bi + 70) : "" };
        }).filter(x => x.s).sort((a, b) => b.s - a.s || b.p.updatedAt - a.p.updatedAt).slice(0, 10);
      }
      results.append(h("div", { class: "menu-sec", text: q ? "Pages" : "Recent" }));
      if (!matches.length) results.append(h("div", { class: "menu-empty", text: "No pages match. Press Enter to create “" + inp.value.trim() + "”." }));
      matches.forEach(m => {
        const path = Store.ancestors(m.p.id).map(a => a.title || "Untitled").join(" / ");
        items.push({ el: h("button", { class: "mi" },
          h("span", { class: "mi-ic", text: m.p.icon || "📄" }),
          h("span", { style: { minWidth: 0 } }, h("div", { class: "mi-t", html: mark(m.p.title || "Untitled", q) }),
            m.snippet ? h("div", { class: "snippet", html: mark(m.snippet, q) }) : path ? h("div", { class: "mi-d", text: path }) : null),
          h("span", { class: "mi-k", text: UI.timeAgo(m.p.updatedAt) })), run: () => App.go(m.p.id) });
      });
      items.forEach(i => results.append(i.el));
      const cmds = commands().filter(c => !q || c.t.toLowerCase().includes(q));
      if (cmds.length) {
        results.append(h("div", { class: "menu-sec", text: "Commands" }));
        cmds.forEach(c => { const el = h("button", { class: "mi compact" }, h("span", { class: "mi-ic", text: c.ic }), h("span", { class: "mi-t", text: c.t })); items.push({ el, run: c.run }); results.append(el); });
      }
      if (q && !matches.length) items.unshift({ el: document.createElement("i"), run: () => { const p = App.newPage(); p.title = inp.value.trim(); Store.touch(p.id); Sidebar.render(); App.go(p.id, true); } });
      items.forEach((it, i) => { it.el.addEventListener("click", () => choose(i)); it.el.addEventListener("mousemove", () => { hl = i; paint(); }); });
      hl = 0; paint();
    };
    const paint = () => items.forEach((it, i) => it.el.classList.toggle("hl", i === hl));
    const choose = i => { const it = items[i]; close(); it && it.run(); };
    inp.addEventListener("input", draw);
    inp.addEventListener("keydown", e => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); hl = (hl + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; paint(); items[hl]?.el.scrollIntoView({ block: "nearest" }); }
      if (e.key === "Enter") { e.preventDefault(); choose(hl); }
    });
    const box = h("div", { class: "palette glass-strong" }, inp, results, h("div", { class: "foot" }, h("span", { text: "↑↓ navigate" }), h("span", { text: "↵ open" }), h("span", { text: "esc close" })));
    const m = UI.modal(null, box, { className: "pal-wrap", onClose: () => (open = null) });
    // the modal wrapper adds its own glass box; flatten it so only the palette shows
    m.el.style.cssText = "background:none;border:0;box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none;overflow:visible;width:auto;max-height:none";
    Object.assign(m.el.querySelector(".modal-body").style, { padding: "0", overflow: "visible" });
    const close = () => m.close();
    open = m;
    draw(); setTimeout(() => inp.focus(), 20);
  }

  window.Palette = { show, isOpen: () => !!open };
})();
