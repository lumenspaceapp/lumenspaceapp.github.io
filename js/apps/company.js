/* Company & HR: employee directory, structure, absence chart, time tracking (clock in/out) */
(function () {
  const { h, esc } = UI;
  const ABS = { vacation: ["🌴 Vacation", "#10b981"], sick: ["🤒 Sick leave", "#ef4444"], personal: ["🏠 Personal", "#f59e0b"], remote: ["💻 Remote", "#3b82f6"], trip: ["✈️ Business trip", "#8b5cf6"] };
  const entryId = (who, d) => (who + "_" + d).replace(/[^\w@.-]/g, "_");
  const worked = e => { if (!e?.start) return 0; const end = e.end || Date.now(); const paused = (e.pauses || []).reduce((a, p) => a + ((p.e || (e.end ? e.end : Date.now())) - p.s), 0); return Math.max(0, end - e.start - paused); };
  const hm = ms => { const m = Math.floor(ms / 60000); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
  const state = e => !e?.start ? "off" : e.end ? "done" : (e.pauses || []).some(p => !p.e) ? "paused" : "working";

  async function editProfile() {
    const me = Data.me(), cur = Data.get("people", me.key) || {};
    const v = await Apps.form("My profile", [{ key: "avatar", label: "Avatar", type: "avatar", photo: me.photo, person: me }, { key: "name", label: "Name", required: true }, { key: "title", label: "Job title", half: true }, { key: "dept", label: "Department", half: true },
      { key: "phone", label: "Phone", type: "tel", half: true }, { key: "birthday", label: "Birthday", type: "date", half: true }, { key: "about", label: "About me", type: "textarea", rows: 3 }], { name: me.name, ...cur, avatar: me.avatar || "" }, { width: 560 });
    if (v) { const { avatar, ...rest } = v; await Data.update("people", me.key, { ...rest, email: me.email, photo: me.photo }); Data.setAvatar(avatar); UI.toast("Profile updated"); }
  }
  async function requestAbsence(preset = {}) {
    const v = await Apps.form("Time off", [{ key: "who", label: "Who", type: "person" }, { key: "type", label: "Type", type: "select", options: Object.entries(ABS).map(([k, [l]]) => [k, l]) },
      { key: "from", label: "From", type: "date", half: true, required: true }, { key: "to", label: "To", type: "date", half: true }, { key: "note", label: "Note" }], { who: Data.me().key, from: Apps.today(), ...preset },
      preset.id ? { onDelete: () => Data.remove("absences", preset.id) } : { ok: "Add" });
    if (!v) return;
    const { id, ...rest } = v; if (!rest.to || rest.to < rest.from) rest.to = rest.from;
    id ? Data.update("absences", id, rest) : Data.add("absences", rest);
  }

  /* ---------- clock in / out ---------- */
  function clock(action) {
    const me = Data.me().key, d = Apps.today(), id = entryId(me, d), e = Data.get("timelog", id), now = Date.now();
    if (action === "start") Data.add("timelog", { who: me, date: d, start: now, end: null, pauses: [], at: now }, id);
    if (action === "pause") Data.update("timelog", id, { pauses: [...(e.pauses || []), { s: now, e: null }] });
    if (action === "resume") Data.update("timelog", id, { pauses: (e.pauses || []).map(p => p.e ? p : { ...p, e: now }) });
    if (action === "end") Data.update("timelog", id, { end: now, pauses: (e.pauses || []).map(p => p.e ? p : { ...p, e: now }) });
    if (action === "reopen") Data.update("timelog", id, { end: null });
  }
  // topbar pill showing today's worked time
  function pill() {
    let el = document.getElementById("workPill");
    if (!el) { el = h("button", { class: "work-pill", id: "workPill", onclick: () => Apps.go("company", "time") }); document.querySelector(".tb-right").prepend(el); }
    const e = Data.get("timelog", entryId(Data.me().key, Apps.today())), s = state(e);
    el.style.display = s === "off" ? "none" : "";
    el.className = "work-pill " + s; el.textContent = (s === "working" ? "🟢 " : s === "paused" ? "⏸ " : "✅ ") + hm(worked(e));
  }
  let unPill = null, tick = null;
  const startPill = () => { unPill && unPill(); unPill = Data.on("timelog", pill); clearInterval(tick); tick = setInterval(pill, 30000); };

  function render(root, arg) {
    let tab = arg || "people", month = new Date(); month.setDate(1);
    const body = h("div", { class: "app-body" });
    root.append(Apps.header("Company", "🏢", "Your team, time off and working hours", h("button", { class: "btn", text: "Edit my profile", onclick: editProfile }), h("button", { class: "btn primary", text: "+ Time off", onclick: () => requestAbsence() })),
      Apps.tabs([["people", "Employees"], ["structure", "Structure"], ["absence", "Absence chart"], ["time", "Time tracking"]], tab, k => { tab = k; draw(); }), body);

    function people() {
      const ppl = Data.people(), absToday = Data.list("absences").filter(a => a.from <= Apps.today() && (a.to || a.from) >= Apps.today());
      return h("div", { class: "emp-grid" }, ...ppl.map((p, i) => {
        const away = absToday.find(a => a.who === p.key), e = Data.get("timelog", entryId(p.key, Apps.today())), s = state(e);
        return h("div", { class: "emp glass", style: { animationDelay: i * 50 + "ms" } }, Apps.avatar(p, 64),
          h("b", { text: p.name + (p.key === Data.me().key ? " (you)" : "") }), h("div", { class: "app-sub", text: [p.title, p.dept].filter(Boolean).join(" · ") || "No title yet" }),
          h("div", { class: "emp-st" }, away ? h("span", { class: "tag", dataset: { tc: "orange" }, text: ABS[away.type]?.[0] || "Away" }) : s === "working" ? h("span", { class: "tag", dataset: { tc: "green" }, text: "🟢 Working" }) : p.online ? h("span", { class: "tag", dataset: { tc: "blue" }, text: "Online" }) : null),
          p.email ? h("a", { class: "emp-l", href: "mailto:" + p.email, text: "✉️ " + p.email }) : null, p.phone ? h("a", { class: "emp-l", href: "tel:" + p.phone, text: "📞 " + p.phone }) : null,
          p.about ? h("p", { class: "emp-about", text: p.about }) : null,
          p.key !== Data.me().key ? h("button", { class: "btn", text: "💬 Message", onclick: () => Apps.go("chat", "dm:" + [Data.me().key, p.key].sort().join("|")) }) : h("button", { class: "btn", text: "Edit profile", onclick: editProfile }));
      }));
    }
    function structure() {
      const ppl = Data.people(), depts = {};
      ppl.forEach(p => (depts[p.dept || "No department"] ||= []).push(p));
      return h("div", { class: "org" }, h("div", { class: "org-root glass" }, h("span", { class: "app-ic", text: Store.getIcon() || "🏢" }), h("b", { text: Store.getName() }), h("small", { text: ppl.length + " people" })),
        h("div", { class: "org-depts" }, ...Object.entries(depts).sort().map(([d, list]) => h("div", { class: "org-dept glass" }, h("b", { text: d }), h("small", { text: list.length + (list.length === 1 ? " person" : " people") }),
          ...list.map(p => h("div", { class: "org-p" }, Apps.avatar(p, 26), h("span", null, h("div", { text: p.name }), h("small", { text: p.title || "" }))))))),
        h("p", { class: "app-sub", text: "Set your department in “Edit my profile” to place yourself in the structure." }));
    }
    function absence() {
      const y = month.getFullYear(), m = month.getMonth(), days = new Date(y, m + 1, 0).getDate();
      const ds = i => `${y}-${String(m + 1).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
      const abs = Data.list("absences");
      const grid = h("div", { class: "abs-grid", style: { gridTemplateColumns: `180px repeat(${days}, minmax(22px, 1fr))` } },
        h("div", { class: "abs-h" }), ...Array.from({ length: days }, (_, i) => { const d = new Date(y, m, i + 1); return h("div", { class: "abs-h" + ([0, 6].includes(d.getDay()) ? " we" : "") + (ds(i + 1) === Apps.today() ? " today" : ""), text: i + 1 }); }));
      Data.people().forEach(p => {
        grid.append(h("div", { class: "abs-name" }, Apps.avatar(p, 22), p.name));
        for (let i = 1; i <= days; i++) {
          const d = ds(i), a = abs.find(x => x.who === p.key && x.from <= d && (x.to || x.from) >= d), we = [0, 6].includes(new Date(y, m, i).getDay());
          grid.append(h("div", { class: "abs-c" + (we ? " we" : ""), title: a ? `${ABS[a.type]?.[0]} ${a.note || ""}` : "", style: a ? { background: ABS[a.type]?.[1] } : {}, onclick: () => a ? requestAbsence(a) : requestAbsence({ who: p.key, from: d }) }));
        }
      });
      return h("div", null, h("div", { class: "app-toolbar" }, h("button", { class: "icon-btn", text: "‹", onclick: () => { month.setMonth(m - 1); draw(); } }), h("b", { text: month.toLocaleDateString(undefined, { month: "long", year: "numeric" }) }), h("button", { class: "icon-btn", text: "›", onclick: () => { month.setMonth(m + 1); draw(); } }),
        h("span", { class: "grow" }), ...Object.values(ABS).map(([l, c]) => h("span", { class: "legend" }, h("i", { style: { background: c } }), l))), h("div", { class: "abs-wrap glass" }, grid));
    }
    function time() {
      const me = Data.me().key, e = Data.get("timelog", entryId(me, Apps.today())), s = state(e);
      const big = h("div", { class: "clock-big", text: hm(worked(e)) });
      const btns = s === "off" ? [h("button", { class: "btn primary big", text: "▶ Start workday", onclick: () => clock("start") })]
        : s === "working" ? [h("button", { class: "btn big", text: "⏸ Pause", onclick: () => clock("pause") }), h("button", { class: "btn primary big", text: "⏹ End workday", onclick: () => clock("end") })]
        : s === "paused" ? [h("button", { class: "btn primary big", text: "▶ Resume", onclick: () => clock("resume") })]
        : [h("button", { class: "btn big", text: "↺ Continue workday", onclick: () => clock("reopen") })];
      const mon = new Date(); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
      const week = Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return Apps.iso(d); });
      const logs = Data.list("timelog");
      return h("div", { class: "time-wrap" },
        h("div", { class: "clock-card glass " + s }, h("div", { class: "app-sub", text: new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) }), big,
          h("div", { class: "app-sub", text: s === "off" ? "Not started yet" : s === "working" ? "Started at " + new Date(e.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : s === "paused" ? "On a break" : "Finished at " + new Date(e.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }),
          h("div", { class: "clock-btns" }, ...btns)),
        h("div", { class: "report glass" }, h("h3", { text: "This week" }),
          h("div", { class: "tw-grid", style: { gridTemplateColumns: `160px repeat(7, 1fr) 90px` } }, h("span"), ...week.map(d => h("span", { class: "tw-h" + (d === Apps.today() ? " today" : ""), text: new Date(d + "T00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric" }) })), h("span", { class: "tw-h", text: "Total" }),
            ...Data.people().flatMap(p => { let tot = 0; const cells = week.map(d => { const ms = worked(logs.find(l => l.who === p.key && l.date === d)); tot += ms; return h("span", { class: "tw-c" + (ms ? " has" : ""), text: ms ? hm(ms) : "—" }); });
              return [h("span", { class: "who" }, Apps.avatar(p, 20), p.name), ...cells, h("b", { class: "tw-c", text: hm(tot) })]; }))));
    }
    function draw() { body.replaceChildren(tab === "structure" ? structure() : tab === "absence" ? absence() : tab === "time" ? time() : people()); }
    const offs = ["people", "absences", "timelog"].map(c => Data.on(c, () => { if (!body.contains(document.activeElement)) draw(); }));
    const t = setInterval(() => tab === "time" && draw(), 30000);
    return () => { offs.forEach(f => f()); clearInterval(t); };
  }

  Apps.register("company", { title: "Company & HR", icon: "🏢", render });
  Apps.Company = { clock, state, worked, hm, entryId, ABS, today: () => Data.get("timelog", entryId(Data.me().key, Apps.today())) };
  Apps.onWorkspace.add(startPill);
  setTimeout(startPill, 0);
})();
