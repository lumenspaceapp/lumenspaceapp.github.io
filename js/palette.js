/* Command palette (Ctrl K): full-text page search + quick commands */
(function () {
  const { h, esc } = UI;
  let open = null;

  function pageText(p) {
    return p.blocks.map(b => b.type === "database" ? Database.plain(b.db) : Store.plainText(b.text) + " " + Store.plainText(b.body || "")).join(" ");
  }
  const mark = (s, q) => { if (!q) return esc(s); const i = s.toLowerCase().indexOf(q); return i < 0 ? esc(s) : esc(s.slice(0, i)) + "<mark>" + esc(s.slice(i, i + q.length)) + "</mark>" + esc(s.slice(i + q.length)); };

  const PAGE_CMDS = new Set(["New page", "Toggle outline", "Open trash", "Browse templates", "Focus mode"]);
  function commands() {
    return allCommands().filter(c => window.FEATURES?.pages !== false || !PAGE_CMDS.has(c.t));
  }
  // while pages are off: search the team workspace instead (apps, tasks, people, CRM, files)
  function workspaceMatches(q) {
    const out = [], me = Data.me().key, has = (...s) => s.some(x => String(x || "").toLowerCase().includes(q));
    const appList = [["home", "Home", "🏠"], ...Object.entries(Apps.reg).filter(([k, d]) => !d.hidden && (!Apps.can || Apps.can(k, "view"))).map(([k, d]) => [k, d.title, d.icon])];
    appList.forEach(([k, t, ic]) => { if (!q || has(t)) out.push({ ic, t, d: "App", go: k === "home" ? "#/p/home" : "#/app/" + k, s: q && t.toLowerCase().startsWith(q) ? 4 : 3 }); });
    if (!q) {
      // nothing typed: my open tasks, soonest first
      Apps.liveTasks().filter(t => t.status !== "done" && Apps.isMyTask(t, me))
        .sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999")).slice(0, 5)
        .forEach(t => out.push({ ic: "✅", t: t.title || "Untitled task", d: t.deadline ? "Due " + Apps.fmtDate(t.deadline) : "My task", go: "#/app/tasks/" + t.id }));
      return out.slice(0, 12);
    }
    Apps.liveTasks().forEach(t => { if (has(t.title, t.desc, (t.tags || []).join(" "))) out.push({ ic: t.status === "done" ? "☑️" : "✅", t: t.title || "Untitled task", d: "Task" + (t.deadline ? " · due " + Apps.fmtDate(t.deadline) : ""), go: "#/app/tasks/" + t.id, s: has(t.title) ? 2 : 1 }); });
    Data.people().forEach(pp => { if (has(pp.name, pp.email, pp.title, pp.dept)) out.push({ person: pp, t: pp.name, d: [pp.title, pp.dept].filter(Boolean).join(" · ") || pp.email || "Teammate", go: "#/app/company", s: 2 }); });
    [["deals", "💼", "Deal"], ["leads", "🧲", "Lead"], ["contacts", "👤", "Contact"], ["companies", "🏢", "Company"]].forEach(([col, ic, label]) =>
      Data.list(col).forEach(r => { if (!r.deleted && has(r.title, r.name, r.company, r.email, r.phone)) out.push({ ic, t: r.title || r.name || label, d: label + (r.company ? " · " + r.company : ""), go: "#/app/crm/open:" + col + ":" + r.id, s: 1.5 }); }));
    Data.list("products").forEach(pr => { if (!pr.deleted && has(pr.name, pr.sku, pr.category)) out.push({ ic: pr.kind === "service" ? "🛠️" : "📦", t: pr.name, d: (pr.kind === "service" ? "Service" : "Product") + (pr.sku ? " · " + pr.sku : "") + (pr.price != null ? " · " + Apps.money(pr.price) : ""), go: "#/app/crm/products", s: 1.2 }); });
    Data.list("quotes").forEach(qd => { if (!qd.deleted && has(qd.number, qd.title)) out.push({ ic: qd.kind === "invoice" ? "🧾" : "📝", t: (qd.number ? qd.number + " · " : "") + (qd.title || (qd.kind === "invoice" ? "Invoice" : "Estimate")), d: (qd.kind === "invoice" ? "Invoice" : "Estimate") + " · " + (qd.status || "draft"), go: "#/app/crm/" + (qd.kind === "invoice" ? "invoices" : "estimates"), s: 1.4 }); });
    Data.list("bookings").forEach(b => { if (b.kind === "booking" && has(b.client?.name, b.client?.phone, b.client?.email)) out.push({ ic: "🗓️", t: b.client?.name || "Booking", d: "Booking · " + Apps.fmtDate(b.date) + " " + (b.start || ""), go: "#/app/booking", s: 1 }); });
    // Drive files: skip attachments, old versions, the recycle bin and other people's private files
    const privateTo = x => { let f = x, g = 0; while (f && g++ < 20) { if (f.scope === "personal") { const ks = [f.owner || f.by, ...(f.shared || []), ...(f.shareEdit || [])]; return ks.includes(me) ? null : f; } f = f.folder !== undefined ? Data.get("folders", f.folder) : Data.get("folders", f.parent); } return null; };
    Data.list("files").forEach(f => { if (f.folder !== "__attachments" && f.folder !== "__versions" && !f.deleted && !privateTo(f) && has(f.name)) out.push({ ic: f.type === "link" ? "🔗" : "📎", t: f.name, d: "Drive", go: "#/app/drive/f:" + f.id, s: 1 }); });
    Data.list("events").forEach(ev => { if (ev.kind !== "room" && (!window.CalendarAPI?.visible || CalendarAPI.visible(ev)) && has(ev.title, ev.where)) out.push({ ic: "📅", t: ev.title, d: "Event · " + Apps.fmtDate(ev.date), go: "#/app/calendar/" + ev.id, s: 1 }); });
    Data.list("channels").forEach(c => { if (Apps.canSeeChat(c.id) && has(c.name, c.desc)) out.push({ ic: c.kind === "group" ? "👥" : c.kind === "broadcast" ? "📢" : "#", t: c.name, d: c.kind === "group" ? "Group chat" : "Channel", go: "#/app/chat/" + encodeURIComponent(c.id), s: 1.5 }); });
    return out.sort((a, b) => (b.s || 0) - (a.s || 0)).slice(0, 14);
  }
  function allCommands() {
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
    const noPages = window.FEATURES?.pages === false;
    const inp = h("input", { placeholder: noPages ? "Search tasks, people, deals, files or type a command…" : "Search pages or type a command…" });
    const results = h("div", { class: "results" });
    let hl = 0, items = [];
    const draw = () => {
      const q = inp.value.trim().toLowerCase();
      results.innerHTML = ""; items = [];
      if (noPages) {
        const found = workspaceMatches(q);
        results.append(h("div", { class: "menu-sec", text: q ? "Results" : "Jump to" }));
        if (!found.length) results.append(h("div", { class: "menu-empty", text: "Nothing matches “" + inp.value.trim() + "”." }));
        found.forEach(r => items.push({ el: h("button", { class: "mi" },
          r.person ? h("span", { class: "mi-ic" }, Apps.avatar(r.person, 26)) : h("span", { class: "mi-ic", text: r.ic }),
          h("span", { style: { minWidth: 0 } }, h("div", { class: "mi-t", html: mark(r.t, q) }), r.d ? h("div", { class: "mi-d", text: r.d }) : null)),
          run: () => { location.hash = r.go; } }));
        items.forEach(i => results.append(i.el));
        const cmds = commands().filter(c => !q || c.t.toLowerCase().includes(q));
        if (cmds.length) {
          results.append(h("div", { class: "menu-sec", text: "Commands" }));
          cmds.forEach(c => { const el = h("button", { class: "mi compact" }, h("span", { class: "mi-ic", text: c.ic }), h("span", { class: "mi-t", text: c.t })); items.push({ el, run: c.run }); results.append(el); });
        }
        items.forEach((it, i) => { it.el.addEventListener("click", () => choose(i)); it.el.addEventListener("mousemove", () => { hl = i; paint(); }); });
        hl = 0; return paint();
      }
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
