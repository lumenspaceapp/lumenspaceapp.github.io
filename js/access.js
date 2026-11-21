/* Access roles and permissions (Bitrix24 "Access permissions").
   Roles: owner (created the workspace, always full rights), admin, member (default), guest.
   Stored on the workspace doc (window.Cloud.ws):  roles: { email: "admin"|"member"|"guest" },  perms: { area: { view: [roles], edit: [roles] } }.
   API for every app:  Apps.role(key?), Apps.isAdmin(key?), Apps.can(area, level = "view"|"edit"|"admin"), Apps.onAccess (Set of callbacks),
   Apps.Access.open() opens the "Access & roles" window.
   Note: permissions hide areas inside the app; Firestore still lets every member read and write app collections (no data-level enforcement yet). */
(function () {
  const { h, icon } = UI;
  const ROLES = ["admin", "member", "guest"];
  const LABEL = { owner: "Owner", admin: "Admin", member: "Member", guest: "Guest" };
  const ABOUT = {
    owner: "Created the workspace. Always has full access; this can't be changed.",
    admin: "Full access to every app. Manages people, roles and permissions.",
    member: "Uses the apps that members are allowed to see.",
    guest: "Only sees the apps allowed for guests: by default Home, Tasks, Chat, Workgroups, Calendar and Drive.",
  };
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
  // roles only apply in a shared workspace while signed in; the private (local) workspace is all yours
  const shared = () => !!(ws() && window.Cloud?.user);
  const meKey = () => norm(window.Data ? Data.me().key : "me");

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
  const isAdmin = key => { const r = role(key); return r === "owner" || r === "admin"; };

  /* ---------- permissions ---------- */
  function defaults(area) {
    const view = ["admin", "member"];
    if (GUEST_APPS.includes(area)) view.push("guest");
    return { view, edit: ADMIN_EDIT.includes(area) ? ["admin"] : [...view] };
  }
  // stored rule for an area, falling back to the defaults per level (old workspaces have no perms at all)
  function rule(area) {
    const d = defaults(area), p = (ws()?.perms || {})[area] || {};
    return { view: Array.isArray(p.view) ? p.view : d.view, edit: Array.isArray(p.edit) ? p.edit : d.edit };
  }
  function can(area, level = "view") {
    if (!shared()) return true;
    const r = role();
    if (r === "owner") return true;
    if (level === "admin") return r === "admin";
    if (r === "admin") return true; // admins always keep full access, so nobody can lock the workspace out of its own settings
    if (area === "home" && level === "view") return true;
    const p = rule(area);
    return level === "edit" ? p.view.includes(r) && p.edit.includes(r) : p.view.includes(r);
  }
  function areas() {
    const names = [...new Set([...Object.keys(Apps.reg), ...Object.keys(KNOWN)])].filter(n => n !== "home");
    return [...names.map(n => ({ key: n, title: Apps.reg[n]?.title || KNOWN[n]?.[0] || n, icon: Apps.reg[n]?.icon || KNOWN[n]?.[1] || "🧩" })), SETTINGS];
  }
  // only the owner, or an admin once the owner's email is known (the rules need it to keep the owner in), may add or remove people
  const canManageMembers = () => shared() && (role() === "owner" || (role() === "admin" && !!ws().ownerEmail));
  const adminKeys = () => (ws()?.members || []).map(norm).filter(m => isAdmin(m));

  /* ---------- change notifications ---------- */
  Apps.onAccess = new Set();
  let sig = null, switching = false;
  const signature = () => { const w = ws(); return shared() ? J([w.id, window.Cloud.user.email, w.owner, w.ownerEmail || "", w.members || [], w.roles || {}, w.perms || {}]) : "local"; };
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
  const badge = r => h("span", { class: "acc-badge r-" + r, text: LABEL[r] || r });

  // shown instead of an app you can't open
  function denied(def) {
    const ad = adminKeys().filter(k => k !== meKey()).slice(0, 4);
    return h("div", { class: "acc-denied" },
      h("div", { class: "acc-denied-card glass" },
        h("div", { class: "acc-denied-ic" }, h("span", { text: def?.icon || "🔒" }), h("span", { class: "acc-lock", html: icon("lock") })),
        h("h2", { text: `You don't have access to ${def?.title || "this app"}` }),
        h("p", { text: "Ask an admin to give your role access to it." }),
        ad.length ? h("div", { class: "acc-denied-admins" }, h("small", { text: ad.length === 1 ? "Admin" : "Admins" }),
          ...ad.map(k => { const p = Data.person(k); return h("span", { class: "who", title: k }, Apps.avatar(p, 22), h("span", { text: p.name })); })) : null,
        h("button", { class: "btn primary", text: "Go home", onclick: () => App.go("home") })));
  }

  /* ---------- saving (optimistic, written to the workspace doc by cloud.js) ---------- */
  async function setRole(email, next) {
    const w = ws(); if (!w || !isAdmin() || !window.Cloud?.access) return;
    const before = role(email); if (before === next || before === "owner") return;
    if (email === meKey() && before === "admin" && next !== "admin") {
      if (adminKeys().length <= 1) { UI.toast("You're the last admin. Make someone else an admin first."); return false; }
      if (!(await UI.confirm("You'll stop being an admin and won't be able to change roles or permissions anymore.", "Change my role"))) return false;
    }
    const had = Object.prototype.hasOwnProperty.call(w.roles || {}, email), prev = (w.roles || {})[email];
    w.roles = { ...(w.roles || {}), [email]: next }; changed();
    try { await Cloud.access.setRole(email, next); UI.toast(`${Data.person(email).name} is now ${next === "admin" ? "an admin" : "a " + LABEL[next].toLowerCase()}`); return true; }
    catch (e) {
      const r = { ...(ws()?.roles || {}) }; if (had) r[email] = prev; else delete r[email];
      if (ws()) ws().roles = r; changed();
      UI.toast(e.code === "permission-denied" ? "Only the owner and admins can change roles. Publish the latest firestore.rules." : "Couldn't change the role: " + (e.code || e.message));
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
  function toggle(area, r, level, on) {
    const cur = rule(area), next = { view: [...cur.view], edit: [...cur.edit] };
    const set = (lv, v) => { const s = new Set(next[lv]); v ? s.add(r) : s.delete(r); s.add("admin"); next[lv] = ROLES.filter(x => s.has(x)); };
    set(level, on);
    if (level === "edit" && on) set("view", true);
    if (level === "view" && !on) set("edit", false);
    savePerm(area, next);
  }

  /* ---------- the "Access & roles" window ---------- */
  function peopleTab() {
    const w = ws(), admin = isAdmin(), me = meKey(), owner = ownerKey();
    const rank = { owner: 0, admin: 1, member: 2, guest: 3 };
    const members = [...new Set((w.members || []).map(norm))]
      .sort((a, b) => rank[role(a)] - rank[role(b)] || Data.person(a).name.localeCompare(Data.person(b).name));
    const wrap = h("div", { class: "acc-people" });

    if (canManageMembers() && window.Cloud?.invite) {
      const inp = h("input", { class: "menu-input", type: "email", placeholder: "Invite by email address" });
      const go = h("button", { class: "btn primary", text: "Invite" });
      const send = async () => { const v = inp.value.trim(); if (!v) return; go.disabled = true; if (await Cloud.invite(v)) inp.value = ""; go.disabled = false; };
      go.onclick = send; inp.addEventListener("keydown", e => { if (e.key === "Enter") send(); });
      wrap.append(h("div", { class: "acc-invite" }, inp, go), h("div", { class: "acc-hint", text: "New people join as members. Change their role here once they've joined." }));
    }

    const list = h("div", { class: "acc-list" });
    members.forEach(email => {
      const p = Data.person(email), r = role(email), you = email === me;
      let ctl;
      if (r === "owner") ctl = h("span", { class: "acc-locked", title: "The owner always has full access" }, badge("owner"), h("span", { class: "acc-lock", html: icon("lock") }));
      else if (!admin) ctl = badge(r);
      else {
        const last = you && r === "admin" && adminKeys().length <= 1;
        const sel = h("select", { class: "acc-select", "aria-label": `Role of ${p.name}`, title: last ? "You're the last admin" : "" },
          ...ROLES.map(x => h("option", { value: x, selected: x === r, disabled: last && x !== "admin" }, LABEL[x])));
        sel.onchange = async () => { const v = sel.value; sel.blur(); if (!(await setRole(email, v))) sel.value = role(email); };
        ctl = sel;
      }
      const canRemove = canManageMembers() && window.Cloud?.removeMember && r !== "owner" && !you && email !== owner;
      list.append(h("div", { class: "acc-row" },
        Apps.avatar(p, 34),
        h("div", { class: "acc-who" }, h("b", { text: p.name + (you ? " (you)" : "") }), h("small", { text: email })),
        ctl,
        canRemove ? h("button", { class: "icon-btn xs acc-rm", title: "Remove from workspace", "aria-label": `Remove ${p.name}`, html: icon("x"), onclick: async () => {
          if (await UI.confirm(`Remove ${p.name} (${email}) from “${w.name}”? They lose access to everything in it.`, "Remove")) await Cloud.removeMember(email);
        } }) : h("span", { class: "acc-rm-ph" })));
    });
    wrap.append(list);
    wrap.append(h("div", { class: "acc-legend" }, ...["owner", "admin", "member", "guest"].map(r => h("div", null, badge(r), h("span", { text: ABOUT[r] })))));
    if (!admin) wrap.append(h("div", { class: "acc-hint", text: `Your role is ${LABEL[role()].toLowerCase()}. Only the owner and admins can change roles.` }));
    return wrap;
  }

  function permsTab() {
    const admin = isAdmin(), w = ws();
    const head = h("div", { class: "acc-gr acc-gh" },
      h("span", { class: "acc-area", text: "App" }),
      h("span", { class: "acc-col", text: "Admin" }),
      h("span", { class: "acc-col2" }, h("b", { text: "Member" }), h("span", null, h("small", { text: "View" }), h("small", { text: "Edit" }))),
      h("span", { class: "acc-col2" }, h("b", { text: "Guest" }), h("span", null, h("small", { text: "View" }), h("small", { text: "Edit" }))));
    const rows = areas().map(a => {
      const rl = rule(a.key), custom = !!(w.perms || {})[a.key] && J(rl) !== J(defaults(a.key));
      const box = (r, lv) => h("label", { class: "acc-cb", title: `${LABEL[r]}s can ${lv} ${a.title}` },
        h("input", { type: "checkbox", checked: rl[lv].includes(r), disabled: !admin, "aria-label": `${LABEL[r]} ${lv} ${a.title}`, onchange: e => toggle(a.key, r, lv, e.target.checked) }));
      return h("div", { class: "acc-gr" },
        h("span", { class: "acc-area" }, h("span", { class: "acc-ic", text: a.icon }), h("span", { class: "acc-an", text: a.title }), custom ? h("span", { class: "acc-custom", text: "Custom" }) : null),
        h("span", { class: "acc-col" }, h("span", { class: "acc-full", title: "Admins always have full access", html: "✓" })),
        h("span", { class: "acc-col2" }, h("span", null, box("member", "view"), box("member", "edit"))),
        h("span", { class: "acc-col2" }, h("span", null, box("guest", "view"), box("guest", "edit"))));
    });
    const anyCustom = Object.keys(w.perms || {}).length > 0;
    return h("div", { class: "acc-perms" },
      h("div", { class: "acc-hint", text: "View shows the app in the sidebar. Edit lets people change things in it; for Automation, Company & HR and workspace settings it means changing the setup." }),
      h("div", { class: "acc-grid-wrap" }, h("div", { class: "acc-grid" }, head, ...rows)),
      h("div", { class: "acc-foot" },
        h("small", { text: "Permissions hide apps inside Lumen. They don't yet lock the underlying data for members." }),
        admin ? h("button", { class: "btn", text: "Reset to defaults", disabled: !anyCustom, onclick: resetPerms }) : null));
  }

  function open(tab = "people") {
    if (!window.Cloud?.user || !window.Cloud?.ws) {
      return UI.toast("Roles work in shared workspaces. Create one and invite your team first.");
    }
    let cur = tab === "perms" || tab === "permissions" ? "perms" : "people";
    const content = h("div", { class: "acc-content" });
    const sub = h("div", { class: "acc-sub" });
    const draw = () => {
      if (!shared()) return m.close();
      sub.replaceChildren(h("span", { text: `👥 ${ws().name}` }), h("span", { text: "·" }), h("span", { text: "You're " }), badge(role()));
      content.replaceChildren(cur === "people" ? peopleTab() : permsTab());
    };
    const redraw = UI.liveDraw(content, draw);
    const m = UI.modal("Access & roles", h("div", { class: "acc" }, sub,
      Apps.tabs([["people", "People"], ["perms", "Permissions"]], cur, k => { cur = k; draw(); }), content),
      { className: "acc-modal", onClose: () => Apps.onAccess.delete(redraw) });
    Apps.onAccess.add(redraw);
    draw();
    return m;
  }

  Object.assign(Apps, { role, isAdmin, can });
  Apps.Access = { open, denied, badge, label: r => LABEL[r] || r, areas, defaults, rule, changed, canManageMembers, admins: adminKeys, ownerKey, ROLES, GUEST_APPS };
})();
