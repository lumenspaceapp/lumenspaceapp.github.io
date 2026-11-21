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
    h("a", { class: "btn primary", href: "https://github.com/lumenspaceapp/lumenspaceapp.github.io/blob/main/SETUP.md", target: "_blank", text: "Open setup guide" })));
}

if (Cloud.configured) init().catch(e => { console.error(e); UI.toast("Couldn't connect to Lumen: " + e.message); window.Gate?.show("signin"); });
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
  try { db = f.initializeFirestore(fapp, { localCache: f.persistentLocalCache({ tabManager: f.persistentMultipleTabManager() }) }); }
  catch { db = f.getFirestore(fapp); }
  await handleInviteLanding();
  a.onAuthStateChanged(auth, async user => {
    Cloud.user = user; renderAccount();
    if (listUnsub) { listUnsub(); listUnsub = null; }
    if (!user) { if (Cloud.ws) leave(true); App.bootLocal?.(); window.Gate?.show("signin"); return; } // sign-in is required
    window.Gate?.show("loading");
    const email = user.email.toLowerCase();
    // Cloud.listed resolves once we know (from the server, not just the local cache) which workspaces this user is in.
    let listed; Cloud.listed = new Promise(r => (listed = r)); Cloud.listedFor = user.uid;
    setTimeout(() => listed(), 6000);
    listUnsub = fb.onSnapshot(fb.query(fb.collection(db, "workspaces"), fb.where("members", "array-contains", email)), { includeMetadataChanges: true }, snap => {
      Cloud.workspaces = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (!snap.metadata.fromCache) listed();
    }, e => { console.warn(e); listed(); });
    await Cloud.listed;
    window.Gate?.hide();
    if (Onboarding.active) return; // the setup wizard is driving
    const link = location.hash.match(/^#\/ws\/([^/]+)(?:\/p\/(.+))?$/);
    if (link) return open(link[1], link[2]);
    ensureWorkspace();
  });
}

// signed in but no workspace open: open the last one (or the first), or set up a new one — there is no device-only mode
const failedWs = new Set();
function ensureWorkspace() {
  if (!Cloud.user || Cloud.ws || Onboarding.active) return;
  const ok = Cloud.workspaces.filter(w => !failedWs.has(w.id)), last = localStorage.getItem("lumen-active-ws");
  const want = ok.find(w => w.id === last) || ok[0];
  if (want) return open(want.id);
  App.bootLocal?.();
  Onboarding.newAccount(Cloud.user, { force: true });
}
Cloud.ensureWorkspace = ensureWorkspace;

