/* Lumi: the in-app help assistant. Answers from HelpKB, runs a setup check, and offers one-tap fixes. */
(function () {
  const { h, esc } = UI;
  const KEY = "lumen-help-chat";
  let panel = null, log = [], typingEl = null;
  try { log = JSON.parse(sessionStorage.getItem(KEY)) || []; } catch { log = []; }
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(log.slice(-40))); } catch {} };

  /* one-tap actions an answer can offer */
  const ACTIONS = {
    invite: ["👥 Invite people", b => window.Cloud?.share(b)],
    switch: ["🔀 Switch workspace", () => document.getElementById("wsSwitch").click()],
    newws: ["✨ Create a workspace", () => window.Cloud?.user ? Onboarding.newWorkspace() : Cloud.signIn()],
    signin: ["🔑 Sign in", () => window.Cloud?.signIn()],
    avatar: ["🙂 Change avatar", () => Apps.chooseAvatar()],
    settings: ["⚙️ Open Settings", () => App.settings()],
    theme: ["🌗 Toggle dark mode", () => App.toggleTheme()],
    newpage: ["📄 New page", () => App.newPage()],
    templates: ["🧩 Templates", () => Page.templatesModal()],
    trash: ["🗑️ Open Trash", () => Page.trashModal()],
    search: ["🔍 Search", () => Palette.show()],
    reload: ["↻ Reload now", () => location.reload()],
    check: ["🩺 Check my setup", () => ask("Check my setup", true)],
    tasks: ["✅ Go to Tasks", () => Apps.go("tasks")], chat: ["💬 Open Chat", () => Apps.go("chat")], feed: ["📰 Open Feed", () => Apps.go("feed")],
    calendar: ["📅 Open Calendar", () => Apps.go("calendar")], crm: ["💼 Open CRM", () => Apps.go("crm")], company: ["🏢 Company & HR", () => Apps.go("company")],
    drive: ["🗂️ Open Drive", () => Apps.go("drive")], automation: ["⚡ Automation", () => Apps.go("automation")],
  };

  /* ---------- setup check: looks at the real state and explains it ---------- */
  function diagnose() {
    const out = [], ok = (good, text) => out.push((good === true ? "✅ " : good === "warn" ? "⚠️ " : "❌ ") + text);
    const C = window.Cloud, ws = C?.ws;
    ok(navigator.onLine, navigator.onLine ? "You're online." : "You're offline. Changes are kept and sync when you reconnect.");
    if (!C?.configured) ok("warn", "Sharing isn't connected on this site.");
    else if (!C.user) ok("warn", "You're not signed in, so you're using a private workspace that only this browser can see. Sign in to share and sync.");
    else ok(true, `Signed in as <b>${esc(C.user.email)}</b>.`);
    if (ws) {
      const n = (ws.members || []).length;
      ok(true, `You're in the shared workspace <b>${esc(ws.name)}</b>.`);
      ok(n > 1 ? true : "warn", n > 1 ? `${n} members can see what you post here.` : "You're the only member, so nobody else sees your posts or tasks here. Invite people from Share.");
      ok(ws.owner === C.user?.uid ? true : "warn", ws.owner === C.user?.uid ? "You own this workspace, so you can invite people." : `Only the owner (${esc(ws.ownerEmail || "")}) can invite or remove people.`);
      const st = document.getElementById("savedState")?.textContent || "";
      ok(/fail/i.test(st) ? false : true, /fail/i.test(st) ? "Last sync failed. Check your connection and reload." : "Changes are syncing normally.");
      if ((C.workspaces || []).length > 1) ok("warn", `You're a member of ${C.workspaces.length} workspaces. Teammates only see what's in the same one.`);
    } else if (C?.user) ok("warn", (C.workspaces || []).length ? `You're in your private workspace. You have ${C.workspaces.length} shared workspace(s) in the workspace menu.` : "You don't have a shared workspace yet. Create one to work with others.");
    const others = (C?.people || []).filter(p => p.uid !== C?.user?.uid && p.at && Date.now() - p.at.toMillis() < 70000).length;
    if (ws) ok(true, others ? `${others} teammate(s) online right now.` : "No teammates online right now.");
    if (!CSS.supports("backdrop-filter", "blur(2px)") && !CSS.supports("-webkit-backdrop-filter", "blur(2px)")) ok("warn", "This browser can't show the glass blur. Try Chrome, Edge or Safari.");
    if (location.hostname.endsWith("github.io") && !location.hostname.startsWith("lumenspaceapp")) ok("warn", "You're on an old address. Lumen now lives at lumenspaceapp.github.io.");
    const acts = [!C?.user && C?.configured ? "signin" : null, ws && (ws.members || []).length < 2 ? "invite" : null, C?.user && !ws ? "switch" : null, "reload"].filter(Boolean);
    return { text: "Here's what I see:<br>" + out.join("<br>"), act: acts };
  }

  /* ---------- conversation ---------- */
  function greet() {
    const name = (Data.me().name || "").split(" ")[0];
    return { from: "bot", text: `Hi${name && name !== "You" ? " " + esc(name) : ""}! I'm <b>Lumi</b> ✨, Lumen's helper. Ask me anything (“my friend can't see my posts”, “how do I drag on my phone”), or pick a topic below.`, chips: suggestions() };
  }
  function suggestions() {
    const app = App.currentId?.startsWith?.("app:") ? App.currentId.slice(4) : null;
    const forApp = app ? HelpKB.KB.filter(e => e.app === app).map(e => e.id) : [];
    const ws = window.Cloud?.ws;
    const base = ws && (ws.members || []).length < 2 ? ["invite", "not-seeing"] : ["not-seeing", "invite"];
    return [...new Set(["__check", ...forApp, ...base, "invite-email", "drag", "avatar", "mobile", "shortcuts"])].slice(0, 7);
  }
  function answerFor(q, forceCheck) {
    if (!forceCheck && /^(hi|hello|hey|yo|hii+|namaste|hola)\b[\s!.]*$/i.test(q.trim())) return greet();
    if (!forceCheck && /\b(thank|thanks|thx|ty)\b|works now|solved|got it/i.test(q)) return { text: "Glad I could help! 🎉 Ask me anything else any time: the help button is always in the corner, or press <b>Ctrl /</b>." };
    const hits = HelpKB.search(q);
    if (forceCheck || (/check|diagnos|status|setup|what.?s wrong|not working|broken|problem|issue|bug|error/i.test(q) && !hits.length)) return { ...diagnose(), chips: ["not-seeing", "signin", "update"] };
    if (!hits.length) return { text: "I'm not sure about that one 🤔. Try different words, or pick one of these. You can also run a quick setup check.", chips: ["__check", "not-seeing", "signin", "update", "shortcuts"] };
    const [best, ...rest] = hits;
    return { text: `<b>${esc(best.e.t)}</b><br>${best.e.a}`, act: best.e.act || [], chips: rest.slice(0, 3).map(r => r.e.id), id: best.e.id, ask: true };
  }

  function bubble(m, animate) {
    const el = h("div", { class: "lumi-msg " + m.from + (animate ? " in" : "") });
    if (m.from === "bot") el.append(h("img", { class: "lumi-av", src: "assets/logo.svg", alt: "" }));
    const body = h("div", { class: "lumi-bubble" }, h("div", { html: m.from === "bot" ? m.text : esc(m.text) }));
    if (m.act?.length) body.append(h("div", { class: "lumi-acts" }, ...m.act.filter(a => ACTIONS[a]).map(a => h("button", { class: "lumi-act", text: ACTIONS[a][0], onclick: e => ACTIONS[a][1](e.currentTarget) }))));
    if (m.ask) body.append(h("div", { class: "lumi-rate" }, h("span", { text: "Did this help?" }),
      h("button", { text: "👍", onclick: e => { e.currentTarget.parentElement.replaceChildren(h("span", { text: "Great! 🙌" })); } }),
      h("button", { text: "👎", onclick: e => { e.currentTarget.parentElement.replaceChildren(h("span", { text: "Sorry about that." })); push({ from: "bot", text: "Let's try another way. Run a setup check, or tell me a bit more (what you tapped, and what you expected to happen).", chips: ["__check", "not-seeing", "update"] }); } })));
    el.append(body);
    if (m.chips?.length) el.append(h("div", { class: "lumi-chips" }, ...m.chips.map(id => {
      const label = id === "__check" ? "🩺 Check my setup" : HelpKB.byId(id)?.t; if (!label) return null;
      return h("button", { class: "lumi-chip", text: label, onclick: () => id === "__check" ? ask("Check my setup", true) : ask(HelpKB.byId(id).t) });
    })));
    return el;
  }
  function push(m) { log.push(m); save(); if (panel) { panel.stream.append(bubble(m, true)); scroll(); } }
  const scroll = () => requestAnimationFrame(() => { panel.stream.scrollTop = panel.stream.scrollHeight; });
  function ask(q, forceCheck) {
    if (!q.trim()) return;
    push({ from: "me", text: q });
    if (!panel) return;
    typingEl?.remove();
    typingEl = h("div", { class: "lumi-msg bot in" }, h("img", { class: "lumi-av", src: "assets/logo.svg", alt: "" }), h("div", { class: "lumi-bubble lumi-typing" }, h("i"), h("i"), h("i")));
    panel.stream.append(typingEl); scroll();
    setTimeout(() => { typingEl?.remove(); typingEl = null; push({ from: "bot", ...answerFor(q, forceCheck) }); }, 450 + Math.random() * 350);
  }

  /* ---------- widget ---------- */
  function open() {
    if (panel) return panel.input.focus();
    const stream = h("div", { class: "lumi-stream" });
    const input = h("input", { class: "lumi-input", placeholder: "Ask Lumi about anything…", maxlength: 300 });
    input.addEventListener("keydown", e => { if (e.key === "Enter") { ask(input.value); input.value = ""; } if (e.key === "Escape") close(); });
    const el = h("div", { class: "lumi glass-strong", role: "dialog", "aria-label": "Lumi help" },
      h("header", { class: "lumi-head" }, h("img", { src: "assets/logo.svg", alt: "" }), h("div", { class: "grow" }, h("b", { text: "Lumi" }), h("small", { text: "Lumen help · answers instantly" })),
        h("button", { class: "icon-btn", title: "Start over", text: "↺", onclick: () => { log = []; save(); stream.replaceChildren(); push(greet()); } }),
        h("button", { class: "icon-btn", title: "Close", html: UI.icon("x"), onclick: close })),
      stream,
      h("div", { class: "lumi-compose" }, input, h("button", { class: "btn primary", text: "Ask", onclick: () => { ask(input.value); input.value = ""; } })));
    document.body.append(el);
    panel = { el, stream, input };
    if (!log.length) log.push(greet());
    log.forEach(m => stream.append(bubble(m, false)));
    scroll(); setTimeout(() => input.focus(), 60);
    fab.classList.add("open");
  }
  function close() { if (!panel) return; panel.el.classList.add("closing"); const el = panel.el; setTimeout(() => el.remove(), 220); panel = null; fab.classList.remove("open"); }
  const fab = h("button", { class: "lumi-fab", title: "Help (Ctrl /)", "aria-label": "Open help", onclick: () => panel ? close() : open() },
    h("img", { src: "assets/logo.svg", alt: "" }), h("span", { class: "lumi-q", text: "?" }));
  document.body.append(fab);
  addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key === "/") { e.preventDefault(); panel ? close() : open(); } });

  window.Lumi = { open, close, ask };
})();
