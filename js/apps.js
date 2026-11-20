/* Apps shell: registry + routing (#/app/<name>), sidebar section, notifications, shared UI helpers */
(function () {
  const { h, icon, esc } = UI;
  const reg = {}, order = [];
  let cleanup = null, current = null;
  const Apps = { reg };

  Apps.register = (name, def) => { reg[name] = def; order.push(name); };
  Apps.go = (name, arg) => { location.hash = "#/app/" + name + (arg ? "/" + encodeURIComponent(arg) : ""); };
  const closeSliders = () => document.querySelectorAll("#layer .slider").forEach(el => el.remove());
  Apps.render = (name, arg) => {
    const v = document.getElementById("view");
    closeSliders();
    if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
    current = name;
    v.innerHTML = "";
    const def = reg[name];
    if (!def) { v.append(h("div", { class: "big-empty" }, h("div", { text: "🧩" }), "Unknown app")); return; }
    const root = h("div", { class: "app app-" + name });
    v.append(root);
    v.classList.remove("enter"); void v.offsetWidth; v.classList.add("enter");
    cleanup = def.render(root, arg ? decodeURIComponent(arg) : "") || null;
    const banner = soloBanner(); if (banner) root.prepend(banner);
    document.title = def.title + " · Lumen";
    renderNav();
  };
  Apps.leave = () => { closeSliders(); if (cleanup) { try { cleanup(); } catch {} cleanup = null; } current = null; renderNav(); };
  Apps.current = () => current;

  /* Posts, chats and tasks only reach people in the same workspace: say so when nobody else is here. */
  function soloBanner() {
    const ws = window.Cloud?.ws;
    if (ws && (ws.members || []).length > 1) return null;
    const btn = h("button", { class: "btn primary" });
    let text;
    if (ws) {
      text = `👥 Only you are in “${ws.name}”, so nobody else sees what you post here. Invite teammates by email to work together.`;
      btn.textContent = "Invite people"; btn.onclick = () => Cloud.share(btn);
    } else {
      text = window.Cloud?.workspaces?.length
        ? "💻 You're in your private workspace on this device. Switch to a shared workspace to see your team's posts, chats and tasks."
        : "💻 You're in your private workspace on this device. Create a shared workspace and invite people to collaborate.";
      btn.textContent = window.Cloud?.workspaces?.length ? "Switch workspace" : "Share with friends";
      btn.onclick = () => window.Cloud?.workspaces?.length ? document.getElementById("wsSwitch").click() : window.Cloud?.share(btn);
    }
    return h("div", { class: "app-banner glass" }, h("span", { text }), btn);
  }

  /* ---------- sidebar section ---------- */
  const badges = {};
  Apps.badge = (name, n) => { badges[name] = n; const el = document.querySelector(`.app-nav [data-app="${name}"] .count`); if (el) el.textContent = n ? n : ""; };
  function renderNav() {
    let box = document.getElementById("appNav");
    if (!box) {
      const sec = h("div", { class: "sb-section" }, h("div", { class: "sb-label", text: "Apps" }), box = h("div", { class: "tree app-nav", id: "appNav" }));
      document.querySelector(".sb-scroll").prepend(sec);
    }
    box.innerHTML = "";
    order.forEach(n => {
      const d = reg[n];
      box.append(h("div", { class: "tree-row" + (current === n ? " active" : ""), dataset: { app: n }, onclick: () => { Apps.go(n); if (innerWidth < 760) App.toggleSidebar(false); } },
        h("span", { class: "p-icon", text: d.icon }), h("span", { class: "p-title", text: d.title }), h("span", { class: "count", text: badges[n] || "" })));
    });
  }
  Apps.renderNav = renderNav;

  /* ---------- notifications bell ---------- */
  function initBell() {
    const bell = h("button", { class: "icon-btn bell", id: "bellBtn", title: "Notifications", html: `<svg class="ico" viewBox="0 0 24 24"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg><span class="dot"></span>` });
    document.querySelector(".tb-right").prepend(bell);
    let mine = [];
    let unsub = null;
    const watch = () => {
      unsub && unsub();
      unsub = Data.on("notifications", all => {
        const me = Data.me().key;
        mine = all.filter(n => n.to === me).sort((a, b) => b.at - a.at);
        const unread = mine.filter(n => !n.read).length;
        bell.querySelector(".dot").textContent = unread > 9 ? "9+" : unread || "";
        bell.classList.toggle("has", unread > 0);
      });
    };
    Apps.rewatch = () => { watch(); Apps.onWorkspace.forEach(fn => fn()); };
    watch();
    bell.onclick = () => {
      const items = mine.slice(0, 20).map(n => h("button", { class: "mi notif" + (n.read ? "" : " unread"), onclick: () => { Data.update("notifications", n.id, { read: true }); UI.closePops(); if (n.link) location.hash = n.link; } },
        avatar(Data.person(n.by), 26), h("span", { class: "nt" }, h("span", { html: n.text }), h("small", { text: UI.timeAgo(n.at) }))));
      const box = h("div", { style: { width: "340px" } }, h("div", { class: "menu-sec", style: { display: "flex", justifyContent: "space-between" } }, "Notifications",
        mine.some(n => !n.read) ? h("a", { style: { cursor: "pointer", textTransform: "none", color: "var(--accent)" }, text: "Mark all read", onclick: () => { mine.filter(n => !n.read).forEach(n => Data.update("notifications", n.id, { read: true })); UI.closePops(); } }) : null),
        ...(items.length ? items : [h("div", { class: "menu-empty", text: "You're all caught up ✨" })]));
      UI.popover(bell, box, { align: "end" });
    };
  }
  Apps.onWorkspace = new Set();

  /* ---------- shared helpers ---------- */
  function avatar(p, size = 24) {
    p = p || {}; const s = size + "px";
    const el = h("span", { class: "avatar", title: p.name || "", style: { width: s, height: s, fontSize: Math.round(size * .42) + "px" } });
    if (window.Avatars?.has(p.avatar)) { el.innerHTML = Avatars.svg(p.avatar); el.firstChild.setAttribute("width", size); el.firstChild.setAttribute("height", size); el.classList.add("preset"); }
    else if (p.photo && p.avatar !== "letter") el.append(h("img", { src: p.photo, alt: "", referrerpolicy: "no-referrer" }));
    else { el.textContent = (p.name || "?").trim()[0]?.toUpperCase() || "?"; el.style.background = colorFor(p.key || p.name || "?"); }
    if (p.online) el.classList.add("online");
    return el;
  }
  const PALETTE = ["#7c5cff", "#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6"];
  function colorFor(s) { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[x % PALETTE.length]; }

  function personPicker(anchor, onPick, opts = {}) {
    const inp = h("input", { class: "menu-input", placeholder: "Search people…" }), list = h("div");
    const draw = () => {
      list.innerHTML = ""; const q = inp.value.toLowerCase();
      if (opts.allowNone) list.append(h("button", { class: "mi compact", onclick: () => { api.close(); onPick(null); } }, h("span", { class: "mi-ic", text: "∅" }), "Nobody"));
      Data.people().filter(p => (p.name + p.email).toLowerCase().includes(q)).forEach(p => list.append(h("button", { class: "mi compact", onclick: () => { api.close(); onPick(p); } },
        avatar(p, 22), h("span", { class: "mi-t", text: p.name + (p.key === Data.me().key ? " (you)" : "") }), h("span", { class: "mi-k", text: p.title || "" }))));
    };
    inp.addEventListener("input", draw); draw();
    const api = UI.popover(anchor, h("div", { style: { width: "260px" } }, inp, list));
    setTimeout(() => inp.focus(), 30);
  }

  /* form modal: fields = [{ key, label, type: text|textarea|select|date|time|number|person|color|checkbox, options, placeholder }] */
  function form(title, fields, values = {}, opts = {}) {
    return new Promise(resolve => {
      const v = { ...values }; let done = false;
      const rows = fields.map(f => {
        let ctl;
        if (f.type === "textarea") { ctl = h("textarea", { class: "menu-input f-ta", rows: f.rows || 4, placeholder: f.placeholder || "" }); ctl.value = v[f.key] || ""; ctl.oninput = () => (v[f.key] = ctl.value); }
        else if (f.type === "select") {
          const first = Array.isArray(f.options[0]) ? f.options[0][0] : f.options[0];
          ctl = h("select", { class: "menu-input" }, ...f.options.map(o => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return h("option", { value: val, selected: String(v[f.key] ?? first) === String(val) }, lab); }));
          if (v[f.key] == null) v[f.key] = ctl.value; ctl.onchange = () => (v[f.key] = ctl.value);
        }
        else if (f.type === "person") {
          ctl = h("button", { class: "menu-input f-person", type: "button" });
          const paint = () => { ctl.innerHTML = ""; const p = v[f.key] ? Data.person(v[f.key]) : null; ctl.append(p ? avatar(p, 20) : "", h("span", { text: p ? p.name : "Choose someone…" })); };
          ctl.onclick = () => personPicker(ctl, p => { v[f.key] = p ? p.key : ""; paint(); }, { allowNone: true }); paint();
        }
        else if (f.type === "color") { ctl = h("div", { class: "accents" }, ...PALETTE.map(c => h("button", { type: "button", class: v[f.key] === c ? "on" : "", style: { background: c, color: c }, onclick: e => { v[f.key] = c; ctl.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.currentTarget)); } }))); if (!v[f.key]) v[f.key] = PALETTE[0], ctl.firstChild.classList.add("on"); }
        else if (f.type === "avatar") {
          const opts = [...(f.photo ? [["", "Google photo"]] : []), ["letter", "Initial"], ...Avatars.PRESETS.map(a => [a.id, a.name])];
          if (v[f.key] == null) v[f.key] = "";
          ctl = h("div", { class: "av-grid" }, ...opts.map(([id, label]) => {
            const b = h("button", { type: "button", class: "av-opt" + ((v[f.key] || "") === id ? " on" : ""), title: label, onclick: () => { v[f.key] = id; ctl.querySelectorAll(".av-opt").forEach(x => x.classList.toggle("on", x === b)); } },
              avatar({ ...(f.person || {}), avatar: id, photo: id === "" ? f.photo : "" }, 44), h("small", { text: label }));
            return b;
          }));
        }
        else if (f.type === "checkbox") { ctl = h("input", { type: "checkbox", checked: !!v[f.key] }); ctl.onchange = () => (v[f.key] = ctl.checked); }
        else { ctl = h("input", { class: "menu-input", type: f.type || "text", placeholder: f.placeholder || "", value: v[f.key] ?? "" }); ctl.oninput = () => (v[f.key] = f.type === "number" ? (ctl.value === "" ? "" : +ctl.value) : ctl.value); }
        return h("label", { class: "f-row" + (f.half ? " half" : "") }, h("span", { text: f.label }), ctl);
      });
      const save = h("button", { class: "btn primary", text: opts.ok || "Save" });
      const m = UI.modal(title, h("form", { class: "f-grid", onsubmit: e => { e.preventDefault(); save.click(); } }, ...rows,
        h("div", { class: "f-actions" }, opts.onDelete ? h("button", { type: "button", class: "btn danger", text: "Delete", onclick: async () => { if (await UI.confirm("Delete this permanently?")) { done = true; m.close(); opts.onDelete(); resolve(null); } } }) : h("span"),
          h("span", { style: { display: "flex", gap: "8px" } }, h("button", { type: "button", class: "btn", text: "Cancel", onclick: () => m.close() }), save))), { onClose: () => !done && resolve(null) });
      save.onclick = () => {
        const miss = fields.find(f => f.required && !String(v[f.key] ?? "").trim());
        if (miss) return UI.toast(`${miss.label} is required`);
        done = true; m.close(); resolve(v);
      };
      m.el.style.width = (opts.width || 520) + "px";
      setTimeout(() => m.el.querySelector("input:not([type=checkbox]),textarea")?.focus(), 60);
    });
  }

  /* side panel (Bitrix-style slider) */
  function panel(title, body, actions = []) {
    UI.closePops();
    const el = h("div", { class: "peek glass-strong slider" },
      h("div", { class: "peek-top" }, h("div", { class: "slider-title", text: title }), ...actions, h("button", { class: "icon-btn", title: "Close", html: icon("x"), onclick: () => api.close() })),
      h("div", { class: "peek-body" }, body));
    const onKey = e => { if (e.key === "Escape" && !document.querySelector("#layer .pop, #layer .backdrop")) api.close(); };
    const onOut = e => { if (!el.contains(e.target) && !e.target.closest(".pop,.backdrop,.toast")) api.close(); };
    const api = { el, close() { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onOut, true); el.classList.add("closing"); setTimeout(() => el.remove(), 280); api.onClose?.(); } };
    document.addEventListener("keydown", onKey); setTimeout(() => document.addEventListener("mousedown", onOut, true));
    document.getElementById("layer").append(el);
    return api;
  }

  function header(title, iconTxt, sub, ...right) {
    return h("div", { class: "app-head" }, h("div", { class: "app-title" }, h("span", { class: "app-ic", text: iconTxt }), h("div", null, h("h1", { text: title }), sub ? h("div", { class: "app-sub", text: sub }) : null)), h("div", { class: "app-actions" }, ...right));
  }
  function tabs(items, active, onChange) {
    const el = h("div", { class: "app-tabs" });
    items.forEach(([k, l]) => el.append(h("button", { class: k === active ? "on" : "", text: l, onclick: e => { el.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.currentTarget)); onChange(k); } })));
    return el;
  }
  // dates are "YYYY-MM-DD" in the viewer's local time zone (toISOString would shift them to UTC)
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = () => iso(new Date());
  const addDays = (d, n) => { const x = new Date(d + "T00:00"); x.setDate(x.getDate() + n); return iso(x); };
  const fmtDate = d => d ? new Date(d + (d.length === 10 ? "T00:00" : "")).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
  const currency = () => localStorage.getItem("lumen-currency") || (Intl.DateTimeFormat().resolvedOptions().timeZone === "Asia/Calcutta" || Intl.DateTimeFormat().resolvedOptions().timeZone === "Asia/Kolkata" ? "INR" : "USD");
  const money = n => { try { return new Intl.NumberFormat(undefined, { style: "currency", currency: currency(), maximumFractionDigits: 0 }).format(+n || 0); } catch { return (+n || 0).toLocaleString(); } };
  const empty = (ic, text, btn) => h("div", { class: "app-empty" }, h("div", { class: "ae-ic", text: ic }), h("div", { text }), btn || null);

  async function chooseAvatar() {
    const me = Data.me();
    const v = await form("Choose your avatar", [{ key: "avatar", label: "Shown next to your name in chat, comments, tasks and the team directory", type: "avatar", photo: me.photo, person: me }], { avatar: me.avatar || "" }, { ok: "Use this avatar", width: 560 });
    if (v) { Data.setAvatar(v.avatar); UI.toast("✨ Avatar updated"); }
  }

  Object.assign(Apps, { chooseAvatar, avatar, colorFor, personPicker, form, panel, header, tabs, iso, today, addDays, fmtDate, money, currency, empty });

  Apps.init = () => { renderNav(); initBell(); };
  window.Apps = Apps;
})();
