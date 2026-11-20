/* Sidebar: page tree with nesting, drag & drop, favorites, resizing */
(function () {
  const { h, icon } = UI;
  let expanded;
  try { expanded = new Set(JSON.parse(localStorage.getItem("lumen-expanded") || "[]")); } catch { expanded = new Set(); }
  const saveExpanded = () => { try { localStorage.setItem("lumen-expanded", JSON.stringify([...expanded])); } catch {} };
  let justOpened = null, dragId = null;

  function row(p, depth, inFav) {
    const kids = p.children.filter(c => Store.page(c) && !Store.page(c).deleted);
    const isOpen = expanded.has((inFav ? "f:" : "") + p.id);
    const r = h("div", { class: "tree-row" + (App.currentId === p.id ? " active" : ""), style: { paddingLeft: 4 + depth * 14 + "px" }, draggable: !inFav, dataset: { id: p.id } });
    const caret = h("span", { class: "caret" + (isOpen ? " open" : ""), html: `<svg class="ico sm" viewBox="0 0 24 24" style="width:12px"><path d="M9 6l6 6-6 6"/></svg>` });
    caret.addEventListener("click", e => {
      e.stopPropagation();
      const k = (inFav ? "f:" : "") + p.id;
      expanded.has(k) ? expanded.delete(k) : (expanded.add(k), (justOpened = k));
      saveExpanded(); render();
    });
    const acts = h("span", { class: "row-acts" },
      h("button", { class: "icon-btn xs", title: "More", html: icon("dots"), onclick: e => { e.stopPropagation(); rowMenu(p, e.currentTarget); } }),
      h("button", { class: "icon-btn xs", title: "Add a page inside", html: icon("plus"), onclick: e => {
        e.stopPropagation(); const np = Store.createPage(p.id); expanded.add(p.id); justOpened = p.id; saveExpanded(); App.go(np.id);
      } }));
    r.append(caret, h("span", { class: "p-icon", text: p.icon || "📄" }), h("span", { class: "p-title", text: p.title || "Untitled" }), acts);
    r.addEventListener("click", () => { App.go(p.id); if (innerWidth < 760) App.toggleSidebar(false); });

    if (!inFav) {
      r.addEventListener("dragstart", e => { dragId = p.id; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/lumen-page", p.id); r.style.opacity = ".4"; });
      r.addEventListener("dragend", () => { dragId = null; r.style.opacity = ""; clearDrop(); });
      r.addEventListener("dragover", e => {
        if (!dragId || dragId === p.id) return;
        e.preventDefault(); clearDrop();
        const rect = r.getBoundingClientRect();
        r.classList.add(e.clientY - rect.top < rect.height * .3 ? "drop-before" : "drop-in");
      });
      r.addEventListener("dragleave", () => r.classList.remove("drop-before", "drop-in"));
      r.addEventListener("drop", e => {
        e.preventDefault();
        const mode = r.classList.contains("drop-before") ? "before" : "inside";
        clearDrop();
        if (dragId && Store.move(dragId, p.id, mode)) {
          if (mode === "inside") { expanded.add(p.id); saveExpanded(); }
          UI.toast(mode === "inside" ? `Moved into ${p.title || "Untitled"}` : "Page moved");
          App.refreshCrumbs();
        }
      });
    }

    const frag = document.createDocumentFragment();
    frag.append(r);
    if (isOpen) {
      const box = h("div", { class: "tree-kids" + (justOpened === (inFav ? "f:" : "") + p.id ? " anim" : "") });
      if (kids.length) kids.forEach(c => box.append(row(Store.page(c), depth + 1, inFav)));
      else box.append(h("div", { class: "tree-empty", style: { paddingLeft: 30 + depth * 14 + "px" }, text: "No pages inside" }));
      frag.append(box);
    }
    return frag;
  }
  const clearDrop = () => document.querySelectorAll(".drop-before,.drop-in").forEach(x => x.classList.remove("drop-before", "drop-in"));

  function rowMenu(p, anchor) {
    UI.menu(anchor, [
      { label: p.favorite ? "Remove from favorites" : "Add to favorites", icon: "star", onClick: () => { p.favorite = !p.favorite; Store.save(); render(); App.syncTopbar(); } },
      { label: "Duplicate", icon: "copy", kbd: "Ctrl D", onClick: () => { const c = Store.duplicate(p.id); App.go(c.id); UI.toast("Page duplicated"); } },
      { label: "Rename", icon: "text", onClick: () => rename(p, anchor) },
      { label: "Copy link", icon: "link", onClick: () => App.copyLink(p.id) },
      { label: "Open in new tab", icon: "arrow", onClick: () => open(location.pathname + "#/p/" + p.id, "_blank") },
      { sep: true },
      { label: "Move to trash", icon: "trash", danger: true, onClick: () => App.trashPage(p.id) },
    ]);
  }
  function rename(p, anchor) {
    const inp = h("input", { class: "menu-input", value: p.title });
    const api = UI.popover(anchor, h("div", { style: { width: "260px" } }, inp));
    setTimeout(() => { inp.focus(); inp.select(); });
    inp.addEventListener("keydown", e => { if (e.key === "Enter") api.close(); });
    inp.addEventListener("input", () => { p.title = inp.value; Store.touch(p.id); render(); App.refreshCrumbs(); App.syncTitle(); });
  }

  function render() {
    const s = Store.state;
    const tree = document.getElementById("pageTree"), fav = document.getElementById("favTree");
    tree.innerHTML = ""; fav.innerHTML = "";
    s.root.map(Store.page).filter(p => p && !p.deleted).forEach(p => tree.append(row(p, 0)));
    if (!tree.children.length) tree.append(h("div", { class: "tree-empty", style: { paddingLeft: "10px" }, text: "No pages yet" }));
    const favs = Object.values(s.pages).filter(p => p.favorite && !p.deleted);
    document.getElementById("favSection").style.display = favs.length ? "" : "none";
    favs.forEach(p => fav.append(row(p, 0, true)));
    const t = Object.values(s.pages).filter(p => p.deleted).length;
    document.getElementById("trashCount").textContent = t || "";
    document.getElementById("wsName").textContent = Store.getName();
    const logo = document.querySelector(".ws-logo"), ic = Store.getIcon();
    if (ic) { logo.textContent = ic; logo.classList.add("emoji"); logo.classList.remove("brand"); }
    else { logo.innerHTML = '<img src="assets/logo.svg" alt="">'; logo.classList.add("brand"); logo.classList.remove("emoji"); }
    justOpened = null;
  }

  function expandTo(id) {
    let changed = false;
    Store.ancestors(id).forEach(a => { if (!expanded.has(a.id)) { expanded.add(a.id); changed = true; } });
    if (changed) saveExpanded();
  }

  function initResizer() {
    const rz = document.getElementById("sbResizer");
    rz.addEventListener("mousedown", e => {
      e.preventDefault(); document.body.classList.add("resizing");
      const move = ev => {
        const w = Math.max(200, Math.min(420, ev.clientX - 10));
        document.documentElement.style.setProperty("--sb-w", w + "px"); Store.state.settings.sbWidth = w;
      };
      const up = () => { document.body.classList.remove("resizing"); removeEventListener("mousemove", move); removeEventListener("mouseup", up); Store.save(); };
      addEventListener("mousemove", move); addEventListener("mouseup", up);
    });
    rz.addEventListener("dblclick", () => { document.documentElement.style.setProperty("--sb-w", "268px"); Store.state.settings.sbWidth = 268; Store.save(); });
  }

  window.Sidebar = { render, expandTo, initResizer };
})();
