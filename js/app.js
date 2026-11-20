/* App shell: routing, topbar, theme, settings, shortcuts */
(function () {
  const { h, icon } = UI;
  const S = () => Store.state.settings;
  const ACCENTS = ["#7c5cff", "#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#64748b"];

  const App = {
    currentId: null,

    go(id, force) {
      if (!id) id = "home";
      const target = "#/p/" + id;
      if (location.hash !== target) { location.hash = target; return; } // hashchange will route
      if (force || App.currentId !== id) route();
    },
    newPage(parentId = null, tpl = "empty") {
      const p = Store.createPage(parentId, tpl);
      if (parentId) Sidebar.expandTo(p.id);
      App.go(p.id); return p;
    },
    async trashPage(id) {
      const p = Store.page(id); Store.trash(id);
      UI.toast(`Moved “${p.title || "Untitled"}” to trash`, { label: "Undo", run: () => { Store.restore(id); App.go(id, true); } });
      if (App.currentId === id || Store.ancestors(App.currentId || "").some(a => a.id === id)) App.go(p.parentId && !Store.page(p.parentId)?.deleted ? p.parentId : "home");
      else if (App.currentId && Store.page(App.currentId)) Editor.render();
    },
    copyLink(id) {
      const url = window.Cloud?.ws ? Cloud.linkFor(id) : location.href.split("#")[0] + "#/p/" + id;
      navigator.clipboard?.writeText(url).then(() => UI.toast("🔗 Link copied"), () => UI.toast(url));
    },
    toggleFav() {
      const p = Store.page(App.currentId); if (!p) return;
      p.favorite = !p.favorite; Store.save(); Sidebar.render(); App.syncTopbar();
      UI.toast(p.favorite ? "⭐ Added to favorites" : "Removed from favorites");
    },
    syncTopbar() {
      const p = Store.page(App.currentId), fav = document.getElementById("favBtn");
      fav.classList.toggle("on", !!p?.favorite);
      ["favBtn", "pageMenuBtn", "shareBtn", "outlineBtn"].forEach(x => (document.getElementById(x).style.display = p ? "" : "none"));
    },
    syncTitle() { const p = Store.page(App.currentId); const t = document.querySelector(".page-title"); if (p && t && document.activeElement !== t) t.textContent = p.title; },
    refreshCrumbs() {
      const bc = document.getElementById("breadcrumbs"); bc.innerHTML = "";
      const p = Store.page(App.currentId);
      if (!p) { bc.append(h("span", { class: "crumb", text: App.currentId === "home" ? "🏠 Home" : "" })); return; }
      const chain = [...Store.ancestors(p.id), p];
      const show = chain.length > 3 ? [chain[0], null, ...chain.slice(-2)] : chain;
      show.forEach((c, i) => {
        if (i) bc.append(h("span", { class: "crumb-sep", text: "/" }));
        bc.append(c ? h("button", { class: "crumb", onclick: () => App.go(c.id) }, h("span", { text: c.icon || "📄" }), h("span", { text: c.title || "Untitled" })) : h("span", { class: "crumb", text: "…" }));
      });
      document.title = (p.title || "Untitled") + " · Lumen";
    },
    focusTitle() { const t = document.querySelector(".page-title"); if (t) Editor.setCaret(t, "end"); },
    updateOutline: d => Page.updateOutline(d),
    toggleSidebar(force) {
      const open = force ?? document.body.classList.contains("sb-closed");
      document.body.classList.toggle("sb-closed", !open); S().sbOpen = open; Store.save();
    },
    toggleOutline() { document.body.classList.toggle("show-outline"); Page.updateOutline(); },
    toggleTheme() { S().theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; applySettings(); Store.save(); },
    focusMode() {
      const on = !document.body.classList.contains("sb-closed") || !document.body.classList.contains("focus");
      document.body.classList.toggle("focus", on); App.toggleSidebar(!on);
      UI.toast(on ? "🎯 Focus mode on — Ctrl+\\ to bring the sidebar back" : "Focus mode off");
    },
    settings,

    /* ----- shared workspaces ----- */
    booted: false,
    bootLocal() { if (!App.booted) boot(); },
    onWorkspaceChange(pageId) {
      App.booted = true;
      const target = pageId && Store.page(pageId) ? pageId : (Store.state.recent?.[0] && Store.page(Store.state.recent[0]) ? Store.state.recent[0] : "home");
      if (location.hash !== "#/p/" + target) history.replaceState(null, "", "#/p/" + target);
      applySettings(); App.currentId = null; route();
    },
    remoteUpdate({ pages, tree }) {
      if (tree) Sidebar.render();
      App.refreshCrumbs(); App.syncTopbar();
      const cur = App.currentId;
      if (!cur || cur === "home") return;
      const p = Store.page(cur);
      if (!p || p.deleted) { UI.toast("This page was removed by a collaborator"); return App.go("home"); }
      if (pages?.includes(cur)) App.refreshPage();
    },
    refreshPage() {
      clearTimeout(refreshTimer);
      const p = Store.page(App.currentId); if (!p || App.currentId === "home") return;
      // don't yank menus, side panels or the slash menu out from under the user; retry shortly
      if (document.querySelector("#layer .pop, #layer .peek, #layer .backdrop") || EditorMenus.isSlashOpen()) { refreshTimer = setTimeout(App.refreshPage, 1200); return; }
      const v = document.getElementById("view"), sc = document.getElementById("scroller"), ae = document.activeElement, top = sc.scrollTop;
      let restore = null;
      if (ae && v.contains(ae)) {
        const bc = ae.closest(".block-content:not(.toggle-body):not(.caption)");
        if (bc && !bc.closest(".t-database")) { const id = bc.closest(".block").dataset.id, off = Editor.caretOffset(bc); restore = () => { const el = Editor.contentOf(id); el && Editor.setCaret(el, off); }; }
        else if (ae.classList.contains("page-title")) { const off = Editor.caretOffset(ae); restore = () => { const t = document.querySelector(".page-title"); t && Editor.setCaret(t, off); }; }
        else { ae.addEventListener("blur", () => { refreshTimer = setTimeout(App.refreshPage, 150); }, { once: true }); return; }
      }
      Page.renderPage(p, true); sc.scrollTop = top; restore && restore();
    },
  };
  let refreshTimer;
  window.App = App;

  function route() {
    UI.closePops();
    const wsLink = location.hash.match(/^#\/ws\/([^/]+)(?:\/p\/(.+))?$/);
    if (wsLink) {
      if (window.Cloud?.ws?.id === wsLink[1]) { history.replaceState(null, "", "#/p/" + (wsLink[2] || "home")); }
      else if (window.Cloud?.configured) {
        history.replaceState(null, "", "#/p/home");
        const [, wsId, pid] = wsLink;
        if (Cloud.user) Cloud.open(wsId, pid);
        else {
          const m = UI.modal("Join a shared workspace", h("div", null,
            h("p", { style: { marginTop: 0, color: "var(--muted)" }, text: "Sign in with the Google account that was invited to open this workspace." }),
            h("button", { class: "btn primary", text: "Sign in with Google", onclick: async () => { m.close(); if (await Cloud.signIn()) Cloud.open(wsId, pid); } })));
          m.el.style.width = "420px";
        }
      }
      else history.replaceState(null, "", "#/p/home");
    }
    const m = location.hash.match(/^#\/p\/(.+)$/);
    let id = m ? decodeURIComponent(m[1]) : "home";
    const p = Store.page(id);
    if (id !== "home" && (!p || p.deleted)) { if (p?.deleted) UI.toast("That page is in the trash"); id = "home"; history.replaceState(null, "", "#/p/home"); }
    App.currentId = id;
    document.getElementById("scroller").scrollTop = 0;
    if (id === "home") { Page.renderHome(); document.title = "Home · Lumen"; document.body.classList.remove("show-outline"); }
    else { Sidebar.expandTo(id); Store.visit(id); Page.renderPage(Store.page(id)); }
    Sidebar.render(); App.refreshCrumbs(); App.syncTopbar();
    window.Cloud?.here?.(); window.Cloud?.renderPresence?.();
  }

  function applySettings() {
    const s = S(), root = document.documentElement;
    const theme = s.theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : s.theme;
    root.dataset.theme = theme;
    root.style.setProperty("--accent", s.accent);
    root.style.setProperty("--blur", s.blur + "px");
    root.style.setProperty("--sb-w", (s.sbWidth || 268) + "px");
    document.body.classList.toggle("no-motion", !s.motion);
    document.body.classList.toggle("sb-closed", s.sbOpen === false);
    const tt = document.querySelector(".theme-toggle span"); if (tt) tt.textContent = theme === "dark" ? "Light mode" : "Dark mode";
  }

  function settings() {
    const s = S();
    const seg = (key, opts) => h("div", { class: "seg" }, ...opts.map(([v, l]) => h("button", { class: s[key] === v ? "on" : "", text: l, onclick: e => {
      s[key] = v; applySettings(); Store.save(); e.currentTarget.parentElement.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.currentTarget)); } })));
    const row = (title, desc, ctl) => h("div", { class: "set-row" }, h("div", { class: "l" }, h("b", { text: title }), h("span", { text: desc })), ctl);
    const accents = h("div", { class: "accents" }, ...ACCENTS.map(c => h("button", { class: s.accent === c ? "on" : "", style: { background: c, color: c }, onclick: e => {
      s.accent = c; applySettings(); Store.save(); accents.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.currentTarget)); } })));
    const blur = h("input", { type: "range", min: 0, max: 60, value: s.blur });
    blur.addEventListener("input", () => { s.blur = +blur.value; applySettings(); Store.save(); });
    const motion = h("span", { class: "switch" + (s.motion ? " on" : ""), style: { cursor: "pointer" }, onclick: () => { s.motion = !s.motion; motion.classList.toggle("on", s.motion); applySettings(); Store.save(); } });
    const ws = h("input", { class: "menu-input", value: Store.getName(), style: { width: "200px", margin: 0 } });
    ws.addEventListener("input", () => { Store.setName(ws.value || "My Workspace"); Sidebar.render(); });
    const file = h("input", { type: "file", accept: ".json", style: { display: "none" } });
    file.addEventListener("change", () => { const f = file.files[0]; if (!f) return; f.text().then(t => { try { Store.importAll(t); m.close(); boot(); UI.toast("Workspace imported"); } catch (e) { UI.toast("Import failed: " + e.message); } }); });
    const body = h("div", null,
      row("Workspace name", "Shown at the top of the sidebar", ws),
      row("Appearance", "Light, dark or follow your system", seg("theme", [["light", "Light"], ["dark", "Dark"], ["system", "System"]])),
      row("Accent color", "Used for highlights, checkboxes and buttons", accents),
      row("Glass blur", "How frosted the panels look", blur),
      row("Animations", "Aurora background and motion effects", motion),
      row("Backup", "Download or restore your whole workspace", h("div", { style: { display: "flex", gap: "6px" } },
        h("button", { class: "btn", text: "Export", onclick: () => { const a = h("a", { href: URL.createObjectURL(new Blob([Store.exportAll()], { type: "application/json" })), download: "lumen-workspace.json" }); document.body.append(a); a.click(); a.remove(); } }),
        h("button", { class: "btn", text: "Import", onclick: () => file.click() }), file)),
      row("Reset", "Replace everything with the demo workspace", h("button", { class: "btn danger", text: "Reset…", onclick: async () => { if (await UI.confirm("This erases all pages in this browser and restores the demo workspace. This can't be undone.", "Reset")) { Store.reset(); boot(); UI.toast("Workspace reset"); } } })),
      h("div", { class: "menu-sec", style: { marginTop: "14px" }, text: "Keyboard shortcuts" }),
      h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 20px", fontSize: "13px", color: "var(--muted)" } },
        ...[["Search / commands", "Ctrl K"], ["New page", "Ctrl Alt N"], ["Toggle sidebar", "Ctrl \\"], ["Toggle theme", "Ctrl Shift L"], ["Slash menu", "/"], ["Move block", "Ctrl Shift ↑↓"],
          ["Indent / outdent", "Tab / Shift Tab"], ["Duplicate block", "Ctrl D"], ["Inline code", "Ctrl E"], ["Turn into heading", "Ctrl Alt 1-3"], ["Select block", "Esc"], ["Delete selected block", "Backspace"]]
          .map(([a, k]) => h("div", { style: { display: "flex", justifyContent: "space-between" } }, h("span", { text: a }), h("kbd", { text: k })))));
    const m = UI.modal("Settings", body);
  }

  function shortcuts(e) {
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === "k") {
      e.preventDefault();
      const s = getSelection();
      if (!s.isCollapsed && s.anchorNode?.parentElement?.closest(".block-content")) return document.querySelector(".fmt-bar button[title=Link]")?.click();
      return Palette.show();
    }
    if (mod && k === "p" && !e.shiftKey) { e.preventDefault(); return Palette.show(); }
    if (mod && e.key === "\\") { e.preventDefault(); document.body.classList.remove("focus"); return App.toggleSidebar(); }
    if (mod && e.altKey && k === "n") { e.preventDefault(); return App.newPage(); }
    if (mod && e.shiftKey && k === "l") { e.preventDefault(); return App.toggleTheme(); }
  }

  function bindShell() {
    document.querySelectorAll("[data-action]").forEach(b => b.addEventListener("click", e => {
      const a = b.dataset.action;
      if (a === "search") Palette.show(); else if (a === "home") App.go("home"); else if (a === "settings") settings();
      else if (a === "new") App.newPage(); else if (a === "trash") Page.trashModal(); else if (a === "templates") Page.templatesModal();
      else if (a === "theme") App.toggleTheme();
    }));
    document.getElementById("collapseSidebar").onclick = () => App.toggleSidebar(false);
    document.getElementById("openSidebar").onclick = () => { document.body.classList.remove("focus"); App.toggleSidebar(true); };
    document.getElementById("favBtn").onclick = App.toggleFav;
    document.getElementById("outlineBtn").onclick = App.toggleOutline;
    document.getElementById("pageMenuBtn").onclick = e => Page.pageMenu(e.currentTarget);
    document.getElementById("shareBtn").onclick = e => {
      if (window.Cloud?.ws) return Cloud.share(e.currentTarget);
      const p = Store.page(App.currentId);
      UI.menu(e.currentTarget, [{ section: "Share" },
        { label: "Copy link", icon: "link", onClick: () => App.copyLink(p.id) },
        { label: "Share with friends…", icon: "plus", onClick: () => window.Cloud ? Cloud.share(e.currentTarget) : UI.toast("Sharing is still loading") },
        { label: "Copy as Markdown", icon: "copy", onClick: () => { navigator.clipboard?.writeText(Page.toMd(p)); UI.toast("Markdown copied"); } },
        { el: h("div", { class: "menu-empty", style: { maxWidth: "240px", fontSize: "12px" }, text: "This workspace is private to this browser. Share with friends to move it into a shared workspace everyone can edit live." }) }], { align: "end" });
    };
    document.getElementById("wsSwitch").onclick = e => UI.menu(e.currentTarget, [
      ...(window.Cloud ? Cloud.workspaceMenuItems() : []), { sep: true },
      { label: "Settings", icon: "dots", onClick: settings }, { label: "Templates", icon: "gallery", onClick: Page.templatesModal }, { label: "Trash", icon: "trash", onClick: Page.trashModal }]);
    const scroller = document.getElementById("scroller");
    scroller.addEventListener("scroll", () => document.getElementById("main").classList.toggle("scrolled", scroller.scrollTop > 4), { passive: true });
    document.getElementById("view").addEventListener("input", e => { if (e.target.closest(".blocks")) document.querySelector(".tpl-pick")?.remove(); });
    document.getElementById("main").addEventListener("click", e => { if (innerWidth < 760 && !document.body.classList.contains("sb-closed") && !e.target.closest("#topbar")) App.toggleSidebar(false); });
    addEventListener("hashchange", route);
    addEventListener("keydown", shortcuts);
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applySettings);
    Sidebar.initResizer();
  }

  function boot() { App.booted = true; applySettings(); App.currentId = null; route(); }

  bindShell();
  if (innerWidth < 760) S().sbOpen = false;
  applySettings();
  // If a shared workspace will open (last used, or an invite link), wait for cloud.js instead of flashing the private one.
  const cloudPending = window.FIREBASE_CONFIG?.apiKey && (localStorage.getItem("lumen-active-ws") || location.hash.startsWith("#/ws/"));
  if (cloudPending) {
    document.getElementById("view").innerHTML = '<div class="big-empty" style="padding-top:30vh"><div>👥</div>Opening shared workspace…</div>';
    setTimeout(() => App.bootLocal(), 8000);
  } else boot();
})();
