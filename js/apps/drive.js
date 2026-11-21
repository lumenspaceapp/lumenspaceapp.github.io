/* Drive: shared folders and files. Files up to ~700 KB are stored in the workspace; bigger ones can be added as links. */
(function () {
  const { h, esc } = UI;
  const MAX = 700 * 1024;
  const ICON = t => /^image\//.test(t) ? "🖼️" : /pdf/.test(t) ? "📕" : /sheet|excel|csv/.test(t) ? "📊" : /word|document/.test(t) ? "📘" : /presentation|powerpoint/.test(t) ? "📙" : /zip|compressed/.test(t) ? "🗜️" : /video/.test(t) ? "🎬" : /audio/.test(t) ? "🎵" : /^text\//.test(t) ? "📄" : t === "link" ? "🔗" : "📎";
  const size = n => !n ? "" : n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(0) + " KB" : (n / 1048576).toFixed(1) + " MB";

  function render(root, arg) {
    let folder = arg || "", q = "", grid = localStorage.getItem("lumen-drive-view") !== "list";
    const crumbs = h("div", { class: "drive-crumbs" }), body = h("div", { class: "drive-body" });
    const file = h("input", { type: "file", multiple: true, style: { display: "none" }, onchange: () => { upload([...file.files]); file.value = ""; } });
    const viewBtn = h("button", { class: "btn", onclick: () => { grid = !grid; localStorage.setItem("lumen-drive-view", grid ? "grid" : "list"); draw(); } });
    root.append(Apps.header("Drive", "🗂️", "Shared files and folders", h("button", { class: "btn", text: "+ Folder", onclick: newFolder }), h("button", { class: "btn", text: "🔗 Add link", onclick: addLink }), h("button", { class: "btn primary", text: "⬆ Upload", onclick: () => file.click() }), file),
      h("div", { class: "app-toolbar" }, crumbs, h("span", { class: "grow" }), h("input", { class: "app-search", placeholder: "Search files…", oninput: e => { q = e.target.value.toLowerCase(); draw(); } }), viewBtn), body);
    // drag & drop upload
    root.addEventListener("dragover", e => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); body.classList.add("drop"); } });
    root.addEventListener("dragleave", e => { if (!root.contains(e.relatedTarget)) body.classList.remove("drop"); });
    root.addEventListener("drop", e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); body.classList.remove("drop"); upload([...e.dataTransfer.files]); });

    async function upload(files) {
      for (const f of files) {
        if (f.size > MAX) { UI.toast(`“${f.name}” is ${size(f.size)}. The free plan stores files up to 700 KB; add big files as a link instead.`); continue; }
        const data = await new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(f); });
        await Data.add("files", { name: f.name, type: f.type || "application/octet-stream", size: f.size, data, folder });
        UI.toast("⬆ Uploaded " + f.name);
      }
    }
    async function newFolder() { const v = await Apps.form("New folder", [{ key: "name", label: "Folder name", required: true }]); if (v) Data.add("folders", { name: v.name, parent: folder }); }
    async function addLink() {
      const v = await Apps.form("Add a link", [{ key: "name", label: "Name", required: true, placeholder: "Design files (Google Drive)" }, { key: "url", label: "URL", type: "url", required: true, placeholder: "https://…" }]);
      if (v) Data.add("files", { name: v.name, type: "link", url: /^https?:/.test(v.url) ? v.url : "https://" + v.url, folder });
    }
    function path(id) { const out = []; let f = Data.get("folders", id), g = 0; while (f && g++ < 20) { out.unshift(f); f = Data.get("folders", f.parent); } return out; }
    function open(f) {
      if (f.type === "link") return window.open(f.url, "_blank", "noopener");
      const prev = /^image\//.test(f.type) ? h("img", { src: f.data, class: "fp-img" }) : /pdf/.test(f.type) ? h("iframe", { src: f.data, class: "fp-frame" }) : /^text\//.test(f.type) ? h("pre", { class: "fp-text", text: atob(f.data.split(",")[1] || "").slice(0, 20000) }) : h("div", { class: "app-empty" }, h("div", { class: "ae-ic", text: ICON(f.type) }), "No preview for this file type");
      const m = UI.modal(f.name, h("div", null, prev, h("div", { class: "fp-meta" }, `${size(f.size)} · uploaded by ${Data.person(f.by).name} · ${UI.timeAgo(f.at)}`),
        h("div", { class: "f-actions" }, h("span"), h("a", { class: "btn primary", href: f.data, download: f.name, text: "⬇ Download" }))));
      m.el.style.width = "760px";
    }
    function menu(f, isFolder, anchor) {
      UI.menu(anchor, [
        { label: "Rename", icon: "text", onClick: async () => { const v = await Apps.form("Rename", [{ key: "name", label: "Name", required: true }], { name: f.name }); if (v) Data.update(isFolder ? "folders" : "files", f.id, { name: v.name }); } },
        !isFolder && f.data ? { label: "Download", icon: "download", onClick: () => { const a = h("a", { href: f.data, download: f.name }); document.body.append(a); a.click(); a.remove(); } } : null,
        { label: "Move to…", icon: "arrow", onClick: () => UI.menu(anchor, [{ section: "Move to" }, { label: "🗂️ Drive (top level)", onClick: () => Data.update(isFolder ? "folders" : "files", f.id, isFolder ? { parent: "" } : { folder: "" }) },
          ...Data.list("folders").filter(x => x.id !== f.id).map(x => ({ label: "📁 " + x.name, onClick: () => Data.update(isFolder ? "folders" : "files", f.id, isFolder ? { parent: x.id } : { folder: x.id }) }))]) },
        { sep: true },
        { label: "Delete", icon: "trash", danger: true, onClick: async () => { if (!(await UI.confirm(`Delete “${f.name}”${isFolder ? " and everything inside it" : ""}?`))) return;
          if (isFolder) { const kill = id => { Data.list("files").filter(x => x.folder === id).forEach(x => Data.remove("files", x.id)); Data.list("folders").filter(x => x.parent === id).forEach(x => kill(x.id)); Data.remove("folders", id); }; kill(f.id); }
          else Data.remove("files", f.id); } },
      ], { align: "end" });
    }
    function draw() {
      viewBtn.textContent = grid ? "☰ List" : "▦ Grid";
      crumbs.replaceChildren(h("button", { class: "crumb", text: "🗂️ Drive", onclick: () => { folder = ""; draw(); } }), ...path(folder).flatMap(f => [h("span", { class: "crumb-sep", text: "/" }), h("button", { class: "crumb", text: f.name, onclick: () => { folder = f.id; draw(); } })]));
      const folders = Data.list("folders").filter(f => q ? f.name.toLowerCase().includes(q) : (f.parent || "") === folder).sort((a, b) => a.name.localeCompare(b.name));
      const files = Data.list("files").filter(f => f.folder !== "__attachments" && (q ? f.name.toLowerCase().includes(q) : (f.folder || "") === folder)).sort((a, b) => b.at - a.at);
      if (!folders.length && !files.length) return body.replaceChildren(Apps.empty("🗂️", q ? "No files match." : "Drop files here, or use Upload. Images, PDFs and docs up to 700 KB.", h("button", { class: "btn primary", text: "⬆ Upload", onclick: () => file.click() })));
      const tile = (f, isFolder, i) => {
        const thumb = isFolder ? h("div", { class: "dt-ic", text: "📁" }) : /^image\//.test(f.type) ? h("div", { class: "dt-img", style: { backgroundImage: `url("${f.data}")` } }) : h("div", { class: "dt-ic", text: ICON(f.type) });
        return h("div", { class: grid ? "d-tile glass" : "d-row", style: { animationDelay: Math.min(i * 30, 300) + "ms" }, onclick: () => isFolder ? (folder = f.id, q = "", draw()) : open(f) },
          thumb, h("div", { class: "dt-name", text: f.name }), h("div", { class: "dt-meta", text: isFolder ? `${Data.list("files").filter(x => x.folder === f.id).length} files` : (f.type === "link" ? "Link" : size(f.size)) + " · " + Data.person(f.by).name.split(" ")[0] }),
          h("button", { class: "icon-btn xs dt-more", html: UI.icon("dots"), onclick: e => { e.stopPropagation(); menu(f, isFolder, e.currentTarget); } }));
      };
      body.replaceChildren(h("div", { class: grid ? "drive-grid" : "drive-list" }, ...folders.map((f, i) => tile(f, true, i)), ...files.map((f, i) => tile(f, false, i + folders.length))));
    }
    const offs = ["files", "folders"].map(c => Data.on(c, draw));
    return () => offs.forEach(f => f());
  }

  Apps.register("drive", { title: "Drive", icon: "🗂️", render });
})();
