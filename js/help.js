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
  const showTyping = () => {
    typingEl?.remove();
    typingEl = h("div", { class: "lumi-msg bot in" }, h("img", { class: "lumi-av", src: "assets/logo.svg", alt: "" }), h("div", { class: "lumi-bubble lumi-typing" }, h("i"), h("i"), h("i")));
    panel.stream.append(typingEl); scroll();
  };
  function ask(q, forceCheck) {
    if (!q.trim()) return;
    push({ from: "me", text: q });
    if (!panel) return;
    showTyping();
    if (!forceCheck && aiReady()) return aiAnswer(q);
    setTimeout(() => { typingEl?.remove(); typingEl = null; push({ from: "bot", ...answerFor(q, forceCheck) }); }, 450 + Math.random() * 350);
  }

  /* ---------- AI answers (Claude via the Lumi AI worker; see worker/) ---------- */
  const aiReady = () => !!(window.LUMI_AI_URL && window.Cloud?.user && navigator.onLine);
  const plain = html => { const d = document.createElement("div"); d.innerHTML = String(html || "").replace(/<br\s*\/?>/g, "\n"); return d.textContent; };
  // the user's situation, so answers can be specific ("you're the only member…")
  function appState() {
    const C = window.Cloud, ws = C?.ws, cur = App.currentId || "";
    const screen = cur.startsWith("app:") ? Apps.reg[cur.slice(4)]?.title + " app" : cur === "home" ? "Home dashboard" : (Store.page(cur)?.title ? `page "${Store.page(cur).title}"` : "a page");
    return [
      `Screen: ${screen}`,
      `Signed in: ${C?.user ? "yes" : "no"}`,
      ws ? `Workspace: shared "${ws.name}", ${(ws.members || []).length} member(s), user is ${ws.owner === C.user?.uid ? "the owner" : "not the owner"}` : "Workspace: private (only on this device)",
      `Shared workspaces they belong to: ${(C?.workspaces || []).length}`,
      `Teammates online now: ${(C?.people || []).filter(p => p.uid !== C?.user?.uid && p.at && Date.now() - p.at.toMillis() < 70000).length}`,
      `Sync status: ${document.getElementById("savedState")?.textContent || "unknown"}`,
      `Online: ${navigator.onLine ? "yes" : "no"}; device: ${matchMedia("(max-width: 760px)").matches ? "phone" : "computer"}; theme: ${document.documentElement.dataset.theme}`,
    ].join("\n");
  }
  // light formatting: **bold**, lists, line breaks, and [[action:x]] buttons
  function render(text) {
    const acts = [...text.matchAll(/\[\[action:([a-z]+)\]\]/g)].map(m => m[1]).filter(a => ACTIONS[a]);
    const html = esc(text.replace(/\[\[action:[a-z]*\]?\]?/g, "").trim())
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/^(\d+)\. (.*)$/gm, '<span class="lumi-li"><i>$1.</i> $2</span>')
      .replace(/^[-•] (.*)$/gm, '<span class="lumi-li"><i>•</i> $1</span>')
      .replace(/\n/g, "<br>").replace(/<\/span><br>/g, "</span>");
    return { html, acts: [...new Set(acts)].slice(0, 2) };
  }
  async function aiAnswer(q) {
    const history = log.slice(-13, -1).filter(m => m.text && !m.local).map(m => ({ role: m.from === "me" ? "user" : "assistant", content: plain(m.text) }));
    const messages = [...history, { role: "user", content: q }];
    const msg = { from: "bot", text: "", ai: true };
    let el, out, text = "";
    const start = () => { if (el) return; typingEl?.remove(); typingEl = null; el = bubble(msg, true); out = el.querySelector(".lumi-bubble > div"); out.classList.add("lumi-streaming"); panel?.stream.append(el); };
    try {
      const token = await Cloud.user.getIdToken();
      const res = await fetch(window.LUMI_AI_URL.replace(/\/$/, "") + "/chat", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ messages, state: appState() }) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 429) { typingEl?.remove(); typingEl = null; return push({ from: "bot", text: esc(err.message || "You're asking very fast. Please wait a few minutes."), local: true }); }
        throw new Error(err.error || res.status);
      }
      const reader = res.body.getReader(), dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        text += dec.decode(value, { stream: true }); start();
        out.innerHTML = render(text).html; scroll();
      }
      start();
      const r = render(text || "Sorry, I didn't get an answer. Please try again.");
      Object.assign(msg, { text: r.html, act: r.acts, ask: true });
      el.replaceWith(bubble(msg, false));
      log.push(msg); save(); scroll();
    } catch (e) {
      console.warn("Lumi AI unavailable, using the help guide", e);
      el?.remove(); typingEl?.remove(); typingEl = null;
      const a = answerFor(q);
      push({ from: "bot", ...a, text: a.text + '<div class="lumi-note">AI is unavailable right now, so this is from the built-in guide.</div>', local: true });
    }
  }

  /* ---------- widget ---------- */
  function open() {
    if (panel) return panel.input.focus();
    const stream = h("div", { class: "lumi-stream" });
    const input = h("input", { class: "lumi-input", placeholder: "Ask Lumi about anything…", maxlength: 300 });
    input.addEventListener("keydown", e => { if (e.key === "Enter") { ask(input.value); input.value = ""; } if (e.key === "Escape") close(); });
    const el = h("div", { class: "lumi glass-strong", role: "dialog", "aria-label": "Lumi help" },
      h("header", { class: "lumi-head" }, h("img", { src: "assets/logo.svg", alt: "" }), h("div", { class: "grow" }, h("b", null, "Lumi", aiReady() ? h("span", { class: "lumi-ai", text: "AI" }) : null),
        h("small", { text: aiReady() ? "Ask anything, in your own words" : window.LUMI_AI_URL && !window.Cloud?.user ? "Help guide · sign in for AI answers" : "Lumen help · answers instantly" })),
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
