/* Cloud: Google sign-in, shared workspaces in Firestore, live sync with block-level merge, invites, presence */
const V = "10.12.2";
const cfg = window.FIREBASE_CONFIG;
const { h, icon, esc } = UI;
const Cloud = (window.Cloud = { configured: !!(cfg && cfg.apiKey), user: null, workspaces: [], ws: null, people: [] });

const J = x => JSON.stringify(x);
const PRESENCE_MS = 25000;
let fb, auth, db, unsubs = [], listUnsub = null, synced = {}, syncedRoot = "", syncedName = "", flushTimer, beatTimer, wsRef;

/* ---------- setup / help ---------- */
function setupModal() {
  UI.modal("Sharing isn't connected yet", h("div", null,
    h("p", { style: { marginTop: 0, color: "var(--muted)" }, text: "Shared workspaces need a free Firebase project. The site owner adds its settings to js/firebase-config.js once; after that everyone can sign in with Google and collaborate." }),
    h("a", { class: "btn primary", href: "https://github.com/gamerslife1183-bot/lumen-notes/blob/main/SETUP.md", target: "_blank", text: "Open setup guide" })));
}

if (Cloud.configured) init().catch(e => { console.error(e); UI.toast("Couldn't load sharing: " + e.message); App.bootLocal?.(); });
else App.bootLocal?.();

async function init() {
  const [app, a, f] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
  ]);
  fb = { ...a, ...f };
  const fapp = app.initializeApp(cfg);
  auth = a.getAuth(fapp);
  try { db = f.initializeFirestore(fapp, { localCache: f.persistentLocalCache() }); } catch { db = f.getFirestore(fapp); }
  a.onAuthStateChanged(auth, async user => {
    Cloud.user = user; renderAccount();
    if (listUnsub) { listUnsub(); listUnsub = null; }
    if (!user) { if (Cloud.ws) leave(true); App.bootLocal?.(); return; }
    const email = user.email.toLowerCase();
    listUnsub = fb.onSnapshot(fb.query(fb.collection(db, "workspaces"), fb.where("members", "array-contains", email)), snap => {
      Cloud.workspaces = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }, e => console.warn(e));
    const link = location.hash.match(/^#\/ws\/([^/]+)(?:\/p\/(.+))?$/);
    const want = link ? link[1] : localStorage.getItem("lumen-active-ws");
    if (want) await open(want, link?.[2]); else App.bootLocal?.();
  });
}

/* ---------- auth ---------- */
async function signIn() {
  if (!Cloud.configured) return setupModal();
  if (!auth) return UI.toast("Still loading, try again in a second");
  try { await fb.signInWithPopup(auth, new fb.GoogleAuthProvider()); UI.toast("Signed in as " + auth.currentUser.email); return true; }
  catch (e) { if (e.code !== "auth/popup-closed-by-user") UI.toast("Sign-in failed: " + (e.code || e.message)); return false; }
}
async function signOutNow() { if (Cloud.ws) leave(true); await fb.signOut(auth); UI.toast("Signed out"); }

function renderAccount() {
  const b = document.getElementById("accountBtn"); if (!b) return;
  b.style.display = "";
  const u = Cloud.user;
  b.innerHTML = u ? `${avatarHtml(u.photoURL, u.displayName || u.email)}<span>${esc(u.displayName || u.email)}</span>`
    : `${icon("smile")}<span>Sign in to share</span>`;
  b.onclick = e => u ? UI.menu(e.currentTarget, [{ section: u.email }, { label: "Sign out", icon: "arrow", onClick: signOutNow }]) : signIn();
}
const avatarHtml = (src, name) => src ? `<img class="av-img" src="${esc(src)}" alt="" referrerpolicy="no-referrer">` : `<span class="av-img av-letter">${esc((name || "?")[0].toUpperCase())}</span>`;

