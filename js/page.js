/* Page views: document page, home, trash, templates, page menu, outline, export */
(function () {
  const { h, icon, esc } = UI;
  const view = () => document.getElementById("view");

  function renderPage(p) {
    const v = view(); v.innerHTML = "";
    const pageEl = h("div", { class: "page" + (p.fullWidth ? " full" : "") + (p.smallText ? " small" : "") + (p.font !== "default" ? " f-" + p.font : "") });
    const wrap = h("div", { class: p.cover ? "has-cover" : "" });
    if (p.cover) {
      const cover = h("div", { class: "cover", style: { background: p.cover.startsWith("url(") ? `${p.cover} center/cover` : p.cover } });
      if (!p.locked) cover.append(h("div", { class: "cover-acts" },
        h("button", { text: "Change cover", onclick: e => UI.coverPicker(e.target, c => { p.cover = c; Store.touch(p.id); renderPage(p); }) }),
        h("button", { text: "Remove", onclick: () => { p.cover = ""; Store.touch(p.id); renderPage(p); } })));
      v.append(cover);
    }
    const head = h("div", { class: "page-head" });
    if (p.icon) head.append(h("div", { class: "page-icon", text: p.icon, onclick: e => !p.locked && UI.emojiPicker(e.currentTarget, em => setIcon(p, em), { remove: true }) }));
    if (!p.locked) head.append(h("div", { class: "head-acts" },
      !p.icon ? h("button", { html: icon("smile") + "Add icon", onclick: e => UI.emojiPicker(e.currentTarget, em => setIcon(p, em), { remove: true }) }) : null,
      !p.cover ? h("button", { html: icon("image") + "Add cover", onclick: () => { p.cover = Store.COVERS[Math.floor(Math.random() * Store.COVERS.length)]; Store.touch(p.id); renderPage(p); } }) : null,
      h("button", { html: icon("lock") + "Lock page", onclick: () => toggleLock(p) })));
    const title = h("div", { class: "page-title", contenteditable: !p.locked, spellcheck: "false", text: p.title });
    title.addEventListener("input", () => { p.title = title.textContent; Store.touch(p.id); Sidebar.render(); App.refreshCrumbs(); document.title = (p.title || "Untitled") + " · Lumen"; });
    title.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); const first = p.blocks[0]; if (first && Editor.TEXT.has(first.type) && !Store.plainText(first.text)) Editor.focus(first.id, "start"); else { const nb = Store.block("p"); p.blocks.unshift(nb); Editor.markNew(nb.id); Editor.render(); Editor.focus(nb.id, "start"); } }
      if (e.key === "ArrowDown") { const f = p.blocks.find(b => Editor.TEXT.has(b.type)); if (f) { e.preventDefault(); Editor.focus(f.id, "start"); } }
    });
    title.addEventListener("paste", e => { e.preventDefault(); document.execCommand("insertText", false, e.clipboardData.getData("text/plain").replace(/\n/g, " ")); });
    head.append(title, h("div", { class: "page-meta" },
      h("span", { text: "Edited " + UI.timeAgo(p.updatedAt) }), h("span", { id: "wordCount" }), p.locked ? h("span", { text: "🔒 Locked" }) : null));
    wrap.append(head);
    pageEl.append(wrap);

    const blocks = h("div", { class: "blocks" });
    pageEl.append(blocks);
    Editor.mount(blocks, p);
    if (!p.locked) {
      const add = h("div", { class: "add-below", html: icon("plus") + "Click to add a block" });
      add.addEventListener("click", () => {
        const last = p.blocks[p.blocks.length - 1];
        if (last && last.type === "p" && !Store.plainText(last.text)) return Editor.focus(last.id);
        const nb = Editor.insertAfter(last?.id); Editor.render(); Editor.focus(nb.id);
      });
      pageEl.append(add);
      // fill vertical space so clicking below the content focuses the end
      pageEl.addEventListener("mousedown", e => { if (e.target === pageEl && e.offsetY > blocks.offsetTop + blocks.offsetHeight) { e.preventDefault(); add.click(); } });
    }
    if (p.fresh && !p.locked) {
      const tp = h("div", { class: "tpl-pick" }, h("div", { class: "lbl", text: "Press Enter to continue with an empty page, or pick a template" }),
        ...Object.entries(Store.TEMPLATES).filter(([k]) => k !== "empty").map(([k, t]) => h("button", { onclick: () => { Store.applyTemplate(p.id, k); renderPage(p); } }, h("span", { text: t.icon }), t.name)));
      pageEl.append(tp);
    }
    v.append(pageEl);
    v.classList.remove("enter"); void v.offsetWidth; v.classList.add("enter");
    if (p.fresh) setTimeout(() => title.focus(), 60);
  }
  function setIcon(p, em) { p.icon = em; Store.touch(p.id); Sidebar.render(); App.refreshCrumbs(); renderPage(p); }
  function toggleLock(p) { p.locked = !p.locked; Store.touch(p.id); renderPage(p); UI.toast(p.locked ? "🔒 Page locked" : "🔓 Page unlocked"); }

  /* ---------- outline + stats ---------- */
  let outlineTimer;
  function updateOutline(debounced) {
    if (debounced) { clearTimeout(outlineTimer); outlineTimer = setTimeout(() => updateOutline(), 300); return; }
    const p = Editor.page, o = document.getElementById("outline"); if (!p || !o) return;
    o.innerHTML = ""; o.append(h("div", { class: "o-title", text: "On this page" }));
    const heads = p.blocks.filter(b => /^h[123]$/.test(b.type) && Store.plainText(b.text).trim());
    heads.forEach(b => o.append(h("a", { class: "l" + b.type[1], text: Store.plainText(b.text), onclick: () => {
      const el = Editor.elOf(b.id); el?.scrollIntoView({ behavior: "smooth", block: "center" }); el?.classList.remove("flash"); void el?.offsetWidth; el?.classList.add("flash");
    } })));
    if (!heads.length) o.append(h("div", { class: "menu-empty", text: "Add headings to build an outline." }));
    const text = p.blocks.map(b => b.type === "database" ? Database.plain(b.db) : Store.plainText(b.text) + " " + Store.plainText(b.body)).join(" ");
    const words = (text.match(/\S+/g) || []).length;
    const todos = p.blocks.filter(b => b.type === "todo"), done = todos.filter(b => b.checked).length;
    o.append(h("div", { class: "o-stats" }, h("span", { text: `${words} words · ${Math.max(1, Math.round(words / 220))} min read` }), h("span", { text: `${p.blocks.length} blocks` }),
      todos.length ? h("span", null, `${done}/${todos.length} to-dos done`, h("div", { class: "progress" }, h("span", { style: { width: (done / todos.length) * 100 + "%" } }))) : null));
    const wc = document.getElementById("wordCount"); if (wc) wc.textContent = `${words} words`;
  }

  /* ---------- page menu ---------- */
  function pageMenu(anchor) {
    const p = Store.page(App.currentId); if (!p) return;
    const fonts = h("div", { class: "seg", style: { margin: "4px 4px 8px" } }, ...[["default", "Default", "var(--font)"], ["serif", "Serif", "var(--serif)"], ["mono", "Mono", "var(--mono)"]].map(([f, l, ff]) =>
      h("button", { class: p.font === f ? "on" : "", style: { flex: 1, fontFamily: ff }, text: l, onclick: e => { p.font = f; Store.touch(p.id); e.currentTarget.parentElement.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.currentTarget)); renderPage(p); } })));
    UI.menu(anchor, [
      { section: "Style" }, { el: fonts },
      { label: "Small text", icon: "text", toggle: !!p.smallText, onClick: () => { p.smallText = !p.smallText; Store.touch(p.id); renderPage(p); } },
      { label: "Full width", icon: "expand", toggle: !!p.fullWidth, onClick: () => { p.fullWidth = !p.fullWidth; Store.touch(p.id); document.querySelector(".page")?.classList.toggle("full", p.fullWidth); } },
      { label: "Lock page", icon: "lock", toggle: !!p.locked, onClick: () => toggleLock(p) },
      { sep: true },
      { label: p.favorite ? "Remove from favorites" : "Add to favorites", icon: "star", onClick: () => App.toggleFav() },
      { label: "Duplicate", icon: "copy", onClick: () => { const c = Store.duplicate(p.id); App.go(c.id); UI.toast("Page duplicated"); } },
      { label: "Copy link", icon: "link", onClick: () => App.copyLink(p.id) },
      { label: "Export as Markdown", icon: "download", onClick: () => exportMd(p) },
      { label: "Print / PDF", icon: "page", onClick: () => print() },
      { sep: true },
      { label: "Move to trash", icon: "trash", danger: true, onClick: () => App.trashPage(p.id) },
      { el: h("div", { class: "menu-empty", style: { fontSize: "12px" } }, `Created ${new Date(p.createdAt).toLocaleString()}`, h("br"), `Edited ${UI.timeAgo(p.updatedAt)}`) },
    ], { align: "end" });
  }
  function toMd(p) {
    const t = s => Store.plainText((s || "").replace(/<br\s*\/?>/g, "\n").replace(/<(b|strong)>(.*?)<\/\1>/g, "**$2**").replace(/<(i|em)>(.*?)<\/\1>/g, "*$2*").replace(/<code>(.*?)<\/code>/g, "`$1`").replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g, "[$2]($1)"));
    let n = 0;
    const lines = [`# ${p.icon ? p.icon + " " : ""}${p.title || "Untitled"}`, ""];
    p.blocks.forEach(b => {
      const ind = "  ".repeat(b.indent || 0); n = b.type === "numbered" ? n + 1 : 0;
      const m = { p: t(b.text), h1: "# " + t(b.text), h2: "## " + t(b.text), h3: "### " + t(b.text), bullet: "- " + t(b.text), numbered: `${n}. ` + t(b.text),
        todo: `- [${b.checked ? "x" : " "}] ` + t(b.text), toggle: `<details><summary>${t(b.text)}</summary>\n\n${t(b.body)}\n</details>`, quote: "> " + t(b.text),
        callout: `> ${b.icon || "💡"} ${t(b.text)}`, divider: "---", code: "```" + (b.lang && b.lang !== "plain" ? b.lang : "") + "\n" + b.text + "\n```", image: `![${t(b.text)}](${b.url && !b.url.startsWith("data:") ? b.url : ""})`,
        page: `[${Store.page(b.pageId)?.title || "Untitled"}](#)` }[b.type];
      if (b.type === "database") {
        const d = b.db; lines.push(`### ${d.title}`, "", "| " + d.props.map(x => x.name).join(" | ") + " |", "|" + d.props.map(() => " --- |").join(""));
        d.rows.forEach(r => lines.push("| " + d.props.map(x => { const v = r.values[x.id]; return x.type === "select" ? x.options.find(o => o.id === v)?.name || "" : x.type === "multi" ? (v || []).map(id => x.options.find(o => o.id === id)?.name).join(", ") : v ?? ""; }).join(" | ") + " |"));
      } else if (m != null) lines.push(ind + m);
      lines.push("");
    });
    return lines.join("\n").replace(/\n{3,}/g, "\n\n");
  }
  function exportMd(p) {
    const blob = new Blob([toMd(p)], { type: "text/markdown" });
    const a = h("a", { href: URL.createObjectURL(blob), download: (p.title || "Untitled").replace(/[\\/:*?"<>|]/g, "") + ".md" });
    document.body.append(a); a.click(); a.remove(); UI.toast("Exported Markdown");
  }

  /* ---------- home ---------- */
  function renderHome() {
    const v = view(); v.innerHTML = "";
    const hr = new Date().getHours();
    const greet = hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
    const pages = Object.values(Store.state.pages).filter(p => !p.deleted);
    const card = (p, i) => h("button", { class: "card glass", style: { animationDelay: i * 50 + "ms" }, onclick: () => App.go(p.id) },
      h("div", { class: "c-cover", style: { background: p.cover ? (p.cover.startsWith("url(") ? p.cover + " center/cover" : p.cover) : "var(--hover)" } }),
      h("div", { class: "c-icon", text: p.icon || "📄" }), h("div", { class: "c-t", text: p.title || "Untitled" }), h("div", { class: "c-m", text: UI.timeAgo(p.updatedAt) }));
    const recent = (Store.state.recent || []).map(Store.page).filter(p => p && !p.deleted).slice(0, 8);
    const allTodos = pages.flatMap(p => p.blocks.filter(b => b.type === "todo" && !b.checked).map(b => ({ p, b }))).slice(0, 6);
    const home = h("div", { class: "home" }, h("h1", { text: `${greet} ✨` }), h("div", { class: "sub", text: new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) + ` · ${pages.length} pages` }));
    if (recent.length) home.append(h("h3", { html: "🕘 Recently visited" }), h("div", { class: "cards" }, ...recent.map(card)));
    home.append(h("h3", { html: "⭐ Favorites" }), h("div", { class: "cards" }, ...(pages.filter(p => p.favorite).map(card)), h("button", { class: "card glass", style: { display: "grid", placeItems: "center", minHeight: "120px", color: "var(--faint)" }, text: "+ New page", onclick: () => App.newPage() })));
    if (allTodos.length) {
      home.append(h("h3", { html: "✅ Open to-dos across your workspace" }));
      allTodos.forEach(({ p, b }, i) => home.append(h("div", { class: "list-row", style: { animationDelay: i * 40 + "ms" } },
        h("input", { type: "checkbox", style: { accentColor: "var(--accent)" }, onchange: e => { b.checked = e.target.checked; Store.touch(p.id); e.target.closest(".list-row").style.opacity = ".4"; } }),
        h("span", { class: "grow", html: b.text || "<i style='color:var(--faint)'>Empty to-do</i>", onclick: () => App.go(p.id) }), h("small", { text: (p.icon || "📄") + " " + (p.title || "Untitled") }))));
    }
    home.append(h("h3", { html: "🧩 Start from a template" }), h("div", { class: "cards" }, ...Object.entries(Store.TEMPLATES).map(([k, t], i) =>
      h("button", { class: "card glass", style: { animationDelay: i * 50 + "ms", padding: "14px" }, onclick: () => App.newPage(null, k) }, h("div", { style: { fontSize: "26px" }, text: t.icon }), h("div", { class: "c-t", style: { padding: "6px 0 0" }, text: t.name })))));
    v.append(home); v.classList.remove("enter"); void v.offsetWidth; v.classList.add("enter");
  }

  /* ---------- trash ---------- */
  function trashModal() {
    const list = h("div");
    const draw = () => {
      list.innerHTML = "";
      const items = Object.values(Store.state.pages).filter(p => p.deleted && !(p.parentId && Store.page(p.parentId)?.deleted)).sort((a, b) => b.deletedAt - a.deletedAt);
      if (!items.length) return list.append(h("div", { class: "big-empty" }, h("div", { text: "🗑️" }), "Trash is empty"));
      items.forEach((p, i) => list.append(h("div", { class: "list-row", style: { animationDelay: i * 30 + "ms" } },
        h("span", { text: p.icon || "📄" }), h("span", { class: "grow", text: p.title || "Untitled" }), h("small", { text: UI.timeAgo(p.deletedAt) }),
        h("button", { class: "icon-btn", title: "Restore", html: icon("restore"), onclick: () => { Store.restore(p.id); draw(); UI.toast("Page restored"); } }),
        h("button", { class: "icon-btn", title: "Delete forever", html: icon("trash"), onclick: async () => { if (await UI.confirm(`Permanently delete “${p.title || "Untitled"}” and its sub-pages? This can't be undone.`)) { Store.destroy(p.id); trashModal(); } } }))));
      list.append(h("div", { style: { textAlign: "right", marginTop: "12px" } }, h("button", { class: "btn danger", text: "Empty trash", onclick: async () => { if (await UI.confirm("Permanently delete everything in the trash? This can't be undone.", "Empty trash")) { items.forEach(p => Store.destroy(p.id)); trashModal(); } } })));
    };
    draw(); UI.modal("Trash", list);
  }
  function templatesModal() {
    const grid = h("div", { class: "cards" }, ...Object.entries(Store.TEMPLATES).map(([k, t], i) =>
      h("button", { class: "card glass", style: { animationDelay: i * 50 + "ms", padding: "16px" }, onclick: () => { m.close(); App.newPage(null, k); } },
        h("div", { style: { fontSize: "30px" }, text: t.icon }), h("div", { class: "c-t", style: { padding: "8px 0 2px" }, text: t.name }), h("div", { class: "c-m", style: { padding: 0 }, text: k === "empty" ? "Blank canvas" : "Pre-filled blocks" }))));
    const m = UI.modal("Templates", grid);
  }

  window.Page = { renderPage, renderHome, trashModal, templatesModal, pageMenu, updateOutline, toMd };
})();
