/* Notify: tells you when something happens, wherever you are in Lumen.
   - chat: every new message in your DMs and channels (or only DMs & @mentions, your choice)
   - bell items: task assignments, comments, mentions, announcements, thanks, CRM, automation
   - reminders: events starting in 10 minutes, tasks due today
   In the app you get a glass card + a soft sound; when Lumen is in the background you get a
   system notification (once allowed) and an unread count in the tab title / app icon. */
(function () {
  const { h, esc } = UI;
  const PKEY = "lumen-notify-prefs";
  const prefs = (() => { try { return { sound: true, desktop: true, chat: "all", ...JSON.parse(localStorage.getItem(PKEY)) }; } catch { return { sound: true, desktop: true, chat: "all" }; } })();
  const savePrefs = () => { try { localStorage.setItem(PKEY, JSON.stringify(prefs)); } catch {} };
  const supported = "Notification" in window;
  const perm = () => supported ? Notification.permission : "unsupported";
  const shared = () => !!(window.Cloud?.ws && window.Cloud?.user);
  const strip = s => String(s || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const away = () => document.visibilityState !== "visible" || !document.hasFocus();

  /* ---------- sound: a soft two-note chime made with WebAudio (no file to load) ---------- */
  let actx = null;
  const unlock = () => { try { actx ||= new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume(); } catch {} };
  addEventListener("pointerdown", unlock, { capture: true, passive: true });
  addEventListener("keydown", unlock, { capture: true });
  function chime() {
    if (!prefs.sound || !actx || actx.state !== "running") return;
    const t = actx.currentTime;
    [[784, 0], [1175, .09]].forEach(([f, d]) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0, t + d); g.gain.linearRampToValueAtTime(.12, t + d + .015); g.gain.exponentialRampToValueAtTime(.0001, t + d + .45);
      o.connect(g).connect(actx.destination); o.start(t + d); o.stop(t + d + .5);
    });
  }

  /* ---------- unread count in the tab title and on the installed app icon ---------- */
  let missed = 0;
  const baseTitle = () => document.title.replace(/^\(\d+\+?\) /, "");
  function paintCount() {
    const t = baseTitle(); document.title = missed ? `(${missed > 99 ? "99+" : missed}) ${t}` : t;
    try { missed ? navigator.setAppBadge?.(missed) : navigator.clearAppBadge?.(); } catch {}
  }
  const clearMissed = () => { if (!away() && missed) { missed = 0; paintCount(); } };
  document.addEventListener("visibilitychange", clearMissed);
  addEventListener("focus", clearMissed);
  // keep the "(3)" prefix when the app changes the title on navigation
  new MutationObserver(() => { if (missed && !/^\(\d+\+?\) /.test(document.title)) paintCount(); }).observe(document.querySelector("title"), { childList: true });

  /* ---------- in-app card ---------- */
  let stack = null;
  function card({ title, body, link, person, icon }) {
    stack ||= document.body.appendChild(h("div", { class: "nt-stack", role: "status", "aria-live": "polite" }));
    const lead = person ? Apps.avatar(person, 34) : h("span", { class: "nt-ico", text: icon || "🔔" });
    const el = h("div", { class: "nt-card glass-strong" + (link ? " link" : "") }, lead,
      h("div", { class: "nt-txt" }, h("b", { text: title }), body ? h("span", { text: body }) : null),
      h("button", { class: "nt-x", title: "Dismiss", "aria-label": "Dismiss", text: "×", onclick: e => { e.stopPropagation(); kill(); } }));
    if (link) el.onclick = () => { kill(); location.hash = link; };
    stack.prepend(el);
    while (stack.children.length > 3) stack.lastChild.remove();
    let tm = setTimeout(kill, 6500);
    el.onmouseenter = () => clearTimeout(tm);
    el.onmouseleave = () => { tm = setTimeout(kill, 2500); };
    function kill() { clearTimeout(tm); el.classList.add("out"); setTimeout(() => el.remove(), 260); }
  }

  /* ---------- system notification (works in a background tab / installed app) ---------- */
  async function system({ title, body, link, tag }) {
    if (!prefs.desktop || perm() !== "granted") return false;
    const opts = { body, tag: tag || undefined, renotify: !!tag, icon: "assets/icon-192.png", badge: "assets/favicon-48.png", data: { link: link || "" } };
    try {
      const reg = "serviceWorker" in navigator && await navigator.serviceWorker.getRegistration();
      if (reg) { await reg.showNotification(title, opts); return true; }
      const n = new Notification(title, opts);
      n.onclick = () => { focus(); if (link) location.hash = link; n.close(); };
      return true;
    } catch (e) { console.warn("notification", e); return false; }
  }
  // clicking a system notification: the service worker focuses this tab and passes the link
  navigator.serviceWorker?.addEventListener("message", e => { if (e.data?.type === "lumen-open" && e.data.link) location.hash = e.data.link; });

  const recent = new Map(); // don't repeat the same alert (e.g. a DM arriving as both a chat message and a bell item)
  function alert(n) {
    const key = n.dedupe || n.title + "|" + n.body;
    if (recent.has(key) && Date.now() - recent.get(key) < 8000) return;
    recent.set(key, Date.now());
    if (away()) {
      missed++; paintCount();
      system(n).then(shown => { if (!shown && document.visibilityState === "visible") { card(n); chime(); } });
    } else { card(n); chime(); }
  }

  /* ---------- watchers ---------- */
  let since = Date.now(), offs = [];
  const seen = new Set();
  const fresh = x => x && !seen.has(x.id) && (x.at || 0) > since - 60000 && (seen.add(x.id), true);
  const handle = () => (Data.me().name || "").split(" ")[0].toLowerCase();
  const viewing = ch => !away() && location.hash.startsWith("#/app/chat") &&
    (decodeURIComponent(location.hash.slice("#/app/chat/".length)) === ch || (location.hash.replace(/\/$/, "") === "#/app/chat" && localStorage.getItem("lumen-chat-active") === ch));

  function onChat(msgs) {
    if (!shared()) return;
    const me = Data.me().key;
    msgs.forEach(m => {
      if (!fresh(m) || m.by === me || !m.channel) return;
      const dm = m.channel.startsWith("dm:");
      if (dm && !m.channel.slice(3).split("|").includes(me)) return; // someone else's DM
      const mentioned = !dm && handle() && String(m.text || "").toLowerCase().includes("@" + handle());
      if (!dm && !mentioned && prefs.chat !== "all") return;
      if (viewing(m.channel)) return;
      const who = Data.person(m.by);
      const chName = dm ? "" : "#" + ((Data.list("channels").find(c => c.id === m.channel) || {}).name || m.channel);
      const title = m.kind === "call" ? `📹 ${who.name} started a video call${dm ? "" : " in " + chName}`
        : dm ? who.name : mentioned ? `${who.name} mentioned you in ${chName}` : `${who.name} in ${chName}`;
      alert({ title, body: m.kind === "call" ? "Tap to join" : String(m.text || "").slice(0, 140), link: "#/app/chat/" + encodeURIComponent(m.channel),
        person: who, tag: "chat-" + m.channel, dedupe: "chat|" + m.channel + "|" + m.by });
    });
  }
  function onBell(all) {
    if (!shared()) return;
    const me = Data.me().key;
    all.forEach(n => {
      if (!fresh(n) || n.to !== me || n.read) return;
      // chat messages already alerted from the chat stream above
      if ((n.link || "").startsWith("#/app/chat/")) { const ch = decodeURIComponent(n.link.slice("#/app/chat/".length)); if (Data.list("chat").some(m => m.channel === ch && m.by === n.by && Math.abs((m.at || 0) - (n.at || 0)) < 15000)) return; }
      const who = n.by ? Data.person(n.by) : null;
      alert({ title: strip(n.text).slice(0, 120), body: "", link: n.link || "", person: who, tag: "n-" + n.id,
        dedupe: (n.link || "").startsWith("#/app/chat/") ? "chat|" + decodeURIComponent(n.link.slice("#/app/chat/".length)) + "|" + n.by : "n-" + n.id });
    });
  }

  /* reminders: events 10 minutes ahead, and tasks due today (once a day) */
  const remKey = () => "lumen-reminded-" + (window.Cloud?.ws?.id || "local");
  const reminded = () => { try { return JSON.parse(localStorage.getItem(remKey())) || {}; } catch { return {}; } };
  const remember = (r, k) => { r[k] = Date.now(); for (const x in r) if (Date.now() - r[x] > 3 * 864e5) delete r[x]; try { localStorage.setItem(remKey(), JSON.stringify(r)); } catch {} };
  function reminders() {
    const today = Apps.today(), now = new Date(), r = reminded();
    Data.list("events").forEach(ev => {
      if (ev.date !== today || !/^\d\d:\d\d$/.test(ev.start || "")) return;
      const [hh, mm] = ev.start.split(":").map(Number), at = new Date(now); at.setHours(hh, mm, 0, 0);
      const mins = Math.round((at - now) / 60000), k = "ev|" + ev.id + "|" + ev.date + "|" + ev.start;
      if (mins >= 0 && mins <= 10 && !r[k]) {
        remember(r, k);
        alert({ title: `📅 ${ev.title || "Event"} ${mins <= 0 ? "is starting now" : `starts in ${mins} min`}`, body: [ev.start + (ev.finish ? "–" + ev.finish : ""), ev.where].filter(Boolean).join(" · "), link: "#/app/calendar", icon: "📅", tag: "ev-" + ev.id });
      }
    });
    const me = Data.me().key, dk = "tasks|" + today;
    if (!r[dk] && now.getHours() >= 8 && Data.list("tasks").length) {
      const mine = Data.list("tasks").filter(t => t.status !== "done" && t.deadline && t.deadline <= today && (t.assignee === me || (!t.assignee && t.by === me)));
      remember(r, dk);
      if (mine.length) {
        const late = mine.filter(t => t.deadline < today).length;
        alert({ title: `✅ ${mine.length} task${mine.length > 1 ? "s" : ""} due today${late ? ` (${late} overdue)` : ""}`, body: mine.slice(0, 3).map(t => t.title).join(" · "), link: "#/app/tasks", icon: "✅", tag: "tasks-today" });
      }
    }
  }

  function start() {
    offs.forEach(f => f()); seen.clear(); since = Date.now();
    // a moment's grace so the first (possibly cached) snapshot doesn't alert old items
    offs = [Data.on("chat", onChat), Data.on("notifications", onBell), Data.on("events", () => {}), Data.on("tasks", () => {})];
    setTimeout(maybeAsk, 6000);
  }
  setInterval(() => { if (window.Data && window.Apps?.today) reminders(); }, 30000);

  /* ---------- asking for permission (only ever from a click) ---------- */
  async function enable() {
    if (!supported) { UI.toast(/iPhone|iPad/.test(navigator.userAgent) ? "On iPhone: Share → Add to Home Screen, then open Lumen from there to allow notifications" : "This browser can't show notifications"); return "unsupported"; }
    unlock();
    let p = Notification.permission;
    if (p === "default") p = await Notification.requestPermission();
    if (p === "granted") { prefs.desktop = true; savePrefs(); system({ title: "Notifications are on ✨", body: "You'll hear about new messages, tasks and mentions here.", tag: "lumen-test" }); }
    else if (p === "denied") UI.toast("Notifications are blocked. Click the 🔒 icon next to the address and allow Notifications.");
    paintPrompt();
    return p;
  }
  let promptEl = null;
  function paintPrompt() { if (promptEl && perm() !== "default") { promptEl.remove(); promptEl = null; } }
  function maybeAsk() {
    if (!shared() || perm() !== "default" || promptEl || (Cloud.ws.members || []).length < 2) return;
    if (localStorage.getItem("lumen-notify-asked") > Date.now() - 7 * 864e5) return; // "Not now" waits a week
    promptEl = h("div", { class: "nt-ask glass-strong" },
      h("span", { class: "nt-ico", text: "🔔" }),
      h("div", { class: "nt-txt" }, h("b", { text: "Don't miss messages" }), h("span", { text: "Get a notification when teammates message you, even when Lumen is in the background." })),
      h("div", { class: "nt-ask-btns" },
        h("button", { class: "btn", text: "Not now", onclick: () => { localStorage.setItem("lumen-notify-asked", Date.now()); promptEl.remove(); promptEl = null; } }),
        h("button", { class: "btn primary", text: "Turn on", onclick: () => { localStorage.setItem("lumen-notify-asked", Date.now()); enable(); promptEl?.remove(); promptEl = null; } })));
    document.body.append(promptEl);
  }

  /* ---------- settings block (used in Settings and in the bell menu) ---------- */
  function settingsRows(row) {
    const sw = (on, fn) => { const s = h("span", { class: "switch" + (on ? " on" : ""), style: { cursor: "pointer" } }); s.onclick = () => s.classList.toggle("on", fn()); return s; };
    const status = h("span");
    const paint = () => {
      const p = perm();
      status.replaceChildren(p === "granted" ? sw(prefs.desktop, () => { prefs.desktop = !prefs.desktop; savePrefs(); return prefs.desktop; })
        : p === "denied" ? h("span", { class: "set-val", style: { width: "auto" }, text: "Blocked: allow it from the 🔒 icon by the address" })
        : p === "unsupported" ? h("span", { class: "set-val", style: { width: "auto" }, text: /iPhone|iPad/.test(navigator.userAgent) ? "Add Lumen to your Home Screen first" : "Not supported here" })
        : h("button", { class: "btn primary", text: "Turn on", onclick: async () => { await enable(); paint(); } }));
    };
    paint();
    const seg = h("div", { class: "seg" }, ...[["all", "All messages"], ["dm", "DMs & @mentions"]].map(([v, l]) => h("button", { class: prefs.chat === v ? "on" : "", text: l, onclick: e => {
      prefs.chat = v; savePrefs(); seg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.currentTarget)); } })));
    return [
      row("Desktop notifications", "Pop up on this device when Lumen is in the background", status),
      row("Notification sound", "A soft chime when something new arrives", sw(prefs.sound, () => { prefs.sound = !prefs.sound; savePrefs(); if (prefs.sound) { unlock(); setTimeout(chime, 50); } return prefs.sound; })),
      row("Chat alerts", "Which chat messages notify you", seg),
      row("Test", "Check that notifications work on this device", h("button", { class: "btn", text: "Send a test", onclick: () => {
        unlock();
        UI.toast(perm() === "granted" && prefs.desktop ? "Switch to another tab or app: a test arrives in 4 seconds" : "A test arrives in 4 seconds");
        setTimeout(() => alert({ title: "🔔 Test notification", body: "Notifications are working on this device.", icon: "🔔", tag: "lumen-test", dedupe: "test" + Date.now() }), 4000);
      } })),
    ];
  }

  window.Notify = { start, enable, settingsRows, prefs, perm, alert };
  Apps.onWorkspace.add(start); // signed in / switched workspace
  start();
})();