/* ---------- merge helpers ---------- */
function listMerge(base, local, remote) {
  const B = new Set(base), L = new Set(local);
  const out = remote.filter(id => !(B.has(id) && !L.has(id)));
  local.forEach((id, i) => {
    if (B.has(id) || out.includes(id)) return;
    const prev = local.slice(0, i).reverse().find(x => out.includes(x));
    out.splice(prev ? out.indexOf(prev) + 1 : 0, 0, id);
  });
  return out;
}
function mergePage(base, local, remote) {
  base = base || {};
  const out = { ...remote };
  new Set([...Object.keys(local), ...Object.keys(remote)]).forEach(k => {
    if (k !== "blocks" && k !== "children" && J(local[k]) !== J(base[k])) out[k] = local[k];
  });
  out.children = listMerge(base.children || [], local.children || [], remote.children || []);
  const map = arr => new Map((arr || []).map(b => [b.id, b]));
  const bm = map(base.blocks), lm = map(local.blocks), rm = map(remote.blocks);
  const order = listMerge([...bm.keys()], [...lm.keys()], [...rm.keys()]);
  out.blocks = order.map(id => { const l = lm.get(id), r = rm.get(id); return l && (!r || J(l) !== J(bm.get(id))) ? l : r || l; }).filter(Boolean);
  return out;
}
function applyInPlace(target, src) { Object.keys(target).forEach(k => { if (!(k in src)) delete target[k]; }); Object.assign(target, src); }

/* ---------- open / leave a workspace ---------- */
async function open(id, pageId) {
  if (!Cloud.user) { if (!(await signIn())) return; }
  stopSubs();
  wsRef = fb.doc(db, "workspaces", id);
  const pagesCol = fb.collection(wsRef, "pages");
  const ws = { id, name: "Shared workspace", root: [], pages: {}, members: [], owner: null, recent: [] };
  synced = {}; let wsLoaded = false, pagesLoaded = false, activated = false;
  setSaved("Connecting…");
  const activate = () => {
    if (activated || !wsLoaded || !pagesLoaded) return; activated = true;
    // drop root ids whose page doc is missing (e.g. partial upload)
    ws.root = ws.root.filter(x => ws.pages[x]);
    Cloud.ws = ws; Store.useCloud(ws); localStorage.setItem("lumen-active-ws", id);
    setSaved("Synced"); heartbeat(); App.onWorkspaceChange(pageId);
    UI.toast(`👥 ${ws.name}`);
  };
  unsubs.push(fb.onSnapshot(wsRef, snap => {
    if (!snap.exists()) { UI.toast("That shared workspace no longer exists"); return leave(true); }
    const d = snap.data();
    Object.assign(ws, { name: d.name, members: d.members || [], owner: d.owner, ownerEmail: d.ownerEmail });
    syncedName = d.name;
    const r = J(d.root || []);
    if (r !== syncedRoot) {
      ws.root = J(ws.root) === syncedRoot || !wsLoaded ? [...(d.root || [])] : listMerge(JSON.parse(syncedRoot || "[]"), ws.root, d.root || []);
      syncedRoot = r;
    }
    wsLoaded = true;
    if (activated) App.remoteUpdate({ tree: true }); else activate();
  }, e => { UI.toast(e.code === "permission-denied" ? `No access. Ask the owner to invite ${Cloud.user.email}` : "Sync error: " + e.message); leave(true); }));

  unsubs.push(fb.onSnapshot(pagesCol, snap => {
    const changed = [];
    snap.docChanges().forEach(ch => {
      if (ch.doc.metadata.hasPendingWrites) return;
      const pid = ch.doc.id, local = ws.pages[pid];
      if (ch.type === "removed") {
        if (local && J(local) === synced[pid]) { delete ws.pages[pid]; changed.push(pid); }
        delete synced[pid]; return;
      }
      const rj = ch.doc.data().data; if (rj === synced[pid]) return;
      let remote; try { remote = JSON.parse(rj); } catch { return; }
      if (!local) ws.pages[pid] = remote;
      else if (J(local) === synced[pid] || !synced[pid]) applyInPlace(local, remote);
      else applyInPlace(local, mergePage(JSON.parse(synced[pid]), local, remote));
      synced[pid] = rj; changed.push(pid);
    });
    pagesLoaded = true;
    if (activated) { if (changed.length) { App.remoteUpdate({ pages: changed, tree: true }); scheduleFlush(); } } else activate();
  }, e => console.warn(e)));

  unsubs.push(fb.onSnapshot(fb.collection(wsRef, "presence"), snap => {
    Cloud.people = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    renderPresence();
  }, () => {}));
}
function stopSubs() { unsubs.forEach(u => u()); unsubs = []; clearInterval(beatTimer); Cloud.people = []; renderPresence(); }
function leave(silent) {
  if (Cloud.ws && Cloud.user && wsRef) fb.deleteDoc(fb.doc(wsRef, "presence", Cloud.user.uid)).catch(() => {});
  stopSubs(); Cloud.ws = null; wsRef = null; Store.useCloud(null); localStorage.removeItem("lumen-active-ws"); setSaved("Saved");
  App.onWorkspaceChange();
  if (!silent) UI.toast("💻 Switched to this browser's private workspace");
}