/* ---------- emailed invites (Firebase email-link sign-in) ---------- */
// The invite email links to  <site>/?ws=<id>&mode=signIn&oobCode=…  Turn it into a signed-in visit to #/ws/<id>.
async function handleInviteLanding() {
  const params = new URLSearchParams(location.search);
  const wsId = params.get("ws");
  const isLink = fb.isSignInWithEmailLink(auth, location.href);
  if (!wsId && !isLink) return;
  const clean = () => history.replaceState(null, "", location.pathname + (wsId ? "#/ws/" + wsId : "#/p/home"));
  if (!isLink) return clean();
  await auth.authStateReady();
  if (auth.currentUser) return clean(); // already signed in on this device
  const href = location.href;
  clean();
  // same device that asked for the link: we know the address, so finish signing in right away
  const saved = localStorage.getItem("lumen-invite-email");
  if (saved) { try { await fb.signInWithEmailLink(auth, saved, href); localStorage.removeItem("lumen-invite-email"); return; } catch (e) { console.warn(e); } }
  const inp = h("input", { class: "menu-input", type: "email", placeholder: "you@gmail.com", value: localStorage.getItem("lumen-invite-email") || "" });
  const msg = h("div", { style: { fontSize: "13px", color: "var(--c-red)", minHeight: "18px" } });
  const go = h("button", { class: "btn primary", text: "Join workspace" });
  const google = h("button", { class: "btn", text: "Use Google sign-in instead" });
  const m = UI.modal("You're invited 👋", h("div", null,
    h("p", { style: { marginTop: 0, color: "var(--muted)" }, text: "Confirm the email address this invite was sent to, and you'll go straight into the shared workspace." }),
    inp, msg, h("div", { style: { display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "6px" } }, google, go)));
  m.el.style.width = "440px"; setTimeout(() => inp.focus(), 60);
  const submit = async () => {
    const email = inp.value.trim().toLowerCase(); if (!email) return;
    go.disabled = true; go.textContent = "Joining…"; msg.textContent = "";
    try { await fb.signInWithEmailLink(auth, email, href); localStorage.removeItem("lumen-invite-email"); m.close(); }
    catch (e) {
      go.disabled = false; go.textContent = "Join workspace";
      msg.textContent = e.code === "auth/invalid-email" ? "That isn't the address this invite was sent to."
        : e.code === "auth/invalid-action-code" || e.code === "auth/expired-action-code" ? "This invite link expired or was already used. Use Google sign-in, or ask for a new invite."
        : "Couldn't sign in: " + (e.code || e.message);
    }
  };
  go.onclick = submit;
  inp.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
  google.onclick = async () => { m.close(); if (await signIn() && wsId) open(wsId); };
}
// sign in without Google: email a one-time link back to this site
Cloud.emailSignIn = async email => {
  if (!auth) throw new Error("Still loading, try again in a second");
  localStorage.setItem("lumen-invite-email", email);
  await fb.sendSignInLinkToEmail(auth, email, { url: `${location.origin}${location.pathname}?signin=1`, handleCodeInApp: true });
};
async function emailInvite(email) {
  const url = `${location.origin}${location.pathname}?ws=${Cloud.ws.id}`;
  await fb.sendSignInLinkToEmail(auth, email, { url, handleCodeInApp: true });
}

// an admin (not the owner) is writing: the rules want `roleEdit` on every such write (managers must not send it)
const adminWrite = () => !!Cloud.ws && Cloud.ws.owner !== Cloud.user?.uid && window.Apps?.role?.() === "admin";

/* ---------- auth ---------- */
async function signIn() {
  if (!Cloud.configured) return setupModal();
  if (!auth) return UI.toast("Still loading, try again in a second");
  try { await fb.signInWithPopup(auth, new fb.GoogleAuthProvider()); UI.toast("Signed in as " + auth.currentUser.email); return true; }
  catch (e) {
    if (e.code === "auth/popup-blocked") { UI.toast("Pop-up blocked, switching to full-page sign-in…"); await fb.signInWithRedirect(auth, new fb.GoogleAuthProvider()); return false; }
    if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") UI.toast("Sign-in failed: " + (e.code || e.message));
    return false;
  }
}
async function signOutNow() { signingOut = true; try { if (Cloud.ws) leave(true); await fb.signOut(auth); UI.toast("Signed out"); } finally { signingOut = false; } }

