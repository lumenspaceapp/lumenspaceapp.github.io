/* Calendar: Bitrix24-style team calendar.
   Month / week / day (time grid) / agenda views, events with attendees and invitations (RSVP), company or
   personal calendars, repeating events, reminders, meeting rooms, busy check, drag to reschedule, plus task
   deadlines, CRM deals and absences overlaid. Rooms are `events` docs with kind: "room". */
(function () {
  const { h, esc } = UI;
  const HOUR = 48; // px per hour in the time grid
  const PAL = ["#7c5cff", "#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#64748b"];
  const REPEAT = [["", "Doesn't repeat"], ["day", "Every day"], ["week", "Every week"], ["month", "Every month"], ["year", "Every year"]];
  const REPEAT_TXT = { day: "daily", week: "weekly", month: "monthly", year: "yearly" };
  const REMIND = [["", "No reminder"], ["0", "At start time"], ["5", "5 minutes before"], ["10", "10 minutes before"], ["15", "15 minutes before"], ["30", "30 minutes before"], ["60", "1 hour before"], ["1440", "1 day before"]];
  const ST_LABEL = { yes: "Going", maybe: "Maybe", no: "Declined", pending: "Invited" };
  const WD = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, i + 1).toLocaleDateString(undefined, { weekday: "short" })); // Mon..Sun
  const mobile = () => innerWidth <= 760;

  /* ---------- dates: "YYYY-MM-DD" strings, maths on whole days (UTC so DST never shifts a day) ---------- */
  const dn = s => { const [y, m, d] = s.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
  const nd = n => new Date(n * 864e5).toISOString().slice(0, 10);
  const add = (s, n) => nd(dn(s) + n);
  const okDate = s => /^\d{4}-\d\d-\d\d$/.test(s || "");
  const toMin = t => /^\d\d?:\d\d$/.test(t || "") ? +t.split(":")[0] * 60 + +t.split(":")[1] : null;
  const toHM = m => { m = Math.max(0, Math.min(1439, Math.round(m))); return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
  const dObj = s => new Date(s + "T00:00");
  const fmtD = (s, o = { month: "short", day: "numeric" }) => dObj(s).toLocaleDateString(undefined, o);
  const fmtT = t => { const m = toMin(t); return m == null ? "" : new Date(2000, 0, 1, Math.floor(m / 60), m % 60).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); };
  const hourLabel = hr => new Date(2000, 0, 1, hr).toLocaleTimeString([], { hour: "numeric" });
  const wd = s => (dObj(s).getDay() + 6) % 7; // Monday = 0
  const weekStart = s => add(s, -wd(s));
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

  /* ---------- event model (old docs lack the new fields: default them) ---------- */
  const me = () => Data.me().key;
  const ownerOf = e => e.owner || e.by;
  const attOf = e => e && e.attendees && typeof e.attendees === "object" && !Array.isArray(e.attendees) ? e.attendees : {};
  const guests = e => Object.keys(attOf(e)).filter(k => k !== ownerOf(e));
  const statusOf = (e, k = me()) => ownerOf(e) === k ? "yes" : attOf(e)[k] || null;
  const involved = (e, k = me()) => ownerOf(e) === k || k in attOf(e);
  const canEdit = e => !e || !e.id || ownerOf(e) === me();
  const isAllDay = e => e.allDay != null ? !!e.allDay : toMin(e.start) == null;
  const remindOf = e => e.remind === undefined ? (isAllDay(e) ? null : 10) : (e.remind === "" || e.remind == null ? null : +e.remind);
  const visible = e => !!e && !e.kind && okDate(e.date) && (e.calendar !== "personal" || involved(e));
  const span = e => okDate(e.end) && e.end > e.date ? dn(e.end) - dn(e.date) : 0;
  const isRep = e => !!(e.repeat && e.repeat.freq);
  const rooms = () => Data.list("events").filter(e => e.kind === "room").sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const roomName = id => (id && Data.get("events", id)?.name) || "";
  const placeOf = e => [roomName(e.room), e.where].filter(Boolean).join(", ");
  function times(e) {
    if (isAllDay(e)) return { s: 0, f: 1440 };
    const s = toMin(e.start) || 0; let f = toMin(e.finish);
    if (f == null) f = Math.min(1440, s + 60); else if (f <= s && !span(e)) f = 1440;
    return { s, f };
  }

  // start dates of every occurrence of e whose days touch [from, to] (repeats expanded, exdates skipped)
  function starts(e, from, to) {
    const sp = span(e), out = [], ex = new Set(e.exdates || []), lo = dn(from) - sp, hi = dn(to), first = dn(e.date);
    if (!isRep(e)) { if (first <= hi && first >= lo) out.push(e.date); return out; }
    const r = e.repeat, until = okDate(r.until) ? Math.min(dn(r.until), hi) : hi;
    if (r.freq === "day" || r.freq === "week") {
      const step = r.freq === "day" ? 1 : 7;
      let n = first < lo ? first + Math.ceil((lo - first) / step) * step : first;
      for (let g = 0; n <= until && g < 800; n += step, g++) { const s = nd(n); if (!ex.has(s)) out.push(s); }
    } else {
      const [y, m, d] = e.date.split("-").map(Number);
      for (let i = 0; i < 1200; i++) {
        const yy = r.freq === "year" ? y + i : y + Math.floor((m - 1 + i) / 12), mm = r.freq === "year" ? m : ((m - 1 + i) % 12) + 1;
        const dt = new Date(Date.UTC(yy, mm - 1, d));
        if (dt.getUTCDate() !== d) continue; // the 31st in a short month, Feb 29
        const n = Math.round(dt / 864e5);
        if (n > until) break; if (n < lo) continue;
        const s = nd(n); if (!ex.has(s)) out.push(s);
      }
    }
    return out;
  }
  function occ(e, date) {
    const { s, f } = times(e), ad = isAllDay(e);
    return { ev: e, date, end: add(date, span(e)), allDay: ad, start: ad ? "" : toHM(s), finish: ad ? "" : (toMin(e.finish) != null && f !== 1440 ? e.finish : toHM(Math.min(f, 1439))), sm: s, fm: f, declined: statusOf(e) === "no" };
  }
  const byTime = (a, b) => (b.allDay || b.end > b.date) - (a.allDay || a.end > a.date) || a.sm - b.sm || String(a.title || a.ev?.title || "").localeCompare(String(b.title || b.ev?.title || ""));
  // every visible occurrence between two dates (inclusive), sorted by date and time
  function occurrences(from, to, { mine } = {}) {
    const out = [];
    Data.list("events").forEach(e => {
      if (!visible(e) || (mine && !involved(e) && guests(e).length)) return;
      starts(e, from, to).forEach(d => out.push(occ(e, d)));
    });
    return out.sort((a, b) => a.date.localeCompare(b.date) || (b.allDay - a.allDay) || a.sm - b.sm);
  }
  // the next occurrence on or after today (or the first one)
  const nextDate = e => (isRep(e) ? starts(e, Apps.today(), add(Apps.today(), 800))[0] : null) || e.date;
  const lastDay = e => isRep(e) ? (okDate(e.repeat.until) ? e.repeat.until : "9999-12-31") : (okDate(e.end) && e.end > e.date ? e.end : e.date);
  // other events' occurrences overlapping an interval that pass test(e)
  function clashes(ignoreId, date, end, sm, fm, test) {
    const A = dn(date) * 1440 + sm, B = dn(end) * 1440 + fm, res = [];
    Data.list("events").forEach(e => {
      if (e.kind || e.id === ignoreId || !okDate(e.date) || !test(e)) return;
      starts(e, date, end).forEach(d => { const o = occ(e, d), a = dn(o.date) * 1440 + o.sm, b = dn(o.end) * 1440 + o.fm; if (a < B && A < b) res.push(o); });
    });
    return res;
  }
  function whenText(o) {
    const d1 = fmtD(o.date, { weekday: "short", month: "short", day: "numeric" });
    if (o.end > o.date) { const d2 = fmtD(o.end, { weekday: "short", month: "short", day: "numeric" }); return o.allDay ? `${d1} – ${d2}` : `${d1}, ${fmtT(o.start)} – ${d2}, ${fmtT(o.finish)}`; }
    return o.allDay ? `${d1} · All day` : `${d1} · ${fmtT(o.start)} – ${fmtT(o.finish)}`;
  }
  const repeatText = e => isRep(e) ? `Repeats ${REPEAT_TXT[e.repeat.freq] || ""}${okDate(e.repeat.until) ? " until " + fmtD(e.repeat.until, { month: "short", day: "numeric", year: "numeric" }) : ""}` : "";
  const link = (id, date) => "#/app/calendar/" + id + (date ? "?date=" + date : "");
  const videoUrl = () => `https://meet.jit.si/Lumen-${String(window.Cloud?.ws?.id || "local").replace(/[^\w-]/g, "").slice(0, 10)}-${Math.random().toString(36).slice(2, 10)}`;

  /* ---------- actions ---------- */
  function respond(e, s) {
    const m = me(); e = Data.get("events", e.id) || e;
    if (statusOf(e) === s || ownerOf(e) === m) return;
    Data.update("events", e.id, { attendees: { ...attOf(e), [m]: s } });
    const verb = { yes: "accepted", no: "declined", maybe: "might join" }[s];
    Data.notify(ownerOf(e), `📅 ${esc(Data.me().name)} ${verb} “${esc(e.title || "Event")}”`, link(e.id), whenText(occ(e, nextDate(e))));
    UI.toast(s === "yes" ? "✅ You're going" : s === "no" ? "Invitation declined" : "Marked as maybe");
  }
  function moveEvent(e, dd, t) {
    const patch = {};
    if (dd) {
      patch.date = add(e.date, dd);
      if (okDate(e.end) && e.end > e.date) patch.end = add(e.end, dd);
      if (isRep(e)) {
        if (okDate(e.repeat.until)) patch.repeat = { freq: e.repeat.freq, until: add(e.repeat.until, dd) };
        if ((e.exdates || []).length) patch.exdates = e.exdates.map(x => add(x, dd));
      }
    }
    if (t && (t.start !== e.start || t.finish !== e.finish)) Object.assign(patch, t);
    if (!Object.keys(patch).length) return;
    Data.update("events", e.id, patch);
    UI.toast(isRep(e) ? "🔁 Whole series moved" : "📅 Event moved", { label: "Undo", run: () => Data.update("events", e.id, Object.fromEntries(Object.keys(patch).map(k => [k, e[k] ?? null]))) });
  }
  function choose(title, msg, options) {
    return new Promise(res => {
      let done = false;
      const m = UI.modal(title, h("div", null, h("p", { style: { marginTop: 0, color: "var(--muted)" }, text: msg }),
        h("div", { class: "cal-choose" }, h("button", { class: "btn", text: "Cancel", onclick: () => m.close() }),
          ...options.map(([k, l, cls]) => h("button", { class: "btn " + (cls || ""), text: l, onclick: () => { done = true; res(k); m.close(); } })))), { onClose: () => !done && res(null) });
      m.el.style.width = "440px";
    });
  }
  async function deleteEvent(e, date, after) {
    if (isRep(e)) {
      const c = await choose("Delete repeating event", `“${e.title || "Event"}” repeats. Delete only this one, or every event in the series?`, [["one", "Only this one", "primary"], ["all", "All events", "danger"]]);
      if (!c) return;
      if (c === "one") { Data.arr("events", e.id, "exdates", date || e.date); UI.toast("🗑️ Removed this one"); after?.(); return; }
    } else if (!await UI.confirm(`Delete “${e.title || "this event"}”? Attendees will be told it's cancelled.`)) return;
    guests(e).filter(k => attOf(e)[k] !== "no").forEach(k => Data.notify(k, `📅 ${esc(Data.me().name)} cancelled “${esc(e.title || "Event")}”`, "#/app/calendar", whenText(occ(e, date || nextDate(e)))));
    Data.remove("events", e.id); UI.toast("🗑️ Event deleted"); after?.();
  }

  /* ---------- event details (popover on click, side panel for deep links) ---------- */
  function detail(e, date, ctx) {
    const m = me(), o = occ(e, date || e.date), st = statusOf(e), g = guests(e), at = attOf(e), owner = ownerOf(e);
    const row = (ic, ...kids) => h("div", { class: "ev-row" }, h("span", { class: "ev-ic", text: ic }), h("div", { class: "ev-rv" }, ...kids));
    const counts = ["yes", "maybe", "no", "pending"].map(s => [s, g.filter(k => at[k] === s).length + (s === "yes" ? 1 : 0)]).filter(([, n]) => n);
    const people = [owner, ...g];
    const showAll = ctx.full || people.length <= 6;
    return h("div", { class: "ev-detail" + (ctx.full ? " full" : ""), style: { "--c": e.color || PAL[0] } },
      h("div", { class: "ev-head" },
        h("div", { class: "ev-title" }, h("span", { class: "ev-dot" }), h("h3", { text: e.title || "Untitled event" })),
        h("div", { class: "ev-badges" },
          st === "pending" ? h("span", { class: "ev-badge inv", text: "📨 Invitation" }) : null,
          st === "no" ? h("span", { class: "ev-badge no", text: "You declined" }) : null,
          e.calendar === "personal" ? h("span", { class: "ev-badge", text: "🔒 My calendar" }) : h("span", { class: "ev-badge", text: "🏢 Company" }))),
      row("🕒", h("div", { text: whenText(o) }), isRep(e) ? h("small", { text: "🔁 " + repeatText(e) }) : null,
        remindOf(e) != null ? h("small", { text: "🔔 " + (REMIND.find(r => r[0] === String(remindOf(e)))?.[1] || remindOf(e) + " minutes before") }) : null),
      e.room ? row("🚪", h("div", { text: roomName(e.room) || "Room removed" }), Data.get("events", e.room)?.capacity ? h("small", { text: Data.get("events", e.room).capacity + " seats" }) : null) : null,
      e.where ? row("📍", /^https?:\/\//.test(e.where) ? h("a", { href: e.where, target: "_blank", rel: "noopener", text: e.where }) : h("div", { text: e.where })) : null,
      e.video ? row("📹", h("a", { class: "btn primary ev-join", href: e.video, target: "_blank", rel: "noopener", text: "Join video call" }), h("small", { class: "ev-url", text: e.video })) : null,
      row("👥", h("div", { class: "ev-sum", text: g.length ? counts.map(([s, n]) => `${n} ${ST_LABEL[s].toLowerCase()}`).join(" · ") : "Organizer: " + Data.person(owner).name }),
        g.length ? h("div", { class: "ev-people" }, ...(showAll ? people : people.slice(0, 5)).map(k => {
          const p = Data.person(k), s = k === owner ? "yes" : at[k] || "pending";
          return h("div", { class: "ev-person" }, Apps.avatar(p, 24), h("span", { class: "ev-pn", text: p.name + (k === m ? " (you)" : "") }),
            k === owner ? h("span", { class: "st st-own", text: "Organizer" }) : h("span", { class: "st st-" + s, text: ST_LABEL[s] }));
        }), showAll ? null : h("small", { class: "ev-more", text: `+${people.length - 5} more` })) : null),
      e.desc ? row("📝", h("div", { class: "ev-desc", text: e.desc })) : null,
      (e.files || []).length ? row("📎", h("div", { class: "file-list" }, ...e.files.map(f => Apps.fileChip(f)))) : null,
      st && owner !== m ? h("div", { class: "ev-rsvp" }, h("span", { text: "Going?" }),
        ...[["yes", "✓ Accept"], ["maybe", "Maybe"], ["no", "✕ Decline"]].map(([s, l]) => h("button", { class: "btn rs-" + s + (st === s ? " on" : ""), text: l, onclick: () => { respond(e, s); ctx.refresh?.(); } }))) : null,
      h("div", { class: "ev-actions" },
        canEdit(e) ? h("button", { class: "btn primary", text: "Edit", onclick: () => { ctx.close?.(); editEvent(Data.get("events", e.id) || e, o.date); } }) : null,
        canEdit(e) ? h("button", { class: "btn danger", text: "Delete", onclick: () => deleteEvent(Data.get("events", e.id) || e, o.date, ctx.close) }) : null,
        h("span", { class: "grow" }),
        h("button", { class: "icon-btn", title: "Copy link", html: UI.icon("link"), onclick: () => { navigator.clipboard?.writeText(location.href.split("#")[0] + link(e.id, isRep(e) ? o.date : "")); UI.toast("🔗 Link copied"); } }),
        ctx.full ? null : h("button", { class: "btn", text: "Open", onclick: () => { ctx.close?.(); openEvent(e.id, o.date); } })));
  }
  function quickView(id, date, anchor) {
    const box = h("div", { class: "cal-pop-in" });
    let api;
    const fill = () => { const e = Data.get("events", id); if (!e) return api?.close(); box.replaceChildren(detail(e, date, { close: () => api.close(), refresh: () => setTimeout(fill) })); };
    fill();
    api = UI.popover(anchor, box, { className: "cal-pop" });
    return api;
  }
  function openEvent(id, date) {
    const e0 = Data.get("events", id);
    if (!e0 || !visible(e0)) { UI.toast("That event isn't available"); return; }
    const box = h("div");
    const p = Apps.panel(isRep(e0) ? "Repeating event" : "Event", box);
    const fill = () => { const e = Data.get("events", id); if (!e) return p.close(); box.replaceChildren(detail(e, date || nextDate(e), { full: true, close: () => p.close(), refresh: () => setTimeout(fill) })); };
    const off = Data.on("events", fill);
    p.onClose = off;
    return p;
  }

  /* ---------- invitations ---------- */
  const invites = () => { const m = me(), t = Apps.today(); return Data.list("events").filter(e => visible(e) && ownerOf(e) !== m && attOf(e)[m] === "pending" && lastDay(e) >= t).sort((a, b) => nextDate(a).localeCompare(nextDate(b))); };
  function invitations(anchor) {
    const box = h("div", { class: "cal-inv" });
    const fill = () => {
      const list = invites();
      box.replaceChildren(h("div", { class: "menu-sec", text: "Invitations" }),
        ...(list.length ? list.map(e => h("div", { class: "cal-inv-row", style: { "--c": e.color || PAL[0] } },
          h("button", { class: "cal-inv-main", onclick: () => { api.close(); openEvent(e.id, nextDate(e)); } },
            h("b", { text: e.title || "Untitled event" }), h("small", { text: whenText(occ(e, nextDate(e))) }), h("small", { text: "From " + Data.person(ownerOf(e)).name })),
          h("div", { class: "cal-inv-btns" },
            h("button", { class: "btn primary", text: "Accept", onclick: () => { respond(e, "yes"); setTimeout(fill); } }),
            h("button", { class: "btn", text: "Decline", onclick: () => { respond(e, "no"); setTimeout(fill); } }))))
          : [h("div", { class: "menu-empty", text: "No invitations waiting ✨" })]));
    };
    fill();
    const api = UI.popover(anchor, box, { align: "end", className: "cal-pop" });
  }

  /* ---------- meeting rooms ---------- */
  async function roomForm(r = {}) {
    const v = await Apps.form(r.id ? "Edit room" : "New meeting room", [
      { key: "name", label: "Name", required: true, placeholder: "Blue room" },
      { key: "capacity", label: "Seats", type: "number", placeholder: "8" },
    ], { name: r.name || "", capacity: r.capacity ?? "" }, { ok: r.id ? "Save" : "Add room", width: 420 });
    if (!v) return;
    const rec = { kind: "room", name: v.name.trim(), capacity: v.capacity === "" ? null : Math.max(0, +v.capacity || 0) };
    if (r.id) Data.update("events", r.id, rec); else { await Data.add("events", rec); UI.toast("🚪 Room added"); }
  }
  function roomsManager() {
    const box = h("div", { class: "cal-rooms" });
    const fill = () => {
      const t = Apps.today(), n = nowMin(), list = rooms();
      box.replaceChildren(
        ...(list.length ? list.map(r => {
          const today = clashes(null, t, t, 0, 1440, e => e.room === r.id), busy = today.some(o => o.sm <= n && o.fm > n);
          return h("div", { class: "cal-room" }, h("span", { class: "cal-room-ic", text: "🚪" }),
            h("div", { class: "cal-room-t" }, h("b", { text: r.name || "Room" }), h("small", { text: [r.capacity ? r.capacity + " seats" : "", today.length ? `${today.length} booking${today.length > 1 ? "s" : ""} today` : "Free all day"].filter(Boolean).join(" · ") })),
            h("span", { class: "cal-room-st" + (busy ? " busy" : ""), text: busy ? "Busy now" : "Free now" }),
            h("button", { class: "icon-btn", title: "Edit", text: "✎", onclick: () => roomForm(r) }),
            h("button", { class: "icon-btn", title: "Delete", html: UI.icon("trash"), onclick: async () => { if (await UI.confirm(`Delete “${r.name}”? Events keep their other details.`)) Data.remove("events", r.id); } }));
        }) : [Apps.empty("🚪", "No meeting rooms yet. Add one so people can book it with their events.")]),
        h("div", { class: "cal-rooms-foot" }, h("button", { class: "btn primary", text: "+ Add room", onclick: () => roomForm() })));
    };
    const off = Data.on("events", fill);
    const m = UI.modal("Meeting rooms", box, { onClose: off, className: "cal-rooms-modal" });
    m.el.style.width = "520px";
  }

  /* ---------- editor ---------- */
  function defaultTimes(date) {
    let s = 10 * 60;
    if (date === Apps.today()) s = Math.min(22 * 60, Math.ceil((nowMin() + 1) / 60) * 60);
    return { start: toHM(s), finish: toHM(Math.min(1439, s + 60)) };
  }
  async function editEvent(ev, date, preset = {}) {
    ev = ev && ev.id ? (Data.get("events", ev.id) || ev) : (ev || {});
    if (ev.id && !canEdit(ev)) return openEvent(ev.id, date);
    const isNew = !ev.id, m = me(), ownerKey = ownerOf(ev) || m, d0 = okDate(date) ? date : Apps.today(), t0 = defaultTimes(ev.date || d0);
    const v = {
      title: ev.title || "", allDay: isNew ? !!preset.allDay : isAllDay(ev), date: ev.date || d0, end: ev.end || "",
      start: ev.start || preset.start || t0.start, finish: ev.finish || preset.finish || t0.finish,
      repeat: ev.repeat?.freq || "", until: ev.repeat?.until || "", remind: isNew ? (preset.allDay ? null : 10) : remindOf(ev),
      people: guests(ev), calendar: ev.calendar || "company", room: ev.room || "", where: ev.where || "", video: ev.video || "",
      desc: ev.desc || "", color: ev.color || PAL[0], files: [...(ev.files || [])],
    };
    if (!okDate(v.end) || v.end < v.date) v.end = v.date;
    let remTouched = !isNew, done = false;

    const inp = (type, val, on, cls = "") => { const i = h("input", { class: "menu-input " + cls, type, value: val || "" }); i.addEventListener("input", () => on(i.value, i)); return i; };
    const field = (label, ...kids) => h("div", { class: "ed-f" }, h("span", { class: "ed-lab", text: label }), ...kids);
    const sel = (opts, val, on) => { const s = h("select", { class: "menu-input" }, ...opts.map(([k, l]) => h("option", { value: k, selected: String(val ?? "") === k }, l))); s.onchange = () => on(s.value); return s; };

    const title = inp("text", v.title, x => (v.title = x), "ed-title"); title.placeholder = "Event name";
    const adSw = h("span", { class: "switch" + (v.allDay ? " on" : "") });
    const dFrom = inp("date", v.date, x => { if (!okDate(x)) return; const len = dn(v.end) - dn(v.date); v.date = x; v.end = add(x, Math.max(0, len)); dTo.value = v.end; checks(); });
    const dTo = inp("date", v.end, x => { if (!okDate(x)) return; v.end = x < v.date ? v.date : x; checks(); });
    const tFrom = inp("time", v.start, x => {
      const a = toMin(x); if (a == null) return;
      const dur = toMin(v.finish) - toMin(v.start); v.start = x;
      if (dur > 0 && v.end === v.date) { v.finish = toHM(Math.min(1439, a + dur)); tTo.value = v.finish; }
      checks();
    });
    const tTo = inp("time", v.finish, x => { if (toMin(x) != null) { v.finish = x; checks(); } });
    const remSel = sel(REMIND, v.remind == null ? "" : String(v.remind), x => { remTouched = true; v.remind = x === "" ? null : +x; });
    const paintWhen = () => { tFrom.style.display = tTo.style.display = v.allDay ? "none" : ""; };
    const adBtn = h("button", { type: "button", class: "chip-btn", onclick: () => {
      v.allDay = !v.allDay; adSw.classList.toggle("on", v.allDay);
      if (!remTouched) { v.remind = v.allDay ? null : 10; remSel.value = v.remind == null ? "" : String(v.remind); }
      paintWhen(); checks();
    } }, adSw, "All day");
    const untilIn = inp("date", v.until, x => (v.until = x)); untilIn.title = "Repeat until (optional)";
    const untilWrap = h("div", { class: "ed-until" }, h("span", { text: "until" }), untilIn);
    const paintRep = () => { untilWrap.style.display = v.repeat ? "" : "none"; };
    const repSel = sel(REPEAT, v.repeat, x => { v.repeat = x; paintRep(); });

    // attendees + busy check
    const busyNote = h("div", { class: "ed-note" }), roomNote = h("div", { class: "ed-note" });
    const ppl = h("div", { class: "ed-people" });
    const paintPeople = () => ppl.replaceChildren(
      ...v.people.map(k => { const p = Data.person(k), s = attOf(ev)[k]; return h("span", { class: "ed-person" }, Apps.avatar(p, 22), h("span", { text: p.name }), s && s !== "pending" ? h("i", { class: "st st-" + s, text: ST_LABEL[s] }) : null,
        h("button", { type: "button", class: "ed-x", title: "Remove", text: "×", onclick: () => { v.people = v.people.filter(x => x !== k); paintPeople(); checks(); } })); }),
      h("button", { type: "button", class: "chip-btn ed-add", text: v.people.length ? "+ Add" : "+ Add people", onclick: e => Apps.peoplePicker(e.currentTarget, v.people, ks => { v.people = ks.filter(k => k !== ownerKey); paintPeople(); checks(); }, { exclude: [ownerKey] }) }));

    const calSeg = h("div", { class: "seg" }, ...[["company", "🏢 Company"], ["personal", "🔒 My calendar"]].map(([k, l]) => h("button", { type: "button", class: v.calendar === k ? "on" : "", text: l, onclick: e => { v.calendar = k; calSeg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.currentTarget)); } })));
    const roomSel = h("select", { class: "menu-input" });
    const paintRooms = () => { roomSel.replaceChildren(h("option", { value: "" }, "No room"), ...rooms().map(r => h("option", { value: r.id, selected: r.id === v.room }, r.name + (r.capacity ? ` · ${r.capacity} seats` : "")))); roomSel.value = v.room; };
    roomSel.onchange = () => { v.room = roomSel.value; checks(); };
    const where = inp("text", v.where, x => (v.where = x)); where.placeholder = "Office, address or link";

    const vidSw = h("span", { class: "switch" + (v.video ? " on" : "") }), vidBox = h("div", { class: "ed-video" });
    const paintVideo = () => vidBox.replaceChildren(v.video ? h("a", { href: v.video, target: "_blank", rel: "noopener", text: v.video }) : null,
      v.video ? h("button", { type: "button", class: "icon-btn xs", title: "Copy link", html: UI.icon("copy"), onclick: () => { navigator.clipboard?.writeText(v.video); UI.toast("🔗 Link copied"); } }) : null);
    const vidBtn = h("button", { type: "button", class: "chip-btn", onclick: () => { v.video = v.video ? "" : videoUrl(); vidSw.classList.toggle("on", !!v.video); paintVideo(); } }, vidSw, "📹 Add video call");

    const desc = h("textarea", { class: "menu-input ed-desc", rows: 3, placeholder: "Agenda, notes, links…" }); desc.value = v.desc; desc.oninput = () => (v.desc = desc.value);
    const colors = h("div", { class: "accents" }, ...PAL.map(c => h("button", { type: "button", class: v.color === c ? "on" : "", style: { background: c, color: c }, onclick: e => { v.color = c; body.style.setProperty("--c", c); colors.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.currentTarget)); } })));
    const files = h("div", { class: "file-list" });
    const paintFiles = () => files.replaceChildren(...v.files.map(f => Apps.fileChip(f, a => { v.files = v.files.filter(x => x.id !== a.id); paintFiles(); })),
      h("button", { type: "button", class: "chip-btn", text: "📎 Attach files", onclick: async () => { const fs = await Apps.pickFiles(true); if (!fs.length) return; UI.toast("Uploading…"); v.files = [...v.files, ...await Apps.attach(fs)]; paintFiles(); } }));

    function checks() {
      if (!okDate(v.date)) return;
      const s = v.allDay ? 0 : toMin(v.start) ?? 0, end = okDate(v.end) && v.end > v.date ? v.end : v.date;
      let f = v.allDay ? 1440 : toMin(v.finish) ?? 1440; if (end === v.date && f <= s) f = Math.min(1440, s + 15);
      if (v.room) {
        const c = clashes(ev.id, v.date, end, s, f, e => e.room === v.room);
        roomNote.className = "ed-note " + (c.length ? "warn" : "ok");
        roomNote.textContent = c.length ? `⚠️ Already booked: “${c[0].ev.title || "Event"}” ${c[0].allDay ? "all day" : fmtT(c[0].start) + " – " + fmtT(c[0].finish)}${c.length > 1 ? ` and ${c.length - 1} more` : ""}` : "✓ The room is free at this time";
      } else { roomNote.className = "ed-note"; roomNote.textContent = ""; }
      const busy = v.people.filter(k => clashes(ev.id, v.date, end, s, f, e => ownerOf(e) === k || attOf(e)[k] === "yes").length);
      busyNote.className = "ed-note " + (busy.length ? "warn" : v.people.length ? "ok" : "");
      busyNote.textContent = busy.length ? "Busy: " + busy.map(k => Data.person(k).name.split(" ")[0]).join(", ") : v.people.length ? "✓ Everyone is free" : "";
    }

    async function save() {
      const ttl = v.title.trim();
      if (!ttl) { title.focus(); return UI.toast("Give the event a name"); }
      if (!okDate(v.date)) return UI.toast("Pick a date");
      if (!v.allDay && toMin(v.start) == null) return UI.toast("Pick a start time");
      const end = okDate(v.end) && v.end > v.date ? v.end : null;
      let fin = v.finish;
      if (!v.allDay && (toMin(fin) == null || (!end && toMin(fin) <= toMin(v.start)))) fin = toHM(Math.min(1439, toMin(v.start) + 60));
      const latest = ev.id ? (Data.get("events", ev.id) || ev) : ev, old = attOf(latest), attendees = { [ownerKey]: "yes" };
      v.people.forEach(k => { attendees[k] = old[k] && k !== ownerKey ? old[k] : "pending"; });
      const rec = { title: ttl, date: v.date, end, allDay: v.allDay, start: v.allDay ? "" : v.start, finish: v.allDay ? "" : fin, where: v.where.trim(), desc: v.desc.trim(), color: v.color,
        owner: ownerKey, attendees, calendar: v.calendar, repeat: v.repeat ? { freq: v.repeat, until: okDate(v.until) && v.until >= v.date ? v.until : null } : null,
        remind: v.remind, room: v.room || "", video: v.video || "", files: v.files };
      done = true; modal.close();
      let id = ev.id;
      if (isNew) { id = await Data.add("events", { ...rec, exdates: [] }); UI.toast("📅 Event added"); }
      else {
        // removed attendees: a merge can't delete map keys, so write the whole doc again
        if (Object.keys(old).some(k => !(k in attendees))) { const { id: _, ...base } = latest; await Data.add("events", { ...base, ...rec }, ev.id); }
        else await Data.update("events", ev.id, rec);
        UI.toast("✅ Event saved");
      }
      const when = whenText(occ(rec, nextDate(rec)));
      v.people.filter(k => !(k in old) && k !== m).forEach(k => Data.notify(k, `📅 ${esc(Data.me().name)} invited you to “${esc(ttl)}”`, link(id), when));
    }

    const body = h("div", { class: "cal-ed", style: { "--c": v.color } },
      h("div", { class: "ed-top" }, title),
      h("div", { class: "ed-sec" },
        h("div", { class: "ed-when" },
          h("div", { class: "ed-pair" }, h("span", { class: "ed-lab", text: "From" }), dFrom, tFrom),
          h("span", { class: "ed-arrow", text: "→" }),
          h("div", { class: "ed-pair" }, h("span", { class: "ed-lab", text: "To" }), dTo, tTo)),
        h("div", { class: "ed-line" }, adBtn, h("div", { class: "ed-rep" }, h("span", { class: "ed-ic", text: "🔁" }), repSel, untilWrap), h("div", { class: "ed-rep" }, h("span", { class: "ed-ic", text: "🔔" }), remSel))),
      h("div", { class: "ed-sec" }, field("Attendees", ppl, busyNote)),
      h("div", { class: "ed-grid" },
        field("Calendar", calSeg),
        field("Meeting room", h("div", { class: "ed-roomrow" }, roomSel, h("button", { type: "button", class: "btn", text: "Rooms", title: "Manage meeting rooms", onclick: roomsManager })), roomNote),
        field("Location", where),
        field("Video call", vidBtn, vidBox)),
      field("Description", desc),
      h("div", { class: "ed-grid" }, field("Colour", colors), field("Files", files)),
      h("div", { class: "ed-foot" },
        !isNew ? h("button", { type: "button", class: "btn danger", text: "Delete", onclick: () => deleteEvent(ev, isRep(ev) ? date : ev.date, () => { done = true; modal.close(); }) }) : h("span"),
        h("span", { class: "grow" }),
        h("button", { type: "button", class: "btn", text: "Cancel", onclick: () => modal.close() }),
        h("button", { type: "button", class: "btn primary", text: isNew ? "Create event" : "Save", onclick: save })));
    body.addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } else if (e.key === "Enter" && e.target === title) { e.preventDefault(); save(); } });
    const offRooms = Data.on("events", () => { if (!done) { paintRooms(); checks(); } });
    const modal = UI.modal(isNew ? "New event" : "Edit event", body, { className: "cal-ed-modal", onClose: () => { done = true; offRooms(); } });
    modal.el.style.width = "680px";
    paintWhen(); paintRep(); paintPeople(); paintRooms(); paintVideo(); paintFiles(); checks();
    setTimeout(() => { if (isNew) title.focus(); }, 60);
  }

  /* ---------- the app ---------- */
  function render(root, arg) {
    const VKEY = mobile() ? "lumen-cal-view-m" : "lumen-cal-view";
    let view = localStorage.getItem(VKEY) || (mobile() ? "agenda" : "month");
    if (!["month", "week", "day", "agenda"].includes(view)) view = "month";
    const [argId, q] = String(arg || "").split("?"), argDate = new URLSearchParams(q || "").get("date");
    let cur = okDate(argDate) ? argDate : Apps.today();
    let F; try { F = { tasks: true, other: true, mine: false, ...JSON.parse(localStorage.getItem("lumen-cal-filters")) }; } catch { F = { tasks: true, other: true, mine: false }; }
    let dragging = false, pending = false, justDragged = 0, dragItem = null, anim = true, scrollKey = "", gridCols = [], gridDays = [], drawnDay = Apps.today();

    const label = h("h2", { class: "cal-label" });
    const body = h("div", { class: "cal-body" });
    const invBtn = h("button", { class: "btn cal-inv-btn", title: "Invitations waiting for your answer", onclick: e => invitations(e.currentTarget) });
    const newBtn = () => h("button", { class: "btn primary", text: "+ Event", onclick: () => editEvent(null, view === "day" ? cur : undefined) });
    const viewSeg = h("div", { class: "seg cal-views" }, ...[["month", "Month"], ["week", "Week"], ["day", "Day"], ["agenda", "Agenda"]].map(([k, l]) => h("button", { class: view === k ? "on" : "", dataset: { v: k }, text: l, onclick: () => setView(k) })));
    const tog = (lab, k, title) => { const s = h("span", { class: "switch" + (F[k] ? " on" : "") }); return h("button", { class: "chip-btn", title, onclick: () => { F[k] = !F[k]; s.classList.toggle("on", F[k]); try { localStorage.setItem("lumen-cal-filters", JSON.stringify(F)); } catch {} draw(); } }, s, lab); };
    root.append(
      Apps.header("Calendar", "📅", "Meetings, deadlines and time off in one place", invBtn,
        h("button", { class: "btn cal-rooms-btn", title: "Meeting rooms", onclick: roomsManager }, h("span", { text: "🚪" }), h("span", { class: "lbl", text: " Rooms" })), newBtn()),
      h("div", { class: "app-toolbar cal-toolbar" },
        h("div", { class: "cal-nav" },
          h("button", { class: "btn", text: "Today", onclick: () => { cur = Apps.today(); anim = true; draw(); } }),
          h("button", { class: "icon-btn", text: "‹", title: "Previous", onclick: () => step(-1) }), h("button", { class: "icon-btn", text: "›", title: "Next", onclick: () => step(1) }), label),
        h("span", { class: "grow" }),
        h("div", { class: "cal-filters" }, tog("Only my events", "mine", "Events you organise or are invited to"), tog("Tasks", "tasks", "Task deadlines"), tog("Deals & time off", "other", "CRM deals and absences")),
        viewSeg),
      body);

    function setView(k) {
      view = k; try { localStorage.setItem(VKEY, k); } catch {}
      viewSeg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === k));
      anim = true; draw();
    }
    function step(n) {
      if (view === "month") { const d = dObj(cur); d.setDate(1); d.setMonth(d.getMonth() + n); cur = Apps.iso(d); }
      else cur = add(cur, view === "week" ? 7 * n : view === "day" ? n : 30 * n);
      anim = true; draw();
    }
    function range() {
      if (view === "month") { const gs = weekStart(cur.slice(0, 8) + "01"); return [gs, add(gs, 41)]; }
      if (view === "week") { const s = weekStart(cur); return [s, add(s, 6)]; }
      if (view === "day") return [cur, cur];
      return [cur, add(cur, 30)];
    }

    function items(from, to) {
      const out = [], m = me(), t = Apps.today();
      occurrences(from, to).forEach(o => {
        const e = o.ev; if (F.mine && !involved(e)) return;
        const st = statusOf(e), inv = involved(e) && guests(e).length > 0;
        out.push({ ...o, kind: "event", key: e.id + "|" + o.date, title: e.title || "Untitled event", color: e.color || PAL[0], edit: ownerOf(e) === m, place: placeOf(e),
          cls: (inv ? " inv" : "") + (st === "no" ? " declined" : "") + (st === "pending" ? " pending" : "") + (e.calendar === "personal" ? " personal" : "") });
      });
      const ov = (kind, id, date, end, title, color, open) => out.push({ kind, key: kind + id + date, date, end, allDay: true, sm: 0, fm: 1440, title, color, open, cls: " ov" });
      if (F.tasks) Data.list("tasks").forEach(x => {
        if (!okDate(x.deadline) || x.status === "done" || x.kind || x.deleted || x.deadline < from || x.deadline > to) return;
        if (F.mine && x.assignee !== m && !(x.participants || []).includes(m) && !(!x.assignee && x.by === m)) return;
        ov("task", x.id, x.deadline, x.deadline, "✅ " + (x.title || "Task"), x.deadline < t ? "#ef4444" : "#10b981", () => Apps.Tasks?.openTask ? Apps.Tasks.openTask(x.id) : Apps.go("tasks", x.id));
      });
      if (F.other) {
        Data.list("deals").forEach(d => {
          if (!okDate(d.close) || ["won", "lost"].includes(d.stage) || d.close < from || d.close > to) return;
          if (F.mine && d.owner !== m && d.by !== m) return;
          ov("deal", d.id, d.close, d.close, "💼 " + (d.title || "Deal"), "#f59e0b", () => Apps.go("crm"));
        });
        Data.list("absences").forEach(a => {
          const e = okDate(a.to) && a.to > a.from ? a.to : a.from;
          if (!okDate(a.from) || a.from > to || e < from || (F.mine && a.who !== m)) return;
          ov("absence", a.id, a.from, e, "🌴 " + Data.person(a.who).name, "#64748b", () => Apps.go("company"));
        });
      }
      return out;
    }
    function openItem(it, anchor) { if (Date.now() - justDragged < 350) return; if (it.kind === "event") quickView(it.ev.id, it.date, anchor); else it.open(); }

    /* chips (month, all-day row) with native drag & drop (also works on touch via js/touch-dnd.js) */
    function chip(it, day) {
      const showTime = !it.allDay && it.date === day;
      const el = h("div", { class: "cal-chip" + it.cls + (it.allDay || it.end > it.date ? " block" : "") + (it.date < day ? " cont" : "") + (it.end > day ? " more" : ""), role: "button", tabindex: 0,
        style: { "--c": it.color }, title: it.title + (it.place ? " · " + it.place : ""),
        onclick: e => { e.stopPropagation(); openItem(it, el); }, onkeydown: e => { if (e.key === "Enter") openItem(it, el); } },
        showTime ? h("b", { text: fmtT(it.start) }) : null, h("span", { class: "cc-t", text: it.title }),
        it.ev && isRep(it.ev) ? h("span", { class: "cc-ic", text: "🔁" }) : null, it.ev?.video ? h("span", { class: "cc-ic", text: "📹" }) : null);
      if (it.kind === "event" && it.edit) {
        el.setAttribute("draggable", "true");
        el.addEventListener("dragstart", e => { dragItem = { it, day }; dragging = true; e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", it.key); } catch {} setTimeout(() => el.classList.add("dragging")); });
        el.addEventListener("dragend", () => { el.classList.remove("dragging"); dragItem = null; endDrag(); });
      }
      return el;
    }
    function dropTarget(cell, ds) {
      cell.addEventListener("dragover", e => { if (!dragItem) return; e.preventDefault(); e.dataTransfer && (e.dataTransfer.dropEffect = "move"); cell.classList.add("drop"); });
      cell.addEventListener("dragleave", e => { if (!cell.contains(e.relatedTarget)) cell.classList.remove("drop"); });
      cell.addEventListener("drop", e => {
        e.preventDefault(); cell.classList.remove("drop");
        if (!dragItem) return;
        const { it, day } = dragItem; dragItem = null; justDragged = Date.now(); dragging = false; pending = false;
        moveEvent(it.ev, dn(ds) - dn(day), null); draw();
      });
    }
    function endDrag() { dragging = false; if (pending) { pending = false; draw(); } }

    /* ---------- month ---------- */
    function month(all, gs) {
      const first = cur.slice(0, 8) + "01", mon = first.slice(0, 7), t = Apps.today(), max = mobile() ? 2 : 3;
      label.textContent = fmtD(first, { month: "long", year: "numeric" });
      const grid = h("div", { class: "cal-grid cal-month" }, ...WD.map(d => h("div", { class: "cal-wd", text: d })));
      for (let i = 0; i < 42; i++) {
        const ds = add(gs, i), its = all.filter(x => x.date <= ds && x.end >= ds).sort(byTime);
        const cell = h("div", { class: "cal-day" + (ds.slice(0, 7) !== mon ? " other" : "") + (ds === t ? " today" : "") + (wd(ds) >= 5 ? " we" : ""), onclick: () => editEvent(null, ds) },
          h("div", { class: "cal-dh" }, h("button", { class: "cal-n", text: +ds.slice(8), title: "Open this day", onclick: e => { e.stopPropagation(); cur = ds; setView("day"); } })),
          ...its.slice(0, max).map(it => chip(it, ds)),
          its.length > max ? h("button", { class: "cal-more", text: `+${its.length - max} more`, onclick: e => { e.stopPropagation(); cur = ds; setView("day"); } }) : null);
        dropTarget(cell, ds); grid.append(cell);
      }
      return grid;
    }

    /* ---------- week / day time grid ---------- */
    function lanes(list) {
      list.sort((a, b) => a.s - b.s || b.e - a.e);
      let cluster = [], end = -1;
      const flush = () => { const cols = []; cluster.forEach(x => { let i = cols.findIndex(c => c <= x.s); if (i < 0) { i = cols.length; cols.push(0); } cols[i] = x.e; x.lane = i; }); cluster.forEach(x => (x.lanes = cols.length)); cluster = []; };
      list.forEach(x => { if (cluster.length && x.s >= end) { flush(); end = -1; } cluster.push(x); end = Math.max(end, x.e); });
      flush();
    }
    function grid(all, from, n) {
      const days = Array.from({ length: n }, (_, i) => add(from, i)), t = Apps.today();
      label.textContent = n === 1 ? fmtD(from, { weekday: "long", month: "long", day: "numeric" }) + (from.slice(0, 4) !== t.slice(0, 4) ? ", " + from.slice(0, 4) : "")
        : `${fmtD(from)} – ${fmtD(days[n - 1], { month: "short", day: "numeric", year: "numeric" })}`;
      const head = h("div", { class: "tg-head" }, h("div", { class: "tg-corner" }),
        ...days.map(ds => h("button", { class: "tg-dh" + (ds === t ? " today" : "") + (wd(ds) >= 5 ? " we" : ""), title: n > 1 ? "Open this day" : "", onclick: () => { if (n > 1) { cur = ds; setView("day"); } } },
          h("span", { text: fmtD(ds, { weekday: n === 1 ? "long" : "short" }) }), h("b", { text: +ds.slice(8) }))));
      const allday = h("div", { class: "tg-allday" }, h("div", { class: "tg-corner", text: "All day" }), ...days.map(ds => {
        const c = h("div", { class: "tg-ad" + (ds === t ? " today" : ""), onclick: () => editEvent(null, ds, { allDay: true }) },
          ...all.filter(x => (x.allDay || x.end > x.date) && x.date <= ds && x.end >= ds).sort(byTime).map(it => chip(it, ds)));
        dropTarget(c, ds); return c;
      }));
      const gut = h("div", { class: "tg-gut" }, ...Array.from({ length: 24 }, (_, hr) => hr ? h("div", { class: "tg-hr", style: { top: hr * HOUR + "px" }, text: hourLabel(hr) }) : null));
      gridDays = days;
      gridCols = days.map(ds => {
        const col = h("div", { class: "tg-col" + (ds === t ? " today" : "") + (wd(ds) >= 5 ? " we" : ""), dataset: { date: ds } });
        col.addEventListener("click", e => {
          if (e.target !== col || Date.now() - justDragged < 350) return;
          const r = col.getBoundingClientRect(), mm = Math.max(0, Math.min(23 * 60, Math.floor((e.clientY - r.top) / HOUR * 2) * 30));
          editEvent(null, ds, { start: toHM(mm), finish: toHM(Math.min(1439, mm + 60)) });
        });
        const timed = all.filter(x => !x.allDay && x.end === x.date && x.date === ds).map(x => ({ it: x, s: x.sm, e: Math.max(x.fm, x.sm + 22) }));
        lanes(timed);
        timed.forEach(L => col.append(evBlock(L)));
        if (ds === t) col.append(h("div", { class: "tg-now", style: { top: nowMin() / 60 * HOUR + "px" } }));
        return col;
      });
      const scroll = h("div", { class: "tg-scroll" }, h("div", { class: "tg-body", style: { height: 24 * HOUR + "px" } }, gut, ...gridCols));
      return h("div", { class: "tg" + (n === 1 ? " one" : ""), style: { "--n": n, "--hour": HOUR + "px" } }, head, allday, scroll);
    }
    function evBlock(L) {
      const it = L.it, short = L.e - L.s < 45;
      const el = h("div", { class: "tg-ev" + it.cls + (it.edit ? " can" : "") + (short ? " short" : ""), role: "button", tabindex: 0, title: it.title,
        style: { "--c": it.color, top: L.s / 60 * HOUR + "px", height: (L.e - L.s) / 60 * HOUR - 2 + "px", left: `calc(${L.lane / L.lanes * 100}% + 2px)`, width: `calc(${100 / L.lanes}% - 4px)` },
        onclick: e => { e.stopPropagation(); openItem(it, el); }, onkeydown: e => { if (e.key === "Enter") openItem(it, el); } },
        h("div", { class: "tg-ev-t" }, it.ev && isRep(it.ev) ? "🔁 " : "", it.ev?.video ? "📹 " : "", it.title),
        h("div", { class: "tg-ev-m", text: fmtT(it.start) + " – " + fmtT(it.finish) + (it.place ? " · " + it.place : "") }),
        it.edit ? h("div", { class: "tg-rs", title: "Drag to change the end time" }) : null);
      if (it.edit) {
        el.addEventListener("pointerdown", pe => gridDrag(pe, it, pe.target.classList.contains("tg-rs") ? "size" : "move", el));
        el.addEventListener("touchmove", te => { if (el.classList.contains("dragging")) te.preventDefault(); }, { passive: false });
        el.addEventListener("contextmenu", ce => { if (el.dataset.hold) ce.preventDefault(); });
      }
      return el;
    }
    // pointer drag in the time grid: move (also to another day) or resize from the bottom edge; 15-minute steps
    function gridDrag(pe, it, mode, el) {
      if (pe.button !== 0) return;
      const x0 = pe.clientX, y0 = pe.clientY, touch = pe.pointerType !== "mouse";
      const s0 = it.sm, f0 = Math.min(it.fm, 1440), dur = f0 - s0;
      let active = false, ns = s0, nf = f0, nc = gridDays.indexOf(it.date), hold = null;
      const meta = el.querySelector(".tg-ev-m");
      const begin = () => { active = true; dragging = true; el.classList.add("dragging"); document.body.classList.add("cal-noselect"); try { navigator.vibrate?.(8); } catch {} };
      if (touch) { el.dataset.hold = "1"; hold = setTimeout(begin, 380); }
      const move = e => {
        const dx = e.clientX - x0, dy = e.clientY - y0;
        if (!active) { if (Math.hypot(dx, dy) <= (touch ? 8 : 4)) return; if (touch) return stop(); begin(); }
        e.preventDefault();
        const dm = Math.round(dy / HOUR * 4) * 15;
        if (mode === "size") nf = Math.max(s0 + 15, Math.min(1440, f0 + dm));
        else {
          ns = Math.max(0, Math.min(1440 - dur, s0 + dm)); nf = ns + dur;
          const i = gridCols.findIndex(c => { const r = c.getBoundingClientRect(); return e.clientX >= r.left && e.clientX < r.right; });
          if (i >= 0 && i !== nc) { nc = i; gridCols[i].append(el); }
        }
        el.style.top = ns / 60 * HOUR + "px"; el.style.height = Math.max(nf - ns, 22) / 60 * HOUR - 2 + "px";
        if (meta) meta.textContent = fmtT(toHM(ns)) + " – " + fmtT(toHM(Math.min(nf, 1439)));
      };
      const stop = () => {
        clearTimeout(hold); delete el.dataset.hold;
        removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", cancel);
        document.body.classList.remove("cal-noselect");
      };
      const up = () => {
        stop(); if (!active) return;
        justDragged = Date.now(); el.classList.remove("dragging"); dragging = false; pending = false;
        moveEvent(it.ev, nc >= 0 ? dn(gridDays[nc]) - dn(it.date) : 0, { start: toHM(ns), finish: toHM(Math.min(nf, 1439)) });
        draw();
      };
      const cancel = () => { stop(); if (active) { el.classList.remove("dragging"); dragging = false; pending = false; draw(); } };
      addEventListener("pointermove", move, { passive: false }); addEventListener("pointerup", up); addEventListener("pointercancel", cancel);
    }

    /* ---------- agenda ---------- */
    function agenda(all, from, to) {
      const t = Apps.today();
      label.textContent = `${fmtD(from)} – ${fmtD(to, { month: "short", day: "numeric", year: "numeric" })}`;
      const days = [];
      for (let d = from; d <= to; d = add(d, 1)) { const its = all.filter(x => x.date <= d && x.end >= d).sort(byTime); if (its.length) days.push([d, its]); }
      if (!days.length) return Apps.empty("🗓️", "Nothing scheduled in these 30 days.", newBtn());
      return h("div", { class: "agenda cal-agenda" }, ...days.map(([d, its], i) => h("div", { class: "ag-day" + (d === t ? " today" : ""), style: { animationDelay: Math.min(i, 8) * 35 + "ms" } },
        h("div", { class: "ag-date" }, h("b", { text: +d.slice(8) }), h("span", { text: d === t ? "Today" : fmtD(d, { weekday: "short", month: "short" }) })),
        h("div", { class: "ag-items" }, ...its.map(it => {
          const el = h("div", { class: "ag-row" + it.cls, role: "button", tabindex: 0, style: { "--c": it.color }, onclick: () => openItem(it, el), onkeydown: e => { if (e.key === "Enter") openItem(it, el); } },
            h("span", { class: "ag-time", text: it.allDay || it.end > it.date ? (it.end > it.date ? (it.date === d ? "Starts" : it.end === d ? "Ends" : "All day") : "All day") : fmtT(it.start) }),
            h("span", { class: "ag-bar" }),
            h("span", { class: "ag-main" }, h("b", { text: it.title }),
              it.kind === "event" ? h("small", { text: [it.allDay ? "" : fmtT(it.start) + " – " + fmtT(it.finish), it.place, isRep(it.ev) ? "🔁 " + REPEAT_TXT[it.ev.repeat.freq] : "", it.ev.video ? "📹 Video call" : ""].filter(Boolean).join(" · ") }) : null),
            it.kind === "event" && guests(it.ev).length ? Apps.avatars([ownerOf(it.ev), ...guests(it.ev)], 22, 4) : null,
            it.kind === "event" && statusOf(it.ev) === "pending" ? h("span", { class: "st st-pending", text: "Invited" }) : null);
          return el;
        })))));
    }

    /* ---------- draw ---------- */
    function draw() {
      if (dragging) { pending = true; return; }
      drawnDay = Apps.today();
      const [from, to] = range(), all = items(from, to);
      const sc = body.querySelector(".tg-scroll"), top = sc ? sc.scrollTop : 0, key = view + from;
      const el = view === "week" ? grid(all, from, 7) : view === "day" ? grid(all, from, 1) : view === "agenda" ? agenda(all, from, to) : month(all, from);
      if (anim) { el.classList.add("cal-anim"); anim = false; }
      body.replaceChildren(el);
      const ns = body.querySelector(".tg-scroll");
      if (ns) ns.scrollTop = key === scrollKey && sc ? top : (from <= drawnDay && drawnDay <= to ? Math.max(0, nowMin() / 60 * HOUR - 140) : 7.5 * HOUR);
      scrollKey = key;
      const n = invites().length;
      invBtn.replaceChildren(h("span", { text: "📨" }), h("span", { class: "lbl", text: " Invitations" }), n ? h("span", { class: "cal-count", text: n }) : null);
      invBtn.classList.toggle("has", n > 0);
    }
    const tick = setInterval(() => {
      if (Apps.today() !== drawnDay) return draw();
      body.querySelectorAll(".tg-now").forEach(l => (l.style.top = nowMin() / 60 * HOUR + "px"));
    }, 60000);
    const offs = ["events", "tasks", "deals", "absences", "people"].map(c => Data.on(c, draw));

    // deep link: #/app/calendar/<eventId>?date=YYYY-MM-DD
    if (argId) {
      let tries = 0, opened = false;
      const tryOpen = () => {
        if (opened) return true;
        const e = Data.get("events", argId);
        if (!e) return false;
        opened = true;
        const d = okDate(argDate) ? argDate : nextDate(e);
        if (cur !== d) { cur = d; anim = true; draw(); }
        setTimeout(() => { openEvent(argId, d); try { history.replaceState(null, "", "#/app/calendar"); } catch {} }, 60);
        return true;
      };
      if (!tryOpen()) {
        const off = Data.on("events", () => { if (tryOpen() || ++tries > 30) setTimeout(() => off()); });
        offs.push(off);
        setTimeout(() => { if (!opened) UI.toast("That event isn't available"); }, 8000);
      }
    }
    return () => { clearInterval(tick); offs.forEach(f => f()); };
  }

  /* ---------- reminders: run all the time, whether or not the calendar is open ---------- */
  const remKey = () => "lumen-cal-reminded-" + (window.Cloud?.ws?.id || "local");
  function remindTick() {
    if (!window.Data || !window.Apps?.today || !window.Notify?.alert) return;
    let fired; try { fired = JSON.parse(localStorage.getItem(remKey())) || {}; } catch { fired = {}; }
    const now = Date.now(), t = Apps.today(); let changed = false;
    occurrences(t, add(t, 2), { mine: true }).forEach(o => {
      if (o.declined) return;
      const rem = remindOf(o.ev); if (rem == null || isNaN(rem)) return;
      const startAt = new Date(o.date + "T" + (o.allDay ? "09:00" : o.start)).getTime(), k = o.ev.id + "|" + o.date + "|" + (o.start || "day");
      if (now < startAt - rem * 60000 || now > startAt + 60000 || fired[k]) return;
      fired[k] = now; changed = true;
      const mins = Math.round((startAt - now) / 60000);
      const when = o.allDay ? (o.date === t ? "is today" : "is tomorrow") : mins <= 0 ? "is starting now" : mins < 120 ? `starts in ${mins} min` : mins < 1200 ? `starts in ${Math.round(mins / 60)} h` : "starts tomorrow";
      Notify.alert({ title: `📅 ${o.ev.title || "Event"} ${when}`, body: [o.allDay ? "All day" : fmtT(o.start) + " – " + fmtT(o.finish), placeOf(o.ev), o.ev.video ? "📹 Video call" : ""].filter(Boolean).join(" · "),
        link: link(o.ev.id, isRep(o.ev) ? o.date : ""), icon: "📅", tag: "cal-" + k });
    });
    if (changed) {
      for (const x in fired) if (now - fired[x] > 3 * 864e5) delete fired[x];
      try { localStorage.setItem(remKey(), JSON.stringify(fired)); } catch {}
    }
  }
  const safeTick = () => { try { remindTick(); } catch (e) { console.warn("calendar reminders", e); } };
  setInterval(safeTick, 30000);
  setTimeout(safeTick, 8000);

  Apps.register("calendar", { title: "Calendar", icon: "📅", render });
  Apps.Calendar = { editEvent, openEvent, roomsManager };
  // shared read API for Home, search and other apps
  window.CalendarAPI = { occurrences, visible };
})();