/* ---------- pushing local edits ---------- */
function scheduleFlush() { clearTimeout(flushTimer); flushTimer = setTimeout(flush, 450); }
Store.onCloudSave = scheduleFlush;
let warnedBig = false;
async function flush() {
  const ws = Cloud.ws; if (!ws || Store.state !== ws || !wsRef) return;
  const ops = [], pagesCol = fb.collection(wsRef, "pages");
  for (const [id, p] of Object.entries(ws.pages)) {
    const j = J(p); if (j === synced[id]) continue;
    if (j.length > 900000) { if (!warnedBig) { UI.toast("⚠️ A page is too large to sync (big uploaded images). Use image links instead."); warnedBig = true; } continue; }
    ops.push(b => b.set(fb.doc(pagesCol, id), { data: j, at: fb.serverTimestamp(), by: Cloud.user.uid })); synced[id] = j;
  }
  for (const id of Object.keys(synced)) if (!ws.pages[id]) { ops.push(b => b.delete(fb.doc(pagesCol, id))); delete synced[id]; }
  const upd = {}, r = J(ws.root);
  if (r !== syncedRoot) { upd.root = ws.root; syncedRoot = r; }
  if (ws.name !== syncedName) { upd.name = ws.name; syncedName = ws.name; }
  if (Object.keys(upd).length) ops.push(b => b.update(wsRef, upd));
  if (!ops.length) return;
  setSaved("Syncing…");
  try { await commit(ops); setSaved("Synced"); } catch (e) { console.error(e); setSaved("Sync failed"); UI.toast("Sync failed: " + (e.code || e.message)); }
}
async function commit(ops) {
  for (let i = 0; i < ops.length; i += 400) { const b = fb.writeBatch(db); ops.slice(i, i + 400).forEach(op => op(b)); await b.commit(); }
}
function setSaved(t) { const el = document.getElementById("savedState"); if (el) el.textContent = t; }
addEventListener("beforeunload", () => { if (Cloud.ws) flush(); });

