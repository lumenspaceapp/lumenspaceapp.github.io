/* Backups (js/backups.js): Settings → Backups for shared workspaces.
   - Export now: every collection (one-off Firestore reads, not Data.list which caps some at 400) + pages + safe workspace fields
     into one JSON file: { lumenBackup: 1, ws: { id, name, icon, root, branchLabel }, at, by, counts, data: { col: { id: doc } }, pages: { id: doc } }.
     Firestore Timestamps become { __ts: ms } and turn back into Timestamps on restore.
   - Restore (owner/admins): from a file or a Google Drive backup. Preview, tick collections, confirm, then writeBatch in chunks of 400
     (merge, same ids, never deletes anything). Warns when the backup came from another workspace.
   - Automatic daily backups to the admin's own Google Drive (window.GDrive, js/gdrive.js), folder "Lumen backups - <workspace name>".
     Run quietly in the background when that admin has Lumen open with Google Drive connected and the last backup is over 24 h old;
     afterwards backups older than keepDays are moved to the Google Drive bin.
   Stores settings/backup: { auto, keepDays, lastAt, lastBy, lastFile: { id, name, size }, folderId, folderBy }.
   Exposes window.Backups = { draw(ctx, kit) } for js/apps/settings.js. */
(function () {
  const { h } = UI;
  const DAY = 24 * 3600e3;
  const SKIP = new Set(["notifications", "presence", "logins", "apikeys"]);
  const KEEP = [[7, "7 days"], [14, "14 days"], [30, "30 days"], [90, "90 days"]];
  const NAME_RE = /^lumen-backup-.*?(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})\.json$/i;
  const DRIVE_API = "https://www.googleapis.com/drive/v3/";
  const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/";
  const CHUNK = 400, CHUNK_BYTES = 8 * 1024 * 1024; // Firestore: 500 writes and ~10 MB per batch

  /* ---------- small helpers ---------- */
  const fs = () => window.Cloud?.fs;
  const shared = () => !!(window.Cloud?.ws && window.Cloud?.user && fs()?.ref?.());
  const isAdmin = key => (Apps.isAdmin ? Apps.isAdmin(key) : true);
  const myEmail = () => String(window.Cloud?.user?.email || "").toLowerCase();
  const conf = () => (window.Data && Data.get("settings", "backup")) || {};
  const keepDays = c => [7, 14, 30, 90].includes(+c.keepDays) ? +c.keepDays : 30;
  const hasDrive = () => !!window.GDrive;
  const driveErr = e => (window.GDrive ? GDrive.errText(e) : e?.message || "Something went wrong with Google Drive.");
  const pad = n => String(n).padStart(2, "0");
  const stamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const slug = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "workspace";
  const folderName = () => "Lumen backups - " + (window.Cloud?.ws?.name || "workspace").replace(/[\\/]/g, "-").slice(0, 80);
  const fmtWhen = ms => ms ? new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
  function fmtSize(n) {
    n = +n || 0;
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
    return (n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0) + " MB";
  }
  const nameOf = key => { try { return Data.person(key).name || key; } catch { return key; } };
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const LABELS = { tasks: "Tasks", projects: "Projects and workgroups", chat: "Chat messages", channels: "Chat channels", feed: "Feed posts", events: "Calendar events", leads: "Leads",
    deals: "Deals", contacts: "Contacts", companies: "Companies", people: "People profiles", absences: "Time off", timelog: "Time log", files: "Files", folders: "Folders",
    rules: "Automation rules", products: "Products", quotes: "Estimates and invoices", activities: "CRM activities", history: "CRM history", items: "Smart process items",
    settings: "Settings", bookings: "Bookings", inventory: "Inventory", forms: "Web forms", formsubs: "Web form entries", reports: "Work reports", shifts: "Work schedules",
    meetings: "Meetings", lists: "Lists", listitems: "List items", processes: "RPA processes", procitems: "RPA items", workflows: "Approval templates", wfruns: "Approvals",
    dashboards: "Dashboards", boards: "Boards", boardels: "Board elements", signdocs: "e-Signature documents", campaigns: "Campaigns", segments: "Segments",
    kbspaces: "Knowledge base spaces", kbarticles: "Knowledge base articles", pages: "Pages" };
  const label = col => LABELS[col] || col;
  const backupCols = () => (window.Data?.COLS || []).filter(c => !SKIP.has(c));

  // Firestore values <-> plain JSON (Timestamps become { __ts: ms })
  function enc(v) {
    if (v == null || typeof v !== "object") return v;
    if (typeof v.toMillis === "function") return { __ts: v.toMillis() };
    if (Array.isArray(v)) return v.map(enc);
    const o = {};
    for (const k of Object.keys(v)) o[k] = enc(v[k]);
    return o;
  }
  function dec(v, fb) {
    if (v == null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(x => dec(x, fb));
    const keys = Object.keys(v);
    if (keys.length === 1 && keys[0] === "__ts" && typeof v.__ts === "number") return fb.Timestamp.fromMillis(v.__ts);
    const o = {};
    for (const k of keys) o[k] = dec(v[k], fb);
    return o;
  }
  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" })), a = h("a", { href: url, download: name });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 8000);
  }

  /* ---------- view state (the Settings section) ---------- */
  let view = null;                 // { ctx, el } of the last drawn section
  let job = null;                  // { kind: "backup"|"export"|"restore", text, pct }
  let jobEls = [];                 // progress bars currently on screen
  const files = { folderId: "", items: null, at: 0, err: null, loading: false };
  let notice = "";                 // one-time message from the background run (shown in the section)
  function refresh() { if (view?.el?.isConnected) view.ctx.redraw(); }
  function setJob(j) {
    job = j;
    jobEls = jobEls.filter(x => x.isConnected);
    jobEls.forEach(paintJob);
    if (!j) refresh();
  }
  function paintJob(el) {
    if (!job) { el.hidden = true; return; }
    el.hidden = false;
    el.querySelector(".bku-job-t").textContent = job.text || "Working…";
    el.querySelector(".bku-bar > i").style.width = Math.round(Math.max(.03, Math.min(1, job.pct || 0)) * 100) + "%";
  }
  function jobBox() {
    const el = h("div", { class: "bku-job", role: "status", "aria-live": "polite" }, h("span", { class: "bku-job-t" }), h("div", { class: "bku-bar" }, h("i")));
    jobEls.push(el); paintJob(el);
    return el;
  }
  const kitMark = () => { try { Apps.SettingsKit?.markWrite?.(); } catch {} };

  /* ---------- saving settings/backup ---------- */
  // wsId: write to that workspace even if the user switched to another one meanwhile
  async function saveConf(patch, wsId) {
    kitMark();
    if (!wsId || window.Cloud?.ws?.id === wsId) return Data.update("settings", "backup", patch);
    const { fb, db } = fs();
    await fb.setDoc(fb.doc(db, "workspaces", wsId, "settings", "backup"), JSON.parse(JSON.stringify(patch)), { merge: true }).catch(e => console.warn("backup settings", e));
  }

  /* ---------- collecting a backup ---------- */
  async function collect(onProgress = () => {}) {
    const F = fs(); if (!F || !shared()) throw new Error("Open a shared workspace first");
    const { fb } = F, ref = F.ref(), ws = window.Cloud.ws, wsId = ws.id;
    const fromServer = fb.getDocsFromServer || fb.getDocs;
    const cols = backupCols(), steps = cols.length + 2;
    const data = {}, counts = {}, skipped = [];
    let step = 0;
    const tick = () => onProgress(++step / steps);
    let wsDoc = {};
    try { const s = await (fb.getDocFromServer || fb.getDoc)(ref); wsDoc = s.exists() ? s.data() : {}; } catch (e) { if (e.code === "unavailable") throw offline(); console.warn("backup ws", e); }
    tick();
    for (const col of cols) {
      try {
        const snap = await fromServer(fb.collection(ref, col));
        if (snap.size) { const o = {}; snap.forEach(d => { o[d.id] = enc(d.data()); }); data[col] = o; counts[col] = snap.size; }
      } catch (e) {
        if (e.code === "unavailable") throw offline();
        console.warn("backup", col, e); skipped.push(col);
      }
      if (window.Cloud.ws?.id !== wsId) throw new Error("The workspace changed during the backup");
      tick();
    }
    const pages = {};
    try { const snap = await fromServer(fb.collection(ref, "pages")); snap.forEach(d => { pages[d.id] = enc(d.data()); }); counts.pages = snap.size; }
    catch (e) { if (e.code === "unavailable") throw offline(); console.warn("backup pages", e); skipped.push("pages"); }
    tick();
    const now = new Date();
    const obj = {
      lumenBackup: 1,
      ws: { id: wsId, name: wsDoc.name || ws.name || "", icon: wsDoc.icon || ws.icon || "", root: Array.isArray(wsDoc.root) ? wsDoc.root : [], branchLabel: wsDoc.branchLabel || "" },
      at: now.getTime(), by: myEmail(), counts, data, pages,
      ...(skipped.length ? { skipped } : {}),
    };
    const json = JSON.stringify(obj);
    return { obj, json, size: new Blob([json]).size, name: `lumen-backup-${slug(obj.ws.name)}-${stamp(now)}.json`, wsId, skipped };
  }
  const offline = () => Object.assign(new Error("You're offline. Backups need a connection."), { code: "offline" });

  /* ---------- Google Drive ---------- */
  // Drive calls js/gdrive.js doesn't offer (folder check, move to bin, big uploads), with its access token
  async function dapi(path, { method = "GET", params, body, write = false } = {}) {
    const t = await GDrive.token({ write });
    let res;
    try {
      res = await fetch(DRIVE_API + path + (params ? "?" + new URLSearchParams(params) : ""), {
        method, headers: { Authorization: "Bearer " + t, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    } catch { throw Object.assign(new Error("Couldn't reach Google Drive"), { code: navigator.onLine === false ? "offline" : "network" }); }
    if (res.ok) return res.status === 204 ? null : res.json();
    let j = null; try { j = await res.json(); } catch {}
    const s = res.status, why = JSON.stringify(j || {});
    const code = s === 401 ? "expired" : s === 404 ? "notfound" : s === 429 ? "rate" : s === 403 && /insufficient|SCOPE/i.test(why) ? "scope" : s === 403 ? "forbidden" : "error";
    throw Object.assign(new Error(j?.error?.message || "Google Drive error " + s), { code, status: s });
  }
  // the backups folder in MY Google Drive: the saved one if it's mine and still there, else find it by name, else create it
  async function myFolder() {
    const c = conf(), me = myEmail();
    if (c.folderId && c.folderBy === me) {
      try { const f = await dapi("files/" + encodeURIComponent(c.folderId), { params: { fields: "id,trashed,mimeType", supportsAllDrives: true } }); if (f && !f.trashed && f.mimeType === GDrive.FOLDER) return f.id; }
      catch (e) { if (!["notfound", "forbidden"].includes(e.code)) throw e; }
    }
    const name = folderName();
    const found = (await GDrive.list("root", { q: name })).find(f => f.name === name && GDrive.isFolder(f) && !f.shortcut);
    if (found) return found.id;
    return (await GDrive.mkdir("root", name)).id;
  }
  async function uploadJson(folderId, name, json, onProgress) {
    const file = new File([json], name, { type: "application/json" });
    if (file.size <= GDrive.MAX_UPLOAD) return GDrive.upload(folderId, file, { onProgress });
    // bigger than js/gdrive.js allows: one resumable session, whole file in a single PUT
    const t = await GDrive.token({ write: true });
    const r = await fetch(UPLOAD_API + "files?uploadType=resumable&supportsAllDrives=true&fields=id,name,size,webViewLink,modifiedTime", {
      method: "POST", headers: { Authorization: "Bearer " + t, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "application/json" },
      body: JSON.stringify({ name, parents: [folderId] }) });
    if (!r.ok) throw Object.assign(new Error("Google Drive refused the upload (" + r.status + ")"), { code: r.status === 401 ? "expired" : "error" });
    const loc = r.headers.get("Location");
    if (!loc) throw Object.assign(new Error("Google Drive didn't start the upload"), { code: "error" });
    return new Promise((res, rej) => {
      const x = new XMLHttpRequest();
      x.open("PUT", loc); x.setRequestHeader("Content-Type", "application/json");
      if (x.upload && onProgress) x.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      x.onload = () => { let j = null; try { j = JSON.parse(x.responseText || "null"); } catch {} x.status >= 200 && x.status < 300 ? res(j) : rej(Object.assign(new Error("Upload failed (" + x.status + ")"), { code: "error" })); };
      x.onerror = () => rej(Object.assign(new Error("Upload failed"), { code: navigator.onLine === false ? "offline" : "network" }));
      x.send(file);
    });
  }
  const fileTime = f => { const m = String(f.name || "").match(NAME_RE); return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : Date.parse(f.modifiedTime || "") || 0; };
  async function listBackups(folderId) {
    return (await GDrive.list(folderId)).filter(f => NAME_RE.test(f.name || "") && !GDrive.isFolder(f)).sort((a, b) => fileTime(b) - fileTime(a));
  }
  // move backups older than keepDays to the Google Drive bin (Drive empties its bin after 30 days)
  async function prune(folderId, days, keepId) {
    const cut = Date.now() - days * DAY;
    let n = 0;
    for (const f of await listBackups(folderId)) {
      if (f.id === keepId || fileTime(f) >= cut) continue;
      try { await dapi("files/" + encodeURIComponent(f.id), { method: "PATCH", write: true, params: { supportsAllDrives: true }, body: { trashed: true } }); n++; }
      catch (e) { console.warn("backup prune", e); }
    }
    return n;
  }
  function loadFiles(folderId, force) {
    if (!folderId || !hasDrive() || !GDrive.connected()) return;
    if (files.loading || (!force && files.folderId === folderId && Date.now() - files.at < 5 * 60e3)) return;
    Object.assign(files, { folderId, loading: true });
    listBackups(folderId).then(items => Object.assign(files, { items, err: null }), err => Object.assign(files, { items: null, err }))
      .finally(() => { files.loading = false; files.at = Date.now(); refresh(); });
  }

  /* ---------- backing up to Drive ---------- */
  let running = false;
  async function backupToDrive({ quiet = false } = {}) {
    if (running || job) return false;
    if (!shared()) return false;
    running = true;
    const wsId = window.Cloud.ws.id, lock = "lumen-backup-run:" + wsId;
    try { localStorage.setItem(lock, String(Date.now())); } catch {}
    try {
      setJob({ kind: "backup", text: "Collecting workspace data…", pct: .02 });
      const folderId = await myFolder();
      const b = await collect(p => setJob({ kind: "backup", text: "Collecting workspace data…", pct: p * .7 }));
      setJob({ kind: "backup", text: "Saving to Google Drive…", pct: .72 });
      const up = await uploadJson(folderId, b.name, b.json, p => setJob({ kind: "backup", text: "Saving to Google Drive…", pct: .72 + p * .24 }));
      await saveConf({ lastAt: b.obj.at, lastBy: myEmail(), lastFile: { id: up?.id || "", name: b.name, size: b.size }, folderId, folderBy: myEmail() }, wsId);
      setJob({ kind: "backup", text: "Tidying up old backups…", pct: .97 });
      const c = conf();
      await prune(folderId, keepDays(c), up?.id).catch(e => console.warn("backup prune", e));
      files.at = 0; notice = "";
      if (!quiet) UI.toast("💾 Backup saved to Google Drive" + (b.skipped.length ? ` (skipped: ${b.skipped.map(label).join(", ")})` : ""));
      return true;
    } catch (e) {
      console.warn("backup", e);
      const msg = e.code === "offline" ? e.message : e.code && window.GDrive ? driveErr(e) : "Backup failed: " + (e.message || e);
      if (quiet) notice = "The last automatic backup didn't finish. " + msg;
      else UI.toast(msg);
      return false;
    } finally {
      running = false;
      try { localStorage.removeItem(lock); } catch {}
      setJob(null);
    }
  }

  /* ---------- automatic daily backup (background) ---------- */
  // who runs automatic backups: the admin whose Drive holds the folder (or any admin if that person is gone or no folder yet)
  function responsible(c = conf()) {
    const me = myEmail(), owner = String(c.folderBy || "").toLowerCase();
    if (!owner || owner === me) return true;
    const members = window.Cloud?.ws?.members || [];
    return !members.includes(owner) || !isAdmin(owner);
  }
  const due = c => Date.now() - (+c.lastAt || 0) >= DAY;
  let checkT = 0;
  function schedule(ms = 8000) { clearTimeout(checkT); checkT = setTimeout(() => autoCheck().catch(e => console.warn("backup check", e)), ms); }
  async function autoCheck() {
    if (running || job || !shared() || !isAdmin()) return;
    const c = conf();
    if (!c.auto || !due(c) || !responsible(c)) return;
    if (!hasDrive() || !GDrive.canWrite()) { refresh(); return; } // the section shows "Reconnect Google Drive"
    try { const t = +localStorage.getItem("lumen-backup-run:" + window.Cloud.ws.id) || 0; if (Date.now() - t < 10 * 60e3) return; } catch {} // another tab is on it
    // ask the server, not the cache: another admin's device may have just done it
    try {
      const { fb, ref } = fs(), s = await (fb.getDocFromServer || fb.getDoc)(fb.doc(ref(), "settings", "backup"));
      const d = s.exists() ? s.data() : {};
      if (!d.auto || !due(d)) return;
    } catch { return; } // offline: try again later
    await backupToDrive({ quiet: true });
  }
  Apps.onWorkspace?.add(() => { Object.assign(files, { folderId: "", items: null, at: 0, err: null }); notice = ""; schedule(10000); });
  setInterval(() => schedule(2000), 30 * 60e3); // Lumen left open for days
  if (window.Data) Data.on("settings", () => schedule(6000));
  if (window.GDrive) GDrive.on(s => { if (s === "on") schedule(3000); refresh(); });

  /* ---------- restoring ---------- */
  function parseBackup(text) {
    let o; try { o = JSON.parse(text); } catch { throw new Error("This file isn't a Lumen backup (it isn't valid JSON)."); }
    if (!o || o.lumenBackup !== 1 || typeof o.data !== "object" || !o.data) throw new Error("This file isn't a Lumen backup.");
    return o;
  }
  const allowed = () => new Set(backupCols());
  const okId = id => typeof id === "string" && id && id.length < 1500 && !id.includes("/") && id !== "." && id !== "..";

  function restoreDialog(b, source) {
    if (!isAdmin()) return UI.toast("Only the owner and admins can restore backups");
    const ws = window.Cloud.ws, ok = allowed();
    const cols = Object.keys(b.data).filter(c => ok.has(c) && b.data[c] && typeof b.data[c] === "object" && Object.keys(b.data[c]).length);
    const unknown = Object.keys(b.data).filter(c => !ok.has(c));
    const pageCount = b.pages && typeof b.pages === "object" ? Object.keys(b.pages).length : 0;
    const rows = [...cols.map(c => [c, Object.keys(b.data[c]).filter(id => !(c === "settings" && id === "backup")).length]).filter(r => r[1]), ...(pageCount ? [["pages", pageCount]] : [])].sort((x, y) => label(x[0]).localeCompare(label(y[0])));
    const picked = new Set(rows.map(r => r[0]));
    const other = b.ws?.id && b.ws.id !== ws.id;
    const go = h("button", { class: "btn primary", text: "Restore…" });
    const checks = rows.map(([c, n]) => {
      const cb = h("input", { type: "checkbox", checked: true, onchange: () => { cb.checked ? picked.add(c) : picked.delete(c); upd(); } });
      return h("label", { class: "bku-col" }, cb, h("span", { class: "bku-col-n", text: label(c) }), h("span", { class: "bku-col-c", text: n.toLocaleString() }));
    });
    const all = h("button", { type: "button", class: "chip-btn", text: "Select all", onclick: () => { checks.forEach((l, i) => { l.querySelector("input").checked = true; picked.add(rows[i][0]); }); upd(); } });
    const none = h("button", { type: "button", class: "chip-btn", text: "Select none", onclick: () => { checks.forEach(l => { l.querySelector("input").checked = false; }); picked.clear(); upd(); } });
    const total = () => rows.filter(r => picked.has(r[0])).reduce((s, r) => s + r[1], 0);
    const upd = () => { go.disabled = !picked.size || running; go.textContent = picked.size ? `Restore ${total().toLocaleString()} item${total() === 1 ? "" : "s"}…` : "Restore…"; };
    const prog = h("div", { class: "bku-job", hidden: true }, h("span", { class: "bku-job-t" }), h("div", { class: "bku-bar" }, h("i")));
    const result = h("div", { class: "bku-result", hidden: true });
    const body = h("div", { class: "bku-restore" },
      h("div", { class: "bku-meta" },
        h("div", null, h("small", { text: "Workspace" }), h("b", { text: b.ws?.name || "Unknown" })),
        h("div", null, h("small", { text: "Made" }), h("b", { text: fmtWhen(b.at) || "Unknown" })),
        h("div", null, h("small", { text: "By" }), h("b", { text: b.by ? nameOf(b.by) : "Unknown" })),
        source ? h("div", null, h("small", { text: "From" }), h("b", { text: source })) : null),
      other ? h("div", { class: "bku-warn" }, h("b", { text: "This backup is from another workspace." }),
        h("span", { text: ` It was made in “${b.ws?.name || "another workspace"}”. You can still copy it into “${ws.name}”, for example to set up a branch.` })) : null,
      h("p", { class: "bku-hint", text: "Restoring adds the items back and overwrites items that have the same ID with the backed-up version. Nothing in the workspace is deleted." }),
      rows.length ? h("div", { class: "bku-cols-h" }, h("b", { text: "What to restore" }), h("span", { class: "bku-cols-acts" }, all, none)) : null,
      rows.length ? h("div", { class: "bku-cols" }, ...checks) : h("div", { class: "st-empty", text: "This backup is empty." }),
      unknown.length ? h("p", { class: "bku-hint", text: `Not restored (not used by Lumen any more): ${unknown.join(", ")}.` }) : null,
      prog, result,
      h("div", { class: "bku-foot" }, h("button", { class: "btn", text: "Close", onclick: () => m.close() }), go));
    const m = UI.modal("Restore a backup", body, { className: "bku-modal" });
    upd();
    go.onclick = async () => {
      const n = total();
      if (!(await UI.confirm(`Restore ${n.toLocaleString()} item${n === 1 ? "" : "s"} into “${ws.name}”? Items with the same ID are replaced by the backed-up version. Nothing is deleted.`, "Restore"))) return;
      if (window.Cloud.ws?.id !== ws.id) return UI.toast("You switched workspaces. Open the backup again.");
      go.disabled = true; checks.forEach(l => { l.querySelector("input").disabled = true; }); all.disabled = none.disabled = true;
      prog.hidden = false; result.hidden = true;
      const paint = (t, p) => { prog.querySelector(".bku-job-t").textContent = t; prog.querySelector(".bku-bar > i").style.width = Math.round(Math.max(.03, p) * 100) + "%"; };
      try {
        const r = await restore(b, [...picked], (t, p) => { paint(t, p); setJob({ kind: "restore", text: t, pct: p }); });
        paint("Done", 1);
        result.hidden = false;
        result.className = "bku-result" + (r.failed ? " warn" : " ok");
        result.textContent = `Restored ${r.written.toLocaleString()} item${r.written === 1 ? "" : "s"}.` + (r.failed ? ` ${r.failed.toLocaleString()} couldn't be written (${r.failedCols.map(label).join(", ")}), usually because the workspace rules don't allow it.` : "");
        UI.toast(r.failed ? "Restore finished with some items skipped" : "✅ Backup restored");
      } catch (e) {
        console.warn("restore", e);
        result.hidden = false; result.className = "bku-result warn";
        result.textContent = e.code === "unavailable" ? "You're offline. Connect and try again." : "Restore stopped: " + (e.code || e.message);
      } finally { setJob(null); go.disabled = false; go.textContent = "Restore again…"; }
    };
  }

  // writes the chosen collections back (merge, same ids), 400 docs per batch; a refused batch is retried doc by doc
  async function restore(b, picked, onProgress) {
    const { fb, db } = fs(), ref = fs().ref(), wsId = window.Cloud.ws.id;
    const ops = [];
    for (const col of picked) {
      if (col === "pages") {
        for (const [id, d] of Object.entries(b.pages || {})) if (okId(id) && d && typeof d === "object") ops.push({ col, id, ref: fb.doc(ref, "pages", id), data: d });
        continue;
      }
      if (!allowed().has(col)) continue;
      for (const [id, d] of Object.entries(b.data[col] || {})) {
        if (!okId(id) || !d || typeof d !== "object" || Array.isArray(d)) continue;
        if (col === "settings" && id === "backup") continue; // keep this workspace's own backup settings
        ops.push({ col, id, ref: fb.doc(ref, col, id), data: d });
      }
    }
    let written = 0, failed = 0;
    const failedCols = new Set(), total = ops.length || 1;
    const size = o => { try { return JSON.stringify(o.data).length; } catch { return 1e5; } };
    let i = 0;
    while (i < ops.length) {
      if (window.Cloud.ws?.id !== wsId) throw new Error("The workspace changed during the restore");
      const chunk = []; let bytes = 0;
      while (i < ops.length && chunk.length < CHUNK && (!chunk.length || bytes + size(ops[i]) < CHUNK_BYTES)) { bytes += size(ops[i]); chunk.push(ops[i++]); }
      onProgress(`Restoring… ${written.toLocaleString()} of ${ops.length.toLocaleString()}`, written / total);
      try {
        const batch = fb.writeBatch(db);
        chunk.forEach(o => batch.set(o.ref, dec(o.data, fb), { merge: true }));
        await batch.commit();
        written += chunk.length;
      } catch (e) {
        if (e.code === "unavailable") throw e;
        console.warn("restore batch refused, retrying one by one", e);
        for (const o of chunk) {
          try { await fb.setDoc(o.ref, dec(o.data, fb), { merge: true }); written++; }
          catch (e2) { if (e2.code === "unavailable") throw e2; failed++; failedCols.add(o.col); }
          if ((written + failed) % 25 === 0) onProgress(`Restoring… ${written.toLocaleString()} of ${ops.length.toLocaleString()}`, (written + failed) / total);
        }
      }
    }
    // restored pages go back into the sidebar's page list
    if (picked.includes("pages") && Array.isArray(b.ws?.root)) {
      const ids = b.ws.root.filter(id => okId(id) && b.pages?.[id]);
      if (ids.length) { try { await fb.updateDoc(ref, { root: fb.arrayUnion(...ids) }); } catch (e) { console.warn("restore root", e); } }
    }
    return { written, failed, failedCols: [...failedCols] };
  }

  /* ---------- actions ---------- */
  async function exportNow() {
    if (job) return;
    try {
      setJob({ kind: "export", text: "Collecting workspace data…", pct: .02 });
      const b = await collect(p => setJob({ kind: "export", text: "Collecting workspace data…", pct: p }));
      download(b.name, b.json);
      UI.toast("⬇️ Backup downloaded (" + fmtSize(b.size) + ")" + (b.skipped.length ? `. Skipped: ${b.skipped.map(label).join(", ")}` : ""));
    } catch (e) { console.warn("export", e); UI.toast(e.code === "offline" ? e.message : "Export failed: " + (e.code || e.message)); }
    finally { setJob(null); }
  }
  function restoreFromFile() {
    const inp = h("input", { type: "file", accept: ".json,application/json", style: { display: "none" } });
    inp.addEventListener("change", async () => {
      const f = inp.files[0]; inp.remove(); if (!f) return;
      try { restoreDialog(parseBackup(await f.text()), f.name); } catch (e) { UI.toast(e.message); }
    });
    document.body.append(inp); inp.click();
  }
  async function restoreFromDrive(f) {
    if (job) return;
    try {
      setJob({ kind: "restore", text: "Downloading the backup from Google Drive…", pct: .3 });
      const blob = await GDrive.media(f.id);
      setJob(null);
      restoreDialog(parseBackup(await blob.text()), "Google Drive · " + f.name);
    } catch (e) { setJob(null); UI.toast(e.code ? driveErr(e) : e.message); }
  }
  // inside a click: connect Google Drive with permission to add files (opens Google's pop-up only when needed)
  function withDrive(then) {
    if (!hasDrive()) return UI.toast("Google Drive isn't available here");
    const p = GDrive.canWrite() ? Promise.resolve() : GDrive.connect({ write: true });
    p.then(() => GDrive.canWrite() ? then() : UI.toast(driveErr({ code: "scope" })), e => { UI.toast(driveErr(e)); refresh(); });
  }
  function setAuto(on, ctx) {
    if (!isAdmin()) return UI.toast("Only the owner and admins can change backups");
    if (!on) { saveConf({ auto: false }); ctx.redraw(); return; }
    withDrive(async () => {
      try {
        const folderId = await myFolder();
        await saveConf({ auto: true, keepDays: keepDays(conf()), folderId, folderBy: myEmail() });
        ctx.redraw();
        if (due(conf())) backupToDrive();
      } catch (e) { UI.toast(driveErr(e)); ctx.redraw(); }
    });
    ctx.redraw(); // put the switch back until Drive is connected
  }
  function useMyDrive(ctx) {
    withDrive(async () => {
      try {
        const folderId = await myFolder();
        await saveConf({ folderId, folderBy: myEmail() });
        Object.assign(files, { folderId: "", items: null, at: 0, err: null });
        UI.toast("💾 Backups now go to your Google Drive");
        ctx.redraw();
      } catch (e) { UI.toast(driveErr(e)); }
    });
  }

  /* ---------- the Settings section ---------- */
  function draw(ctx, kit) {
    const { card, row, sw, seg } = kit;
    if (!shared()) return [card("Backups", "", h("div", { class: "st-empty", text: "Backups are for shared workspaces. Open a shared workspace to set them up." }))];
    const c = conf(), me = myEmail(), admin = isAdmin(), drive = hasDrive() ? GDrive.status() : "unavailable";
    const days = keepDays(c), owner = String(c.folderBy || "").toLowerCase(), mine = !!owner && owner === me;
    const someoneElse = !!owner && !mine && !responsible(c);
    const needReconnect = admin && c.auto && responsible(c) && hasDrive() && drive !== "unavailable" && !GDrive.canWrite();

    /* status */
    const last = c.lastAt ? `${fmtWhen(c.lastAt)} (${UI.timeAgo(c.lastAt)})` : "No backup yet";
    const lastSub = c.lastAt ? [c.lastBy ? "by " + nameOf(c.lastBy) : "", c.lastFile?.size ? fmtSize(c.lastFile.size) : ""].filter(Boolean).join(" · ") : "";
    let next;
    if (!c.auto) next = "Automatic backups are off";
    else if (!due(c)) next = fmtWhen(+c.lastAt + DAY);
    else next = someoneElse ? `Due now. Runs when ${nameOf(owner)} opens Lumen with Google Drive connected.` : "Due now. Runs while an admin has Lumen open with Google Drive connected.";
    const where = owner ? `${mine ? "Your" : nameOf(owner) + "'s"} Google Drive, folder “${folderName()}”` : "Not set up yet";
    const status = card("Status", "",
      row("Last backup", lastSub, h("span", { class: "st-ro-val", text: last })),
      row("Next automatic backup", "", h("span", { class: "st-ro-val", text: next })),
      row("Saved in", c.auto ? `Kept for ${days} days` : "", h("span", { class: "st-ro-val", text: where })),
      jobBox(),
      notice ? h("div", { class: "bku-notice warn" }, h("span", { text: notice }), h("button", { class: "icon-btn xs", title: "Dismiss", html: UI.icon("x"), onclick: () => { notice = ""; ctx.redraw(); } })) : null,
      needReconnect ? h("div", { class: "bku-notice" }, h("span", { text: drive === "on" ? "Lumen needs your OK to save backups in Google Drive, so automatic backups are paused."
          : drive === "expired" ? "Your Google Drive connection ended, so automatic backups are paused. Reconnect to keep them going."
          : "Google Drive isn't connected in this browser, so automatic backups are paused. Connect it to keep them going." }),
        h("button", { class: "btn primary", text: "Reconnect", onclick: () => withDrive(() => { refresh(); schedule(1500); }) })) : null);

    const honest = h("div", { class: "st-note" },
      "Backups are JSON files saved in the Google Drive of the admin who switched them on, not on Lumen's servers. ",
      "Automatic backups run once a day while that admin has Lumen open in a browser with Google Drive connected. ",
      "Older backups are moved to the Google Drive bin after the keep period.");

    view = { ctx, el: status };
    if (!admin) return [
      h("div", { class: "st-lock" }, h("span", { html: UI.icon("lock") }), h("span", { text: "Only the owner and admins can manage backups. You can see the status here." })),
      status, card("How backups work", "", honest)];

    /* automatic backups */
    let acct = null; try { acct = hasDrive() ? GDrive.account() : null; } catch {}
    const driveRow = drive === "unavailable"
      ? row("Google Drive", "Google Drive isn't set up on this site, so automatic backups can't run. You can still export a file below.", null)
      : row("Google Drive", GDrive.canWrite() ? `Connected${acct?.email ? " as " + acct.email : ""}` : drive === "expired" ? "Your connection ended" : "Not connected in this browser",
        GDrive.canWrite() ? h("span", { class: "st-status ok", text: "● Connected" })
          : h("button", { class: "btn", text: drive === "off" ? "Connect" : "Reconnect", onclick: () => withDrive(() => refresh()) }));
    const nowBtn = someoneElse ? null : h("button", { class: "btn primary", text: "Back up now", disabled: !!job || drive === "unavailable",
      onclick: () => withDrive(() => backupToDrive().then(ok => { if (ok) refresh(); })) });
    const autoCard = card("Automatic backups", "A full copy of the workspace every day, kept for the period you choose.",
      row("Back up every day", someoneElse ? `${nameOf(owner)} looks after automatic backups in their Google Drive` : "Saved to your Google Drive",
        drive === "unavailable" ? h("span", { class: "st-status off", text: "● Unavailable" }) : sw(!!c.auto, v => setAuto(v, ctx), "Back up every day")),
      row("Keep backups for", "Older ones go to the Google Drive bin",
        seg(KEEP, days, v => { saveConf({ keepDays: +v }); kit.saved(); })),
      driveRow,
      someoneElse ? row("Use my Google Drive instead", `Backups are saved in ${nameOf(owner)}'s Google Drive. Switch to yours if they're away or leaving.`,
        h("button", { class: "btn", text: "Use my Drive", disabled: drive === "unavailable", onclick: () => useMyDrive(ctx) })) : null,
      nowBtn ? h("div", { class: "st-card-foot" }, nowBtn) : null);

    /* Drive backups list */
    let listKids;
    if (!owner) listKids = [h("div", { class: "st-empty", text: "No Google Drive backups yet. Switch on daily backups or press Back up now." })];
    else if (!hasDrive() || !GDrive.connected()) listKids = [h("div", { class: "st-empty", text: mine ? "Connect Google Drive to see your backups." : `These backups are in ${nameOf(owner)}'s Google Drive.` })];
    else {
      loadFiles(c.folderId);
      const forThis = files.folderId === c.folderId;
      if (forThis && files.err) listKids = [h("div", { class: "st-empty", text: ["notfound", "forbidden"].includes(files.err.code) ? `These backups are in ${nameOf(owner)}'s Google Drive, and your Google account can't open that folder.` : driveErr(files.err) })];
      else if (!forThis || !files.items) listKids = [h("div", { class: "st-empty", text: "Loading backups…" })];
      else if (!files.items.length) listKids = [h("div", { class: "st-empty", text: "The backups folder is empty." })];
      else listKids = [h("div", { class: "bku-files" }, ...files.items.map(f => h("div", { class: "bku-file" },
        h("span", { class: "bku-file-ic", text: "💾" }),
        h("span", { class: "bku-file-n" }, h("b", { text: fmtWhen(fileTime(f)) }), h("small", { text: [fmtSize(f.size), UI.timeAgo(fileTime(f))].filter(Boolean).join(" · ") })),
        h("span", { class: "bku-file-acts" },
          h("button", { class: "btn", text: "Restore…", disabled: !!job, onclick: () => restoreFromDrive(f) }),
          h("a", { class: "btn", href: GDrive.openUrl(f), target: "_blank", rel: "noopener", text: "Open in Drive" })))))];
    }
    const refreshBtn = owner && hasDrive() && GDrive.connected() ? h("div", { class: "st-card-acts" },
      h("button", { class: "icon-btn xs", title: "Refresh", "aria-label": "Refresh the list", text: "↻", onclick: () => { loadFiles(c.folderId, true); ctx.redraw(); } })) : null;
    const listCard = card("Backups in Google Drive", "", refreshBtn, ...listKids);

    /* file export / restore */
    const fileCard = card("Download and restore", "Keep a copy anywhere you like, or bring a backup back.",
      row("Export now", "Download the whole workspace as one JSON file", h("button", { class: "btn", text: "Export", disabled: !!job, onclick: exportNow })),
      row("Restore from a file", "Pick a Lumen backup file. You'll see what's inside and choose what to bring back before anything changes.",
        h("button", { class: "btn", text: "Restore from file…", disabled: !!job, onclick: restoreFromFile })));

    return [status, autoCard, listCard, fileCard, card("How backups work", "", honest)];
  }

  // openRestore(jsonText): the restore preview for a backup file's text (used by the section; handy for testing too)
  window.Backups = { draw, backupNow: () => backupToDrive(), exportNow, openRestore: text => { try { restoreDialog(parseBackup(text), "File"); } catch (e) { UI.toast(e.message); } } };
})();
