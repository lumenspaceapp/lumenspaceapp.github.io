/* Calendar: shared month / week / agenda views; events plus task deadlines, CRM deals and absences overlaid */
(function () {
  const { h, esc } = UI;
  const iso = d => Apps.iso(new Date(d));
  const WD = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, i + 1).toLocaleDateString(undefined, { weekday: "short" })); // Mon..Sun

  async function editEvent(ev = {}, date) {
    const isNew = !ev.id;
    const v = await Apps.form(isNew ? "New event" : "Edit event", [
      { key: "title", label: "Title", required: true, placeholder: "Team sync" },
      { key: "date", label: "Date", type: "date", half: true, required: true }, { key: "end", label: "Ends (optional)", type: "date", half: true },
      { key: "start", label: "Start time", type: "time", half: true }, { key: "finish", label: "End time", type: "time", half: true },
      { key: "where", label: "Location or link", placeholder: "Office / Meet link" },
      { key: "desc", label: "Notes", type: "textarea", rows: 2 },
      { key: "color", label: "Colour", type: "color" },
    ], { date: date || Apps.today(), ...ev }, isNew ? { ok: "Create event" } : { onDelete: () => Data.remove("events", ev.id) });
    if (!v) return;
    const { id, ...rest } = v;
    if (isNew) { await Data.add("events", rest); UI.toast("📅 Event added"); }
    else Data.update("events", ev.id, rest);
  }

  function render(root) {
    let view = localStorage.getItem("lumen-cal-view") || "month", cursor = new Date(); cursor.setDate(1);
    let showTasks = true, showOther = true;
    const label = h("h2", { class: "cal-label" });
    const body = h("div", { class: "cal-body" });
    const viewSeg = h("div", { class: "seg" }, ...[["month", "Month"], ["week", "Week"], ["agenda", "Agenda"]].map(([k, l]) => h("button", { class: view === k ? "on" : "", text: l, onclick: e => {
      view = k; localStorage.setItem("lumen-cal-view", k); viewSeg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.currentTarget)); if (k === "week") cursor = new Date(); draw(); } })));
    const tog = (lab, get, set) => { const s = h("span", { class: "switch" + (get() ? " on" : "") }); return h("button", { class: "chip-btn", onclick: () => { set(!get()); s.classList.toggle("on", get()); draw(); } }, s, lab); };
    root.append(Apps.header("Calendar", "📅", "Events, deadlines and time off in one place", h("button", { class: "btn primary", text: "+ Event", onclick: () => editEvent() })),
      h("div", { class: "app-toolbar" },
        h("button", { class: "btn", text: "Today", onclick: () => { cursor = new Date(); if (view === "month") cursor.setDate(1); draw(); } }),
        h("button", { class: "icon-btn", text: "‹", onclick: () => step(-1) }), h("button", { class: "icon-btn", text: "›", onclick: () => step(1) }), label,
        h("span", { class: "grow" }), tog("Tasks", () => showTasks, v => (showTasks = v)), tog("Deals & time off", () => showOther, v => (showOther = v)), viewSeg),
      body);

    function step(n) { if (view === "week") cursor.setDate(cursor.getDate() + 7 * n); else cursor.setMonth(cursor.getMonth() + n); draw(); }
    function items() {
      const out = [];
      Data.list("events").forEach(e => {
        let d = e.date, guard = 0; const last = e.end && e.end > e.date ? e.end : e.date;
        while (d <= last && guard++ < 60) { out.push({ date: d, title: e.title, time: d === e.date ? e.start : "", color: e.color || "#7c5cff", open: () => editEvent(e), kind: "event" }); d = Apps.addDays(d, 1); }
      });
      if (showTasks) Data.list("tasks").filter(t => t.deadline && t.status !== "done").forEach(t => out.push({ date: t.deadline, title: "✅ " + t.title, color: t.deadline < Apps.today() ? "#ef4444" : "#10b981", open: () => Apps.Tasks.openTask(t.id), kind: "task" }));
      if (showOther) {
        Data.list("deals").filter(d => d.close && !["won", "lost"].includes(d.stage)).forEach(d => out.push({ date: d.close, title: "💼 " + d.title, color: "#f59e0b", open: () => Apps.go("crm"), kind: "deal" }));
        Data.list("absences").forEach(a => { let d = a.from, g = 0; while (d <= (a.to || a.from) && g++ < 60) { out.push({ date: d, title: "🌴 " + Data.person(a.who).name, color: "#64748b", open: () => Apps.go("company"), kind: "absence" }); d = Apps.addDays(d, 1); } });
      }
      return out.sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
    }
    const chip = it => h("button", { class: "cal-chip", style: { "--c": it.color }, title: it.title, onclick: e => { e.stopPropagation(); it.open(); } }, it.time ? h("b", { text: it.time + " " }) : null, it.title);
    function month(all) {
      label.textContent = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
      const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1), start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
      const grid = h("div", { class: "cal-grid" }, ...WD.map(d => h("div", { class: "cal-wd", text: d })));
      const today = Apps.today();
      for (let i = 0; i < 42; i++) {
        const d = new Date(start); d.setDate(start.getDate() + i); const ds = iso(d);
        const its = all.filter(x => x.date === ds);
        grid.append(h("div", { class: "cal-day" + (d.getMonth() !== cursor.getMonth() ? " other" : "") + (ds === today ? " today" : ""), onclick: () => editEvent({}, ds) },
          h("span", { class: "cal-n", text: d.getDate() }), ...its.slice(0, 3).map(chip), its.length > 3 ? h("span", { class: "cal-more", text: `+${its.length - 3} more` }) : null));
      }
      return grid;
    }
    function week(all) {
      const s = new Date(cursor); s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
      const e = new Date(s); e.setDate(s.getDate() + 6);
      label.textContent = `${s.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${e.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
      return h("div", { class: "cal-week" }, ...Array.from({ length: 7 }, (_, i) => {
        const d = new Date(s); d.setDate(s.getDate() + i); const ds = iso(d);
        return h("div", { class: "cw-col" + (ds === Apps.today() ? " today" : ""), onclick: () => editEvent({}, ds) },
          h("div", { class: "cw-h" }, h("span", { text: WD[i] }), h("b", { text: d.getDate() })), ...all.filter(x => x.date === ds).map(chip));
      }));
    }
    function agenda(all) {
      label.textContent = "Next 30 days";
      const t = Apps.today(), end = Apps.addDays(t, 30), up = all.filter(x => x.date >= t && x.date <= end);
      if (!up.length) return Apps.empty("🗓️", "Nothing scheduled in the next 30 days.", h("button", { class: "btn primary", text: "+ Event", onclick: () => editEvent() }));
      const days = [...new Set(up.map(x => x.date))].sort();
      return h("div", { class: "agenda" }, ...days.map(ds => h("div", { class: "ag-day" },
        h("div", { class: "ag-date" }, h("b", { text: new Date(ds + "T00:00").getDate() }), h("span", { text: new Date(ds + "T00:00").toLocaleDateString(undefined, { weekday: "short", month: "short" }) })),
        h("div", { class: "ag-items" }, ...up.filter(x => x.date === ds).map(chip)))));
    }
    function draw() { const all = items(); body.replaceChildren(view === "week" ? week(all) : view === "agenda" ? agenda(all) : month(all)); }
    const offs = ["events", "tasks", "deals", "absences", "people"].map(c => Data.on(c, draw));
    return () => offs.forEach(f => f());
  }

  Apps.register("calendar", { title: "Calendar", icon: "📅", render });
  Apps.Calendar = { editEvent };
})();
