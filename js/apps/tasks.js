/* Tasks & Projects (Bitrix24-style): my tasks, list / kanban / deadline views, projects, checklists, comments */
(function () {
  const { h, esc } = UI;
  const STATUS = [["todo", "To do", "gray"], ["doing", "In progress", "blue"], ["review", "Review", "purple"], ["done", "Done", "green"]];
  const PRI = { high: ["🔥", "High"], normal: ["", "Normal"], low: ["⬇️", "Low"] };
  const st = k => STATUS.find(s => s[0] === k) || STATUS[0];
  const T = () => Apps.today();
  const due = t => !t.deadline ? "none" : t.status === "done" ? "done" : t.deadline < T() ? "overdue" : t.deadline === T() ? "today" : t.deadline <= Apps.addDays(T(), 7) ? "week" : "later";

  // sidebar counter: my open tasks that are overdue or due today
  const badge = () => Data.on("tasks", all => Apps.badge("tasks", all.filter(t => t.assignee === Data.me().key && t.status !== "done" && t.deadline && t.deadline <= T()).length));
  let unBadge = null;
  const startBadge = () => { unBadge && unBadge(); unBadge = badge(); };

  async function newTask(preset = {}) {
    const projects = Data.list("projects");
    const v = await Apps.form("New task", [
      { key: "title", label: "Task", required: true, placeholder: "What needs to be done?" },
      { key: "desc", label: "Description", type: "textarea", rows: 3 },
      { key: "assignee", label: "Responsible person", type: "person", half: true },
      { key: "deadline", label: "Deadline", type: "date", half: true },
      { key: "priority", label: "Priority", type: "select", options: [["normal", "Normal"], ["high", "🔥 High"], ["low", "⬇️ Low"]], half: true },
      { key: "project", label: "Project", type: "select", options: [["", "No project"], ...projects.map(p => [p.id, p.name])], half: true },
    ], { assignee: Data.me().key, status: "todo", ...preset }, { ok: "Create task" });
    if (!v) return;
    const id = await Data.add("tasks", { ...v, status: v.status || "todo", checklist: [], comments: [] });
    if (v.assignee) Data.notify(v.assignee, `<b>${esc(Data.me().name)}</b> assigned you a task: “${esc(v.title)}”`, "#/app/tasks/" + id);
    UI.toast("✅ Task created");
    return id;
  }

  /* ---------- task detail slider ---------- */
  function openTask(id) {
    const t0 = Data.get("tasks", id); if (!t0) return UI.toast("Task not found");
    const body = h("div", { class: "task-detail" });
    const p = Apps.panel("Task", body, [h("button", { class: "icon-btn", title: "Delete task", html: UI.icon("trash"), onclick: async () => { if (await UI.confirm("Delete this task?")) { Data.remove("tasks", id); p.close(); } } })]);
    const set = (patch, rerender) => { Data.update("tasks", id, patch); if (rerender) draw(); };
    const off = Data.on("tasks", UI.liveDraw(body, draw));
    p.onClose = off;
    function draw() {
      const t = Data.get("tasks", id); if (!t) return p.close();
      const me = Data.me();
      const title = h("div", { class: "peek-title", contenteditable: true, text: t.title });
      title.addEventListener("blur", () => title.textContent.trim() !== t.title && set({ title: title.textContent.trim() || "Untitled task" }));
      const statusSel = h("div", { class: "seg status-seg" }, ...STATUS.map(([k, l]) => h("button", { class: t.status === k ? "on" : "", text: l, onclick: () => {
        set({ status: k, completedAt: k === "done" ? Date.now() : null }, true);
        if (k === "done" && t.by && t.by !== me.key) Data.notify(t.by, `<b>${esc(me.name)}</b> completed “${esc(t.title)}”`, "#/app/tasks/" + id);
      } })));
      const who = h("button", { class: "chip-btn" }, Apps.avatar(Data.person(t.assignee), 20), Data.person(t.assignee).name || "Nobody");
      who.onclick = () => Apps.personPicker(who, pp => { set({ assignee: pp ? pp.key : "" }, true); if (pp) Data.notify(pp.key, `<b>${esc(me.name)}</b> assigned you “${esc(t.title)}”`, "#/app/tasks/" + id); }, { allowNone: true });
      const dl = h("input", { type: "date", class: "chip-in", value: t.deadline || "" }); dl.onchange = () => set({ deadline: dl.value }, true);
      const pri = h("select", { class: "chip-in" }, ...Object.entries(PRI).map(([k, [i, l]]) => h("option", { value: k, selected: (t.priority || "normal") === k }, (i ? i + " " : "") + l))); pri.onchange = () => set({ priority: pri.value });
      const proj = h("select", { class: "chip-in" }, h("option", { value: "" }, "No project"), ...Data.list("projects").map(pr => h("option", { value: pr.id, selected: t.project === pr.id }, pr.name))); proj.onchange = () => set({ project: proj.value });
      const desc = h("textarea", { class: "menu-input f-ta", placeholder: "Add a description…", rows: 4 }); desc.value = t.desc || ""; desc.onblur = () => desc.value !== (t.desc || "") && set({ desc: desc.value });
      const cl = t.checklist || [], doneN = cl.filter(c => c.done).length;
      const newItem = h("input", { class: "menu-input", placeholder: "+ Add checklist item and press Enter" });
      newItem.onkeydown = e => { if (e.key === "Enter" && newItem.value.trim()) { set({ checklist: [...cl, { id: Data.uid(), t: newItem.value.trim(), done: false }] }, true); setTimeout(() => body.querySelector(".cl-new")?.focus(), 30); } };
      newItem.classList.add("cl-new");
      const comment = h("textarea", { class: "menu-input f-ta", rows: 2, placeholder: "Write a comment… (Enter to send)" });
      comment.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey && comment.value.trim()) { e.preventDefault();
        set({ comments: [...(t.comments || []), { by: me.key, text: comment.value.trim(), at: Date.now() }] }, true);
        [t.assignee, t.by].filter(k => k && k !== me.key).forEach(k => Data.notify(k, `<b>${esc(me.name)}</b> commented on “${esc(t.title)}”`, "#/app/tasks/" + id)); } };
      body.replaceChildren(title,
        h("div", { class: "td-meta" }, "Created by ", Apps.avatar(Data.person(t.by), 18), " ", Data.person(t.by).name, " · ", UI.timeAgo(t.at)),
        statusSel,
        h("div", { class: "td-grid" },
          h("span", { text: "Responsible" }), who, h("span", { text: "Deadline" }), h("span", { class: "td-dl " + due(t) }, dl, due(t) === "overdue" ? h("b", { text: " Overdue" }) : null),
          h("span", { text: "Priority" }), pri, h("span", { text: "Project" }), proj),
        h("div", { class: "td-sec", text: "Description" }), desc,
        h("div", { class: "td-sec" }, `Checklist ${cl.length ? `· ${doneN}/${cl.length}` : ""}`),
        cl.length ? h("div", { class: "progress" }, h("span", { style: { width: (doneN / cl.length) * 100 + "%" } })) : null,
        h("div", { class: "cl" }, ...cl.map(c => h("label", { class: "cl-item" + (c.done ? " done" : "") },
          h("input", { type: "checkbox", checked: c.done, onchange: e => set({ checklist: cl.map(x => x.id === c.id ? { ...x, done: e.target.checked } : x) }, true) }),
          h("span", { text: c.t }), h("button", { class: "icon-btn xs", html: UI.icon("x"), onclick: e => { e.preventDefault(); set({ checklist: cl.filter(x => x.id !== c.id) }, true); } }))), newItem),
        h("div", { class: "td-sec", text: `Comments (${(t.comments || []).length})` }),
        h("div", { class: "comments" }, ...(t.comments || []).map(c => h("div", { class: "cmt" }, Apps.avatar(Data.person(c.by), 26),
          h("div", null, h("div", { class: "cmt-h" }, h("b", { text: Data.person(c.by).name }), h("small", { text: UI.timeAgo(c.at) })), h("div", { class: "cmt-t", text: c.text }))))),
        comment);
    }
    draw();
  }

  /* ---------- main view ---------- */
  function render(root, arg) {
    let tab = "mine", view = localStorage.getItem("lumen-task-view") || "list", q = "", project = "", quick = "";
    const body = h("div", { class: "app-body" });
    const search = h("input", { class: "app-search", placeholder: "Search tasks…", oninput: e => { q = e.target.value.toLowerCase(); draw(); } });
    const viewSeg = h("div", { class: "seg" }, ...[["list", "☰ List"], ["kanban", "▥ Kanban"], ["deadline", "⏱ Deadlines"]].map(([k, l]) => h("button", { class: view === k ? "on" : "", text: l, onclick: e => {
      view = k; localStorage.setItem("lumen-task-view", k); viewSeg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.currentTarget)); draw(); } })));
    const projSel = h("select", { class: "app-select", onchange: e => { project = e.target.value; draw(); } });
    const counters = h("div", { class: "counters" });
    root.append(
      Apps.header("Tasks & Projects", "✅", "Plan, assign and track work", h("button", { class: "btn", text: "+ Project", onclick: newProject }), h("button", { class: "btn primary", text: "+ New task", onclick: () => newTask({ project }) })),
      Apps.tabs([["mine", "My tasks"], ["created", "Assigned by me"], ["all", "All tasks"], ["projects", "Projects"]], tab, k => { tab = k; draw(); }),
      h("div", { class: "app-toolbar" }, search, projSel, h("span", { class: "grow" }), viewSeg), counters, body);

    function filtered() {
      const me = Data.me().key;
      return Data.list("tasks").filter(t =>
        (tab === "mine" ? t.assignee === me : tab === "created" ? t.by === me : true) &&
        (!project || t.project === project) && (!q || (t.title + " " + (t.desc || "")).toLowerCase().includes(q)) &&
        (!quick || (quick === "overdue" ? due(t) === "overdue" : quick === "today" ? due(t) === "today" : quick === "doing" ? t.status === "doing" : t.status === "done" && t.completedAt > Date.now() - 7 * 864e5)))
        .sort((a, b) => (a.status === "done") - (b.status === "done") || (a.deadline || "9999").localeCompare(b.deadline || "9999") || b.at - a.at);
    }
    function draw() {
      const projects = Data.list("projects");
      projSel.replaceChildren(h("option", { value: "" }, "All projects"), ...projects.map(p => h("option", { value: p.id, selected: project === p.id }, p.name)));
      const all = Data.list("tasks").filter(t => tab === "all" || t.assignee === Data.me().key);
      const cnt = { overdue: all.filter(t => due(t) === "overdue").length, today: all.filter(t => due(t) === "today").length, doing: all.filter(t => t.status === "doing").length, done: all.filter(t => t.status === "done" && t.completedAt > Date.now() - 7 * 864e5).length };
      counters.replaceChildren(...[["overdue", "Overdue", "red"], ["today", "Due today", "orange"], ["doing", "In progress", "blue"], ["done", "Done this week", "green"]].map(([k, l, c]) =>
        h("button", { class: "counter" + (quick === k ? " on" : ""), dataset: { c }, onclick: () => { quick = quick === k ? "" : k; draw(); } }, h("b", { text: cnt[k] }), l)));
      counters.style.display = tab === "projects" ? "none" : "";
      if (tab === "projects") return body.replaceChildren(projectsView());
      const list = filtered();
      if (!list.length) return body.replaceChildren(Apps.empty("🎉", q || quick ? "No tasks match." : "No tasks here yet.", h("button", { class: "btn primary", text: "+ New task", onclick: () => newTask({ project }) })));
      body.replaceChildren(view === "kanban" ? kanban(list) : view === "deadline" ? deadlines(list) : listView(list));
    }
    const row = t => {
      const p = Data.get("projects", t.project), d = due(t), cl = t.checklist || [];
      return h("div", { class: "trow" + (t.status === "done" ? " done" : ""), onclick: () => openTask(t.id) },
        h("input", { type: "checkbox", checked: t.status === "done", onclick: e => e.stopPropagation(), onchange: e => Data.update("tasks", t.id, { status: e.target.checked ? "done" : "todo", completedAt: e.target.checked ? Date.now() : null }) }),
        h("span", { class: "tt" }, (PRI[t.priority]?.[0] || "") && h("span", { text: PRI[t.priority][0] + " " }), t.title, cl.length ? h("small", { class: "cl-n", text: ` ☑ ${cl.filter(c => c.done).length}/${cl.length}` }) : null, (t.comments || []).length ? h("small", { class: "cl-n", text: ` 💬 ${t.comments.length}` }) : null),
        p ? h("span", { class: "proj", style: { "--pc": p.color }, text: p.name }) : h("span"),
        h("span", { class: "tag", dataset: { tc: st(t.status)[2] }, text: st(t.status)[1] }),
        h("span", { class: "dl " + d, text: t.deadline ? Apps.fmtDate(t.deadline) : "—" }),
        Apps.avatar(Data.person(t.assignee), 24));
    };
    const listView = list => h("div", { class: "tlist" }, h("div", { class: "trow head" }, h("span"), h("span", { text: "Task" }), h("span", { text: "Project" }), h("span", { text: "Status" }), h("span", { text: "Deadline" }), h("span", { text: "Who" })), ...list.map(row));
    function dropCol(el, onDrop) {
      el.addEventListener("dragover", e => { e.preventDefault(); el.classList.add("drop"); });
      el.addEventListener("dragleave", e => { if (!el.contains(e.relatedTarget)) el.classList.remove("drop"); });
      el.addEventListener("drop", e => { e.preventDefault(); el.classList.remove("drop"); const id = e.dataTransfer.getData("text/task"); if (id) onDrop(id); });
    }
    const card = t => {
      const p = Data.get("projects", t.project), c = h("div", { class: "b-card", draggable: true, onclick: () => openTask(t.id) },
        h("div", { class: "bc-t", text: (PRI[t.priority]?.[0] ? PRI[t.priority][0] + " " : "") + t.title }),
        h("div", { class: "bc-p" }, p ? h("span", { class: "proj", style: { "--pc": p.color }, text: p.name }) : null, t.deadline ? h("span", { class: "dl " + due(t), text: "⏱ " + Apps.fmtDate(t.deadline) }) : null, h("span", { class: "grow" }), Apps.avatar(Data.person(t.assignee), 22)));
      c.addEventListener("dragstart", e => { e.dataTransfer.setData("text/task", t.id); c.classList.add("dragging"); });
      c.addEventListener("dragend", () => c.classList.remove("dragging"));
      return c;
    };
    function kanban(list) {
      return h("div", { class: "board" }, ...STATUS.map(([k, l, c]) => {
        const items = list.filter(t => (t.status || "todo") === k);
        const col = h("div", { class: "b-col" }, h("div", { class: "b-col-h" }, h("span", { class: "tag", dataset: { tc: c }, text: l }), h("span", { class: "n", text: items.length })),
          h("div", { class: "b-cards" }, ...items.map(card)), h("button", { class: "b-add", text: "+ Quick task", onclick: () => newTask({ status: k, project }) }));
        dropCol(col, id => { Data.update("tasks", id, { status: k, completedAt: k === "done" ? Date.now() : null }); if (k === "done") UI.toast("🎉 Task done!"); });
        return col;
      }));
    }
    function deadlines(list) {
      const cols = [["overdue", "Overdue", "red", null], ["today", "Today", "orange", 0], ["week", "This week", "blue", 3], ["later", "Later", "purple", 14], ["none", "No deadline", "gray", ""]];
      return h("div", { class: "board" }, ...cols.map(([k, l, c, shift]) => {
        const items = list.filter(t => due(t) === k);
        const col = h("div", { class: "b-col" }, h("div", { class: "b-col-h" }, h("span", { class: "tag", dataset: { tc: c }, text: l }), h("span", { class: "n", text: items.length })), h("div", { class: "b-cards" }, ...items.map(card)));
        if (shift !== null) dropCol(col, id => Data.update("tasks", id, { deadline: shift === "" ? "" : Apps.addDays(T(), shift) }));
        return col;
      }));
    }
    function projectsView() {
      const ps = Data.list("projects"), tasks = Data.list("tasks");
      if (!ps.length) return Apps.empty("📁", "Group related tasks into projects.", h("button", { class: "btn primary", text: "+ Create project", onclick: newProject }));
      return h("div", { class: "proj-grid" }, ...ps.map((p, i) => {
        const mine = tasks.filter(t => t.project === p.id), d = mine.filter(t => t.status === "done").length;
        return h("div", { class: "proj-card glass", style: { "--pc": p.color, animationDelay: i * 50 + "ms" }, onclick: () => { project = p.id; tab = "all"; root.querySelectorAll(".app-tabs button")[2].click(); } },
          h("div", { class: "pc-top" }, h("span", { class: "pc-dot" }), h("b", { text: p.name }), h("button", { class: "icon-btn xs", html: UI.icon("dots"), onclick: e => { e.stopPropagation(); editProject(p); } })),
          h("div", { class: "pc-desc", text: p.desc || "No description" }),
          h("div", { class: "progress" }, h("span", { style: { width: (mine.length ? d / mine.length * 100 : 0) + "%" } })),
          h("div", { class: "pc-foot", text: `${d}/${mine.length} tasks done` }));
      }));
    }
    async function newProject() {
      const v = await Apps.form("New project", [{ key: "name", label: "Project name", required: true }, { key: "desc", label: "Description", type: "textarea", rows: 2 }, { key: "color", label: "Colour", type: "color" }]);
      if (v) { await Data.add("projects", v); UI.toast("📁 Project created"); draw(); }
    }
    async function editProject(p) {
      const v = await Apps.form("Edit project", [{ key: "name", label: "Project name", required: true }, { key: "desc", label: "Description", type: "textarea", rows: 2 }, { key: "color", label: "Colour", type: "color" }], p,
        { onDelete: () => Data.remove("projects", p.id) });
      if (v) Data.update("projects", p.id, { name: v.name, desc: v.desc, color: v.color });
    }

    const offs = [Data.on("tasks", draw), Data.on("projects", draw), Data.on("people", draw)];
    if (arg) setTimeout(() => openTask(arg), 100);
    return () => offs.forEach(f => f());
  }

  Apps.register("tasks", { title: "Tasks", icon: "✅", render });
  Apps.Tasks = { newTask, openTask, due };
  Apps.onWorkspace.add(startBadge);
  setTimeout(startBadge, 0);
})();
