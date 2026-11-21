/* Drive (Bitrix24-style): My Drive, Company drive, Shared with me, workgroup folders, Recent, Starred and Recycle bin.
   files:   name, type, size, data (data URL, ≤700 KB) | url (type "link"), folder ("" = top level; "__attachments" and "__versions" stay hidden),
            owner, scope ("company"|"personal", missing = company), shared [keys], shareEdit [keys], starred [keys],
            deleted, deletedAt, deletedBy, deletedWith (folder id when it went to the bin with its folder),
            versions [{ id, at, by, size }] (old copies are files docs in folder "__versions" with `of` = file id), comments [{ id, by, text, at }], modified, modifiedBy.
   folders: name, parent, owner, scope, shared, shareEdit, starred, deleted, deletedAt, deletedBy, deletedWith.
   Who can see an item is decided by its top-level folder: a workgroup folder (projects.folder) → the group's readers,
   personal → its owner and the people it's shared with, anything else → everyone in the workspace. */
(function () {
  const { h, esc } = UI;
  const MAX = 700 * 1024, GB = 1024 ** 3, DND = "text/x-lumen-drive";
  // workspace settings (js/prefs.js): how many old versions to keep (Settings → Communications) and Tools → Drive → versions
  const keep = () => { const n = window.Prefs ? +Prefs.get("comms.driveVersions") : NaN; return Number.isFinite(n) ? Math.max(0, Math.min(50, Math.round(n))) : 5; };
  const versionsOn = () => !window.Prefs || Prefs.tool("drive", "versions");
  const HIDDEN = new Set(["__attachments", "__versions"]);
  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  const SECTIONS = [["my", "👤", "My Drive"], ["company", "🏢", "Company drive"], ["shared", "🤝", "Shared with me"], ["groups", "👥", "Groups"], ["recent", "🕘", "Recent"], ["starred", "⭐", "Starred"], ["bin", "🗑️", "Recycle bin"]];
  const FILTERS = [["", "All types"], ["folder", "Folders"], ["image", "Images"], ["doc", "Documents"], ["pdf", "PDFs"], ["link", "Links"], ["media", "Audio & video"]];
  const KINDS = { folder: ["📁", "Folder"], link: ["🔗", "Link"], image: ["🖼️", "Image"], pdf: ["📕", "PDF"], video: ["🎬", "Video"], audio: ["🎵", "Audio"], csv: ["📊", "CSV"], md: ["📝", "Markdown"],
    sheet: ["📊", "Spreadsheet"], slides: ["📙", "Presentation"], doc: ["📘", "Document"], zip: ["🗜️", "Archive"], text: ["📄", "Text"], other: ["📎", "File"] };
  const VIEWS = [["list", "☰", "List"], ["grid", "▦", "Grid"], ["tiles", "🖼️", "Tiles"]];
  const GROUP_IC = { project: "📁", group: "💬", scrum: "🏃" };

  /* ---------- small helpers ---------- */
  const ls = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const wsId = () => window.Cloud?.ws?.id || "local";
  const meKey = () => Data.me().key;
  const phone = () => innerWidth <= 760;
  const size = n => !n ? "0 B" : n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " KB" : n < GB ? (n / 1048576).toFixed(1) + " MB" : (n / GB).toFixed(2) + " GB";
  const ownerOf = x => x.owner || x.by || "";
  const modOf = f => f.modified || f.at || 0;
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const fmtWhen = ts => ts ? (Apps.fmtDateTime?.(ts) ?? new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })) : "—";
  const EXT = n => ((String(n || "").match(/\.([a-z0-9]{1,6})$/i) || [])[1] || "").toLowerCase();
  const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true, sensitivity: "base" });
  const companyEdit = () => { try { return Apps.can ? Apps.can("drive", "edit") : true; } catch { return true; } };
  const G = () => window.Apps?.Groups || null;
  const groupIcon = p => p.avatar || GROUP_IC[p.type] || "📁";
  const linkOf = id => location.href.split("#")[0] + "#/app/drive/f:" + id;
  const safeUrl = u => /^https?:\/\//i.test(u || "") ? u : "#";
  const bytesOfData = f => f.data ? f.data.length : 0; // what Firestore actually stores (base64)
  function kindOf(f) {
    const t = f.type || "", e = EXT(f.name);
    if (t === "link") return "link";
    if (/^image\//.test(t) || /^(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/.test(e)) return "image";
    if (/pdf/.test(t) || e === "pdf") return "pdf";
    if (/^video\//.test(t) || /^(mp4|webm|mov|m4v|ogv)$/.test(e)) return "video";
    if (/^audio\//.test(t) || /^(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/.test(e)) return "audio";
    if (/csv|tab-separated/.test(t) || e === "csv" || e === "tsv") return "csv";
    if (/markdown/.test(t) || e === "md" || e === "markdown") return "md";
    if (/sheet|excel/.test(t) || /^(xlsx?|ods|numbers)$/.test(e)) return "sheet";
    if (/presentation|powerpoint/.test(t) || /^(pptx?|odp|key)$/.test(e)) return "slides";
    if (/word|opendocument\.text|rtf/.test(t) || /^(docx?|odt|rtf|pages)$/.test(e)) return "doc";
    if (/zip|compressed|x-tar|rar|7z/.test(t) || /^(zip|rar|7z|tar|gz)$/.test(e)) return "zip";
    if (/^text\/|json|xml|javascript|x-sh|yaml/.test(t) || /^(txt|log|json|js|mjs|ts|css|html?|xml|ya?ml|ini|cfg|py|java|c|cpp|h|cs|rb|go|rs|php|sh|sql|kt|swift)$/.test(e)) return "text";
    return "other";
  }
  const FILTER_KINDS = { image: ["image"], doc: ["doc", "sheet", "slides", "text", "md", "csv"], pdf: ["pdf"], link: ["link"], media: ["video", "audio"] };
  function copyText(t) {
    const p = navigator.clipboard?.writeText ? navigator.clipboard.writeText(t) : Promise.reject();
    p.then(() => UI.toast("🔗 Link copied"), () => window.prompt("Copy this link", t));
  }
  const blobOf = f => fetch(f.data).then(r => r.blob());
  function bytes(data) { const b = atob(String(data).split(",")[1] || ""), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function download(f) {
    if (!f?.data) return UI.toast(f?.type === "link" ? "Links can't be downloaded. Open the link instead." : "Nothing to download");
    blobOf(f).then(b => {
      const u = URL.createObjectURL(b), a = h("a", { href: u, download: f.name || "file" });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 30000);
    }).catch(() => UI.toast("Couldn't download " + f.name));
  }
  function readData(file, onProg) {
    return new Promise((res, rej) => {
      const rd = new FileReader();
      rd.onprogress = e => { if (e.lengthComputable && onProg) onProg(e.loaded / e.total); };
      rd.onload = () => res(rd.result); rd.onerror = () => rej(rd.error);
      rd.readAsDataURL(file);
    });
  }
  const iconBtn = (ic, title, onclick, cls) => h("button", { class: "icon-btn" + (cls ? " " + cls : ""), title, "aria-label": title, html: UI.icon(ic), onclick });
  const mentionHtml = t => esc(t).replace(/(^|\s)@([\w.-]+)/g, '$1<span class="dv-at">@$2</span>').replace(/\n/g, "<br>");
  // tidy a menu: drop empty items and doubled / leading / trailing separators
  function tidy(items) {
    const out = [];
    items.filter(Boolean).forEach(it => { if (it.sep && (!out.length || out[out.length - 1].sep)) return; out.push(it); });
    while (out.length && out[out.length - 1].sep) out.pop();
    return out;
  }

  /* ---------- recent files (per device) ---------- */
  const recentKey = () => "lumen-drive-recent:" + wsId();
  const recentMap = () => { try { return JSON.parse(ls(recentKey(), "{}")) || {}; } catch { return {}; } };
  function touch(id) {
    const m = recentMap(); m[id] = Date.now();
    const top = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 40);
    lsSet(recentKey(), JSON.stringify(Object.fromEntries(top)));
  }

  /* ---------- pdf.js (loaded only when a PDF is shown) ---------- */
  let pdfP = null;
  function pdfjs() {
    if (window.pdfjsLib?.getDocument) { if (!pdfjsLib.GlobalWorkerOptions.workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js"; return Promise.resolve(window.pdfjsLib); }
    return pdfP ||= new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = PDFJS + "pdf.min.js"; s.async = true;
      s.onload = () => { if (!window.pdfjsLib) { pdfP = null; return rej(new Error("pdf.js")); } pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js"; res(pdfjsLib); };
      s.onerror = () => { pdfP = null; s.remove(); rej(new Error("pdf.js")); };
      document.head.append(s);
    });
  }
  const thumbs = new Map(); let thumbQ = Promise.resolve();
  function pdfThumb(f) {
    const k = f.id + ":" + modOf(f);
    if (thumbs.has(k)) return thumbs.get(k);
    const p = thumbQ = thumbQ.catch(() => {}).then(async () => {
      const lib = await pdfjs(), doc = await lib.getDocument({ data: bytes(f.data) }).promise;
      try {
        const page = await doc.getPage(1), vp0 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: 360 / vp0.width });
        const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
        const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        return c.toDataURL("image/jpeg", .78);
      } finally { doc.destroy(); }
    });
    thumbs.set(k, p); p.catch(() => {});
    return p;
  }

  /* ---------- tiny markdown + CSV renderers (input is escaped first) ---------- */
  function md(src) {
    const lines = esc(src).split(/\r?\n/);
    let out = "", list = null, code = null, para = [];
    const inline = s => s.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>")
      .replace(/~~([^~]+)~~/g, "<s>$1</s>").replace(/\[([^\]]+)\]\(((?:https?:|mailto:)[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    const flushP = () => { if (para.length) out += "<p>" + inline(para.join(" ")) + "</p>"; para = []; };
    const flushL = () => { if (list) out += `</${list}>`; list = null; };
    const openL = t => { if (list !== t) { flushL(); out += `<${t}>`; list = t; } };
    for (const ln of lines) {
      if (code !== null) { if (/^\s*```/.test(ln)) { out += "<pre><code>" + code + "</code></pre>"; code = null; } else code += ln + "\n"; continue; }
      let m;
      if (/^\s*```/.test(ln)) { flushP(); flushL(); code = ""; continue; }
      if ((m = ln.match(/^(#{1,6})\s+(.*)$/))) { flushP(); flushL(); out += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(ln)) { flushP(); flushL(); out += "<hr>"; continue; }
      if ((m = ln.match(/^\s*[-*+]\s+(.*)$/))) { flushP(); openL("ul"); out += "<li>" + inline(m[1].replace(/^\[( |x)\]\s*/i, (s, c) => c.trim() ? "☑ " : "☐ ")) + "</li>"; continue; }
      if ((m = ln.match(/^\s*\d+[.)]\s+(.*)$/))) { flushP(); openL("ol"); out += "<li>" + inline(m[1]) + "</li>"; continue; }
      if ((m = ln.match(/^&gt;\s?(.*)$/))) { flushP(); flushL(); out += "<blockquote>" + inline(m[1]) + "</blockquote>"; continue; }
      if (!ln.trim()) { flushP(); flushL(); continue; }
      flushL(); para.push(ln);
    }
    if (code !== null) out += "<pre><code>" + code + "</code></pre>";
    flushP(); flushL();
    return out;
  }
  function csv(text, maxRows = 1000) {
    const first = text.split(/\r?\n/, 1)[0] || "";
    const d = [",", ";", "\t"].sort((a, b) => first.split(b).length - first.split(a).length)[0];
    const rows = []; let row = [], cell = "", qd = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (qd) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else qd = false; } else cell += c; continue; }
      if (c === '"' && cell === "") qd = true;
      else if (c === d) { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; if (rows.length >= maxRows) return { rows, cut: true }; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return { rows, cut: false };
  }

  /* ---------- who can see / edit what ---------- */
  function world() {
    const me = meKey();
    const folders = new Map(Data.list("folders").map(f => [f.id, f]));
    const files = Data.list("files").filter(f => !HIDDEN.has(f.folder));
    const groupOf = new Map();
    Data.list("projects").forEach(p => { if (p.folder && folders.has(p.folder)) groupOf.set(p.folder, p); });
    const W = { me, folders, files, groupOf };
    // parent id, or "" when the parent folder no longer exists
    W.par = (x, isF) => { const p = isF ? x.parent : x.folder; return p && folders.has(p) && p !== x.id ? p : ""; };
    W.dirs = new Map(); W.fils = new Map();
    folders.forEach(f => { const p = W.par(f, true); (W.dirs.get(p) || W.dirs.set(p, []).get(p)).push(f); });
    files.forEach(f => { const p = W.par(f, false); (W.fils.get(p) || W.fils.set(p, []).get(p)).push(f); });
    // folders from the top down to (and including) folder id
    W.chain = id => { const out = []; let f = folders.get(id), g = 0; while (f && g++ < 40) { out.unshift(f); const p = W.par(f, true); f = p ? folders.get(p) : null; } return out; };
    const areas = new Map();
    W.area = (x, isF) => {
      const ck = (isF ? "d:" : "f:") + x.id;
      if (areas.has(ck)) return areas.get(ck);
      const p = W.par(x, isF), chain = isF ? W.chain(x.id) : p ? W.chain(p) : [];
      const top = chain[0] || x, grp = groupOf.get(top.id);
      const a = grp ? { kind: "group", group: grp, top, chain } : top.scope === "personal" ? { kind: "personal", owner: ownerOf(top), top, chain } : { kind: "company", top, chain };
      areas.set(ck, a); return a;
    };
    // "edit" | "view" | "" through the item or any folder above it
    W.share = (x, isF, k = me) => {
      const a = W.area(x, isF), list = isF ? a.chain : [...a.chain, x];
      let lvl = "";
      for (const it of list) { if ((it.shareEdit || []).includes(k)) return "edit"; if ((it.shared || []).includes(k)) lvl = "view"; }
      return lvl;
    };
    W.canSee = (x, isF) => {
      if (!x || (!isF && HIDDEN.has(x.folder))) return false;
      const a = W.area(x, isF);
      if (a.kind === "group") { const g = G(); return !g || (g.canRead ? g.canRead(a.group) : g.canSee(a.group)); }
      if (a.kind === "personal") return a.owner === me || !!W.share(x, isF);
      return true;
    };
    W.canEdit = (x, isF) => {
      if (!W.canSee(x, isF)) return false;
      const a = W.area(x, isF);
      if (a.kind === "group") { const g = G(); return !g || !!g.isMember?.(a.group); }
      if (a.kind === "personal") return a.owner === me || W.share(x, isF) === "edit";
      return companyEdit();
    };
    W.gone = (x, isF) => !!x.deleted || W.area(x, isF).chain.some(f => f.deleted);
    W.live = (x, isF) => W.canSee(x, isF) && !W.gone(x, isF);
    W.sectionOf = (x, isF) => { const a = W.area(x, isF); return a.kind === "group" ? "groups" : a.kind === "personal" ? (a.owner === me ? "my" : "shared") : "company"; };
    W.scopeOf = (x, isF) => W.area(x, isF).kind === "personal" ? "personal" : "company";
    W.isGroupRoot = f => groupOf.has(f.id);
    W.desc = id => {
      const out = { folders: [], files: [] };
      const walk = (pid, g) => { if (g > 40) return; (W.dirs.get(pid) || []).forEach(f => { out.folders.push(f); walk(f.id, g + 1); }); (W.fils.get(pid) || []).forEach(f => out.files.push(f)); };
      walk(id, 0); return out;
    };
    // people who can open a personal item (owner + shares on it and above)
    W.people = (x, isF) => {
      const a = W.area(x, isF), list = isF ? a.chain : [...a.chain, x], out = new Map();
      list.forEach(it => { (it.shared || []).forEach(k => out.set(k, out.get(k) === "edit" ? "edit" : "view")); (it.shareEdit || []).forEach(k => out.set(k, "edit")); });
      out.delete(a.owner); return out;
    };
    W.loc = (x, isF) => {
      const a = W.area(x, isF), chain = isF ? a.chain.slice(0, -1) : a.chain;
      const root = a.kind === "group" ? "Groups" : a.kind === "personal" ? (a.owner === me ? "My Drive" : "Shared with me") : "Company drive";
      return [root, ...chain.map(f => groupOf.has(f.id) ? groupIcon(groupOf.get(f.id)) + " " + f.name : f.name)].join(" / ");
    };
    return W;
  }

  /* ---------- bottom sheet on phones, menu elsewhere ---------- */
  const sheets = new Set();
  function sheetMenu(anchor, items, opts = {}) {
    items = tidy(items);
    if (!phone()) return UI.menu(anchor, items, { align: opts.align || "end" });
    UI.closePops();
    const close = () => { if (!bd.isConnected) return; sheets.delete(close); bd.classList.add("closing"); setTimeout(() => bd.remove(), 220); };
    const sheet = h("div", { class: "dv-sheet glass-strong" }, h("div", { class: "dvs-grab" }), opts.title ? h("div", { class: "dvs-title", text: opts.title }) : null);
    items.forEach(it => {
      if (it.sep) return sheet.append(h("div", { class: "menu-sep" }));
      if (it.section) return sheet.append(h("div", { class: "menu-sec", text: it.section }));
      sheet.append(h("button", { class: "mi compact" + (it.danger ? " danger" : ""), onclick: e => { close(); it.onClick?.(e); } },
        h("span", { class: "mi-ic", html: it.iconHtml || (it.icon ? UI.icon(it.icon) : "") }), h("span", { class: "mi-t", text: it.label })));
    });
    const bd = h("div", { class: "dv-sheet-bd", onclick: e => { if (e.target === bd) close(); } }, sheet);
    document.getElementById("layer").append(bd);
    sheets.add(close);
    return { close };
  }

  /* ---------- versions ---------- */
  async function newVersion(f, nu) {
    f = Data.get("files", f.id) || f;
    const me = meKey(), at = modOf(f), by = f.modifiedBy || ownerOf(f);
    const vid = await Data.add("files", { name: f.name, type: f.type, size: f.size || 0, data: f.data, folder: "__versions", of: f.id, at, by });
    const versions = [...(f.versions || []), { id: vid, at, by, size: f.size || 0 }];
    while (versions.length > keep()) { const old = versions.shift(); Data.remove("files", old.id); }
    await Data.update("files", f.id, { ...nu, versions, modified: Date.now(), modifiedBy: me });
  }
  async function restoreVersion(f, v) {
    const vd = Data.get("files", v.id);
    if (!vd) return UI.toast("That version is no longer available");
    f = Data.get("files", f.id) || f;
    const me = meKey(), at = modOf(f), by = f.modifiedBy || ownerOf(f);
    const vid = await Data.add("files", { name: f.name, type: f.type, size: f.size || 0, data: f.data, folder: "__versions", of: f.id, at, by });
    const versions = [...(f.versions || []).filter(x => x.id !== v.id), { id: vid, at, by, size: f.size || 0 }];
    while (versions.length > keep()) { const old = versions.shift(); Data.remove("files", old.id); }
    await Data.update("files", f.id, { data: vd.data, type: vd.type, size: vd.size || 0, versions, modified: Date.now(), modifiedBy: me });
    Data.remove("files", v.id);
  }
  async function uploadVersion(f) {
    if (!versionsOn()) return UI.toast("File versions are switched off in Settings → Tools.");
    const [file] = await Apps.pickFiles(false);
    if (!file) return;
    if (file.size > MAX) return UI.toast(`“${file.name}” is ${size(file.size)}. Files can be up to 700 KB on the free plan.`);
    const data = await readData(file);
    await newVersion(f, { type: file.type || f.type, size: file.size, data });
    const me = Data.me();
    Data.notify(ownerOf(f), `🔄 <b>${esc(me.name)}</b> uploaded a new version of <b>${esc(f.name)}</b>`, "#/app/drive/f:" + f.id);
    UI.toast("⬆ New version uploaded");
  }
  const verName = (name, at) => String(name).replace(/(\.[^.]+)?$/, m => ` (${Apps.iso(new Date(at || Date.now()))})${m}`);

  /* ---------- the app ---------- */
  function render(root, arg) {
    let sec = ls("lumen-drive-sec", "company"), folder = "", q = "", filter = "", sel = new Set(), last = null, pending = arg || "", started = Date.now();
    let sort; try { sort = JSON.parse(ls("lumen-drive-sort", "")) || { k: "name", d: 1 }; } catch { sort = { k: "name", d: 1 }; }
    if (!SECTIONS.some(s => s[0] === sec)) sec = "company";
    let order = [], shown = [], W = world(), io = null, V = null, raf = 0;
    const viewOf = () => ls("lumen-drive-view:" + sec, phone() ? "tiles" : sec === "groups" ? "grid" : "list");

    const nav = h("nav", { class: "dv-nav glass" });
    const crumbs = h("div", { class: "dv-crumbs" });
    const search = h("input", { class: "app-search dv-search", type: "search", placeholder: "Search Drive…", oninput: () => { q = search.value.trim().toLowerCase(); sel.clear(); draw(); } });
    const typeSel = h("select", { class: "app-select dv-typesel", title: "File type", onchange: () => { filter = typeSel.value; sel.clear(); draw(); } }, ...FILTERS.map(([v, l]) => h("option", { value: v }, l)));
    const viewSeg = h("div", { class: "seg dv-views" });
    const hint = h("div", { class: "dv-hint" });
    const bulk = h("div", { class: "dv-bulk glass-strong" });
    const body = h("div", { class: "dv-body" });
    const upList = h("div", { class: "du-list" }), upHead = h("div", { class: "du-head" });
    const upBox = h("div", { class: "du glass-strong" }, upHead, upList);
    const fileIn = h("input", { type: "file", multiple: true, style: { display: "none" }, onchange: () => { const t = target(); const fs = [...fileIn.files]; fileIn.value = ""; if (t) uploadEntries(fs.map(file => ({ file, path: "" })), t); } });
    const dirIn = h("input", { type: "file", multiple: true, webkitdirectory: true, style: { display: "none" }, onchange: () => {
      const t = target(); const fs = [...dirIn.files]; dirIn.value = "";
      if (t) uploadEntries(fs.map(file => ({ file, path: (file.webkitRelativePath || "").split("/").slice(0, -1).join("/") })), t);
    } });
    const newBtn = h("button", { class: "btn primary dv-new", onclick: e => newMenu(e.currentTarget) }, "+ New");
    root.append(Apps.header("Drive", "🗂️", "Your files, company files and workgroup folders", newBtn, fileIn, dirIn),
      h("div", { class: "dv-shell" }, nav,
        h("div", { class: "dv-main" }, h("div", { class: "dv-bar" }, crumbs, h("span", { class: "grow" }), search, typeSel, viewSeg), hint, bulk, body)));

    /* ----- drag & drop: files from the computer, and moving items onto folders ----- */
    root.addEventListener("dragover", e => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); body.classList.add("drop"); } });
    root.addEventListener("dragleave", e => { if (!root.contains(e.relatedTarget)) body.classList.remove("drop"); });
    root.addEventListener("drop", e => {
      body.classList.remove("drop");
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      const t = target(); if (!t) return;
      fromDrop(e.dataTransfer).then(es => uploadEntries(es, t));
    });
    function dropTarget(el, dest) {
      el.addEventListener("dragover", e => {
        const t = [...(e.dataTransfer?.types || [])];
        if ((!t.includes(DND) && !t.includes("Files")) || !dest()) return;
        e.preventDefault(); e.stopPropagation(); el.classList.add("dv-over");
      });
      el.addEventListener("dragleave", e => { if (!el.contains(e.relatedTarget)) el.classList.remove("dv-over"); });
      el.addEventListener("drop", e => {
        el.classList.remove("dv-over"); body.classList.remove("drop");
        const d = dest(); if (!d) return;
        const t = [...(e.dataTransfer?.types || [])];
        e.preventDefault(); e.stopPropagation();
        if (t.includes(DND)) { let keys = []; try { keys = JSON.parse(e.dataTransfer.getData(DND) || "[]"); } catch {} moveTo(keys, d); }
        else if (e.dataTransfer.files?.length) fromDrop(e.dataTransfer).then(es => uploadEntries(es, d));
      });
    }
    const folderDest = f => () => { const w = world(), x = w.folders.get(f.id); return x && !x.deleted && w.canEdit(x, true) ? { folder: x.id, scope: w.scopeOf(x, true), label: x.name } : null; };
    // dropped folders keep their structure (path = folder path inside what was dropped)
    async function fromDrop(dt) {
      const entries = [...(dt.items || [])].filter(i => i.kind === "file").map(i => i.webkitGetAsEntry?.()).filter(Boolean);
      const plain = [...(dt.files || [])];
      if (!entries.some(e => e.isDirectory)) return plain.map(file => ({ file, path: "" }));
      const out = [];
      const walk = async (en, path) => {
        if (en.isFile) { try { out.push({ file: await new Promise((res, rej) => en.file(res, rej)), path }); } catch {} return; }
        if (!en.isDirectory) return;
        const rd = en.createReader(), sub = path ? path + "/" + en.name : en.name;
        let batch;
        do { batch = await new Promise(res => rd.readEntries(res, () => res([]))); for (const c of batch) await walk(c, sub); } while (batch.length);
      };
      for (const en of entries) await walk(en, "");
      return out;
    }

    /* ----- where new things go ----- */
    function target() {
      const w = world();
      if (folder && !q && !filter) {
        const f = w.folders.get(folder);
        if (f && !f.deleted) {
          if (!w.canEdit(f, true)) { UI.toast("You can view this folder but can't add files to it"); return null; }
          return { folder, scope: w.scopeOf(f, true), label: f.name };
        }
      }
      if (sec === "company" && !folder) {
        if (!companyEdit()) { UI.toast("You can view Company drive but can't add files to it"); return null; }
        return { folder: "", scope: "company", label: "Company drive" };
      }
      if (sec === "groups" && !folder) { UI.toast("Open a group's folder first"); return null; }
      return { folder: "", scope: "personal", label: "My Drive", elsewhere: sec !== "my" };
    }
    function newMenu(anchor) {
      sheetMenu(anchor, [
        { label: "New folder", iconHtml: "📁", onClick: newFolder },
        { sep: true },
        { label: "Upload files", iconHtml: "⬆️", onClick: () => fileIn.click() },
        { label: "Upload folder", iconHtml: "🗂️", onClick: () => dirIn.click() },
        { label: "Add link", iconHtml: "🔗", onClick: addLink },
      ], { align: "end", title: "Create or upload" });
    }
    async function newFolder() {
      const t = target(); if (!t) return;
      const v = await Apps.form("New folder", [{ key: "name", label: "Folder name", required: true, placeholder: "Untitled folder" }], {}, { ok: "Create", width: 420 });
      if (!v) return;
      await Data.add("folders", { name: v.name.trim(), parent: t.folder, scope: t.scope, owner: meKey() });
      UI.toast("📁 Folder created" + (t.elsewhere ? " in My Drive" : ""));
    }
    async function addLink() {
      const t = target(); if (!t) return;
      const v = await Apps.form("Add a link", [{ key: "name", label: "Name", required: true, placeholder: "Design files (Google Drive)" }, { key: "url", label: "URL", type: "url", required: true, placeholder: "https://…" }], {}, { ok: "Add link" });
      if (!v) return;
      const url = /^https?:\/\//i.test(v.url.trim()) ? v.url.trim() : "https://" + v.url.trim();
      await Data.add("files", { name: v.name.trim(), type: "link", url, size: 0, folder: t.folder, scope: t.scope, owner: meKey() });
      UI.toast("🔗 Link added" + (t.elsewhere ? " to My Drive" : ""));
    }

    /* ----- uploads with progress ----- */
    let upJobs = 0, upDone = 0, upHide = 0;
    function upRow(name, sz) {
      const bar = h("i"), st = h("small", { text: size(sz) }), row = h("div", { class: "du-row" }, h("span", { class: "du-n", text: name }), st, h("div", { class: "du-bar" }, bar));
      upList.prepend(row);
      return { set: p => (bar.style.width = Math.round(p * 100) + "%"), status: (t, cls) => { st.textContent = t; if (cls) row.classList.add(cls); } };
    }
    function upPaint() {
      upHead.replaceChildren(h("b", { text: upDone < upJobs ? `Uploading ${upDone + 1} of ${upJobs}` : `Uploaded ${plural(upJobs, "item")}` }), h("span", { class: "grow" }),
        h("button", { class: "icon-btn xs", title: "Close", html: UI.icon("x"), onclick: () => upBox.classList.remove("on") }));
    }
    function askDupes(n) {
      return new Promise(res => {
        let done = false;
        const pick = v => { done = true; res(v); m.close(); };
        const m = UI.modal("Already here", h("div", null,
          h("p", { class: "dv-muted", text: `${plural(n, "file")} with the same name ${n === 1 ? "is" : "are"} already in this folder. Upload as a new version keeps the old file in its history.` }),
          h("div", { class: "dv-modal-acts" }, h("button", { class: "btn", text: "Cancel", onclick: () => m.close() }), h("span", { class: "grow" }),
            h("button", { class: "btn", text: "Keep both", onclick: () => pick("both") }), h("button", { class: "btn primary", text: "Upload as new version", onclick: () => pick("version") }))),
          { onClose: () => { if (!done) res(null); } });
        m.el.style.width = "480px";
      });
    }
    async function uploadEntries(entries, t) {
      entries = (entries || []).filter(e => e && e.file);
      if (!entries.length || !t) return;
      const w = world(), me = meKey();
      const here = new Map((w.fils.get(t.folder) || []).filter(f => f.data && w.live(f, false) && (t.folder || inRoot(w, f, t.scope))).map(f => [String(f.name).toLowerCase(), f]));
      const dupes = entries.filter(e => !e.path && here.has(e.file.name.toLowerCase()));
      let mode = "both";
      if (dupes.length && versionsOn()) { mode = await askDupes(dupes.length); if (!mode) return; }
      clearTimeout(upHide);
      if (upDone >= upJobs) { upJobs = 0; upDone = 0; upList.replaceChildren(); }
      upJobs += entries.length; upPaint();
      if (!upBox.isConnected) document.getElementById("layer").append(upBox);
      upBox.classList.add("on");
      const dirIds = new Map([["", t.folder]]);
      const dirFor = async path => {
        if (dirIds.has(path)) return dirIds.get(path);
        const parts = path.split("/"), name = parts.pop(), parent = await dirFor(parts.join("/"));
        const id = await Data.add("folders", { name, parent, scope: t.scope, owner: me });
        dirIds.set(path, id); return id;
      };
      let big = 0, ok = 0;
      for (const e of entries) {
        const row = upRow(e.path ? e.path + "/" + e.file.name : e.file.name, e.file.size);
        try {
          if (e.file.size > MAX) { big++; row.status("Over 700 KB · add it as a link", "err"); continue; }
          const data = await readData(e.file, p => row.set(p * .85));
          const old = !e.path && mode === "version" && here.get(e.file.name.toLowerCase());
          if (old && w.canEdit(old, false)) await newVersion(old, { type: e.file.type || old.type, size: e.file.size, data });
          else await Data.add("files", { name: e.file.name, type: e.file.type || "application/octet-stream", size: e.file.size, data, folder: await dirFor(e.path || ""), scope: t.scope, owner: me });
          row.set(1); row.status(old ? "New version" : "Done", "ok"); ok++;
        } catch (err) { console.error(err); row.status("Failed", "err"); }
        finally { upDone++; upPaint(); }
      }
      if (ok && t.elsewhere) UI.toast(`⬆ Saved to My Drive`);
      if (big) UI.toast(`${plural(big, "file")} ${big === 1 ? "is" : "are"} over 700 KB (free plan limit). Add big files as links.`, { label: "Add link", run: addLink });
      if (upDone >= upJobs) upHide = setTimeout(() => upBox.classList.remove("on"), big ? 9000 : 3500);
    }

    /* ----- selection helpers ----- */
    const resolve = keys => [...keys].map(k => { const isF = k.startsWith("d:"), x = isF ? W.folders.get(k.slice(2)) : Data.get("files", k.slice(2)); return x ? { x, isF, key: k } : null; }).filter(Boolean);
    const selected = () => resolve(sel);
    function toggleSel(key, on) { (on ?? !sel.has(key)) ? sel.add(key) : sel.delete(key); last = key; paintSel(); }
    function rangeSel(key) {
      const a = order.indexOf(last), b = order.indexOf(key);
      if (a < 0 || b < 0) return toggleSel(key, true);
      order.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(k => sel.add(k)); last = key; paintSel();
    }
    function paintSel() {
      body.querySelectorAll("[data-key]").forEach(el => { const on = sel.has(el.dataset.key); el.classList.toggle("sel", on); const cb = el.querySelector(".dv-cb"); if (cb) cb.checked = on; });
      const all = body.querySelector(".dv-cb-all"); if (all) { all.checked = order.length > 0 && order.every(k => sel.has(k)); all.indeterminate = sel.size > 0 && !all.checked; }
      root.classList.toggle("dv-selecting", sel.size > 0);
      drawBulk();
    }

    /* ----- actions ----- */
    const colOf = isF => isF ? "folders" : "files";
    function toggleStar(x, isF) {
      const me = meKey(), on = (x.starred || []).includes(me);
      Data.arr(colOf(isF), x.id, "starred", me, !on);
      UI.toast(on ? "Removed from Starred" : "⭐ Added to Starred");
    }
    async function rename(x, isF) {
      const v = await Apps.form(isF ? "Rename folder" : "Rename file", [{ key: "name", label: "Name", required: true }], { name: x.name }, { ok: "Rename", width: 440 });
      if (v && v.name.trim() && v.name.trim() !== x.name) Data.update(colOf(isF), x.id, { name: v.name.trim() });
    }
    function pickFolder(title, okLabel, exclude = new Set()) {
      return new Promise(res => {
        const w = world(), me = meKey(), open = new Set();
        let chosen = null, done = false;
        const tree = h("div", { class: "dv-tree" });
        const okBtn = h("button", { class: "btn primary", text: okLabel, disabled: true, onclick: () => { done = true; res(chosen); m.close(); } });
        const sub = pid => (w.dirs.get(pid) || []).filter(f => !exclude.has(f.id) && w.live(f, true)).sort(byName);
        const node = (key, ic, label, val, kids, depth) => {
          const isOpen = open.has(key), canPick = !!val;
          const row = h("div", { class: "dvt-row" + (chosen && chosen.key === key ? " on" : "") + (canPick ? "" : " off"), style: { paddingLeft: 8 + depth * 18 + "px" },
            onclick: () => { if (!canPick) { open.has(key) ? open.delete(key) : open.add(key); return paint(); } chosen = { ...val, key }; okBtn.disabled = false; paint(); } },
            h("button", { class: "dvt-caret" + (isOpen ? " open" : ""), style: { visibility: kids().length ? "visible" : "hidden" }, html: UI.icon("caret"),
              onclick: e => { e.stopPropagation(); open.has(key) ? open.delete(key) : open.add(key); paint(); } }),
            h("span", { class: "dvt-ic", text: ic }), h("span", { class: "dvt-t", text: label }), canPick ? null : h("small", { text: "view only" }));
          const out = [row];
          if (isOpen) kids().forEach(f => out.push(...folderNode(f, depth + 1)));
          return out;
        };
        const folderNode = (f, depth) => node("d:" + f.id, w.isGroupRoot(f) ? groupIcon(w.groupOf.get(f.id)) : "📁", f.name,
          w.canEdit(f, true) ? { folder: f.id, scope: w.scopeOf(f, true), label: f.name } : null, () => sub(f.id), depth);
        const rootKids = kind => () => sub("").filter(f => { const a = w.area(f, true); return kind === "my" ? a.kind === "personal" && a.owner === me : kind === "company" ? a.kind === "company" : false; });
        function paint() {
          const groups = sub("").filter(f => w.isGroupRoot(f)).sort(byName);
          const has = it => (it.shared || []).includes(me) || (it.shareEdit || []).includes(me);
          const shared = [...w.folders.values()].filter(f => { const a = w.area(f, true); return a.kind === "personal" && a.owner !== me && w.live(f, true) && !exclude.has(f.id) && has(f) && !a.chain.slice(0, -1).some(has); }).sort(byName);
          tree.replaceChildren(
            ...node("root:my", "👤", "My Drive", { folder: "", scope: "personal", label: "My Drive" }, rootKids("my"), 0),
            ...node("root:company", "🏢", "Company drive", companyEdit() ? { folder: "", scope: "company", label: "Company drive" } : null, rootKids("company"), 0),
            ...(groups.length ? [h("div", { class: "menu-sec", text: "Groups" }), ...groups.flatMap(f => folderNode(f, 0))] : []),
            ...(shared.length ? [h("div", { class: "menu-sec", text: "Shared with me" }), ...shared.flatMap(f => folderNode(f, 0))] : []));
        }
        open.add("root:my"); open.add("root:company");
        if (folder) w.chain(folder).forEach(f => open.add("d:" + f.id));
        paint();
        const m = UI.modal(title, h("div", null, tree, h("div", { class: "dv-modal-acts" }, h("span", { class: "grow" }), h("button", { class: "btn", text: "Cancel", onclick: () => m.close() }), okBtn)),
          { onClose: () => { if (!done) res(null); } });
        m.el.style.width = "480px";
      });
    }
    async function moveTo(keys, d) {
      const w = world(); let n = 0, skipped = 0;
      for (const { x, isF } of resolveIn(w, keys)) {
        if (!w.canEdit(x, isF) || (isF && w.isGroupRoot(x)) || x.deleted) { skipped++; continue; }
        if (isF && d.folder && (d.folder === x.id || w.chain(d.folder).some(f => f.id === x.id))) { skipped++; continue; }
        if (w.par(x, isF) === d.folder && (d.folder || inRoot(w, x, d.scope, isF))) continue;
        const patch = isF ? { parent: d.folder } : { folder: d.folder };
        patch.scope = d.scope;
        if (!d.folder && d.scope === "personal") patch.owner = meKey();
        await Data.update(colOf(isF), x.id, patch); n++;
      }
      if (n) UI.toast(`📦 Moved ${plural(n, "item")} to ${d.label || "the folder"}`);
      if (skipped) UI.toast(`${plural(skipped, "item")} couldn't be moved there`);
      sel.clear(); schedule();
    }
    // a top-level item that already sits at the root of My Drive ("personal") or Company drive ("company")
    function inRoot(w, x, scope, isF = false) { const a = w.area(x, isF); return scope === "personal" ? a.kind === "personal" && a.owner === w.me : a.kind === "company"; }
    function resolveIn(w, keys) { return [...keys].map(k => { const isF = k.startsWith("d:"), x = isF ? w.folders.get(k.slice(2)) : Data.get("files", k.slice(2)); return x ? { x, isF } : null; }).filter(Boolean); }
    async function moveItems(list) {
      const items = list.filter(({ x, isF }) => W.canEdit(x, isF) && !(isF && W.isGroupRoot(x)));
      if (!items.length) return UI.toast("You can't move these items");
      const d = await pickFolder(items.length === 1 ? `Move “${items[0].x.name}”` : `Move ${plural(items.length, "item")}`, "Move here", new Set(items.filter(i => i.isF).map(i => i.x.id)));
      if (d) moveTo(items.map(i => (i.isF ? "d:" : "f:") + i.x.id), d);
    }
    async function copyItems(list) {
      const items = list.filter(({ x, isF }) => W.canSee(x, isF));
      if (!items.length) return;
      const d = await pickFolder(items.length === 1 ? `Copy “${items[0].x.name}”` : `Copy ${plural(items.length, "item")}`, "Copy here");
      if (!d) return;
      const w = world(), me = meKey(); let n = 0;
      const namesIn = pid => new Set([...(w.dirs.get(pid) || []), ...(w.fils.get(pid) || [])].filter(x => !x.deleted).map(x => String(x.name).toLowerCase()));
      const free = (name, taken) => { if (!taken.has(String(name).toLowerCase())) return name; const m = String(name).match(/^(.*?)(\.[^.]+)?$/); let i = 1, nm; do { nm = `${m[1]} (copy${i > 1 ? " " + i : ""})${m[2] || ""}`; i++; } while (taken.has(nm.toLowerCase())); return nm; };
      const copyFile = async (f, pid, taken) => {
        const name = taken ? free(f.name, taken) : f.name; if (taken) taken.add(name.toLowerCase());
        await Data.add("files", { name, type: f.type, size: f.size || 0, ...(f.data ? { data: f.data } : {}), ...(f.url ? { url: f.url } : {}), folder: pid, scope: d.scope, owner: me }); n++;
      };
      const copyDir = async (fd, pid, taken, depth) => {
        const name = taken ? free(fd.name, taken) : fd.name; if (taken) taken.add(name.toLowerCase());
        const id = await Data.add("folders", { name, parent: pid, scope: d.scope, owner: me }); n++;
        if (depth > 30) return;
        for (const c of (w.dirs.get(fd.id) || []).filter(c => !c.deleted)) await copyDir(c, id, null, depth + 1);
        for (const f of (w.fils.get(fd.id) || []).filter(f => !f.deleted)) await copyFile(f, id, null);
      };
      UI.toast("Copying…");
      const taken = namesIn(d.folder);
      for (const { x, isF } of items) {
        if (isF && d.folder && (d.folder === x.id || w.chain(d.folder).some(f => f.id === x.id))) { UI.toast("A folder can't be copied into itself"); continue; }
        isF ? await copyDir(x, d.folder, taken, 0) : await copyFile(x, d.folder, taken);
      }
      UI.toast(`📄 Copied ${plural(n, "item")} to ${d.label}`);
      sel.clear(); schedule();
    }
    async function trash(list, quiet) {
      const w = world(), me = meKey(), now = Date.now(), done = [];
      for (const { x, isF } of list) {
        if (!w.canEdit(x, isF) || (isF && w.isGroupRoot(x)) || x.deleted) continue;
        const mark = { deleted: true, deletedAt: now, deletedBy: me };
        await Data.update(colOf(isF), x.id, mark);
        if (isF) { const d = w.desc(x.id); for (const c of [...d.folders.map(f => [f, true]), ...d.files.map(f => [f, false])]) if (!c[0].deleted) await Data.update(colOf(c[1]), c[0].id, { ...mark, deletedWith: x.id }); }
        done.push({ x, isF });
      }
      const skipped = list.length - done.length;
      if (done.length && !quiet) UI.toast(`🗑️ Moved ${plural(done.length, "item")} to the recycle bin`, { label: "Undo", run: () => done.forEach(d => restore(d.x, d.isF, true)) });
      if (skipped) UI.toast(list.length === 1 && list[0].isF && w.isGroupRoot(list[0].x) ? "A workgroup's folder is managed in Workgroups" : `${plural(skipped, "item")} couldn't be deleted`);
      sel.clear(); schedule();
    }
    async function restore(x, isF, quiet) {
      const w = world(); x = (isF ? w.folders.get(x.id) : Data.get("files", x.id)) || x;
      const p = isF ? x.parent : x.folder, parent = p && w.folders.get(p);
      const patch = { deleted: false, deletedAt: null, deletedBy: null, deletedWith: null };
      if (p && (!parent || parent.deleted)) { // its folder is gone or still in the bin: put it back at the top
        const a = w.area(x, isF);
        Object.assign(patch, isF ? { parent: "" } : { folder: "" }, { scope: a.kind === "personal" ? "personal" : "company", owner: a.kind === "personal" ? a.owner : ownerOf(x) });
      }
      await Data.update(colOf(isF), x.id, patch);
      if (isF) {
        const clear = { deleted: false, deletedAt: null, deletedBy: null, deletedWith: null };
        for (const f of Data.list("folders").filter(f => f.deletedWith === x.id)) await Data.update("folders", f.id, clear);
        for (const f of Data.list("files").filter(f => f.deletedWith === x.id)) await Data.update("files", f.id, clear);
      }
      if (!quiet) UI.toast(`↩ Restored “${x.name}”`);
      schedule();
    }
    async function purge(x, isF) {
      const w = world();
      const killFile = f => { (f.versions || []).forEach(v => Data.remove("files", v.id)); return Data.remove("files", f.id); };
      if (isF) {
        const d = w.desc(x.id);
        for (const f of d.files) await killFile(f);
        for (const f of d.folders.reverse()) await Data.remove("folders", f.id);
        await Data.remove("folders", x.id);
      } else await killFile(x);
    }
    async function purgeItems(list) {
      const items = list.filter(({ x, isF }) => W.canEdit(x, isF));
      if (!items.length) return UI.toast("You can't delete these items");
      if (!(await UI.confirm(items.length === 1 ? `Delete “${items[0].x.name}” forever? This can't be undone.` : `Delete ${plural(items.length, "item")} forever? This can't be undone.`, "Delete forever"))) return;
      for (const { x, isF } of items) await purge(x, isF);
      UI.toast(`Deleted ${plural(items.length, "item")} forever`);
      sel.clear(); schedule();
    }
    async function emptyBin() {
      const items = binItems().filter(({ x, isF }) => W.canEdit(x, isF));
      if (!items.length) return UI.toast("Nothing you can delete here");
      if (!(await UI.confirm(`Delete ${plural(items.length, "item")} in the recycle bin forever? This can't be undone.`, "Empty bin"))) return;
      for (const { x, isF } of items) await purge(x, isF);
      UI.toast("🗑️ Recycle bin emptied");
      sel.clear(); schedule();
    }
    async function downloadMany(list) {
      const w = world(), out = [];
      list.forEach(({ x, isF }) => { if (isF) w.desc(x.id).files.filter(f => !f.deleted && f.data).forEach(f => out.push(f)); else if (x.data) out.push(x); });
      if (!out.length) return UI.toast("No files to download (links can't be downloaded)");
      if (out.length > 1) UI.toast(`⬇ Downloading ${plural(out.length, "file")}…`);
      for (const f of out) { download(f); await new Promise(r => setTimeout(r, 350)); }
    }
    function shareDialog(x, isF) {
      const w = world(), a = w.area(x, isF), me = Data.me(), col = colOf(isF), what = isF ? "folder" : "file";
      const linkRow = h("div", { class: "dv-linkrow" }, h("input", { class: "menu-input", readonly: true, value: linkOf(x.id), onfocus: e => e.target.select() }), h("button", { class: "btn", text: "Copy link", onclick: () => copyText(linkOf(x.id)) }));
      if (a.kind !== "personal") {
        const msg = a.kind === "group" ? `Everyone who can open the workgroup “${a.group.name}” can open this ${what}. Manage people in Workgroups.` : `Files in Company drive are visible to everyone in the workspace. Move it to My Drive to share it with just a few people.`;
        const m = UI.modal(`Share “${x.name}”`, h("div", { class: "dv-share" }, h("p", { class: "dv-muted", text: msg }), linkRow,
          h("div", { class: "dv-modal-acts" }, a.kind === "group" && G()?.open ? h("button", { class: "btn", text: "Open workgroup", onclick: () => { m.close(); closeViewer(); G().open(a.group.id, "members"); } }) : null, h("span", { class: "grow" }), h("button", { class: "btn primary", text: "Done", onclick: () => m.close() }))));
        m.el.style.width = "500px"; return;
      }
      const canManage = a.owner === me.key || w.share(x, isF) === "edit";
      const view = new Set([...(x.shared || []), ...(x.shareEdit || [])]), edit = new Set(x.shareEdit || []);
      const before = new Set(view), inherited = new Map();
      a.chain.filter(f => f.id !== x.id).forEach(f => { (f.shared || []).forEach(k => inherited.set(k, f)); (f.shareEdit || []).forEach(k => inherited.set(k, f)); });
      const list = h("div", { class: "dv-people" });
      const addBtn = h("button", { class: "btn", text: "+ Add people", onclick: () => Apps.peoplePicker(addBtn, [...view], keys => { keys.forEach(k => view.add(k)); [...view].forEach(k => { if (!keys.includes(k)) { view.delete(k); edit.delete(k); } }); paint(); }, { exclude: [a.owner] }) });
      function paint() {
        const owner = Data.person(a.owner);
        list.replaceChildren(
          h("div", { class: "dv-person" }, Apps.avatar(owner, 30), h("div", { class: "dvp-t" }, h("b", { text: owner.name + (a.owner === me.key ? " (you)" : "") }), h("small", { text: owner.email || "" })), h("span", { class: "dv-role", text: "Owner" })),
          ...[...view].map(k => {
            const p = Data.person(k), lvl = edit.has(k) ? "edit" : "view";
            const s = h("select", { class: "app-select", disabled: !canManage, onchange: () => { s.value === "edit" ? edit.add(k) : edit.delete(k); } }, h("option", { value: "view", selected: lvl === "view" }, "Can view"), h("option", { value: "edit", selected: lvl === "edit" }, "Can edit"));
            return h("div", { class: "dv-person" }, Apps.avatar(p, 30), h("div", { class: "dvp-t" }, h("b", { text: p.name }), h("small", { text: p.email || "" })), s,
              canManage ? h("button", { class: "icon-btn xs", title: "Remove", html: UI.icon("x"), onclick: () => { view.delete(k); edit.delete(k); paint(); } }) : null);
          }),
          ...[...inherited].filter(([k]) => !view.has(k) && k !== a.owner).map(([k, f]) => { const p = Data.person(k); return h("div", { class: "dv-person inh" }, Apps.avatar(p, 30), h("div", { class: "dvp-t" }, h("b", { text: p.name }), h("small", { text: `Has access through “${f.name}”` })), h("span", { class: "dv-role", text: (f.shareEdit || []).includes(k) ? "Can edit" : "Can view" })); }),
          !view.size && !inherited.size ? h("div", { class: "dv-note", text: `🔒 Only ${a.owner === me.key ? "you" : owner.name} can see this ${what} right now.` }) : null);
      }
      paint();
      const save = h("button", { class: "btn primary", text: canManage ? "Save" : "Done", onclick: async () => {
        if (!canManage) return m.close();
        await Data.update(col, x.id, { shared: [...view], shareEdit: [...edit].filter(k => view.has(k)) });
        const fresh = [...view].filter(k => !before.has(k)), link = "#/app/drive/f:" + x.id;
        fresh.forEach(k => Data.notify(k, `🤝 <b>${esc(me.name)}</b> shared the ${what} <b>${esc(x.name)}</b> with you`, link, edit.has(k) ? "You can view and edit it. Find it in Drive → Shared with me." : "Find it in Drive → Shared with me."));
        UI.toast(fresh.length ? `🤝 Shared with ${fresh.map(k => Data.person(k).name.split(" ")[0]).join(", ")}` : "Sharing updated");
        m.close();
      } });
      const m = UI.modal(`Share “${x.name}”`, h("div", { class: "dv-share" },
        h("p", { class: "dv-muted", text: `People you add see it under “Shared with me”${isF ? ", with everything inside" : ""}.` }),
        canManage ? addBtn : h("p", { class: "dv-note", text: "Only the owner and editors can change who has access." }), list, h("div", { class: "menu-sec", text: "Link" }), linkRow,
        h("small", { class: "dv-note", text: "The link only opens for people who have access." }),
        h("div", { class: "dv-modal-acts" }, h("span", { class: "grow" }), canManage ? h("button", { class: "btn", text: "Cancel", onclick: () => m.close() }) : null, save)));
      m.el.style.width = "520px";
    }
    function itemActions(e, opts = {}) {
      const { x, isF } = e, w = world(), ed = w.canEdit(x, isF), groupRoot = isF && w.isGroupRoot(x), star = (x.starred || []).includes(meKey()), list = [e];
      if (x.deleted) return [
        ed ? { label: "Restore", icon: "restore", onClick: () => restore(x, isF) } : null,
        ed ? { label: "Delete forever", icon: "trash", danger: true, onClick: () => purgeItems(list) } : null,
        !ed ? { label: "Only people who can edit it can restore it", icon: "lock", onClick: () => {} } : null];
      return [
        isF ? { label: "Open", icon: "arrow", onClick: () => openEntry(e) } : opts.inViewer ? null : { label: "Preview", icon: "expand", onClick: () => openEntry(e) },
        !isF && x.data ? { label: "Download", icon: "download", onClick: () => download(x) } : null,
        !isF && x.type === "link" ? { label: "Open link", icon: "link", onClick: () => window.open(safeUrl(x.url), "_blank", "noopener") } : null,
        isF ? { label: "Download files", icon: "download", onClick: () => downloadMany(list) } : null,
        { sep: true },
        { label: star ? "Remove star" : "Star", icon: "star", onClick: () => toggleStar(x, isF) },
        { label: "Share", icon: "lock", onClick: () => shareDialog(x, isF) },
        { label: "Copy link", icon: "link", onClick: () => copyText(linkOf(x.id)) },
        { sep: true },
        ed && !groupRoot ? { label: "Rename", icon: "text", onClick: () => rename(x, isF) } : null,
        ed && !groupRoot ? { label: "Move to…", icon: "arrow", onClick: () => moveItems(list) } : null,
        { label: "Copy to…", icon: "copy", onClick: () => copyItems(list) },
        !isF && ed && x.data && versionsOn() ? { label: "Upload new version", icon: "turn", onClick: () => uploadVersion(x) } : null,
        !isF && !opts.inViewer ? { label: "Details & comments", icon: "page", onClick: () => openEntry(e, "details") } : null,
        groupRoot && G()?.open ? { label: "Open workgroup", iconHtml: esc(groupIcon(w.groupOf.get(x.id))), onClick: () => G().open(w.groupOf.get(x.id).id) } : null,
        { sep: true },
        ed && !groupRoot ? { label: "Move to recycle bin", icon: "trash", danger: true, onClick: () => { if (opts.inViewer) closeViewer(); trash(list); } } : null,
      ];
    }
    function itemMenu(e, anchor) { sheetMenu(anchor, itemActions(e), { title: e.x.name }); }

    /* ----- navigation ----- */
    function goSection(k) { sec = k; folder = ""; q = ""; filter = ""; search.value = ""; typeSel.value = ""; sel.clear(); lsSet("lumen-drive-sec", k); draw(); }
    function goFolder(id) {
      const f = W.folders.get(id); if (!f) return;
      const s = W.sectionOf(f, true);
      if (!(sec === "shared" && s === "shared")) sec = s;
      folder = id; q = ""; filter = ""; search.value = ""; typeSel.value = ""; sel.clear(); last = null; draw();
    }
    function openEntry(e, tab) {
      if (e.x.deleted) return itemMenu(e, body.querySelector(`[data-key="${e.key}"] .dv-more`) || body);
      if (e.isF) return goFolder(e.x.id);
      openViewer(e.x, shown, tab);
    }
    function resolvePending() {
      if (!pending) return;
      let id = pending;
      if (id.startsWith("s:")) { const s = id.slice(2); pending = ""; if (SECTIONS.some(x => x[0] === s)) { sec = s; folder = ""; } return; }
      if (id.startsWith("f:")) id = id.slice(2);
      const fo = W.folders.get(id), fi = fo ? null : Data.get("files", id);
      if (!fo && !fi) { if (Date.now() - started > 6000) { pending = ""; UI.toast("That file or folder isn't available any more"); } return; }
      pending = "";
      if (fi && HIDDEN.has(fi.folder)) { if (fi.folder === "__attachments") Apps.openFile({ id: fi.id, name: fi.name, type: fi.type }); return; }
      const x = fo || fi, isF = !!fo;
      if (!W.canSee(x, isF)) return UI.toast(`You don't have access to this ${isF ? "folder" : "file"}. Ask its owner to share it with you.`);
      if (W.gone(x, isF)) { sec = "bin"; folder = ""; UI.toast(`“${x.name}” is in the recycle bin`); return; }
      sec = W.sectionOf(x, isF); folder = isF ? x.id : W.par(x, false);
      if (!isF) setTimeout(() => { const list = (W.fils.get(folder) || []).filter(f => W.live(f, false) && W.sectionOf(f, false) === sec).sort(byName); openViewer(x, list.length ? list : [x]); }, 0);
    }

    /* ----- what's listed where ----- */
    const isShareRoot = (x, isF) => {
      const me = W.me, has = it => (it.shared || []).includes(me) || (it.shareEdit || []).includes(me);
      if (!has(x)) return false;
      const a = W.area(x, isF);
      return a.kind === "personal" && a.owner !== me && !(isF ? a.chain.slice(0, -1) : a.chain).some(has);
    };
    function binItems() {
      const all = [...[...W.folders.values()].map(x => ({ x, isF: true })), ...W.files.map(x => ({ x, isF: false }))];
      return all.filter(({ x, isF }) => x.deleted && W.canSee(x, isF) && !(x.deletedWith && W.folders.get(x.deletedWith)?.deleted))
        .map(e => ({ ...e, key: (e.isF ? "d:" : "f:") + e.x.id }));
    }
    function sharedCount() { return [...W.folders.values()].filter(f => !f.deleted && isShareRoot(f, true)).length + W.files.filter(f => !f.deleted && isShareRoot(f, false)).length; }
    function listing() {
      const me = W.me, E = (x, isF) => ({ x, isF, key: (isF ? "d:" : "f:") + x.id });
      const liveF = [...W.folders.values()].filter(f => W.live(f, true)), liveD = W.files.filter(f => W.live(f, false));
      if (sec === "bin") return { mode: "bin", items: binItems().filter(e => !q || String(e.x.name).toLowerCase().includes(q)) };
      if (q || filter) {
        const kinds = FILTER_KINDS[filter];
        const fs = filter && filter !== "folder" ? [] : liveF.filter(f => String(f.name).toLowerCase().includes(q));
        const ds = filter === "folder" ? [] : liveD.filter(f => (!q || String(f.name).toLowerCase().includes(q)) && (!kinds || kinds.includes(kindOf(f))));
        return { mode: "search", items: [...fs.map(f => E(f, true)), ...ds.map(f => E(f, false))] };
      }
      if (folder) return { mode: "folder", items: [...(W.dirs.get(folder) || []).filter(f => W.live(f, true)).map(f => E(f, true)), ...(W.fils.get(folder) || []).filter(f => W.live(f, false)).map(f => E(f, false))] };
      if (sec === "groups") return { mode: "groups", items: [] };
      if (sec === "my" || sec === "company") {
        const want = a => sec === "my" ? a.kind === "personal" && a.owner === me : a.kind === "company";
        return { mode: "root", items: [...(W.dirs.get("") || []).filter(f => W.live(f, true) && want(W.area(f, true))).map(f => E(f, true)), ...(W.fils.get("") || []).filter(f => W.live(f, false) && want(W.area(f, false))).map(f => E(f, false))] };
      }
      if (sec === "shared") return { mode: "flat", items: [...liveF.filter(f => isShareRoot(f, true)).map(f => E(f, true)), ...liveD.filter(f => isShareRoot(f, false)).map(f => E(f, false))] };
      if (sec === "starred") return { mode: "flat", items: [...liveF.filter(f => (f.starred || []).includes(me)).map(f => E(f, true)), ...liveD.filter(f => (f.starred || []).includes(me)).map(f => E(f, false))] };
      if (sec === "recent") {
        const opened = recentMap(), when = f => Math.max(opened[f.id] || 0, modOf(f));
        return { mode: "recent", items: liveD.sort((a, b) => when(b) - when(a)).slice(0, 50).map(f => E(f, false)) };
      }
      return { mode: "root", items: [] };
    }
    const typeLabel = e => e.isF ? "Folder" : KINDS[kindOf(e.x)][1] + (EXT(e.x.name) && e.x.type !== "link" ? " · " + EXT(e.x.name).toUpperCase() : "");
    const countIn = id => (W.dirs.get(id) || []).filter(f => !f.deleted).length + (W.fils.get(id) || []).filter(f => !f.deleted).length;
    function sortItems(items, mode) {
      if (mode === "recent" && sort.k === "name" && sort.d === 1) return items;
      const ownerName = e => (mode === "bin" ? Data.person(e.x.deletedBy || ownerOf(e.x)) : Data.person(ownerOf(e.x))).name || "";
      const val = {
        name: e => String(e.x.name || "").toLowerCase(), owner: ownerName, type: typeLabel,
        modified: e => mode === "bin" ? e.x.deletedAt || 0 : e.isF ? e.x.at || 0 : modOf(e.x),
        size: e => e.isF ? countIn(e.x.id) : e.x.size || 0,
      }[sort.k] || (e => String(e.x.name || "").toLowerCase());
      const cmp = (a, b) => { const va = val(a), vb = val(b); return (typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" })) * sort.d || byName(a.x, b.x); };
      return [...items.filter(e => e.isF).sort(cmp), ...items.filter(e => !e.isF).sort(cmp)];
    }

    /* ----- drawing ----- */
    function iconEl(e, big) {
      const { x, isF } = e;
      if (isF) {
        const g = W.groupOf.get(x.id), shared = (x.shared || []).length || (x.shareEdit || []).length;
        return h("div", { class: "dv-ic dv-fold" + (g ? " grp" : ""), style: g?.color ? { "--gc": g.color } : null }, h("span", { text: g ? groupIcon(g) : "📁" }), shared ? h("i", { class: "dv-badge", text: "🤝" }) : null);
      }
      const k = kindOf(x);
      if (k === "image" && x.data) return h("div", { class: "dv-thumb", style: { backgroundImage: `url("${x.data}")` } });
      if (k === "pdf" && x.data && big) {
        const el = h("div", { class: "dv-ic dv-pdf", dataset: { pdf: x.id } }, h("span", { text: "📕" }));
        const k2 = x.id + ":" + modOf(x);
        if (thumbs.has(k2)) thumbs.get(k2).then(u => { el.classList.add("dv-thumb"); el.style.backgroundImage = `url("${u}")`; el.replaceChildren(h("i", { class: "dv-pdf-tag", text: "PDF" })); }, () => {});
        else io?.observe(el);
        return el;
      }
      return h("div", { class: "dv-ic k-" + k }, h("span", { text: KINDS[k][0] }));
    }
    function badges(e) {
      const { x, isF } = e, me = W.me, out = [];
      if ((x.starred || []).includes(me)) out.push(h("span", { class: "dv-b star", title: "Starred", text: "★" }));
      if (!isF && ((x.shared || []).length || (x.shareEdit || []).length)) out.push(h("span", { class: "dv-b", title: "Shared", text: "🤝" }));
      if (!isF && (x.versions || []).length) out.push(h("span", { class: "dv-b ver", title: plural(x.versions.length + 1, "version"), text: "v" + (x.versions.length + 1) }));
      if (!isF && (x.comments || []).length) out.push(h("span", { class: "dv-b", title: plural(x.comments.length, "comment"), text: "💬 " + x.comments.length }));
      return out;
    }
    function itemEl(e, i, view, mode) {
      const { x, isF, key } = e, ed = W.canEdit(x, isF), on = sel.has(key);
      const showLoc = mode === "search" || mode === "flat" || mode === "recent" || mode === "bin";
      const ownerK = mode === "bin" ? x.deletedBy || ownerOf(x) : ownerOf(x), owner = Data.person(ownerK);
      const when = mode === "bin" ? x.deletedAt : isF ? x.at : modOf(x);
      const meta = isF ? plural(countIn(x.id), "item") : x.type === "link" ? "Link" : size(x.size);
      const cb = h("input", { type: "checkbox", class: "dv-cb", checked: on, title: "Select", onclick: ev => { ev.stopPropagation(); if (ev.shiftKey && last) { rangeSel(key); } else toggleSel(key, cb.checked); } });
      const more = h("button", { class: "icon-btn xs dv-more", title: "Actions", html: UI.icon("dots"), onclick: ev => { ev.stopPropagation(); itemMenu(e, ev.currentTarget); } });
      const loc = showLoc ? h("small", { class: "dv-loc", text: mode === "bin" ? "From " + W.loc(x, isF) : W.loc(x, isF) }) : null;
      const nameEl = h("div", { class: "dv-nm" }, h("div", { class: "dv-name-row" }, h("span", { class: "dv-name", text: x.name || "Untitled", title: x.name }), ...badges(e)), loc,
        view === "list" ? h("small", { class: "dv-sub", text: [meta, when ? UI.timeAgo(when) : ""].filter(Boolean).join(" · ") }) : null);
      let el;
      if (view === "list") {
        el = h("div", { class: "dv-lrow dv-item" },
          cb, iconEl(e, false), nameEl,
          h("span", { class: "dv-c dv-owner" }, Apps.avatar(owner, 20), h("span", { text: (owner.name || "").split(" ")[0] })),
          h("span", { class: "dv-c", text: when ? UI.timeAgo(when) : "—", title: fmtWhen(when) }),
          h("span", { class: "dv-c", text: meta }), h("span", { class: "dv-c dv-type", text: typeLabel(e) }), more);
      } else {
        el = h("div", { class: (view === "tiles" ? "dv-tile" : "dv-card") + " dv-item glass" },
          h("div", { class: "dv-vis" }, iconEl(e, view === "tiles")), cb, more,
          nameEl, h("div", { class: "dv-meta", text: showLoc ? meta : [meta, (owner.name || "").split(" ")[0], when ? UI.timeAgo(when) : ""].filter(Boolean).join(" · ") }));
      }
      el.dataset.key = key;
      el.classList.toggle("sel", on);
      el.style.animationDelay = Math.min(i * 22, 330) + "ms";
      el.tabIndex = 0;
      el.addEventListener("click", ev => {
        if (ev.shiftKey && last) return rangeSel(key);
        if (ev.ctrlKey || ev.metaKey) return toggleSel(key);
        if (sel.size && (phone() || matchMedia("(hover: none)").matches)) return toggleSel(key);
        openEntry(e);
      });
      el.addEventListener("keydown", ev => { if (ev.key === "Enter") openEntry(e); else if (ev.key === " ") { ev.preventDefault(); toggleSel(key); } });
      el.addEventListener("contextmenu", ev => { ev.preventDefault(); itemMenu(e, { left: ev.clientX, right: ev.clientX, top: ev.clientY, bottom: ev.clientY }); });
      if (ed && !x.deleted && !(isF && W.isGroupRoot(x))) {
        el.draggable = true;
        el.addEventListener("dragstart", ev => { const keys = sel.has(key) ? [...sel] : [key]; ev.dataTransfer.setData(DND, JSON.stringify(keys)); ev.dataTransfer.effectAllowed = "move"; el.classList.add("dragging"); });
        el.addEventListener("dragend", () => el.classList.remove("dragging"));
      }
      if (isF && !x.deleted) dropTarget(el, folderDest(x));
      return el;
    }
    function listHead(mode) {
      const all = h("input", { type: "checkbox", class: "dv-cb dv-cb-all", title: "Select all", onclick: ev => { ev.stopPropagation(); if (all.checked) order.forEach(k => sel.add(k)); else sel.clear(); paintSel(); } });
      const cols = [["name", "Name"], ["owner", mode === "bin" ? "Deleted by" : "Owner"], ["modified", mode === "bin" ? "Deleted" : "Modified"], ["size", "Size"], ["type", "Type"]];
      return h("div", { class: "dv-lrow dv-lhead" }, all, h("span"),
        ...cols.map(([k, l], i) => h("button", { class: "dv-sort" + (i ? " dv-c" : "") + (sort.k === k ? " on" : ""), onclick: () => { sort = { k, d: sort.k === k ? -sort.d : 1 }; lsSet("lumen-drive-sort", JSON.stringify(sort)); draw(); } },
          l, sort.k === k ? h("span", { class: "dv-arrow", text: sort.d > 0 ? "↑" : "↓" }) : null)), h("span"));
    }
    function sortMenu(anchor) {
      const opts = [["name", "Name"], ["modified", "Modified"], ["size", "Size"], ["type", "Type"], ["owner", "Owner"]];
      sheetMenu(anchor, [{ section: "Sort by" }, ...opts.map(([k, l]) => ({ label: l + (sort.k === k ? (sort.d > 0 ? "  ↑" : "  ↓") : ""), iconHtml: sort.k === k ? "✓" : "", onClick: () => { sort = { k, d: sort.k === k ? -sort.d : 1 }; lsSet("lumen-drive-sort", JSON.stringify(sort)); draw(); } }))], { title: "Sort" });
    }
    function drawNav() {
      const counts = { shared: sharedCount(), bin: binItems().length };
      const used = Data.list("files").reduce((s, f) => s + bytesOfData(f) + 200, 0), pct = Math.min(100, used / GB * 100);
      const searching = !!(q || filter);
      nav.replaceChildren(
        h("div", { class: "dv-secs" }, ...SECTIONS.map(([k, ic, l]) => {
          const b = h("button", { class: "dv-sec" + (sec === k && !searching ? " on" : ""), onclick: () => goSection(k) }, h("span", { class: "dv-sec-ic", text: ic }), h("span", { class: "dv-sec-t", text: l }), counts[k] ? h("span", { class: "dv-count", text: counts[k] }) : null);
          if (k === "my") dropTarget(b, () => ({ folder: "", scope: "personal", label: "My Drive" }));
          if (k === "company") dropTarget(b, () => companyEdit() ? { folder: "", scope: "company", label: "Company drive" } : null);
          return b;
        })),
        h("button", { class: "dv-storage" + (pct > 80 ? " warn" : ""), title: "Storage details", onclick: storageModal },
          h("div", { class: "dv-st-t" }, h("span", { text: "☁️ Storage" }), h("b", { text: size(used) })),
          h("div", { class: "dv-meter" }, h("i", { style: { width: Math.max(pct, 1.5) + "%" } })),
          h("small", { text: `of 1 GB guideline · ${pct < 1 ? pct.toFixed(1) : Math.round(pct)}%` })));
    }
    function drawCrumbs() {
      const s = SECTIONS.find(x => x[0] === sec);
      const crumb = (label, id, last) => {
        const b = h("button", { class: "dv-crumb" + (last ? " last" : ""), text: label, onclick: () => { if (id) goFolder(id); else { folder = ""; q = ""; filter = ""; search.value = ""; typeSel.value = ""; sel.clear(); draw(); } } });
        if (id) { const f = W.folders.get(id); if (f) dropTarget(b, folderDest(f)); }
        else if (sec === "my") dropTarget(b, () => ({ folder: "", scope: "personal", label: "My Drive" }));
        else if (sec === "company") dropTarget(b, () => companyEdit() ? { folder: "", scope: "company", label: "Company drive" } : null);
        return b;
      };
      const parts = [];
      if (q || filter) parts.push(h("span", { class: "dv-crumb last", text: "🔎 Search results" }));
      else {
        let chain = folder ? W.chain(folder) : [];
        if (sec === "shared") { const i = chain.findIndex(f => isShareRoot(f, true)); chain = chain.slice(Math.max(0, i)); }
        parts.push(crumb(s[1] + " " + s[2], "", !chain.length));
        chain.forEach((f, i) => parts.push(h("span", { class: "dv-csep", text: "/" }), crumb((W.isGroupRoot(f) ? groupIcon(W.groupOf.get(f.id)) + " " : "") + f.name, f.id, i === chain.length - 1)));
      }
      if (folder && !q && !filter) {
        const f = W.folders.get(folder);
        if (f) parts.push(h("button", { class: "icon-btn xs dv-fmenu", title: "Folder actions", html: UI.icon("dots"), onclick: ev => itemMenu({ x: f, isF: true, key: "d:" + f.id }, ev.currentTarget) }));
      }
      crumbs.replaceChildren(...parts);
    }
    function drawHint(mode, n) {
      const me = W.me;
      let text = "", extra = null;
      if (mode === "bin") { text = "Items here still use storage. Restore them or delete them forever."; if (n) extra = h("button", { class: "btn danger", text: "Empty bin", onclick: emptyBin }); }
      else if (mode === "search") text = `${plural(n, "result")} across everything you can see`;
      else if (folder) {
        const f = W.folders.get(folder), a = f && W.area(f, true);
        if (a?.kind === "group") text = `${groupIcon(a.group)} Workgroup folder · visible to people who can open “${a.group.name}”`;
        else if (a?.kind === "personal") { const ppl = W.people(f, true); text = a.owner === me ? (ppl.size ? `🤝 Shared with ${plural(ppl.size, "person")}` : "🔒 Only you can see this folder") : `🤝 Shared by ${Data.person(a.owner).name} · you can ${W.share(f, true) === "edit" ? "edit" : "view"}`; }
        else if (a) text = "🏢 Visible to everyone in the workspace";
        if (f && !W.canEdit(f, true)) text += " · view only";
      }
      else if (sec === "my") text = "🔒 Your private space. Only you see these files until you share them.";
      else if (sec === "company") text = "🏢 Everyone in the workspace can see Company drive." + (companyEdit() ? "" : " You can view it but not add files.");
      else if (sec === "shared") text = "Files and folders teammates shared with you.";
      else if (sec === "groups") text = "Each workgroup has its own folder, shared with its members.";
      else if (sec === "recent") text = "Files you opened or that changed lately.";
      else if (sec === "starred") text = "Your starred files and folders. Only you see your stars.";
      const sortBtn = view() !== "list" && mode !== "groups" ? h("button", { class: "chip-btn dv-sortbtn", onclick: ev => sortMenu(ev.currentTarget) }, "↕ " + ({ name: "Name", modified: "Modified", size: "Size", type: "Type", owner: "Owner" }[sort.k] || "Name")) : null;
      hint.replaceChildren(h("span", { text }), h("span", { class: "grow" }), sortBtn, extra);
    }
    function drawBulk() {
      const items = selected();
      bulk.classList.toggle("on", items.length > 0);
      if (!items.length) return bulk.replaceChildren();
      const inBin = items.every(e => e.x.deleted);
      bulk.replaceChildren(h("b", { text: `${items.length} selected` }), h("span", { class: "grow" }),
        ...(inBin ? [
          h("button", { class: "btn", text: "↩ Restore", onclick: async () => { for (const e of items) await restore(e.x, e.isF, true); UI.toast(`↩ Restored ${plural(items.length, "item")}`); sel.clear(); draw(); } }),
          h("button", { class: "btn danger", text: "Delete forever", onclick: () => purgeItems(items) })] : [
          h("button", { class: "btn", onclick: () => downloadMany(items) }, h("span", { html: UI.icon("download") }), h("span", { class: "dv-bl", text: "Download" })),
          h("button", { class: "btn", onclick: () => moveItems(items) }, h("span", { html: UI.icon("arrow") }), h("span", { class: "dv-bl", text: "Move" })),
          h("button", { class: "btn", onclick: () => copyItems(items) }, h("span", { html: UI.icon("copy") }), h("span", { class: "dv-bl", text: "Copy" })),
          h("button", { class: "btn danger", onclick: () => trash(items) }, h("span", { html: UI.icon("trash") }), h("span", { class: "dv-bl", text: "Delete" }))]),
        h("button", { class: "icon-btn", title: "Clear selection", html: UI.icon("x"), onclick: () => { sel.clear(); paintSel(); } }));
    }
    const view = () => { const v = viewOf(); return VIEWS.some(x => x[0] === v) ? v : "list"; };
    function drawGroups() {
      const g = G(), me = W.me;
      const groups = (g?.mine ? g.mine() : Data.list("projects").filter(p => p.folder)).filter(p => !p.deleted).sort((a, b) => (!!a.archived - !!b.archived) || byName(a, b));
      if (!groups.length) return body.replaceChildren(Apps.empty("👥", "No workgroups yet. Create one in Workgroups and it gets its own folder here.", g ? h("button", { class: "btn primary", text: "Open Workgroups", onclick: () => Apps.go("groups") }) : null));
      body.replaceChildren(h("div", { class: "dv-groups" }, ...groups.map((p, i) => {
        const f = p.folder && W.folders.get(p.folder), member = g?.isMember ? g.isMember(p) : true, readable = g?.canRead ? g.canRead(p) : true;
        const n = f ? countIn(f.id) : 0;
        const el = h("div", { class: "dv-group glass" + (readable ? "" : " locked"), style: { animationDelay: Math.min(i * 30, 330) + "ms", "--gc": p.color || "var(--accent)" }, tabIndex: 0,
          onclick: async () => {
            if (!readable) return UI.toast("Join the group to see its files");
            if (f) return goFolder(f.id);
            if (!member) return UI.toast("This group has no folder yet");
            const id = await Data.add("folders", { name: p.name || "Workgroup", parent: "" });
            await Data.update("projects", p.id, { folder: id });
            setTimeout(() => goFolder(id), 50);
          } },
          h("div", { class: "dvg-av", text: groupIcon(p) }),
          h("div", { class: "dvg-t" }, h("b", { text: p.name || "Workgroup" }), h("small", { text: !readable ? "🔒 Members only" : f ? plural(n, "item") + (member ? "" : " · view only") : member ? "Tap to create its folder" : "No folder yet" })),
          p.archived ? h("span", { class: "dv-role", text: "Archived" }) : null);
        if (f) dropTarget(el, folderDest(f));
        return el;
      })));
    }
    function emptyFor(mode) {
      const up = h("button", { class: "btn primary", text: "⬆ Upload", onclick: () => fileIn.click() });
      if (mode === "search") return Apps.empty("🔎", "Nothing matches your search.");
      if (mode === "bin") return Apps.empty("🗑️", "The recycle bin is empty.");
      if (folder) return Apps.empty("📂", "This folder is empty. Drop files here or use + New.", W.folders.get(folder) && W.canEdit(W.folders.get(folder), true) ? up : null);
      return {
        my: () => Apps.empty("👤", "Your private space. Drop files here; only you see them until you share them.", up),
        company: () => Apps.empty("🏢", "Drop files here to share them with everyone. Images, PDFs and docs up to 700 KB.", companyEdit() ? up : null),
        shared: () => Apps.empty("🤝", "Nothing has been shared with you yet."),
        recent: () => Apps.empty("🕘", "Files you open or change show up here."),
        starred: () => Apps.empty("⭐", "Star files and folders to find them fast."),
      }[sec]?.() || Apps.empty("🗂️", "Nothing here yet.");
    }
    function draw() {
      W = world();
      resolvePending();
      if (folder && (!W.folders.has(folder) || W.folders.get(folder).deleted || !W.canSee(W.folders.get(folder), true))) folder = "";
      const v = view(), L = listing(), items = sortItems(L.items, L.mode);
      order = items.map(e => e.key);
      [...sel].forEach(k => { if (!order.includes(k)) sel.delete(k); });
      shown = items.filter(e => !e.isF && !e.x.deleted).map(e => e.x);
      drawNav(); drawCrumbs(); drawHint(L.mode, items.length); drawBulk();
      viewSeg.replaceChildren(...VIEWS.map(([k, ic, l]) => h("button", { class: v === k ? "on" : "", title: l, onclick: () => { lsSet("lumen-drive-view:" + sec, k); draw(); } }, h("span", { text: ic }), h("span", { class: "dv-vl", text: " " + l }))));
      viewSeg.style.visibility = L.mode === "groups" ? "hidden" : "";
      root.classList.toggle("dv-selecting", sel.size > 0);
      io?.disconnect();
      io = "IntersectionObserver" in window ? new IntersectionObserver(es => es.forEach(en => {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        const f = Data.get("files", en.target.dataset.pdf); if (!f?.data) return;
        pdfThumb(f).then(u => { en.target.classList.add("dv-thumb"); en.target.style.backgroundImage = `url("${u}")`; en.target.replaceChildren(h("i", { class: "dv-pdf-tag", text: "PDF" })); }, () => {});
      }), { rootMargin: "200px" }) : null;
      if (L.mode === "groups") return drawGroups();
      if (!items.length) return body.replaceChildren(emptyFor(L.mode));
      const els = items.map((e, i) => itemEl(e, i, v, L.mode));
      if (v === "list") body.replaceChildren(h("div", { class: "dv-list glass" + (L.mode === "search" || L.mode === "flat" || L.mode === "recent" || L.mode === "bin" ? " with-loc" : "") }, listHead(L.mode), ...els));
      else body.replaceChildren(h("div", { class: v === "tiles" ? "dv-tiles" : "dv-grid" }, ...els));
    }
    const live = UI.liveDraw(root, draw);
    function schedule() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; live(); }); }

    /* ----- storage ----- */
    function storageModal() {
      const all = Data.list("files"), w = world();
      let drive = 0, bin = 0, ver = 0, att = 0;
      all.forEach(f => { const b = bytesOfData(f) + 200; if (f.folder === "__attachments") att += b; else if (f.folder === "__versions") ver += b; else if (f.deleted) bin += b; else drive += b; });
      const used = drive + bin + ver + att, pct = Math.min(100, used / GB * 100);
      const seg = (n, cls) => h("i", { class: cls, style: { width: (n / GB * 100) + "%" } });
      const row = (cls, l, n) => h("div", { class: "dv-strow" }, h("span", { class: "dv-dot " + cls }), h("span", { text: l }), h("b", { text: size(n) }));
      const big = w.files.filter(f => f.data && w.canSee(f, false)).sort((a, b) => (b.size || 0) - (a.size || 0)).slice(0, 10);
      const m = UI.modal("Storage", h("div", { class: "dv-stmodal" },
        h("div", { class: "dv-st-big" }, h("b", { text: size(used) }), h("span", { text: ` used of the 1 GB guideline (${pct < 1 ? pct.toFixed(2) : Math.round(pct)}%)` })),
        h("div", { class: "dv-meter big" }, seg(drive, "s-drive"), seg(bin, "s-bin"), seg(ver, "s-ver"), seg(att, "s-att")),
        h("div", { class: "dv-stlegend" }, row("s-drive", "Drive files", drive), row("s-bin", "In the recycle bin", bin), row("s-ver", "Older versions", ver), row("s-att", "Attachments in chats, tasks and posts", att)),
        h("p", { class: "dv-note", text: "Lumen keeps files inside the workspace database. Firestore's free plan includes about 1 GB, so keep big files as links, empty the recycle bin now and then, and delete files you no longer need." }),
        h("div", { class: "menu-sec", text: "Biggest files" }),
        big.length ? h("div", { class: "dv-biglist" }, ...big.map(f => h("button", { class: "dv-bigrow", onclick: () => { m.close(); if (f.deleted) { goSection("bin"); } else openViewer(f, big.filter(x => !x.deleted)); } },
          h("span", { class: "dv-bic", text: KINDS[kindOf(f)][0] }), h("span", { class: "dv-bit" }, h("b", { text: f.name }), h("small", { text: (f.deleted ? "In the recycle bin · " : "") + w.loc(f, false) })), h("b", { text: size(f.size) })))) : h("div", { class: "dv-note", text: "No uploaded files yet." })));
      m.el.style.width = "560px";
    }

    /* ----- viewer ----- */
    function closeViewer() { if (V) { const v = V; V = null; v.close(); } }
    function openViewer(f, list, firstTab) {
      closeViewer();
      const ids = (list && list.length ? list : [f]).map(x => x.id);
      if (!ids.includes(f.id)) ids.unshift(f.id);
      let cur = f.id, token = 0, urls = [], pdfDoc = null, pageIO = null, zoom = "fit", stageKey = "", closed = false, tab = firstTab || ls("lumen-drive-vtab", "details");
      if (phone() && !firstTab) tab = "details";
      touch(cur);
      const stage = h("div", { class: "dvw-stage" }), title = h("div", { class: "dvw-title" }), acts = h("div", { class: "dvw-acts" });
      const tabsBar = h("div", { class: "seg dvw-tabs" }), content = h("div", { class: "dvw-content" }), side = h("aside", { class: "dvw-side glass-strong" }, tabsBar, content);
      const prev = h("button", { class: "dvw-nav prev", title: "Previous (←)", html: UI.icon("caret"), onclick: () => step(-1) });
      const next = h("button", { class: "dvw-nav next", title: "Next (→)", html: UI.icon("caret"), onclick: () => step(1) });
      const el = h("div", { class: "dvw" }, h("div", { class: "dvw-top glass-strong" }, title, acts), h("div", { class: "dvw-main" }, h("div", { class: "dvw-stage-wrap" }, stage, prev, next), side));
      el.addEventListener("mousedown", e => { if (e.target === el || e.target.classList.contains("dvw-stage-wrap")) closeViewer(); });
      document.getElementById("layer").append(el);
      const cList = h("div", { class: "dvw-comments" });
      const cInput = h("textarea", { class: "menu-input dvw-cin", rows: 2, placeholder: "Write a comment… type @ to mention someone" });
      const composer = h("div", { class: "dvw-compose" }, cInput, h("button", { class: "btn primary", text: "Post", onclick: post }));
      Apps.mentionAssist(cInput);
      cInput.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !document.querySelector("#layer .pop")) { e.preventDefault(); post(); } });
      const freeUrls = () => { urls.forEach(u => URL.revokeObjectURL(u)); urls = []; pageIO?.disconnect(); pageIO = null; if (pdfDoc) { try { pdfDoc.destroy(); } catch {} pdfDoc = null; } };
      const still = my => my === token && !closed;
      function step(d) { if (ids.length < 2) return; const i = ids.indexOf(cur); let j = i, n = 0; do { j = (j + d + ids.length) % ids.length; n++; } while (n < ids.length && !Data.get("files", ids[j])); if (ids[j] !== cur) { cur = ids[j]; zoom = "fit"; cInput.value = ""; touch(cur); show(true); } }
      const onKey = e => {
        if (document.querySelector("#layer .backdrop, #layer .pop, .dv-sheet-bd")) return;
        const a = document.activeElement;
        if (a && (a.tagName === "TEXTAREA" || a.tagName === "INPUT" || a.tagName === "SELECT")) { if (e.key === "Escape") a.blur(); return; }
        if (e.key === "Escape") closeViewer(); else if (e.key === "ArrowLeft") step(-1); else if (e.key === "ArrowRight") step(1);
      };
      document.addEventListener("keydown", onKey);
      function show(full) {
        const fx = Data.get("files", cur);
        if (!fx || fx.deleted) { UI.toast(fx ? "That file was moved to the recycle bin" : "That file was deleted"); return closeViewer(); }
        const sk = fx.id + ":" + modOf(fx) + ":" + (fx.data ? fx.data.length : fx.url);
        if (full || sk !== stageKey) { stageKey = sk; drawStage(fx); }
        drawTop(fx); drawSide(fx);
        prev.hidden = next.hidden = ids.length < 2;
      }
      async function drawStage(fx) {
        const my = ++token, k = kindOf(fx);
        freeUrls();
        stage.className = "dvw-stage k-" + k;
        stage.replaceChildren(h("div", { class: "dvw-load" }, h("span", { class: "dv-spin" })));
        try {
          if (k === "image" && fx.data) {
            const img = h("img", { class: "dvw-img", src: fx.data, alt: fx.name, draggable: false });
            const box = h("div", { class: "dvw-imgbox" }, img), lbl = h("span", { class: "dvw-zl", text: "Fit" });
            const apply = () => {
              if (zoom === "fit") { img.style.width = ""; img.style.maxWidth = "100%"; img.style.maxHeight = "100%"; box.classList.remove("zoomed"); lbl.textContent = "Fit"; }
              else { img.style.maxWidth = "none"; img.style.maxHeight = "none"; img.style.width = Math.round((img.naturalWidth || 800) * zoom) + "px"; box.classList.add("zoomed"); lbl.textContent = Math.round(zoom * 100) + "%"; }
            };
            const fitScale = () => img.naturalWidth ? img.getBoundingClientRect().width / img.naturalWidth : 1;
            const z = d => { const s = zoom === "fit" ? fitScale() : zoom; zoom = Math.min(8, Math.max(.05, s * d)); apply(); };
            box.addEventListener("wheel", e => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); z(e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
            img.addEventListener("dblclick", () => { zoom = zoom === "fit" ? 1 : "fit"; apply(); });
            let pan = null;
            box.addEventListener("pointerdown", e => { if (zoom === "fit" || e.pointerType === "touch") return; pan = { x: e.clientX, y: e.clientY, l: box.scrollLeft, t: box.scrollTop }; box.setPointerCapture(e.pointerId); box.classList.add("panning"); });
            box.addEventListener("pointermove", e => { if (!pan) return; box.scrollLeft = pan.l - (e.clientX - pan.x); box.scrollTop = pan.t - (e.clientY - pan.y); });
            box.addEventListener("pointerup", () => { pan = null; box.classList.remove("panning"); });
            img.onload = apply;
            const zb = (t, title, fn) => h("button", { class: "dvw-zb", title, text: t, onclick: fn });
            stage.replaceChildren(box, h("div", { class: "dvw-zoom glass-strong" }, zb("−", "Zoom out", () => z(1 / 1.25)), lbl, zb("+", "Zoom in", () => z(1.25)), zb("⤢", "Fit to screen", () => { zoom = "fit"; apply(); }), zb("1:1", "Actual size", () => { zoom = 1; apply(); })));
          } else if (k === "pdf" && fx.data) {
            try {
              const lib = await pdfjs(); if (!still(my)) return;
              const doc = await lib.getDocument({ data: bytes(fx.data) }).promise;
              if (!still(my)) { doc.destroy(); return; }
              pdfDoc = doc;
              const p1 = await doc.getPage(1), vp1 = p1.getViewport({ scale: 1 });
              if (!still(my)) return;
              const wrap = h("div", { class: "dvw-pdf" });
              stage.replaceChildren(wrap, h("div", { class: "dvw-zoom glass-strong" }, h("span", { class: "dvw-zl", text: plural(doc.numPages, "page") }),
                h("button", { class: "dvw-zb", title: "Open in a new tab", text: "↗", onclick: () => openBlob(fx) })));
              pageIO = new IntersectionObserver(es => es.forEach(async en => {
                if (!en.isIntersecting) return;
                pageIO?.unobserve(en.target);
                try {
                  const page = await doc.getPage(+en.target.dataset.n); if (!still(my)) return;
                  const w = Math.max(200, Math.min(wrap.clientWidth - 24, 980)), dpr = Math.min(2, window.devicePixelRatio || 1);
                  const vp = page.getViewport({ scale: w / page.getViewport({ scale: 1 }).width * dpr });
                  const c = h("canvas"); c.width = vp.width; c.height = vp.height;
                  const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
                  await page.render({ canvasContext: ctx, viewport: vp }).promise;
                  if (still(my)) en.target.replaceChildren(c);
                } catch {}
              }), { root: wrap, rootMargin: "600px 0px" });
              for (let n = 1; n <= Math.min(doc.numPages, 500); n++) { const ph = h("div", { class: "dvw-page", dataset: { n }, style: { aspectRatio: `${vp1.width} / ${vp1.height}` } }, h("span", { class: "dv-spin" })); wrap.append(ph); pageIO.observe(ph); }
            } catch (err) {
              if (!still(my)) return;
              const u = URL.createObjectURL(await blobOf(fx)); urls.push(u);
              if (!still(my)) return;
              stage.replaceChildren(h("iframe", { class: "dvw-frame", src: u, title: fx.name }));
            }
          } else if ((k === "text" || k === "md" || k === "csv") && fx.data) {
            let txt = await fetch(fx.data).then(r => r.text());
            if (!still(my)) return;
            const cut = txt.length > 300000; if (cut) txt = txt.slice(0, 300000);
            let view;
            if (k === "md") view = h("div", { class: "dvw-md", html: md(txt) });
            else if (k === "csv") {
              const { rows, cut: rc } = csv(txt);
              view = h("div", { class: "dvw-csv" }, h("table", null, rows[0] ? h("thead", null, h("tr", null, h("th", { class: "rn", text: "#" }), ...rows[0].map(c => h("th", { text: c })))) : null,
                h("tbody", null, ...rows.slice(1).map((r, i) => h("tr", null, h("td", { class: "rn", text: i + 1 }), ...r.map(c => h("td", { text: c })))))),
                rc ? h("div", { class: "dv-note", text: "Showing the first 1,000 rows. Download the file to see everything." }) : null);
            } else {
              if (/json/.test(fx.type) || EXT(fx.name) === "json") { try { txt = JSON.stringify(JSON.parse(txt), null, 2); } catch {} }
              view = h("pre", { class: "dvw-text", text: txt });
            }
            stage.replaceChildren(h("div", { class: "dvw-doc glass-strong" + (k === "csv" ? " wide" : "") }, view, cut ? h("div", { class: "dv-note", text: "This file is long, so only the beginning is shown." }) : null));
          } else if ((k === "video" || k === "audio") && fx.data) {
            const u = URL.createObjectURL(await blobOf(fx));
            if (!still(my)) { URL.revokeObjectURL(u); return; }
            urls.push(u);
            stage.replaceChildren(k === "video" ? h("video", { class: "dvw-video", src: u, controls: true, playsinline: true, preload: "metadata" })
              : h("div", { class: "dvw-other glass-strong" }, h("div", { class: "dvw-big spin", text: "🎵" }), h("b", { text: fx.name }), h("audio", { src: u, controls: true, preload: "metadata" })));
          } else if (k === "link") {
            stage.replaceChildren(h("div", { class: "dvw-other glass-strong" }, h("div", { class: "dvw-big", text: "🔗" }), h("b", { text: fx.name }),
              h("a", { class: "dvw-url", href: safeUrl(fx.url), target: "_blank", rel: "noopener noreferrer", text: fx.url || "" }),
              h("a", { class: "btn primary", href: safeUrl(fx.url), target: "_blank", rel: "noopener noreferrer", text: "Open link ↗" })));
          } else {
            stage.replaceChildren(h("div", { class: "dvw-other glass-strong" }, h("div", { class: "dvw-big", text: KINDS[k][0] }), h("b", { text: fx.name }),
              h("span", { class: "dv-muted", text: `${KINDS[k][1]} · ${size(fx.size)} · no preview for this type` }),
              fx.data ? h("button", { class: "btn primary", text: "⬇ Download", onclick: () => download(fx) }) : null));
          }
        } catch (err) {
          console.error(err);
          if (still(my)) stage.replaceChildren(h("div", { class: "dvw-other glass-strong" }, h("div", { class: "dvw-big", text: "😕" }), h("b", { text: "Couldn't show this file" }), fx.data ? h("button", { class: "btn primary", text: "⬇ Download", onclick: () => download(fx) }) : null));
        }
      }
      function openBlob(fx) { blobOf(fx).then(b => { const u = URL.createObjectURL(b); window.open(u, "_blank", "noopener"); setTimeout(() => URL.revokeObjectURL(u), 60000); }); }
      function drawTop(fx) {
        const star = (fx.starred || []).includes(meKey()), i = ids.indexOf(cur), k = kindOf(fx);
        title.replaceChildren(h("span", { class: "dvw-ic", text: KINDS[k][0] }), h("div", { class: "dvw-tt" }, h("b", { text: fx.name, title: fx.name }),
          h("small", { text: [ids.length > 1 ? `${i + 1} of ${ids.length}` : "", fx.type === "link" ? "Link" : size(fx.size), "changed " + UI.timeAgo(modOf(fx) || Date.now())].filter(Boolean).join(" · ") })));
        acts.replaceChildren(
          fx.data ? iconBtn("download", "Download", () => download(fx)) : fx.type === "link" ? iconBtn("link", "Open link", () => window.open(safeUrl(fx.url), "_blank", "noopener")) : null,
          iconBtn("star", star ? "Remove star" : "Star", () => toggleStar(fx, false), star ? "dvw-star on" : "dvw-star"),
          h("button", { class: "btn dvw-share", onclick: () => shareDialog(fx, false) }, h("span", { html: UI.icon("lock") }), h("span", { class: "dv-bl", text: "Share" })),
          iconBtn("dots", "More", e => sheetMenu(e.currentTarget, itemActions({ x: fx, isF: false, key: "f:" + fx.id }, { inViewer: true }), { title: fx.name })),
          iconBtn("x", "Close (Esc)", closeViewer));
      }
      function drawSide(fx) {
        const nC = (fx.comments || []).length, nV = (fx.versions || []).length;
        if (tab === "versions" && !versionsOn()) tab = "details";
        tabsBar.replaceChildren(...[["details", "Details"], ["comments", "Comments" + (nC ? " " + nC : "")], versionsOn() ? ["versions", "Versions" + (nV ? " " + (nV + 1) : "")] : null].filter(Boolean).map(([k, l]) =>
          h("button", { class: tab === k ? "on" : "", text: l, onclick: () => { tab = k; lsSet("lumen-drive-vtab", k); const cf = Data.get("files", cur); if (cf) drawSide(cf); if (k === "comments" && !phone()) setTimeout(() => cInput.focus(), 30); } })));
        if (tab === "comments") { if (!content.contains(composer)) content.replaceChildren(cList, composer); drawComments(fx); }
        else content.replaceChildren(tab === "versions" ? versionsEl(fx) : detailsEl(fx));
      }
      function detailsEl(fx) {
        const w = world(), a = w.area(fx, false), owner = Data.person(ownerOf(fx)), k = kindOf(fx), me = w.me;
        const row = (l, ...v) => h("div", { class: "dvw-row" }, h("span", { class: "dvw-l", text: l }), h("div", { class: "dvw-v" }, ...v));
        const p = w.par(fx, false), chain = p ? w.chain(p) : [];
        const locEl = h("div", { class: "dvw-loc" }, h("button", { class: "dv-crumb", text: w.loc(fx, false).split(" / ")[0], onclick: () => { closeViewer(); goSection(w.sectionOf(fx, false)); } }),
          ...chain.flatMap(f => [h("span", { class: "dv-csep", text: "/" }), h("button", { class: "dv-crumb", text: f.name, onclick: () => { closeViewer(); goFolder(f.id); } })]));
        let access;
        if (a.kind === "group") access = h("span", { text: `${groupIcon(a.group)} Members of “${a.group.name}”` });
        else if (a.kind === "company") access = h("span", { text: "🏢 Everyone in the workspace" });
        else { const ppl = w.people(fx, false); access = ppl.size ? h("span", { class: "dvw-acc" }, Apps.avatars([a.owner, ...ppl.keys()], 22, 6), h("span", { text: ` Shared with ${plural(ppl.size, "person")}` })) : h("span", { text: `🔒 Only ${a.owner === me ? "you" : owner.name}` }); }
        return h("div", { class: "dvw-details" },
          k === "image" && fx.data ? h("div", { class: "dvw-prevmini", style: { backgroundImage: `url("${fx.data}")` } }) : null,
          row("Owner", h("span", { class: "dvw-who" }, Apps.avatar(owner, 22), h("span", { text: owner.name }))),
          row("Type", KINDS[k][1] + (EXT(fx.name) && fx.type !== "link" ? ` (.${EXT(fx.name)})` : "")),
          fx.type === "link" ? row("Link", h("a", { href: safeUrl(fx.url), target: "_blank", rel: "noopener noreferrer", class: "dvw-url", text: fx.url || "" })) : row("Size", size(fx.size)),
          row("Created", `${fmtWhen(fx.at)} by ${Data.person(fx.by).name}`),
          row("Modified", fmtWhen(modOf(fx)) + (fx.modifiedBy ? ` by ${Data.person(fx.modifiedBy).name}` : "")),
          row("Location", locEl),
          row("Access", access),
          !versionsOn() ? null : row("Versions", fx.data ? h("button", { class: "dv-link", text: plural((fx.versions || []).length + 1, "version"), onclick: () => { tab = "versions"; drawSide(fx); } }) : "—"),
          row("Comments", h("button", { class: "dv-link", text: (fx.comments || []).length ? plural(fx.comments.length, "comment") : "Add a comment", onclick: () => { tab = "comments"; drawSide(fx); setTimeout(() => cInput.focus(), 30); } })),
          h("div", { class: "dvw-btns" }, h("button", { class: "btn", text: "🤝 Share", onclick: () => shareDialog(fx, false) }), h("button", { class: "btn", text: "🔗 Copy link", onclick: () => copyText(linkOf(fx.id)) })));
      }
      function versionsEl(fx) {
        const w = world(), ed = w.canEdit(fx, false) && !!fx.data;
        if (!fx.data) return h("div", { class: "dv-note", text: fx.type === "link" ? "Links don't have versions." : "This file has no stored content." });
        const vRow = (v, current) => h("div", { class: "dvw-ver" + (current ? " cur" : "") }, Apps.avatar(Data.person(v.by), 28),
          h("div", { class: "dvw-vt" }, h("b", { text: current ? "Current version" : fmtWhen(v.at) }), h("small", { text: [current ? fmtWhen(v.at) : "", Data.person(v.by).name, size(v.size)].filter(Boolean).join(" · ") })),
          current ? h("span", { class: "dv-role", text: "Now" }) : h("span", { class: "dvw-vacts" },
            iconBtn("download", "Download this version", () => { const d = Data.get("files", v.id); d ? download({ ...d, name: verName(fx.name, v.at) }) : UI.toast("That version is no longer available"); }, "xs"),
            ed ? h("button", { class: "btn", text: "Restore", onclick: async () => { if (await UI.confirm("Restore this version? The current one stays in the history.", "Restore")) { await restoreVersion(fx, v); UI.toast("↩ Version restored"); } } }) : null));
        return h("div", { class: "dvw-versions" },
          ed ? h("button", { class: "btn primary dvw-wide", text: "⬆ Upload new version", onclick: () => uploadVersion(fx) }) : null,
          vRow({ at: modOf(fx), by: fx.modifiedBy || ownerOf(fx), size: fx.size }, true),
          ...(fx.versions || []).slice().reverse().map(v => vRow(v, false)),
          h("p", { class: "dv-note", text: keep() ? `Lumen keeps the last ${keep()} older version${keep() === 1 ? "" : "s"}. They count toward storage.` : "Older versions aren't kept in this workspace." }));
      }
      function drawComments(fx) {
        const cs = (fx.comments || []).slice().sort((a, b) => (a.at || 0) - (b.at || 0)), me = meKey();
        cList.replaceChildren(...(cs.length ? cs.map(c => h("div", { class: "dvw-c" }, Apps.avatar(Data.person(c.by), 28),
          h("div", { class: "dvw-cb" }, h("div", { class: "dvw-ch" }, h("b", { text: Data.person(c.by).name }), h("small", { text: UI.timeAgo(c.at || Date.now()) }),
            c.by === me ? h("button", { class: "icon-btn xs", title: "Delete comment", html: UI.icon("trash"), onclick: () => Data.arr("files", fx.id, "comments", c, false) }) : null),
            h("div", { class: "dvw-ctext", html: mentionHtml(c.text) })))) : [h("div", { class: "dv-note dvw-noc", text: "No comments yet. Ask a question or leave feedback; type @ to mention a teammate." })]));
        cList.scrollTop = cList.scrollHeight;
      }
      function post() {
        const text = cInput.value.trim(); if (!text) return;
        const fx = Data.get("files", cur); if (!fx) return;
        const me = Data.me(), c = { id: Data.uid(), by: me.key, text, at: Date.now() };
        Data.arr("files", fx.id, "comments", c);
        cInput.value = "";
        const link = "#/app/drive/f:" + fx.id, ment = Apps.mentioned(text).filter(k => k !== me.key);
        ment.forEach(k => Data.notify(k, `💬 <b>${esc(me.name)}</b> mentioned you on <b>${esc(fx.name)}</b>`, link, text));
        if (!ment.includes(ownerOf(fx))) Data.notify(ownerOf(fx), `💬 <b>${esc(me.name)}</b> commented on <b>${esc(fx.name)}</b>`, link, text);
      }
      V = {
        close() { closed = true; token++; freeUrls(); document.removeEventListener("keydown", onKey); el.classList.add("closing"); setTimeout(() => el.remove(), 200); },
        refresh: () => { if (!closed) show(false); },
      };
      show(true);
    }

    /* ----- keyboard ----- */
    const onKey = e => {
      if (Apps.current?.() !== "drive" || V || document.querySelector("#layer .backdrop, #layer .pop, .dv-sheet-bd")) return;
      const a = document.activeElement, typing = a && (a.tagName === "INPUT" && a.type !== "checkbox" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable);
      if (typing) return;
      if (e.key === "Escape" && sel.size) { sel.clear(); paintSel(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && order.length) { e.preventDefault(); order.forEach(k => sel.add(k)); paintSel(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && sel.size && sec !== "bin") { e.preventDefault(); trash(selected()); }
    };
    document.addEventListener("keydown", onKey);

    const offs = ["files", "folders", "projects", "settings"].map(c => Data.on(c, () => { schedule(); if (c === "files" || c === "settings") V?.refresh(); })); // settings: versions on/off
    if (pending) setTimeout(schedule, 6500);
    draw();
    return () => {
      offs.forEach(f => f()); io?.disconnect(); cancelAnimationFrame(raf); clearTimeout(upHide); upBox.remove();
      document.removeEventListener("keydown", onKey);
      closeViewer(); [...sheets].forEach(c => c());
    };
  }

  Apps.register("drive", { title: "Drive", icon: "🗂️", render });
})();
