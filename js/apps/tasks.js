/* Tasks & Projects (Bitrix24-style): roles, list / kanban / deadlines / planner / calendar / Gantt views, subtasks,
   related tasks, tags, reminders, files, recurring tasks, templates, time tracking, approval, efficiency, recycle bin */
(function () {
  const { h, esc } = UI;
  const STATUS = [["todo", "To do", "gray"], ["doing", "In progress", "blue"], ["review", "Waiting for approval", "purple"], ["done", "Done", "green"]];
  const PRI = { high: ["🔥", "High"], normal: ["", "Normal"], low: ["⬇️", "Low"] };
  const REPEAT = [["", "Doesn't repeat"], ["day", "Every day"], ["week", "Every week"], ["month", "Every month"], ["year", "Every year"]];
  const VIEWS = [["list", "☰ List"], ["kanban", "▥ Kanban"], ["deadline", "⏱ Deadlines"], ["planner", "🗂 Planner"], ["calendar", "📅 Calendar"], ["gantt", "📊 Gantt"]];
  const TAG_COLORS = ["blue", "green", "purple", "orange", "pink", "yellow", "red", "brown"];
  const st = k => STATUS.find(s => s[0] === k) || STATUS[0];
  const T = () => Apps.today();
  const LINK = id => "#/app/tasks/" + id;
  const meKey = () => Data.me().key;
  const ls = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  /* ---------- who sees what ---------- */
  // templates and deleted tasks never show up in normal lists
  const live = t => !!t && !t.deleted && t.kind !== "template";
  const isDoing = (t, k = meKey()) => t.assignee === k || (t.participants || []).includes(k);
  const isMine = (t, k = meKey()) => Apps.isMyTask ? Apps.isMyTask(t, k) : isDoing(t, k) || (!t.assignee && t.by === k);
  const involved = (t, k = meKey()) => isDoing(t, k) || t.by === k || (t.observers || []).includes(k);
  // workgroups: projects (groups) I can see; tasks of secret groups only for members and the task's own people
  const seeProject = p => !p || !Apps.Groups?.canSee || Apps.Groups.canSee(p);
  const seeTask = t => { const p = t.project && Data.get("projects", t.project); return !p || seeProject(p) || involved(t); };
  const visProjects = (keep = "") => Data.list("projects").filter(p => p.id === keep || (seeProject(p) && !p.archived));
  const liveTasks = () => (Apps.liveTasks ? Apps.liveTasks() : Data.list("tasks").filter(live)).filter(seeTask);
  // everyone who follows a task (minus me): assignee, creator, participants, observers
  const watchers = t => [...new Set([t.assignee, t.by, ...(t.participants || []), ...(t.observers || [])])].filter(k => k && k !== meKey());
  const tell = (keys, html, t, preview) => [...new Set(keys)].filter(k => k && k !== meKey()).forEach(k => Data.notify(k, html, LINK(t.id), preview));

  /* ---------- small helpers ---------- */
  const due = t => !t.deadline ? "none" : t.status === "done" ? "done" : t.deadline < T() ? "overdue" : t.deadline === T() ? "today" : t.deadline <= Apps.addDays(T(), 7) ? "week" : "later";
  const daysBetween = (a, b) => Math.round((new Date(b + "T00:00") - new Date(a + "T00:00")) / 864e5);
  const mondayOf = d => Apps.addDays(d, -((new Date(d + "T00:00").getDay() + 6) % 7));
  const tagColor = s => { let x = 0; for (const c of String(s).toLowerCase()) x = (x * 31 + c.charCodeAt(0)) >>> 0; return TAG_COLORS[x % TAG_COLORS.length]; };
  const parseTags = v => [...new Map((Array.isArray(v) ? v : String(v || "").split(",")).map(s => String(s).trim().replace(/^#/, "")).filter(Boolean).map(s => [s.toLowerCase(), s])).values()];
  const allTags = () => [...new Map(liveTasks().flatMap(t => t.tags || []).map(s => [s.toLowerCase(), s])).values()].sort((a, b) => a.localeCompare(b));
  const fmtDur = sec => { const m = Math.floor((sec || 0) / 60), hh = Math.floor(m / 60); return hh ? `${hh}h${m % 60 ? " " + (m % 60) + "m" : ""}` : `${m}m`; };
  const clock = sec => [Math.floor(sec / 3600), Math.floor(sec / 60) % 60, Math.floor(sec) % 60].map(n => String(n).padStart(2, "0")).join(":");
  const spent = t => (t.timeSpent || 0) + (t.tracking ? Math.max(0, (Date.now() - (t.tracking.since || Date.now())) / 1000) : 0);
  const fmtWhen = ms => new Date(ms).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const stColor = t => `var(--c-${st(t.status)[2]})`;
  const firstName = k => (Data.person(k).name || "").split(" ")[0];
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const clockEl = t => h("span", { class: "tk-clock", dataset: { since: t.tracking.since, base: t.timeSpent || 0 }, text: clock(spent(t)) });
  // one ticker for every running timer on screen (cards, rows, the task panel)
  setInterval(() => document.querySelectorAll(".tk-clock[data-since]").forEach(el => { el.textContent = clock((+el.dataset.base || 0) + Math.max(0, Date.now() - +el.dataset.since) / 1000); }), 1000);

  // comment text with @mentions highlighted (built from text nodes, never innerHTML)
  function richText(text) {
    text = String(text || "");
    const el = h("div", { class: "cmt-t" }), handles = Data.people().map(p => Apps.handleOf ? Apps.handleOf(p) : "").filter(Boolean);
    if (!handles.length) { el.textContent = text; return el; }
    const re = new RegExp("@(" + handles.map(reEsc).join("|") + ")(?![\\w.-])", "gi");
    let last = 0;
    text.replace(re, (m, _g, i) => { el.append(text.slice(last, i), h("span", { class: "mention-at", text: m })); last = i + m.length; return m; });
    el.append(text.slice(last));
    return el;
  }

  /* ---------- time tracking ---------- */
  const stopPatch = t => t.tracking ? { tracking: null, timeSpent: Math.round(spent(t)) } : {};
  function startTimer(t) {
    // only one timer runs per person: stop the others first
    liveTasks().filter(x => x.id !== t.id && x.tracking && x.tracking.by === meKey()).forEach(x => Data.update("tasks", x.id, stopPatch(x)));
    Data.update("tasks", t.id, { tracking: { by: meKey(), since: Date.now() }, ...((t.status || "todo") === "todo" ? { status: "doing" } : {}) });
  }
  const stopTimer = t => Data.update("tasks", t.id, stopPatch(t));

  /* ---------- recurring tasks ---------- */
  function step(d, freq) {
    const x = new Date(d + "T00:00"), day = x.getDate();
    if (freq === "day") x.setDate(day + 1);
    else if (freq === "week") x.setDate(day + 7);
    else {
      x.setDate(1);
      if (freq === "month") x.setMonth(x.getMonth() + 1); else x.setFullYear(x.getFullYear() + 1);
      x.setDate(Math.min(day, new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate()));
    }
    return Apps.iso(x);
  }
  // the next copy of a repeating task (or null when the repeat has ended)
  function nextOccurrence(t) {
    const r = t.repeat; if (!r || !r.freq) return null;
    const base = t.deadline || T();
    let next = step(base, r.freq);
    for (let i = 0; next < T() && i < 800; i++) next = step(next, r.freq);
    if (r.until && next > r.until) return null;
    const shift = daysBetween(base, next);
    return { title: t.title, desc: t.desc || "", status: "todo", priority: t.priority || "normal", project: t.project || "", assignee: t.assignee || "", by: t.by,
      participants: [...(t.participants || [])], observers: [...(t.observers || [])], tags: [...(t.tags || [])],
      checklist: (t.checklist || []).map(c => ({ id: Data.uid(), t: c.t, done: false })), comments: [], files: [],
      deadline: next, start: t.start ? Apps.addDays(t.start, shift) : "", estimate: t.estimate || 0, timeSpent: 0, needsApproval: !!t.needsApproval,
      parentId: t.parentId || "", repeat: { freq: r.freq, until: r.until || "" } };
  }

  /* ---------- status changes: approval, recurrence, notifications ---------- */
  async function setStatus(t, k, opts = {}) {
    const me = Data.me(); t = Data.get("tasks", t.id) || t;
    if (!t || (t.status || "todo") === k) return;
    // "Check the result": someone other than the creator finishing sends it for approval instead
    if (k === "done" && t.needsApproval && t.by && t.by !== me.key && !opts.approve) k = "review";
    const patch = { status: k, completedAt: k === "done" ? Date.now() : null };
    if (k === "done" || k === "review") Object.assign(patch, stopPatch(t));
    const next = k === "done" ? nextOccurrence(t) : null;
    if (next) patch.repeat = null; // the repeat moves to the new copy
    Data.update("tasks", t.id, patch);
    const who = `<b>${esc(me.name)}</b>`, name = `“${esc(t.title)}”`;
    if (k === "review") {
      Data.notify(t.by, `🕵️ ${who} finished ${name}. Please check the result`, LINK(t.id), "Waiting for your approval");
      tell(watchers(t).filter(x => x !== t.by), `${who} sent ${name} for approval`, t);
      if (t.by !== me.key) UI.toast(`🕵️ Sent to ${firstName(t.by)} for approval`);
    } else {
      tell(watchers(t), opts.approve ? `✅ ${who} approved ${name}` : `${who} moved ${name} to <b>${st(k)[1]}</b>`, t);
      if (k === "done") UI.toast(opts.approve ? "✅ Approved" : "🎉 Task done!");
    }
    if (next) {
      const nid = await Data.add("tasks", next);
      setTimeout(() => UI.toast(`🔁 Next one is due ${Apps.fmtDate(next.deadline)}`, { label: "Open", run: () => openTask(nid) }), 600);
      return nid;
    }
  }
  const approve = t => setStatus(t, "done", { approve: true });
  async function sendBack(t) {
    const v = await Apps.form("Send back for rework", [{ key: "text", label: "What needs to change?", type: "textarea", rows: 3, required: true }], {}, { ok: "Send back" });
    if (!v) return;
    const me = Data.me();
    Data.update("tasks", t.id, { status: "doing", completedAt: null });
    Data.arr("tasks", t.id, "comments", { id: Data.uid(), by: me.key, text: "↩️ Sent back: " + v.text, at: Date.now() });
    tell([t.assignee, ...(t.participants || [])], `↩️ <b>${esc(me.name)}</b> sent back “${esc(t.title)}”`, t, v.text);
    UI.toast("↩️ Sent back");
  }

  /* ---------- recycle bin ---------- */
  const restore = t => Data.update("tasks", t.id, { deleted: false, deletedAt: null });
  function trash(t) {
    Data.update("tasks", t.id, { deleted: true, deletedAt: Date.now(), deletedBy: meKey(), ...stopPatch(t) });
    UI.toast("🗑 Moved to the recycle bin", { label: "Undo", run: () => restore(t) });
  }
  // delete forever, including the attached files
  function purge(t) {
    [...(t.files || []), ...(t.comments || []).flatMap(c => c.files || [])].forEach(a => a && a.id && Data.remove("files", a.id));
    Data.remove("tasks", t.id);
  }

  /* ---------- templates (docs in tasks with kind: "template") ---------- */
  const templates = () => Data.list("tasks").filter(t => t.kind === "template" && !t.deleted).sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  const tplFields = t => ({ title: t.title || "", desc: t.desc || "", priority: t.priority || "normal", project: t.project || "", assignee: t.assignee || "",
    participants: [...(t.participants || [])], observers: [...(t.observers || [])], tags: [...(t.tags || [])],
    checklist: (t.checklist || []).map(c => ({ id: Data.uid(), t: c.t, done: false })), estimate: t.estimate || 0, needsApproval: !!t.needsApproval,
    repeat: t.repeat && t.repeat.freq ? { freq: t.repeat.freq, until: "" } : null });
  async function saveTemplate(t) {
    await Data.add("tasks", { kind: "template", ...tplFields(t) });
    UI.toast("📋 Saved as a template");
  }
  function templateMenu(anchor, preset = {}) {
    const box = h("div", { class: "tk-tpl" });
    const fill = () => {
      const ts = templates();
      box.replaceChildren(h("div", { class: "menu-sec", text: "Create from a template" }),
        ...(ts.length ? ts.map(tp => h("div", { class: "mi compact tk-tpl-row", role: "button", tabindex: 0, onclick: () => { api.close(); newTask({ ...tplFields(tp), ...preset }, true); } },
          h("span", { class: "mi-ic", text: "📋" }), h("span", { class: "mi-t", text: tp.title || "Untitled template" }),
          h("button", { class: "icon-btn xs", title: "Delete template", html: UI.icon("trash"), onclick: async e => {
            e.stopPropagation();
            if (await UI.confirm(`Delete the template “${tp.title}”?`)) { Data.remove("tasks", tp.id); UI.toast("Template deleted"); }
          } })))
          : [h("div", { class: "menu-empty", text: "No templates yet. Open a task and choose ⋯ → Save as template." })]));
    };
    fill();
    const api = UI.popover(anchor, box, { align: "end" });
  }

  /* ---------- new task ---------- */
  async function newTask(preset = {}, fromTpl = false) {
    const me = Data.me(), projects = visProjects(preset.project || "");
    const rep = preset.repeat && typeof preset.repeat === "object" ? preset.repeat : { freq: preset.repeat || "", until: "" };
    const v = await Apps.form(fromTpl ? "New task from template" : preset.parentId ? "New subtask" : "New task", [
      { key: "title", label: "Task", required: true, placeholder: "What needs to be done?" },
      { key: "desc", label: "Description", type: "textarea", rows: 3 },
      { key: "assignee", label: "Responsible person", type: "person", half: true },
      { key: "deadline", label: "Deadline", type: "date", half: true },
      { key: "participants", label: "Participants", type: "people", half: true, placeholder: "Add participants…" },
      { key: "observers", label: "Observers", type: "people", half: true, placeholder: "Add observers…" },
      { key: "start", label: "Start date", type: "date", half: true },
      { key: "estH", label: "Time estimate, hours", type: "number", half: true, placeholder: "0" },
      { key: "priority", label: "Priority", type: "select", options: [["normal", "Normal"], ["high", "🔥 High"], ["low", "⬇️ Low"]], half: true },
      { key: "project", label: "Project", type: "select", options: [["", "No project"], ...projects.map(p => [p.id, p.name])], half: true },
      { key: "repeat", label: "Repeat", type: "select", options: REPEAT, half: true },
      { key: "tags", label: "Tags", placeholder: "design, urgent", half: true },
      { key: "needsApproval", label: "Check the result when it's done", type: "checkbox" },
    ], { assignee: me.key, priority: "normal", status: "todo", ...preset, repeat: rep.freq || "", tags: parseTags(preset.tags).join(", "),
      estH: preset.estimate ? Math.round(preset.estimate / 6) / 10 : "" }, { ok: "Create task", width: 580 });
    if (!v) return;
    const doc = {
      title: String(v.title).trim(), desc: v.desc || "", status: v.status || "todo", priority: v.priority || "normal", assignee: v.assignee || "",
      deadline: v.deadline || "", start: v.start || "", project: v.project || "", parentId: v.parentId || "",
      participants: (v.participants || []).filter(k => k !== v.assignee), observers: v.observers || [], tags: parseTags(v.tags),
      needsApproval: !!v.needsApproval, repeat: v.repeat ? { freq: v.repeat, until: rep.until || "" } : null,
      estimate: Math.round((+v.estH || 0) * 60), timeSpent: 0, checklist: (v.checklist || []).map(c => ({ id: c.id || Data.uid(), t: c.t, done: false })),
      comments: [], files: [], related: [],
      // Scrum fields passed in by Workgroups (sprint, epic, story points) are kept
      ...(v.sprint ? { sprint: v.sprint } : {}), ...(v.epic ? { epic: v.epic } : {}), ...(+v.points ? { points: +v.points } : {}), ...(typeof v.rank === "number" ? { rank: v.rank } : {}),
    };
    const id = await Data.add("tasks", doc);
    const who = `<b>${esc(me.name)}</b>`, nm = `“${esc(doc.title)}”`, pv = [doc.deadline ? "Due " + Apps.fmtDate(doc.deadline) : "", doc.desc].filter(Boolean).join(" · ");
    if (doc.assignee) Data.notify(doc.assignee, `${who} assigned you a task: ${nm}`, LINK(id), pv);
    doc.participants.forEach(k => Data.notify(k, `${who} added you as a participant in ${nm}`, LINK(id), pv));
    doc.observers.filter(k => k !== doc.assignee && !doc.participants.includes(k)).forEach(k => Data.notify(k, `👀 ${who} added you as an observer of ${nm}`, LINK(id), pv));
    UI.toast("✅ Task created");
    return id;
  }

  /* ---------- shared bits for cards, rows and the panel ---------- */
  let onTagClick = null; // set by the open Tasks screen: clicking a tag filters by it
  const tagChips = (t, max = 3) => (t.tags || []).length ? h("span", { class: "tk-tags" },
    ...(t.tags || []).slice(0, max).map(tag => h("span", { class: "tag tk-tag", dataset: { tc: tagColor(tag) }, text: "#" + tag, title: "Show tasks tagged #" + tag,
      onclick: e => { if (onTagClick) { e.stopPropagation(); onTagClick(tag); } } })),
    (t.tags || []).length > max ? h("small", { class: "cl-n", text: "+" + ((t.tags || []).length - max) }) : null) : null;
  let SUBS = {}; // parentId → [done, total], refreshed on every draw
  const subCounts = () => { const m = {}; liveTasks().forEach(t => { if (t.parentId) { const c = m[t.parentId] ||= [0, 0]; c[1]++; if (t.status === "done") c[0]++; } }); return m; };
  function metaIcons(t) {
    const cl = t.checklist || [], sub = SUBS[t.id], out = [];
    if (cl.length) out.push(h("small", { class: "cl-n", title: "Checklist", text: `☑ ${cl.filter(c => c.done).length}/${cl.length}` }));
    if (sub) out.push(h("small", { class: "cl-n", title: "Subtasks", text: `⑂ ${sub[0]}/${sub[1]}` }));
    if ((t.comments || []).length) out.push(h("small", { class: "cl-n", title: "Comments", text: `💬 ${t.comments.length}` }));
    if ((t.files || []).length) out.push(h("small", { class: "cl-n", title: "Files", text: `📎 ${t.files.length}` }));
    if (t.repeat && t.repeat.freq) out.push(h("small", { class: "cl-n", title: "Repeats", text: "🔁" }));
    if (t.status === "review") out.push(h("small", { class: "cl-n", title: "Waiting for approval", text: "🕵️" }));
    return out;
  }
  function dragify(el, id) {
    el.addEventListener("dragstart", e => { e.dataTransfer.setData("text/task", id); e.dataTransfer.effectAllowed = "move"; el.classList.add("dragging"); });
    el.addEventListener("dragend", () => el.classList.remove("dragging"));
  }
  function dropZone(el, onDrop) {
    el.addEventListener("dragover", e => { e.preventDefault(); el.classList.add("drop"); });
    el.addEventListener("dragleave", e => { if (!el.contains(e.relatedTarget)) el.classList.remove("drop"); });
    el.addEventListener("drop", e => { e.preventDefault(); el.classList.remove("drop"); const id = e.dataTransfer.getData("text/task"); if (id) onDrop(id); });
  }
  const setDeadline = (id, date) => {
    const t = Data.get("tasks", id); if (!t || (t.deadline || "") === date) return;
    Data.update("tasks", id, { deadline: date });
    UI.toast(date ? "📅 Due " + Apps.fmtDate(date) : "Deadline removed");
  };

  /* ---------- reminders: checked every 30 s, even when the Tasks app isn't open ---------- */
  const REM_KEY = "lumen-task-reminded";
  function checkReminders() {
    try {
      if (!window.Data || !window.Apps?.today) return;
      const k = meKey(), now = Date.now();
      let fired; try { fired = JSON.parse(ls(REM_KEY)) || {}; } catch { fired = {}; }
      liveTasks().forEach(t => {
        if (!t.remindAt || t.remindAt > now || t.remindBy !== k) return;
        const key = t.id + "|" + t.remindAt;
        if (!fired[key]) { // another tab may have shown it already
          fired[key] = now;
          window.Notify?.alert({ title: "⏰ Reminder: " + (t.title || "Task"), body: [t.deadline ? "Due " + Apps.fmtDate(t.deadline) : "", st(t.status)[1]].filter(Boolean).join(" · "),
            link: LINK(t.id), icon: "⏰", tag: "task-rem-" + t.id });
        }
        Data.update("tasks", t.id, { remindAt: null, remindBy: null }); // fire once
      });
      for (const x in fired) if (now - fired[x] > 7 * 864e5) delete fired[x];
      lsSet(REM_KEY, JSON.stringify(fired));
    } catch (e) { console.warn("task reminders", e); }
  }
  setInterval(checkReminders, 30000);
  setTimeout(checkReminders, 5000);

  function reminderPop(anchor, t) {
    const at = (d, hh, mm) => { const x = new Date(d + "T00:00"); x.setHours(hh, mm, 0, 0); return x.getTime(); };
    const setR = ms => {
      if (ms <= Date.now()) return UI.toast("That time has already passed");
      Data.update("tasks", t.id, { remindAt: ms, remindBy: meKey() }); api.close(); UI.toast("⏰ I'll remind you " + fmtWhen(ms));
    };
    const date = h("input", { type: "date", class: "menu-input", value: t.deadline && t.deadline >= T() ? t.deadline : Apps.addDays(T(), 1) });
    const time = h("input", { type: "time", class: "menu-input", value: "09:00" });
    const api = UI.popover(anchor, h("div", { class: "tk-rem" },
      h("div", { class: "menu-sec", text: "Remind me" }),
      h("button", { class: "mi compact", onclick: () => setR(Date.now() + 36e5) }, h("span", { class: "mi-ic", text: "🕐" }), "In 1 hour"),
      h("button", { class: "mi compact", onclick: () => setR(at(Apps.addDays(T(), 1), 9, 0)) }, h("span", { class: "mi-ic", text: "🌅" }), "Tomorrow at 9:00"),
      t.deadline ? h("button", { class: "mi compact", onclick: () => setR(at(Apps.addDays(t.deadline, -1), 9, 0)) }, h("span", { class: "mi-ic", text: "📅" }), "1 day before the deadline, 9:00") : null,
      h("div", { class: "menu-sec", text: "Pick a time" }),
      h("div", { class: "tk-rem-row" }, date, time),
      h("button", { class: "btn primary tk-rem-ok", text: "Set reminder", onclick: () => { if (!date.value) return; const [hh, mm] = (time.value || "09:00").split(":").map(Number); setR(at(date.value, hh, mm)); } })));
  }

  function linkPop(anchor, t) {
    const inp = h("input", { class: "menu-input", placeholder: "Search tasks…" }), list = h("div", { class: "pp-list" });
    const fill = () => {
      const q = inp.value.toLowerCase(), have = new Set([t.id, ...(t.related || [])]);
      const res = liveTasks().filter(x => !have.has(x.id) && (x.title || "").toLowerCase().includes(q)).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 8);
      list.replaceChildren(...(res.length ? res.map(x => h("button", { class: "mi compact", onclick: () => { Data.arr("tasks", t.id, "related", x.id); api.close(); UI.toast("🔗 Linked"); } },
        h("span", { class: "mi-ic", text: x.status === "done" ? "☑️" : "✅" }), h("span", { class: "mi-t", text: x.title || "Untitled task" }), x.deadline ? h("span", { class: "mi-k", text: Apps.fmtDate(x.deadline) }) : null))
        : [h("div", { class: "menu-empty", text: "No tasks found" })]));
    };
    inp.addEventListener("input", fill); fill();
    const api = UI.popover(anchor, h("div", { style: { width: "300px" } }, inp, list));
    setTimeout(() => inp.focus(), 30);
  }

  /* ---------- task detail slider ---------- */
  function openTask(id) {
    const t0 = Data.get("tasks", id); if (!t0 || t0.kind === "template") return UI.toast("Task not found");
    if (!seeTask(t0)) return UI.toast("🕶️ This task belongs to a private workgroup");
    const body = h("div", { class: "task-detail tk-detail" });
    const menuBtn = h("button", { class: "icon-btn", title: "More actions", html: UI.icon("dots") });
    const p = Apps.panel("Task", body, [menuBtn]);
    const go = tid => { p.close(); setTimeout(() => openTask(tid), 120); };
    menuBtn.onclick = () => {
      const t = Data.get("tasks", id); if (!t) return;
      UI.menu(menuBtn, [
        { label: "Copy link", icon: "link", onClick: () => { navigator.clipboard?.writeText(location.href.split("#")[0] + LINK(id)); UI.toast("🔗 Link copied"); } },
        { label: "Save as template", icon: "copy", onClick: () => saveTemplate(t) },
        { label: "Add subtask", icon: "plus", onClick: () => newTask({ parentId: id, project: t.project || "", assignee: t.assignee || meKey() }) },
        { sep: true },
        t.deleted ? { label: "Restore", icon: "restore", onClick: () => restore(t) }
          : { label: "Move to recycle bin", icon: "trash", danger: true, onClick: () => { trash(t); p.close(); } },
      ], { align: "end" });
    };
    let draft = "", pending = [];
    const notified = new Set();
    const off = Data.on("tasks", UI.liveDraw(body, draw));
    p.onClose = off;

    function draw() {
      const t = Data.get("tasks", id); if (!t || t.kind === "template") return p.close();
      const me = Data.me(), set = patch => Data.update("tasks", id, patch);
      const nm = `“${esc(t.title)}”`, who = `<b>${esc(me.name)}</b>`;

      // title + meta
      const title = h("div", { class: "peek-title", contenteditable: true, text: t.title });
      title.addEventListener("blur", () => title.textContent.trim() !== t.title && set({ title: title.textContent.trim() || "Untitled task" }));
      title.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); title.blur(); } });
      const parent = t.parentId && Data.get("tasks", t.parentId);
      const bin = t.deleted ? h("div", { class: "tk-banner bin" }, h("span", { text: "🗑 This task is in the recycle bin." }), h("button", { class: "btn", text: "Restore", onclick: () => { restore(t); UI.toast("♻️ Restored"); } })) : null;

      // approval
      let appr = null;
      if (t.status === "review") appr = t.by === me.key
        ? h("div", { class: "tk-banner review" }, h("span", { text: `🕵️ ${t.assignee && t.assignee !== me.key ? firstName(t.assignee) + " finished this task." : "This task is finished."} Check the result.` }),
          h("span", { class: "tk-banner-btns" }, h("button", { class: "btn primary", text: "✓ Approve", onclick: () => approve(t) }), h("button", { class: "btn", text: "↩ Send back", onclick: () => sendBack(t) })))
        : h("div", { class: "tk-banner review" }, h("span", { text: `🕵️ Waiting for approval from ${Data.person(t.by).name}` }));

      // status
      const statusSel = h("div", { class: "seg status-seg" }, ...STATUS.filter(s => s[0] !== "review" || t.status === "review").map(([k, l]) =>
        h("button", { class: (t.status || "todo") === k ? "on" : "", text: l, onclick: () => setStatus(t, k) })));
      const apprHint = t.needsApproval && t.by !== me.key && t.status !== "done" && t.status !== "review" ? h("div", { class: "tk-hint", text: `When you mark it done, ${firstName(t.by)} checks the result.` }) : null;

      // time tracking
      const est = t.estimate || 0, sp = spent(t), run = t.tracking, myRun = run && run.by === me.key;
      const timerBtn = run && !myRun ? h("button", { class: "btn", disabled: true, text: `⏱ ${firstName(run.by)} is tracking` })
        : h("button", { class: "btn tk-timer-btn" + (myRun ? " on" : ""), text: myRun ? "■ Stop" : "▶ Start", onclick: () => myRun ? stopTimer(t) : startTimer(t) });
      const pct = est ? Math.min(100, sp / (est * 60) * 100) : 0;
      const timeBox = h("div", { class: "tk-time glass" + (run ? " running" : "") }, timerBtn,
        h("div", { class: "tk-time-info" },
          h("div", null, run ? clockEl(t) : h("b", { text: fmtDur(sp) }), h("span", { class: "tk-time-of", text: est ? ` of ${fmtDur(est * 60)}` : run ? "" : " spent" })),
          est ? h("div", { class: "progress" + (sp > est * 60 ? " over" : "") }, h("span", { style: { width: pct + "%" } })) : null));

      // fields
      const whoBtn = h("button", { class: "chip-btn" }, Apps.avatar(Data.person(t.assignee), 20), t.assignee ? Data.person(t.assignee).name : "Nobody");
      whoBtn.onclick = () => Apps.personPicker(whoBtn, pp => { set({ assignee: pp ? pp.key : "" }); if (pp) Data.notify(pp.key, `${who} assigned you ${nm}`, LINK(id)); }, { allowNone: true });
      const peopleBtn = (field, label) => {
        const ks = t[field] || [];
        const b = h("button", { class: "chip-btn tk-people" }, ks.length ? Apps.avatars(ks, 20, 6) : null, h("span", { text: ks.length ? ks.map(firstName).join(", ") : "+ Add" }));
        b.onclick = () => {
          const orig = ks.slice();
          Apps.peoplePicker(b, ks, next => {
            set({ [field]: next });
            next.filter(k => !orig.includes(k) && !notified.has(field + k)).forEach(k => { notified.add(field + k); Data.notify(k, `${field === "observers" ? "👀 " : ""}${who} added you as ${label} ${nm}`, LINK(id)); });
          });
        };
        return b;
      };
      const dateIn = (val, onSet) => { const i = h("input", { type: "date", class: "chip-in", value: val || "" }); i.onchange = () => onSet(i.value); return i; };
      const pri = h("select", { class: "chip-in" }, ...Object.entries(PRI).map(([k, [i, l]]) => h("option", { value: k, selected: (t.priority || "normal") === k }, (i ? i + " " : "") + l)));
      pri.onchange = () => set({ priority: pri.value });
      const proj = h("select", { class: "chip-in" }, h("option", { value: "" }, "No project"), ...visProjects(t.project || "").map(pr => h("option", { value: pr.id, selected: t.project === pr.id }, pr.name)));
      proj.onchange = () => set({ project: proj.value });
      // Scrum workgroups: story points, sprint and epic
      const grp = t.project && Data.get("projects", t.project), scrumRows = [];
      if (grp && grp.type === "scrum") {
        const sel = (opts, val, field, num) => { const s = h("select", { class: "chip-in" }, ...opts.map(([k, l]) => h("option", { value: k, selected: String(val) === String(k) }, l))); s.onchange = () => set({ [field]: num ? +s.value : s.value }); return s; };
        scrumRows.push(
          h("span", { text: "Story points" }), sel([0, 1, 2, 3, 5, 8, 13].map(n => [n, n ? String(n) : "–"]), +t.points || 0, "points", true),
          h("span", { text: "Sprint" }), sel([["", "Backlog"], ...(grp.sprints || []).filter(s => s.status !== "done" || s.id === t.sprint).map(s => [s.id, s.name + (s.status === "active" ? " (active)" : s.status === "done" ? " (done)" : "")])], t.sprint || "", "sprint"),
          h("span", { text: "Epic" }), sel([["", "No epic"], ...(grp.epics || []).map(e => [e.id, e.name])], t.epic || "", "epic"));
      }
      const estH = h("input", { type: "number", min: 0, class: "chip-in tk-num", value: Math.floor(est / 60) || "", placeholder: "0" });
      const estM = h("input", { type: "number", min: 0, max: 59, class: "chip-in tk-num", value: est % 60 || "", placeholder: "0" });
      estH.onchange = estM.onchange = () => { const v = (+estH.value || 0) * 60 + (+estM.value || 0); if (v !== est) set({ estimate: v }); };
      const rep = h("select", { class: "chip-in" }, ...REPEAT.map(([k, l]) => h("option", { value: k, selected: ((t.repeat && t.repeat.freq) || "") === k }, l)));
      rep.onchange = () => set({ repeat: rep.value ? { freq: rep.value, until: (t.repeat && t.repeat.until) || "" } : null });
      const myRem = t.remindAt && t.remindBy === me.key;
      const remEl = myRem
        ? h("span", { class: "chip-btn tk-rem-chip" }, "⏰ " + fmtWhen(t.remindAt), h("button", { class: "icon-btn xs", title: "Cancel reminder", html: UI.icon("x"), onclick: () => set({ remindAt: null, remindBy: null }) }))
        : h("button", { class: "chip-btn", text: "⏰ Remind me", onclick: e => reminderPop(e.currentTarget, t) });
      const tagIn = h("input", { class: "chip-in tk-tag-in", placeholder: "+ Tag", list: "tk-tag-list" });
      const addTags = () => {
        const cur = (t.tags || []).map(x => x.toLowerCase());
        parseTags(tagIn.value).forEach(tag => { if (!cur.includes(tag.toLowerCase())) Data.arr("tasks", id, "tags", tag); });
        tagIn.value = ""; draw(); setTimeout(() => body.querySelector(".tk-tag-in")?.focus(), 30);
      };
      tagIn.onkeydown = e => { if ((e.key === "Enter" || e.key === ",") && tagIn.value.trim()) { e.preventDefault(); addTags(); } };
      const tagsEl = h("div", { class: "tk-v tk-tagbox" }, ...(t.tags || []).map(tag => h("span", { class: "tag tk-tag", dataset: { tc: tagColor(tag) } }, "#" + tag,
        h("span", { class: "x", text: " ×", title: "Remove tag", onclick: () => Data.arr("tasks", id, "tags", tag, false) }))), tagIn,
        h("datalist", { id: "tk-tag-list" }, ...allTags().map(x => h("option", { value: x }))));

      const grid = h("div", { class: "td-grid" },
        h("span", { text: "Responsible" }), whoBtn,
        h("span", { text: "Participants" }), peopleBtn("participants", "a participant in"),
        h("span", { text: "Observers" }), peopleBtn("observers", "an observer of"),
        h("span", { text: "Start date" }), h("div", { class: "tk-v" }, dateIn(t.start, v => set({ start: v }))),
        h("span", { text: "Deadline" }), h("span", { class: "td-dl " + due(t) }, dateIn(t.deadline, v => set({ deadline: v })), due(t) === "overdue" ? h("b", { text: " Overdue" }) : null),
        h("span", { text: "Estimate" }), h("div", { class: "tk-v" }, estH, h("small", { text: "h" }), estM, h("small", { text: "min" })),
        h("span", { text: "Priority" }), pri,
        h("span", { text: "Project" }), proj, ...scrumRows,
        h("span", { text: "Repeat" }), h("div", { class: "tk-v" }, rep, t.repeat && t.repeat.freq ? h("small", { text: "until" }) : null,
          t.repeat && t.repeat.freq ? dateIn(t.repeat.until, v => set({ repeat: { freq: t.repeat.freq, until: v } })) : null),
        h("span", { text: "Reminder" }), h("div", { class: "tk-v" }, remEl),
        h("span", { text: "Tags" }), tagsEl,
        h("span", { text: "Approval" }), h("label", { class: "tk-check" }, h("input", { type: "checkbox", checked: !!t.needsApproval, onchange: e => set({ needsApproval: e.target.checked }) }), "Check the result when it's done"));

      // description
      const desc = h("textarea", { class: "menu-input f-ta", placeholder: "Add a description…", rows: 4 }); desc.value = t.desc || "";
      desc.onblur = () => desc.value !== (t.desc || "") && set({ desc: desc.value });

      // files
      const files = t.files || [];
      const attachBtn = h("button", { class: "chip-btn", text: "📎 Attach files", onclick: async () => {
        const fs = await Apps.pickFiles(true); if (!fs.length) return;
        UI.toast("Uploading…");
        (await Apps.attach(fs)).forEach(a => Data.arr("tasks", id, "files", a));
      } });
      const filesEl = files.length ? h("div", { class: "file-list" }, ...files.map(a => Apps.fileChip(a, async att => {
        if (!(await UI.confirm(`Remove “${att.name}” from this task?`, "Remove"))) return;
        Data.arr("tasks", id, "files", att, false); Data.remove("files", att.id);
      }))) : null;

      // checklist
      const cl = t.checklist || [], doneN = cl.filter(c => c.done).length;
      const newItem = h("input", { class: "menu-input cl-new", placeholder: "+ Add checklist item and press Enter" });
      newItem.onkeydown = e => { if (e.key === "Enter" && newItem.value.trim()) { set({ checklist: [...cl, { id: Data.uid(), t: newItem.value.trim(), done: false }] }); draw(); setTimeout(() => body.querySelector(".cl-new")?.focus(), 30); } };

      // AI helpers (js/ai.js): only when AI is available
      const ai = Apps.AI?.available(), aiTitle = () => title.textContent.trim() || t.title || "";
      const aiDesc = ai ? Apps.AI.button("Write description", () => Apps.AI.compose({ title: "Task description", task: "task_description", input: aiTitle(),
        context: desc.value.trim() ? "Current description:\n" + desc.value : "", insertLabel: desc.value.trim() ? "Replace" : "Use this", onInsert: v => set({ desc: v }) })) : null;
      const aiList = ai ? Apps.AI.button("Suggest checklist", () => Apps.AI.compose({ title: "Suggested checklist", task: "task_checklist", input: aiTitle(),
        context: [desc.value.trim(), cl.length ? "Already on the checklist:\n" + cl.map(c => c.t).join("\n") : ""].filter(Boolean).join("\n\n"), insertLabel: "Add to checklist",
        onInsert: v => set({ checklist: [...(Data.get("tasks", id)?.checklist || []), ...Apps.AI.lines(v).map(x => ({ id: Data.uid(), t: x, done: false }))] }) })) : null;

      // subtasks
      const subs = liveTasks().filter(x => x.parentId === id).sort((a, b) => (a.at || 0) - (b.at || 0)), subDone = subs.filter(x => x.status === "done").length;
      const subNew = h("input", { class: "menu-input sub-new", placeholder: "+ Add subtask and press Enter" });
      subNew.onkeydown = async e => {
        if (e.key !== "Enter" || !subNew.value.trim()) return;
        const title = subNew.value.trim(), assignee = t.assignee || me.key; subNew.value = "";
        const sid = await Data.add("tasks", { title, desc: "", status: "todo", priority: "normal", assignee, project: t.project || "", parentId: id, deadline: "", start: "",
          participants: [], observers: [], tags: [], checklist: [], comments: [], files: [], related: [] });
        Data.notify(assignee, `${who} assigned you a subtask of ${nm}: “${esc(title)}”`, LINK(sid));
        draw(); setTimeout(() => body.querySelector(".sub-new")?.focus(), 30);
      };
      const subList = h("div", { class: "tk-subs" }, ...subs.map(x => h("div", { class: "tk-sub" + (x.status === "done" ? " done" : "") },
        h("input", { type: "checkbox", checked: x.status === "done", onchange: e => setStatus(x, e.target.checked ? "done" : "todo") }),
        h("button", { class: "tk-sub-t", text: x.title || "Untitled task", onclick: () => go(x.id) }),
        x.deadline ? h("span", { class: "dl " + due(x), text: Apps.fmtDate(x.deadline) }) : null,
        Apps.avatar(Data.person(x.assignee), 20))), subNew);

      // related tasks (stored one way, shown both ways)
      const relIds = [...new Set([...(t.related || []), ...liveTasks().filter(x => (x.related || []).includes(id)).map(x => x.id)])];
      const rel = relIds.map(r => Data.get("tasks", r)).filter(live);
      const unlink = x => { Data.arr("tasks", id, "related", x.id, false); Data.arr("tasks", x.id, "related", id, false); };
      const relList = h("div", { class: "tk-subs" }, ...rel.map(x => h("div", { class: "tk-sub" + (x.status === "done" ? " done" : "") },
        h("span", { class: "tk-dot", style: { background: stColor(x) }, title: st(x.status)[1] }),
        h("button", { class: "tk-sub-t", text: x.title || "Untitled task", onclick: () => go(x.id) }),
        h("button", { class: "icon-btn xs", title: "Unlink", html: UI.icon("x"), onclick: () => unlink(x) }))),
        h("button", { class: "chip-btn tk-link-btn", text: "🔗 Link a task", onclick: e => linkPop(e.currentTarget, t) }));

      // comments with @mentions and files
      const comment = h("textarea", { class: "menu-input f-ta tk-cmt-in", rows: 2, placeholder: "Write a comment… Type @ to mention someone (Enter to send)" });
      comment.value = draft; comment.oninput = () => { draft = comment.value; };
      if (Apps.mentionAssist) Apps.mentionAssist(comment);
      const send = () => {
        const text = comment.value.trim(); if (!text && !pending.length) return;
        const c = { id: Data.uid(), by: me.key, text, at: Date.now(), ...(pending.length ? { files: pending } : {}) };
        comment.value = draft = ""; pending = [];
        Data.arr("tasks", id, "comments", c);
        const ment = (Apps.mentioned ? Apps.mentioned(text) : []).filter(k => k !== me.key);
        ment.forEach(k => Data.notify(k, `💬 ${who} mentioned you in ${nm}`, LINK(id), text));
        watchers(t).filter(k => !ment.includes(k)).forEach(k => Data.notify(k, `💬 ${who} commented on ${nm}`, LINK(id), text || "📎 Attached files"));
        draw(); setTimeout(() => body.querySelector(".tk-cmt-in")?.focus(), 30);
      };
      comment.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey && !document.querySelector("#layer .pop")) { e.preventDefault(); send(); } };
      const cmtFiles = h("button", { class: "icon-btn", title: "Attach files", text: "📎", onclick: async () => {
        const fs = await Apps.pickFiles(true); if (!fs.length) return;
        pending = [...pending, ...(await Apps.attach(fs))]; draw();
      } });
      const composer = h("div", { class: "tk-compose" },
        pending.length ? h("div", { class: "file-list" }, ...pending.map(a => Apps.fileChip(a, att => { pending = pending.filter(x => x.id !== att.id); Data.remove("files", att.id); draw(); }))) : null,
        h("div", { class: "tk-compose-row" }, comment, cmtFiles, h("button", { class: "btn primary", text: "Send", onclick: send })));
      const cmts = t.comments || [];

      body.replaceChildren(bin,
        parent ? h("button", { class: "tk-parent", onclick: () => go(parent.id) }, "↑ Subtask of ", h("b", { text: parent.title || "Untitled task" })) : null,
        title,
        h("div", { class: "td-meta" }, "Created by ", Apps.avatar(Data.person(t.by), 18), " ", Data.person(t.by).name, " · ", UI.timeAgo(t.at || Date.now()),
          t.status === "done" && t.completedAt ? " · done " + UI.timeAgo(t.completedAt) : ""),
        appr, statusSel, apprHint, timeBox, grid,
        h("div", { class: "td-sec tk-sec-row" }, h("span", { text: "Description" }), aiDesc), desc,
        h("div", { class: "td-sec tk-sec-row" }, h("span", { text: `Files${files.length ? ` (${files.length})` : ""}` }), attachBtn), filesEl,
        h("div", { class: "td-sec tk-sec-row" }, h("span", { text: `Checklist ${cl.length ? `· ${doneN}/${cl.length}` : ""}` }), aiList),
        cl.length ? h("div", { class: "progress" }, h("span", { style: { width: (doneN / cl.length) * 100 + "%" } })) : null,
        h("div", { class: "cl" }, ...cl.map(c => h("label", { class: "cl-item" + (c.done ? " done" : "") },
          h("input", { type: "checkbox", checked: c.done, onchange: e => set({ checklist: cl.map(x => x.id === c.id ? { ...x, done: e.target.checked } : x) }) }),
          h("span", { text: c.t }), h("button", { class: "icon-btn xs", html: UI.icon("x"), onclick: e => { e.preventDefault(); set({ checklist: cl.filter(x => x.id !== c.id) }); } }))), newItem),
        h("div", { class: "td-sec" }, `Subtasks ${subs.length ? `· ${subDone}/${subs.length}` : ""}`),
        subs.length ? h("div", { class: "progress" }, h("span", { style: { width: (subDone / subs.length) * 100 + "%" } })) : null,
        subList,
        h("div", { class: "td-sec", text: `Related tasks${rel.length ? ` (${rel.length})` : ""}` }), relList,
        h("div", { class: "td-sec", text: `Comments (${cmts.length})` }),
        h("div", { class: "comments" }, ...cmts.map(c => h("div", { class: "cmt" }, Apps.avatar(Data.person(c.by), 26),
          h("div", { class: "tk-cmt-b" }, h("div", { class: "cmt-h" }, h("b", { text: Data.person(c.by).name }), h("small", { text: UI.timeAgo(c.at) })), c.text ? richText(c.text) : null,
            (c.files || []).length ? h("div", { class: "file-list tk-cmt-files" }, ...c.files.map(a => Apps.fileChip(a))) : null)))),
        composer);
    }
    draw();
  }

  /* ---------- efficiency: my tasks done in the last 30 days, on or before their deadline ---------- */
  function efficiency(k = meKey()) {
    const since = Date.now() - 30 * 864e5;
    const done = liveTasks().filter(t => isMine(t, k) && t.status === "done" && (t.completedAt || 0) > since);
    const ok = done.filter(t => !t.deadline || Apps.iso(new Date(t.completedAt)) <= t.deadline).length;
    return { n: done.length, ok, pct: done.length ? Math.round(ok / done.length * 100) : null };
  }

  /* ---------- main view ---------- */
  function render(root, arg) {
    let tab = "mine", view = ls("lumen-task-view") || "list", role = ls("lumen-task-role") || "all", q = "", project = "", tag = "", quick = "";
    if (!VIEWS.some(v => v[0] === view)) view = "list";
    let calMonth = T().slice(0, 7), gZoom = ls("lumen-task-gzoom") === "week" ? "week" : "day", resetScroll = true;
    const body = h("div", { class: "app-body tk-body" });
    const search = h("input", { class: "app-search", placeholder: "Search tasks…", oninput: e => { q = e.target.value.toLowerCase(); draw(); } });
    const viewSeg = h("div", { class: "seg tk-views" }, ...VIEWS.map(([k, l]) => h("button", { class: view === k ? "on" : "", text: l, onclick: e => {
      view = k; lsSet("lumen-task-view", k); resetScroll = true;
      viewSeg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.currentTarget)); draw(); } })));
    const projSel = h("select", { class: "app-select", onchange: e => { project = e.target.value; draw(); } });
    const tagSel = h("select", { class: "app-select", onchange: e => { tag = e.target.value; draw(); } });
    const roleSel = h("select", { class: "app-select", title: "Your role", onchange: e => { role = e.target.value; lsSet("lumen-task-role", role); draw(); } },
      ...[["all", "All roles"], ["doing", "Doing"], ["by", "Set by me"], ["following", "Following"]].map(([k, l]) => h("option", { value: k, selected: role === k }, l)));
    const counters = h("div", { class: "counters" });
    const eff = h("span", { class: "tk-eff" });
    onTagClick = tg => { tag = tag.toLowerCase() === tg.toLowerCase() ? "" : tg; draw(); };
    root.append(
      Apps.header("Tasks & Projects", "✅", "Plan, assign and track work", eff,
        h("button", { class: "btn", text: "+ Project", onclick: newProject }),
        h("button", { class: "btn", text: "📋 From template", onclick: e => templateMenu(e.currentTarget, project ? { project } : {}) }),
        h("button", { class: "btn primary", text: "+ New task", onclick: () => newTask({ project }) })),
      Apps.tabs([["mine", "My tasks"], ["created", "Assigned by me"], ["all", "All tasks"], ["projects", "Projects"], ["bin", "🗑 Recycle bin"]], tab, k => { tab = k; quick = ""; resetScroll = true; draw(); }),
      h("div", { class: "app-toolbar" }, search, projSel, tagSel, roleSel, h("span", { class: "grow" }), viewSeg), counters, body);

    /* filters */
    const inTab = (t, k) => tab === "mine" ? involved(t, k) : tab === "created" ? t.by === k : true;
    const roleOk = (t, k) => tab === "created" || role === "all" ? true : role === "doing" ? isDoing(t, k) : role === "by" ? t.by === k : (t.observers || []).includes(k);
    const matches = t => (!project || t.project === project) && (!tag || (t.tags || []).some(x => x.toLowerCase() === tag.toLowerCase())) &&
      (!q || ((t.title || "") + " " + (t.desc || "") + " " + (t.tags || []).join(" ")).toLowerCase().includes(q));
    const quickOk = t => !quick || (quick === "overdue" ? due(t) === "overdue" : quick === "today" ? due(t) === "today" : quick === "doing" ? t.status === "doing"
      : quick === "approve" ? t.status === "review" && t.by === meKey() : t.status === "done" && t.completedAt > Date.now() - 7 * 864e5);
    const sortT = (a, b) => (a.status === "done") - (b.status === "done") || (a.deadline || "9999").localeCompare(b.deadline || "9999") || (b.at || 0) - (a.at || 0);
    const scoped = () => { const k = meKey(); return liveTasks().filter(t => inTab(t, k) && roleOk(t, k)); };
    const filtered = () => scoped().filter(t => matches(t) && quickOk(t)).sort(sortT);

    function draw() {
      SUBS = subCounts();
      const projects = visProjects(project), tags = allTags();
      projSel.replaceChildren(h("option", { value: "" }, "All projects"), ...projects.map(p => h("option", { value: p.id, selected: project === p.id }, p.name)));
      if (tag && !tags.some(x => x.toLowerCase() === tag.toLowerCase())) tags.push(tag);
      tagSel.replaceChildren(h("option", { value: "" }, "All tags"), ...tags.map(x => h("option", { value: x, selected: tag.toLowerCase() === x.toLowerCase() }, "#" + x)));
      tagSel.style.display = tags.length || tag ? "" : "none";
      const taskTab = tab !== "projects" && tab !== "bin";
      roleSel.style.display = tab === "mine" || tab === "all" ? "" : "none";
      viewSeg.style.display = taskTab ? "" : "none";
      projSel.style.display = tab === "projects" ? "none" : "";
      if (!taskTab) tagSel.style.display = "none";

      // efficiency
      const e = efficiency();
      eff.replaceChildren(h("span", { class: "tk-eff-ring", style: { "--p": (e.pct ?? 0) + "%" } }), h("span", null, h("small", { text: "Efficiency" }), h("b", { text: e.pct == null ? "–" : e.pct + "%" })));
      eff.dataset.lvl = e.pct == null ? "none" : e.pct >= 80 ? "good" : e.pct >= 50 ? "mid" : "low";
      eff.title = e.n ? `Share of your tasks finished in the last 30 days that were done on or before their deadline: ${e.ok} of ${e.n}. Tasks without a deadline count as on time.`
        : "Share of your tasks finished in the last 30 days that were done on or before their deadline. Nothing finished in the last 30 days yet.";

      // counters
      const all = scoped(), k = meKey();
      const cnt = { overdue: all.filter(t => due(t) === "overdue").length, today: all.filter(t => due(t) === "today").length, doing: all.filter(t => t.status === "doing").length,
        done: all.filter(t => t.status === "done" && t.completedAt > Date.now() - 7 * 864e5).length, approve: all.filter(t => t.status === "review" && t.by === k).length };
      const cs = [["overdue", "Overdue", "red"], ["today", "Due today", "orange"], ["doing", "In progress", "blue"], ["done", "Done this week", "green"]];
      if (cnt.approve || quick === "approve") cs.push(["approve", "To approve", "purple"]);
      counters.replaceChildren(...cs.map(([key, l, c]) => h("button", { class: "counter" + (quick === key ? " on" : ""), dataset: { c }, onclick: () => { quick = quick === key ? "" : key; draw(); } }, h("b", { text: cnt[key] }), l)));
      counters.style.display = taskTab ? "" : "none";

      // body (keep the horizontal scroll of the Gantt across live updates)
      const sc = body.querySelector(".tk-scroll"), keepX = sc && !resetScroll ? sc.scrollLeft : null;
      let el;
      if (tab === "projects") el = projectsView();
      else if (tab === "bin") el = binView();
      else if (view === "planner") el = planner();
      else if (view === "calendar") el = calendarView(filtered());
      else if (view === "gantt") el = gantt(filtered());
      else {
        const list = filtered();
        el = !list.length ? Apps.empty("🎉", q || quick || tag ? "No tasks match." : "No tasks here yet.", h("button", { class: "btn primary", text: "+ New task", onclick: () => newTask({ project }) }))
          : view === "kanban" ? kanban(list) : view === "deadline" ? deadlines(list) : listView(list);
      }
      body.replaceChildren(el);
      const ns = body.querySelector(".tk-scroll");
      if (ns) ns.scrollLeft = keepX != null ? keepX : Math.max(0, (+ns.dataset.x || 0) - ns.clientWidth / 3);
      resetScroll = false;
    }

    /* list */
    const row = (t, depth = 0) => {
      const p = Data.get("projects", t.project), d = due(t);
      return h("div", { class: "trow tk-row" + (t.status === "done" ? " done" : "") + (depth ? " sub" : ""), style: { "--depth": depth }, onclick: () => openTask(t.id) },
        h("input", { type: "checkbox", checked: t.status === "done", title: "Mark done", onclick: e => e.stopPropagation(), onchange: e => setStatus(t, e.target.checked ? "done" : "todo") }),
        h("span", { class: "tt" }, depth ? h("span", { class: "tk-sub-ic", text: "↳ " }) : null, PRI[t.priority]?.[0] ? h("span", { text: PRI[t.priority][0] + " " }) : null,
          h("span", { class: "tk-tt-t", text: t.title }), tagChips(t, 2), ...metaIcons(t), t.tracking ? h("span", { class: "tk-run inline" }, h("i"), clockEl(t)) : null),
        p ? h("span", { class: "proj", style: { "--pc": p.color }, text: p.name }) : h("span"),
        h("span", { class: "tag", dataset: { tc: st(t.status)[2] }, title: st(t.status)[1], text: st(t.status)[1] }),
        h("span", { class: "dl " + d, text: t.deadline ? Apps.fmtDate(t.deadline) : "—" }),
        Apps.avatars([t.assignee, ...(t.participants || [])], 22, 2));
    };
    // subtasks sit right under their parent when both are in the list
    function listView(list) {
      const ids = new Set(list.map(t => t.id)), kids = {}, out = [], seen = new Set();
      list.forEach(t => { if (t.parentId && ids.has(t.parentId)) (kids[t.parentId] ||= []).push(t); });
      const walk = (t, dp) => { if (seen.has(t.id)) return; seen.add(t.id); out.push(row(t, Math.min(dp, 3))); (kids[t.id] || []).forEach(c => walk(c, dp + 1)); };
      list.forEach(t => { if (!(t.parentId && ids.has(t.parentId))) walk(t, 0); });
      list.forEach(t => walk(t, 0));
      return h("div", { class: "tlist tk-list" }, h("div", { class: "trow head" }, h("span"), h("span", { text: "Task" }), h("span", { text: "Project" }), h("span", { text: "Status" }), h("span", { text: "Deadline" }), h("span", { text: "Who" })), ...out);
    }

    /* card (kanban, deadlines, planner) */
    const card = t => {
      const p = Data.get("projects", t.project);
      const c = h("div", { class: "b-card tk-card" + (t.status === "done" ? " done" : "") + (t.tracking ? " running" : ""), draggable: true, style: p ? { "--pc": p.color } : null, onclick: () => openTask(t.id) },
        h("div", { class: "bc-t", text: (PRI[t.priority]?.[0] ? PRI[t.priority][0] + " " : "") + t.title }),
        tagChips(t, 3),
        h("div", { class: "bc-p" }, p ? h("span", { class: "proj", style: { "--pc": p.color }, text: p.name }) : null,
          t.deadline ? h("span", { class: "dl " + due(t), text: "⏱ " + Apps.fmtDate(t.deadline) }) : null, ...metaIcons(t),
          h("span", { class: "grow" }), Apps.avatars([t.assignee, ...(t.participants || [])], 22, 3)),
        t.tracking ? h("div", { class: "tk-run" }, h("i"), clockEl(t), h("small", { text: firstName(t.tracking.by) })) : null);
      dragify(c, t.id);
      return c;
    };
    const colHead = (l, c, n, hint) => h("div", { class: "b-col-h" }, h("span", { class: "tag", dataset: { tc: c }, text: l }), h("span", { class: "n", text: n }), hint ? h("small", { class: "tk-col-hint", text: hint }) : null);
    function kanban(list) {
      return h("div", { class: "board tk-board" }, ...STATUS.map(([k, l, c]) => {
        const items = list.filter(t => (t.status || "todo") === k);
        const col = h("div", { class: "b-col tk-col", dataset: { c } }, colHead(l, c, items.length),
          h("div", { class: "b-cards" }, ...items.map(card)), h("button", { class: "b-add", text: "+ Quick task", onclick: () => newTask({ status: k, project }) }));
        dropZone(col, id => { const t = Data.get("tasks", id); if (t) setStatus(t, k); });
        return col;
      }));
    }
    function deadlines(list) {
      const cols = [["overdue", "Overdue", "red", null], ["today", "Today", "orange", 0], ["week", "This week", "blue", 3], ["later", "Later", "purple", 14], ["none", "No deadline", "gray", ""]];
      return h("div", { class: "board tk-board" }, ...cols.map(([k, l, c, shift]) => {
        const items = list.filter(t => due(t) === k);
        const col = h("div", { class: "b-col tk-col", dataset: { c } }, colHead(l, c, items.length), h("div", { class: "b-cards" }, ...items.map(card)));
        if (shift !== null) dropZone(col, id => setDeadline(id, shift === "" ? "" : Apps.addDays(T(), shift)));
        return col;
      }));
    }

    /* planner: my open tasks by when they're due; dropping a card sets its deadline */
    function planner() {
      const today = T(), mon = mondayOf(today), fri = Apps.addDays(mon, 4), sun = Apps.addDays(mon, 6), nextSun = Apps.addDays(sun, 7);
      const weekDrop = fri > today ? fri : sun > today ? sun : today;
      const bucket = t => !t.deadline ? "none" : t.deadline < today ? "overdue" : t.deadline === today ? "today" : t.deadline <= sun ? "week" : t.deadline <= nextSun ? "next" : "later";
      const cols = [["overdue", "Overdue", "red", null, ""], ["today", "Today", "orange", today, Apps.fmtDate(today)], ["week", "This week", "blue", weekDrop, "until " + Apps.fmtDate(sun)],
        ["next", "Next week", "purple", Apps.addDays(fri, 7), Apps.fmtDate(Apps.addDays(mon, 7)) + " – " + Apps.fmtDate(nextSun)], ["later", "Later", "green", Apps.addDays(nextSun, 1), ""], ["none", "No deadline", "gray", "", ""]];
      const mine = liveTasks().filter(t => isMine(t) && t.status !== "done" && matches(t)).sort(sortT);
      return h("div", null, h("div", { class: "tk-hint tk-view-hint", text: "Your open tasks, planned by deadline. Drag a card to another column to replan it." }),
        h("div", { class: "board tk-board tk-planner" }, ...cols.map(([k, l, c, date, hint], i) => {
          const items = mine.filter(t => bucket(t) === k);
          const col = h("div", { class: "b-col tk-col", dataset: { c }, style: { animationDelay: i * 40 + "ms" } }, colHead(l, c, items.length, hint),
            h("div", { class: "b-cards" }, ...items.map(card)),
            !items.length ? h("div", { class: "tk-col-empty", text: k === "overdue" ? "Nothing overdue 🎉" : "Drop tasks here" }) : null,
            date !== null ? h("button", { class: "b-add", text: "+ Add task", onclick: () => newTask({ deadline: date, project }) }) : null);
          if (date !== null) dropZone(col, id => { const t = Data.get("tasks", id); if (t && bucket(t) !== k) setDeadline(id, date); });
          return col;
        })));
    }

    /* calendar: month grid of deadlines */
    const calChip = t => {
      const p = Data.get("projects", t.project);
      const c = h("div", { class: "cal-chip tk-chip" + (t.status === "done" ? " done" : "") + (due(t) === "overdue" ? " late" : ""), role: "button", tabindex: 0, draggable: true,
        style: { "--c": p?.color || stColor(t) }, title: `${t.title} · ${st(t.status)[1]}`, onclick: e => { e.stopPropagation(); UI.closePops(); openTask(t.id); } },
        t.tracking ? h("i", { class: "tk-live-dot" }) : null, t.title || "Untitled task");
      dragify(c, t.id);
      return c;
    };
    function calendarView(list) {
      const [y, m] = calMonth.split("-").map(Number), first = calMonth + "-01", start = mondayOf(first);
      const dim = new Date(y, m, 0).getDate(), weeks = Math.ceil((daysBetween(start, first) + dim) / 7);
      const byDay = {}; list.forEach(t => { if (t.deadline) (byDay[t.deadline] ||= []).push(t); });
      const shift = n => { calMonth = Apps.iso(new Date(y, m - 1 + n, 1)).slice(0, 7); draw(); };
      const head = h("div", { class: "tk-cal-head" },
        h("button", { class: "icon-btn", title: "Previous month", text: "‹", onclick: () => shift(-1) }),
        h("button", { class: "btn", text: "Today", onclick: () => { calMonth = T().slice(0, 7); draw(); } }),
        h("button", { class: "icon-btn", title: "Next month", text: "›", onclick: () => shift(1) }),
        h("b", { class: "tk-cal-label", text: new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }) }),
        h("span", { class: "grow" }), h("small", { class: "tk-hint", text: "Drag a task to another day to reschedule · click a day to add a task" }));
      const wd = [0, 1, 2, 3, 4, 5, 6].map(i => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: "short" }));
      const grid = h("div", { class: "cal-grid tk-cal", dataset: { m: calMonth } }, ...wd.map(d => h("div", { class: "cal-wd", text: d })));
      for (let i = 0; i < weeks * 7; i++) {
        const date = Apps.addDays(start, i), items = (byDay[date] || []).sort(sortT);
        const cell = h("div", { class: "cal-day tk-day" + (date.slice(0, 7) !== calMonth ? " other" : "") + (date === T() ? " today" : "") + (i % 7 > 4 ? " we" : ""), title: "Add a task due " + Apps.fmtDate(date),
          onclick: e => { if (!e.target.closest(".cal-chip,.cal-more")) newTask({ deadline: date, project }); } },
          h("span", { class: "cal-n", text: +date.slice(8) }), ...items.slice(0, 3).map(calChip),
          items.length > 3 ? h("button", { class: "cal-more", text: `+${items.length - 3} more`, onclick: e => { e.stopPropagation(); UI.popover(e.currentTarget, h("div", { class: "tk-daypop" }, h("div", { class: "menu-sec", text: Apps.fmtDate(date) }), ...items.map(calChip))); } }) : null);
        dropZone(cell, id => setDeadline(id, date));
        grid.append(cell);
      }
      return h("div", { class: "tk-cal-wrap" }, head, grid);
    }

    /* Gantt: bars from start (or created date) to deadline, grouped by project */
    function gantt(list) {
      const px = gZoom === "week" ? 14 : 36, today = T();
      const startOf = t => { const s = t.start || Apps.iso(new Date(t.at || Date.now())); return s > t.deadline ? t.deadline : s; };
      const rows = list.filter(t => t.deadline), none = list.filter(t => !t.deadline);
      let min = Apps.addDays(today, -7), max = Apps.addDays(today, 28);
      rows.forEach(t => { const s = startOf(t); if (s < min) min = s; if (t.deadline > max) max = t.deadline; });
      const lo = Apps.addDays(today, -180), hi = Apps.addDays(today, 540);
      if (min < lo) min = lo; if (max > hi) max = hi;
      min = mondayOf(Apps.addDays(min, -3)); max = Apps.addDays(mondayOf(Apps.addDays(max, 7)), 6);
      const days = daysBetween(min, max) + 1, W = days * px, x = d => daysBetween(min, d) * px;

      // header: months + days (or weeks)
      const months = [];
      for (let i = 0; i < days; i++) { const d = Apps.addDays(min, i); if (i === 0 || d.endsWith("-01")) months.push([i, d]); }
      const mHead = h("div", { class: "g-months" }, ...months.map(([i, d], j) => h("span", { style: { left: i * px + "px", width: ((months[j + 1]?.[0] ?? days) - i) * px + "px" },
        text: new Date(d + "T00:00").toLocaleDateString(undefined, { month: gZoom === "week" ? "short" : "long", year: "numeric" }) })));
      const uHead = h("div", { class: "g-units" });
      if (gZoom === "week") for (let i = 0; i < days; i += 7) { const d = Apps.addDays(min, i); uHead.append(h("span", { class: today >= d && today <= Apps.addDays(d, 6) ? "today" : "", style: { width: 7 * px + "px" }, text: Apps.fmtDate(d) })); }
      else for (let i = 0; i < days; i++) {
        const d = Apps.addDays(min, i), w = new Date(d + "T00:00").getDay();
        uHead.append(h("span", { class: (w === 0 || w === 6 ? "we" : "") + (d === today ? " today" : ""), style: { width: px + "px" } }, h("small", { text: new Date(d + "T00:00").toLocaleDateString(undefined, { weekday: "narrow" }) }), String(+d.slice(8))));
      }

      // one row per task
      const gRow = t => {
        const s = startOf(t), p = Data.get("projects", t.project), cl = t.checklist || [];
        const L = Math.max(0, x(s)), BW = Math.max(px, x(t.deadline) + px - L);
        const prog = t.status === "done" ? 1 : cl.length ? cl.filter(c => c.done).length / cl.length : 0;
        const bar = h("div", { class: "g-bar" + (t.status === "done" ? " done" : "") + (due(t) === "overdue" ? " late" : "") + (t.tracking ? " running" : ""),
          style: { left: L + "px", width: BW + "px", "--pc": p?.color || "var(--accent)" }, title: `${t.title}\n${Apps.fmtDate(s)} → ${Apps.fmtDate(t.deadline)}` },
          h("i", { class: "g-prog", style: { width: prog * 100 + "%" } }), h("span", { class: "g-bar-t", text: t.title }), h("span", { class: "g-rz", title: "Drag to change the deadline" }));
        barDrag(bar, t, s, px);
        return h("div", { class: "g-row" },
          h("div", { class: "g-label", onclick: () => openTask(t.id), title: t.title }, Apps.avatar(Data.person(t.assignee), 20),
            h("span", { class: "g-lt" + (t.status === "done" ? " done" : ""), text: t.title }), due(t) === "overdue" ? h("span", { class: "g-late", text: "!" }) : null),
          h("div", { class: "g-track" }, bar));
      };
      const groups = new Map();
      rows.sort((a, b) => startOf(a).localeCompare(startOf(b)) || a.deadline.localeCompare(b.deadline)).forEach(t => {
        const k = Data.get("projects", t.project) ? t.project : "";
        if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t);
      });
      const pname = k => Data.get("projects", k)?.name || "";
      const bodyRows = [];
      [...groups.keys()].sort((a, b) => (!a) - (!b) || pname(a).localeCompare(pname(b))).forEach(k => {
        const pr = Data.get("projects", k);
        bodyRows.push(h("div", { class: "g-row g-group" }, h("div", { class: "g-label", style: { "--pc": pr?.color || "var(--faint)" } }, h("span", { class: "pc-dot" }), h("b", { text: pr ? pr.name : "No project" }), h("small", { text: groups.get(k).length })), h("div", { class: "g-track" })));
        groups.get(k).forEach(t => bodyRows.push(gRow(t)));
      });

      const zoomSeg = h("div", { class: "seg" }, ...[["day", "Days"], ["week", "Weeks"]].map(([k, l]) => h("button", { class: gZoom === k ? "on" : "", text: l, onclick: () => { gZoom = k; lsSet("lumen-task-gzoom", k); resetScroll = true; draw(); } })));
      const todayX = x(today);
      const scroller = h("div", { class: "tk-scroll gantt glass", dataset: { x: todayX } },
        h("div", { class: "g-inner", style: { "--px": px + "px", "--gl": (gZoom === "week" ? 7 * px : px) + "px", "--w": W + "px" } },
          h("div", { class: "g-row g-head" }, h("div", { class: "g-label", text: "Task" }), h("div", { class: "g-track g-hd" }, mHead, uHead)),
          ...bodyRows,
          !rows.length ? h("div", { class: "g-row" }, h("div", { class: "g-label tk-hint", text: "No tasks with a deadline" }), h("div", { class: "g-track" })) : null,
          h("div", { class: "g-today", style: { left: `calc(var(--lw) + ${todayX + px / 2}px)` }, title: "Today" })));
      return h("div", { class: "tk-gantt-wrap" },
        h("div", { class: "tk-cal-head" }, zoomSeg, h("button", { class: "btn", text: "Today", onclick: () => { const s = body.querySelector(".tk-scroll"); s && s.scrollTo({ left: Math.max(0, todayX - s.clientWidth / 3), behavior: "smooth" }); } }),
          h("span", { class: "grow" }), h("small", { class: "tk-hint", text: "Drag a bar to move it · drag its right edge to change the deadline" })),
        scroller,
        none.length ? h("div", { class: "tk-nodl" }, h("div", { class: "td-sec", text: `No deadline (${none.length})` }),
          h("div", { class: "tk-nodl-list" }, ...none.map(t => h("button", { class: "chip-btn tk-nodl-chip" + (t.status === "done" ? " done" : ""), onclick: () => openTask(t.id) },
            h("span", { class: "tk-dot", style: { background: stColor(t) } }), t.title || "Untitled task")))) : null);
    }
    // drag a bar to move it; drag its right edge to change the deadline (pointer events: mouse, pen and touch)
    function barDrag(bar, t, s, px) {
      bar.addEventListener("pointerdown", e => {
        if (e.button) return;
        e.preventDefault();
        const resize = e.target.classList.contains("g-rz"), x0 = e.clientX, L0 = bar.offsetLeft, W0 = bar.offsetWidth, minDd = -daysBetween(s, t.deadline);
        let dd = 0, moved = false;
        const tip = h("div", { class: "g-tip" });
        const label = () => { const ns = resize ? s : Apps.addDays(s, dd), nd = Apps.addDays(t.deadline, dd); tip.textContent = `${Apps.fmtDate(ns)} → ${Apps.fmtDate(nd)}`; };
        const move = ev => {
          const dx = ev.clientX - x0;
          if (!moved && Math.abs(dx) > 4) { moved = true; bar.classList.add("drag"); bar.append(tip); }
          if (!moved) return;
          dd = Math.round(dx / px);
          if (resize) { dd = Math.max(dd, minDd); bar.style.width = W0 + dd * px + "px"; } else bar.style.left = L0 + dd * px + "px";
          label();
        };
        const up = () => {
          bar.removeEventListener("pointermove", move); bar.removeEventListener("pointerup", up); bar.removeEventListener("pointercancel", up);
          tip.remove(); bar.classList.remove("drag");
          if (!moved) return openTask(t.id);
          if (!dd) return;
          const patch = resize ? { deadline: Apps.addDays(t.deadline, dd) } : { start: Apps.addDays(s, dd), deadline: Apps.addDays(t.deadline, dd) };
          Data.update("tasks", t.id, patch);
          UI.toast(resize ? "📅 Due " + Apps.fmtDate(patch.deadline) : `📅 Moved to ${Apps.fmtDate(patch.start)} → ${Apps.fmtDate(patch.deadline)}`);
        };
        try { bar.setPointerCapture(e.pointerId); } catch {}
        bar.addEventListener("pointermove", move); bar.addEventListener("pointerup", up); bar.addEventListener("pointercancel", up);
      });
    }

    /* recycle bin */
    function binView() {
      const k = meKey();
      const items = Data.list("tasks").filter(t => t.deleted && t.kind !== "template" && (involved(t, k) || t.deletedBy === k) && (!q || (t.title || "").toLowerCase().includes(q)))
        .sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
      if (!items.length) return Apps.empty("🗑", "The recycle bin is empty.");
      return h("div", null,
        h("div", { class: "tk-bin-head" }, h("span", { class: "tk-hint", text: "Deleted tasks stay here until you delete them forever." }),
          h("button", { class: "btn danger", text: "Empty recycle bin", onclick: async () => {
            if (await UI.confirm(`Delete ${items.length} task${items.length > 1 ? "s" : ""} forever? This can't be undone.`, "Delete forever")) { items.forEach(purge); UI.toast("🗑 Recycle bin emptied"); }
          } })),
        h("div", { class: "tlist tk-bin" }, ...items.map((t, i) => h("div", { class: "tk-bin-row", style: { animationDelay: Math.min(i, 12) * 30 + "ms" } },
          h("span", { class: "tk-bin-t", onclick: () => openTask(t.id) }, h("b", { text: t.title || "Untitled task" }),
            h("small", { text: `Deleted ${t.deletedAt ? UI.timeAgo(t.deletedAt) : ""}${t.deletedBy ? " by " + Data.person(t.deletedBy).name : ""}` })),
          h("button", { class: "btn", text: "♻️ Restore", onclick: () => { restore(t); UI.toast("♻️ Restored"); } }),
          h("button", { class: "btn danger", text: "Delete forever", onclick: async () => { if (await UI.confirm(`Delete “${t.title}” forever? This can't be undone.`, "Delete forever")) purge(t); } })))));
    }

    /* projects */
    function projectsView() {
      const ps = visProjects(), tasks = liveTasks();
      if (!ps.length) return Apps.empty("📁", "Group related tasks into projects.", h("button", { class: "btn primary", text: "+ Create project", onclick: newProject }));
      return h("div", { class: "proj-grid" }, ...ps.map((p, i) => {
        const mine = tasks.filter(t => t.project === p.id), d = mine.filter(t => t.status === "done").length;
        return h("div", { class: "proj-card glass", style: { "--pc": p.color, animationDelay: i * 50 + "ms" }, onclick: () => { project = p.id; tab = "all"; root.querySelectorAll(".app-tabs button")[2].click(); } },
          h("div", { class: "pc-top" }, p.avatar ? h("span", { text: p.avatar }) : h("span", { class: "pc-dot" }), h("b", { text: p.name }),
            Apps.Groups ? h("button", { class: "icon-btn xs", title: "Open the workgroup space", text: "↗", onclick: e => { e.stopPropagation(); Apps.Groups.open(p.id); } }) : null,
            !Apps.Groups?.canManage || Apps.Groups.canManage(p) ? h("button", { class: "icon-btn xs", html: UI.icon("dots"), onclick: e => { e.stopPropagation(); editProject(p); } }) : null),
          h("div", { class: "pc-desc", text: p.desc || "No description" }),
          h("div", { class: "progress" }, h("span", { style: { width: (mine.length ? d / mine.length * 100 : 0) + "%" } })),
          h("div", { class: "pc-foot", text: `${d}/${mine.length} tasks done` }));
      }));
    }
    async function newProject() {
      if (Apps.Groups?.create) return Apps.Groups.create({ type: "project" }); // projects are workgroups now
      const v = await Apps.form("New project", [{ key: "name", label: "Project name", required: true }, { key: "desc", label: "Description", type: "textarea", rows: 2 }, { key: "color", label: "Colour", type: "color" }]);
      if (v) { await Data.add("projects", v); UI.toast("📁 Project created"); draw(); }
    }
    async function editProject(p) {
      if (Apps.Groups?.edit) return Apps.Groups.edit(p);
      const v = await Apps.form("Edit project", [{ key: "name", label: "Project name", required: true }, { key: "desc", label: "Description", type: "textarea", rows: 2 }, { key: "color", label: "Colour", type: "color" }], p,
        { onDelete: () => Data.remove("projects", p.id) });
      if (v) Data.update("projects", p.id, { name: v.name, desc: v.desc, color: v.color });
    }

    const offs = [Data.on("tasks", draw), Data.on("projects", draw), Data.on("people", draw)];
    const dayTick = setInterval(() => { if (!document.querySelector(".tk-body .g-bar.drag")) draw(); }, 5 * 60000); // "today" moves on
    if (arg) setTimeout(() => openTask(arg), 100);
    return () => { offs.forEach(f => f()); clearInterval(dayTick); onTagClick = null; };
  }

  /* ---------- sidebar counter: my open tasks due today or overdue (assignee, participant, or unassigned and mine) ---------- */
  const badge = () => Data.on("tasks", () => Apps.badge("tasks", liveTasks().filter(t => isMine(t) && t.status !== "done" && t.status !== "review" && t.deadline && t.deadline <= T()).length));
  let unBadge = null;
  const startBadge = () => { unBadge && unBadge(); unBadge = badge(); };

  Apps.register("tasks", { title: "Tasks", icon: "✅", render });
  Apps.Tasks = { newTask, openTask, due, setStatus, efficiency, live, isMine, templates };
  Apps.onWorkspace.add(startBadge);
  setTimeout(startBadge, 0);
})();
