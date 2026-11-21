/* Branches (js/branches.js): Bitrix24 Enterprise "branch accounts with centralized management".
   A head office workspace lists its branch workspaces in `branches: [wsId]`; each branch carries `parent: headId` and an
   optional `branchLabel` ("Mumbai office"). Settings → Branches calls Branches.draw(ctx, kit).
   Head office: totals across all, linked branches (counts via getCountFromServer), create / link / unlink, invite people,
   and actions across branches (push settings, announce, add a person). Branch: "This is a branch of …", leave the group.
   Workspace-doc writes follow the access rules: the owner sends no roleEdit; an admin (not owner) sends roleEdit "" when no
   role changes, or roleEdit: <email> when that one person gets a level; only an owner may grant Level 1 · Admin. */
(function () {
  const { h } = UI;
  const J = x => JSON.stringify(x);
  const LEVELS = [["admin", "Level 1 · Admin"], ["manager", "Level 2 · Manager"], ["member", "Level 3 · Member"], ["guest", "Level 4 · Guest"]];
  const LEVEL_LABEL = Object.fromEntries(LEVELS);
  // settings/workspace sections a branch can copy from the head office
  const SECTIONS = [["brand", "Brand and default look"], ["tools", "Tools"], ["security", "Security"], ["hours", "Business hours"],
    ["region", "Language & region"], ["people", "Employees"], ["comms", "Communications"], ["ai", "AI (CoPilot)"]];
  const TTL = 5 * 60 * 1000;
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  /* ---------- Firebase access (cloud.js is a module that loads after this file: always look it up lazily) ---------- */
  const F = () => Cloud.fs.fb;
  const DB = () => Cloud.fs.db;
  const shared = () => !!(window.Cloud?.ws && Cloud.user && Cloud.fs?.ref?.());
  const uid = () => Cloud.user?.uid || "";
  const myEmail = () => String(Cloud.user?.email || "").toLowerCase();
  const wsRef = id => F().doc(DB(), "workspaces", id);
  const errText = e => e?.code === "permission-denied" ? "no permission" : (e?.code || e?.message || "error");

  // my role in any workspace doc: "owner" | "admin" | "manager" | "member" | "guest"
  const roleIn = d => !d ? "member" : d.owner === uid() ? "owner" : ((d.roles || {})[myEmail()] || "member");
  const canAdmin = d => ["owner", "admin"].includes(roleIn(d));
  // extra fields an admin (not the owner) must send with a workspace-doc write; `email` = the one person whose level changes
  const extra = (d, email = "") => roleIn(d) === "admin" ? { roleEdit: email } : {};
  const extraArgs = (d, email = "") => roleIn(d) === "admin" ? ["roleEdit", email] : [];

  /* ---------- the open workspace's doc, live (Cloud.ws doesn't carry parent / branches / branchLabel) ---------- */
  let head = { id: null, data: null, sig: undefined, unsub: null };
  function watchHead() {
    const id = shared() ? Cloud.ws.id : null;
    if (head.id === id && (head.unsub || !id)) return;
    if (head.unsub) head.unsub();
    head = { id, data: null, sig: undefined, unsub: null };
    if (!id) return;
    const seed = (Cloud.workspaces || []).find(w => w.id === id);
    if (seed) head.data = seed;
    const ref = Cloud.fs.ref();
    head.unsub = F().onSnapshot(ref, snap => {
      if (head.id !== id) return;
      const d = snap.exists() ? snap.data() : null;
      const sig = d ? J([d.name, d.icon || "", d.parent || "", d.branches || [], d.branchLabel || "", d.owner, d.roles || {}, (d.members || []).length]) : "";
      const first = head.sig === undefined, changed = head.sig !== sig;
      head.data = d; head.sig = sig;
      if (changed) { if (!first) cache.delete(id); poke(); }
    }, e => { console.warn("branches: head doc", e); });
  }
  Apps.onWorkspace?.add(() => setTimeout(watchHead, 0));
  const headDoc = () => { watchHead(); return head.data; };

  /* ---------- per-workspace summary cache (doc + counts), so redraws don't refetch ---------- */
  const cache = new Map(); // id -> { state: "loading"|"ok"|"noaccess"|"gone"|"error", at, doc, tasks, deals, last, msg }
  async function countTasks(ref) {
    const f = F();
    try { return (await f.getCountFromServer(f.query(f.collection(ref, "tasks"), f.where("status", "in", ["todo", "doing", "review"])))).data().count; }
    catch (e) { console.warn("branches: tasks count", e); return null; }
  }
  async function countDeals(ref) {
    const f = F();
    try {
      // closed stages = won / lost ones of every pipeline (settings/crm), default pipeline otherwise
      let closed = ["won", "lost"];
      try {
        const s = await f.getDoc(f.doc(ref, "settings", "crm"));
        const pipes = (s.exists() && s.data().pipelines) || [];
        pipes.forEach(p => (p.stages || []).forEach(st => { if (st.sem === "won" || st.sem === "lost") closed.push(st.id); }));
      } catch {}
      closed = [...new Set(closed)].slice(0, 10);
      return (await f.getCountFromServer(f.query(f.collection(ref, "deals"), f.where("stage", "not-in", closed)))).data().count;
    } catch (e) { console.warn("branches: deals count", e); return null; }
  }
  async function lastActive(ref) {
    const f = F();
    try {
      const s = await f.getDocs(f.query(f.collection(ref, "presence"), f.orderBy("at", "desc"), f.limit(1)));
      const at = s.docs[0]?.data().at;
      return at?.toMillis ? at.toMillis() : null;
    } catch { return null; }
  }
  function load(id, force) {
    const c = cache.get(id);
    if (!force && c && (c.state === "loading" || Date.now() - c.at < TTL)) return c;
    const entry = { state: "loading", at: Date.now() };
    cache.set(id, entry);
    (async () => {
      const ref = wsRef(id);
      let snap;
      try { snap = await F().getDoc(ref); }
      catch (e) { return Object.assign(entry, { state: e.code === "permission-denied" ? "noaccess" : "error", msg: errText(e), at: Date.now() }); }
      if (!snap.exists()) return Object.assign(entry, { state: "gone", at: Date.now() });
      const [tasks, deals, last] = await Promise.all([countTasks(ref), countDeals(ref), lastActive(ref)]);
      Object.assign(entry, { state: "ok", doc: snap.data(), tasks, deals, last, at: Date.now() });
    })().catch(e => Object.assign(entry, { state: "error", msg: errText(e), at: Date.now() })).finally(() => { if (cache.get(id) === entry) poke(); });
    return entry;
  }
  const refreshAll = () => { cache.clear(); poke(); };

  /* ---------- redraw the section when data arrives (debounced, never while someone types in it) ---------- */
  let lastCtx = null, mount = null, pokeT = 0;
  function poke() {
    clearTimeout(pokeT);
    pokeT = setTimeout(() => {
      if (!lastCtx || !mount || !mount.isConnected) return;
      const main = mount.closest(".st-main") || mount.parentNode, a = document.activeElement;
      if (a && main && main.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !/^(checkbox|radio)$/.test(a.type)) return poke();
      lastCtx.redraw();
    }, 80);
  }

  /* ---------- small helpers ---------- */
  const nameOf = d => (d && d.name) || "Workspace";
  const adminsOf = d => [...new Set([d.ownerEmail, ...Object.entries(d.roles || {}).filter(([, r]) => r === "admin").map(([e]) => e)].filter(Boolean))];
  const short = e => String(e || "").split("@")[0];
  const fmtN = n => n == null ? "—" : Number(n).toLocaleString();
  const chk = (on, label, sub, attrs = {}) => {
    const box = h("input", { type: "checkbox", checked: !!on, ...attrs });
    const el = h("label", { class: "br-chk" + (attrs.disabled ? " off" : "") }, box, h("span", { class: "br-chk-t" }, h("b", { text: label }), sub ? h("small", { text: sub }) : null));
    el.box = box; return el;
  };
  const field = (label, ctl, note) => h("label", { class: "f-row" }, h("span", { text: label }), ctl, note ? h("small", { class: "br-note", text: note }) : null);
  function dialog(title, body, okLabel, onOk, width = 520) {
    const ok = h("button", { class: "btn primary", text: okLabel });
    const cancel = h("button", { type: "button", class: "btn", text: "Cancel" });
    const m = UI.modal(title, h("div", { class: "br-dlg" }, body, h("div", { class: "f-actions" }, h("span"), h("span", { style: { display: "flex", gap: "8px" } }, cancel, ok))));
    m.el.style.width = width + "px";
    cancel.onclick = () => m.close();
    ok.onclick = async () => {
      ok.disabled = true; const t = ok.textContent; ok.textContent = "Working…";
      try { if ((await onOk()) !== false) m.close(); }
      catch (e) { console.warn(e); UI.toast("Something went wrong: " + errText(e)); }
      finally { ok.disabled = false; ok.textContent = t; }
    };
    setTimeout(() => m.el.querySelector("input:not([type=checkbox]),textarea")?.focus(), 60);
    return m;
  }
  // checklist of target workspaces: [{ id, name, ok (eligible), why }]
  function targetList(items) {
    const wrap = h("div", { class: "br-targets" });
    const rows = items.map(t => { const c = chk(t.ok, t.name, t.why || t.sub || "", { disabled: !t.ok }); c.box.dataset.id = t.id; return c; });
    if (!rows.length) wrap.append(h("div", { class: "st-empty", text: "No branches to choose from." }));
    else wrap.append(...rows);
    wrap.picked = () => rows.filter(r => r.box.checked && !r.box.disabled).map(r => r.box.dataset.id);
    return wrap;
  }
  function levelSelect(val, allowAdmin) {
    return h("select", { class: "menu-input" }, ...LEVELS.map(([v, l]) => h("option", { value: v, selected: v === val, disabled: v === "admin" && !allowAdmin }, l + (v === "admin" && !allowAdmin ? " (owner only)" : ""))));
  }
  const pickSettings = secs => { const w = window.Prefs ? Prefs.ws() : {}; const out = {}; secs.forEach(s => { if (w[s] !== undefined) out[s] = JSON.parse(J(w[s])); }); return out; };

  /* ---------- writes ---------- */
  // add a person to one workspace (doc d) with a level, following the access rules
  async function addPerson(id, d, email, level) {
    const role = roleIn(d), f = F();
    if ((d.members || []).includes(email)) return "already";
    if (!["owner", "admin", "manager"].includes(role)) throw Object.assign(new Error("You can't invite people there"), { code: "permission-denied" });
    if (level === "admin" && role !== "owner") throw new Error("only the owner can add a Level 1 admin");
    if (role === "manager" && level !== "member") throw new Error("managers can only add Level 3 members");
    const args = ["members", f.arrayUnion(email)];
    if (level !== "member") args.push(new f.FieldPath("roles", email), level);
    if (role === "admin") args.push("roleEdit", level !== "member" ? email : "");
    await f.updateDoc(wsRef(id), ...args);
    return "added";
  }
  async function emailInvite(id, email, name) {
    const link = `${location.origin}${location.pathname}#/ws/${id}`;
    const emailOff = (() => { try { return window.Prefs && Prefs.get("security.emailLinks") === false; } catch { return false; } })();
    const fallback = why => UI.toast(`${why} Send ${email} the link to ${name}.`, { label: "Copy link", run: () => { navigator.clipboard?.writeText(link); UI.toast("🔗 Link copied"); } });
    if (emailOff) return fallback("Email sign-in links are off.");
    try {
      const f = F();
      await f.sendSignInLinkToEmail(f.getAuth(), email, { url: `${location.origin}${location.pathname}?ws=${id}`, handleCodeInApp: true });
      UI.toast(`✉️ Invite emailed to ${email}`);
    } catch (e) {
      console.warn(e);
      fallback(e.code === "auth/quota-exceeded" ? "Today's invite emails are used up." : "The invite email couldn't be sent.");
    }
  }
  async function unlink(id, name) {
    const hd = headDoc(), headId = head.id;
    if (!(await UI.confirm(`Unlink “${name}”? It stays a separate workspace with all of its data. It just leaves this branch group.`, "Unlink"))) return;
    const f = F(), c = cache.get(id);
    try { await f.updateDoc(Cloud.fs.ref(), { branches: f.arrayRemove(id), ...extra(hd) }); }
    catch (e) { return UI.toast("Couldn't unlink: " + errText(e)); }
    // clear `parent` on the branch too when I'm allowed to (otherwise it just points at a head that no longer lists it)
    if (c?.state === "ok" && c.doc.parent === headId && canAdmin(c.doc)) {
      try { await f.updateDoc(wsRef(id), { parent: f.deleteField(), ...extra(c.doc) }); } catch (e) { console.warn(e); }
    }
    cache.delete(id); UI.toast(`Unlinked ${name}`); poke();
  }

  /* ---------- dialogs ---------- */
  function createDialog(kit) {
    const hd = headDoc(), headId = head.id, me = myEmail();
    const name = h("input", { class: "menu-input", maxlength: 60, placeholder: "e.g. Acme Mumbai" });
    const label = h("input", { class: "menu-input", maxlength: 40, placeholder: "e.g. Mumbai office" });
    const secs = SECTIONS.map(([k, l]) => { const c = chk(true, l); c.box.dataset.k = k; return c; });
    const people = (hd.members || []).filter(e => e !== me).sort();
    const roleOf = e => e === hd.ownerEmail ? "admin" : ((hd.roles || {})[e] || "member");
    const pRows = people.map(e => {
      const p = window.Data ? Data.person(e) : { name: short(e) };
      const c = chk(false, p.name || short(e), e);
      const lv = levelSelect(roleOf(e), true); lv.classList.add("br-lv");
      return { e, c, lv, el: h("div", { class: "br-prow" }, c, lv) };
    });
    const search = people.length > 8 ? h("input", { class: "menu-input", type: "search", placeholder: "Find people…" }) : null;
    if (search) search.oninput = () => { const q = search.value.trim().toLowerCase(); pRows.forEach(r => { r.el.style.display = !q || (r.e + " " + r.c.textContent).toLowerCase().includes(q) ? "" : "none"; }); };
    const mail = chk(true, "Email them an invite link");
    const body = h("div", null,
      h("p", { class: "br-lead", text: "A branch is a separate workspace with its own data and members. You'll be its owner, and it shows up here so you can manage it from the head office." }),
      field("Branch name", name), field("Label (optional)", label, "Shown next to the name, like a city or office."),
      h("div", { class: "br-sub", text: "Copy settings from this workspace" }), h("div", { class: "br-grid" }, ...secs),
      h("div", { class: "br-sub", text: "Add people from this workspace" }),
      people.length ? h("div", null, search, h("div", { class: "br-plist" }, ...pRows.map(r => r.el)), mail) : h("div", { class: "st-empty", text: "Nobody else is in this workspace yet. You can invite people later." }));
    dialog("Create a branch", body, "Create branch", async () => {
      const n = name.value.trim();
      if (!n) { UI.toast("Give the branch a name"); name.focus(); return false; }
      const f = F(), chosen = pRows.filter(r => r.c.box.checked).map(r => [r.e, r.lv.value]);
      const roles = {}; chosen.forEach(([e, l]) => { if (l !== "member") roles[e] = l; });
      const ref = f.doc(f.collection(DB(), "workspaces"));
      const lab = label.value.trim();
      kit.markWrite();
      await f.setDoc(ref, { name: n, owner: uid(), ownerEmail: me, members: [me, ...chosen.map(([e]) => e)], roles, root: [], icon: "🏬",
        createdAt: f.serverTimestamp(), parent: headId, ...(lab ? { branchLabel: lab } : {}) });
      const picked = secs.filter(c => c.box.checked).map(c => c.box.dataset.k);
      if (picked.length) {
        try { await f.setDoc(f.doc(ref, "settings", "workspace"), pickSettings(picked), { merge: true }); }
        catch (e) { console.warn(e); UI.toast("The branch was created, but its settings couldn't be copied: " + errText(e)); }
      }
      try { await f.updateDoc(Cloud.fs.ref(), { branches: f.arrayUnion(ref.id), ...extra(hd) }); }
      catch (e) { console.warn(e); UI.toast("The branch was created but couldn't be linked here: " + errText(e) + ". Use Link an existing workspace."); }
      UI.toast(`🏬 ${n} created`);
      if (mail.box.checked) for (const [e] of chosen) await emailInvite(ref.id, e, n);
      cache.delete(headId); poke();
    }, 560);
  }

  function linkDialog(kit) {
    const hd = headDoc(), headId = head.id, linked = new Set(hd.branches || []);
    const cands = (Cloud.workspaces || []).filter(w => w.id !== headId && !linked.has(w.id) && canAdmin(w)
      && (!w.parent || w.parent === headId) && !(w.branches || []).length);
    if (!cands.length) {
      const ok = h("button", { class: "btn", text: "OK" });
      const m = UI.modal("Link an existing workspace", h("div", { class: "br-dlg" },
        h("p", { class: "br-lead", text: "There's nothing to link right now. You can link a workspace you own or are a Level 1 admin of, that isn't already part of another branch group and has no branches of its own." }),
        h("div", { class: "f-actions" }, h("span"), ok)));
      m.el.style.width = "480px"; ok.onclick = () => m.close();
      return;
    }
    const sel = h("select", { class: "menu-input" }, ...cands.map(w => h("option", { value: w.id }, `${w.name || "Workspace"}${w.parent === headId ? " (waiting to be linked)" : ""}`)));
    const label = h("input", { class: "menu-input", maxlength: 40, placeholder: "e.g. Mumbai office" });
    const fillLabel = () => { const w = cands.find(x => x.id === sel.value); label.value = w?.branchLabel || ""; };
    sel.onchange = fillLabel; fillLabel();
    dialog("Link an existing workspace", h("div", null,
      h("p", { class: "br-lead", text: "The workspace keeps its own data and members. It becomes a branch of this head office." }),
      field("Workspace", sel), field("Label (optional)", label)), "Link", async () => {
      const w = cands.find(x => x.id === sel.value); if (!w) return false;
      const f = F(), lab = label.value.trim();
      kit.markWrite();
      try { await f.updateDoc(wsRef(w.id), { parent: headId, ...(lab ? { branchLabel: lab } : w.branchLabel ? { branchLabel: f.deleteField() } : {}), ...extra(w) }); }
      catch (e) { UI.toast(`Couldn't change ${w.name}: ${errText(e)}`); return false; }
      try { await f.updateDoc(Cloud.fs.ref(), { branches: f.arrayUnion(w.id), ...extra(hd) }); }
      catch (e) { UI.toast("Couldn't add it to this head office: " + errText(e)); return false; }
      cache.delete(w.id); UI.toast(`🔗 ${w.name} is now a branch`); poke();
    }, 480);
  }

  function labelDialog(id, d) {
    const inp = h("input", { class: "menu-input", maxlength: 40, placeholder: "e.g. Mumbai office", value: d.branchLabel || "" });
    dialog(`Label for ${nameOf(d)}`, field("Label", inp, "Leave it empty to show just the name."), "Save", async () => {
      const f = F(), v = inp.value.trim();
      try { await f.updateDoc(wsRef(id), { branchLabel: v || f.deleteField(), ...extra(d) }); }
      catch (e) { UI.toast("Couldn't save the label: " + errText(e)); return false; }
      cache.delete(id); poke();
    }, 420);
  }

  // targets for centralized actions: every linked branch, eligible when it loaded and `test(doc)` passes
  function targets(test, whyNot) {
    return (headDoc()?.branches || []).map(id => {
      const c = cache.get(id), d = c?.doc;
      if (!c || c.state !== "ok") return { id, name: d ? nameOf(d) : "Branch", ok: false, why: c?.state === "loading" ? "Still loading" : "No access" };
      const ok = test(d);
      return { id, name: nameOf(d) + (d.branchLabel ? " · " + d.branchLabel : ""), ok, why: ok ? LEVEL_LABEL[roleIn(d)] || "Owner" : whyNot };
    });
  }

  function personDialog(kit, onlyId) {
    const email = h("input", { class: "menu-input", type: "email", placeholder: "name@company.com" });
    const items = targets(d => ["owner", "admin", "manager"].includes(roleIn(d)), "You can't invite people there")
      .filter(t => !onlyId || t.id === onlyId);
    const ownsAny = items.some(t => t.ok && roleIn(cache.get(t.id).doc) === "owner");
    const lv = levelSelect("member", ownsAny);
    const list = onlyId ? null : targetList(items);
    const mail = chk(true, "Email an invite link");
    const one = onlyId ? cache.get(onlyId)?.doc : null;
    dialog(onlyId ? `Invite people to ${nameOf(one)}` : "Add a person to branches", h("div", null,
      field("Email", email), field("Level", lv, ownsAny ? "Only a workspace's owner can add a Level 1 admin. Where you're an admin but not the owner, pick a lower level."
        : "Only a workspace's owner can add a Level 1 admin, so that level is off here."),
      list ? h("div", { class: "br-sub", text: "Branches" }) : null, list, mail), onlyId ? "Invite" : "Add", async () => {
      const e = email.value.trim().toLowerCase();
      if (!EMAIL_RE.test(e)) { UI.toast("Enter a valid email address"); email.focus(); return false; }
      const ids = onlyId ? (items[0]?.ok ? [onlyId] : []) : list.picked();
      if (!ids.length) { UI.toast("Pick at least one branch"); return false; }
      kit.markWrite();
      const added = [], already = [], failed = [];
      for (const id of ids) {
        const d = cache.get(id).doc;
        try { (await addPerson(id, d, e, lv.value)) === "added" ? added.push(id) : already.push(nameOf(d)); }
        catch (err) { failed.push(`${nameOf(d)} (${errText(err)})`); }
      }
      if (added.length) UI.toast(`Added ${e} to ${added.length} branch${added.length === 1 ? "" : "es"}`);
      if (already.length) UI.toast(`Already a member of ${already.join(", ")}`);
      if (failed.length) UI.toast(`Couldn't add to ${failed.join(", ")}`);
      if (added.length && mail.box.checked) await emailInvite(added[0], e, nameOf(cache.get(added[0]).doc));
      added.forEach(id => cache.delete(id)); poke();
      if (!added.length && failed.length) return false;
    }, 500);
  }

  function pushDialog(kit) {
    const secs = SECTIONS.map(([k, l]) => { const c = chk(false, l); c.box.dataset.k = k; return c; });
    const list = targetList(targets(canAdmin, "Only owners and admins can change its settings"));
    dialog("Push settings to branches", h("div", null,
      h("p", { class: "br-lead", text: "Copies these sections of this workspace's settings to each branch you pick, replacing what the branch has." }),
      h("div", { class: "br-sub", text: "Sections" }), h("div", { class: "br-grid" }, ...secs),
      h("div", { class: "br-sub", text: "Branches" }), list), "Push settings", async () => {
      const picked = secs.filter(c => c.box.checked).map(c => c.box.dataset.k), ids = list.picked();
      if (!picked.length) { UI.toast("Pick at least one section"); return false; }
      if (!ids.length) { UI.toast("Pick at least one branch"); return false; }
      const f = F(), data = pickSettings(picked), keys = Object.keys(data), failed = [];
      kit.markWrite();
      for (const id of ids) {
        try { await f.setDoc(f.doc(wsRef(id), "settings", "workspace"), data, { mergeFields: keys }); }
        catch (e) { failed.push(`${nameOf(cache.get(id).doc)} (${errText(e)})`); }
      }
      const ok = ids.length - failed.length;
      if (ok) UI.toast(`✓ Settings pushed to ${ok} branch${ok === 1 ? "" : "es"}`);
      if (failed.length) { UI.toast(`Couldn't update ${failed.join(", ")}`); if (!ok) return false; }
    }, 520);
  }

  function announceDialog(kit) {
    const text = h("textarea", { class: "menu-input f-ta", rows: 5, maxlength: 4000, placeholder: "What should everyone know?" });
    const list = targetList(targets(() => true, ""));
    const here = chk(true, `Also post in ${nameOf(headDoc())}`);
    dialog("Announce in branches", h("div", null,
      h("p", { class: "br-lead", text: "Posts an announcement to all employees in each branch's Feed. People are asked to mark it as read." }),
      field("Announcement", text), h("div", { class: "br-sub", text: "Branches" }), list, here), "Post", async () => {
      const t = text.value.trim();
      if (!t) { UI.toast("Write the announcement first"); text.focus(); return false; }
      const ids = list.picked();
      if (!ids.length && !here.box.checked) { UI.toast("Pick at least one branch"); return false; }
      const f = F(), me = myEmail(), failed = [];
      kit.markWrite();
      const post = () => ({ kind: "announce", text: t, likes: [], comments: [], audience: { all: true }, readBy: [], at: Date.now(), by: me });
      for (const id of ids) {
        try { await f.setDoc(f.doc(f.collection(wsRef(id), "feed")), post()); }
        catch (e) { failed.push(`${nameOf(cache.get(id).doc)} (${errText(e)})`); }
      }
      if (here.box.checked && window.Data) { const { at, by, ...rest } = post(); Data.add("feed", rest); }
      const ok = ids.length - failed.length + (here.box.checked ? 1 : 0);
      if (ok) UI.toast(`📣 Posted in ${ok} workspace${ok === 1 ? "" : "s"}`);
      if (failed.length) { UI.toast(`Couldn't post in ${failed.join(", ")}`); if (!ok) return false; }
    }, 520);
  }

  /* ---------- drawing ---------- */
  function stat(label, value, sub) {
    return h("div", { class: "br-stat" }, h("b", { text: value }), h("span", { text: label }), sub ? h("small", { text: sub }) : null);
  }
  function branchRow(id, kit, isAdmin) {
    const headId = head.id, c = load(id), d = c.doc;
    const act = [];
    const menuBtn = items => h("button", { type: "button", class: "icon-btn", title: "More", "aria-label": "More actions", html: UI.icon("dots"), onclick: e => UI.menu(e.currentTarget, items, { align: "end" }) });
    if (c.state === "loading") {
      return h("div", { class: "br-row" }, h("span", { class: "br-ic", text: "🏬" }), h("div", { class: "br-main" }, h("b", { class: "br-skel", text: "Loading…" }), h("small", { text: " " })));
    }
    if (c.state !== "ok") {
      const why = c.state === "noaccess" ? "No access. You're not a member of this workspace." : c.state === "gone" ? "This workspace was deleted." : "Couldn't load it (" + (c.msg || "error") + ").";
      return h("div", { class: "br-row dim" }, h("span", { class: "br-ic", text: c.state === "gone" ? "🗑️" : "🔒" }),
        h("div", { class: "br-main" }, h("b", { text: c.state === "noaccess" ? "No access" : c.state === "gone" ? "Deleted workspace" : "Unavailable" }), h("small", { text: why })),
        h("div", { class: "br-acts" }, c.state === "error" ? h("button", { class: "btn", text: "Retry", onclick: () => { load(id, true); poke(); } }) : null,
          isAdmin ? h("button", { class: "btn", text: "Unlink", onclick: () => unlink(id, "this branch") }) : null));
    }
    const admins = adminsOf(d), members = (d.members || []).length, mine = canAdmin(d), mismatch = d.parent !== headId;
    const meta = [`${members} ${members === 1 ? "person" : "people"}`, admins.length ? "Admins: " + admins.slice(0, 3).map(short).join(", ") + (admins.length > 3 ? ` +${admins.length - 3}` : "") : null].filter(Boolean).join(" · ");
    const items = [{ label: "Open", icon: "arrow", onClick: () => Cloud.open(id) }];
    if (["owner", "admin", "manager"].includes(roleIn(d))) items.push({ label: "Invite people…", icon: "plus", onClick: () => personDialog(kit, id) });
    if (mine) items.push({ label: "Edit label…", icon: "text", onClick: () => labelDialog(id, d) });
    if (isAdmin) items.push({ sep: true }, { label: "Unlink", icon: "x", danger: true, onClick: () => unlink(id, nameOf(d)) });
    return h("div", { class: "br-row" },
      h("span", { class: "br-ic", text: d.icon || "🏬" }),
      h("div", { class: "br-main" },
        h("div", { class: "br-name" }, h("b", { text: nameOf(d) }), d.branchLabel ? h("span", { class: "br-label", text: d.branchLabel }) : null,
          window.Apps?.Access?.badge ? Apps.Access.badge(roleIn(d)) : null, mismatch ? h("span", { class: "br-warn", text: "Not linked back" }) : null),
        h("small", { text: meta }),
        h("div", { class: "br-chips" },
          h("span", { class: "br-chip", title: "Open tasks", text: `✅ ${fmtN(c.tasks)} open task${c.tasks === 1 ? "" : "s"}` }),
          h("span", { class: "br-chip", title: "Open deals", text: `💼 ${fmtN(c.deals)} open deal${c.deals === 1 ? "" : "s"}` }),
          c.last ? h("span", { class: "br-chip", title: "Last activity", text: "🕐 " + UI.timeAgo(c.last) }) : null)),
      h("div", { class: "br-acts" }, h("button", { class: "btn", text: "Open", onclick: () => Cloud.open(id) }), menuBtn(items)));
  }

  function headView(kit) {
    const hd = headDoc(), headId = head.id, isAdmin = Apps.isAdmin ? Apps.isAdmin() : canAdmin(hd);
    const ids = [...new Set(hd.branches || [])];
    const hc = load(headId), rows = ids.map(id => load(id));
    const okRows = rows.filter(c => c.state === "ok"), loading = hc.state === "loading" || rows.some(c => c.state === "loading");
    const people = new Set([...(hd.members || []), ...okRows.flatMap(c => c.doc.members || [])]);
    const sum = k => [hc, ...okRows].reduce((n, c) => n + (c.state === "ok" && c[k] != null ? c[k] : 0), 0);
    const dots = v => loading ? "…" : fmtN(v);
    const hidden = rows.filter(c => c.state === "noaccess").length;
    const totals = kit.card("Overview", "This head office and its branches together.",
      h("div", { class: "br-totals" }, stat("Branches", String(ids.length)), stat("People", dots(people.size)), stat("Open tasks", dots(sum("tasks"))), stat("Open deals", dots(sum("deals")))),
      hidden ? h("div", { class: "br-note", text: `${hidden} branch${hidden === 1 ? " isn't" : "es aren't"} counted because you're not a member there.` }) : null);
    const list = kit.card("Linked branches", "Each branch is its own workspace with its own data and members.",
      h("div", { class: "st-card-acts" }, h("button", { class: "btn", text: "Refresh", title: "Load the latest numbers", onclick: refreshAll })),
      ids.length ? h("div", { class: "br-list" }, ...ids.map(id => branchRow(id, kit, isAdmin)))
        : h("div", { class: "st-empty", text: isAdmin ? "No branches yet. Create one, or link a workspace you manage." : "This workspace has no branches." }),
      isAdmin ? h("div", { class: "st-card-foot br-foot" },
        h("button", { class: "btn", text: "Link an existing workspace", onclick: () => linkDialog(kit) }),
        h("button", { class: "btn primary", text: "Create branch", onclick: () => createDialog(kit) }))
        : h("div", { class: "st-lock" }, h("span", { html: UI.icon("lock") }), h("span", { text: "Only the owner and Level 1 admins can create, link or manage branches." })));
    const out = [totals, list];
    if (isAdmin && ids.length) out.push(kit.card("Manage branches together", "Do it once here instead of in every branch.",
      kit.row("Push settings", "Copy brand, tools, security, hours and other settings to branches", h("button", { class: "btn", text: "Push settings…", onclick: () => pushDialog(kit) })),
      kit.row("Announce", "Post an announcement in the Feed of each branch", h("button", { class: "btn", text: "Announce…", onclick: () => announceDialog(kit) })),
      kit.row("Add a person to branches", "Invite someone to several branches at once, with a level", h("button", { class: "btn", text: "Add a person…", onclick: () => personDialog(kit) }))));
    return out;
  }

  function branchView(kit) {
    const hd = headDoc(), parent = hd.parent, headW = (Cloud.workspaces || []).find(w => w.id === parent), isAdmin = Apps.isAdmin ? Apps.isAdmin() : canAdmin(hd);
    const headName = headW ? nameOf(headW) : "a head office you're not a member of";
    const labelIn = isAdmin ? kit.txt(hd.branchLabel || "", async v => {
      if ((hd.branchLabel || "") === v) return;
      const f = F(); kit.markWrite();
      try { await f.updateDoc(Cloud.fs.ref(), { branchLabel: v || f.deleteField(), ...extra(hd) }); kit.saved(); }
      catch (e) { UI.toast("Couldn't save the label: " + errText(e)); }
    }, { maxlength: 40, placeholder: "e.g. Mumbai office" }) : h("span", { class: "st-ro-val", text: hd.branchLabel || "None" });
    const leave = async () => {
      if (!(await UI.confirm(`Leave the branch group of ${headName}? This workspace and its data stay as they are. The head office just stops managing it.`, "Leave group"))) return;
      const f = F(); kit.markWrite();
      // take it off the head's list when I'm allowed to there; the head office otherwise shows it as "Not linked back"
      if (headW && canAdmin(headW)) { try { await f.updateDoc(wsRef(parent), { branches: f.arrayRemove(head.id), ...extra(headW) }); } catch (e) { console.warn(e); } }
      try { await f.updateDoc(Cloud.fs.ref(), { parent: f.deleteField(), ...extra(hd) }); UI.toast("This workspace left the branch group"); }
      catch (e) { UI.toast("Couldn't leave the group: " + errText(e)); }
    };
    return [kit.card("Branch", "",
      h("div", { class: "br-banner" }, h("span", { class: "br-ic big", text: headW?.icon || "🏢" }),
        h("div", { class: "br-main" }, h("b", { text: `This is a branch of ${headName}` }),
          h("small", { text: headW ? "The head office can push settings and announcements here, and add people." : "Ask someone at the head office to invite you there if you need it." })),
        headW ? h("button", { class: "btn primary", text: "Open head office", onclick: () => Cloud.open(parent) }) : null),
      kit.row("Branch label", "Shown next to this workspace's name in the head office", labelIn),
      isAdmin ? kit.row("Leave branch group", "This workspace becomes independent again. Nothing is deleted.", h("button", { class: "btn danger", text: "Leave group…", onclick: leave })) : null,
      isAdmin ? null : h("div", { class: "st-lock" }, h("span", { html: UI.icon("lock") }), h("span", { text: "Only the owner and Level 1 admins can change this." })))];
  }

  function draw(ctx, kit) {
    lastCtx = ctx;
    let out;
    if (!shared()) out = [kit.card("Branches", "", h("div", { class: "st-empty", text: "Branches are part of shared workspaces. Sign in and open a shared workspace to use them." }))];
    else {
      const hd = headDoc();
      if (!hd) out = [kit.card("Branches", "", h("div", { class: "st-empty", text: "Loading…" }))];
      else if (hd.parent) out = branchView(kit);
      else out = headView(kit);
    }
    mount = out.find(Boolean) || null;
    return out;
  }

  // for other files: what the open workspace is in the branch group
  function headInfo() {
    const d = shared() ? headDoc() : null;
    if (!d) return null;
    const branches = d.branches || [];
    return { id: head.id, parent: d.parent || null, branches, branchLabel: d.branchLabel || "", isBranch: !!d.parent, isHead: !d.parent && branches.length > 0 };
  }

  window.Branches = { draw, headInfo, refresh: refreshAll };
})();