function renderAccount() {
  const b = document.getElementById("accountBtn"); if (!b) return;
  b.style.display = "";
  const u = Cloud.user;
  b.innerHTML = u ? `<span class="acct-av"></span><span>${esc(u.displayName || u.email)}</span>`
    : `${icon("smile")}<span>Sign in to share</span>`;
  if (u) b.querySelector(".acct-av").replaceWith(Apps.avatar({ key: u.email, name: u.displayName || u.email, photo: u.photoURL || "", avatar: Store.local.settings.avatar ?? "" }, 20));
  b.onclick = e => u ? UI.menu(e.currentTarget, [{ section: u.email }, { label: "Change avatar", icon: "smile", onClick: () => Apps.chooseAvatar() }, { label: "Sign out", icon: "arrow", onClick: signOutNow }]) : signIn();
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
  const myRef = wsRef; let ownerEmailAsked = false, acceptAsked = false;
  unsubs.push(fb.onSnapshot(wsRef, snap => {
    if (!snap.exists()) { UI.toast("That shared workspace no longer exists"); return leave(true, true); }
    const d = snap.data();
    Object.assign(ws, { name: d.name, icon: d.icon || "", members: d.members || [], owner: d.owner, ownerEmail: d.ownerEmail, pendingOwner: d.pendingOwner || "", roles: d.roles || {}, perms: d.perms || {} });
    // older workspaces don't store the owner's email (access roles need it): the owner adds it, only they may write it
    if (!d.ownerEmail && !ownerEmailAsked && Cloud.user && d.owner === Cloud.user.uid) { ownerEmailAsked = true; fb.updateDoc(myRef, { ownerEmail: Cloud.user.email.toLowerCase() }).catch(e => console.warn(e)); }
    // the owner handed the workspace to me: take it over (the rules only let the named admin write their own uid as the owner)
    if (d.pendingOwner && !acceptAsked && Cloud.user && d.pendingOwner === Cloud.user.email.toLowerCase() && d.owner !== Cloud.user.uid) { acceptAsked = true; acceptOwnership(myRef, d); }
    syncedName = d.name;
    const r = J(d.root || []);
    if (r !== syncedRoot) {
      ws.root = J(ws.root) === syncedRoot || !wsLoaded ? [...(d.root || [])] : listMerge(JSON.parse(syncedRoot || "[]"), ws.root, d.root || []);
      syncedRoot = r;
    }
    wsLoaded = true;
    if (activated) { App.remoteUpdate({ tree: true }); window.Apps?.Access?.changed(); } else activate(); // roles / perms changed live

  }, e => { UI.toast(e.code === "permission-denied" ? `No access. Ask the owner to invite ${Cloud.user.email}` : "Sync error: " + e.message); leave(true, true); }));

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
let signingOut = false;
function leave(silent, failed) {
  if (Cloud.ws && Cloud.user && wsRef) fb.deleteDoc(fb.doc(wsRef, "presence", Cloud.user.uid)).catch(() => {});
  stopSubs(); Cloud.ws = null; wsRef = null; Store.useCloud(null); setSaved("Saved");
  if (failed && Cloud.ws?.id) failedWs.add(Cloud.ws.id);
  localStorage.removeItem("lumen-active-ws");
  App.onWorkspaceChange();
  // still signed in (workspace deleted, access removed…): move on to another workspace, or set one up
  if (Cloud.user && !signingOut) setTimeout(ensureWorkspace, 50);
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
// src: true = copy private pages, false = demo pages, or a ready-made { pages, root } state
async function create(name, src, icon = "") {
  if (!Cloud.user && !(await signIn())) return;
  const email = Cloud.user.email.toLowerCase();
  src = JSON.parse(J(src === true ? Store.local : src && src.pages ? { pages: src.pages, root: src.root } : Store.seedPages()));
  const ref = fb.doc(fb.collection(db, "workspaces"));
  setSaved("Uploading…");
  try {
    await fb.setDoc(ref, { name, owner: Cloud.user.uid, ownerEmail: email, members: [email], root: src.root, icon, createdAt: fb.serverTimestamp() });
    const pagesCol = fb.collection(ref, "pages"); let skipped = 0;
    const ops = Object.values(src.pages).filter(p => { const ok = J(p).length < 900000; if (!ok) skipped++; return ok; })
      .map(p => b => b.set(fb.doc(pagesCol, p.id), { data: J(p), at: fb.serverTimestamp(), by: Cloud.user.uid }));
    await commit(ops);
    if (skipped) UI.toast(`${skipped} page(s) were too large to upload`);
    await open(ref.id, src.root[0]);
  } catch (e) { console.error(e); setSaved("Saved"); UI.toast("Couldn't create workspace: " + (e.code || e.message)); }
}
async function invite(email) {
  email = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return UI.toast("Enter a valid email address");
  // Settings → Employees → Allowed email domains (empty = any address)
  const domains = (wsPref("people.inviteDomains") || []).map(d => String(d).trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  if (domains.length && !domains.includes(email.split("@")[1])) {
    UI.toast(`This workspace only invites addresses ending in ${domains.map(d => "@" + d).join(", ")}. An admin can change this in Settings → Employees.`);
    return false;
  }
  try { await fb.updateDoc(wsRef, { members: fb.arrayUnion(email), ...(adminWrite() ? { roleEdit: "" } : {}) }); }
  catch (e) { UI.toast(e.code === "permission-denied" ? "You can't invite people here. Ask an admin (Settings → Employees → Who can invite)." : e.message); return false; }
  await sendInvite(email);
  return true;
}
// a workspace setting (js/prefs.js) without failing when it isn't loaded
const wsPref = path => { try { return window.Prefs ? Prefs.get(path) : undefined; } catch { return undefined; } };
async function sendInvite(email) {
  // Settings → Security → email-link sign-in switched off: no emailed sign-in link, just the workspace link to open with Google
  if (wsPref("security.emailLinks") === false) return sendInviteDialog(email, "Email sign-in links are switched off for this workspace.");
  UI.toast(`Sending invite to ${email}…`);
  try { await emailInvite(email); UI.toast(`✉️ Invite emailed to ${email}`); }
  catch (e) {
    console.warn(e);
    const why = e.code === "auth/quota-exceeded" ? "Today's free limit of invite emails is used up."
      : e.code === "auth/operation-not-allowed" ? "Email invites aren't switched on in Firebase yet."
      : "The invite email couldn't be sent (" + (e.code || e.message) + ").";
    sendInviteDialog(email, why);
  }
}
// Fallback when the email can't be sent: help the owner send the link themselves.
function sendInviteDialog(email, why) {
  const ws = Cloud.ws, link = `${location.href.split("#")[0]}#/ws/${ws.id}`;
  const from = Cloud.user.displayName || "A friend";
  const subject = `Join "${ws.name}" on Lumen Notes`;
  const body = `${from} invited you to the shared workspace "${ws.name}".\n\nOpen this link and sign in with Google using ${email}:\n${link}`;
  const row = h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "14px" } },
    h("a", { class: "btn primary", href: `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, text: "✉️ Email it" }),
    navigator.share ? h("button", { class: "btn", text: "📤 Share…", onclick: () => navigator.share({ title: subject, text: body }).catch(() => {}) }) : null,
    h("button", { class: "btn", text: "🔗 Copy link", onclick: e => { navigator.clipboard?.writeText(link); e.currentTarget.textContent = "✓ Copied"; } }));
  const m = UI.modal("Send the invite yourself", h("div", null,
    h("p", { style: { marginTop: 0, color: "var(--muted)" }, html: `${esc(why || "")} <b>${esc(email)}</b> is allowed into “${esc(ws.name)}”, so send them this link by email, WhatsApp or any chat:` }),
    h("input", { class: "menu-input", value: link, readonly: true, onclick: e => e.target.select() }),
    h("p", { style: { color: "var(--muted)", fontSize: "13px", marginBottom: 0 }, text: "They must sign in with Google using exactly this email address." }), row));
  m.el.style.width = "480px";
}
async function removeMember(email) {
  email = String(email || "").toLowerCase();
  // their role goes with them (FieldPath: emails contain dots); `roleEdit` names the one person this write changes (the rules check it for admins)
  const ws = Cloud.ws, more = ws?.roles && email in ws.roles ? [new fb.FieldPath("roles", email), fb.deleteField()] : [];
  if (ws?.pendingOwner === email && ws.owner === Cloud.user?.uid) more.push("pendingOwner", fb.deleteField());
  try {
    await fb.updateDoc(wsRef, "members", fb.arrayRemove(email), "roleEdit", email, ...more); UI.toast(`Removed ${email}`);
    // Settings → Communications: post a notice in #general when someone is removed
    if (wsPref("comms.announceJoins") && window.Data) Data.add("chat", { channel: "general", kind: "sys", text: `${Data.person(email).name} is no longer a member of the workspace.`, reactions: {} });
    return true;
  }
  catch (e) { UI.toast(e.code === "permission-denied" ? "Not allowed: the owner removes anyone, admins remove people below admin. Publish the latest firestore.rules." : e.message); return false; }
}
/* access levels (js/access.js): written field by field so two admins editing at once don't overwrite each other */
const access = {
  setRole: (email, role) => fb.updateDoc(wsRef, new fb.FieldPath("roles", email), role, "roleEdit", email),
  setPerm: (area, rule) => fb.updateDoc(wsRef, new fb.FieldPath("perms", area), { view: rule.view, edit: rule.edit, m: true }, ...(adminWrite() ? ["roleEdit", ""] : [])),
  resetPerms: () => fb.updateDoc(wsRef, { perms: fb.deleteField(), ...(adminWrite() ? { roleEdit: "" } : {}) }),
};
/* ownership transfer: the owner names an admin in `pendingOwner`; when that person next opens the workspace their own app
   writes their uid as the owner (so nobody needs someone else's uid) and the old owner becomes a Level 1 admin */
async function transferOwnership(email) {
  const ws = Cloud.ws;
  if (!ws || !Cloud.user || ws.owner !== Cloud.user.uid) throw new Error("Only the current owner can transfer ownership");
  email = String(email || "").toLowerCase();
  if (!ws.members.includes(email) || (ws.roles || {})[email] !== "admin") throw new Error("Pick a Level 1 admin");
  await fb.updateDoc(wsRef, { pendingOwner: email });
}
async function cancelTransfer() { await fb.updateDoc(wsRef, { pendingOwner: fb.deleteField() }); }
async function acceptOwnership(ref, d) {
  const me = Cloud.user.email.toLowerCase(), old = String(d.ownerEmail || "").toLowerCase();
  const args = ["owner", Cloud.user.uid, "ownerEmail", me, "pendingOwner", fb.deleteField()];
  if (d.roles && me in d.roles) args.push(new fb.FieldPath("roles", me), fb.deleteField());
  if (old && old !== me) args.push(new fb.FieldPath("roles", old), "admin");
  try { await fb.updateDoc(ref, ...args); UI.toast(`👑 You're now the owner of “${d.name}”`); }
  catch (e) { console.warn(e); UI.toast("Couldn't take over the workspace: " + (e.code || e.message)); }
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
    fb.setDoc(fb.doc(wsRef, "presence", u.uid), { name: u.displayName || u.email, email: u.email, photo: u.photoURL || "", avatar: Data.me().avatar || "", page: App.currentId || "", at: fb.serverTimestamp() }).catch(() => {});
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
    const el = h("span", { class: "av" + (p.page === App.currentId ? " here" : ""), title: `${p.name}${pg ? " · on " + (pg.title || "Untitled") : ""}` }, Apps.avatar({ key: p.email, name: p.name, photo: p.photo, avatar: p.avatar || "" }, 24));
    el.addEventListener("click", () => pg && App.go(pg.id));
    box.append(el);
  });
}

/* ---------- menus used by the app shell ---------- */
Cloud.workspaceMenuItems = () => {
  const items = [{ section: "Workspaces" }];
  Cloud.workspaces.forEach(w => items.push({ label: w.name, iconHtml: "<span>👥</span>", kbd: Cloud.ws?.id === w.id ? "✓" : "", onClick: () => Cloud.ws?.id !== w.id && open(w.id) }));
  if (Cloud.ws && window.Apps?.Access && Apps.isManager?.()) items.push({ label: "Members & levels…", icon: "lock", onClick: () => Apps.Access.open("people") });
  items.push({ sep: true });
  if (!Cloud.configured) items.push({ label: "Set up sharing…", icon: "link", onClick: setupModal });
  else if (!Cloud.user) items.push({ label: "Sign in with Google", icon: "smile", onClick: signIn });
  else items.push({ label: "Create a new workspace…", icon: "plus", onClick: () => Onboarding.newWorkspace() }, { label: `Sign out (${Cloud.user.email})`, icon: "arrow", onClick: signOutNow });
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
  if (!Cloud.ws) {
    if (!Cloud.user || !Cloud.workspaces.length) return createDialog();
    // already in shared workspaces: offer to open one (that's where inviting happens) or make a new one
    return UI.menu(anchor, [{ section: "Open a shared workspace to invite people" },
      ...Cloud.workspaces.map(w => ({ label: w.name, iconHtml: "<span>👥</span>", onClick: () => open(w.id) })),
      { sep: true }, { label: "New shared workspace…", icon: "plus", onClick: createDialog }], { align: "end" });
  }
  const ws = Cloud.ws, me = Cloud.user, isOwner = ws.owner === me.uid, myEmail = me.email.toLowerCase();
  // access levels (js/access.js): admins and managers may invite; the owner and admins remove people (through the hand-over dialog)
  const A = window.Apps?.Access && Apps.canManage ? Apps : null;
  const canInvite = A ? Apps.canManage(null, "invite") : isOwner;
  const canRemove = m => A ? Apps.canManage(m, "remove") : isOwner && m !== myEmail;
  const roleOf = m => A ? Apps.role(m) : m === ws.ownerEmail ? "owner" : "member";
  const base = location.href.split("#")[0];
  const items = [{ section: `👥 ${ws.name} · ${ws.members.length} member${ws.members.length === 1 ? "" : "s"}` }];
  if (canInvite) {
    const inp = h("input", { class: "menu-input", placeholder: "Friend's Gmail address, then Enter" });
    inp.addEventListener("keydown", async e => { if (e.key === "Enter" && inp.value.trim()) { UI.closePops(); await invite(inp.value); } });
    items.push({ el: inp });
    setTimeout(() => inp.focus(), 30);
  }
  ws.members.forEach(m => { const r = roleOf(m); items.push({ el: h("div", { class: "mi compact", style: { cursor: "default" } },
    h("span", { class: "mi-ic", text: r === "owner" ? "👑" : "👤" }), h("span", { class: "mi-t", style: { fontWeight: 400, fontSize: "13px" }, text: m + (m === myEmail ? " (you)" : "") }),
    A ? Apps.Access.badge(r) : null,
    (canInvite || canRemove(m)) && r !== "owner" && m !== ws.ownerEmail && m !== myEmail ? h("span", { style: { marginLeft: A ? "4px" : "auto", display: "flex", gap: "2px" } },
      canInvite ? h("button", { class: "icon-btn xs", title: "Resend invite email", text: "✉️", onclick: () => { UI.closePops(); sendInvite(m); } }) : null,
      canRemove(m) ? h("button", { class: "icon-btn xs", title: "Remove…", html: icon("x"), onclick: async () => { UI.closePops(); if (A?.Access?.remove) A.Access.remove(m); else if (await UI.confirm(`Remove ${m}?`, "Remove")) removeMember(m); } }) : null) : null) }); });
  items.push({ sep: true },
    ...(A && Apps.isManager?.() ? [{ label: "Members & levels…", icon: "lock", onClick: () => Apps.Access.open("people") }] : []),
    { label: "Copy invite link", icon: "link", onClick: () => { navigator.clipboard?.writeText(`${base}#/ws/${ws.id}`); UI.toast("🔗 Invite link copied. Friends sign in with the email you invited."); } },
    ...(window.FEATURES?.pages !== false ? [{ label: "Copy link to this page", icon: "page", onClick: () => App.copyLink(App.currentId) }] : []));
  if (isOwner) items.push({ label: "Delete shared workspace", icon: "trash", danger: true, onClick: deleteWorkspace });
  else if (!canInvite) items.push({ el: h("div", { class: "menu-empty", style: { fontSize: "12px", maxWidth: "260px" }, text: "Only the owner, admins and managers can invite people." }) });
  UI.menu(anchor, items, { align: "end" });
};
Cloud.signIn = signIn;
Cloud.signOut = signOutNow;
Cloud.invite = invite;
Cloud.removeMember = removeMember;
Cloud.transferOwnership = transferOwnership;
Cloud.cancelTransfer = cancelTransfer;
Cloud.deleteWorkspace = () => Cloud.ws && Cloud.user && Cloud.ws.owner === Cloud.user.uid ? deleteWorkspace() : UI.toast("Only the owner can delete the workspace");
Cloud.access = access;
Cloud.fs = { get fb() { return fb; }, get db() { return db; }, ref: () => wsRef };
Cloud.createFrom = (name, state, icon) => create(name, state, icon);
Cloud.open = open;
Cloud.linkFor = id => `${location.href.split("#")[0]}#/ws/${Cloud.ws.id}/p/${id}`;
Cloud.renderPresence = renderPresence;
Cloud.renderAccount = renderAccount;
renderAccount();
