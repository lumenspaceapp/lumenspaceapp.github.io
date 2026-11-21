/* Chat & Calls (Bitrix24 Messenger-style): group chats, public and broadcast channels, direct messages,
   replies, forwards, pins, files, reactions, read receipts, typing, search, unread counts, Jitsi video calls */
(function () {
  const { h, esc } = UI;
  const REACT = ["👍", "❤️", "😂", "🎉", "😮", "👀"];
  const svg = d => `<svg class="ico" viewBox="0 0 24 24"><path d="${d}"/></svg>`;
  const IC = {
    back: "M15 18l-6-6 6-6", search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
    reply: "M9 14L4 9l5-5M4 9h10a6 6 0 0 1 6 6v4", fwd: "M15 14l5-5-5-5M20 9H10a6 6 0 0 0-6 6v4",
    clip: "M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.5 3.5 0 0 1 5 5l-8.6 8.6a2 2 0 0 1-2.8-2.8L15 7.7",
    send: "M22 2L11 13M22 2l-7 20-4-9-9-4z", video: "M3 7h12v10H3zM15 10l6-3v10l-6-3",
    info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01", down: "M12 5v14M6 13l6 6 6-6",
    pin: "M9 4h6l-1 6 4 4H6l4-4zM12 14v6", smile: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01",
    lock: "M6 11h12v9H6zM8 11V7a4 4 0 0 1 8 0v4", mega: "M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1zM17 9a4 4 0 0 1 0 6",
    hash: "M5 9h14M5 15h14M10 3L8 21M16 3l-2 18", edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
    users: "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8",
    copy: "M8 8h12v12H8zM4 16V4h12", trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3", star: "M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z",
  };

  /* ---------- read markers on this device (shared with the bell and Home) ---------- */
  const readKey = () => "lumen-chat-read-" + (window.Cloud?.ws?.id || "local");
  const lastRead = () => { try { return JSON.parse(localStorage.getItem(readKey())) || {}; } catch { return {}; } };
  const markRead = ch => { const r = lastRead(); r[ch] = Date.now(); try { localStorage.setItem(readKey(), JSON.stringify(r)); } catch {} dispatchEvent(new Event("lumen-chat-read")); };

  /* ---------- chats and who can see them ---------- */
  const isDM = id => String(id || "").startsWith("dm:");
  const dmPeople = id => String(id).slice(3).split("|");
  const dmId = (a, b) => "dm:" + [a, b].sort().join("|");
  const meKey = () => Data.me().key;
  const shared = () => !!window.Cloud?.ws;
  const firstName = n => String(n || "").trim().split(" ")[0] || "Someone";
  const otherOf = id => { const me = meKey(); return dmPeople(id).find(k => k !== me) || me; };
  const pc = new Map(); // person lookups, cleared on every redraw
  const person = k => { let p = pc.get(k); if (!p) pc.set(k, p = Data.person(k)); return p; };
  const isImg = a => /^image\//.test(a?.type || "");
  const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "channel";

  // channel docs: name, desc, kind "channel"|"group"|"broadcast", private, members, admins, pinned (old docs have none of these)
  function norm(c) {
    return { ...c, name: c.name || (c.id === "general" ? "general" : "untitled"), desc: c.desc ?? (c.id === "general" ? "Company-wide chat" : ""),
      kind: c.kind || "channel", private: !!c.private, members: c.members || [], admins: c.admins || [], pinned: c.pinned || [] };
  }
  function channelDoc(id) {
    if (isDM(id)) return null;
    const c = Data.get("channels", id);
    return c ? norm(c) : id === "general" ? norm({ id: "general" }) : null;
  }
  function channels() {
    const list = Data.list("channels").map(norm);
    if (!list.some(c => c.id === "general")) list.unshift(norm({ id: "general" }));
    return list;
  }
  const known = id => id === "general" || isDM(id) || !!Data.get("channels", id);
  function canSee(id, key) {
    if (!id) return false;
    key = key || meKey();
    if (isDM(id)) return dmPeople(id).includes(key);
    const c = Data.get("channels", id);
    if (c && c.private) return (c.members || []).includes(key);
    return true;
  }
  function kindOf(id) { if (isDM(id)) return "dm"; const c = Data.get("channels", id); return (c && c.kind) || "channel"; }
  function titleOf(id) {
    if (isDM(id)) return Data.person(otherOf(id)).name;
    const c = channelDoc(id);
    if (!c) return "#" + id;
    return c.kind === "group" ? c.name : "#" + c.name;
  }
  const adminsOf = c => c.admins.length ? c.admins : (c.by ? [c.by] : []);
  function isAdmin(id, key) {
    if (isDM(id)) return true;
    const c = channelDoc(id); if (!c) return true;
    const a = adminsOf(c);
    return !a.length || a.includes(key || meKey()); // nobody owns it (e.g. #general): anyone can manage it
  }
  const canPost = id => canSee(id) && (kindOf(id) !== "broadcast" || isAdmin(id));
  const canPin = id => isDM(id) || isAdmin(id);
  function membersOf(id) {
    if (isDM(id)) return dmPeople(id);
    const c = channelDoc(id);
    return c && c.private ? c.members : Data.people().map(p => p.key);
  }
  async function ensureDoc(id) { if (id === "general" && !Data.get("channels", "general")) await Data.update("channels", "general", { name: "general", desc: "Company-wide chat" }); }

  /* ---------- unread counts: only chats I can see ---------- */
  function unreadFor(msgs) {
    const r = lastRead(), me = meKey(), out = {};
    msgs.forEach(m => {
      if (!m.channel || m.by === me || m.deleted || (m.at || 0) <= (r[m.channel] || 0) || !known(m.channel) || !canSee(m.channel, me)) return;
      out[m.channel] = (out[m.channel] || 0) + 1;
    });
    return out;
  }
  const paintBadge = () => Apps.badge("chat", Object.values(unreadFor(Data.list("chat"))).reduce((a, b) => a + b, 0));
  let unBadge = [];
  const startBadge = () => { unBadge.forEach(f => f()); unBadge = [Data.on("chat", paintBadge), Data.on("channels", paintBadge)]; };
  addEventListener("lumen-chat-read", () => { if (window.Data) paintBadge(); });

  function meetUrl(ch) { return `https://meet.jit.si/Lumen-${(window.Cloud?.ws?.id || "local").slice(0, 10)}-${ch.replace(/[^a-z0-9]/gi, "").slice(0, 24)}`; }

  /* ---------- text helpers ---------- */
  // a message someone else took down (workspace admins, or managers in workgroups they lead): deletedBy is not the author
  const delText = m => !m.deletedBy || m.deletedBy === m.by ? "Message deleted" : Apps.isAdmin?.(m.deletedBy) ? "Removed by an admin" : "Removed by a moderator";
  function snippet(m) {
    if (!m) return "";
    if (m.deleted) return delText(m);
    if (m.kind === "call") return "📹 Video call";
    const t = String(m.text || "").replace(/\s+/g, " ").trim();
    if (t) return t;
    const f = m.files || [];
    if (f.length) return (f.every(isImg) ? "🖼️ " : "📎 ") + (f.length === 1 ? f[0].name : f.length + " files");
    return "";
  }
  const names = keys => {
    const n = keys.map(k => firstName(person(k).name));
    return n.length <= 3 ? n.join(", ").replace(/, ([^,]*)$/, " and $1") : n.slice(0, 2).join(", ") + ` and ${n.length - 2} others`;
  };
  const hm = t => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  function shortWhen(t) {
    const d = new Date(t), now = new Date();
    if (d.toDateString() === now.toDateString()) return hm(t);
    if (now - d < 6 * 864e5) return d.toLocaleDateString(undefined, { weekday: "short" });
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  function dayLabel(t) {
    const d = new Date(t), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === now.toDateString()) return "Today";
    if (d.toDateString() === y.toDateString()) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
  }
  const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*\s*){1,3}$/u;
  // links and @mentions; URLs are handled first so a mention never lands inside an href
  function richText(s) {
    const mine = Apps.handleOf ? Apps.handleOf(Data.me()) : firstName(Data.me().name).toLowerCase();
    return String(s || "").split(/(https?:\/\/[^\s<]*[^\s<.,!?;:)'"])/g).map((part, i) => {
      if (i % 2) { const u = esc(part); return `<a href="${u}" target="_blank" rel="noopener">${u}</a>`; }
      return esc(part).replace(/(^|[\s(])@([\w][\w.-]*)/g, (all, pre, hd) => `${pre}<span class="mention-at${hd.toLowerCase() === mine ? " me" : ""}">@${hd}</span>`);
    }).join("");
  }

  /* ---------- posting (also used by forwards) ---------- */
  function post(ch, fields, withMentions) {
    Data.add("chat", fields);
    const me = Data.me(), link = "#/app/chat/" + encodeURIComponent(ch);
    if (isDM(ch)) { // DMs notify the other person, as before
      const other = otherOf(ch);
      if (other && other !== me.key) Data.notify(other, `💬 <b>${esc(me.name)}</b> sent you a message`, link, snippet(fields));
      return;
    }
    // group messages reach members through the chat watcher in notify.js: only @mentions create notifications here
    if (!withMentions || !fields.text) return;
    const c = channelDoc(ch), priv = c && c.private;
    Apps.mentioned(fields.text).filter(k => k !== me.key && (!priv || c.members.includes(k)))
      .forEach(k => Data.notify(k, `<b>${esc(me.name)}</b> mentioned you in ${esc(titleOf(ch))}`, link, fields.text));
  }
  const sysMsg = (ch, text) => Data.add("chat", { channel: ch, kind: "sys", text, reactions: {} });

  /* ---------- image viewer ---------- */
  function lightbox(att) {
    const f = Data.get("files", att.id);
    if (!f || !f.data) return Apps.openFile(att);
    const onKey = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    const close = () => { removeEventListener("keydown", onKey, true); el.classList.add("closing"); setTimeout(() => el.remove(), 200); };
    const el = h("div", { class: "cx-lightbox", onclick: e => { if (!e.target.closest(".cx-lb-bar")) close(); } },
      h("div", { class: "cx-lb-bar" }, h("span", { text: att.name }),
        h("a", { class: "icon-btn", href: f.data, download: att.name, title: "Download", html: UI.icon("download") }),
        h("button", { class: "icon-btn", title: "Close", html: UI.icon("x"), onclick: close })),
      h("img", { src: f.data, alt: att.name }));
    document.getElementById("layer").append(el);
    addEventListener("keydown", onKey, true);
  }

  function render(root, arg) {
    let active = arg || localStorage.getItem("lumen-chat-active") || "general";
    if (!arg && !canSee(active)) active = "general";
    const isPhone = () => matchMedia("(max-width: 760px)").matches;
    const side = h("div", { class: "chat-side" }), main = h("div", { class: "chat-main" });
    const chatEl = h("div", { class: "chat cx" }, side, main);
    root.append(chatEl);
    if (isPhone() && !arg) chatEl.classList.add("show-side"); // on phones, start on the chat list

    /* ----- sidebar ----- */
    const search = h("input", { class: "cx-search", type: "search", placeholder: "Search chats and messages", "aria-label": "Search chats and messages" });
    const sideList = h("div", { class: "cx-list" });
    side.append(h("div", { class: "cx-side-top" },
      h("label", { class: "cx-search-wrap" }, h("span", { class: "cx-search-ic", html: svg(IC.search) }), search),
      h("button", { class: "icon-btn cx-new", title: "New chat or channel", html: svg(IC.edit), onclick: e => UI.menu(e.currentTarget, [
        { label: "New chat", iconHtml: svg(IC.users), onClick: newGroup },
        { label: "New channel", iconHtml: svg(IC.hash), onClick: () => newChannel("channel") },
        { label: "New broadcast channel", iconHtml: svg(IC.mega), onClick: () => newChannel("broadcast") }], { align: "end" }) })),
      sideList);
    search.addEventListener("input", () => drawSide());
    search.addEventListener("keydown", e => { if (e.key === "Escape" && search.value) { e.stopPropagation(); search.value = ""; drawSide(); } });

    /* ----- conversation ----- */
    const head = h("div", { class: "chat-head cx-head" });
    const pinBar = h("div", { class: "cx-pin" });
    const stream = h("div", { class: "chat-stream cx-stream" });
    const typingEl = h("div", { class: "cx-typing", "aria-live": "polite" });
    const downBtn = h("button", { class: "cx-down", title: "Jump to latest", html: svg(IC.down), onclick: () => stream.scrollTo({ top: stream.scrollHeight, behavior: "smooth" }) });
    const ctxBar = h("div", { class: "cx-ctx" }), attsEl = h("div", { class: "cx-atts" });
    const input = h("textarea", { class: "chat-input", rows: 1, placeholder: "Write a message…", title: "Enter to send · Shift+Enter for a new line" });
    const fileBtn = h("button", { class: "icon-btn", title: "Attach files", html: svg(IC.clip), onclick: async () => addFiles(await Apps.pickFiles(true)) });
    const emojiBtn = h("button", { class: "icon-btn", title: "Emoji", html: svg(IC.smile), onclick: e => UI.emojiPicker(e.currentTarget, em => insert(em)) });
    const sendBtn = h("button", { class: "btn primary cx-send", title: "Send", onclick: send }, h("span", { html: svg(IC.send) }), h("span", { class: "cx-send-t", text: "Send" }));
    const composer = h("div", { class: "cx-composer" }, ctxBar, attsEl, h("div", { class: "chat-compose" }, fileBtn, emojiBtn, input, sendBtn));
    const readonly = h("div", { class: "cx-readonly" }, h("span", { html: svg(IC.mega) }), "Only admins can post here");
    const dropEl = h("div", { class: "cx-drop" }, h("div", null, h("span", { html: svg(IC.clip) }), h("b", { text: "Drop files to send" })));
    main.append(head, pinBar, h("div", { class: "cx-wrap" }, stream, typingEl, downBtn), composer, readonly, dropEl);
    Apps.mentionAssist(input);

    let replyTo = null, editing = null, editStash = null, pending = [], uploading = 0;
    const drafts = {};
    let openedReadAt = lastRead()[active] || 0, firstDraw = true, rendered = new Set(), stick = true, focusMsg = null;
    let curList = [], pinnedIds = new Set(), peopleSig = "", typSig = "", missingFiles = false, filesOff = null;
    const timers = [], readT = {};

    /* ----- sidebar drawing ----- */
    const sec = (label, btn) => h("div", { class: "chat-sec" }, h("span", { text: label }), btn || null);
    function typingNow() { // chat id -> keys of people typing there
      const me = meKey(), now = Date.now(), out = {};
      if (!shared()) return out;
      Data.list("people").forEach(p => { const t = p.typing; if (p.id !== me && t && t.channel && now - (t.at || 0) < 6000 && canSee(t.channel, p.id)) (out[t.channel] ||= []).push(p.id); });
      return out;
    }
    const typingSig = () => Object.entries(typingNow()).map(([c, ks]) => c + ":" + ks.join(",")).sort().join("|");
    function chatAvatar(id, size) {
      if (isDM(id)) return Apps.avatar(person(otherOf(id)), size);
      const c = channelDoc(id), k = c ? c.kind : "channel";
      if (k === "group") { const a = Apps.avatar({ name: c.name, key: id }, size); a.classList.add("cx-gav"); return a; }
      return h("span", { class: "cx-chav" + (k === "broadcast" ? " bc" : ""), style: { width: size + "px", height: size + "px" }, html: svg(k === "broadcast" ? IC.mega : IC.hash) });
    }
    function preview(m, id) {
      if (m.kind === "sys" || m.deleted) return snippet(m);
      const who = m.by === meKey() ? "You: " : isDM(id) ? "" : firstName(person(m.by).name) + ": ";
      return who + snippet(m);
    }
    function row(id, lm, n, typers) {
      const c = channelDoc(id), dm = isDM(id), k = kindOf(id);
      const name = dm ? person(otherOf(id)).name : c ? c.name : id;
      const sub = typers && typers.length ? h("span", { class: "cx-row-typ", text: dm ? "typing…" : typers.length > 1 ? "several people are typing…" : firstName(person(typers[0]).name) + " is typing…" })
        : h("span", { class: "cx-row-p", text: lm ? preview(lm, id) : (c && c.desc) || (dm ? "Say hi 👋" : k === "group" ? `${c.members.length} members` : "") });
      return h("button", { class: "ch cx-row" + (id === active ? " on" : "") + (n ? " unread" : ""), dataset: { id }, onclick: () => select(id) },
        chatAvatar(id, 38),
        h("span", { class: "cx-row-b" },
          h("span", { class: "cx-row-t" }, h("span", { class: "ch-n", text: name }), lm ? h("small", { text: shortWhen(lm.at) }) : null),
          h("span", { class: "cx-row-s" }, sub, n ? h("span", { class: "ch-u", text: n > 99 ? "99+" : n }) : null)));
    }
    function personRow(p) {
      return h("button", { class: "ch cx-row cx-person", onclick: () => select(dmId(meKey(), p.key)) }, Apps.avatar(p, 30),
        h("span", { class: "cx-row-b" }, h("span", { class: "ch-n", text: p.name }), p.title ? h("span", { class: "cx-row-p", text: p.title }) : null));
    }
    function drawSide() {
      const msgs = Data.list("chat"), u = unreadFor(msgs), me = meKey(), q = search.value.trim().toLowerCase();
      const last = {};
      msgs.forEach(m => { if (m.channel && (!last[m.channel] || (m.at || 0) > (last[m.channel].at || 0))) last[m.channel] = m; });
      if (q) return drawResults(q, msgs, last, u);
      const typers = typingNow();
      const groups = channels().filter(c => c.kind === "group" && canSee(c.id));
      const dms = new Set();
      msgs.forEach(m => { if (isDM(m.channel) && canSee(m.channel) && otherOf(m.channel) !== me) dms.add(m.channel); });
      if (isDM(active) && canSee(active) && otherOf(active) !== me) dms.add(active);
      const chats = [...groups.map(c => ({ id: c.id, at: (last[c.id] || c).at || 0 })), ...[...dms].map(id => ({ id, at: (last[id] || {}).at || 0 }))].sort((a, b) => b.at - a.at);
      const chans = channels().filter(c => c.kind !== "group" && canSee(c.id)).sort((a, b) => a.id === "general" ? -1 : b.id === "general" ? 1 : a.name.localeCompare(b.name));
      const dmWith = new Set([...dms].map(otherOf));
      const ppl = Data.people().filter(p => p.key !== me && !dmWith.has(p.key));
      sideList.replaceChildren(
        sec("Chats", h("button", { class: "icon-btn xs", title: "New chat", html: UI.icon("plus"), onclick: newGroup })),
        ...(chats.length ? chats.map(c => row(c.id, last[c.id], u[c.id], typers[c.id])) : [h("div", { class: "chat-hint", text: "Start a group chat, or message someone from People." })]),
        sec("Channels", h("button", { class: "icon-btn xs", title: "New channel", html: UI.icon("plus"), onclick: () => newChannel("channel") })),
        ...chans.map(c => row(c.id, last[c.id], u[c.id], typers[c.id])),
        ppl.length ? sec("People") : null,
        ...ppl.map(personRow),
        Data.people().length < 2 ? h("div", { class: "chat-hint", text: window.Cloud?.ws ? "Invite people from Share to message them." : "Switch to a shared workspace to chat with friends." }) : null);
    }
    function mark(text, q) { // escaped snippet around the match, with the match highlighted
      const t = String(text || "").replace(/\s+/g, " "), i = t.toLowerCase().indexOf(q);
      if (i < 0) return esc(t.slice(0, 90));
      const s = Math.max(0, i - 30);
      return (s ? "…" : "") + esc(t.slice(s, i)) + "<mark>" + esc(t.slice(i, i + q.length)) + "</mark>" + esc(t.slice(i + q.length, i + q.length + 70));
    }
    function drawResults(q, msgs, last, u) {
      const me = meKey();
      const chatHits = [...channels().filter(c => canSee(c.id) && c.name.toLowerCase().includes(q)).map(c => c.id),
        ...Data.people().filter(p => p.key !== me && (p.name + " " + p.email).toLowerCase().includes(q)).map(p => dmId(me, p.key))];
      const hits = msgs.filter(m => m.channel && !m.deleted && m.kind !== "call" && m.kind !== "sys" && known(m.channel) && canSee(m.channel)
        && (String(m.text || "").toLowerCase().includes(q) || (m.files || []).some(f => String(f.name).toLowerCase().includes(q))))
        .sort((a, b) => b.at - a.at).slice(0, 60);
      sideList.replaceChildren(
        chatHits.length ? sec("Chats") : null,
        ...chatHits.slice(0, 8).map(id => row(id, last[id], u[id])),
        sec(hits.length ? `Messages · ${hits.length}${hits.length === 60 ? "+" : ""}` : "Messages"),
        ...(hits.length ? hits.map(m => h("button", { class: "cx-hit", onclick: () => select(m.channel, { focus: m.id }) },
          Apps.avatar(person(m.by), 28),
          h("span", { class: "cx-hit-b" },
            h("span", { class: "cx-hit-t" }, h("b", { text: titleOf(m.channel) }), h("small", { text: shortWhen(m.at) })),
            h("span", { class: "cx-hit-s" }, h("span", { class: "cx-hit-who", text: (m.by === me ? "You" : firstName(person(m.by).name)) + ": " }),
              h("span", { html: String(m.text || "").toLowerCase().includes(q) ? mark(m.text, q) : mark((m.files || []).map(f => f.name).join(", "), q) })))))
          : [h("div", { class: "chat-hint", text: "No messages match your search." })]));
    }

    /* ----- header, pins, composer mode ----- */
    function paintHead() {
      const id = active, dm = isDM(id), c = channelDoc(id), k = kindOf(id), vis = canSee(id);
      let name, sub, extra = null;
      if (!vis) { name = "Private chat"; sub = "You're not a member"; }
      else if (dm) { const p = person(otherOf(id)); name = p.name; sub = p.online ? h("span", { class: "cx-online", text: "Online" }) : (p.title || "Direct message"); }
      else if (k === "group") {
        name = c.name; sub = `${c.members.length} member${c.members.length === 1 ? "" : "s"}`;
        extra = h("button", { class: "cx-head-avs", title: "Members", onclick: openInfo }, Apps.avatars(c.members, 26, 4));
      } else { name = c ? c.name : id; sub = k === "broadcast" ? "Broadcast channel" + (c && c.desc ? " · " + c.desc : "") : (c && c.desc) || "Public channel"; }
      head.replaceChildren(
        h("button", { class: "icon-btn chat-menu", title: "All chats", html: svg(IC.back), onclick: () => { chatEl.classList.add("show-side"); drawSide(); } }),
        h("button", { class: "cx-head-id", title: vis ? "Chat info" : "", onclick: () => vis && openInfo() },
          vis ? chatAvatar(id, 40) : h("span", { class: "cx-chav", style: { width: "40px", height: "40px" }, html: svg(IC.lock) }),
          h("span", { class: "cx-head-t" }, h("b", { text: name }), h("span", { class: "app-sub" }, sub))),
        extra,
        vis && Apps.AI?.available() ? h("button", { class: "icon-btn ai-chat-btn", title: "AI: summarise or suggest replies", text: "✨", onclick: e => UI.menu(e.currentTarget, [
          { label: "Summarise", iconHtml: "📝", onClick: aiSummary }, canPost(id) ? { label: "Suggest replies", iconHtml: "💡", onClick: aiReplies } : null], { align: "end" }) }) : null,
        vis && canPost(id) ? h("button", { class: "btn cx-call", title: "Start a video call", onclick: call }, h("span", { html: svg(IC.video) }), h("span", { class: "cx-call-t", text: "Video call" })) : null,
        vis ? h("button", { class: "icon-btn", title: "Chat info", html: svg(IC.info), onclick: openInfo }) : null);
    }
    // AI helpers (js/ai.js): summary of the last ~100 messages, and reply ideas for the last message from someone else
    const aiLines = n => curList.filter(m => !m.deleted && !m.kind && String(m.text || "").trim()).slice(-n).map(m => `${person(m.by).name}: ${String(m.text).trim()}`);
    const aiSummary = () => Apps.AI.compose({ title: "Chat summary", task: "summarize_chat", input: aiLines(100).join("\n"), emptyHint: "There are no messages to summarise yet." });
    function aiReplies() {
      const last = curList.filter(m => !m.deleted && !m.kind && m.by !== meKey() && String(m.text || "").trim()).pop();
      if (!last) return UI.toast("There's no message to reply to yet.");
      Apps.AI.compose({ title: "Suggested replies", task: "reply_suggestions", input: `${person(last.by).name}: ${last.text}`, context: aiLines(15).join("\n"),
        pick: line => { input.value = line; autosize(); input.focus(); input.dispatchEvent(new Event("input")); } });
    }
    function pinsFor(id, list) {
      if (isDM(id)) return list.filter(m => m.pinned && !m.deleted);
      const byId = Object.fromEntries(list.map(m => [m.id, m])), c = channelDoc(id);
      return ((c && c.pinned) || []).map(x => byId[x]).filter(m => m && !m.deleted);
    }
    function paintPins(list) {
      const ps = pinsFor(active, list);
      pinnedIds = new Set(ps.map(m => m.id));
      pinBar.classList.toggle("on", ps.length > 0);
      if (!ps.length) return pinBar.replaceChildren();
      const m = ps[ps.length - 1];
      pinBar.replaceChildren(
        h("button", { class: "cx-pin-main", title: "Go to the pinned message", onclick: () => jumpTo(m.id) },
          h("span", { class: "cx-pin-ic", html: svg(IC.pin) }),
          h("span", { class: "cx-pin-b" }, h("b", { text: ps.length > 1 ? `Pinned messages · ${ps.length}` : "Pinned message" }), h("span", { text: firstName(person(m.by).name) + ": " + snippet(m) }))),
        ps.length > 1 ? h("button", { class: "chip-btn", text: "All", title: "All pinned messages", onclick: e => UI.menu(e.currentTarget,
          ps.slice().reverse().map(x => ({ label: firstName(person(x.by).name) + ": " + snippet(x).slice(0, 60), iconHtml: svg(IC.pin), onClick: () => jumpTo(x.id) })), { align: "end" }) }) : null,
        canPin(active) ? h("button", { class: "icon-btn xs", title: "Unpin", html: UI.icon("x"), onclick: () => setPin(active, m, false) }) : null);
    }
    function paintMode() {
      const vis = canSee(active), can = vis && canPost(active);
      composer.style.display = can ? "" : "none";
      readonly.style.display = vis && !can ? "" : "none";
      input.placeholder = isPhone() ? "Message…" : `Message ${titleOf(active)}`;
    }

    /* ----- messages ----- */
    function emptyState() {
      const k = kindOf(active);
      if (k === "dm") { const p = person(otherOf(active)); return Apps.empty("👋", `Say hi to ${p.name}!`); }
      if (k === "group") return Apps.empty("👥", `This is the start of ${titleOf(active)}.`);
      if (k === "broadcast") return Apps.empty("📣", "Announcements from the admins show up here.");
      return Apps.empty("💬", "No messages yet. Start the conversation.");
    }
    function watchFiles() {
      if (filesOff) return;
      filesOff = Data.on("files", () => setTimeout(() => { if (missingFiles) { missingFiles = false; drawStream(); } }, 0));
    }
    function filesEl(files) {
      const imgs = files.filter(isImg), other = files.filter(a => !isImg(a));
      return h("div", { class: "cx-files" },
        imgs.length ? h("div", { class: "cx-imgs n" + Math.min(imgs.length, 4) }, ...imgs.map(a => {
          watchFiles();
          const f = Data.get("files", a.id);
          if (!f) missingFiles = true;
          return h("button", { class: "cx-img" + (f ? "" : " loading"), title: a.name, onclick: e => { e.stopPropagation(); lightbox(a); } },
            f && f.data ? h("img", { src: f.data, alt: a.name, loading: "lazy", onload: () => { if (stick) stream.scrollTop = stream.scrollHeight; } }) : h("span", { text: "🖼️" }));
        })) : null,
        ...other.map(a => Apps.fileChip(a)));
    }
    function metaEl(m) {
      return h("span", { class: "cx-meta", title: new Date(m.at).toLocaleString() },
        pinnedIds.has(m.id) ? h("span", { class: "cx-meta-pin", html: svg(IC.pin) }) : null,
        m.edited && !m.deleted ? "edited · " : "", hm(m.at));
    }
    function msgEl(m, grouped, dm, isNew) {
      const me = meKey(), mine = m.by === me, p = person(m.by);
      if (m.kind === "sys") return h("div", { class: "cx-sys" + (isNew ? " new" : ""), dataset: { id: m.id } }, h("span", { text: m.text }));
      const bub = h("div", { class: "cx-bub" });
      if (!mine && !grouped && !dm) bub.append(h("div", { class: "cx-name", style: { color: Apps.colorFor(m.by) }, text: p.name }));
      if (m.deleted) bub.append(h("div", { class: "cx-del" + (m.deletedBy && m.deletedBy !== m.by ? " cx-modded" : "") }, h("span", { text: delText(m) }), metaEl(m)));
      else {
        if (m.fwd) bub.append(h("div", { class: "cx-fwd" }, h("span", { html: svg(IC.fwd) }), "Forwarded from ", h("b", { text: person(m.fwd.by).name })));
        if (m.replyTo) bub.append(h("button", { class: "cx-quote", title: "Go to the original message", onclick: e => { e.stopPropagation(); jumpTo(m.replyTo.id); } },
          h("b", { text: person(m.replyTo.by).name }), h("span", { text: m.replyTo.text || "Attachment" })));
        if (m.kind === "call") bub.append(h("div", { class: "call-card cx-callcard" }, h("span", { class: "cx-call-ic", html: svg(IC.video) }),
          h("span", null, h("b", { text: (mine ? "You" : p.name) + " started a video call" }), h("small", { text: "Jitsi meeting" })),
          h("a", { class: "btn primary", href: m.url, target: "_blank", rel: "noopener", text: "Join" })));
        if ((m.files || []).length) bub.append(filesEl(m.files));
        if (m.text && m.kind !== "call") {
          const t = h("div", { class: "msg-t" + (!(m.files || []).length && EMOJI_ONLY.test(m.text.trim()) ? " cx-emoji" : ""), html: richText(m.text) });
          t.append(metaEl(m)); bub.append(t);
        } else bub.append(h("div", { class: "cx-meta-row" }, metaEl(m)));
      }
      const reacts = Object.entries(m.reactions || {}).filter(([, who]) => (who || []).length);
      const body = h("div", { class: "msg-b cx-body" }, bub,
        reacts.length && !m.deleted ? h("div", { class: "reacts" }, ...reacts.map(([em, who]) => h("button", { class: who.includes(me) ? "on" : "", title: who.map(k => person(k).name).join(", "), onclick: () => react(m, em) }, em + " " + who.length))) : null);
      const el = h("div", { class: "msg cx-msg" + (mine ? " mine" : "") + (grouped ? " grouped" : "") + (m.deleted ? " deleted" : "") + (isNew ? " new" : ""), dataset: { id: m.id } },
        mine ? null : grouped ? h("span", { class: "msg-av" }) : h("button", { class: "msg-av cx-av", title: dm ? p.name : "Message " + p.name, onclick: () => { if (!dm && m.by !== me) select(dmId(me, m.by)); } }, Apps.avatar(p, 32)),
        body,
        m.deleted ? null : h("div", { class: "msg-acts" },
          ...REACT.slice(0, 3).map(em => h("button", { text: em, title: "React " + em, onclick: () => react(m, em) })),
          canPost(active) ? h("button", { title: "Reply", html: svg(IC.reply), onclick: () => startReply(m) }) : null,
          h("button", { title: "More", html: UI.icon("dots"), onclick: e => openMenu(m, e.currentTarget) })));
      if (!m.deleted) press(el, m);
      return el;
    }
    // long-press (touch) or right-click opens the message menu
    let lastPress = 0;
    function press(el, m) {
      let t = 0, fired = false, sx = 0, sy = 0;
      const cancel = () => { clearTimeout(t); t = 0; };
      el.addEventListener("touchstart", e => {
        if (e.target.closest("a,button,.cx-img")) return;
        const p = e.touches[0]; sx = p.clientX; sy = p.clientY; fired = false;
        t = setTimeout(() => { t = 0; fired = true; lastPress = Date.now(); el.classList.add("pressed"); try { navigator.vibrate?.(8); } catch {} openMenu(m, el.querySelector(".cx-bub") || el); setTimeout(() => el.classList.remove("pressed"), 260); }, 450);
      }, { passive: true });
      el.addEventListener("touchmove", e => { const p = e.touches[0]; if (Math.abs(p.clientX - sx) > 8 || Math.abs(p.clientY - sy) > 8) cancel(); }, { passive: true });
      el.addEventListener("touchend", e => { cancel(); if (fired) { e.preventDefault(); fired = false; } }); // no ghost click closing the menu
      el.addEventListener("touchcancel", cancel);
      el.addEventListener("contextmenu", e => {
        if (e.target.closest("a,img")) return;
        e.preventDefault();
        if (Date.now() - lastPress < 900) return;
        openMenu(m, { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY });
      });
    }
    function openMenu(m, anchor) {
      m = Data.get("chat", m.id) || m;
      if (m.deleted) return;
      const mine = m.by === meKey(), pinned = isPinned(m);
      // moderation: owner/admins in any channel or group chat they can see, managers in chats of workgroups they lead (never DMs)
      const canMod = !mine && !isDM(active) && canSee(active) && m.kind !== "sys" && !!Apps.canManage?.(m.by, "moderate", { channel: active });
      const reactRow = h("div", { class: "cx-react-row" }, ...REACT.map(em => h("button", { text: em, onclick: () => { UI.closePops(); react(m, em); } })),
        h("button", { class: "cx-react-more", title: "More emoji", text: "+", onclick: e => UI.emojiPicker(e.currentTarget, em => em && react(m, em)) }));
      UI.menu(anchor, [
        { el: reactRow }, { sep: true },
        canPost(active) ? { label: "Reply", iconHtml: svg(IC.reply), onClick: () => startReply(m) } : null,
        m.kind !== "call" ? { label: "Forward", iconHtml: svg(IC.fwd), onClick: () => forward(m) } : null,
        canPin(active) ? { label: pinned ? "Unpin" : "Pin", iconHtml: svg(IC.pin), onClick: () => setPin(active, m, !pinned) } : null,
        m.text ? { label: "Copy text", iconHtml: svg(IC.copy), onClick: () => navigator.clipboard?.writeText(m.text).then(() => UI.toast("Copied"), () => UI.toast("Couldn't copy")) } : null,
        mine && !m.kind ? { label: "Edit", iconHtml: svg(IC.edit), onClick: () => startEdit(m) } : null,
        mine ? { label: "Delete", iconHtml: svg(IC.trash), danger: true, onClick: () => del(m) } : null,
        canMod ? { label: "Remove message", iconHtml: svg(IC.trash), danger: true, onClick: () => del(m, true) } : null,
      ], { align: "start" });
    }
    function paintSeen() {
      stream.querySelector(".cx-seen")?.remove();
      const k = kindOf(active);
      if ((k !== "dm" && k !== "group") || !shared() || !canSee(active)) return;
      const me = meKey(), list = curList;
      const mineLast = [...list].reverse().find(m => m.by === me && !m.deleted && m.kind !== "sys");
      if (!mineLast) return;
      const others = membersOf(active).filter(x => x !== me);
      const seen = others.filter(x => (((Data.get("people", x) || {}).reads || {})[active] || 0) >= mineLast.at || list.some(m => m.by === x && m.at > mineLast.at));
      if (!seen.length) return;
      const el = stream.querySelector(`[data-id="${CSS.escape(mineLast.id)}"]`);
      if (!el) return;
      el.after(h("div", { class: "cx-seen" }, h("span", { text: "✓✓" }), k === "dm" ? " Seen" : seen.length === others.length && others.length > 2 ? " Seen by everyone" : " Seen by " + names(seen)));
    }
    function paintTyping() {
      const ks = canSee(active) ? (typingNow()[active] || []) : [];
      typingEl.classList.toggle("on", ks.length > 0);
      if (!ks.length) return;
      const text = ks.length === 1 ? `${firstName(person(ks[0]).name)} is typing…` : ks.length === 2 ? `${names(ks)} are typing…` : "Several people are typing…";
      if (typingEl.dataset.t !== text) { typingEl.dataset.t = text; typingEl.replaceChildren(h("span", { class: "cx-dots" }, h("i"), h("i"), h("i")), h("span", { text })); }
    }
    const paintDown = () => downBtn.classList.toggle("on", !stick && stream.scrollHeight > stream.clientHeight + 200);
    stream.addEventListener("scroll", () => { stick = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 90; paintDown(); }, { passive: true });

    function drawStream() {
      paintHead(); paintMode();
      if (!canSee(active)) {
        curList = []; pinBar.classList.remove("on"); typingEl.classList.remove("on");
        stream.replaceChildren(Apps.empty("🔒", "This chat is private. Ask a member to add you.", h("button", { class: "btn", text: "Go to #general", onclick: () => select("general") })));
        return;
      }
      const list = Data.list("chat").filter(m => m.channel === active).sort((a, b) => (a.at || 0) - (b.at || 0));
      curList = list; missingFiles = false;
      paintPins(list);
      const keep = stick, prevTop = stream.scrollTop, me = meKey(), dm = isDM(active);
      const frag = document.createDocumentFragment();
      if (!list.length) frag.append(emptyState());
      let prev = null, prevEl = null, prevDay = "", divider = null;
      list.forEach(m => {
        const day = new Date(m.at).toDateString();
        if (day !== prevDay) { frag.append(h("div", { class: "day-sep" }, h("span", { text: dayLabel(m.at) }))); prevDay = day; prev = null; }
        if (!divider && openedReadAt && m.by !== me && m.kind !== "sys" && (m.at || 0) > openedReadAt) { divider = h("div", { class: "cx-new-sep" }, h("span", { text: "New messages" })); frag.append(divider); prev = null; }
        const grouped = !!prev && prev.by === m.by && !prev.kind && !m.kind && m.at - prev.at < 5 * 60000;
        if (grouped && prevEl) prevEl.classList.add("has-next");
        const el = msgEl(m, grouped, dm, !firstDraw && !rendered.has(m.id));
        frag.append(el);
        prev = m; prevEl = el;
      });
      stream.replaceChildren(frag);
      paintSeen(); paintTyping();
      const newest = list[list.length - 1];
      if (focusMsg) { const id = focusMsg; focusMsg = null; stream.scrollTop = stream.scrollHeight; requestAnimationFrame(() => jumpTo(id)); }
      else if (firstDraw) stream.scrollTop = divider && divider.offsetTop > stream.clientHeight * .6 ? divider.offsetTop - 70 : stream.scrollHeight;
      else if (keep || (newest && newest.by === me && !rendered.has(newest.id))) stream.scrollTop = stream.scrollHeight;
      else stream.scrollTop = prevTop;
      stick = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 90;
      rendered = new Set(list.map(m => m.id)); firstDraw = false;
      paintDown();
      markSeen();
    }
    function jumpTo(id) {
      const el = stream.querySelector(`[data-id="${CSS.escape(id)}"]`);
      if (!el) return UI.toast("That message is no longer here");
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1900);
    }

    /* ----- read receipts: my read time per chat on my people doc, at most one write per chat every 5 s ----- */
    const seeing = () => document.visibilityState === "visible" && !(isPhone() && chatEl.classList.contains("show-side")) && canSee(active);
    function markSeen() {
      if (!seeing()) return;
      markRead(active);
      const newest = curList[curList.length - 1];
      if (newest && newest.by !== meKey()) writeRead(active); // my own message already tells others I've read what came before
    }
    function writeRead(ch) {
      if (!shared()) return;
      const list = ch === active ? curList : [], newest = list[list.length - 1];
      if (!newest) return;
      const st = readT[ch] ||= { id: null, t: 0, timer: 0 };
      if (st.id === newest.id) return;
      const mine = (((Data.get("people", meKey()) || {}).reads) || {})[ch] || 0;
      if (mine >= (newest.at || 0)) { st.id = newest.id; return; }
      const wait = 5000 - (Date.now() - st.t);
      if (wait > 0) { clearTimeout(st.timer); st.timer = setTimeout(() => { if (ch === active && seeing()) writeRead(ch); }, wait + 50); return; }
      st.id = newest.id; st.t = Date.now();
      Data.update("people", meKey(), { reads: { [ch]: Math.max(Date.now(), newest.at || 0) } });
    }

    /* ----- typing indicator: at most one write every 4 s ----- */
    let typAt = 0, typCh = null;
    function noteTyping() {
      if (!shared() || editing || !input.value.trim() || !canPost(active)) return;
      const now = Date.now();
      if (typCh === active && now - typAt < 4000) return;
      typAt = now; typCh = active;
      Data.update("people", meKey(), { typing: { channel: active, at: now } });
    }
    function stopTyping() {
      if (!typCh) return;
      const fresh = Date.now() - typAt < 6000;
      typCh = null; typAt = 0;
      if (fresh && shared()) Data.update("people", meKey(), { typing: null });
    }

    /* ----- composer ----- */
    const autosize = () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 160) + "px"; };
    function insert(text) {
      const s = input.selectionStart ?? input.value.length, e = input.selectionEnd ?? s;
      input.value = input.value.slice(0, s) + text + input.value.slice(e);
      input.selectionStart = input.selectionEnd = s + text.length;
      input.focus(); autosize();
    }
    function paintCtx() {
      const x = editing ? { icon: IC.edit, title: "Edit message", text: snippet(editing), cancel: cancelEdit }
        : replyTo ? { icon: IC.reply, title: "Reply to " + person(replyTo.by).name, text: replyTo.text || "Attachment", cancel: () => { replyTo = null; paintCtx(); } } : null;
      ctxBar.classList.toggle("on", !!x);
      if (!x) return ctxBar.replaceChildren();
      ctxBar.replaceChildren(h("span", { class: "cx-ctx-ic", html: svg(x.icon) }),
        h("span", { class: "cx-ctx-b" }, h("b", { text: x.title }), h("span", { text: x.text })),
        h("button", { class: "icon-btn xs", title: "Cancel (Esc)", html: UI.icon("x"), onclick: x.cancel }));
    }
    function paintAtts() {
      attsEl.classList.toggle("on", pending.length > 0 || uploading > 0);
      attsEl.replaceChildren(...pending.map(a => Apps.fileChip(a, rm => { pending = pending.filter(x => x.id !== rm.id); Data.remove("files", rm.id); paintAtts(); })),
        uploading ? h("span", { class: "cx-uploading" }, h("i", { class: "cx-spin" }), "Uploading…") : null);
    }
    async function addFiles(files) {
      files = [...(files || [])].filter(Boolean);
      if (!files.length) return;
      if (!canPost(active)) return UI.toast("Only admins can post here");
      if (editing) cancelEdit();
      const ch = active;
      uploading++; paintAtts();
      try {
        const atts = await Apps.attach(files);
        if (ch === active) pending = pending.concat(atts);
        else { const d = drafts[ch] ||= {}; d.pending = (d.pending || []).concat(atts); }
      } finally { uploading--; paintAtts(); }
      if (!isPhone()) input.focus();
    }
    function startReply(m) {
      if (editing) cancelEdit();
      replyTo = { id: m.id, by: m.by, text: snippet(m).slice(0, 140) };
      paintCtx(); input.focus();
    }
    function startEdit(m) {
      if (editing) cancelEdit();
      editStash = { text: input.value, replyTo, pending };
      editing = m; replyTo = null; pending = [];
      input.value = m.text || ""; autosize(); paintCtx(); paintAtts();
      input.focus(); input.selectionStart = input.selectionEnd = input.value.length;
    }
    function cancelEdit() {
      if (!editing) return;
      editing = null;
      const s = editStash || {}; editStash = null;
      input.value = s.text || ""; replyTo = s.replyTo || null; pending = s.pending || [];
      autosize(); paintCtx(); paintAtts();
    }
    function saveDraft() {
      if (editing) cancelEdit();
      if (input.value.trim() || replyTo || pending.length) drafts[active] = { text: input.value, replyTo, pending };
      else delete drafts[active];
    }
    function loadDraft() {
      const d = drafts[active] || {};
      input.value = d.text || ""; replyTo = d.replyTo || null; pending = d.pending || []; editing = null;
      autosize(); paintCtx(); paintAtts();
    }
    function send() {
      if (uploading) return UI.toast("Hold on, still uploading…");
      const text = input.value.trim();
      if (editing) {
        const m = Data.get("chat", editing.id) || editing;
        if (!text && !(m.files || []).length) return UI.toast("Write something, or delete the message instead");
        if (text !== (m.text || "")) Data.update("chat", m.id, { text, edited: true });
        cancelEdit(); // puts back whatever draft was in the box before editing
        return;
      }
      if (!text && !pending.length) return;
      if (!canPost(active)) return UI.toast("Only admins can post here");
      const fields = { channel: active, text, reactions: {} };
      if (pending.length) fields.files = pending;
      if (replyTo) fields.replyTo = replyTo;
      input.value = ""; pending = []; replyTo = null; delete drafts[active];
      autosize(); paintCtx(); paintAtts(); stopTyping();
      stick = true;
      post(active, fields, true);
    }
    input.addEventListener("input", () => { autosize(); noteTyping(); });
    input.addEventListener("blur", stopTyping);
    input.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
      else if (e.key === "Escape" && (editing || replyTo)) { e.preventDefault(); editing ? cancelEdit() : (replyTo = null, paintCtx()); }
      else if (e.key === "ArrowUp" && !input.value && !editing) {
        const m = [...curList].reverse().find(x => x.by === meKey() && !x.kind && !x.deleted);
        if (m) { e.preventDefault(); startEdit(m); }
      }
    });
    input.addEventListener("paste", e => {
      const files = [...(e.clipboardData?.files || [])];
      if (!files.length) return;
      e.preventDefault();
      addFiles(files.map(f => !f.name || f.name === "image.png" ? new File([f], `Pasted image ${new Date().toLocaleString().replace(/[/:]/g, "-")}.png`, { type: f.type || "image/png" }) : f));
    });
    // drag files onto the conversation
    let dragDepth = 0;
    const hasFiles = e => [...(e.dataTransfer?.types || [])].includes("Files");
    main.addEventListener("dragenter", e => { if (!hasFiles(e) || !canPost(active)) return; e.preventDefault(); dragDepth++; main.classList.add("dropping"); });
    main.addEventListener("dragover", e => { if (!hasFiles(e) || !canPost(active)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
    main.addEventListener("dragleave", e => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; main.classList.remove("dropping"); } });
    main.addEventListener("drop", e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth = 0; main.classList.remove("dropping"); addFiles(e.dataTransfer.files); });

    /* ----- message actions ----- */
    function react(m, em) {
      const cur = Data.get("chat", m.id) || m, me = meKey(), r = { ...(cur.reactions || {}) }, who = new Set(r[em] || []);
      who.has(me) ? who.delete(me) : who.add(me); r[em] = [...who];
      Data.update("chat", m.id, { reactions: r });
    }
    function isPinned(m) { return isDM(m.channel) ? !!(Data.get("chat", m.id) || m).pinned : ((channelDoc(m.channel) || {}).pinned || []).includes(m.id); }
    async function setPin(ch, m, on) {
      if (!canPin(ch)) return;
      if (isDM(ch)) Data.update("chat", m.id, { pinned: on });
      else { await ensureDoc(ch); Data.arr("channels", ch, "pinned", m.id, on); }
      UI.toast(on ? "📌 Pinned" : "Unpinned");
    }
    async function del(m, mod) {
      const marker = mod ? (Apps.isAdmin?.() ? "Removed by an admin" : "Removed by a moderator") : "Message deleted";
      if (!await UI.confirm(mod ? `Remove this message from ${person(m.by).name}? Everyone will see “${marker}” instead.` : "Delete this message? Everyone will see “Message deleted” instead.", mod ? "Remove" : "Delete")) return;
      if (editing && editing.id === m.id) cancelEdit();
      if (mod && !isDM(m.channel) && channelDoc(m.channel)?.pinned?.includes(m.id)) Data.arr("channels", m.channel, "pinned", m.id, false);
      Data.update("chat", m.id, { deleted: true, deletedBy: meKey(), text: "", files: [], replyTo: null, fwd: null, reactions: {}, pinned: false });
    }
    function forward(m) {
      const src = Data.get("chat", m.id) || m, me = meKey();
      const targets = () => {
        const msgs = Data.list("chat"), last = {};
        msgs.forEach(x => { if (x.channel) last[x.channel] = Math.max(last[x.channel] || 0, x.at || 0); });
        const ids = [...channels().filter(c => canPost(c.id)).map(c => c.id), ...Data.people().filter(p => p.key !== me).map(p => dmId(me, p.key))];
        return ids.sort((a, b) => (last[b] || 0) - (last[a] || 0));
      };
      const q = h("input", { class: "menu-input", placeholder: "Search chats and people…" }), list = h("div", { class: "cx-fwd-list" });
      const fill = () => {
        const s = q.value.trim().toLowerCase();
        const ids = targets().filter(id => titleOf(id).toLowerCase().includes(s));
        list.replaceChildren(...(ids.length ? ids.map(id => h("button", { class: "mi compact cx-fwd-item", onclick: () => { md.close(); doForward(id); } },
          chatAvatar(id, 28), h("span", { class: "mi-t", text: titleOf(id) }), h("span", { class: "mi-k", text: { dm: "Direct message", group: "Group chat", broadcast: "Broadcast", channel: "Channel" }[kindOf(id)] })))
          : [h("div", { class: "menu-empty", text: "No chats found" })]));
      };
      const doForward = id => {
        post(id, { channel: id, text: src.text || "", ...((src.files || []).length ? { files: src.files } : {}), fwd: { by: (src.fwd && src.fwd.by) || src.by, channel: (src.fwd && src.fwd.channel) || src.channel }, reactions: {} }, false);
        UI.toast(`Forwarded to ${titleOf(id)}`, { label: "Open", run: () => select(id) });
      };
      q.addEventListener("input", fill); fill();
      const md = UI.modal("Forward message", h("div", { class: "cx-fwd-box" },
        h("div", { class: "cx-fwd-prev" }, h("b", { text: person(src.by).name }), h("span", { text: snippet(src) })), q, list));
      md.el.style.width = "440px";
      setTimeout(() => q.focus(), 60);
    }

    /* ----- new chats and channels ----- */
    async function newGroup() {
      const v = await Apps.form("New chat", [{ key: "name", label: "Chat name", required: true, placeholder: "e.g. Launch team" }, { key: "members", label: "Members", type: "people", placeholder: "Add people…" }], { members: [] }, { ok: "Create chat" });
      if (!v) return;
      const me = Data.me(), members = [...new Set([me.key, ...(v.members || [])])], id = Data.uid();
      Data.add("channels", { name: v.name.trim(), desc: "", kind: "group", private: true, members, admins: [me.key], pinned: [] }, id);
      sysMsg(id, `${firstName(me.name)} created the chat`);
      search.value = "";
      select(id);
    }
    async function newChannel(kind) {
      const v = await Apps.form("New channel", [
        { key: "name", label: "Channel name", required: true, placeholder: "e.g. marketing" },
        { key: "desc", label: "What's it about?" },
        { key: "kind", label: "Who can post", type: "select", options: [["channel", "Everyone"], ["broadcast", "Only admins (announcements)"]] }], { kind: kind || "channel" }, { ok: "Create channel" });
      if (!v) return;
      const id = Data.uid();
      Data.add("channels", { name: slug(v.name), desc: v.desc || "", kind: v.kind === "broadcast" ? "broadcast" : "channel", private: false, members: [], admins: [meKey()], pinned: [] }, id);
      search.value = "";
      select(id);
    }

    /* ----- video calls ----- */
    function call() {
      const url = meetUrl(active), me = Data.me(), link = "#/app/chat/" + encodeURIComponent(active), k = kindOf(active);
      Data.add("chat", { channel: active, kind: "call", url, text: "Video call", reactions: {} });
      if (k === "dm") Data.notify(otherOf(active), `📹 <b>${esc(me.name)}</b> is calling you`, link);
      else if (k === "group") { const c = channelDoc(active); c.members.filter(x => x !== me.key).forEach(x => Data.notify(x, `📹 <b>${esc(me.name)}</b> started a video call in <b>${esc(c.name)}</b>`, link, "Tap to join")); }
      open(url, "_blank", "noopener");
    }

    /* ----- chat info panel ----- */
    function openInfo() {
      const id = active;
      if (!canSee(id)) return;
      const body = h("div", { class: "cx-info" });
      const p = Apps.panel(isDM(id) || kindOf(id) === "group" ? "Chat info" : "Channel info", body);
      const fill = () => {
        if (!p.el.isConnected) return;
        if (!canSee(id) || (!isDM(id) && !channelDoc(id))) return p.close();
        pc.clear(); body.replaceChildren(...infoBody(id, () => p.close()));
      };
      const live = UI.liveDraw(body, fill);
      fill();
      const offs = [Data.on("channels", () => live()), Data.on("chat", () => live())];
      p.onClose = () => offs.forEach(f => f());
    }
    function memberRow(id, key, c, close) {
      const me = meKey(), p = person(key), admin = isAdmin(id), adm = adminsOf(c), isAdm = adm.includes(key), k = c.kind;
      const items = [
        isAdm ? (adm.length > 1 ? { label: "Remove admin", iconHtml: svg(IC.star), onClick: () => makeAdmin(id, key, false) } : null) : { label: "Make admin", iconHtml: svg(IC.star), onClick: () => makeAdmin(id, key, true) },
        k === "group" ? { label: "Remove from chat", iconHtml: svg(IC.trash), danger: true, onClick: () => removeMember(id, key) } : null].filter(Boolean);
      return h("div", { class: "cx-mem" }, Apps.avatar(p, 32),
        h("span", { class: "cx-mem-b" }, h("b", { text: p.name + (key === me ? " (you)" : "") }), h("small", { text: p.title || p.email || "" })),
        isAdm ? h("span", { class: "cx-badge", text: "Admin" }) : null,
        key !== me ? h("button", { class: "icon-btn xs", title: "Message " + p.name, text: "💬", onclick: () => { close(); select(dmId(me, key)); } }) : null,
        admin && key !== me && items.length ? h("button", { class: "icon-btn xs", title: "More", html: UI.icon("dots"), onclick: e => UI.menu(e.currentTarget, items, { align: "end" }) }) : null);
    }
    function infoBody(id, close) {
      const me = meKey(), dm = isDM(id), c = channelDoc(id), k = kindOf(id), admin = isAdmin(id), out = [];
      const list = Data.list("chat").filter(m => m.channel === id).sort((a, b) => (a.at || 0) - (b.at || 0));
      const isec = (label, btn) => h("div", { class: "cx-info-sec" }, h("span", { text: label }), btn || null);
      if (dm) {
        const p = person(otherOf(id));
        out.push(h("div", { class: "cx-info-hero" }, chatAvatar(id, 64), h("div", null, h("h2", { text: p.name }), h("div", { class: "app-sub", text: [p.title, p.dept].filter(Boolean).join(" · ") || "Teammate" }))));
        out.push(h("div", { class: "cx-info-grid" },
          p.email ? [h("span", { text: "Email" }), h("a", { href: "mailto:" + p.email, text: p.email })] : null,
          p.phone ? [h("span", { text: "Phone" }), h("span", { text: p.phone })] : null,
          h("span", { text: "Status" }), h("span", { text: p.online ? "🟢 Online" : "Offline" })));
      } else {
        const sub = k === "group" ? `Group chat · ${c.members.length} member${c.members.length === 1 ? "" : "s"}` : k === "broadcast" ? "Broadcast channel · only admins post" : "Public channel · everyone can post";
        out.push(h("div", { class: "cx-info-hero" }, chatAvatar(id, 64), h("div", { class: "grow" }, h("h2", { text: k === "group" ? c.name : "#" + c.name }), h("div", { class: "app-sub", text: sub })),
          admin ? h("button", { class: "btn", text: "Edit", onclick: () => editChat(id) }) : null));
        if (c.desc) out.push(h("p", { class: "cx-info-desc", text: c.desc }));
      }
      if (k === "group") {
        out.push(isec(`Members · ${c.members.length}`, admin ? h("button", { class: "chip-btn", text: "+ Add people", onclick: e => addMembers(e.currentTarget, id) }) : null));
        out.push(h("div", { class: "cx-mem-list" }, ...c.members.slice().sort((a, b) => (a === me ? -1 : b === me ? 1 : person(a).name.localeCompare(person(b).name))).map(key => memberRow(id, key, c, close))));
      }
      if (k === "channel" || k === "broadcast") {
        const a = adminsOf(c);
        out.push(isec("Admins", admin ? h("button", { class: "chip-btn", text: "+ Add admin", onclick: e => Apps.personPicker(e.currentTarget, p => p && makeAdmin(id, p.key, true)) }) : null));
        out.push(a.length ? h("div", { class: "cx-mem-list" }, ...a.map(key => memberRow(id, key, c, close))) : h("div", { class: "chat-hint", text: "Nobody owns this channel yet, so everyone can manage it." }));
      }
      const ps = pinsFor(id, list);
      out.push(isec(`Pinned · ${ps.length}`));
      out.push(ps.length ? h("div", { class: "cx-pin-list" }, ...ps.slice().reverse().map(m => h("div", { class: "cx-pin-item" },
        h("button", { class: "cx-pin-go", onclick: () => { close(); if (id !== active) select(id, { focus: m.id }); else jumpTo(m.id); } },
          Apps.avatar(person(m.by), 26), h("span", { class: "cx-pin-go-b" }, h("b", { text: person(m.by).name }), h("span", { text: snippet(m) })), h("small", { text: shortWhen(m.at) })),
        canPin(id) ? h("button", { class: "icon-btn xs", title: "Unpin", html: UI.icon("x"), onclick: () => setPin(id, m, false) }) : null)))
        : h("div", { class: "chat-hint", text: "Nothing pinned yet. Use Pin on a message to keep it handy here." }));
      const files = list.filter(m => !m.deleted).flatMap(m => m.files || []).reverse().slice(0, 16);
      if (files.length) out.push(isec("Files"), h("div", { class: "file-list cx-info-files" }, ...files.map(a => Apps.fileChip(a))));
      const acts = [];
      if (k === "group") acts.push(h("button", { class: "btn danger", text: "Leave chat", onclick: () => leave(id, close) }));
      if ((k === "channel" || k === "broadcast") && admin && id !== "general") acts.push(h("button", { class: "btn danger", text: "Delete channel", onclick: () => removeChannel(id, close) }));
      if (acts.length) out.push(h("div", { class: "cx-info-acts" }, ...acts));
      return out;
    }
    async function editChat(id) {
      const c = channelDoc(id), k = c.kind;
      const fields = [{ key: "name", label: k === "group" ? "Chat name" : "Channel name", required: true }, { key: "desc", label: "Description", type: "textarea", rows: 2 }];
      if (k !== "group") fields.push({ key: "kind", label: "Who can post", type: "select", options: [["channel", "Everyone"], ["broadcast", "Only admins (announcements)"]] });
      const v = await Apps.form(k === "group" ? "Edit chat" : "Edit channel", fields, { name: c.name, desc: c.desc, kind: k });
      if (!v) return;
      await ensureDoc(id);
      const patch = { name: id === "general" ? "general" : k === "group" ? v.name.trim() : slug(v.name), desc: v.desc || "" };
      if (k !== "group") patch.kind = v.kind === "broadcast" ? "broadcast" : "channel";
      Data.update("channels", id, patch);
      if (k === "group" && patch.name !== c.name) sysMsg(id, `${firstName(Data.me().name)} renamed the chat to “${patch.name}”`);
    }
    function addMembers(anchor, id) {
      const me = Data.me(), start = new Set(channelDoc(id).members);
      const api = Apps.peoplePicker(anchor, [...start].filter(k => k !== me.key), keys => {
        const c = channelDoc(id); if (!c) return;
        const cur = new Set(c.members), want = new Set([me.key, ...keys]);
        want.forEach(k => { if (!cur.has(k)) Data.arr("channels", id, "members", k, true); });
        cur.forEach(k => { if (!want.has(k) && k !== me.key) { Data.arr("channels", id, "members", k, false); if (c.admins.includes(k)) Data.arr("channels", id, "admins", k, false); } });
      }, { exclude: [me.key], placeholder: "Add or remove people…" });
      const orig = api.close;
      api.close = () => { // one note in the chat for the whole change
        if (api.closed) return;
        orig();
        const c = channelDoc(id); if (!c) return;
        const end = new Set(c.members), added = [...end].filter(k => !start.has(k)), removed = [...start].filter(k => !end.has(k));
        if (added.length) {
          sysMsg(id, `${firstName(me.name)} added ${names(added)}`);
          added.forEach(k => Data.notify(k, `👥 <b>${esc(me.name)}</b> added you to <b>${esc(c.name)}</b>`, "#/app/chat/" + encodeURIComponent(id)));
        }
        if (removed.length) sysMsg(id, `${firstName(me.name)} removed ${names(removed)}`);
      };
    }
    async function makeAdmin(id, key, on) {
      const c = channelDoc(id); if (!c) return;
      if (!on && adminsOf(c).length <= 1) return UI.toast("A chat needs at least one admin");
      await ensureDoc(id);
      if (on && !c.admins.length) for (const k of (c.by ? [c.by] : [meKey()])) await Data.arr("channels", id, "admins", k, true); // keep the current owner
      Data.arr("channels", id, "admins", key, on);
    }
    async function removeMember(id, key) {
      if (!await UI.confirm(`Remove ${person(key).name} from this chat?`, "Remove")) return;
      const c = channelDoc(id); if (!c) return;
      Data.arr("channels", id, "members", key, false);
      if (c.admins.includes(key)) Data.arr("channels", id, "admins", key, false);
      sysMsg(id, `${firstName(Data.me().name)} removed ${firstName(person(key).name)}`);
    }
    async function leave(id, close) {
      if (!await UI.confirm("Leave this chat? You won't see its messages unless someone adds you back.", "Leave")) return;
      const c = channelDoc(id), me = Data.me(); if (!c) return;
      const rest = c.members.filter(k => k !== me.key), adm = adminsOf(c);
      sysMsg(id, `${firstName(me.name)} left the chat`);
      if (!rest.length) Data.remove("channels", id);
      else {
        if (adm.length === 1 && adm[0] === me.key) Data.arr("channels", id, "admins", rest[0], true); // hand over before leaving
        Data.arr("channels", id, "members", me.key, false);
        if (c.admins.includes(me.key)) Data.arr("channels", id, "admins", me.key, false);
      }
      close(); select("general");
    }
    async function removeChannel(id, close) {
      const c = channelDoc(id);
      if (!c || !await UI.confirm(`Delete #${c.name} for everyone? Its messages will be hidden.`)) return;
      Data.remove("channels", id);
      close(); select("general");
    }

    /* ----- switching chats ----- */
    function select(id, opts = {}) {
      if (id !== active) {
        saveDraft(); stopTyping();
        active = id;
        openedReadAt = lastRead()[id] || 0; firstDraw = true; rendered = new Set(); stick = true;
        loadDraft();
      }
      focusMsg = opts.focus || null;
      chatEl.classList.remove("show-side");
      localStorage.setItem("lumen-chat-active", id);
      try { history.replaceState(null, "", "#/app/chat/" + encodeURIComponent(id)); } catch {} // keeps the deep link (and notify.js's "viewing" check) in step
      draw();
      if (!isPhone() && !opts.focus && canPost(id)) input.focus();
    }
    function draw() { pc.clear(); drawStream(); drawSide(); paintBadge(); }
    let raf = 0, ready = false;
    const schedule = () => { if (!ready || raf) return; raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
    // names, avatars and presence need a full redraw; typing and read times only touch small parts
    const peopleSigOf = () => Data.people().map(p => [p.key, p.name, p.avatar, p.photo, p.online, p.title].join("~")).join("|");
    function onPeople() {
      if (!ready) return;
      const sig = peopleSigOf();
      if (sig !== peopleSig) { peopleSig = sig; return schedule(); }
      pc.clear();
      const ts = typingSig();
      if (ts !== typSig) { typSig = ts; drawSide(); }
      paintTyping(); paintSeen();
    }

    draw();
    peopleSig = peopleSigOf();
    typSig = typingSig();
    const offs = [Data.on("chat", schedule), Data.on("channels", schedule), Data.on("people", onPeople)];
    ready = true;
    timers.push(setInterval(() => { pc.clear(); paintTyping(); const ts = typingSig(); if (ts !== typSig) { typSig = ts; drawSide(); } }, 2000));
    const onVis = () => { if (document.visibilityState === "visible") markSeen(); };
    document.addEventListener("visibilitychange", onVis);
    if (!isPhone() && canPost(active)) setTimeout(() => input.focus(), 100);
    return () => {
      stopTyping();
      offs.forEach(f => f()); filesOff && filesOff();
      timers.forEach(clearInterval); Object.values(readT).forEach(s => clearTimeout(s.timer));
      cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", onVis);
    };
  }

  Apps.register("chat", { title: "Chat & Calls", icon: "💬", render });
  Apps.onWorkspace.add(startBadge);
  setTimeout(startBadge, 0);

  /* Shared helper for notify.js and the bell: private chats stay private.
     canSee: DMs only for their two people; private channel docs (group chats) only for members; unknown or public → true.
     title: "Ana" for a DM, the name for a group chat, "#name" for a channel. kind: "dm" | "group" | "broadcast" | "channel". */
  window.ChatAccess = { canSee: (channelId, key) => canSee(channelId, key), title: channelId => titleOf(channelId), kind: channelId => kindOf(channelId) };
})();
