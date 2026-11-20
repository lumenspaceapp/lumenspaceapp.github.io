/* Chat & video calls (Bitrix24 Messenger-style): channels, direct messages, reactions, unread counts, Jitsi meetings */
(function () {
  const { h, esc } = UI;
  const REACT = ["👍", "❤️", "😂", "🎉", "😮", "👀"];
  const readKey = () => "lumen-chat-read-" + (window.Cloud?.ws?.id || "local");
  const lastRead = () => { try { return JSON.parse(localStorage.getItem(readKey())) || {}; } catch { return {}; } };
  const markRead = ch => { const r = lastRead(); r[ch] = Date.now(); localStorage.setItem(readKey(), JSON.stringify(r)); };
  const dmId = (a, b) => "dm:" + [a, b].sort().join("|");
  const linkify = s => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/@(\w[\w.-]*)/g, '<span class="mention-at">@$1</span>');

  function channels() {
    const list = Data.list("channels");
    if (!list.some(c => c.id === "general")) list.unshift({ id: "general", name: "general", desc: "Company-wide chat" });
    return list;
  }
  function unreadFor(msgs) {
    const r = lastRead(), me = Data.me().key, out = {};
    msgs.forEach(m => { if (m.by !== me && m.at > (r[m.channel] || 0) && (!m.channel.startsWith("dm:") || m.channel.includes(me))) out[m.channel] = (out[m.channel] || 0) + 1; });
    return out;
  }
  // sidebar counter
  let unBadge = null;
  const startBadge = () => { unBadge && unBadge(); unBadge = Data.on("chat", msgs => { const u = unreadFor(msgs); Apps.badge("chat", Object.values(u).reduce((a, b) => a + b, 0)); }); };

  function meetUrl(ch) { return `https://meet.jit.si/Lumen-${(window.Cloud?.ws?.id || "local").slice(0, 10)}-${ch.replace(/[^a-z0-9]/gi, "").slice(0, 24)}`; }

  function render(root, arg) {
    let active = arg || localStorage.getItem("lumen-chat-active") || "general";
    const side = h("div", { class: "chat-side" }), main = h("div", { class: "chat-main" });
    root.append(h("div", { class: "chat" }, side, main));
    const stream = h("div", { class: "chat-stream" });
    const input = h("textarea", { class: "chat-input", rows: 1, placeholder: "Write a message… (Enter to send, Shift+Enter for a new line)" });
    const head = h("div", { class: "chat-head" });
    main.append(head, stream, h("div", { class: "chat-compose" },
      h("button", { class: "icon-btn", title: "Emoji", text: "😊", onclick: e => UI.emojiPicker(e.currentTarget, em => { input.value += em; input.focus(); }) }),
      input, h("button", { class: "btn primary", text: "Send", onclick: send })));
    input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 160) + "px"; });
    input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
    let lastCount = 0;

    function title(ch) {
      if (ch.startsWith("dm:")) { const other = ch.slice(3).split("|").find(k => k !== Data.me().key) || Data.me().key; return { name: Data.person(other).name, person: Data.person(other) }; }
      const c = channels().find(x => x.id === ch); return { name: "# " + (c?.name || ch), desc: c?.desc };
    }
    function drawSide(msgs) {
      const u = unreadFor(msgs), me = Data.me().key;
      const item = (id, label, lead) => h("button", { class: "ch" + (id === active ? " on" : "") + (u[id] ? " unread" : ""), onclick: () => select(id) }, lead, h("span", { class: "ch-n", text: label }), u[id] ? h("span", { class: "ch-u", text: u[id] }) : null);
      side.replaceChildren(
        h("div", { class: "chat-sec" }, "Channels", h("button", { class: "icon-btn xs", title: "New channel", html: UI.icon("plus"), onclick: newChannel })),
        ...channels().map(c => item(c.id, c.name, h("span", { class: "ch-hash", text: "#" }))),
        h("div", { class: "chat-sec" }, "Direct messages"),
        ...Data.people().filter(p => p.key !== me).map(p => item(dmId(me, p.key), p.name, Apps.avatar(p, 20))),
        Data.people().length < 2 ? h("div", { class: "chat-hint", text: window.Cloud?.ws ? "Invite people from Share to message them." : "Switch to a shared workspace to chat with friends." }) : null);
    }
    function drawStream(msgs) {
      const t = title(active);
      head.replaceChildren(t.person ? Apps.avatar(t.person, 30) : h("span", { class: "ch-big", text: "#" }),
        h("div", { class: "grow" }, h("b", { text: t.name }), h("div", { class: "app-sub", text: t.desc || (t.person ? (t.person.online ? "🟢 Online" : t.person.title || "Direct message") : "") })),
        h("button", { class: "btn", html: "📹 Video call", title: "Start a video meeting", onclick: call }));
      const list = msgs.filter(m => m.channel === active).sort((a, b) => a.at - b.at);
      const atBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 80;
      stream.replaceChildren();
      if (!list.length) stream.append(Apps.empty(t.person ? "👋" : "💬", t.person ? `Say hi to ${t.person.name}!` : "No messages yet. Start the conversation."));
      let prev = null, prevDay = "";
      list.forEach(m => {
        const day = new Date(m.at).toDateString();
        if (day !== prevDay) { stream.append(h("div", { class: "day-sep" }, h("span", { text: day === new Date().toDateString() ? "Today" : new Date(m.at).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) }))); prev = null; prevDay = day; }
        const grouped = prev && prev.by === m.by && m.at - prev.at < 5 * 60000 && !m.kind;
        const p = Data.person(m.by), mine = m.by === Data.me().key;
        const reacts = Object.entries(m.reactions || {}).filter(([, who]) => who.length);
        const bubble = h("div", { class: "msg" + (grouped ? " grouped" : "") + (mine ? " mine" : "") + (m.kind ? " sys" : "") },
          grouped ? h("span", { class: "msg-av" }) : Apps.avatar(p, 34),
          h("div", { class: "msg-b" },
            grouped ? null : h("div", { class: "msg-h" }, h("b", { text: p.name }), h("small", { text: new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }), m.edited ? h("small", { text: "(edited)" }) : null),
            m.kind === "call" ? h("div", { class: "call-card" }, "📹 ", h("b", { text: p.name + " started a video call" }), h("a", { class: "btn primary", href: m.url, target: "_blank", rel: "noopener", text: "Join call" }))
              : h("div", { class: "msg-t", html: linkify(m.text) }),
            reacts.length ? h("div", { class: "reacts" }, ...reacts.map(([em, who]) => h("button", { class: who.includes(Data.me().key) ? "on" : "", title: who.map(k => Data.person(k).name).join(", "), onclick: () => react(m, em) }, em + " " + who.length))) : null),
          h("div", { class: "msg-acts" }, ...REACT.slice(0, 4).map(em => h("button", { text: em, onclick: () => react(m, em) })),
            mine && !m.kind ? h("button", { title: "Edit", text: "✏️", onclick: () => edit(m) }) : null,
            mine ? h("button", { title: "Delete", text: "🗑️", onclick: async () => { if (await UI.confirm("Delete this message?")) Data.remove("chat", m.id); } }) : null));
        stream.append(bubble); prev = m;
      });
      if (atBottom || list.length !== lastCount) stream.scrollTop = stream.scrollHeight;
      lastCount = list.length;
      markRead(active);
    }
    function draw() { const msgs = Data.list("chat"); drawSide(msgs); drawStream(msgs); Apps.badge("chat", Object.values(unreadFor(msgs)).reduce((a, b) => a + b, 0)); }
    function select(id) { active = id; localStorage.setItem("lumen-chat-active", id); lastCount = -1; draw(); input.focus(); }
    function send() {
      const text = input.value.trim(); if (!text) return;
      input.value = ""; input.style.height = "auto";
      Data.add("chat", { channel: active, text, reactions: {} });
      // @mentions and DMs notify people
      const me = Data.me();
      if (active.startsWith("dm:")) { const other = active.slice(3).split("|").find(k => k !== me.key); other && Data.notify(other, `💬 <b>${esc(me.name)}</b>: ${esc(text.slice(0, 80))}`, "#/app/chat/" + encodeURIComponent(active)); }
      Data.people().forEach(p => { const handle = p.name.split(" ")[0].toLowerCase(); if (p.key !== me.key && text.toLowerCase().includes("@" + handle)) Data.notify(p.key, `<b>${esc(me.name)}</b> mentioned you in ${esc(title(active).name)}`, "#/app/chat/" + encodeURIComponent(active)); });
    }
    function react(m, em) {
      const me = Data.me().key, r = { ...(m.reactions || {}) }, who = new Set(r[em] || []);
      who.has(me) ? who.delete(me) : who.add(me); r[em] = [...who];
      Data.update("chat", m.id, { reactions: r });
    }
    async function edit(m) {
      const v = await Apps.form("Edit message", [{ key: "text", label: "Message", type: "textarea", rows: 3, required: true }], { text: m.text });
      if (v) Data.update("chat", m.id, { text: v.text, edited: true });
    }
    async function newChannel() {
      const v = await Apps.form("New channel", [{ key: "name", label: "Channel name", required: true, placeholder: "e.g. marketing" }, { key: "desc", label: "What's it about?" }]);
      if (!v) return;
      const id = await Data.add("channels", { name: v.name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "channel", desc: v.desc || "" });
      select(id);
    }
    function call() {
      const url = meetUrl(active);
      Data.add("chat", { channel: active, kind: "call", url, text: "Video call", reactions: {} });
      if (active.startsWith("dm:")) { const other = active.slice(3).split("|").find(k => k !== Data.me().key); other && Data.notify(other, `📹 <b>${esc(Data.me().name)}</b> is calling you`, "#/app/chat/" + encodeURIComponent(active)); }
      open(url, "_blank", "noopener");
    }

    const offs = [Data.on("chat", draw), Data.on("channels", draw), Data.on("people", draw)];
    setTimeout(() => input.focus(), 100);
    return () => offs.forEach(f => f());
  }

  Apps.register("chat", { title: "Chat & Calls", icon: "💬", render });
  Apps.onWorkspace.add(startBadge);
  setTimeout(startBadge, 0);
})();