/* ---------- create / invite / delete ---------- */
async function create(name, copyLocal) {
  if (!Cloud.user && !(await signIn())) return;
  const email = Cloud.user.email.toLowerCase();
  const src = JSON.parse(J(copyLocal ? Store.local : Store.seedPages()));
  const ref = fb.doc(fb.collection(db, "workspaces"));
  setSaved("Uploading…");
  try {
    await fb.setDoc(ref, { name, owner: Cloud.user.uid, ownerEmail: email, members: [email], root: src.root, createdAt: fb.serverTimestamp() });
    const pagesCol = fb.collection(ref, "pages"); let skipped = 0;
    const ops = Object.values(src.pages).filter(p => { const ok = J(p).length < 900000; if (!ok) skipped++; return ok; })
      .map(p => b => b.set(fb.doc(pagesCol, p.id), { data: J(p), at: fb.serverTimestamp(), by: Cloud.user.uid }));
    await commit(ops);
    if (skipped) UI.toast(`${skipped} page(s) were too large to upload`);
    await open(ref.id);
  } catch (e) { console.error(e); setSaved("Saved"); UI.toast("Couldn't create workspace: " + (e.code || e.message)); }
}
async function invite(email) {
  email = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return UI.toast("Enter a valid email address");
  try { await fb.updateDoc(wsRef, { members: fb.arrayUnion(email) }); UI.toast(`✉️ ${email} can now open this workspace`); }
  catch (e) { UI.toast(e.code === "permission-denied" ? "Only the owner can invite people" : e.message); }
}
async function removeMember(email) {
  try { await fb.updateDoc(wsRef, { members: fb.arrayRemove(email) }); UI.toast(`Removed ${email}`); } catch (e) { UI.toast(e.message); }
}
async function deleteWorkspace() {
  const ws = Cloud.ws;
  if (!(await UI.confirm(`Permanently delete “${ws.name}” and all of its pages for every member? This can't be undone.`))) return;
  const ref = wsRef, pagesCol = fb.collection(ref, "pages");
  const docs = await fb.getDocs(pagesCol), pres = await fb.getDocs(fb.collection(ref, "presence"));
  leave(true);
  await commit([...docs.docs, ...pres.docs].map(d => b => b.delete(d.ref)));
  await fb.deleteDoc(ref); UI.toast("Shared workspace deleted");
}

/* ---------- presence ---------- */
function heartbeat() {
  const beat = () => {
    if (!Cloud.ws || !Cloud.user) return;
    const u = Cloud.user;
    fb.setDoc(fb.doc(wsRef, "presence", u.uid), { name: u.displayName || u.email, email: u.email, photo: u.photoURL || "", page: App.currentId || "", at: fb.serverTimestamp() }).catch(() => {});
  };
  clearInterval(beatTimer); beat(); beatTimer = setInterval(() => { beat(); renderPresence(); }, PRESENCE_MS);
  Cloud.here = beat;
}
function renderPresence() {
  const box = document.getElementById("presence"); if (!box) return;
  box.innerHTML = "";
  const now = Date.now();
  const others = Cloud.people.filter(p => p.uid !== Cloud.user?.uid && (!p.at || now - p.at.toMillis() < PRESENCE_MS * 2.6));
  others.slice(0, 5).forEach(p => {
    const pg = Store.page(p.page);
    const el = h("span", { class: "av" + (p.page === App.currentId ? " here" : ""), title: `${p.name}${pg ? " · on " + (pg.title || "Untitled") : ""}`, html: avatarHtml(p.photo, p.name) });
    el.addEventListener("click", () => pg && App.go(pg.id));
    box.append(el);
  });
}

