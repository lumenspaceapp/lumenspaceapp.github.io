/* Automation rules: "When <trigger> then <action>" — runs on the device of the person whose change triggered it */
(function () {
  const { h, esc } = UI;
  const TRIGGERS = {
    deal_stage: { label: "A deal moves to stage…", icon: "💼", needsStage: true },
    deal_created: { label: "A deal is created", icon: "💼" },
    lead_created: { label: "A new lead comes in", icon: "🧲" },
    task_created: { label: "A task is created", icon: "✅" },
    task_done: { label: "A task is completed", icon: "🏁" },
    task_overdue: { label: "A task becomes overdue", icon: "⏰" },
  };
  const ACTIONS = {
    create_task: { label: "Create a task", icon: "✅" },
    notify: { label: "Send a notification", icon: "🔔" },
    post_chat: { label: "Post in #general chat", icon: "💬" },
    post_feed: { label: "Post on the Feed", icon: "📰" },
  };
  const PRESETS = [
    { name: "Won deal → onboarding task", trigger: "deal_stage", stage: "won", action: "create_task", text: "Onboard new customer: {title}", who: "owner", days: 2 },
    { name: "New lead → notify me", trigger: "lead_created", action: "notify", text: "🧲 New lead: {name}", who: "me" },
    { name: "Overdue task → chat alert", trigger: "task_overdue", action: "post_chat", text: "⏰ Task is overdue: {title} ({who})" },
    { name: "Task done → celebrate on Feed", trigger: "task_done", action: "post_feed", text: "🎉 {who} completed “{title}”" },
  ];
  const fill = (tpl, r) => String(tpl || "").replace(/\{(\w+)\}/g, (_, k) => k === "who" ? Data.person(r.assignee || r.owner || r.by).name : k === "amount" ? Apps.money(r.amount) : k === "stage" ? (Apps.CRM?.STAGES.find(s => s[0] === r.stage)?.[1] || r.stage || "") : (r[k] ?? ""));

  /* ---------- engine ---------- */
  let busy = 0;
  async function run(trigger, rec, extra = {}) {
    const rules = Data.list("rules").filter(r => r.enabled !== false && r.trigger === trigger && (!TRIGGERS[trigger].needsStage || r.stage === extra.stage));
    for (const rule of rules) {
      busy++;
      try {
        const text = fill(rule.text, rec), me = Data.me().key;
        const who = rule.who === "me" ? me : rule.who === "owner" ? (rec.owner || rec.assignee || rec.by || me) : rule.who || me;
        if (rule.action === "create_task") await Data.add("tasks", { title: text || "Follow up", status: "todo", priority: "normal", assignee: who, deadline: Apps.addDays(Apps.today(), +rule.days || 1), checklist: [], comments: [], auto: rule.id });
        if (rule.action === "notify") { if (who === me) await Data.add("notifications", { to: me, text: "⚡ " + esc(text), link: "", read: false, by: me }); else Data.notify(who, "⚡ " + esc(text), ""); }
        if (rule.action === "post_chat") await Data.add("chat", { channel: "general", text: "⚡ " + text, reactions: {} });
        if (rule.action === "post_feed") await Data.add("feed", { kind: "post", text: "⚡ " + text, likes: [], comments: [] });
        Data.update("rules", rule.id, { runs: (rule.runs || 0) + 1, lastRun: Date.now() });
      } catch (e) { console.error("automation", e); }
      finally { busy--; }
    }
  }
  Data.hooks.add((kind, col, after, before) => {
    if (busy || !after) return;          // never trigger on changes made by rules themselves
    if (col === "deals" && kind === "add") run("deal_created", after);
    if (col === "deals" && kind === "update" && before && before.stage !== after.stage) run("deal_stage", after, { stage: after.stage });
    if (col === "leads" && kind === "add") run("lead_created", after);
    if (col === "tasks" && kind === "add" && !after.auto) run("task_created", after);
    if (col === "tasks" && kind === "update" && after.status === "done" && before?.status !== "done") run("task_done", after);
  });
  // overdue scan: only the responsible person's device handles each task, so rules fire once
  function scan() {
    const me = Data.me().key, t = Apps.today();
    Data.list("tasks").filter(x => x.deadline && x.deadline < t && x.status !== "done" && !x.overdueFlag && (x.assignee === me || (!x.assignee && x.by === me)))
      .forEach(async x => { busy++; try { await Data.update("tasks", x.id, { overdueFlag: true }); } finally { busy--; } run("task_overdue", x); });
  }
  setInterval(scan, 5 * 60000);
  Apps.onWorkspace.add(() => setTimeout(scan, 4000));
  setTimeout(scan, 4000);

  /* ---------- editor ---------- */
  async function edit(rule = {}) {
    const isNew = !rule.id;
    const v = await Apps.form(isNew ? "New automation rule" : "Edit rule", [
      { key: "name", label: "Rule name", required: true, placeholder: "Won deal → onboarding task" },
      { key: "trigger", label: "When…", type: "select", options: Object.entries(TRIGGERS).map(([k, t]) => [k, t.icon + " " + t.label]) },
      { key: "stage", label: "…stage (for deal stage rules)", type: "select", options: (Apps.CRM?.STAGES || []).map(s => [s[0], s[1]]), half: true },
      { key: "action", label: "Then…", type: "select", options: Object.entries(ACTIONS).map(([k, a]) => [k, a.icon + " " + a.label]), half: true },
      { key: "text", label: "Message / task title", placeholder: "Use {title}, {name}, {amount}, {stage}, {who}" },
      { key: "who", label: "For (tasks & notifications)", type: "select", options: [["owner", "The responsible person"], ["me", "Me"], ...Data.people().map(p => [p.key, p.name])], half: true },
      { key: "days", label: "Task due in (days)", type: "number", half: true },
    ], { trigger: "deal_stage", stage: "won", action: "create_task", who: "owner", days: 1, enabled: true, ...rule }, isNew ? { ok: "Create rule" } : { onDelete: () => Data.remove("rules", rule.id) });
    if (!v) return;
    const { id, ...data } = v;
    isNew ? Data.add("rules", { ...data, enabled: true, runs: 0 }) : Data.update("rules", rule.id, data);
  }

  function render(root) {
    const list = h("div", { class: "rules" });
    root.append(Apps.header("Automation", "⚡", "Let Lumen do the busywork for you", h("button", { class: "btn primary", text: "+ New rule", onclick: () => edit() })),
      h("div", { class: "td-sec", text: "Quick start" }),
      h("div", { class: "presets" }, ...PRESETS.map((p, i) => h("button", { class: "preset glass", style: { animationDelay: i * 50 + "ms" }, onclick: () => edit(p) },
        h("span", { class: "pr-ic", text: TRIGGERS[p.trigger].icon + " → " + ACTIONS[p.action].icon }), h("b", { text: p.name })))),
      h("div", { class: "td-sec", text: "Your rules" }), list);
    function draw() {
      const rules = Data.list("rules").sort((a, b) => a.at - b.at);
      if (!rules.length) return list.replaceChildren(Apps.empty("⚡", "No rules yet. Start from a quick-start template above."));
      list.replaceChildren(...rules.map(r => {
        const sw = h("span", { class: "switch" + (r.enabled !== false ? " on" : ""), onclick: e => { e.stopPropagation(); Data.update("rules", r.id, { enabled: r.enabled === false }); } });
        const stage = TRIGGERS[r.trigger]?.needsStage ? " “" + (Apps.CRM?.STAGES.find(s => s[0] === r.stage)?.[1] || r.stage) + "”" : "";
        return h("div", { class: "rule glass" + (r.enabled === false ? " off" : ""), onclick: () => edit(r) },
          h("div", { class: "rule-flow" }, h("span", { class: "rf when" }, TRIGGERS[r.trigger]?.icon + " " + (TRIGGERS[r.trigger]?.label.replace("…", "") || r.trigger) + stage), h("span", { class: "rf-arrow", text: "→" }), h("span", { class: "rf then" }, ACTIONS[r.action]?.icon + " " + ACTIONS[r.action]?.label)),
          h("div", { class: "rule-meta" }, h("b", { text: r.name }), h("small", { text: r.text ? "“" + r.text + "”" : "" }), h("small", { text: `Ran ${r.runs || 0}× ${r.lastRun ? "· last " + UI.timeAgo(r.lastRun) : ""}` })), sw);
      }));
    }
    const off = Data.on("rules", draw);
    return off;
  }

  Apps.register("automation", { title: "Automation", icon: "⚡", render });
})();
