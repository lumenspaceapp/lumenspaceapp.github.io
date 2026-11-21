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
      if (!p) {
        const app = String(App.currentId || "").startsWith("app:") && window.Apps?.reg[App.currentId.slice(4)];
        bc.append(h("span", { class: "crumb", text: app ? app.icon + " " + app.title : App.currentId === "home" ? "🏠 Home" : "" })); return;
      }
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
      document.body.classList.toggle("sb-closed", !open);
      if (innerWidth >= 760) { S().sbOpen = open; Store.save(); } // on phones the drawer state is temporary
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
      window.Data?.reset(); window.Data?.syncMe(); window.Apps?.rewatch?.();
      if (!pageId && location.hash.startsWith("#/app/")) { applySettings(); App.currentId = null; return route(); }
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
  App.applySettings = () => applySettings();
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
    const am = location.hash.match(/^#\/app\/([^/]+)(?:\/(.+))?$/);
    if (am && window.Apps) {
      App.currentId = "app:" + am[1]; document.body.classList.remove("show-outline");
      document.getElementById("scroller").scrollTop = 0;
      Apps.render(am[1], am[2]); Sidebar.render(); App.refreshCrumbs(); App.syncTopbar(); window.Cloud?.here?.();
      return;
    }
    window.Apps?.leave();
    const m = location.hash.match(/^#\/p\/(.+)$/);
    let id = m ? decodeURIComponent(m[1]) : "home";
    const p = Store.page(id);
    if (id !== "home" && !window.FEATURES.pages) { id = "home"; history.replaceState(null, "", "#/p/home"); } // pages are switched off
    else if (id !== "home" && (!p || p.deleted)) { if (p?.deleted) UI.toast("That page is in the trash"); id = "home"; history.replaceState(null, "", "#/p/home"); }
    App.currentId = id;
    document.getElementById("scroller").scrollTop = 0;
    if (id === "home") { window.Apps?.reg.home ? Apps.render("home") : Page.renderHome(); document.title = "Home · Lumen"; document.body.classList.remove("show-outline"); }
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
    if (s.glass != null) root.style.setProperty("--ga", s.glass / 100); else root.style.removeProperty("--ga");
    root.style.setProperty("--sb-w", (s.sbWidth || 268) + "px");
    document.body.classList.toggle("no-motion", !s.motion);
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
    const blurVal = h("span", { class: "set-val", text: s.blur + "px" });
    blur.addEventListener("input", () => { s.blur = +blur.value; blurVal.textContent = s.blur + "px"; applySettings(); Store.save(); });
    const glassNow = s.glass ?? Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ga")) * 100 || 52);
    const glass = h("input", { type: "range", min: 15, max: 90, value: glassNow });
    const glassVal = h("span", { class: "set-val", text: (100 - glassNow) + "%" });
    glass.addEventListener("input", () => { s.glass = +glass.value; glassVal.textContent = (100 - s.glass) + "%"; applySettings(); Store.save(); });
    // profile: avatar + name, editable any time
    const me = window.Data ? Data.me() : { name: "You" };
    const avBox = h("span");
    const paintAv = () => avBox.replaceChildren(Apps.avatar(Data.me(), 44));
    paintAv();
    const nameIn = h("input", { class: "menu-input", value: me.name, style: { width: "180px", margin: 0 }, disabled: !!(window.Cloud?.user), title: window.Cloud?.user ? "Your name comes from your Google account" : "" });
    nameIn.addEventListener("input", () => { s.userName = nameIn.value || "You"; Data.update("people", "me", { name: s.userName }); Store.save(); });
    const profile = h("div", { class: "set-row" },
      h("div", { class: "set-profile" }, avBox, h("div", { class: "grow" }, h("b", { text: "Your profile" }), h("small", { text: window.Cloud?.user ? Cloud.user.email : "Shown on your posts, tasks and messages" }))),
      h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } }, nameIn,
        h("button", { class: "btn primary", text: "Change avatar", onclick: async () => { await Apps.chooseAvatar(); paintAv(); } })));
    const motion = h("span", { class: "switch" + (s.motion ? " on" : ""), style: { cursor: "pointer" }, onclick: () => { s.motion = !s.motion; motion.classList.toggle("on", s.motion); applySettings(); Store.save(); } });
    const ws = h("input", { class: "menu-input", value: Store.getName(), style: { width: "200px", margin: 0 }, disabled: !!(window.Apps?.can && !Apps.can("settings", "edit")), title: window.Apps?.can && !Apps.can("settings", "edit") ? "Only admins can rename the workspace" : "" });
    ws.addEventListener("input", () => { Store.setName(ws.value || "My Workspace"); Sidebar.render(); });
    const file = h("input", { type: "file", accept: ".json", style: { display: "none" } });
    file.addEventListener("change", () => { const f = file.files[0]; if (!f) return; f.text().then(t => { try { Store.importAll(t); m.close(); boot(); UI.toast("Workspace imported"); } catch (e) { UI.toast("Import failed: " + e.message); } }); });
    const body = h("div", null,
      profile,
      row("Workspace name", "Shown at the top of the sidebar", ws),
      window.Cloud?.ws && window.Apps?.Access && Apps.isAdmin?.() ? row("Access & roles", "Who is an admin, member or guest, and what each role can open", h("button", { class: "btn", text: "Manage access", onclick: () => { m.close(); Apps.Access.open(); } })) : null,
      row("Appearance", "Light, dark or follow your system", seg("theme", [["light", "Light"], ["dark", "Dark"], ["system", "System"]])),
      row("Accent color", "Used for highlights, checkboxes and buttons", accents),
      row("Glass blur", "How frosted the panels look", h("span", { class: "set-ctl" }, blur, blurVal)),
      row("Glass transparency", "How much of the background shows through", h("span", { class: "set-ctl" }, glass, glassVal)),
      row("Animations", "Aurora background and motion effects", motion),
      h("div", { class: "menu-sec", style: { marginTop: "14px" }, text: "Notifications" }),
      ...(window.Notify ? Notify.settingsRows(row) : []),
      h("div", { class: "menu-sec", style: { marginTop: "14px" }, text: "Workspace" }),
      !window.FEATURES.pages ? null : row("Backup", "Download or restore your whole workspace", h("div", { style: { display: "flex", gap: "6px" } },
        h("button", { class: "btn", text: "Export", onclick: () => { const a = h("a", { href: URL.createObjectURL(new Blob([Store.exportAll()], { type: "application/json" })), download: "lumen-workspace.json" }); document.body.append(a); a.click(); a.remove(); } }),
        h("button", { class: "btn", text: "Import", onclick: () => file.click() }), file)),
      !window.FEATURES.pages ? null : row("Reset", "Replace everything with the demo workspace", h("button", { class: "btn danger", text: "Reset…", onclick: async () => { if (await UI.confirm("This erases all pages in this browser and restores the demo workspace. This can't be undone.", "Reset")) { Store.reset(); boot(); UI.toast("Workspace reset"); } } })),
      h("div", { class: "menu-sec", style: { marginTop: "14px" }, text: "Keyboard shortcuts" }),
      h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 20px", fontSize: "13px", color: "var(--muted)" } },
        ...(window.FEATURES.pages ? [["Search / commands", "Ctrl K"], ["New page", "Ctrl Alt N"], ["Toggle sidebar", "Ctrl \\"], ["Toggle theme", "Ctrl Shift L"], ["Slash menu", "/"], ["Move block", "Ctrl Shift ↑↓"],
          ["Indent / outdent", "Tab / Shift Tab"], ["Duplicate block", "Ctrl D"], ["Inline code", "Ctrl E"], ["Turn into heading", "Ctrl Alt 1-3"], ["Select block", "Esc"], ["Delete selected block", "Backspace"]]
          : [["Search", "Ctrl K"], ["Toggle sidebar", "Ctrl \\"], ["Toggle theme", "Ctrl Shift L"], ["Ask Lumi", "Ctrl /"], ["Send a chat message", "Enter"], ["New line in chat", "Shift Enter"]])
          .map(([a, k]) => h("div", { style: { display: "flex", justifyContent: "space-between" } }, h("span", { text: a }), h("kbd", { text: k })))));
    const m = UI.modal("Settings", body, { backdropClass: "clear" }); // keep the page visible so glass changes show live
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
    if (mod && e.altKey && k === "n" && window.FEATURES.pages) { e.preventDefault(); return App.newPage(); }
    if (mod && e.shiftKey && k === "l") { e.preventDefault(); return App.toggleTheme(); }
  }

  function bindShell() {
    document.querySelectorAll("[data-action]").forEach(b => b.addEventListener("click", e => {
      const a = b.dataset.action;
      if (innerWidth < 760 && a !== "theme") App.toggleSidebar(false);
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
      const anchor = e.currentTarget; // e.currentTarget is null once the click has finished
      if (window.Cloud?.ws) return Cloud.share(anchor);
      const p = Store.page(App.currentId);
      UI.menu(anchor, [{ section: "Share" },
        { label: "Copy link", icon: "link", onClick: () => App.copyLink(p.id) },
        { label: "Share with friends…", icon: "plus", onClick: () => window.Cloud ? Cloud.share(anchor) : UI.toast("Sharing is still loading") },
        { label: "Copy as Markdown", icon: "copy", onClick: () => { navigator.clipboard?.writeText(Page.toMd(p)); UI.toast("Markdown copied"); } },
        { el: h("div", { class: "menu-empty", style: { maxWidth: "240px", fontSize: "12px" }, text: "This workspace is private to this browser. Share with friends to move it into a shared workspace everyone can edit live." }) }], { align: "end" });
    };
    document.getElementById("wsSwitch").onclick = e => UI.menu(e.currentTarget, [
      ...(window.Cloud ? Cloud.workspaceMenuItems() : []), { sep: true },
      { label: "Settings", icon: "dots", onClick: settings },
      ...(window.FEATURES.pages ? [{ label: "Templates", icon: "gallery", onClick: Page.templatesModal }, { label: "Trash", icon: "trash", onClick: Page.trashModal }] : [])]);
    const scroller = document.getElementById("scroller");
    scroller.addEventListener("scroll", () => document.getElementById("main").classList.toggle("scrolled", scroller.scrollTop > 4), { passive: true });
    document.getElementById("view").addEventListener("input", e => { if (e.target.closest(".blocks")) document.querySelector(".tpl-pick")?.remove(); });
    document.getElementById("main").addEventListener("click", e => { if (innerWidth < 760 && !document.body.classList.contains("sb-closed") && !e.target.closest("#topbar")) App.toggleSidebar(false); });
    addEventListener("hashchange", route);
    addEventListener("keydown", shortcuts);
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applySettings);
    Sidebar.initResizer();
  }

  const syncSidebar = () => document.body.classList.toggle("sb-closed", innerWidth < 760 || S().sbOpen === false);
  function boot() { App.booted = true; applySettings(); syncSidebar(); App.currentId = null; route(); }
  window.Apps?.init();

  bindShell();
  applySettings(); syncSidebar();
  // If a shared workspace will open (last used, or an invite link), wait for cloud.js instead of flashing the private one.
  const lastWs = localStorage.getItem("lumen-active-ws");
  const cloudPending = window.FIREBASE_CONFIG?.apiKey && ((lastWs && lastWs !== "local") || location.hash.startsWith("#/ws/"));
  if (cloudPending) {
    document.getElementById("view").innerHTML = '<div class="big-empty" style="padding-top:30vh"><div>👥</div>Opening shared workspace…</div>';
    setTimeout(() => App.bootLocal(), 8000);
  } else boot();
  // First visit in this browser (and not arriving from an invite): run the Notion-style setup wizard.
  if (Store.firstRun && !cloudPending && location.hash !== "#/migrate" && !/[?&]ws=/.test(location.search)) setTimeout(() => Onboarding.firstRun(), 500);
})();

// install-as-app + offline support (only on the real https site, not local previews)
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
