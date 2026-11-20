/* Home: a live "My day" dashboard — tasks, workday clock, agenda, quick chat, who's in/out, updates, pages */
(function () {
  const { h, esc } = UI;
  const T = () => Apps.today();
  const dmId = (a, b) => "dm:" + [a, b].sort().join("|");
  const readKey = () => "lumen-chat-read-" + (window.Cloud?.ws?.id || "local");
  const lastRead = () => { try { return JSON.parse(localStorage.getItem(readKey())) || {}; } catch { return {}; } };
  const card = (cls, title, icon, action, ...body) => h("section", { class: "hm-card glass " + cls },
    h("header", { class: "hm-h" }, h("span", { class: "hm-ic", text: icon }), h("h3", { text: title }), h("span", { class: "grow" }), action || null), ...body);
  const link = (text, onclick) => h("button", { class: "hm-link", text, onclick });
  const empty = (text, btn) => h("div", { class: "hm-empty" }, h("span", { text }), btn || null);

  function render(root) {
    const offs = [], timers = [];
    const me = () => Data.me();
    const cards = {};
    root.classList.add("hm");

    /* ---------- hero ---------- */
    const hero = h("section", { class: "hm-hero glass" });
    function drawHero() {
      const hr = new Date().getHours(), [greet, em] = hr < 5 ? ["Up late", "🌙"] : hr < 12 ? ["Good morning", "☀️"] : hr < 17 ? ["Good afternoon", "🌤️"] : ["Good evening", "🌙"];
      const m = me(), tasks = Data.list("tasks").filter(t => t.assignee === m.key && t.status !== "done");
      const today = tasks.filter(t => t.deadline === T()).length, overdue = tasks.filter(t => t.deadline && t.deadline < T()).length;
      const online = Data.people().filter(p => p.key !== m.key && p.online).length, events = Data.list("events").filter(e => e.date === T()).length;
      const bits = [today ? `${today} task${today > 1 ? "s" : ""} due today` : "nothing due today", overdue ? `${overdue} overdue` : null, events ? `${events} event${events > 1 ? "s" : ""}` : null, online ? `${online} teammate${online > 1 ? "s" : ""} online` : null].filter(Boolean);
      const act = (ic, label, fn) => h("button", { class: "hm-qa", onclick: fn }, h("span", { text: ic }), label);
      hero.replaceChildren(
        h("div", { class: "hm-hero-main" }, Apps.avatar(m, 64),
          h("div", null, h("div", { class: "hm-date", text: new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) + " · " + Store.getName() }),
            h("h1", null, (m.name && m.name !== "You" ? `${greet}, ${m.name.split(" ")[0]} ` : greet + " "), h("span", { class: "hm-wave", text: em })),
            h("p", { class: "hm-sum", text: "You have " + bits.join(" · ") + "." }))),
        h("div", { class: "hm-qas" },
          act("✅", "New task", () => Apps.Tasks.newTask()), act("📅", "Event", () => Apps.Calendar.editEvent()),
          act("📣", "Post", () => Apps.go("feed")), act("📹", "Video call", startCall), act("📄", "Page", () => App.newPage())));
    }
    function startCall() {
      const url = `https://meet.jit.si/Lumen-${(window.Cloud?.ws?.id || "local").slice(0, 10)}-general`;
      Data.add("chat", { channel: "general", kind: "call", url, text: "Video call", reactions: {} });
      open(url, "_blank", "noopener"); UI.toast("📹 Call started, posted in #general");
    }

    /* ---------- my tasks ---------- */
    let taskTab = "focus";
    cards.tasks = h("div");
    function drawTasks() {
      const m = me().key, mine = Data.list("tasks").filter(t => t.assignee === m);
      const open = mine.filter(t => t.status !== "done");
      const wk0 = Apps.addDays(T(), -((new Date().getDay() + 6) % 7)), wk1 = Apps.addDays(wk0, 6);
      const weekAll = mine.filter(t => (t.deadline >= wk0 && t.deadline <= wk1) || (t.status === "done" && t.completedAt > new Date(wk0 + "T00:00").getTime()));
      const weekDone = weekAll.filter(t => t.status === "done").length, pct = weekAll.length ? Math.round(weekDone / weekAll.length * 100) : 0;
      const list = (taskTab === "focus" ? open.filter(t => t.deadline && t.deadline <= Apps.addDays(T(), 2)) : taskTab === "upcoming" ? open.filter(t => !t.deadline || t.deadline > Apps.addDays(T(), 2)) : mine.filter(t => t.status === "done").sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)))
        .sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999")).slice(0, 7);
      const add = h("input", { class: "hm-add", placeholder: "+ Add a task for today" });
      add.onkeydown = async e => { if (e.key === "Enter" && add.value.trim()) { const title = add.value.trim(); add.value = ""; await Data.add("tasks", { title, status: "todo", priority: "normal", assignee: m, deadline: T(), checklist: [], comments: [] }); UI.toast("✅ Added"); } };
      const tabs = h("div", { class: "seg hm-seg" }, ...[["focus", `Focus (${open.filter(t => t.deadline && t.deadline <= Apps.addDays(T(), 2)).length})`], ["upcoming", "Upcoming"], ["done", "Done"]].map(([k, l]) =>
        h("button", { class: taskTab === k ? "on" : "", text: l, onclick: () => { taskTab = k; drawTasks(); } })));
      const ring = h("div", { class: "hm-ring", style: { "--p": pct }, title: `${weekDone} of ${weekAll.length} this week` }, h("b", { text: pct + "%" }), h("small", { text: "this week" }));
      const rows = list.map((t, i) => {
        const d = Apps.Tasks.due(t);
        return h("div", { class: "hm-task" + (t.status === "done" ? " done" : ""), style: { animationDelay: i * 40 + "ms" } },
          h("button", { class: "hm-check", title: t.status === "done" ? "Mark not done" : "Mark done", onclick: () => { Data.update("tasks", t.id, { status: t.status === "done" ? "todo" : "done", completedAt: t.status === "done" ? null : Date.now() }); if (t.status !== "done") UI.toast("🎉 Nice!"); } }),
          h("span", { class: "hm-tt", text: t.title, onclick: () => Apps.Tasks.openTask(t.id) }),
          t.deadline ? h("span", { class: "dl " + d, text: d === "overdue" ? "Overdue" : t.deadline === T() ? "Today" : Apps.fmtDate(t.deadline) }) : null);
      });
      cards.tasks.replaceChildren(card("hm-tasks", "My tasks", "✅", link("All tasks →", () => Apps.go("tasks")),
        h("div", { class: "hm-tasks-top" }, ring, h("div", { class: "grow" }, tabs, add)),
        h("div", { class: "hm-list" }, ...(rows.length ? rows : [empty(taskTab === "done" ? "Nothing finished yet — you've got this." : "All clear here 🎉")]))));
    }

    /* ---------- workday clock ---------- */
    cards.clock = h("div");
    const clockText = h("div", { class: "hm-clock-t" });
    function drawClock() {
      const C = Apps.Company, e = C.today(), s = C.state(e);
      const btn = (label, a, primary) => h("button", { class: "btn" + (primary ? " primary" : ""), text: label, onclick: () => C.clock(a) });
      clockText.textContent = C.hm(C.worked(e));
      cards.clock.replaceChildren(card("hm-clock " + s, "Workday", "⏱️", link("Report →", () => Apps.go("company", "time")),
        h("div", { class: "hm-clock-body" }, h("div", null, clockText, h("div", { class: "hm-sub", text: s === "off" ? "Not clocked in yet" : s === "working" ? "Working since " + new Date(e.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : s === "paused" ? "On a break" : "Day finished" })),
          h("div", { class: "hm-clock-btns" }, ...(s === "off" ? [btn("▶ Start day", "start", true)] : s === "working" ? [btn("⏸", "pause"), btn("⏹ End", "end", true)] : s === "paused" ? [btn("▶ Resume", "resume", true)] : [btn("↺ Continue", "reopen")])))));
    }

    /* ---------- agenda ---------- */
    cards.agenda = h("div");
    function drawAgenda() {
      const t = T(), tm = Apps.addDays(t, 1);
      const items = [
        ...Data.list("events").filter(e => e.date === t || e.date === tm || (e.end && e.date <= t && e.end >= t)).map(e => ({ day: e.date <= t ? t : e.date, time: e.start || "", title: e.title, color: e.color || "#7c5cff", open: () => Apps.Calendar.editEvent(e) })),
        ...Data.list("deals").filter(d => (d.close === t || d.close === tm) && !["won", "lost"].includes(d.stage)).map(d => ({ day: d.close, time: "", title: "💼 " + d.title, color: "#f59e0b", open: () => Apps.CRM.openRecord("deals", d.id) })),
      ].sort((a, b) => (a.day + (a.time || "99")).localeCompare(b.day + (b.time || "99")));
      const group = (day, label) => { const its = items.filter(i => i.day === day); return its.length ? [h("div", { class: "hm-day", text: label }), ...its.map(i => h("button", { class: "hm-ev", style: { "--c": i.color }, onclick: i.open }, h("b", { text: i.time || "All day" }), h("span", { text: i.title })))] : []; };
      const body = [...group(t, "Today"), ...group(tm, "Tomorrow")];
      cards.agenda.replaceChildren(card("hm-agenda", "Agenda", "📅", h("button", { class: "icon-btn xs", title: "New event", html: UI.icon("plus"), onclick: () => Apps.Calendar.editEvent() }),
        ...(body.length ? body : [empty("No events today or tomorrow.", h("button", { class: "btn", text: "+ Add event", onclick: () => Apps.Calendar.editEvent() }))]), link("Open calendar →", () => Apps.go("calendar"))));
    }

    /* ---------- quick chat ---------- */
    let chatWith = null;
    cards.chat = h("div");
    function drawChat() {
      const m = me().key, msgs = Data.list("chat"), r = lastRead(), ppl = Data.people().filter(p => p.key !== m);
      const unread = ch => msgs.filter(x => x.channel === ch && x.by !== m && x.at > (r[ch] || 0)).length;
      const ch = chatWith || "general";
      const chName = ch === "general" ? "# general" : Data.person(ch.slice(3).split("|").find(k => k !== m)).name;
      const people = h("div", { class: "hm-people" },
        h("button", { class: "hm-pp" + (ch === "general" ? " on" : ""), title: "#general", onclick: () => { chatWith = null; drawChat(); } },
          h("span", { class: "hm-pp-av" }, h("span", { class: "hm-hash", text: "#" }), unread("general") ? h("i", { text: unread("general") }) : null), h("small", { text: "general" })),
        ...ppl.map(p => { const id = dmId(m, p.key), u = unread(id); return h("button", { class: "hm-pp" + (ch === id ? " on" : ""), title: p.name + (p.online ? " · online" : ""), onclick: () => { chatWith = id; drawChat(); } },
          h("span", { class: "hm-pp-av" }, Apps.avatar(p, 36), u ? h("i", { text: u }) : null), h("small", { text: String(p.name || "").split(" ")[0] })); }));
      const recent = msgs.filter(x => x.channel === ch).sort((a, b) => a.at - b.at).slice(-5);
      const thread = h("div", { class: "hm-thread" }, ...(recent.length ? recent.map(x => h("div", { class: "hm-msg" + (x.by === m ? " mine" : "") }, Apps.avatar(Data.person(x.by), 22),
        h("div", { class: "hm-bubble" }, h("small", { text: Data.person(x.by).name.split(" ")[0] + " · " + new Date(x.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }), x.kind === "call" ? h("a", { href: x.url, target: "_blank", rel: "noopener", text: "📹 Join video call" }) : h("span", { text: x.text }))))
        : [empty(ch === "general" ? "Say hello to the team 👋" : `Start a conversation with ${chName}`)]));
      const input = h("input", { class: "hm-add", placeholder: `Message ${chName}…` });
      input.onkeydown = e => {
        if (e.key !== "Enter" || !input.value.trim()) return;
        const text = input.value.trim(); input.value = "";
        Data.add("chat", { channel: ch, text, reactions: {} });
        if (ch !== "general") { const other = ch.slice(3).split("|").find(k => k !== m); Data.notify(other, `💬 <b>${esc(me().name)}</b>: ${esc(text.slice(0, 80))}`, "#/app/chat/" + encodeURIComponent(ch)); }
      };
      // reading it here counts as read
      const rr = lastRead(); rr[ch] = Date.now(); localStorage.setItem(readKey(), JSON.stringify(rr));
      cards.chat.replaceChildren(card("hm-chat", "Quick chat", "💬", link("Open chat →", () => Apps.go("chat", ch === "general" ? "" : ch)), people, h("div", { class: "hm-chat-with", text: chName }), thread, input));
      setTimeout(() => { thread.scrollTop = thread.scrollHeight; });
      if (!ppl.length) cards.chat.querySelector(".hm-people").append(h("button", { class: "hm-pp", title: "Invite teammates", onclick: e => window.Cloud?.share(e.currentTarget) }, h("span", { class: "hm-pp-av" }, h("span", { class: "hm-invite", text: "+" })), h("small", { text: "Invite" })));
    }

    /* ---------- team today ---------- */
    cards.team = h("div");
    function drawTeam() {
      const ppl = Data.people(), m = me().key, t = T(), wk = Apps.addDays(t, 7);
      const abs = Data.list("absences"), ABS = Apps.Company.ABS;
      const outToday = abs.filter(a => a.from <= t && (a.to || a.from) >= t);
      const outSoon = abs.filter(a => a.from > t && a.from <= wk);
      const online = ppl.filter(p => p.online && p.key !== m);
      const working = ppl.filter(p => Apps.Company.state(Data.get("timelog", Apps.Company.entryId(p.key, t))) === "working");
      const bdays = ppl.filter(p => { if (!p.birthday) return false; const md = p.birthday.slice(5), now = new Date(); for (let i = 0; i <= 7; i++) { const d = new Date(now); d.setDate(now.getDate() + i); if (Apps.iso(d).slice(5) === md) return true; } return false; });
      const row = (p, sub, tag) => h("div", { class: "hm-person" }, Apps.avatar(p, 30), h("div", { class: "grow" }, h("b", { text: p.name + (p.key === m ? " (you)" : "") }), h("small", { text: sub })), tag || null,
        p.key !== m ? h("button", { class: "icon-btn xs", title: "Message", text: "💬", onclick: () => { chatWith = dmId(m, p.key); drawChat(); cards.chat.scrollIntoView({ behavior: "smooth", block: "nearest" }); } }) : null);
      const sec = (label, items) => items.length ? [h("div", { class: "hm-day", text: label }), ...items] : [];
      const body = [
        ...sec(`Online now · ${online.length}`, online.map(p => row(p, [p.title, working.includes(p) ? "🟢 working" : "online"].filter(Boolean).join(" · ")))),
        ...sec(`Out today · ${outToday.length}`, outToday.map(a => row(Data.person(a.who), (a.to && a.to !== a.from ? "until " + Apps.fmtDate(a.to) : "today") + (a.note ? " · " + a.note : ""), h("span", { class: "tag", dataset: { tc: "orange" }, text: ABS[a.type]?.[0] || "Away" })))),
        ...sec("Away this week", outSoon.map(a => row(Data.person(a.who), Apps.fmtDate(a.from) + (a.to && a.to !== a.from ? " – " + Apps.fmtDate(a.to) : ""), h("span", { class: "tag", dataset: { tc: "gray" }, text: ABS[a.type]?.[0] || "Away" })))),
        ...sec("🎂 Birthdays this week", bdays.map(p => row(p, Apps.fmtDate(new Date().getFullYear() + p.birthday.slice(4)))))];
      cards.team.replaceChildren(card("hm-team", "Team today", "👥", link("Directory →", () => Apps.go("company")),
        h("div", { class: "hm-team-stats" }, h("div", null, h("b", { text: ppl.length }), h("small", { text: "members" })), h("div", null, h("b", { text: online.length + (ppl.some(p => p.key === m) ? 1 : 0) }), h("small", { text: "online" })), h("div", null, h("b", { text: outToday.length }), h("small", { text: "out today" }))),
        ...(body.length ? body : [empty(ppl.length > 1 ? "Everyone's in, nobody online right now." : "It's just you here. Invite your team!", ppl.length > 1 ? null : h("button", { class: "btn primary", text: "Invite people", onclick: e => window.Cloud?.share(e.currentTarget) }))]),
        h("button", { class: "hm-link", text: "+ Request time off", onclick: () => Apps.go("company", "absence") })));
    }

    /* ---------- updates: feed + notifications ---------- */
    cards.updates = h("div");
    function drawUpdates() {
      const m = me().key;
      const posts = Data.list("feed").sort((a, b) => (b.kind === "announce" && b.pinned) - (a.kind === "announce" && a.pinned) || b.at - a.at).slice(0, 3);
      const notes = Data.list("notifications").filter(n => n.to === m && !n.read).sort((a, b) => b.at - a.at).slice(0, 4);
      cards.updates.replaceChildren(card("hm-updates", "Updates", "📰", link("Feed →", () => Apps.go("feed")),
        ...(notes.length ? [h("div", { class: "hm-day", text: `For you · ${notes.length}` }), ...notes.map(n => h("button", { class: "hm-note", onclick: () => { Data.update("notifications", n.id, { read: true }); if (n.link) location.hash = n.link; } }, h("span", { class: "hm-dot" }), h("span", { html: n.text }), h("small", { text: UI.timeAgo(n.at) })))] : []),
        h("div", { class: "hm-day", text: "From the feed" }),
        ...(posts.length ? posts.map(p => { const liked = (p.likes || []).includes(m); return h("div", { class: "hm-post" + (p.kind === "announce" ? " announce" : "") }, Apps.avatar(Data.person(p.by), 28),
          h("div", { class: "grow" }, h("div", { class: "hm-post-h" }, h("b", { text: Data.person(p.by).name }), h("small", { text: (p.kind === "announce" ? "📣 " : p.kind === "poll" ? "📊 " : "") + UI.timeAgo(p.at) })), h("div", { class: "hm-post-t", text: p.text })),
          h("button", { class: "hm-like" + (liked ? " on" : ""), onclick: () => Data.update("feed", p.id, { likes: liked ? p.likes.filter(k => k !== m) : [...(p.likes || []), m] }) }, (liked ? "❤️ " : "🤍 ") + ((p.likes || []).length || ""))); })
          : [empty("No posts yet.", h("button", { class: "btn", text: "Write the first post", onclick: () => Apps.go("feed") }))])));
    }

    /* ---------- pipeline (only when the CRM is in use) ---------- */
    cards.crm = h("div");
    function drawCrm() {
      const deals = Data.list("deals"); if (!deals.length) return cards.crm.replaceChildren();
      const open = deals.filter(d => !["won", "lost"].includes(d.stage)), month = new Date(); month.setDate(1);
      const won = deals.filter(d => d.stage === "won" && (d.closedAt || d.at) >= month.getTime());
      const soon = open.filter(d => d.close && d.close <= Apps.addDays(T(), 7)).sort((a, b) => a.close.localeCompare(b.close)).slice(0, 3);
      const sum = a => a.reduce((x, d) => x + (+d.amount || 0), 0);
      cards.crm.replaceChildren(card("hm-crm", "Pipeline", "💼", link("CRM →", () => Apps.go("crm")),
        h("div", { class: "hm-kpis" }, h("div", null, h("small", { text: "Open" }), h("b", { text: Apps.money(sum(open)) })), h("div", null, h("small", { text: "Won this month" }), h("b", { text: Apps.money(sum(won)) }))),
        ...(soon.length ? [h("div", { class: "hm-day", text: "Closing this week" }), ...soon.map(d => h("button", { class: "hm-ev", style: { "--c": "#f59e0b" }, onclick: () => Apps.CRM.openRecord("deals", d.id) }, h("b", { text: Apps.fmtDate(d.close) }), h("span", { text: d.title + " · " + Apps.money(d.amount) })))] : [])));
    }

    /* ---------- pages ---------- */
    cards.pages = h("div");
    function drawPages() {
      const all = Object.values(Store.state.pages).filter(p => !p.deleted);
      const recent = (Store.state.recent || []).map(Store.page).filter(p => p && !p.deleted);
      const list = [...new Set([...recent, ...all.filter(p => p.favorite), ...all.sort((a, b) => b.updatedAt - a.updatedAt)])].slice(0, 8);
      cards.pages.replaceChildren(card("hm-pages", "Jump back in", "📄", h("button", { class: "icon-btn xs", title: "Templates", text: "🧩", onclick: () => Page.templatesModal() }),
        h("div", { class: "hm-page-grid" }, ...list.map((p, i) => h("button", { class: "hm-page", style: { animationDelay: i * 40 + "ms" }, onclick: () => App.go(p.id) },
          h("div", { class: "hm-page-cover", style: { background: p.cover ? (p.cover.startsWith("url(") ? p.cover + " center/cover" : p.cover) : "var(--hover)" } }),
          h("span", { class: "hm-page-ic", text: p.icon || "📄" }), h("b", { text: p.title || "Untitled" }), h("small", { text: (p.favorite ? "⭐ " : "") + UI.timeAgo(p.updatedAt) }))),
          h("button", { class: "hm-page hm-new", onclick: () => App.newPage() }, h("span", { class: "hm-page-ic", text: "＋" }), h("b", { text: "New page" }), h("small", { text: "or press Ctrl Alt N" })))));
    }

    root.append(hero, h("div", { class: "hm-grid" }, cards.tasks, cards.clock, cards.agenda, cards.chat, cards.team, cards.updates, cards.crm, cards.pages));
    const all = () => { drawHero(); drawTasks(); drawClock(); drawAgenda(); drawChat(); drawTeam(); drawUpdates(); drawCrm(); drawPages(); };
    all();
    const typing = el => el.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
    const on = (col, ...fns) => offs.push(Data.on(col, () => fns.forEach(f => f())));
    on("tasks", drawHero, () => !typing(cards.tasks) && drawTasks());
    on("timelog", drawClock, drawTeam);
    on("events", drawHero, drawAgenda);
    on("deals", drawAgenda, drawCrm);
    on("chat", () => !typing(cards.chat) && drawChat());
    on("absences", drawTeam);
    on("people", drawHero, drawTeam, () => !typing(cards.chat) && drawChat());
    on("feed", drawUpdates); on("notifications", drawUpdates);
    timers.push(setInterval(() => { const C = Apps.Company; clockText.textContent = C.hm(C.worked(C.today())); }, 15000));
    timers.push(setInterval(() => { if (!typing(cards.chat)) drawChat(); drawTeam(); drawHero(); }, 60000)); // presence ages out
    return () => { offs.forEach(f => f()); timers.forEach(clearInterval); };
  }

  Apps.register("home", { title: "Home", icon: "🏠", render, hidden: true, noBanner: true });
})();