/* ---------- menus used by the app shell ---------- */
Cloud.workspaceMenuItems = () => {
  const items = [{ section: "Workspaces" },
    { label: "This browser (private)", iconHtml: "<span>💻</span>", kbd: Cloud.ws ? "" : "✓", onClick: () => Cloud.ws && leave() }];
  Cloud.workspaces.forEach(w => items.push({ label: w.name, iconHtml: "<span>👥</span>", kbd: Cloud.ws?.id === w.id ? "✓" : "", onClick: () => Cloud.ws?.id !== w.id && open(w.id) }));
  items.push({ sep: true });
  if (!Cloud.configured) items.push({ label: "Set up sharing…", icon: "link", onClick: setupModal });
  else if (!Cloud.user) items.push({ label: "Sign in with Google", icon: "smile", onClick: signIn });
  else items.push({ label: "New shared workspace…", icon: "plus", onClick: createDialog }, { label: `Sign out (${Cloud.user.email})`, icon: "arrow", onClick: signOutNow });
  return items;
};
function createDialog() {
  if (!Cloud.configured) return setupModal();
  const name = h("input", { class: "menu-input", value: Cloud.ws ? "New shared workspace" : (Store.local.settings.wsName || "My Workspace") + " (shared)" });
  let copy = !Cloud.ws;
  const sw = h("span", { class: "switch" + (copy ? " on" : ""), style: { cursor: "pointer" }, onclick: () => { copy = !copy; sw.classList.toggle("on", copy); } });
  const go = h("button", { class: "btn primary", text: "Create & share", onclick: async () => { go.disabled = true; go.textContent = "Creating…"; m.close(); await create(name.value.trim() || "Shared workspace", copy); } });
  const m = UI.modal("New shared workspace", h("div", null,
    h("p", { style: { marginTop: 0, color: "var(--muted)" }, text: "Everyone you invite can open, edit and add pages here in real time. They sign in with the Google account you invite." }),
    name,
    h("div", { class: "set-row" }, h("div", { class: "l" }, h("b", { text: "Copy my private pages into it" }), h("span", { text: "Otherwise it starts with the demo pages" })), sw),
    h("div", { style: { textAlign: "right", marginTop: "10px" } }, go)));
  m.el.style.width = "460px"; setTimeout(() => name.select(), 50);
}
Cloud.share = async anchor => {
  if (!Cloud.configured) return setupModal();
  if (!Cloud.ws) return createDialog();
  const ws = Cloud.ws, me = Cloud.user, isOwner = ws.owner === me.uid;
  const base = location.href.split("#")[0];
  const items = [{ section: `👥 ${ws.name} · ${ws.members.length} member${ws.members.length === 1 ? "" : "s"}` }];
  if (isOwner) {
    const inp = h("input", { class: "menu-input", placeholder: "Friend's Gmail address, then Enter" });
    inp.addEventListener("keydown", async e => { if (e.key === "Enter" && inp.value.trim()) { await invite(inp.value); UI.closePops(); Cloud.share(anchor); } });
    items.push({ el: inp });
    setTimeout(() => inp.focus(), 30);
  }
  ws.members.forEach(m => items.push({ el: h("div", { class: "mi compact", style: { cursor: "default" } },
    h("span", { class: "mi-ic", text: m === ws.ownerEmail ? "👑" : "👤" }), h("span", { class: "mi-t", style: { fontWeight: 400, fontSize: "13px" }, text: m + (m === me.email.toLowerCase() ? " (you)" : "") }),
    isOwner && m !== ws.ownerEmail ? h("button", { class: "icon-btn xs", style: { marginLeft: "auto" }, title: "Remove", html: icon("x"), onclick: async () => { await removeMember(m); UI.closePops(); } }) : null) }));
  items.push({ sep: true },
    { label: "Copy invite link", icon: "link", onClick: () => { navigator.clipboard?.writeText(`${base}#/ws/${ws.id}`); UI.toast("🔗 Invite link copied. Friends sign in with the email you invited."); } },
    { label: "Copy link to this page", icon: "page", onClick: () => App.copyLink(App.currentId) });
  if (isOwner) items.push({ label: "Delete shared workspace", icon: "trash", danger: true, onClick: deleteWorkspace });
  else items.push({ el: h("div", { class: "menu-empty", style: { fontSize: "12px", maxWidth: "260px" }, text: "Only the owner can invite or remove people." }) });
  UI.menu(anchor, items, { align: "end" });
};
Cloud.signIn = signIn;
Cloud.open = open;
Cloud.linkFor = id => `${location.href.split("#")[0]}#/ws/${Cloud.ws.id}/p/${id}`;
Cloud.renderPresence = renderPresence;
renderAccount();
