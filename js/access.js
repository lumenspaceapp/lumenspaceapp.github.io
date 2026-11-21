/* Access levels and permissions (Bitrix24 "Access permissions").
   Levels: Owner (created the workspace, always everything), Level 1 · Admin, Level 2 · Manager, Level 3 · Member (default), Level 4 · Guest.
   Stored on the workspace doc (window.Cloud.ws):  roles: { email: "admin"|"manager"|"member"|"guest" },  perms: { area: { view: [roles], edit: [roles], m: true } },
   pendingOwner: email (ownership transfer waiting for the new owner to open the workspace).
   API for every app:  Apps.role(key?), Apps.level(key?) → 0 owner … 4 guest, Apps.isAdmin(key?) (admin or owner), Apps.isManager(key?) (manager or above),
   Apps.canManage(key, action, ctx?) — action "editProfile"|"remove"|"setLevel"|"moderate"|"reassign"|"invite"; ctx { group: projectId } or { channel: channelId } for "moderate",
   Apps.can(area, level = "view"|"edit"|"admin"), Apps.onAccess (Set of callbacks), Apps.Access.open(tab?) opens the "Members & levels" window.
   Note: permissions hide areas inside the app; Firestore still lets every member read and write app collections (no data-level enforcement yet). */
(function () {
  const { h, icon, esc } = UI;
  const ROLES = ["admin", "manager", "member", "guest"];
  const ORDER = ["owner", "admin", "manager", "member", "guest"];
  const LABEL = { owner: "Owner", admin: "Level 1 · Admin", manager: "Level 2 · Manager", member: "Level 3 · Member", guest: "Level 4 · Guest" };
  const ABOUT = {
    owner: "Created the workspace. Can do everything, including transferring ownership, exporting all data and deleting the workspace.",
    admin: "Everything except owner-only actions. Removes people (not the owner or other admins) and sets levels up to Manager.",
    manager: "Invites people, edits profiles in departments they head, and moderates workgroups they own or moderate.",
    member: "Normal use of the apps members can open. Edits only their own profile and deletes only their own content.",
    guest: "Only sees the apps allowed for guests: by default Home, Tasks, Chat, Workgroups, Calendar and Drive.",
  };
  // "What each level can do" (owner, admin, manager, member, guest)
  const Y = "✓", N = "—";
  const CAPS = [
    ["Use the apps", ["All", "All", "As allowed", "As allowed", "Guest apps"]],
    ["Invite people", [Y, Y, Y, N, N]],
    ["Edit profiles", ["Anyone", "All but the owner", "Their department", "Own only", "Own only"]],
    ["Delete others' posts and messages", ["Anywhere", "Anywhere", "Their workgroups", N, N]],
    ["Remove people, hand over work", ["Anyone", "Not admins", N, N, N]],
    ["Change levels", ["Anyone", "Up to Manager", N, N, N]],
    ["Permissions and workspace settings", [Y, Y, N, N, N]],
    ["Transfer ownership, export, delete workspace", [Y, N, N, N, N]],
  ];
  // apps guests can open unless an admin changes it
  const GUEST_APPS = ["home", "tasks", "chat", "groups", "calendar", "drive"];
  // areas whose configuration only admins may change by default
  const ADMIN_EDIT = ["automation", "company", "settings"];
  // shown even if the app's file failed to load, so its rights can still be set
  const KNOWN = { tasks: ["Tasks", "✅"], groups: ["Workgroups", "👥"], chat: ["Chat & Calls", "💬"], feed: ["Feed", "📰"], calendar: ["Calendar", "📅"],
    crm: ["CRM", "💼"], booking: ["Booking", "🗓️"], inventory: ["Inventory", "📦"], company: ["Company & HR", "🏢"], drive: ["Drive", "🗂️"], automation: ["Automation", "⚡"] };
  const SETTINGS = { key: "settings", title: "Workspace settings", icon: "⚙️" };

  const J = x => JSON.stringify(x);
  const norm = k => String(k || "").trim().toLowerCase();
  const ws = () => window.Cloud?.ws || null;
  // levels only apply in a shared workspace while signed in; the private (local) workspace is all yours
  const shared = () => !!(ws() && window.Cloud?.user);
  const meKey = () => norm(window.Data ? Data.me().key : "me");
  const nameOf = k => window.Data ? Data.person(k).name : k;

  // the owner's email: stored on the workspace doc (older workspaces get it the next time the owner opens them)
  function ownerKey() {
    const w = ws(); if (!w) return null;
    if (w.ownerEmail) return norm(w.ownerEmail);
    const u = window.Cloud?.user;
    return u && w.owner && w.owner === u.uid ? norm(u.email) : null;
  }

  function role(key) {
    if (!shared()) return "owner";
    key = norm(key || meKey());
    if (key && key === ownerKey()) return "owner";
    const r = (ws().roles || {})[key];
    return ROLES.includes(r) ? r : "member";
  }
  const level = key => ORDER.indexOf(role(key));
  const isAdmin = key => level(key) <= 1;
  const isManager = key => level(key) <= 2;

  /* ---------- who may manage whom (single source of truth) ---------- */
  function depts() {
    try { if (Apps.HR?.departments) return Apps.HR.departments(); } catch {}
    const o = (window.Data && Data.get("settings", "org")) || {};
    return Array.isArray(o.departments) ? o.departments.filter(d => d && d.id) : [];
  }
  // department names a person heads, including all sub-departments
  function ledDepts(key) {
    const all = depts(), ids = new Set();
    const add = id => { if (ids.has(id)) return; ids.add(id); all.filter(x => x.parent === id).forEach(x => add(x.id)); };
    all.filter(d => d.head && norm(d.head) === key).forEach(d => add(d.id));
    return all.filter(d => ids.has(d.id)).map(d => d.name);
  }
  // the workgroup a piece of content belongs to: { group: projectId } or { channel: channelId } (a workgroup's chat)
  function groupFor(ctx) {
    if (!ctx || !window.Data) return null;
    if (ctx.group) return Data.get("projects", ctx.group) || null;
    if (ctx.channel) return Data.list("projects").find(p => p.chat && p.chat === ctx.channel) || null;
    return null;
  }
  const leadsGroup = (g, k) => !!g && Array.isArray(g.members) && (norm(g.owner || g.by) === k || (g.moderators || []).map(norm).includes(k));

  function canManage(key, action, ctx) {
    if (!shared()) return true;
    const me = meKey(), L = level(me), w = ws();
    key = norm(key);
    const T = key ? level(key) : 4, self = !!key && key === me;
    switch (action) {
      case "invite": return L === 0 || L === 2 || (L === 1 && !!w.ownerEmail); // admins need the owner's email known (the rules use it to keep the owner in)
      case "remove": return !!key && !self && T !== 0 && (L === 0 || (L === 1 && T >= 2 && !!w.ownerEmail));
      case "setLevel": return !!key && !self && T !== 0 && (L === 0 || (L === 1 && T >= 2));
      case "reassign": return !!key && !self && T !== 0 && (L === 0 || (L === 1 && T >= 2));
      case "editProfile": {
        if (self || L === 0) return true;
        if (L === 1) return T !== 0;
        if (L === 2) { const d = window.Data ? Data.person(key).dept : ""; return T >= 2 && !!d && ledDepts(me).includes(d); }
        return false;
      }
      case "moderate": {
        if (self || L <= 1) return true;
        if (L === 2) return T >= 2 && leadsGroup(groupFor(ctx), me);
        return false;
      }
      default: return L === 0;
    }
  }
  // levels I may give someone
  const levelsFor = key => !canManage(key, "setLevel") ? [] : level() === 0 ? ROLES : ROLES.filter(r => r !== "admin");

  /* ---------- permissions ---------- */
  function defaults(area) {
    const view = ["admin", "manager", "member"];
    if (GUEST_APPS.includes(area)) view.push("guest");
    return { view, edit: ADMIN_EDIT.includes(area) ? ["admin"] : [...view] };
  }
  // stored rule for an area, falling back to the defaults per level (old workspaces have no perms at all).
  // rules saved before the Manager level existed (no `m` flag) give managers the same rights as members
  function rule(area) {
    const d = defaults(area), p = (ws()?.perms || {})[area] || {};
    const fix = a => !Array.isArray(a) ? null : !p.m && a.includes("member") && !a.includes("manager") ? ROLES.filter(r => r === "manager" || a.includes(r)) : a;
    return { view: fix(p.view) || d.view, edit: fix(p.edit) || d.edit };
  }
  function can(area, lv = "view") {
    if (!shared()) return true;
    const r = role();
    if (r === "owner") return true;
    if (lv === "admin") return r === "admin";
    if (r === "admin") return true; // admins always keep full access, so nobody can lock the workspace out of its own settings
    if (area === "home" && lv === "view") return true;
    const p = rule(area);
    return lv === "edit" ? p.view.includes(r) && p.edit.includes(r) : p.view.includes(r);
  }
  function areas() {
    const names = [...new Set([...Object.keys(Apps.reg), ...Object.keys(KNOWN)])].filter(n => n !== "home");
    return [...names.map(n => ({ key: n, title: Apps.reg[n]?.title || KNOWN[n]?.[0] || n, icon: Apps.reg[n]?.icon || KNOWN[n]?.[1] || "🧩" })), SETTINGS];
  }
  const canManageMembers = () => canManage(null, "invite");
  const adminKeys = () => (ws()?.members || []).map(norm).filter(m => isAdmin(m));

  /* ---------- change notifications ---------- */
  Apps.onAccess = new Set();
  let sig = null, switching = false;
  const signature = () => { const w = ws(); return shared() ? J([w.id, window.Cloud.user.email, w.owner, w.ownerEmail || "", w.pendingOwner || "", w.members || [], w.roles || {}, w.perms || {}]) : "local"; };
  // cloud.js calls this whenever the workspace doc changes; it runs the callbacks only if roles, perms or members really changed
  function changed() {
    const s = signature(); if (s === sig) return; sig = s;
    Apps.onAccess.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
  }
  // switching workspaces: the app re-routes right after, so the default callback doesn't need to
  Apps.onWorkspace.add(() => { switching = true; try { changed(); } finally { switching = false; } });
  Apps.onAccess.add(() => {
    Apps.renderNav?.();
    if (switching) return;
    // the open app became forbidden (or allowed again): render the route afresh
    const cur = Apps.current?.(), denied = !!document.querySelector("#view .acc-denied");
    if (cur && cur !== "home" && Apps.reg[cur] && denied === can(cur, "view")) dispatchEvent(new HashChangeEvent("hashchange"));
  });

  /* ---------- small pieces ---------- */
  const badge = r => h("span", { class: "acc-badge r-" + r, title: ABOUT[r] || "", text: LABEL[r] || r });
  const download = (name, text, type) => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = h("a", { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

  // shown instead of an app you can't open
  function denied(def) {
    const ad = adminKeys().filter(k => k !== meKey()).slice(0, 4);
    return h("div", { class: "acc-denied" },
      h("div", { class: "acc-denied-card glass" },
        h("div", { class: "acc-denied-ic" }, h("span", { text: def?.icon || "🔒" }), h("span", { class: "acc-lock", html: icon("lock") })),
        h("h2", { text: `You don't have access to ${def?.title || "this app"}` }),
        h("p", { text: "Ask an admin to give your level access to it." }),
        ad.length ? h("div", { class: "acc-denied-admins" }, h("small", { text: ad.length === 1 ? "Admin" : "Admins" }),
          ...ad.map(k => { const p = Data.person(k); return h("span", { class: "who", title: k }, Apps.avatar(p, 22), h("span", { text: p.name })); })) : null,
        h("button", { class: "btn primary", text: "Go home", onclick: () => App.go("home") })));
  }

  /* ---------- saving levels and permissions (optimistic, written to the workspace doc by cloud.js) ---------- */
  async function setRole(email, next) {
    const w = ws(); email = norm(email);
    if (!w || !window.Cloud?.access) return false;
    if (!levelsFor(email).includes(next)) { UI.toast("You can't give that level"); return false; }
    const before = role(email); if (before === next) return true;
    const name = nameOf(email);
    if (before === "admin" && !(await UI.confirm(`${name} will stop being an admin and becomes ${LABEL[next]}.`, "Change level"))) return false;
    if (next === "admin" && !(await UI.confirm(`Make ${name} ${LABEL.admin}? Admins can remove people, change levels up to Manager, and change permissions and workspace settings.`, "Make admin"))) return false;
    const had = Object.prototype.hasOwnProperty.call(w.roles || {}, email), prev = (w.roles || {})[email];
    w.roles = { ...(w.roles || {}), [email]: next }; changed();
    try { await Cloud.access.setRole(email, next); UI.toast(`${name} is now ${LABEL[next]}`); return true; }
    catch (e) {
      const r = { ...(ws()?.roles || {}) }; if (had) r[email] = prev; else delete r[email];
      if (ws()) ws().roles = r; changed();
      UI.toast(e.code === "permission-denied" ? "Not allowed: only the owner changes admins, and admins set levels up to Manager. Publish the latest firestore.rules." : "Couldn't change the level: " + (e.code || e.message));
      return false;
    }
  }
  async function savePerm(area, next) {
    const w = ws(); if (!w || !isAdmin() || !window.Cloud?.access) return;
    const prev = w.perms || {};
    w.perms = { ...prev, [area]: next }; changed();
    try { await Cloud.access.setPerm(area, next); }
    catch (e) {
      if (ws()) ws().perms = prev; changed();
      UI.toast(e.code === "permission-denied" ? "Only the owner and admins can change permissions. Publish the latest firestore.rules." : "Couldn't save: " + (e.code || e.message));
    }
  }
  async function resetPerms() {
    const w = ws(); if (!w || !isAdmin() || !window.Cloud?.access) return;
    if (!(await UI.confirm("Go back to the default permissions for every app? Custom settings are removed.", "Reset"))) return;
    const prev = w.perms || {};
    w.perms = {}; changed();
    try { await Cloud.access.resetPerms(); UI.toast("Permissions reset to defaults"); }
    catch (e) { if (ws()) ws().perms = prev; changed(); UI.toast("Couldn't reset: " + (e.code || e.message)); }
  }
  // one checkbox in the grid: edit needs view, and admins always keep both
  function toggle(area, r, lv, on) {
    const cur = rule(area), next = { view: [...cur.view], edit: [...cur.edit] };
    const set = (l, v) => { const s = new Set(next[l]); v ? s.add(r) : s.delete(r); s.add("admin"); next[l] = ROLES.filter(x => s.has(x)); };
    set(lv, on);
    if (lv === "edit" && on) set("view", true);
    if (lv === "view" && !on) set("edit", false);
    savePerm(area, { ...next, m: true });
  }

  /* ---------- reading every doc of a collection (not just the live 400 newest) ---------- */
  async function fetchAll(col) {
    const C = window.Cloud;
    if (C?.ws && C.fs?.fb && C.fs.ref()) {
      const { fb, ref } = C.fs;
      const snap = await fb.getDocs(fb.collection(ref(), col));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    return Data.list(col).map(x => ({ ...x }));
  }

  /* ---------- edit someone's details ---------- */
  async function editDetails(key) {
    key = norm(key);
    if (key === meKey() && Apps.Company?.editProfile) return Apps.Company.editProfile();
    if (!canManage(key, "editProfile")) return UI.toast("You can't edit this profile");
    const p = Data.person(key), cur = Data.get("people", key) || {};
    const names = [...new Set([...depts().map(d => d.name), cur.dept].filter(Boolean))].sort();
    const dept = names.length ? { key: "dept", label: "Department", type: "select", half: true, options: [["", "No department"], ...names.map(n => [n, n])] } : { key: "dept", label: "Department", half: true };
    const v = await Apps.form(`Edit ${p.name}`, [
      { key: "alias", label: "Display name", placeholder: `${cur.name || p.name} (from their account)` },
      { key: "title", label: "Job title", half: true }, dept,
      { key: "phone", label: "Phone", type: "tel", half: true }, { key: "birthday", label: "Birthday", type: "date", half: true },
      { key: "joined", label: "Joined on", type: "date", half: true },
      { key: "about", label: "About", type: "textarea", rows: 3 },
      { key: "mgrNote", label: "Manager note (hidden from them)", type: "textarea", rows: 2 }],
      { alias: cur.alias || "", title: cur.title || "", dept: cur.dept || "", phone: cur.phone || "", birthday: cur.birthday || "", joined: cur.joined || "", about: cur.about || "", mgrNote: cur.mgrNote || "" }, { width: 560 });
    if (!v) return;
    const pick = ["title", "dept", "phone", "birthday", "joined", "about", "mgrNote"];
    await Data.update("people", key, { ...Object.fromEntries(pick.map(k => [k, String(v[k] ?? "").trim()])), alias: String(v.alias || "").trim(), email: key });
    Data.notify(key, `✏️ <b>${esc(Data.me().name)}</b> updated your profile`, "#/app/company");
    UI.toast("Profile updated");
  }

  /* ---------- remove from groups and chats, hand over work, remove from the workspace ---------- */
  const SCAN = ["projects", "channels", "tasks", "deals", "leads", "contacts", "companies", "items", "events", "bookings"];
  const CRM_L = { deals: "deal", leads: "lead", contacts: "contact", companies: "company", items: "record" };
  async function scan(email) {
    SCAN.forEach(c => Data.list(c)); // start live listeners so the writes below land in fresh caches
    const d = {};
    for (const c of SCAN) { try { d[c] = await fetchAll(c); } catch (e) { console.warn(c, e); d[c] = Data.list(c); } }
    const ownerOf = x => norm(x.owner || x.by);
    const has = (a, k) => (a || []).map(norm).includes(k);
    const groups = d.projects.filter(p => Array.isArray(p.members) && !p.deleted && (has(p.members, email) || has(p.moderators, email) || ownerOf(p) === email));
    const chats = d.channels.filter(c => !c.deleted && (has(c.members, email) || has(c.admins, email)));
    const open = t => !t.deleted && t.kind !== "template" && t.status !== "done";
    return {
      groups, chats, channels: Object.fromEntries(d.channels.map(c => [c.id, c])),
      tasks: d.tasks.filter(t => open(t) && norm(t.assignee) === email),
      tasksOther: d.tasks.filter(t => open(t) && norm(t.assignee) !== email && (has(t.participants, email) || has(t.observers, email))),
      crm: Object.keys(CRM_L).flatMap(col => d[col].filter(r => !r.deleted && norm(r.owner) === email).map(r => ({ col, r }))),
      events: d.events.filter(e => !e.kind && ownerOf(e) === email && e.calendar !== "personal"),
      resources: d.bookings.filter(b => b.kind === "resource" && norm(b.person) === email),
    };
  }
  const workCount = pl => pl.tasks.length + pl.tasksOther.length + pl.crm.length + pl.events.length + pl.resources.length;
  function workSummary(pl) {
    return [pl.tasks.length && plural(pl.tasks.length, "open task"), pl.tasksOther.length && `following ${plural(pl.tasksOther.length, "task")}`,
      pl.crm.length && plural(pl.crm.length, "CRM record"), pl.events.length && plural(pl.events.length, "event"),
      pl.resources.length && plural(pl.resources.length, "booking resource")].filter(Boolean).join(", ") || "Nothing assigned to them";
  }
  // leave a chat: their admin seat goes to the new owner of its workgroup, or to someone still in it
  async function dropFromChannel(c, email, heir) {
    if (!c) return;
    const has = (a, k) => (a || []).map(norm).includes(k);
    if (has(c.members, email)) await Data.arr("channels", c.id, "members", email, false);
    if (heir && Array.isArray(c.members) && !has(c.members, heir)) await Data.arr("channels", c.id, "members", heir);
    const admins = (c.admins || []).map(norm), rest = admins.filter(k => k !== email);
    if (admins.includes(email)) await Data.arr("channels", c.id, "admins", email, false);
    const next = heir || (admins.includes(email) && !rest.length ? (c.members || []).map(norm).find(k => k !== email) : null);
    if (next && !rest.includes(next) && (admins.includes(email) || heir)) await Data.arr("channels", c.id, "admins", next);
  }
  function groupSteps(email, groups, pl, me) {
    return groups.map(p => ({ label: `Workgroup “${p.name || "Untitled"}”`, run: async () => {
      const owned = norm(p.owner || p.by) === email;
      await Data.arr("projects", p.id, "members", email, false);
      if ((p.moderators || []).map(norm).includes(email)) await Data.arr("projects", p.id, "moderators", email, false);
      if (owned) {
        await Data.update("projects", p.id, { owner: me, moderators: (p.moderators || []).filter(k => norm(k) !== email && norm(k) !== me) });
        await Data.arr("projects", p.id, "members", me);
      }
      if (p.chat) await dropFromChannel(pl.channels[p.chat], email, owned ? me : null);
    } }));
  }
  const chatSteps = (email, chats) => chats.map(c => ({ label: `Chat “${c.name || "Untitled"}”`, run: () => dropFromChannel(c, email, null) }));
  function handSteps(email, pl, to) {
    const s = [], has = (a, k) => (a || []).map(norm).includes(k);
    pl.tasks.forEach(t => s.push({ label: `Task “${t.title || "Untitled"}”`, run: () => Data.update("tasks", t.id, { assignee: to }) }));
    pl.tasksOther.forEach(t => s.push({ label: `Task “${t.title || "Untitled"}”`, run: async () => {
      if (has(t.participants, email)) await Data.arr("tasks", t.id, "participants", email, false);
      if (has(t.observers, email)) await Data.arr("tasks", t.id, "observers", email, false);
    } }));
    pl.crm.forEach(({ col, r }) => s.push({ label: `CRM ${CRM_L[col]} “${r.title || r.name || "Untitled"}”`, run: () => Data.update(col, r.id, { owner: to }) }));
    pl.events.forEach(e => s.push({ label: `Event “${e.title || "Event"}”`, run: () => Data.update("events", e.id, { owner: to }) }));
    pl.resources.forEach(r => s.push({ label: `Booking resource “${r.name || "Resource"}”`, run: () => Data.update("bookings", r.id, { person: "" }) }));
    return s;
  }
  function tellHeir(email, pl, to) {
    const n = pl.tasks.length + pl.crm.length + pl.events.length;
    if (!n || to === meKey()) return;
    const sum = [pl.tasks.length && plural(pl.tasks.length, "task"), pl.crm.length && plural(pl.crm.length, "CRM record"), pl.events.length && plural(pl.events.length, "event")].filter(Boolean).join(", ");
    Data.notify(to, `📦 <b>${esc(Data.me().name)}</b> handed you ${esc(nameOf(email))}'s work`, "#/app/tasks", `You're now responsible for ${sum}.`);
  }

  // mode: "remove" (remove from the workspace) | "things" (remove from groups and chats) | "handover" (hand over work)
  async function manageDialog(email, mode = "remove") {
    email = norm(email);
    const act = mode === "remove" ? "remove" : "reassign";
    if (!canManage(email, act)) return UI.toast(mode === "remove" ? "You can't remove this person" : "You can't manage this person's work");
    const p = Data.person(email), me = meKey(), w = ws();
    const title = mode === "remove" ? `Remove ${p.name}` : mode === "things" ? `Remove ${p.name} from groups and chats` : `Hand over ${p.name}'s work`;
    const body = h("div", { class: "acc-dlg" });
    const head = h("div", { class: "acc-dlg-who" }, Apps.avatar(p, 40), h("div", { class: "acc-who" }, h("b", { text: p.name }), h("small", { text: email })), shared() ? badge(role(email)) : null);
    const content = h("div", { class: "acc-dlg-body" }, h("div", { class: "acc-loading" }, h("span", { class: "acc-spin" }), "Looking at their workgroups, chats and work…"));
    const prog = h("div", { class: "acc-prog", hidden: true }, h("div", { class: "acc-bar" }, h("i")), h("small"));
    const okBtn = h("button", { class: "btn " + (mode === "remove" ? "danger" : "primary"), text: mode === "remove" ? "Remove" : mode === "things" ? "Remove from selected" : "Hand over", disabled: true });
    const cancel = h("button", { class: "btn", text: "Cancel" });
    body.append(head, content, prog, h("div", { class: "acc-dlg-acts" }, cancel, okBtn));
    let running = false;
    const m = UI.modal(title, body, { className: "acc-dlg-modal" });
    cancel.onclick = () => { if (!running) m.close(); };

    let pl;
    try { pl = await scan(email); } catch (e) { console.error(e); content.replaceChildren(h("div", { class: "acc-hint", text: "Couldn't read their work: " + (e.code || e.message) })); return; }

    const others = [...new Set((w?.members || [Data.me().key]).map(norm))].filter(k => k !== email);
    const toSel = h("select", { class: "acc-select", "aria-label": "Hand over to" }, ...others.map(k => h("option", { value: k, selected: k === me }, nameOf(k) + (k === me ? " (you)" : ""))));
    const opt = (label, sub, checked = true) => { const cb = h("input", { type: "checkbox", checked }); return { cb, el: h("label", { class: "acc-opt" }, cb, h("span", null, h("b", { text: label }), sub ? h("small", { text: sub }) : null)) }; };
    const owned = pl.groups.filter(g => norm(g.owner || g.by) === email);
    const groupChatIds = new Set(pl.groups.map(g => g.chat).filter(Boolean));
    const otherChats = pl.chats.filter(c => !groupChatIds.has(c.id));
    let collect;

    if (mode === "remove") {
      const og = opt(`Remove from all workgroups (${pl.groups.length})`, owned.length ? `${plural(owned.length, "group")} they own ${owned.length === 1 ? "passes" : "pass"} to you.` : "Also removes them from each group's chat.");
      const oc = opt(`Remove from all group chats (${otherChats.length})`, "Private channels and group chats they're in.");
      const oh = opt("Hand over their work", workSummary(pl), workCount(pl) > 0);
      if (!pl.groups.length) og.cb.disabled = true, og.cb.checked = false;
      if (!otherChats.length) oc.cb.disabled = true, oc.cb.checked = false;
      if (!workCount(pl)) oh.cb.disabled = true;
      content.replaceChildren(og.el, oc.el, oh.el,
        h("div", { class: "acc-to" }, h("span", { text: "Hand over to" }), toSel),
        h("div", { class: "acc-warn", text: `${p.name} loses access to everything in “${w?.name || "this workspace"}”. Their posts and messages stay.` }));
      oh.cb.onchange = () => toSel.disabled = !oh.cb.checked; toSel.disabled = !oh.cb.checked;
      collect = () => [...(og.cb.checked ? groupSteps(email, pl.groups, pl, me) : []), ...(oc.cb.checked ? chatSteps(email, otherChats) : []), ...(oh.cb.checked ? handSteps(email, pl, toSel.value) : [])];
    } else if (mode === "things") {
      const gs = pl.groups.map(g => ({ g, o: opt(`👥 ${g.name || "Untitled"}`, norm(g.owner || g.by) === email ? "They own it: ownership passes to you" : (g.moderators || []).map(norm).includes(email) ? "Moderator" : "Member") }));
      const cs = otherChats.map(c => ({ c, o: opt(`💬 ${c.kind === "group" ? c.name || "Group chat" : "#" + (c.name || "channel")}`, (c.admins || []).map(norm).includes(email) ? "Chat admin" : c.private ? "Private" : "") }));
      content.replaceChildren(...(gs.length || cs.length ? [
        gs.length ? h("div", { class: "menu-sec", text: "Workgroups" }) : null, ...gs.map(x => x.o.el),
        cs.length ? h("div", { class: "menu-sec", text: "Chats" }) : null, ...cs.map(x => x.o.el),
        h("div", { class: "acc-hint", text: "Removing someone from a workgroup also removes them from its chat. They stay in the workspace." })]
        : [h("div", { class: "acc-hint", text: `${p.name} isn't in any workgroups or group chats.` })]));
      collect = () => [...groupSteps(email, gs.filter(x => x.o.cb.checked).map(x => x.g), pl, me), ...chatSteps(email, cs.filter(x => x.o.cb.checked).map(x => x.c))];
    } else {
      const row = (ic, label, n) => n ? h("div", { class: "acc-sum-r" }, h("span", { text: ic }), h("span", { text: label }), h("b", { text: n })) : null;
      content.replaceChildren(workCount(pl) ? h("div", { class: "acc-sum" },
        row("✅", "Open tasks they're responsible for", pl.tasks.length), row("👀", "Open tasks they follow (they're taken off)", pl.tasksOther.length),
        row("💼", "CRM records they're responsible for", pl.crm.length), row("📅", "Events they organize", pl.events.length),
        row("🗓️", "Booking resources linked to them (unlinked)", pl.resources.length)) : h("div", { class: "acc-hint", text: `${p.name} has no open work to hand over.` }),
        h("div", { class: "acc-to" }, h("span", { text: "Hand over to" }), toSel));
      collect = () => handSteps(email, pl, toSel.value);
    }
    okBtn.disabled = mode !== "remove" && !collect().length;
    if (mode === "things") content.addEventListener("change", () => (okBtn.disabled = !collect().length));

    okBtn.onclick = async () => {
      const steps = collect(), to = toSel.value, handing = mode === "handover" || steps.some(s => /^(Task|CRM|Event|Booking)/.test(s.label));
      if (mode === "remove" && !(await UI.confirm(`Remove ${p.name} (${email}) from “${w?.name}”?`, "Remove"))) return;
      running = true; okBtn.disabled = cancel.disabled = true;
      body.querySelectorAll("input,select").forEach(x => (x.disabled = true));
      prog.hidden = false;
      const bar = prog.querySelector("i"), txt = prog.querySelector("small");
      let failed = 0;
      for (let i = 0; i < steps.length; i++) {
        bar.style.width = Math.round(i / steps.length * 100) + "%"; txt.textContent = `${i + 1} of ${steps.length} · ${steps[i].label}`;
        try { await steps[i].run(); } catch (e) { failed++; console.error(e); }
      }
      bar.style.width = "100%";
      if (handing) tellHeir(email, pl, to);
      if (mode === "remove") { txt.textContent = "Removing from the workspace…"; await Cloud.removeMember(email); }
      else UI.toast(failed ? `Done, but ${plural(failed, "change")} failed` : mode === "handover" ? `📦 ${p.name}'s work now belongs to ${nameOf(to)}` : `Removed ${p.name} from ${plural(steps.length, "place")}`);
      running = false; m.close();
    };
  }

  /* ---------- the "Manage" menu for one person ---------- */
  function manageItems(email, { profile = true } = {}) {
    email = norm(email);
    const items = [], me = email === meKey();
    if (profile && Apps.Company?.openProfile) items.push({ label: "Open profile", iconHtml: "👤", onClick: () => Apps.Company.openProfile(email) });
    if (canManage(email, "editProfile")) items.push({ label: me ? "Edit my profile" : "Edit details", iconHtml: "✏️", onClick: () => editDetails(email) });
    if (canManage(email, "reassign")) items.push({ sep: true }, { label: "Remove from groups and chats…", iconHtml: "👥", onClick: () => manageDialog(email, "things") }, { label: "Hand over work…", iconHtml: "📦", onClick: () => manageDialog(email, "handover") });
    if (canManage(email, "remove") && window.Cloud?.removeMember) items.push({ sep: true }, { label: "Remove from workspace…", icon: "trash", danger: true, onClick: () => manageDialog(email, "remove") });
    while (items[0]?.sep) items.shift();
    return items;
  }

  /* ---------- the "Members & levels" window ---------- */
  function capsTable() {
    const cols = ORDER.map(r => h("span", { class: "acc-cap-h" }, badge(r)));
    return h("details", { class: "acc-caps" }, h("summary", { text: "What each level can do" }),
      h("div", { class: "acc-caps-wrap" }, h("div", { class: "acc-caps-grid" }, h("span", { class: "acc-cap-l" }), ...cols,
        ...CAPS.flatMap(([label, vals]) => [h("span", { class: "acc-cap-l", text: label }), ...vals.map(v => h("span", { class: "acc-cap-v" + (v === N ? " no" : v === Y ? " yes" : ""), text: v }))]))),
      h("div", { class: "acc-legend" }, ...ORDER.map(r => h("div", null, badge(r), h("span", { text: ABOUT[r] })))));
  }

  function peopleTab() {
    const w = ws(), me = meKey();
    const members = [...new Set((w.members || []).map(norm))]
      .sort((a, b) => level(a) - level(b) || Data.person(a).name.localeCompare(Data.person(b).name));
    const wrap = h("div", { class: "acc-people" });

    if (canManage(null, "invite") && window.Cloud?.invite) {
      const inp = h("input", { class: "menu-input", type: "email", placeholder: "Invite by email address" });
      const go = h("button", { class: "btn primary", text: "Invite" });
      const send = async () => { const v = inp.value.trim(); if (!v) return; go.disabled = true; if (await Cloud.invite(v)) inp.value = ""; go.disabled = false; };
      go.onclick = send; inp.addEventListener("keydown", e => { if (e.key === "Enter") send(); });
      wrap.append(h("div", { class: "acc-invite" }, inp, go), h("div", { class: "acc-hint", text: `New people join as ${LABEL.member}.${isAdmin() ? " Change their level here once they've joined." : ""}` }));
    }

    const list = h("div", { class: "acc-list" });
    members.forEach((email, i) => {
      const p = Data.person(email), r = role(email), you = email === me, opts = levelsFor(email);
      let ctl;
      if (r === "owner") ctl = h("span", { class: "acc-locked", title: "The owner always has full access" }, badge("owner"), h("span", { class: "acc-lock", html: icon("lock") }));
      else if (!opts.length) ctl = h("span", { class: "acc-locked" }, badge(r));
      else {
        const sel = h("select", { class: "acc-select lv-" + r, "aria-label": `Level of ${p.name}` },
          ...ROLES.map(x => h("option", { value: x, selected: x === r, disabled: !opts.includes(x) }, LABEL[x])));
        sel.onchange = async () => { const v = sel.value; sel.blur(); if (!(await setRole(email, v))) sel.value = role(email); };
        ctl = sel;
      }
      const items = manageItems(email);
      list.append(h("div", { class: "acc-row", style: { animationDelay: Math.min(i, 16) * 22 + "ms" } },
        Apps.avatar(p, 34),
        h("div", { class: "acc-who" }, h("b", { text: p.name + (you ? " (you)" : "") }), h("small", { text: email })),
        ctl,
        items.length ? h("button", { class: "icon-btn xs acc-manage", title: "Manage", "aria-label": `Manage ${p.name}`, html: icon("dots"), onclick: e => UI.menu(e.currentTarget, items, { align: "end" }) }) : h("span", { class: "acc-rm-ph" })));
    });
    wrap.append(list, capsTable());
    if (!isAdmin()) wrap.append(h("div", { class: "acc-hint", text: `You're ${LABEL[role()]}. Only the owner and admins change levels and remove people.` }));
    return wrap;
  }

  function permsTab() {
    const admin = isAdmin(), w = ws();
    const pair = r => h("span", { class: "acc-col2" }, h("b", { text: r === "manager" ? "Manager" : r === "member" ? "Member" : "Guest" }), h("span", null, h("small", { text: "View" }), h("small", { text: "Edit" })));
    const head = h("div", { class: "acc-gr acc-gh" }, h("span", { class: "acc-area", text: "App" }), h("span", { class: "acc-col", text: "Admin" }), pair("manager"), pair("member"), pair("guest"));
    const rows = areas().map(a => {
      const rl = rule(a.key), d = defaults(a.key), custom = !!(w.perms || {})[a.key] && J([rl.view, rl.edit]) !== J([d.view, d.edit]);
      const box = (r, lv) => h("label", { class: "acc-cb", title: `${LABEL[r]} can ${lv} ${a.title}` },
        h("input", { type: "checkbox", checked: rl[lv].includes(r), disabled: !admin, "aria-label": `${LABEL[r]} ${lv} ${a.title}`, onchange: e => toggle(a.key, r, lv, e.target.checked) }));
      return h("div", { class: "acc-gr" },
        h("span", { class: "acc-area" }, h("span", { class: "acc-ic", text: a.icon }), h("span", { class: "acc-an", text: a.title }), custom ? h("span", { class: "acc-custom", text: "Custom" }) : null),
        h("span", { class: "acc-col" }, h("span", { class: "acc-full", title: "Admins always have full access", html: "✓" })),
        ...["manager", "member", "guest"].map(r => h("span", { class: "acc-col2" }, h("span", null, box(r, "view"), box(r, "edit")))));
    });
    const anyCustom = Object.keys(w.perms || {}).length > 0;
    return h("div", { class: "acc-perms" },
      h("div", { class: "acc-hint", text: "View shows the app in the sidebar. Edit lets people change things in it; for Automation, Company & HR and workspace settings it means changing the setup." }),
      h("div", { class: "acc-grid-wrap" }, h("div", { class: "acc-grid" }, head, ...rows)),
      h("div", { class: "acc-foot" },
        h("small", { text: admin ? "Permissions hide apps inside Lumen. They don't yet lock the underlying data for members." : "Only the owner and admins can change permissions." }),
        admin ? h("button", { class: "btn", text: "Reset to defaults", disabled: !anyCustom, onclick: resetPerms }) : null));
  }

  /* ---------- owner tools: transfer ownership, export, delete ---------- */
  const plain = v => v && typeof v === "object" ? (typeof v.toDate === "function" ? v.toDate().toISOString() : Array.isArray(v) ? v.map(plain) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]))) : v;
  const stamp = () => new Date().toISOString().slice(0, 10);
  const fileBase = () => "lumen-" + String(ws()?.name || "workspace").toLowerCase().replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  function wsInfo() {
    const w = ws() || {};
    return plain({ id: w.id, name: w.name, icon: w.icon || "", owner: w.owner, ownerEmail: w.ownerEmail || "", members: w.members || [], roles: w.roles || {}, perms: w.perms || {}, root: w.root || [] });
  }
  async function exportJSON(status) {
    if (level() !== 0) return UI.toast("Only the owner can export the workspace");
    const out = { app: "Lumen", exportedAt: new Date().toISOString(), exportedBy: meKey(), workspace: wsInfo(), collections: {} };
    let n = 0;
    for (const col of Data.COLS) {
      status(`Reading ${col}… (${++n} of ${Data.COLS.length})`);
      try { out.collections[col] = (await fetchAll(col)).map(plain); } catch (e) { console.warn(col, e); out.collections[col] = { error: e.code || e.message }; }
    }
    download(`${fileBase()}-${stamp()}.json`, JSON.stringify(out, null, 2), "application/json");
    const docs = Object.values(out.collections).reduce((a, x) => a + (Array.isArray(x) ? x.length : 0), 0);
    status(`Downloaded ${plural(docs, "record")} from ${Data.COLS.length} collections.`);
  }
  async function exportCSV(col, status) {
    if (level() !== 0) return UI.toast("Only the owner can export the workspace");
    status(`Reading ${col}…`);
    let rows;
    try { rows = (await fetchAll(col)).map(plain); } catch (e) { return status("Couldn't read " + col + ": " + (e.code || e.message)); }
    const keys = [...new Set(["id", ...rows.flatMap(r => Object.keys(r))])].slice(0, 80);
    const cell = v => { v = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); return /[",\n\r;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    download(`${fileBase()}-${col}-${stamp()}.csv`, "﻿" + [keys.join(","), ...rows.map(r => keys.map(k => cell(r[k])).join(","))].join("\r\n"), "text/csv;charset=utf-8");
    status(`Downloaded ${plural(rows.length, "row")} from ${col}.`);
  }

  function ownerTab() {
    const w = ws(), me = meKey(), wrap = h("div", { class: "acc-owner" });
    // transfer ownership
    const pend = norm(w.pendingOwner);
    const tr = h("section", { class: "acc-card" }, h("h4", { text: "👑 Transfer ownership" }));
    if (pend) {
      const online = (window.Cloud?.people || []).some(x => norm(x.email) === pend && x.at && Date.now() - (x.at.toMillis?.() || 0) < 70000);
      tr.append(h("p", { class: "acc-hint", text: `Waiting for ${nameOf(pend)} (${pend}) to open the workspace. Ownership passes to them automatically and you become ${LABEL.admin}.${online ? " They're online, so it takes a few seconds." : " They need to open the workspace once."}` }),
        h("button", { class: "btn", text: "Cancel transfer", onclick: async () => { try { await Cloud.cancelTransfer(); UI.toast("Transfer cancelled"); } catch (e) { UI.toast("Couldn't cancel: " + (e.code || e.message)); } } }));
    } else {
      const admins = (w.members || []).map(norm).filter(k => k !== me && role(k) === "admin");
      if (!admins.length) tr.append(h("p", { class: "acc-hint", text: `Only an admin can become the owner. Make someone ${LABEL.admin} in the People tab first.` }));
      else {
        const sel = h("select", { class: "acc-select" }, ...admins.map(k => h("option", { value: k }, `${nameOf(k)} · ${k}`)));
        tr.append(h("p", { class: "acc-hint", text: `The new owner gets every right, including deleting the workspace. You become ${LABEL.admin}.` }),
          h("div", { class: "acc-to" }, sel, h("button", { class: "btn primary", text: "Transfer…", onclick: async () => {
            const k = sel.value; if (!k) return;
            if (!(await UI.confirm(`Make ${nameOf(k)} (${k}) the owner of “${w.name}”? You become ${LABEL.admin} and can't undo this yourself.`, "Transfer ownership"))) return;
            try { await Cloud.transferOwnership(k); UI.toast(`👑 Ownership goes to ${nameOf(k)} as soon as they open the workspace`); }
            catch (e) { UI.toast("Couldn't transfer: " + (e.code || e.message)); }
          } })));
      }
    }
    // export
    const status = h("small", { class: "acc-status" });
    const say = t => (status.textContent = t);
    const ex = h("section", { class: "acc-card" }, h("h4", { text: "⬇️ Export workspace data" }),
      h("p", { class: "acc-hint", text: "One JSON file with every app's records plus the workspace settings, or a CSV of one collection for spreadsheets." }),
      h("div", { class: "acc-to" },
        h("button", { class: "btn primary", text: "Download everything (JSON)", onclick: async e => { const b = e.currentTarget; b.disabled = true; try { await exportJSON(say); } finally { b.disabled = false; } } }),
        h("button", { class: "btn", text: "One collection (CSV)…", onclick: e => UI.menu(e.currentTarget, [{ section: "Collection" }, ...Data.COLS.map(c => ({ label: c, onClick: () => exportCSV(c, say) }))], { align: "start" }) })),
      status);
    // delete
    const del = h("section", { class: "acc-card danger" }, h("h4", { text: "Delete workspace" }),
      h("p", { class: "acc-hint", text: "Permanently deletes the workspace for every member. Export first if you want a copy." }),
      h("button", { class: "btn danger", text: "Delete workspace…", disabled: !window.Cloud?.deleteWorkspace, onclick: () => { UI.closePops(); Cloud.deleteWorkspace(); } }));
    wrap.append(tr, ex, del);
    return wrap;
  }

  function open(tab = "people") {
    if (!window.Cloud?.user || !window.Cloud?.ws) {
      return UI.toast("Levels work in shared workspaces. Create one and invite your team first.");
    }
    let cur = tab === "perms" || tab === "permissions" ? "perms" : tab === "owner" ? "owner" : "people";
    const content = h("div", { class: "acc-content" });
    const sub = h("div", { class: "acc-sub" });
    const tabsBox = h("div");
    const draw = () => {
      if (!shared()) return m.close();
      if (cur === "owner" && level() !== 0) cur = "people";
      sub.replaceChildren(h("span", { text: `👥 ${ws().name}` }), h("span", { text: "·" }), h("span", { text: "You're " }), badge(role()));
      tabsBox.replaceChildren(Apps.tabs([["people", "People"], ["perms", "Permissions"], ...(level() === 0 ? [["owner", "Owner tools"]] : [])], cur, k => { cur = k; draw(); }));
      content.replaceChildren(cur === "people" ? peopleTab() : cur === "owner" ? ownerTab() : permsTab());
    };
    const redraw = UI.liveDraw(content, draw);
    const m = UI.modal("Members & levels", h("div", { class: "acc" }, sub, tabsBox, content),
      { className: "acc-modal", onClose: () => Apps.onAccess.delete(redraw) });
    Apps.onAccess.add(redraw);
    draw();
    return m;
  }

  Object.assign(Apps, { role, level, isAdmin, isManager, canManage, can });
  Apps.Access = { open, denied, badge, label: r => LABEL[r] || r, LABEL, areas, defaults, rule, changed, canManageMembers, admins: adminKeys, ownerKey, shared,
    levelsFor, manageItems, manageDialog, editDetails, remove: email => manageDialog(email, "remove"), exportJSON, ROLES, GUEST_APPS };
})();
