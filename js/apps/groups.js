/* Workgroups (Bitrix24 "Projects"): spaces with their own feed, tasks, Scrum, calendar, drive, chat, members and privacy.
   A workgroup is a `projects` doc: name, desc, color, avatar, type (project|group|scrum), privacy (open|closed|secret), owner,
   moderators, members, requests (join requests), start, finish, chat (channels id), folder (folders id), archived,
   sprints [{ id, name, start, finish, goal, status, completedPoints, completedAt }], epics [{ id, name, color }].
   Tasks keep `project`; Scrum adds `sprint`, `points`, `epic`, `rank` to tasks. Old projects (no members) are open to everyone. */
(function () {
  const { h, esc } = UI;
  const TYPES = { project: ["📁", "Project", "Work with a goal and dates"], group: ["💬", "Group", "A team or topic space"], scrum: ["🏃", "Scrum", "Backlog, sprints, story points"] };
  const PRIV = { open: ["🌐", "Open", "Anyone can see it and join"], closed: ["🔒", "Closed", "Everyone sees it, people ask to join"], secret: ["🕶️", "Secret", "Only members know it exists"] };
  const COLORS = ["#7c5cff", "#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6"];
  const QUICK = ["🚀", "📁", "💡", "🎯", "🛠️", "📣", "🎨", "📊", "🧪", "💼", "🌱", "🏆"];
  const POINTS = [0, 1, 2, 3, 5, 8, 13];
  const STATUS = [["todo", "To do", "gray"], ["doing", "In progress", "blue"], ["review", "Review", "purple"], ["done", "Done", "green"]];
  const TABS = [["feed", "📰 Feed"], ["tasks", "✅ Tasks"], ["scrum", "🏃 Scrum"], ["calendar", "📅 Calendar"], ["drive", "🗂️ Drive"], ["members", "👥 Members"], ["about", "ℹ️ About"]];
  const GATED = new Set(["feed", "tasks", "scrum", "calendar", "drive"]);
  const DEPS = { feed: ["feed", "files"], tasks: ["tasks"], scrum: ["tasks"], calendar: ["events", "tasks"], drive: ["files", "folders"], members: [], about: ["tasks"] };
  const MAX_FILE = 700 * 1024;
  const LINK = (id, tab) => "#/app/groups/" + encodeURIComponent(id) + (tab ? "/" + tab : "");
  const ls = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const meKey = () => Data.me().key;
  const T = () => Apps.today();
  const firstName = k => (Data.person(k).name || "").split(" ")[0];
  const uniq = a => [...new Set((a || []).filter(Boolean))];
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const dayDiff = (a, b) => Math.round((new Date(b + "T00:00") - new Date(a + "T00:00")) / 864e5);
  const mondayOf = d => Apps.addDays(d, -((new Date(d + "T00:00").getDay() + 6) % 7));
  const st = k => STATUS.find(s => s[0] === (k || "todo")) || STATUS[0];

  /* ---------- membership & visibility ---------- */
  const isOld = p => !Array.isArray(p.members); // created before workgroups: everyone is in it
  const ownerOf = p => p.owner || p.by || "";
  const mods = p => (p.moderators || []).filter(Boolean);
  const membersOf = p => isOld(p) ? Data.people().map(x => x.key) : uniq([ownerOf(p), ...mods(p), ...p.members]);
  const isMember = (p, k = meKey()) => !!p && (isOld(p) || ownerOf(p) === k || mods(p).includes(k) || p.members.includes(k));
  const roleOf = (p, k = meKey()) => !p ? "" : ownerOf(p) === k ? "owner" : mods(p).includes(k) ? "moderator" : isMember(p, k) ? "member" : (p.requests || []).includes(k) ? "requested" : "";
  const privacy = p => PRIV[p.privacy] ? p.privacy : "open";
  const canSee = p => !!p && (isOld(p) || privacy(p) !== "secret" || isMember(p));
  const canRead = p => !!p && (isOld(p) || isMember(p) || privacy(p) === "open");
  const isAdmin = () => { try { return !!Apps.isAdmin?.(); } catch { return false; } };
  const canManage = (p, k = meKey()) => !!p && (isOld(p) || !ownerOf(p) || ownerOf(p) === k || mods(p).includes(k) || isAdmin());
  const isOwner = p => !!p && (isOld(p) || !ownerOf(p) || ownerOf(p) === meKey() || isAdmin());
  const mine = () => Data.list("projects").filter(canSee);
  const avatarOf = p => p.avatar || (TYPES[p.type] || TYPES.project)[0];
  const typeOf = p => TYPES[p.type] ? p.type : "project";
  const ROLE_L = { owner: "Owner", moderator: "Moderator", member: "Member", requested: "Requested" };

  /* ---------- tasks helpers ---------- */
  const allTasks = () => Apps.liveTasks ? Apps.liveTasks() : Data.list("tasks").filter(t => !t.deleted && t.kind !== "template");
  const groupTasks = id => allTasks().filter(t => t.project === id);
  const due = t => Apps.Tasks?.due ? Apps.Tasks.due(t) : !t.deadline ? "none" : t.status === "done" ? "done" : t.deadline < T() ? "overdue" : t.deadline === T() ? "today" : "later";
  const newTask = preset => Apps.Tasks?.newTask ? Apps.Tasks.newTask(preset) : UI.toast("Tasks aren't available right now");
  const openTask = id => Apps.Tasks?.openTask ? Apps.Tasks.openTask(id) : (location.hash = "#/app/tasks/" + id);
  const setStatus = (t, k) => Apps.Tasks?.setStatus ? Apps.Tasks.setStatus(t, k) : Data.update("tasks", t.id, { status: k, completedAt: k === "done" ? Date.now() : null });
  const pts = t => +t.points || 0;
  const sumPts = list => list.reduce((a, t) => a + pts(t), 0);
  const rank = t => typeof t.rank === "number" ? t.rank : (t.at || 0);
  const byRank = (a, b) => rank(a) - rank(b);
  function stats(id) {
    const ts = groupTasks(id), done = ts.filter(t => t.status === "done").length;
    return { total: ts.length, done, open: ts.length - done, overdue: ts.filter(t => t.status !== "done" && t.deadline && t.deadline < T()).length, pct: ts.length ? Math.round(done / ts.length * 100) : 0 };
  }

  /* ---------- notifications ---------- */
  const who = () => `<b>${esc(Data.me().name)}</b>`;
  const tellMembers = (p, html, link, preview, except = []) => membersOf(p).filter(k => k !== meKey() && !except.includes(k)).forEach(k => Data.notify(k, html, link, preview));

  /* ---------- group chat & folder (created with the group, or on first use for older projects) ---------- */
  async function ensureChat(p) {
    p = Data.get("projects", p.id) || p;
    if (p.chat) return p.chat;
    const id = await Data.add("channels", { name: p.name || "Workgroup", desc: p.desc || "", kind: "group", private: true, members: membersOf(p), admins: [ownerOf(p) || meKey()] });
    await Data.update("projects", p.id, { chat: id });
    return id;
  }
  async function ensureFolder(p) {
    p = Data.get("projects", p.id) || p;
    if (p.folder) return p.folder;
    const id = await Data.add("folders", { name: p.name || "Workgroup", parent: "" });
    await Data.update("projects", p.id, { folder: id });
    return id;
  }
  function syncChat(p) {
    if (!p || !p.chat || isOld(p)) return;
    Data.update("channels", p.chat, { name: p.name, members: membersOf(p), admins: [ownerOf(p)].filter(Boolean) });
  }

  /* ---------- join, leave, members ---------- */
  function join(p) {
    p = Data.get("projects", p.id) || p;
    const me = Data.me(), heads = uniq([ownerOf(p), ...mods(p)]);
    if (isMember(p)) return;
    if (privacy(p) === "open") {
      Data.arr("projects", p.id, "members", me.key);
      if (p.chat) Data.arr("channels", p.chat, "members", me.key);
      heads.forEach(k => Data.notify(k, `👋 ${who()} joined <b>${esc(p.name)}</b>`, LINK(p.id, "members")));
      UI.toast("👋 You joined " + p.name);
    } else {
      Data.arr("projects", p.id, "requests", me.key);
      heads.forEach(k => Data.notify(k, `🙋 ${who()} asked to join <b>${esc(p.name)}</b>`, LINK(p.id, "members"), "Open the workgroup to approve or decline"));
      UI.toast("🙋 Request sent. You'll be notified when it's approved");
    }
  }
  const cancelRequest = p => { Data.arr("projects", p.id, "requests", meKey(), false); UI.toast("Request cancelled"); };
  function approve(p, k) {
    Data.arr("projects", p.id, "members", k);
    Data.arr("projects", p.id, "requests", k, false);
    if (p.chat) Data.arr("channels", p.chat, "members", k);
    Data.notify(k, `✅ ${who()} approved your request to join <b>${esc(p.name)}</b>`, LINK(p.id));
    UI.toast(`✅ ${firstName(k)} joined ${p.name}`);
  }
  function decline(p, k) {
    Data.arr("projects", p.id, "requests", k, false);
    Data.notify(k, `Your request to join <b>${esc(p.name)}</b> was declined`, "#/app/groups");
    UI.toast("Request declined");
  }
  function addMember(p, k, silent) {
    Data.arr("projects", p.id, "members", k);
    if ((p.requests || []).includes(k)) Data.arr("projects", p.id, "requests", k, false);
    if (p.chat) Data.arr("channels", p.chat, "members", k);
    if (!silent) Data.notify(k, `👥 ${who()} added you to the workgroup <b>${esc(p.name)}</b>`, LINK(p.id), p.desc || "");
  }
  function removeMember(p, k, silent) {
    Data.arr("projects", p.id, "members", k, false);
    if (mods(p).includes(k)) Data.arr("projects", p.id, "moderators", k, false);
    if (p.chat) Data.arr("channels", p.chat, "members", k, false);
    if (!silent) Data.notify(k, `${who()} removed you from <b>${esc(p.name)}</b>`, "#/app/groups");
  }
  async function leave(p) {
    if (ownerOf(p) === meKey()) return UI.toast("You own this group. Make someone else the owner first (Members tab)");
    if (!(await UI.confirm(`Leave “${p.name}”? You'll stop seeing its ${privacy(p) === "open" ? "updates" : "posts, tasks and files"}.`, "Leave"))) return;
    removeMember(p, meKey(), true);
    UI.toast("You left " + p.name);
  }
  function invite(anchor, p) {
    let prev = [];
    Apps.peoplePicker(anchor, [], ks => {
      const g = Data.get("projects", p.id) || p;
      ks.filter(k => !prev.includes(k)).forEach(k => addMember(g, k));
      prev.filter(k => !ks.includes(k)).forEach(k => removeMember(g, k, true));
      prev = ks;
    }, { exclude: membersOf(p), placeholder: "Invite people…" });
  }
  async function makeOwner(p, k) {
    if (!(await UI.confirm(`Make ${Data.person(k).name} the owner of “${p.name}”? You'll stay on as a moderator.`, "Make owner"))) return;
    const old = ownerOf(p);
    await Data.update("projects", p.id, { owner: k, moderators: uniq([...mods(p).filter(x => x !== k), old]), members: uniq([...(p.members || []), k]) });
    syncChat(Data.get("projects", p.id));
    Data.notify(k, `👑 ${who()} made you the owner of <b>${esc(p.name)}</b>`, LINK(p.id, "members"));
  }
  async function archive(p) {
    Data.update("projects", p.id, { archived: !p.archived });
    UI.toast(p.archived ? "📂 Restored from the archive" : "🗄 Archived. Find it under Archived");
  }
  async function removeGroup(p) {
    if (!(await UI.confirm(`Delete “${p.name}”? Its feed posts and group chat are deleted. Tasks stay in Tasks and files stay in Drive.`, "Delete group"))) return;
    Data.list("feed").filter(x => x.group === p.id).forEach(x => Data.remove("feed", x.id));
    if (p.chat) Data.remove("channels", p.chat);
    Data.remove("projects", p.id);
    UI.toast("Workgroup deleted");
    if (location.hash.startsWith("#/app/groups/")) location.hash = "#/app/groups";
  }

  /* ---------- create / edit ---------- */
  function editGroup(p0, preset = {}) {
    if (!p0 && Apps.can && !Apps.can("groups", "edit")) { UI.toast("You can't create workgroups in this workspace"); return Promise.resolve(null); }
    return new Promise(resolve => {
      const isNew = !p0, me = meKey(), p = p0 ? (Data.get("projects", p0.id) || p0) : {};
      const own0 = ownerOf(p) || me;
      const v = {
        name: p.name || preset.name || "", desc: p.desc || preset.desc || "", type: TYPES[p.type || preset.type] ? (p.type || preset.type) : "project",
        avatar: p.avatar || preset.avatar || (p.id ? avatarOf(p) : "🚀"), color: p.color || preset.color || COLORS[0], privacy: p.id ? privacy(p) : (PRIV[preset.privacy] ? preset.privacy : "open"),
        start: p.start || "", finish: p.finish || "", owner: own0, moderators: mods(p).filter(k => k !== own0),
        members: p.id ? membersOf(p).filter(k => k !== own0 && !mods(p).includes(k)) : (preset.members || []).filter(k => k !== me),
      };
      let done = false;
      const field = (label, ...kids) => h("div", { class: "gr-f" }, h("span", { class: "gr-f-l", text: label }), ...kids);
      const avBtn = h("button", { type: "button", class: "gr-ed-av", title: "Choose an icon" });
      const paintAv = () => { avBtn.textContent = v.avatar; avBtn.style.setProperty("--gc", v.color); };
      avBtn.onclick = () => UI.emojiPicker(avBtn, e => { if (e) { v.avatar = e; paintAv(); } });
      const quick = h("div", { class: "gr-ed-quick" }, ...QUICK.map(e => h("button", { type: "button", text: e, onclick: () => { v.avatar = e; paintAv(); } })));
      const name = h("input", { class: "menu-input gr-ed-name", placeholder: "Workgroup name", maxlength: 80, value: v.name }); name.oninput = () => (v.name = name.value);
      const desc = h("textarea", { class: "menu-input f-ta", rows: 3, placeholder: "What is this group about?" }); desc.value = v.desc; desc.oninput = () => (v.desc = desc.value);
      const choices = (map, key) => {
        const box = h("div", { class: "gr-choices" });
        const paint = () => box.replaceChildren(...Object.entries(map).map(([k, [ic, l, sub]]) => h("button", { type: "button", class: "gr-choice" + (v[key] === k ? " on" : ""), onclick: () => { v[key] = k; paint(); paintDates(); } },
          h("span", { class: "gr-ch-ic", text: ic }), h("b", { text: l }), h("small", { text: sub }))));
        paint(); return box;
      };
      const typeBox = choices(TYPES, "type"), privBox = choices(PRIV, "privacy");
      const colors = h("div", { class: "accents" }, ...COLORS.map(c => h("button", { type: "button", class: v.color === c ? "on" : "", style: { background: c, color: c }, onclick: e => { v.color = c; paintAv(); colors.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.currentTarget)); } })));
      const dIn = key => { const i = h("input", { type: "date", class: "menu-input", value: v[key] }); i.onchange = () => (v[key] = i.value); return i; };
      const dates = h("div", { class: "gr-ed-row" }, field("Start", dIn("start")), field("Finish", dIn("finish")));
      function paintDates() { dates.style.display = v.type === "group" ? "none" : ""; }
      const ownerBtn = h("button", { type: "button", class: "menu-input f-person" });
      const paintOwner = () => ownerBtn.replaceChildren(Apps.avatar(Data.person(v.owner), 20), h("span", { text: Data.person(v.owner).name + (v.owner === me ? " (you)" : "") }));
      const pBtn = (key, ph) => {
        const b = h("button", { type: "button", class: "menu-input f-person" });
        const paint = () => { const ks = v[key]; b.replaceChildren(ks.length ? Apps.avatars(ks, 20, 6) : "", h("span", { text: ks.length ? ks.map(firstName).join(", ") : ph })); };
        b.onclick = () => Apps.peoplePicker(b, v[key], ks => { v[key] = ks.filter(k => k !== v.owner); paint(); }, { exclude: [v.owner] });
        paint(); b.paint = paint; return b;
      };
      const modBtn = pBtn("moderators", "Add moderators…"), memBtn = pBtn("members", "Add members…");
      if (isNew || isOwner(p)) ownerBtn.onclick = () => Apps.personPicker(ownerBtn, x => { if (!x) return; v.owner = x.key; v.moderators = v.moderators.filter(k => k !== x.key); v.members = v.members.filter(k => k !== x.key); paintOwner(); modBtn.paint(); memBtn.paint(); });
      else { ownerBtn.disabled = true; ownerBtn.title = "Only the owner can hand the group over"; }
      const save = h("button", { type: "button", class: "btn primary", text: isNew ? "Create workgroup" : "Save" });
      const body = h("div", { class: "gr-ed" },
        h("div", { class: "gr-ed-top" }, avBtn, h("div", { class: "gr-ed-topr" }, name, quick)),
        field("Description", desc),
        field("Type", typeBox),
        field("Privacy", privBox),
        dates,
        h("div", { class: "gr-ed-row" }, field("Owner", ownerBtn), field("Colour", colors)),
        h("div", { class: "gr-ed-row" }, field("Moderators", modBtn), field("Members", memBtn)),
        isOld(p) && p.id ? h("div", { class: "gr-hint", text: "This project is open to everyone in the workspace. Saving makes the people above its members." }) : null,
        h("div", { class: "f-actions" }, h("span"), h("span", { style: { display: "flex", gap: "8px" } }, h("button", { type: "button", class: "btn", text: "Cancel", onclick: () => m.close() }), save)));
      name.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); save.click(); } });
      save.onclick = async () => {
        const nm = v.name.trim();
        if (!nm) { name.focus(); return UI.toast("Give the workgroup a name"); }
        if (v.type !== "group" && v.start && v.finish && v.finish < v.start) return UI.toast("The finish date is before the start date");
        const moderators = uniq(v.moderators).filter(k => k !== v.owner), members = uniq([v.owner, ...moderators, ...v.members]);
        const rec = { name: nm, desc: v.desc.trim(), type: v.type, avatar: v.avatar, color: v.color, privacy: v.privacy,
          start: v.type === "group" ? "" : v.start || "", finish: v.type === "group" ? "" : v.finish || "", owner: v.owner, moderators, members };
        done = true; m.close();
        if (isNew) {
          const id = await Data.add("projects", { ...rec, archived: false, sprints: [], epics: [], requests: [] });
          const chat = await Data.add("channels", { name: nm, desc: rec.desc, kind: "group", private: true, members, admins: [v.owner] });
          const folder = await Data.add("folders", { name: nm, parent: "" });
          await Data.update("projects", id, { chat, folder });
          members.filter(k => k !== me).forEach(k => Data.notify(k, `👥 ${who()} added you to the workgroup <b>${esc(nm)}</b>`, LINK(id), rec.desc));
          UI.toast("👥 Workgroup created");
          resolve(id);
        } else {
          const before = isOld(p) ? null : membersOf(p);
          await Data.update("projects", p.id, { ...rec, requests: (p.requests || []).filter(k => !members.includes(k)) });
          const g = Data.get("projects", p.id);
          syncChat(g);
          if (g.folder && nm !== p.name) Data.update("folders", g.folder, { name: nm });
          if (before) members.filter(k => k !== me && !before.includes(k)).forEach(k => Data.notify(k, `👥 ${who()} added you to the workgroup <b>${esc(nm)}</b>`, LINK(p.id), rec.desc));
          UI.toast("✅ Saved");
          resolve(p.id);
        }
      };
      const m = UI.modal(isNew ? "New workgroup" : "Edit workgroup", body, { className: "gr-ed-modal", onClose: () => { if (!done) resolve(null); } });
      m.el.style.width = "660px";
      paintAv(); paintOwner(); paintDates();
      setTimeout(() => name.focus(), 60);
    });
  }

  /* ---------- small UI bits ---------- */
  const privBadge = p => { const [ic, l] = PRIV[privacy(p)]; return h("span", { class: "gr-priv", dataset: { p: privacy(p) }, title: PRIV[privacy(p)][2], text: ic + " " + l }); };
  const roleChip = p => { const r = roleOf(p); return r ? h("span", { class: "gr-role", dataset: { r }, text: ROLE_L[r] }) : null; };
  const stTag = t => h("span", { class: "tag", dataset: { tc: st(t.status)[2] }, text: st(t.status)[1] });
  function dropZone(el, onDrop) {
    el.addEventListener("dragover", e => { e.preventDefault(); el.classList.add("drop"); });
    el.addEventListener("dragleave", e => { if (!el.contains(e.relatedTarget)) el.classList.remove("drop"); });
    el.addEventListener("drop", e => { e.preventDefault(); el.classList.remove("drop"); const id = e.dataTransfer.getData("text/task"); if (id) onDrop(id); });
  }
  function dragify(el, id) {
    el.addEventListener("dragstart", e => { e.stopPropagation(); e.dataTransfer.setData("text/task", id); e.dataTransfer.effectAllowed = "move"; el.classList.add("dragging"); });
    el.addEventListener("dragend", () => { el.classList.remove("dragging"); document.querySelectorAll(".gr-over").forEach(x => x.classList.remove("gr-over")); });
  }
  function rich(s) {
    const handles = new Set(Data.people().map(p => Apps.handleOf ? Apps.handleOf(p) : "").filter(Boolean));
    return esc(s).replace(/(https?:\/\/[^\s<]+)|(^|[\s(])@([\w.-]+)/g, (m, url, pre, name) => {
      if (url) return `<a href="${url}" target="_blank" rel="noopener">${url}</a>`;
      const hd = name.replace(/[.-]+$/, ""), rest = name.slice(hd.length);
      return handles.has(hd.toLowerCase()) ? `${pre}<span class="fd-mention">@${hd}</span>${rest}` : m;
    }).replace(/\n/g, "<br>");
  }
  function filesBlock(files) {
    files = (files || []).filter(Boolean); if (!files.length) return null;
    const imgs = files.filter(a => /^image\//.test(a.type || "") && Data.get("files", a.id)?.data), other = files.filter(a => !imgs.includes(a));
    return h("div", { class: "fd-files" },
      imgs.length ? h("div", { class: "fd-grid n" + Math.min(imgs.length, 4) }, ...imgs.slice(0, 4).map((a, i) => h("button", { class: "fd-thumb", type: "button", title: a.name, onclick: () => Apps.openFile(a) },
        h("img", { src: Data.get("files", a.id).data, alt: a.name, loading: "lazy" }), i === 3 && imgs.length > 4 ? h("span", { class: "fd-more", text: "+" + (imgs.length - 4) }) : null))) : null,
      other.length ? h("div", { class: "fd-chips" }, ...other.map(a => Apps.fileChip(a))) : null);
  }

  /* ---------- charts (SVG burndown, velocity bars) ---------- */
  function burn(g, s) {
    const tasks = groupTasks(g.id).filter(t => t.sprint === s.id), total = sumPts(tasks);
    const start = s.start || T(), finish = s.finish && s.finish >= start ? s.finish : Apps.addDays(start, 13);
    const days = []; for (let d = start; d <= finish && days.length < 120; d = Apps.addDays(d, 1)) days.push(d);
    const limit = s.status === "done" ? (s.completedAt ? Apps.iso(new Date(s.completedAt)) : finish) : T();
    const actual = days.filter(d => d <= limit).map(d => {
      const end = new Date(d + "T23:59:59").getTime();
      return total - sumPts(tasks.filter(t => t.status === "done" && t.completedAt && t.completedAt <= end));
    });
    return { days, total, actual, left: total - sumPts(tasks.filter(t => t.status === "done")), tasks };
  }
  function burnChart(b, small) {
    if (!b.total) return h("div", { class: "gr-chart-empty", text: "Add story points to this sprint's tasks to see the burndown." });
    const W = 600, H = small ? 170 : 250, L = 34, R = 14, Tp = 12, B = 28;
    const n = Math.max(1, b.days.length - 1), max = Math.max(1, b.total);
    const x = i => (L + (W - L - R) * i / n).toFixed(1), y = v => (Tp + (H - Tp - B) * (1 - v / max)).toFixed(1);
    const grid = [0, .25, .5, .75, 1].map(k => { const v = Math.round(max * k); return `<line class="g" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="lab" x="${L - 6}" y="${+y(v) + 4}" text-anchor="end">${v}</text>`; }).join("");
    const lab = i => `<text class="lab" x="${x(i)}" y="${H - 8}" text-anchor="${i === 0 ? "start" : i === n ? "end" : "middle"}">${esc(Apps.fmtDate(b.days[i]))}</text>`;
    const xl = [...new Set([0, Math.round(n / 2), n])].map(lab).join("");
    const pts = b.actual.map((v, i) => `${x(i)},${y(v)}`).join(" ");
    const last = b.actual.length - 1;
    const area = b.actual.length > 1 ? `<polygon class="area" points="${x(0)},${y(0)} ${pts} ${x(last)},${y(0)}"/>` : "";
    const ti = b.days.indexOf(T());
    const today = ti >= 0 ? `<line class="today" x1="${x(ti)}" x2="${x(ti)}" y1="${Tp}" y2="${H - B}"/>` : "";
    const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Burndown chart">${grid}${today}
      <line class="ideal" x1="${x(0)}" y1="${y(b.total)}" x2="${x(n)}" y2="${y(0)}"/>${area}
      ${b.actual.length ? `<polyline class="actual" points="${pts}"/><circle class="dot" cx="${x(last)}" cy="${y(b.actual[last])}" r="4.5"/>` : ""}${xl}</svg>`;
    return h("div", { class: "gr-chart" + (small ? " small" : "") }, h("div", { class: "gr-chart-svg", html: svg }),
      h("div", { class: "gr-legend" }, h("span", { class: "ideal" }, "Ideal"), h("span", { class: "actual" }, "Remaining"), h("b", { text: `${b.left} of ${b.total} points left` })));
  }
  const sprintPoints = (g, s) => s.completedPoints != null ? s.completedPoints : sumPts(groupTasks(g.id).filter(t => t.sprint === s.id && t.status === "done"));
  function velocityChart(g) {
    const done = (g.sprints || []).filter(s => s.status === "done").slice(-8);
    if (!done.length) return h("div", { class: "gr-chart-empty", text: "Velocity shows up after your first completed sprint." });
    const vals = done.map(s => sprintPoints(g, s)), max = Math.max(1, ...vals), avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    return h("div", { class: "gr-vel-wrap" },
      h("div", { class: "gr-vel" }, ...done.map((s, i) => h("div", { class: "gr-vel-col", title: `${s.name}: ${vals[i]} points` },
        h("b", { text: vals[i] }), h("div", { class: "gr-vel-bar", style: { height: Math.max(3, vals[i] / max * 100) + "%", animationDelay: i * 60 + "ms" } }), h("small", { text: s.name })))),
      h("div", { class: "gr-legend" }, h("b", { text: `Average velocity: ${avg} points per sprint` })));
  }

  /* ---------- calendar: add an event tagged with the group ---------- */
  function addEvent(p, date) {
    if (!Apps.Calendar?.editEvent) return UI.toast("The calendar isn't available right now");
    const me = meKey(), since = Date.now();
    const attendees = Object.fromEntries(membersOf(p).filter(k => k !== me).map(k => [k, "pending"]));
    Apps.Calendar.editEvent({ owner: me, attendees, color: p.color }, date);
    // the calendar editor keeps only its own fields: tag the new event with the group once the editor closes
    const box = [...document.querySelectorAll("#layer .cal-ed-modal")].pop(), bd = box && box.parentElement, layer = document.getElementById("layer");
    if (!bd || !layer) return;
    const tag = () => {
      const ev = Data.list("events").filter(e => !e.kind && !e.project && (e.owner || e.by) === me && (e.at || 0) >= since).sort((a, b) => (b.at || 0) - (a.at || 0))[0];
      if (!ev) return;
      Data.update("events", ev.id, { project: p.id });
      const g = Data.get("projects", p.id) || p;
      Object.keys(ev.attendees || {}).filter(k => k !== me).forEach(k => Data.notify(k, `📅 ${who()} invited you to “${esc(ev.title)}” in <b>${esc(g.name)}</b>`, LINK(p.id, "calendar"),
        Apps.fmtDate(ev.date) + (ev.start ? " · " + ev.start : "")));
    };
    const mo = new MutationObserver(() => { if (!bd.isConnected) { mo.disconnect(); setTimeout(tag, 60); } });
    mo.observe(layer, { childList: true });
  }

  /* =====================================================================
     List of workgroups
     ===================================================================== */
  function listView(root) {
    let filter = ls("lumen-groups-filter", "mine"), q = "";
    if (!["mine", "all", "archived"].includes(filter)) filter = "mine";
    const body = h("div", { class: "gr-list-body" }), reqBox = h("div");
    const seg = h("div", { class: "seg gr-filter" }, ...[["mine", "My groups"], ["all", "All"], ["archived", "Archived"]].map(([k, l]) => h("button", { class: filter === k ? "on" : "", text: l, onclick: e => {
      filter = k; lsSet("lumen-groups-filter", k); seg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.currentTarget)); draw(); } })));
    const search = h("input", { class: "app-search", placeholder: "Search workgroups…", oninput: e => { q = e.target.value.toLowerCase(); draw(); } });
    const create = async () => { const id = await editGroup(null); if (id) open(id); };
    root.append(Apps.header("Workgroups", "👥", "Project spaces with their own feed, tasks, calendar and files", h("button", { class: "btn primary", text: "+ Create", onclick: create })),
      reqBox, h("div", { class: "app-toolbar" }, seg, h("span", { class: "grow" }), search), body);

    function requests() {
      const me = meKey(), rows = [];
      Data.list("projects").filter(p => !p.archived && (ownerOf(p) === me || mods(p).includes(me))).forEach(p => (p.requests || []).forEach(k => rows.push([p, k])));
      if (!rows.length) return reqBox.replaceChildren();
      reqBox.replaceChildren(h("div", { class: "gr-reqs glass" }, h("div", { class: "td-sec", text: `Join requests (${rows.length})` }),
        ...rows.map(([p, k]) => h("div", { class: "gr-req" }, Apps.avatar(Data.person(k), 30),
          h("span", { class: "gr-req-t" }, h("b", { text: Data.person(k).name }), " wants to join ", h("a", { href: LINK(p.id, "members"), text: avatarOf(p) + " " + p.name })),
          h("button", { class: "btn primary", text: "Approve", onclick: () => approve(p, k) }), h("button", { class: "btn", text: "Decline", onclick: () => decline(p, k) })))));
    }
    function card(p, i) {
      const s = stats(p.id), ms = membersOf(p), r = roleOf(p), [tIc, tL] = TYPES[typeOf(p)];
      const reqN = (ownerOf(p) === meKey() || mods(p).includes(meKey())) ? (p.requests || []).length : 0;
      const joinBtn = !isMember(p) && !p.archived ? (r === "requested" ? h("button", { class: "btn gr-card-btn", text: "⏳ Requested", onclick: e => { e.stopPropagation(); cancelRequest(p); } })
        : h("button", { class: "btn primary gr-card-btn", text: privacy(p) === "open" ? "Join" : "Request to join", onclick: e => { e.stopPropagation(); join(p); } })) : null;
      return h("div", { class: "gr-card glass" + (p.archived ? " archived" : ""), style: { "--gc": p.color || COLORS[0], animationDelay: Math.min(i, 14) * 40 + "ms" }, role: "button", tabindex: 0,
        onclick: () => open(p.id), onkeydown: e => { if (e.key === "Enter") open(p.id); } },
        h("div", { class: "gr-card-top" }, h("span", { class: "gr-av", text: avatarOf(p) }),
          h("div", { class: "gr-card-t" }, h("b", { text: p.name || "Untitled group" }), h("small", { text: `${tIc} ${tL}${p.finish ? " · until " + Apps.fmtDate(p.finish) : ""}` })), privBadge(p)),
        h("div", { class: "gr-card-desc", text: p.desc || "No description" }),
        h("div", { class: "gr-card-mid" }, Apps.avatars(ms, 24, 5), h("small", { class: "gr-mute", text: plural(ms.length, "member") }), h("span", { class: "grow" }), roleChip(p),
          reqN ? h("span", { class: "gr-req-n", title: "Join requests", text: "🙋 " + reqN }) : null),
        canRead(p) ? h("div", { class: "progress" }, h("span", { style: { width: s.pct + "%" } })) : null,
        h("div", { class: "gr-card-foot" }, canRead(p) ? h("span", { text: `${plural(s.open, "open task")} · ${s.pct}% done` }) : h("span", { text: "🔒 Members only" }),
          s.overdue && canRead(p) ? h("span", { class: "gr-late", text: `${s.overdue} overdue` }) : null, h("span", { class: "grow" }), joinBtn));
    }
    function draw() {
      requests();
      const me = meKey();
      const list = mine().filter(p => !q || ((p.name || "") + " " + (p.desc || "")).toLowerCase().includes(q))
        .filter(p => filter === "archived" ? p.archived : !p.archived && (filter === "all" || isMember(p, me)))
        .sort((a, b) => (isMember(b) - isMember(a)) || String(a.name || "").localeCompare(String(b.name || "")));
      if (!list.length) return body.replaceChildren(Apps.empty(filter === "archived" ? "🗄" : "👥",
        q ? "No workgroups match." : filter === "archived" ? "No archived workgroups." : filter === "mine" ? "You're not in any workgroups yet." : "No workgroups yet.",
        filter !== "archived" && !q ? h("button", { class: "btn primary", text: "+ Create a workgroup", onclick: create }) : null));
      body.replaceChildren(h("div", { class: "gr-grid" }, ...list.map(card)));
    }
    const offs = [Data.on("projects", draw), Data.on("tasks", draw), Data.on("people", draw)];
    return () => offs.forEach(f => f());
  }

  /* =====================================================================
     Group space
     ===================================================================== */
  function spaceView(root, id, tab0) {
    let tab = TABS.some(t => t[0] === tab0) ? tab0 : "feed", mounted = null, gateKey = "", subOffs = [], laterT = 0;
    const head = h("div", { class: "gr-head glass" }), tabsBox = h("div", { class: "gr-tabs-wrap" }), body = h("div", { class: "gr-body" });
    root.classList.add("gr-space");
    root.append(head, tabsBox, body);
    const g = () => Data.get("projects", id);

    function setTab(k) {
      tab = k;
      try { history.replaceState(null, "", LINK(id, k)); } catch {}
      paintTabs(); mount();
    }
    function paintTabs() {
      const p = g(), n = membersOf(p).length;
      const items = TABS.filter(([k]) => k !== "scrum" || p.type === "scrum").map(([k, l]) => [k, k === "members" ? `${l} · ${n}` : l]);
      tabsBox.replaceChildren(Apps.tabs(items, tab, setTab));
      tabsBox.querySelector("button.on")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
    function paintHead() {
      const p = g(), r = roleOf(p), [tIc, tL] = TYPES[typeOf(p)], ms = membersOf(p), member = isMember(p);
      const btns = [];
      if (!member && !p.archived) btns.push(r === "requested" ? h("button", { class: "btn", text: "⏳ Requested · Cancel", onclick: () => cancelRequest(p) })
        : h("button", { class: "btn primary", text: privacy(p) === "open" ? "👋 Join" : "🙋 Request to join", onclick: () => join(p) }));
      if (member && !isOld(p) && (canManage(p) || privacy(p) === "open")) btns.push(h("button", { class: "btn", text: "+ Invite", onclick: e => invite(e.currentTarget, p) }));
      if (member) btns.push(h("button", { class: "btn", text: "💬 Chat", onclick: () => openChat(p) }), h("button", { class: "btn", text: "📹 Video call", onclick: () => videoCall(p) }));
      btns.push(h("button", { class: "icon-btn gr-more", title: "More", html: UI.icon("dots"), onclick: e => moreMenu(e.currentTarget, p) }));
      head.style.setProperty("--gc", p.color || COLORS[0]);
      head.replaceChildren(
        h("button", { class: "icon-btn gr-back", title: "All workgroups", text: "‹", onclick: () => { location.hash = "#/app/groups"; } }),
        h("span", { class: "gr-av big", text: avatarOf(p) }),
        h("div", { class: "gr-head-t" },
          h("h1", { text: p.name || "Untitled group" }),
          h("div", { class: "gr-head-sub" }, h("span", { class: "gr-type", text: tIc + " " + tL }), privBadge(p), p.archived ? h("span", { class: "gr-priv", text: "🗄 Archived" }) : null, roleChip(p),
            h("button", { class: "gr-head-mem", title: "Members", onclick: () => setTab("members") }, Apps.avatars(ms, 22, 6), h("span", { text: plural(ms.length, "member") })))),
        h("div", { class: "gr-head-acts" }, ...btns));
    }
    function moreMenu(anchor, p) {
      const member = isMember(p);
      UI.menu(anchor, [
        canManage(p) ? { label: "Edit workgroup", icon: "text", onClick: () => editGroup(p) } : null,
        { label: "Copy link", icon: "link", onClick: () => { const u = location.href.split("#")[0] + LINK(p.id); (navigator.clipboard?.writeText(u) || Promise.reject()).then(() => UI.toast("🔗 Link copied"), () => UI.toast(u)); } },
        member ? { label: "Open the group folder in Drive", icon: "page", onClick: async () => Apps.go("drive", await ensureFolder(p)) } : null,
        isOwner(p) ? { label: p.archived ? "Restore from archive" : "Archive", icon: "restore", onClick: () => archive(p) } : null,
        member && !isOld(p) && ownerOf(p) !== meKey() ? { label: "Leave group", icon: "arrow", onClick: () => leave(p) } : null,
        isOwner(p) ? { sep: true } : null,
        isOwner(p) ? { label: "Delete workgroup", icon: "trash", danger: true, onClick: () => removeGroup(p) } : null,
      ], { align: "end" });
    }
    async function openChat(p) { const ch = await ensureChat(p); if (ch) location.hash = "#/app/chat/" + encodeURIComponent(ch); }
    async function videoCall(p) {
      const ch = await ensureChat(p), me = Data.me();
      const url = `https://meet.jit.si/Lumen-${String(window.Cloud?.ws?.id || "local").slice(0, 10)}-${ch.replace(/[^a-z0-9]/gi, "").slice(0, 24)}`;
      Data.add("chat", { channel: ch, kind: "call", url, text: "Video call", reactions: {} });
      tellMembers(p, `📹 ${who()} started a video call in <b>${esc(p.name)}</b>`, "#/app/chat/" + encodeURIComponent(ch), "Tap to join");
      window.open(url, "_blank", "noopener");
    }
    function gate(p) {
      const r = roleOf(p);
      return h("div", { class: "gr-gate glass" }, h("div", { class: "gr-gate-ic", text: "🔒" }), h("b", { text: "Join to see" }),
        h("div", { class: "app-sub", text: "Posts, tasks, events and files of this closed group are only visible to its members." }),
        p.archived ? null : r === "requested" ? h("button", { class: "btn", text: "⏳ Requested · Cancel", onclick: () => cancelRequest(p) }) : h("button", { class: "btn primary", text: "🙋 Request to join", onclick: () => join(p) }));
    }
    function mount() {
      const p = g();
      subOffs.forEach(f => f()); subOffs = [];
      if (tab === "scrum" && p.type !== "scrum") tab = "feed";
      gateKey = [canRead(p), p.type, tab].join("|");
      mounted = GATED.has(tab) && !canRead(p) ? { el: gate(p) } : MODS[tab](p, { setTab });
      body.replaceChildren(h("div", { class: "gr-pane" }, mounted.el));
      (DEPS[tab] || []).forEach(col => { let init = true; subOffs.push(Data.on(col, () => { if (!init) later(); })); init = false; });
    }
    const later = () => { clearTimeout(laterT); laterT = setTimeout(() => mounted?.redraw?.(), 40); };
    const back = () => h("button", { class: "btn", text: "‹ All workgroups", onclick: () => { location.hash = "#/app/groups"; } });
    function refresh() {
      const p = g();
      if (!p || !canSee(p)) {
        subOffs.forEach(f => f()); subOffs = []; mounted = null; gateKey = "";
        head.replaceChildren(); tabsBox.replaceChildren();
        body.replaceChildren(Apps.empty("🕶️", "This workgroup doesn't exist, or it's private.", back()));
        return;
      }
      document.title = (p.name || "Workgroup") + " · Lumen";
      paintHead(); paintTabs();
      if (!mounted || [canRead(p), p.type, tab].join("|") !== gateKey) mount(); else later();
    }
    const offs = [Data.on("projects", refresh), Data.on("people", () => { if (canSee(g())) { paintHead(); later(); } })];
    return () => { offs.forEach(f => f()); subOffs.forEach(f => f()); clearTimeout(laterT); };
  }

  /* ---------- Feed tab ---------- */
  function feedMod(p0) {
    const id = p0.id, seen = new Set();
    let pend = [], busy = false, first = true;
    const ta = h("textarea", { class: "feed-input", rows: 2, placeholder: "Share something with the group… Type @ to mention someone" });
    ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 300) + "px"; });
    Apps.mentionAssist(ta);
    const pendBox = h("div", { class: "file-list gr-pend" });
    const paintPend = () => pendBox.replaceChildren(...pend.map(f => h("span", { class: "file-chip" }, h("span", { class: "fc-ic", text: /^image\//.test(f.type) ? "🖼️" : "📎" }),
      h("span", { class: "fc-n", text: f.name }), h("small", { text: Apps.fileSize(f.size) }), h("button", { class: "fc-x", type: "button", title: "Remove", text: "×", onclick: () => { pend = pend.filter(x => x !== f); paintPend(); } }))));
    const addFiles = fs => { (fs || []).forEach(f => { if (f.size > MAX_FILE) UI.toast(`“${f.name}” is ${Apps.fileSize(f.size)}. Files can be up to 700 KB; share bigger ones as a link.`); else pend.push(f); }); paintPend(); };
    ta.addEventListener("paste", e => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); addFiles(fs); } });
    ta.addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); publish(); } });
    const pub = h("button", { class: "btn primary", text: "Publish", onclick: () => publish() });
    async function publish() {
      const t = ta.value.trim();
      if (busy) return; if (!t && !pend.length) return ta.focus();
      const g = Data.get("projects", id); if (!g || !isMember(g)) return UI.toast("Join the group to post");
      busy = true; pub.disabled = true; pub.textContent = pend.length ? "Uploading…" : "Publishing…";
      try {
        const files = pend.length ? await Apps.attach(pend) : [];
        if (!t && !files.length) return;
        const members = membersOf(g), me = Data.me(), ment = Apps.mentioned(t);
        await Data.add("feed", { kind: "post", text: t, group: id, audience: { people: members, depts: [] }, files, likes: [], comments: [] });
        const preview = t || "📎 " + files.map(f => f.name).join(", ");
        members.filter(k => k !== me.key).forEach(k => Data.notify(k, ment.includes(k) ? `💬 ${who()} mentioned you in <b>${esc(g.name)}</b>` : `📝 ${who()} posted in <b>${esc(g.name)}</b>`, LINK(id, "feed"), preview));
        ta.value = ""; ta.style.height = ""; pend = []; paintPend();
        UI.toast("Published");
      } finally { busy = false; pub.disabled = false; pub.textContent = "Publish"; }
    }
    const composer = h("div", { class: "feed-compose glass gr-compose" },
      h("div", { class: "fc-top" }, Apps.avatar(Data.me(), 36), h("div", { class: "fd-main" }, ta)), pendBox,
      h("div", { class: "fc-bar" }, h("button", { type: "button", class: "icon-btn fd-attach", title: "Attach files", text: "📎", onclick: async () => addFiles(await Apps.pickFiles(true)) }), h("span", { class: "grow" }), pub));
    const listEl = h("div", { class: "feed-list" });
    const expanded = new Set();

    function postEl(p, g, i) {
      const me = meKey(), author = Data.person(p.by), likes = p.likes || [], liked = likes.includes(me), cs = p.comments || [], member = isMember(g);
      const open = expanded.has(p.id), shown = open || cs.length <= 3 ? cs : cs.slice(-3);
      const cin = h("input", { class: "menu-input fp-cin", placeholder: member ? "Write a comment…  @ to mention" : "Join the group to comment", dataset: { pid: p.id }, disabled: !member });
      if (member) Apps.mentionAssist(cin);
      const send = () => {
        const text = cin.value.trim(); if (!text) return;
        cin.value = "";
        Data.arr("feed", p.id, "comments", { id: Data.uid(), by: me, text, at: Date.now() });
        const told = new Set([me]), html = `💬 ${who()}`;
        if (p.by !== me) { Data.notify(p.by, `${html} commented on your post in <b>${esc(g.name)}</b>`, LINK(id, "feed"), text); told.add(p.by); }
        const ms = new Set(membersOf(g));
        Apps.mentioned(text).filter(k => !told.has(k) && ms.has(k)).forEach(k => Data.notify(k, `${html} mentioned you in <b>${esc(g.name)}</b>`, LINK(id, "feed"), text));
      };
      cin.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } };
      const items = [
        { label: "Copy text", icon: "copy", onClick: () => { navigator.clipboard?.writeText(p.text || ""); UI.toast("Copied"); } },
        p.by === me ? { label: "Edit", icon: "text", onClick: async () => {
          const v = await Apps.form("Edit post", [{ key: "text", label: "Text", type: "textarea", rows: 6 }], { text: p.text || "" });
          if (v && String(v.text || "").trim() !== (p.text || "")) Data.update("feed", p.id, { text: String(v.text || "").trim(), edited: true });
        } } : null,
        canManage(g) ? { label: p.pinned ? "Unpin" : "Pin to top", icon: "star", onClick: () => Data.update("feed", p.id, { pinned: !p.pinned }) } : null,
        p.by === me || canManage(g) ? { sep: true } : null,
        p.by === me || canManage(g) ? { label: "Delete post", icon: "trash", danger: true, onClick: async () => { if (await UI.confirm("Delete this post?")) Data.remove("feed", p.id); } } : null,
      ];
      const isNew = !first && !seen.has(p.id); seen.add(p.id);
      return h("article", { class: "feed-post glass" + (p.pinned ? " pinned" : "") + (first ? "" : isNew ? " fd-new" : " no-anim"), style: { animationDelay: first ? Math.min(i * 40, 300) + "ms" : "0ms" } },
        h("div", { class: "fp-head" }, Apps.avatar(author, 40),
          h("div", { class: "grow fd-headt" }, h("div", { class: "fd-name" }, h("b", { text: author.name }), p.pinned ? h("span", { class: "fd-pin", text: "📌 Pinned" }) : null),
            h("div", { class: "app-sub fd-sub" }, UI.timeAgo(p.at || Date.now()), p.edited ? h("span", { class: "fd-edited", text: " · edited" }) : null)),
          h("button", { class: "icon-btn xs", title: "More", html: UI.icon("dots"), onclick: e => UI.menu(e.currentTarget, items, { align: "end" }) })),
        p.text ? h("div", { class: "fd-text", html: rich(p.text) }) : null,
        filesBlock(p.files),
        h("div", { class: "fp-bar" },
          h("button", { type: "button", class: "like" + (liked ? " on" : ""), title: likes.map(k => Data.person(k).name).join(", "), onclick: () => Data.arr("feed", p.id, "likes", me, !liked) }, (liked ? "❤️" : "🤍") + " " + (likes.length || "Like")),
          h("button", { type: "button", class: "like", onclick: () => cin.focus() }, `💬 ${cs.length || "Comment"}`),
          h("span", { class: "grow" }), likes.length ? h("span", { class: "fd-likers" }, Apps.avatars(likes, 20, 4)) : null),
        cs.length ? h("div", { class: "comments" },
          cs.length > 3 ? h("button", { type: "button", class: "fd-more-c", text: open ? "Show fewer comments" : `Show all ${cs.length} comments`, onclick: () => { open ? expanded.delete(p.id) : expanded.add(p.id); draw(); } }) : null,
          ...shown.map(c => h("div", { class: "cmt" }, Apps.avatar(Data.person(c.by), 28), h("div", { class: "fd-cbody" },
            h("div", { class: "fd-bubble" }, h("div", { class: "cmt-h" }, h("b", { text: Data.person(c.by).name }), h("small", { text: UI.timeAgo(c.at) })), c.text ? h("div", { class: "cmt-t", html: rich(c.text) }) : null),
            c.by === me || canManage(g) ? h("div", { class: "fd-cacts" }, h("button", { type: "button", text: "Delete", onclick: async () => { if (await UI.confirm("Delete this comment?")) Data.arr("feed", p.id, "comments", c, false); } })) : null)))) : null,
        h("div", { class: "fd-cin" }, Apps.avatar(Data.me(), 28), cin));
    }
    function draw() {
      const g = Data.get("projects", id); if (!g) return;
      composer.style.display = isMember(g) && !g.archived ? "" : "none";
      const posts = Data.list("feed").filter(x => x.group === id).sort((a, b) => !!b.pinned - !!a.pinned || (b.at || 0) - (a.at || 0));
      const typed = {}; let focus = null;
      listEl.querySelectorAll(".fp-cin").forEach(i => { if (i.value) typed[i.dataset.pid] = i.value; if (document.activeElement === i) focus = i.dataset.pid; });
      listEl.replaceChildren(...(posts.length ? posts.map((x, i) => postEl(x, g, i)) : [Apps.empty("📰", isMember(g) ? "No posts yet. Say hello to the group!" : "No posts yet.")]));
      listEl.querySelectorAll(".fp-cin").forEach(i => { if (typed[i.dataset.pid]) i.value = typed[i.dataset.pid]; if (focus === i.dataset.pid) i.focus(); });
      first = false;
    }
    draw();
    return { el: h("div", { class: "app-feed gr-feed" }, composer, listEl), redraw: UI.liveDraw(listEl, draw) };
  }

  /* ---------- Tasks tab ---------- */
  function taskCard(t, g, onPoints) {
    const ep = (g.epics || []).find(e => e.id === t.epic);
    const c = h("div", { class: "b-card gr-tcard" + (t.status === "done" ? " done" : ""), draggable: true, onclick: () => openTask(t.id) },
      h("div", { class: "bc-t", text: (t.priority === "high" ? "🔥 " : "") + (t.title || "Untitled task") }),
      h("div", { class: "bc-p" }, ep ? h("span", { class: "gr-epic", style: { "--ec": ep.color }, text: ep.name }) : null,
        onPoints && pts(t) ? h("span", { class: "gr-pts", title: "Story points", text: pts(t) }) : null,
        t.deadline ? h("span", { class: "dl " + due(t), text: "⏱ " + Apps.fmtDate(t.deadline) }) : null,
        h("span", { class: "grow" }), Apps.avatars([t.assignee, ...(t.participants || [])].filter(Boolean), 22, 2)));
    dragify(c, t.id);
    return c;
  }
  function board(list, g, opts = {}) {
    return h("div", { class: "board gr-board" }, ...STATUS.map(([k, l, c], i) => {
      const items = list.filter(t => (t.status || "todo") === k);
      const col = h("div", { class: "b-col gr-col", dataset: { c }, style: { animationDelay: i * 40 + "ms" } },
        h("div", { class: "b-col-h" }, h("span", { class: "tag", dataset: { tc: c }, text: l }), h("span", { class: "n", text: items.length + (opts.points ? ` · ${sumPts(items)} pts` : "") })),
        h("div", { class: "b-cards" }, ...items.map(t => taskCard(t, g, opts.points))),
        !items.length ? h("div", { class: "gr-col-empty", text: "Drop tasks here" }) : null,
        opts.onAdd ? h("button", { class: "gr-add", text: "+ Task", onclick: () => opts.onAdd(k) }) : null);
      dropZone(col, tid => { const t = Data.get("tasks", tid); if (t && (t.status || "todo") !== k) setStatus(t, k); });
      return col;
    }));
  }
  function tasksMod(p0) {
    const id = p0.id;
    let view = ls("lumen-gr-tview", "list") === "kanban" ? "kanban" : "list", q = "", onlyMine = false;
    const box = h("div");
    const search = h("input", { class: "app-search", placeholder: "Search tasks…", oninput: e => { q = e.target.value.toLowerCase(); draw(); } });
    const mineBtn = h("button", { class: "chip-btn", text: "👤 Only mine", onclick: () => { onlyMine = !onlyMine; mineBtn.classList.toggle("on", onlyMine); draw(); } });
    const seg = h("div", { class: "seg" }, ...[["list", "☰ List"], ["kanban", "▥ Kanban"]].map(([k, l]) => h("button", { class: view === k ? "on" : "", text: l, onclick: e => {
      view = k; lsSet("lumen-gr-tview", k); seg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.currentTarget)); draw(); } })));
    const addBtn = h("button", { class: "btn primary", text: "+ Task", onclick: () => newTask({ project: id }) });
    const row = (t, i) => h("div", { class: "gr-trow" + (t.status === "done" ? " done" : ""), style: { animationDelay: Math.min(i, 14) * 25 + "ms" }, onclick: () => openTask(t.id) },
      h("input", { type: "checkbox", checked: t.status === "done", title: "Mark done", onclick: e => e.stopPropagation(), onchange: e => setStatus(t, e.target.checked ? "done" : "todo") }),
      h("span", { class: "gr-tt" }, t.priority === "high" ? "🔥 " : "", t.title || "Untitled task", (t.checklist || []).length ? h("small", { class: "cl-n", text: ` ☑ ${(t.checklist || []).filter(c => c.done).length}/${t.checklist.length}` }) : null),
      stTag(t), h("span", { class: "dl " + due(t), text: t.deadline ? Apps.fmtDate(t.deadline) : "—" }),
      Apps.avatars([t.assignee, ...(t.participants || [])].filter(Boolean), 22, 2));
    function draw() {
      const g = Data.get("projects", id); if (!g) return;
      addBtn.style.display = isMember(g) && !g.archived ? "" : "none";
      const me = meKey(), keepX = box.querySelector(".board")?.scrollLeft || 0;
      const list = groupTasks(id).filter(t => (!q || ((t.title || "") + " " + (t.desc || "")).toLowerCase().includes(q)) && (!onlyMine || Apps.isMyTask?.(t, me) || t.assignee === me))
        .sort((a, b) => (a.status === "done") - (b.status === "done") || (a.deadline || "9999").localeCompare(b.deadline || "9999") || (b.at || 0) - (a.at || 0));
      const s = stats(id);
      const sum = h("div", { class: "gr-sum" }, ...[["Open", s.open, ""], ["Overdue", s.overdue, "red"], ["Done", s.done, "green"]].map(([l, n, c]) => h("span", { class: "gr-sum-i", dataset: { c } }, h("b", { text: n }), l)),
        h("div", { class: "progress gr-sum-bar" }, h("span", { style: { width: s.pct + "%" } })), h("small", { text: s.pct + "% done" }));
      let el;
      if (!list.length) el = Apps.empty("✅", q || onlyMine ? "No tasks match." : "No tasks in this group yet.", isMember(g) && !q ? h("button", { class: "btn primary", text: "+ Task", onclick: () => newTask({ project: id }) }) : null);
      else if (view === "kanban") el = board(list, g, { points: g.type === "scrum", onAdd: isMember(g) ? k => newTask({ project: id, status: k }) : null });
      else el = h("div", { class: "gr-tlist glass" }, h("div", { class: "gr-trow head" }, h("span"), h("span", { text: "Task" }), h("span", { text: "Status" }), h("span", { text: "Deadline" }), h("span", { text: "Who" })), ...list.map(row));
      box.replaceChildren(sum, el);
      const b = box.querySelector(".board"); if (b && keepX) b.scrollLeft = keepX;
    }
    draw();
    return { el: h("div", { class: "gr-tasks" }, h("div", { class: "app-toolbar" }, search, mineBtn, h("span", { class: "grow" }), seg, addBtn), box), redraw: draw };
  }

  /* ---------- Scrum tab ---------- */
  const activeSprint = g => (g.sprints || []).find(s => s.status === "active");
  const setSprints = (g, fn) => Data.update("projects", g.id, { sprints: fn(((Data.get("projects", g.id) || g).sprints || []).map(s => ({ ...s }))) });
  async function editSprint(g, s) {
    const all = g.sprints || [], last = all.map(x => x.finish).filter(Boolean).sort().pop();
    const start = last && last >= T() ? Apps.addDays(last, 1) : T();
    const v = await Apps.form(s ? "Edit sprint" : "New sprint", [
      { key: "name", label: "Name", required: true },
      { key: "start", label: "Start", type: "date", half: true }, { key: "finish", label: "Finish", type: "date", half: true },
      { key: "goal", label: "Sprint goal", type: "textarea", rows: 2, placeholder: "What should this sprint achieve?" },
    ], s ? { name: s.name, start: s.start || "", finish: s.finish || "", goal: s.goal || "" } : { name: "Sprint " + (all.length + 1), start, finish: Apps.addDays(start, 13), goal: "" },
    { ok: s ? "Save" : "Create sprint", onDelete: s && s.status !== "active" ? () => deleteSprint(g, s) : undefined });
    if (!v) return;
    if (v.start && v.finish && v.finish < v.start) return UI.toast("The sprint ends before it starts");
    const rec = { name: String(v.name).trim(), start: v.start || "", finish: v.finish || "", goal: String(v.goal || "").trim() };
    setSprints(g, ss => s ? ss.map(x => x.id === s.id ? { ...x, ...rec } : x) : [...ss, { id: Data.uid(), ...rec, status: "planned" }]);
    UI.toast(s ? "Sprint saved" : "🗓 Sprint created");
  }
  function deleteSprint(g, s) {
    groupTasks(g.id).filter(t => t.sprint === s.id).forEach(t => Data.update("tasks", t.id, { sprint: "" }));
    setSprints(g, ss => ss.filter(x => x.id !== s.id));
    UI.toast("Sprint deleted. Its tasks went back to the backlog");
  }
  function startSprint(g, s) {
    if (activeSprint(g)) return UI.toast("Complete the active sprint first");
    const start = T(), finish = s.finish && s.finish > start ? s.finish : Apps.addDays(start, 13);
    setSprints(g, ss => ss.map(x => x.id === s.id ? { ...x, status: "active", start, finish } : x));
    const n = groupTasks(g.id).filter(t => t.sprint === s.id);
    tellMembers(g, `🏃 ${who()} started <b>${esc(s.name)}</b> in <b>${esc(g.name)}</b>`, LINK(g.id, "scrum"), [s.goal ? "🎯 " + s.goal : "", `${plural(n.length, "task")} · ${sumPts(n)} points · until ${Apps.fmtDate(finish)}`].filter(Boolean).join(" · "));
    UI.toast("🏃 Sprint started");
  }
  function completeSprint(g, s) {
    const tasks = groupTasks(g.id).filter(t => t.sprint === s.id), open = tasks.filter(t => t.status !== "done"), donePts = sumPts(tasks.filter(t => t.status === "done"));
    const next = (g.sprints || []).find(x => x.status === "planned");
    let m;
    const finish = async target => {
      m.close();
      let dest = target;
      if (target === "new") {
        dest = Data.uid();
        const start = Apps.addDays(T(), 1);
        setSprints(g, ss => [...ss, { id: dest, name: "Sprint " + (ss.length + 1), start, finish: Apps.addDays(start, 13), goal: "", status: "planned" }]);
      }
      open.forEach(t => Data.update("tasks", t.id, { sprint: dest || "" }));
      setSprints(g, ss => ss.map(x => x.id === s.id ? { ...x, status: "done", completedPoints: donePts, completedAt: Date.now() } : x));
      tellMembers(g, `🏁 ${who()} completed <b>${esc(s.name)}</b> in <b>${esc(g.name)}</b>`, LINK(g.id, "scrum"), `${donePts} points done · ${tasks.length - open.length} of ${plural(tasks.length, "task")} finished`);
      UI.toast(`🏁 Sprint completed · ${donePts} points`);
    };
    const btn = (l, target, primary) => h("button", { class: "btn" + (primary ? " primary" : ""), text: l, onclick: () => finish(target) });
    const body = h("div", { class: "gr-complete" },
      h("div", { class: "gr-complete-stats" }, h("div", null, h("b", { text: tasks.length - open.length }), h("small", { text: "tasks done" })), h("div", null, h("b", { text: donePts }), h("small", { text: "points done" })), h("div", null, h("b", { text: open.length }), h("small", { text: "unfinished" }))),
      h("p", { text: open.length ? `Where should the ${plural(open.length, "unfinished task")} go?` : "Every task is done. Nice work! 🎉" }),
      h("div", { class: "gr-complete-btns" }, ...(open.length ? [btn("Back to the backlog", "", !next), next ? btn("Move to " + next.name, next.id, true) : btn("Move to a new sprint", "new")] : [btn("Complete sprint", "", true)]),
        h("button", { class: "btn", text: "Cancel", onclick: () => m.close() })));
    m = UI.modal("Complete " + s.name, body, { className: "gr-modal" });
    m.el.style.width = "480px";
  }
  async function editEpic(g, e) {
    const v = await Apps.form(e ? "Edit epic" : "New epic", [{ key: "name", label: "Epic name", required: true, placeholder: "Checkout redesign" }, { key: "color", label: "Colour", type: "color" }],
      e ? { name: e.name, color: e.color } : {}, { ok: e ? "Save" : "Create epic", onDelete: e ? () => {
        groupTasks(g.id).filter(t => t.epic === e.id).forEach(t => Data.update("tasks", t.id, { epic: "" }));
        Data.update("projects", g.id, { epics: ((Data.get("projects", g.id) || g).epics || []).filter(x => x.id !== e.id) });
      } : undefined });
    if (!v) return;
    const cur = (Data.get("projects", g.id) || g).epics || [], rec = { name: String(v.name).trim(), color: v.color || COLORS[0] };
    Data.update("projects", g.id, { epics: e ? cur.map(x => x.id === e.id ? { ...x, ...rec } : x) : [...cur, { id: Data.uid(), ...rec }] });
    UI.toast(e ? "Epic saved" : "🏷 Epic created");
  }
  function scrumMod(p0) {
    const id = p0.id;
    let sub = ls("lumen-gr-scrum", "plan"), epicF = "", repSprint = "";
    if (!["plan", "board", "epics", "reports"].includes(sub)) sub = "plan";
    const segEl = h("div", { class: "seg gr-scrum-seg" }), actions = h("div", { class: "gr-scrum-acts" }), box = h("div", { class: "gr-scrum-body" });
    const paintSeg = () => segEl.replaceChildren(...[["plan", "🗂 Planning"], ["board", "▥ Active sprint"], ["epics", "🏷 Epics"], ["reports", "📉 Reports"]].map(([k, l]) =>
      h("button", { class: sub === k ? "on" : "", text: l, onclick: () => { sub = k; lsSet("lumen-gr-scrum", k); paintSeg(); draw(true); } })));

    function quickTask(g, title, sprint, list) {
      return Data.add("tasks", { title, desc: "", status: "todo", priority: "normal", assignee: "", project: id, sprint: sprint || "", epic: epicF || "", points: 0,
        rank: list.length ? rank(list[list.length - 1]) + 1000 : Date.now(), deadline: "", start: "", parentId: "",
        participants: [], observers: [], tags: [], checklist: [], comments: [], files: [], related: [] });
    }
    function place(taskId, sprintId, before, list) {
      const t = Data.get("tasks", taskId); if (!t || (before && before.id === taskId)) return;
      const others = list.filter(x => x.id !== taskId);
      let r;
      if (before) { const i = others.findIndex(x => x.id === before.id), prev = others[i - 1]; r = prev ? (rank(prev) + rank(before)) / 2 : rank(before) - 1000; }
      else r = others.length ? rank(others[others.length - 1]) + 1000 : Date.now();
      const patch = { rank: r };
      if ((t.sprint || "") !== sprintId) patch.sprint = sprintId;
      if (patch.sprint === undefined && rank(t) === r) return;
      Data.update("tasks", taskId, patch);
    }
    function epicMenu(anchor, g, t) {
      UI.menu(anchor, [{ section: "Epic" }, { label: "No epic", iconHtml: !t.epic ? "✓" : "", onClick: () => Data.update("tasks", t.id, { epic: "" }) },
        ...(g.epics || []).map(e => ({ label: e.name, iconHtml: t.epic === e.id ? "✓" : `<span class="gr-dot" style="background:${esc(e.color)}"></span>`, onClick: () => Data.update("tasks", t.id, { epic: e.id }) })),
        { sep: true }, { label: "New epic…", icon: "plus", onClick: () => editEpic(g) }]);
    }
    function blRow(t, g, sprintId, list, member) {
      const ep = (g.epics || []).find(e => e.id === t.epic);
      const pSel = h("select", { class: "chip-in gr-pts-sel", title: "Story points", disabled: !member, onclick: e => e.stopPropagation() }, ...POINTS.map(n => h("option", { value: n, selected: pts(t) === n }, n ? n + " pts" : "– pts")));
      pSel.onchange = () => { Data.update("tasks", t.id, { points: +pSel.value }); pSel.blur(); };
      const el = h("div", { class: "gr-bl-row" + (t.status === "done" ? " done" : ""), draggable: member },
        member ? h("span", { class: "gr-grip", title: "Drag to reorder or plan", text: "⠿" }) : null,
        h("span", { class: "gr-st", style: { background: `var(--c-${st(t.status)[2]})` }, title: st(t.status)[1] }),
        h("button", { class: "gr-bl-t", text: t.title || "Untitled task", onclick: () => openTask(t.id) }),
        h("button", { class: "gr-epic" + (ep ? "" : " none"), style: ep ? { "--ec": ep.color } : null, text: ep ? ep.name : "+ Epic", disabled: !member, onclick: e => epicMenu(e.currentTarget, g, t) }),
        pSel, Apps.avatar(Data.person(t.assignee), 22));
      if (member) {
        dragify(el, t.id);
        el.addEventListener("dragover", e => { e.preventDefault(); e.stopPropagation(); document.querySelectorAll(".gr-over").forEach(x => x !== el && x.classList.remove("gr-over")); el.classList.add("gr-over"); });
        el.addEventListener("dragleave", e => { if (!el.contains(e.relatedTarget)) el.classList.remove("gr-over"); });
        el.addEventListener("drop", e => { e.preventDefault(); e.stopPropagation(); el.classList.remove("gr-over"); el.closest(".drop")?.classList.remove("drop"); const tid = e.dataTransfer.getData("text/task"); if (tid) place(tid, sprintId, t, list); });
      }
      return el;
    }
    function section(g, s, list, member) {
      const active = s && s.status === "active", sid = s ? s.id : "", total = sumPts(list), donePts = sumPts(list.filter(t => t.status === "done"));
      const quick = member ? h("input", { class: "menu-input gr-quick", placeholder: s ? `+ Add a task to ${s.name} and press Enter` : "+ Add a story to the backlog and press Enter", dataset: { sid } }) : null;
      if (quick) quick.onkeydown = async e => {
        if (e.key !== "Enter" || !quick.value.trim()) return;
        const title = quick.value.trim(); quick.value = "";
        await quickTask(g, title, sid, list);
        draw(); setTimeout(() => box.querySelector(`.gr-quick[data-sid="${sid}"]`)?.focus(), 30);
      };
      const others = (g.sprints || []).some(x => x.status === "active" && x.id !== sid);
      const hdr = h("div", { class: "gr-sp-h" },
        h("div", { class: "gr-sp-t" }, h("b", { text: s ? s.name : "Backlog" }),
          s ? h("span", { class: "gr-pill" + (active ? " live" : ""), text: active ? "Active" : "Planned" }) : null,
          h("small", { text: [s ? (s.start && s.finish ? Apps.fmtDate(s.start) + " – " + Apps.fmtDate(s.finish) : "No dates yet") : "", plural(list.length, "task"), `${total} pts` + (active && total ? ` · ${donePts} done` : "")].filter(Boolean).join(" · ") })),
        h("span", { class: "grow" }),
        s && member && !active ? h("button", { class: "btn", text: "▶ Start sprint", disabled: others, title: others ? "Complete the active sprint first" : "", onclick: () => startSprint(g, s) }) : null,
        s && member && active ? h("button", { class: "btn primary", text: "🏁 Complete sprint", onclick: () => completeSprint(g, s) }) : null,
        s && member ? h("button", { class: "icon-btn xs", title: "Edit sprint", html: UI.icon("dots"), onclick: () => editSprint(g, s) }) : null);
      const rows = h("div", { class: "gr-sp-list" }, ...list.map(t => blRow(t, g, sid, list, member)),
        !list.length ? h("div", { class: "gr-col-empty", text: s ? "Drag tasks from the backlog here to plan this sprint" : "The backlog is empty. Add stories below." }) : null);
      const el = h("div", { class: "gr-sp glass" + (active ? " active" : "") + (s ? "" : " backlog") }, hdr, s && s.goal ? h("div", { class: "gr-sp-goal", text: "🎯 " + s.goal }) : null, rows, quick);
      if (member) dropZone(el, tid => place(tid, sid, null, list));
      return el;
    }
    function planView(g) {
      const member = isMember(g), tasks = groupTasks(id), known = new Set((g.sprints || []).map(s => s.id));
      const inEpic = t => !epicF || t.epic === epicF;
      const sprints = (g.sprints || []).filter(s => s.status !== "done").sort((a, b) => (b.status === "active") - (a.status === "active") || (a.start || "9").localeCompare(b.start || "9"));
      const back = tasks.filter(t => (!t.sprint || !known.has(t.sprint)) && t.status !== "done" && inEpic(t)).sort(byRank);
      const doneN = tasks.filter(t => (!t.sprint || !known.has(t.sprint)) && t.status === "done").length;
      const epics = g.epics || [];
      const epicRow = epics.length ? h("div", { class: "gr-epic-filter" }, h("small", { class: "gr-mute", text: "Epic:" }),
        h("button", { class: "chip-btn" + (!epicF ? " on" : ""), text: "All", onclick: () => { epicF = ""; draw(true); } }),
        ...epics.map(e => h("button", { class: "chip-btn" + (epicF === e.id ? " on" : ""), onclick: () => { epicF = epicF === e.id ? "" : e.id; draw(true); } }, h("span", { class: "gr-dot", style: { background: e.color } }), e.name))) : null;
      return h("div", { class: "gr-plan" }, epicRow,
        !sprints.length ? h("div", { class: "gr-hint gr-plan-hint" }, "Plan your first sprint: ", member ? h("button", { class: "chip-btn", text: "+ Create a sprint", onclick: () => editSprint(g) }) : null) : null,
        ...sprints.map(s => section(g, s, tasks.filter(t => t.sprint === s.id && inEpic(t)).sort(byRank), member)),
        section(g, null, back, member),
        doneN ? h("div", { class: "gr-hint", text: `${plural(doneN, "finished task")} without a sprint ${doneN === 1 ? "is" : "are"} hidden.` }) : null);
    }
    function boardView(g) {
      const s = activeSprint(g);
      if (!s) return Apps.empty("🏃", "No sprint is running. Start one from Planning.", h("button", { class: "btn primary", text: "Go to planning", onclick: () => { sub = "plan"; lsSet("lumen-gr-scrum", sub); paintSeg(); draw(true); } }));
      const b = burn(g, s), left = dayDiff(T(), b.days[b.days.length - 1]);
      const list = b.tasks.filter(t => !epicF || t.epic === epicF).sort(byRank), member = isMember(g);
      const donePts = b.total - b.left;
      return h("div", { class: "gr-sprint" },
        h("div", { class: "gr-sprint-h glass" },
          h("div", { class: "gr-sp-t" }, h("b", { text: s.name }), h("span", { class: "gr-pill live", text: "Active" }), h("small", { text: `${Apps.fmtDate(b.days[0])} – ${Apps.fmtDate(b.days[b.days.length - 1])} · ${left > 0 ? plural(left, "day") + " left" : left === 0 ? "Last day" : "Overdue by " + plural(-left, "day")}` })),
          s.goal ? h("div", { class: "gr-sp-goal", text: "🎯 " + s.goal }) : null,
          h("div", { class: "gr-sprint-prog" }, h("div", { class: "progress" }, h("span", { style: { width: (b.total ? donePts / b.total * 100 : 0) + "%" } })), h("small", { text: `${donePts} of ${b.total} points done` }),
            member ? h("button", { class: "btn primary", text: "🏁 Complete sprint", onclick: () => completeSprint(g, s) }) : null)),
        board(list, g, { points: true, onAdd: member ? k => newTask({ project: id, sprint: s.id, status: k }) : null }),
        h("div", { class: "gr-card-box glass" }, h("div", { class: "td-sec", text: "Burndown" }), burnChart(b, true)));
    }
    function epicsView(g) {
      const epics = g.epics || [], tasks = groupTasks(id), member = isMember(g);
      if (!epics.length) return Apps.empty("🏷", "Epics group related stories, like “Onboarding” or “Mobile app”.", member ? h("button", { class: "btn primary", text: "+ Epic", onclick: () => editEpic(g) }) : null);
      return h("div", { class: "gr-epics" }, ...epics.map((e, i) => {
        const ts = tasks.filter(t => t.epic === e.id), done = ts.filter(t => t.status === "done"), tp = sumPts(ts), dp = sumPts(done);
        const pct = tp ? Math.round(dp / tp * 100) : ts.length ? Math.round(done.length / ts.length * 100) : 0;
        return h("div", { class: "gr-epic-card glass", style: { "--ec": e.color, animationDelay: i * 40 + "ms" }, role: "button", tabindex: 0, onclick: () => { epicF = e.id; sub = "plan"; lsSet("lumen-gr-scrum", sub); paintSeg(); draw(true); } },
          h("div", { class: "gr-epic-top" }, h("span", { class: "gr-dot big", style: { background: e.color } }), h("b", { text: e.name }), h("span", { class: "grow" }),
            member ? h("button", { class: "icon-btn xs", title: "Edit epic", html: UI.icon("dots"), onclick: ev => { ev.stopPropagation(); editEpic(g, e); } }) : null),
          h("div", { class: "progress" }, h("span", { style: { width: pct + "%", background: e.color } })),
          h("small", { class: "gr-mute", text: `${done.length}/${plural(ts.length, "task")} · ${dp}/${tp} points · ${pct}%` }));
      }));
    }
    function reportsView(g) {
      const choices = (g.sprints || []).filter(s => s.status !== "planned").sort((a, b) => (b.status === "active") - (a.status === "active") || (b.start || "").localeCompare(a.start || ""));
      if (!choices.some(s => s.id === repSprint)) repSprint = choices[0]?.id || "";
      const s = choices.find(x => x.id === repSprint);
      const sel = h("select", { class: "app-select", onchange: e => { repSprint = e.target.value; draw(true); } }, ...choices.map(x => h("option", { value: x.id, selected: x.id === repSprint }, x.name + (x.status === "active" ? " (active)" : ""))));
      return h("div", { class: "gr-reports" },
        h("div", { class: "gr-card-box glass" }, h("div", { class: "gr-rep-h" }, h("div", { class: "td-sec", text: "Burndown" }), h("span", { class: "grow" }), choices.length ? sel : null),
          s ? burnChart(burn(g, s)) : h("div", { class: "gr-chart-empty", text: "Start a sprint to see its burndown." })),
        h("div", { class: "gr-card-box glass" }, h("div", { class: "td-sec", text: "Velocity" }), velocityChart(g)));
    }
    function draw(reset) {
      const g = Data.get("projects", id); if (!g) return;
      const member = isMember(g), keepX = reset ? 0 : box.querySelector(".board")?.scrollLeft || 0;
      actions.replaceChildren(...(member ? [sub === "epics" ? h("button", { class: "btn", text: "+ Epic", onclick: () => editEpic(g) }) : h("button", { class: "btn", text: "+ Sprint", onclick: () => editSprint(g) }),
        h("button", { class: "btn primary", text: "+ Task", onclick: () => { const s = activeSprint(g); newTask({ project: id, ...(sub === "board" && s ? { sprint: s.id } : {}), ...(epicF ? { epic: epicF } : {}) }); } })] : []));
      box.replaceChildren(sub === "plan" ? planView(g) : sub === "board" ? boardView(g) : sub === "epics" ? epicsView(g) : reportsView(g));
      const b = box.querySelector(".board"); if (b && keepX) b.scrollLeft = keepX;
    }
    paintSeg(); draw(true);
    return { el: h("div", { class: "gr-scrum" }, h("div", { class: "app-toolbar" }, segEl, h("span", { class: "grow" }), actions), box), redraw: UI.liveDraw(box, () => draw(false)) };
  }

  /* ---------- Calendar tab ---------- */
  function calMod(p0) {
    const id = p0.id;
    let month = T().slice(0, 7);
    const box = h("div", { class: "gr-cal" });
    const openEv = o => Apps.Calendar?.openEvent ? Apps.Calendar.openEvent(o.ev.id, o.date) : (location.hash = "#/app/calendar/" + encodeURIComponent(o.ev.id));
    const evChip = o => h("button", { class: "cal-chip gr-ev", style: { "--c": o.ev.color || "var(--accent)" }, title: o.ev.title || "Event", onclick: e => { e.stopPropagation(); openEv(o); } },
      (o.allDay || !o.start ? "" : o.start + " ") + (o.ev.title || "Event"));
    const tkChip = t => h("button", { class: "cal-chip gr-tk" + (t.status === "done" ? " done" : ""), style: { "--c": "var(--c-orange)" }, title: "Task deadline: " + (t.title || ""), onclick: e => { e.stopPropagation(); openTask(t.id); } }, "✅ " + (t.title || "Task"));
    function draw() {
      const g = Data.get("projects", id); if (!g) return;
      const member = isMember(g) && !g.archived;
      const [y, m] = month.split("-").map(Number), first = month + "-01", start = mondayOf(first), dim = new Date(y, m, 0).getDate();
      const weeks = Math.ceil((dayDiff(start, first) + dim) / 7), end = Apps.addDays(start, weeks * 7 - 1);
      const occ = (Apps.eventsBetween ? Apps.eventsBetween(start, Apps.addDays(T() > end ? T() : end, 60)) : []).filter(o => o.ev && o.ev.project === id);
      const tasks = groupTasks(id).filter(t => t.deadline && t.deadline >= start && t.deadline <= end);
      const evDay = {}, tkDay = {};
      occ.forEach(o => (evDay[o.date] ||= []).push(o)); tasks.forEach(t => (tkDay[t.deadline] ||= []).push(t));
      const shift = n => { month = Apps.iso(new Date(y, m - 1 + n, 1)).slice(0, 7); draw(); };
      const head = h("div", { class: "gr-cal-head" },
        h("button", { class: "icon-btn", title: "Previous month", text: "‹", onclick: () => shift(-1) }),
        h("button", { class: "btn", text: "Today", onclick: () => { month = T().slice(0, 7); draw(); } }),
        h("button", { class: "icon-btn", title: "Next month", text: "›", onclick: () => shift(1) }),
        h("b", { class: "gr-cal-label", text: new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }) }),
        h("span", { class: "grow" }), member ? h("button", { class: "btn primary", text: "+ Event", onclick: () => addEvent(g, month === T().slice(0, 7) ? T() : first) }) : null);
      const wd = [0, 1, 2, 3, 4, 5, 6].map(i => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: "short" }));
      const grid = h("div", { class: "cal-grid gr-cal-grid" }, ...wd.map(d => h("div", { class: "cal-wd", text: d })));
      for (let i = 0; i < weeks * 7; i++) {
        const date = Apps.addDays(start, i), evs = evDay[date] || [], tks = tkDay[date] || [], items = [...evs.map(evChip), ...tks.map(tkChip)];
        grid.append(h("div", { class: "cal-day" + (date.slice(0, 7) !== month ? " other" : "") + (date === T() ? " today" : ""), title: member ? "Add an event on " + Apps.fmtDate(date) : "",
          onclick: e => { if (member && !e.target.closest(".cal-chip,.cal-more")) addEvent(g, date); } },
          h("span", { class: "cal-n", text: +date.slice(8) }), ...items.slice(0, 3),
          items.length > 3 ? h("button", { class: "cal-more", text: `+${items.length - 3} more`, onclick: e => { e.stopPropagation(); UI.popover(e.currentTarget, h("div", { class: "gr-daypop" }, h("div", { class: "menu-sec", text: Apps.fmtDate(date) }), ...[...evs.map(evChip), ...tks.map(tkChip)])); } }) : null));
      }
      const upcoming = occ.filter(o => o.date >= T()).slice(0, 8);
      box.replaceChildren(head, grid,
        h("div", { class: "td-sec", text: "Coming up" }),
        upcoming.length ? h("div", { class: "gr-agenda" }, ...upcoming.map((o, i) => h("button", { class: "gr-ag glass", style: { "--c": o.ev.color || "var(--accent)", animationDelay: i * 30 + "ms" }, onclick: () => openEv(o) },
          h("span", { class: "gr-ag-d" }, h("small", { text: new Date(o.date + "T00:00").toLocaleDateString(undefined, { month: "short" }) }), h("b", { text: +o.date.slice(8) })),
          h("span", { class: "gr-ag-t" }, h("b", { text: o.ev.title || "Event" }), h("small", { text: [o.allDay || !o.start ? "All day" : o.start + (o.finish ? " – " + o.finish : ""), o.ev.where].filter(Boolean).join(" · ") })),
          o.ev.video ? h("span", { class: "gr-mute", text: "📹" }) : null)))
          : h("div", { class: "gr-hint", text: member ? "No upcoming events. Click a day or “+ Event” to plan one; members are invited automatically." : "No upcoming events." }));
    }
    draw();
    return { el: box, redraw: draw };
  }

  /* ---------- Drive tab ---------- */
  const fIcon = t => /^image\//.test(t) ? "🖼️" : /pdf/.test(t) ? "📕" : /sheet|excel|csv/.test(t) ? "📊" : /word|document/.test(t) ? "📘" : /presentation|powerpoint/.test(t) ? "📙" : /zip|compressed/.test(t) ? "🗜️" : /video/.test(t) ? "🎬" : /audio/.test(t) ? "🎵" : t === "link" ? "🔗" : "📄";
  function driveMod(p0) {
    const id = p0.id, box = h("div");
    const fileIn = h("input", { type: "file", multiple: true, style: { display: "none" }, onchange: () => { upload([...fileIn.files]); fileIn.value = ""; } });
    async function upload(fs) {
      const g = Data.get("projects", id); if (!fs.length || !g) return;
      if (!isMember(g)) return UI.toast("Join the group to upload files");
      const folder = await ensureFolder(g);
      for (const f of fs) {
        if (f.size > MAX_FILE) { UI.toast(`“${f.name}” is ${Apps.fileSize(f.size)}. Files can be up to 700 KB on the free plan; add bigger ones as a link.`); continue; }
        const data = await new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(f); });
        await Data.add("files", { name: f.name, type: f.type || "application/octet-stream", size: f.size, data, folder });
        UI.toast("⬆ Uploaded " + f.name);
      }
    }
    async function addLink() {
      const g = Data.get("projects", id);
      const v = await Apps.form("Add a link", [{ key: "name", label: "Name", required: true, placeholder: "Design files (Google Drive)" }, { key: "url", label: "URL", type: "url", required: true, placeholder: "https://…" }]);
      if (!v) return;
      const folder = await ensureFolder(g);
      Data.add("files", { name: v.name, type: "link", url: /^https?:/i.test(v.url) ? v.url : "https://" + v.url, folder });
    }
    function draw() {
      const g = Data.get("projects", id); if (!g) return;
      const member = isMember(g) && !g.archived, folder = g.folder, me = meKey();
      const subs = folder ? Data.list("folders").filter(f => f.parent === folder && !f.deleted).sort((a, b) => String(a.name).localeCompare(String(b.name))) : [];
      const files = folder ? Data.list("files").filter(f => f.folder === folder && !f.deleted).sort((a, b) => (b.at || 0) - (a.at || 0)) : [];
      const bar = h("div", { class: "app-toolbar" }, h("span", { class: "gr-mute", text: files.length ? plural(files.length, "file") + " · up to 700 KB each" : "Files up to 700 KB each" }), h("span", { class: "grow" }),
        folder ? h("button", { class: "btn", text: "Open in Drive", onclick: () => Apps.go("drive", folder) }) : null,
        member ? h("button", { class: "btn", text: "🔗 Add link", onclick: addLink }) : null,
        member ? h("button", { class: "btn primary", text: "⬆ Upload", onclick: () => fileIn.click() }) : null);
      const row = (f, i) => {
        const img = /^image\//.test(f.type || "") && f.data;
        return h("div", { class: "gr-file", style: { animationDelay: Math.min(i, 14) * 25 + "ms" }, role: "button", tabindex: 0, onclick: () => Apps.openFile({ id: f.id, name: f.name, type: f.type }) },
          img ? h("span", { class: "gr-file-img", style: { backgroundImage: `url("${f.data}")` } }) : h("span", { class: "gr-file-ic", text: fIcon(f.type || "") }),
          h("span", { class: "gr-file-t" }, h("b", { text: f.name }), h("small", { text: [f.type === "link" ? "Link" : Apps.fileSize(f.size || 0), Data.person(f.by).name, UI.timeAgo(f.at || Date.now())].join(" · ") })),
          f.by === me || canManage(g) ? h("button", { class: "icon-btn xs", title: "Delete", html: UI.icon("trash"), onclick: async e => { e.stopPropagation(); if (await UI.confirm(`Delete “${f.name}”?`)) Data.remove("files", f.id); } }) : null);
      };
      box.replaceChildren(bar,
        !subs.length && !files.length ? Apps.empty("🗂️", member ? "Drop files here or use Upload. They're shared with everyone in the group." : "No files yet.", member ? h("button", { class: "btn primary", text: "⬆ Upload", onclick: () => fileIn.click() }) : null)
          : h("div", { class: "gr-files glass" },
            ...subs.map(f => h("div", { class: "gr-file", role: "button", tabindex: 0, onclick: () => Apps.go("drive", f.id) }, h("span", { class: "gr-file-ic", text: "📁" }),
              h("span", { class: "gr-file-t" }, h("b", { text: f.name }), h("small", { text: plural(Data.list("files").filter(x => x.folder === f.id && !x.deleted).length, "file") })))),
            ...files.map(row)),
        fileIn);
    }
    const wrap = h("div", { class: "gr-drive" }, box);
    wrap.addEventListener("dragover", e => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); wrap.classList.add("drop"); } });
    wrap.addEventListener("dragleave", e => { if (!wrap.contains(e.relatedTarget)) wrap.classList.remove("drop"); });
    wrap.addEventListener("drop", e => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); wrap.classList.remove("drop"); upload([...e.dataTransfer.files]); });
    draw();
    return { el: wrap, redraw: draw };
  }

  /* ---------- Members tab ---------- */
  function membersMod(p0, ctx) {
    const id = p0.id, box = h("div", { class: "gr-members" });
    function actions(g, k) {
      const me = meKey(), own = isOwner(g) && !isOld(g), mgr = canManage(g) && !isOld(g), r = roleOf(g, k), items = [];
      if (k === me) { if (r !== "owner" && !isOld(g)) items.push({ label: "Leave group", icon: "arrow", onClick: () => leave(g) }); return items; }
      if (own && r === "moderator") items.push({ label: "Remove moderator role", icon: "x", onClick: () => Data.arr("projects", g.id, "moderators", k, false) });
      if (own && r === "member") items.push({ label: "Make moderator", icon: "star", onClick: () => { Data.arr("projects", g.id, "moderators", k); Data.notify(k, `⭐ ${who()} made you a moderator of <b>${esc(g.name)}</b>`, LINK(g.id, "members")); } });
      if (own && r !== "owner") items.push({ label: "Make owner", icon: "lock", onClick: () => makeOwner(g, k) });
      if ((own && r !== "owner") || (mgr && r === "member")) items.push({ sep: true }, { label: "Remove from group", icon: "trash", danger: true, onClick: async () => { if (await UI.confirm(`Remove ${Data.person(k).name} from “${g.name}”?`, "Remove")) removeMember(g, k); } });
      return items;
    }
    const person = (g, k, i) => {
      const p = Data.person(k), r = roleOf(g, k), acts = actions(g, k);
      return h("div", { class: "gr-mem glass", style: { animationDelay: Math.min(i, 14) * 30 + "ms" } }, Apps.avatar(p, 38),
        h("span", { class: "gr-mem-t" }, h("b", { text: p.name + (k === meKey() ? " (you)" : "") }), h("small", { text: [p.title, p.dept].filter(Boolean).join(" · ") || p.email || "" })),
        r && r !== "member" ? h("span", { class: "gr-role", dataset: { r }, text: ROLE_L[r] }) : null,
        acts.length ? h("button", { class: "icon-btn xs", title: "Actions", html: UI.icon("dots"), onclick: e => UI.menu(e.currentTarget, acts, { align: "end" }) }) : null);
    };
    function draw() {
      const g = Data.get("projects", id); if (!g) return;
      if (isOld(g)) return box.replaceChildren(h("div", { class: "gr-hint gr-old" }, "Everyone in the workspace is in this project. ",
        canManage(g) ? h("button", { class: "chip-btn", text: "Choose members", onclick: () => editGroup(g) }) : null),
        h("div", { class: "gr-mem-grid" }, ...membersOf(g).map((k, i) => person(g, k, i))));
      const owner = ownerOf(g), ms = mods(g), rest = membersOf(g).filter(k => k !== owner && !ms.includes(k)).sort((a, b) => Data.person(a).name.localeCompare(Data.person(b).name));
      const reqs = (g.requests || []).filter(k => !isMember(g, k)), mgr = canManage(g);
      const canInvite = isMember(g) && !g.archived && (mgr || privacy(g) === "open");
      box.replaceChildren(
        h("div", { class: "app-toolbar" }, h("span", { class: "gr-mute", text: plural(membersOf(g).length, "member") }), h("span", { class: "grow" }),
          canInvite ? h("button", { class: "btn primary", text: "+ Invite people", onclick: e => invite(e.currentTarget, g) }) : null),
        mgr && reqs.length ? h("div", { class: "gr-reqs glass" }, h("div", { class: "td-sec", text: `Waiting for approval (${reqs.length})` }),
          ...reqs.map(k => h("div", { class: "gr-req" }, Apps.avatar(Data.person(k), 30), h("span", { class: "gr-req-t" }, h("b", { text: Data.person(k).name }), " wants to join"),
            h("button", { class: "btn primary", text: "Approve", onclick: () => approve(g, k) }), h("button", { class: "btn", text: "Decline", onclick: () => decline(g, k) })))) : null,
        h("div", { class: "td-sec", text: "Owner" }), h("div", { class: "gr-mem-grid" }, owner ? person(g, owner, 0) : h("div", { class: "gr-hint", text: "No owner" })),
        ms.length ? h("div", { class: "td-sec", text: `Moderators (${ms.length})` }) : null, ms.length ? h("div", { class: "gr-mem-grid" }, ...ms.map((k, i) => person(g, k, i))) : null,
        h("div", { class: "td-sec", text: `Members (${rest.length})` }),
        rest.length ? h("div", { class: "gr-mem-grid" }, ...rest.map((k, i) => person(g, k, i))) : h("div", { class: "gr-hint", text: "No other members yet." }));
    }
    draw();
    return { el: box, redraw: draw };
  }

  /* ---------- About tab ---------- */
  function aboutMod(p0, ctx) {
    const id = p0.id, box = h("div", { class: "gr-about" });
    function draw() {
      const g = Data.get("projects", id); if (!g) return;
      const s = stats(id), [tIc, tL] = TYPES[typeOf(g)], [pIc, pL, pSub] = PRIV[privacy(g)], read = canRead(g);
      const info = [["Type", tIc + " " + tL], ["Privacy", `${pIc} ${pL} · ${pSub}`], ["Owner", ownerOf(g) ? Data.person(ownerOf(g)).name : "—"],
        g.start || g.finish ? ["Dates", [g.start ? Apps.fmtDate(g.start) : "…", g.finish ? Apps.fmtDate(g.finish) : "…"].join(" – ")] : null,
        ["Created", g.at ? new Date(g.at).toLocaleDateString() : "—"], ["Members", String(membersOf(g).length)]].filter(Boolean);
      const sp = g.type === "scrum" && read ? activeSprint(g) : null;
      const daysLeft = g.finish ? dayDiff(T(), g.finish) : null;
      box.replaceChildren(
        h("div", { class: "gr-card-box glass gr-about-main" },
          h("div", { class: "gr-about-desc", text: g.desc || "No description yet." }),
          canManage(g) ? h("button", { class: "chip-btn", text: "✏️ Edit workgroup", onclick: () => editGroup(g) }) : null,
          h("div", { class: "gr-info" }, ...info.flatMap(([l, v]) => [h("span", { text: l }), h("b", { text: v })]))),
        read ? h("div", { class: "gr-tiles" }, ...[["Tasks", s.total, ""], ["Done", s.done, "green"], ["Open", s.open, "blue"], ["Overdue", s.overdue, "red"]].map(([l, n, c], i) =>
          h("div", { class: "gr-tile glass", dataset: { c }, style: { animationDelay: i * 50 + "ms" } }, h("b", { text: n }), h("small", { text: l })))) : null,
        read ? h("div", { class: "gr-card-box glass" }, h("div", { class: "td-sec", text: "Progress" }),
          h("div", { class: "progress gr-big-prog" }, h("span", { style: { width: s.pct + "%" } })),
          h("small", { class: "gr-mute", text: `${s.done} of ${plural(s.total, "task")} done · ${s.pct}%` + (daysLeft != null ? (daysLeft >= 0 ? ` · ${plural(daysLeft, "day")} until the finish date` : ` · finish date passed ${plural(-daysLeft, "day")} ago`) : "") })) : null,
        sp ? h("div", { class: "gr-card-box glass" }, h("div", { class: "gr-rep-h" }, h("div", { class: "td-sec", text: `Burndown · ${sp.name}` }), h("span", { class: "grow" }),
          h("button", { class: "chip-btn", text: "Open Scrum", onclick: () => ctx.setTab("scrum") })), burnChart(burn(g, sp), true)) : null);
    }
    draw();
    return { el: box, redraw: draw };
  }

  const MODS = { feed: feedMod, tasks: tasksMod, scrum: scrumMod, calendar: calMod, drive: driveMod, members: membersMod, about: aboutMod };

  /* ---------- app ---------- */
  function open(id, tab) { location.hash = LINK(id, tab); }
  function render(root, arg) {
    if (Apps.can && !Apps.can("groups")) { root.append(Apps.header("Workgroups", "👥", ""), Apps.empty("🔒", "You don't have access to workgroups in this workspace.")); return null; }
    const [id, tab] = String(arg || "").split("/");
    return id ? spaceView(root, id, tab) : listView(root);
  }

  /* sidebar badge: join requests waiting for me (I own or moderate the group) */
  function paintBadge() {
    const me = meKey();
    Apps.badge("groups", Data.list("projects").filter(p => !p.archived && !isOld(p) && (ownerOf(p) === me || mods(p).includes(me))).reduce((n, p) => n + (p.requests || []).filter(k => !p.members.includes(k)).length, 0));
  }
  let unBadge = null;
  const startBadge = () => { unBadge && unBadge(); unBadge = Data.on("projects", paintBadge); };

  Apps.register("groups", { title: "Workgroups", icon: "👥", render });
  Apps.Groups = { open, mine, canSee, canRead, isMember: (p, k) => isMember(p, k || meKey()), roleOf, membersOf, canManage,
    create: preset => editGroup(null, preset), edit: p => editGroup(p) };
  Apps.onWorkspace.add(startBadge);
  setTimeout(startBadge, 0);
})();
