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
    current = name; document.body.dataset.app = name;
    v.innerHTML = "";
    const def = reg[name];
    if (!def) { v.append(h("div", { class: "big-empty" }, h("div", { text: "🧩" }), "Unknown app")); return; }
    // access roles (js/access.js): apps my role can't view show a friendly notice instead
    if (name !== "home" && Apps.can && !Apps.can(name, "view")) {
      v.append(Apps.Access?.denied ? Apps.Access.denied(def) : h("div", { class: "big-empty acc-denied" }, h("div", { text: "🔒" }), `You don't have access to ${def.title}. Ask an admin.`));
      document.title = def.title + " · Lumen"; renderNav(); return;
    }
    const root = h("div", { class: "app app-" + name });
    v.append(root);
    v.classList.remove("enter"); void v.offsetWidth; v.classList.add("enter");
    cleanup = def.render(root, arg ? decodeURIComponent(arg) : "") || null;
    const banner = def.noBanner ? null : soloBanner(); if (banner) root.prepend(banner);
    document.title = def.title + " · Lumen";
    renderNav();
  };
  Apps.leave = () => { closeSliders(); delete document.body.dataset.app; if (cleanup) { try { cleanup(); } catch {} cleanup = null; } current = null; renderNav(); };
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
      const d = reg[n]; if (d.hidden || (Apps.can && !Apps.can(n, "view"))) return; // hide apps my role can't view
      box.append(h("div", { class: "tree-row" + (current === n ? " active" : ""), dataset: { app: n }, onclick: () => { Apps.go(n); if (innerWidth < 760) App.toggleSidebar(false); } },
        h("span", { class: "p-icon", text: d.icon }), h("span", { class: "p-title", text: d.title }), h("span", { class: "count", text: badges[n] || "" })));
    });
  }
  Apps.renderNav = renderNav;

  /* ---------- notifications bell ---------- */
  function initBell() {
    const bell = h("button", { class: "icon-btn bell", id: "bellBtn", title: "Notifications", html: `<svg class="ico" viewBox="0 0 24 24"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg><span class="dot"></span>` });
    document.querySelector(".tb-right").prepend(bell);
    const readKey = () => "lumen-chat-read-" + (window.Cloud?.ws?.id || "local");
    const chatRead = () => { try { return JSON.parse(localStorage.getItem(readKey())) || {}; } catch { return {}; } };
    let mine = [], todo = [], box = null;

    /* things still waiting for you: they stay until you act (read the chat, finish the task) */
    function attention() {
      const me = Data.me().key, out = [], r = chatRead(), byCh = {};
      Data.list("chat").forEach(m => {
        if (m.by === me || !m.channel || (m.at || 0) <= (r[m.channel] || 0)) return;
        if (m.deleted || !canSeeChat(m.channel, me)) return;
        if (!m.channel.startsWith("dm:") && m.channel !== "general" && !Data.get("channels", m.channel)) return; // channel was deleted
        (byCh[m.channel] ||= []).push(m);
      });
      Object.entries(byCh).forEach(([ch, ms]) => {
        ms.sort((a, b) => b.at - a.at);
        const last = ms[0], who = Data.person(last.by), dm = ch.startsWith("dm:"), n = ms.length > 99 ? "99+" : ms.length, s = ms.length === 1 ? "" : "s";
        const chName = window.ChatAccess?.title ? ChatAccess.title(ch) : "#" + ((Data.list("channels").find(c => c.id === ch) || {}).name || ch);
        out.push({ kind: "chat", ch, at: last.at, person: who, title: dm ? `${n} unread message${s} from ${who.name}` : `${n} new message${s} in ${chName}`,
          sub: last.kind === "sys" ? String(last.text || "") : (dm ? "" : who.name + ": ") + (last.kind === "call" ? "📹 Video call" : String(last.text || "") || ((last.files || []).length ? "📎 " + last.files.map(f => f.name).join(", ") : "")), link: "#/app/chat/" + encodeURIComponent(ch) });
      });
      out.sort((a, b) => b.at - a.at);
      const day = today();
      liveTasks().filter(t => t.status !== "done" && t.status !== "review" && t.deadline && t.deadline <= day && isMyTask(t, me))
        .sort((a, b) => a.deadline.localeCompare(b.deadline))
        .forEach(t => out.push({ kind: "task", id: t.id, icon: t.deadline < day ? "⏰" : "✅", late: t.deadline < day, title: t.title || "Untitled task",
          sub: t.deadline < day ? "Overdue · was due " + fmtDate(t.deadline) : "Due today", link: "#/app/tasks/" + t.id }));
      return out;
    }
    function count() {
      todo = attention();
      const n = todo.length + mine.filter(x => !x.read).length;
      bell.querySelector(".dot").textContent = n > 9 ? "9+" : n || "";
      bell.classList.toggle("has", n > 0);
      bell.title = n ? `Notifications (${n})` : "Notifications";
      if (box?.isConnected) fill();
    }
    let offs = [];
    const watch = () => {
      offs.forEach(f => f());
      offs = [
        Data.on("notifications", all => { const me = Data.me().key; mine = all.filter(x => x.to === me).sort((a, b) => b.at - a.at); count(); }),
        Data.on("chat", count), Data.on("tasks", count), Data.on("channels", count), Data.on("feed", () => { if (box?.isConnected) fill(); }),
      ];
    };
    addEventListener("lumen-chat-read", count);
    addEventListener("storage", e => { if (e.key?.startsWith("lumen-chat-read-")) count(); }); // read in another tab
    setInterval(count, 60000); // a new day turns tasks "due today"
    Apps.rewatch = () => { watch(); Apps.onWorkspace.forEach(fn => fn()); };
    watch();

    function markAllRead() {
      mine.filter(x => !x.read).forEach(x => Data.update("notifications", x.id, { read: true }));
      const r = chatRead(); todo.filter(x => x.kind === "chat").forEach(x => { r[x.ch] = Date.now(); });
      try { localStorage.setItem(readKey(), JSON.stringify(r)); } catch {}
      dispatchEvent(new Event("lumen-chat-read"));
    }
    // older notifications have no preview saved: find the comment they were about
    function preview(n) {
      if (n.body) return n.body;
      if (!/commented on/.test(n.text || "")) return "";
      const near = c => c && c.by === n.by && Math.abs((c.at || 0) - (n.at || 0)) < 20000;
      const col = (n.link || "").startsWith("#/app/tasks/") ? Data.list("tasks").filter(t => "#/app/tasks/" + t.id === n.link) : Data.list("feed");
      for (const item of col) { const c = (item.comments || []).find(near); if (c) return c.text; }
      return "";
    }
    function fill() {
      const go = link => { UI.closePops(); if (link) location.hash = link; };
      const attn = todo.map(x => h("div", { class: "mi notif attn" + (x.late ? " late" : ""), role: "button", tabindex: 0, onclick: () => go(x.link), onkeydown: e => { if (e.key === "Enter") go(x.link); } },
        x.person ? avatar(x.person, 26) : h("span", { class: "nt-lead", text: x.icon }),
        h("span", { class: "nt" }, h("span", { class: "nt-t", text: x.title }), h("small", { text: x.sub })),
        x.kind === "task" ? h("button", { class: "nt-done", title: "Mark done", "aria-label": "Mark task done", html: "✓", onclick: e => { e.stopPropagation(); const tk = Data.get("tasks", x.id); if (tk && Apps.Tasks?.setStatus) Apps.Tasks.setStatus(tk, "done"); else Data.update("tasks", x.id, { status: "done", completedAt: Date.now() }); UI.toast("✅ Task done"); } }) : null));
      const recent = mine.slice(0, 20).map(n => h("button", { class: "mi notif" + (n.read ? "" : " unread"), onclick: () => { Data.update("notifications", n.id, { read: true }); go(n.link); } },
        avatar(Data.person(n.by), 26), h("span", { class: "nt" }, h("span", { html: n.text }), preview(n) ? h("span", { class: "nt-body", text: preview(n) }) : null, h("small", { text: UI.timeAgo(n.at) }))));
      const anyUnread = mine.some(n => !n.read) || todo.some(x => x.kind === "chat");
      box.replaceChildren(
        h("div", { class: "menu-sec", style: { display: "flex", justifyContent: "space-between" } }, "Notifications",
          anyUnread ? h("a", { style: { cursor: "pointer", textTransform: "none", color: "var(--accent)" }, text: "Mark all read", onclick: markAllRead }) : null),
        ...(attn.length ? [h("div", { class: "nt-group", text: "Needs your attention" }), ...attn] : []),
        ...(recent.length ? [attn.length ? h("div", { class: "nt-group", text: "Recent" }) : null, ...recent] : []),
        ...(!attn.length && !recent.length ? [h("div", { class: "menu-empty", text: "You're all caught up ✨" })] : []),
        window.Notify && Notify.perm() === "default" ? h("div", { class: "nt-bell-ask" }, h("span", { text: "🔔 Get notified on this device, even in the background" }),
          h("button", { class: "btn primary", text: "Turn on", onclick: () => { UI.closePops(); Notify.enable(); } })) : null);
    }
    bell.onclick = () => {
      count();
      box = h("div", { class: "nt-panel" }); fill();
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

  /* pick several people: selected = array of person keys; onChange(keys) runs on every tick */
  function peoplePicker(anchor, selected, onChange, opts = {}) {
    const sel = new Set(selected || []);
    const inp = h("input", { class: "menu-input", placeholder: opts.placeholder || "Search people…" }), list = h("div", { class: "pp-list" });
    const draw = () => {
      list.innerHTML = ""; const q = inp.value.toLowerCase();
      Data.people().filter(p => !(opts.exclude || []).includes(p.key) && (p.name + p.email).toLowerCase().includes(q)).forEach(p => {
        const on = sel.has(p.key);
        list.append(h("button", { class: "mi compact" + (on ? " on" : ""), onclick: () => { on ? sel.delete(p.key) : sel.add(p.key); onChange([...sel]); draw(); } },
          h("span", { class: "pp-check", text: on ? "✓" : "" }), avatar(p, 22), h("span", { class: "mi-t", text: p.name + (p.key === Data.me().key ? " (you)" : "") }), h("span", { class: "mi-k", text: p.title || "" })));
      });
      if (!list.children.length) list.append(h("div", { class: "menu-empty", text: "Nobody found" }));
    };
    inp.addEventListener("input", draw); draw();
    const api = UI.popover(anchor, h("div", { style: { width: "280px" } }, inp, list));
    setTimeout(() => inp.focus(), 30);
    return api;
  }
  // a row of small avatars for a list of person keys
  function avatars(keys, size = 22, max = 5) {
    keys = (keys || []).filter(Boolean);
    const el = h("span", { class: "av-stack" }, ...keys.slice(0, max).map(k => avatar(Data.person(k), size)));
    if (keys.length > max) el.append(h("span", { class: "av-more", text: "+" + (keys.length - max) }));
    return el;
  }

  /* ---------- shared views of tasks, chats and events (phase 1 fields) ---------- */
  // real tasks: not templates, not in the recycle bin
  const liveTasks = () => Data.list("tasks").filter(t => !t.deleted && t.kind !== "template");
  // tasks I'm responsible for: assignee, co-assignee (participant), or unassigned ones I created
  const isMyTask = (t, me = Data.me().key) => t.assignee === me || (t.participants || []).includes(me) || (!t.assignee && t.by === me);
  // chats I'm allowed to see: DMs only for the two people, private groups only for members
  function canSeeChat(ch, me = Data.me().key) {
    if (!ch) return false;
    if (window.ChatAccess?.canSee) return ChatAccess.canSee(ch, me);
    if (ch.startsWith("dm:")) return ch.slice(3).split("|").includes(me);
    const c = Data.get("channels", ch);
    return !c?.private || (c.members || []).includes(me);
  }
  // event occurrences between two dates, as the Calendar shows them (recurring, privacy, declined)
  function eventsBetween(from, to, opts = {}) {
    if (window.CalendarAPI?.occurrences) return CalendarAPI.occurrences(from, to, opts);
    const me = Data.me().key;
    return Data.list("events").filter(e => e.kind !== "room" && (e.calendar !== "personal" || (e.owner || e.by) === me || (e.attendees || {})[me]))
      .flatMap(e => { const end = e.end || e.date; return e.date <= to && end >= from ? [{ ev: e, date: e.date < from ? from : e.date, start: e.start || "", finish: e.finish || "", allDay: !e.start, declined: (e.attendees || {})[me] === "no" }] : []; })
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  }

  /* ---------- file attachments (stored like Drive files, outside Drive's folders) ---------- */
  const MAX_FILE = 700 * 1024;
  const fileSize = n => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : n > 1024 ? Math.round(n / 1024) + " KB" : (n || 0) + " B";
  function pickFiles(multiple = true) {
    return new Promise(res => {
      const i = h("input", { type: "file", style: { display: "none" } }); i.multiple = multiple;
      i.onchange = () => { res([...i.files]); i.remove(); };
      document.body.append(i); i.click();
    });
  }
  // upload File objects; returns [{ id, name, type, size }] to keep on a task / message / post
  async function attach(files) {
    const out = [];
    for (const f of files || []) {
      if (f.size > MAX_FILE) { UI.toast(`“${f.name}” is ${fileSize(f.size)}. Files can be up to 700 KB on the free plan; share bigger ones as a link.`); continue; }
      const data = await new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(f); });
      const id = await Data.add("files", { name: f.name, type: f.type || "application/octet-stream", size: f.size, data, folder: "__attachments" });
      out.push({ id, name: f.name, type: f.type || "", size: f.size });
    }
    return out;
  }
  function openFile(att) {
    const f = Data.get("files", att.id);
    if (!f) return UI.toast("That file is no longer available");
    if (f.type === "link") return window.open(f.url, "_blank", "noopener");
    fetch(f.data).then(r => r.blob()).then(b => {
      const u = URL.createObjectURL(b);
      if (/^(image|video|audio)\/|pdf|^text\//.test(f.type)) window.open(u, "_blank", "noopener");
      else { const a = h("a", { href: u, download: f.name }); document.body.append(a); a.click(); a.remove(); }
      setTimeout(() => URL.revokeObjectURL(u), 60000);
    });
  }
  // a clickable chip for an attachment; images show a small preview
  function fileChip(att, onRemove) {
    const f = Data.get("files", att.id), img = f && /^image\//.test(f.type) && f.data;
    const ic = /pdf/.test(att.type) ? "📕" : /sheet|excel|csv/.test(att.type) ? "📊" : /word|document/.test(att.type) ? "📄" : /zip/.test(att.type) ? "🗜️" : "📎";
    return h("span", { class: "file-chip" + (img ? " img" : ""), title: att.name, onclick: e => { if (!e.target.closest(".fc-x")) openFile(att); } },
      img ? h("img", { src: f.data, alt: "" }) : h("span", { class: "fc-ic", text: ic }),
      h("span", { class: "fc-n", text: att.name }), h("small", { text: fileSize(att.size) }),
      onRemove ? h("button", { class: "fc-x", type: "button", title: "Remove", text: "×", onclick: e => { e.stopPropagation(); onRemove(att); } }) : null);
  }

  /* ---------- @mentions ---------- */
  const handleOf = p => (p.name || "").split(" ")[0].toLowerCase();
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // person keys mentioned as @firstname in a text
  function mentioned(text) {
    const t = String(text || "").toLowerCase();
    return Data.people().filter(p => handleOf(p) && new RegExp("@" + reEsc(handleOf(p)) + "(?![\\w.-])").test(t)).map(p => p.key);
  }
  // typing "@" in an input/textarea suggests teammates
  function mentionAssist(input) {
    let pop = null;
    const close = () => { if (pop) { pop.close?.(); pop = null; } };
    input.addEventListener("input", () => {
      const pos = input.selectionStart, before = input.value.slice(0, pos), m = before.match(/(^|\s)@([\w.-]*)$/);
      if (!m) return close();
      const q = m[2].toLowerCase(), ppl = Data.people().filter(p => p.key !== Data.me().key && (p.name + " " + p.email).toLowerCase().includes(q)).slice(0, 6);
      close(); if (!ppl.length) return;
      pop = UI.popover(input, h("div", { style: { width: "240px" } }, ...ppl.map(p => h("button", { class: "mi compact", onmousedown: e => {
        e.preventDefault();
        const start = pos - m[2].length - 1, ins = "@" + handleOf(p) + " ";
        input.value = input.value.slice(0, start) + ins + input.value.slice(pos);
        input.selectionStart = input.selectionEnd = start + ins.length; close(); input.focus(); input.dispatchEvent(new Event("input"));
      } }, avatar(p, 20), h("span", { class: "mi-t", text: p.name })))), { align: "start" });
    });
    input.addEventListener("blur", () => setTimeout(close, 150));
    input.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  }

  /* form modal: fields = [{ key, label, type: text|textarea|select|date|time|number|person|people|color|checkbox, options, placeholder }] */
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
        else if (f.type === "people") {
          ctl = h("button", { class: "menu-input f-person", type: "button" });
          if (!Array.isArray(v[f.key])) v[f.key] = [];
          const paint = () => { ctl.innerHTML = ""; const ks = v[f.key]; ctl.append(ks.length ? avatars(ks, 20) : "", h("span", { text: ks.length ? ks.map(k => Data.person(k).name.split(" ")[0]).join(", ") : (f.placeholder || "Choose people…") })); };
          ctl.onclick = () => peoplePicker(ctl, v[f.key], ks => { v[f.key] = ks; paint(); }); paint();
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

  Object.assign(Apps, { chooseAvatar, avatar, avatars, colorFor, personPicker, peoplePicker, form, panel, header, tabs, iso, today, addDays, fmtDate, money, currency, empty,
    pickFiles, attach, openFile, fileChip, fileSize, mentioned, mentionAssist, handleOf, liveTasks, isMyTask, canSeeChat, eventsBetween });

  Apps.init = () => { renderNav(); initBell(); };
  window.Apps = Apps;
})();
